/**
 * Attendance API
 * Employee attendance tracking
 * Matching Python app/api/attendance.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * Normalize an attendance record to the canonical schema.
 * Handles old face-recognition records that used different field names.
 */
function normalizeAttendanceRecord(record) {
    const r = { ...record };

    // Map old field names → canonical
    if (!r.personType && r.actorType) {
        r.personType = r.actorType.toUpperCase();
    }
    if (!r.attendanceType && r.type) {
        r.attendanceType = r.type;
    }
    if (!r.attendanceTime && r.date) {
        r.attendanceTime = r.date;
    }

    // Ensure all canonical fields exist with defaults
    r.personType = r.personType || 'EMPLOYEE';
    r.attendanceType = r.attendanceType || 'IN';
    r.attendanceTime = r.attendanceTime || r.date;
    r.shiftId = r.shiftId !== undefined ? r.shiftId : null;
    r.checkIn = r.checkIn !== undefined ? r.checkIn : (r.attendanceType === 'IN' ? r.date : null);
    r.checkOut = r.checkOut !== undefined ? r.checkOut : (r.attendanceType === 'OUT' ? r.date : null);
    r.status = r.status || 'present';
    r.location = r.location || { latitude: null, longitude: null, accuracy: null, address: '' };
    r.recognition = r.recognition || {
        confidenceScore: r.confidence || null,
        algorithm: 'face_recognition_v2',
        processingTime: null
    };
    r.device = r.device || {
        deviceId: r.cameraName || 'CCTV',
        platform: 'cctv',
        appVersion: '1.0.0',
        ipAddress: ''
    };
    r.syncStatus = r.syncStatus !== undefined ? r.syncStatus : 1;
    r.transactionFrom = r.transactionFrom || r.source || 'face_recognition';
    r.remarks = r.remarks !== undefined ? r.remarks : '';

    return r;
}

/**
 * GET /api/attendance
 * List attendance records
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const employeeId = req.query.employeeId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const query = {};

        if (isValidObjectId(companyId)) {
            query.companyId = new ObjectId(companyId);
        } else {
            query.companyId = companyId;
        }

        if (employeeId) {
            query.employeeId = isValidObjectId(employeeId) ? new ObjectId(employeeId) : employeeId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const attendance = await collections.attendance()
            .find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const total = await collections.attendance().countDocuments(query);

        res.json({
            status: 'success',
            attendance: convertObjectIds(attendance.map(normalizeAttendanceRecord)),
            total,
            limit,
            skip
        });
    } catch (error) {
        console.error('Error listing attendance:', error);
        next(error);
    }
});

/**
 * POST /api/attendance
 * Record attendance (check-in)
 */
router.post('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const data = req.body;

        if (!data.companyId || !data.employeeId) {
            return res.status(400).json({ error: 'companyId and employeeId are required' });
        }

        const companyId = isValidObjectId(data.companyId) ? new ObjectId(data.companyId) : data.companyId;
        const employeeId = isValidObjectId(data.employeeId) ? new ObjectId(data.employeeId) : data.employeeId;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if already checked in today
        const existingRecord = await collections.attendance().findOne({
            companyId,
            employeeId,
            date: { $gte: today }
        });

        if (existingRecord && !existingRecord.checkOut) {
            return res.status(400).json({
                error: 'Already checked in today',
                attendanceId: existingRecord._id.toString()
            });
        }

        // Use provided timestamp or default to now
        const providedDate = data.date || data.attendanceTime || data.timestamp || data.checkInTime;
        const recordDate = providedDate ? new Date(providedDate) : new Date();

        const attendanceDoc = {
            _id: new ObjectId(),
            companyId,
            employeeId,
            date: recordDate,
            checkIn: recordDate,
            checkOut: null,
            checkInMethod: data.checkInMethod || 'manual',
            checkInDeviceId: data.deviceId || null,
            checkInLocation: data.location || null,
            status: 'present',
            notes: data.notes || null,
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        await collections.attendance().insertOne(attendanceDoc);

        res.status(201).json({
            message: 'Check-in recorded successfully',
            _id: attendanceDoc._id.toString(),
            checkInTime: attendanceDoc.checkIn.toISOString()
        });
    } catch (error) {
        console.error('Error recording check-in:', error);
        next(error);
    }
});

/**
 * POST /api/attendance/:attendance_id/checkout
 * Record check-out
 */
router.post('/:attendance_id/checkout', requireCompanyAccess, async (req, res, next) => {
    try {
        const { attendance_id } = req.params;
        const data = req.body;

        if (!isValidObjectId(attendance_id)) {
            return res.status(400).json({ error: 'Invalid attendance ID format' });
        }

        const attendance = await collections.attendance().findOne({ _id: new ObjectId(attendance_id) });

        if (!attendance) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        if (attendance.checkOut) {
            return res.status(400).json({ error: 'Already checked out' });
        }

        const checkOutTime = data.date || data.checkOutTime
            ? new Date(data.date || data.checkOutTime)
            : new Date();
        const duration = checkOutTime - attendance.checkIn;
        const hoursWorked = duration / (1000 * 60 * 60);

        await collections.attendance().updateOne(
            { _id: new ObjectId(attendance_id) },
            {
                $set: {
                    checkOut: checkOutTime,
                    checkOutMethod: data.checkOutMethod || 'manual',
                    checkOutDeviceId: data.deviceId || null,
                    checkOutLocation: data.location || null,
                    hoursWorked: Math.round(hoursWorked * 100) / 100,
                    lastUpdated: new Date()
                }
            }
        );

        res.json({
            message: 'Check-out recorded successfully',
            checkOutTime: checkOutTime.toISOString(),
            hoursWorked: Math.round(hoursWorked * 100) / 100
        });
    } catch (error) {
        console.error('Error recording check-out:', error);
        next(error);
    }
});

/**
 * GET /api/attendance/summary
 * Get attendance summary for a date range
 */
router.get('/summary', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const summary = await collections.attendance().aggregate([
            {
                $match: {
                    ...companyMatch,
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$employeeId',
                    totalDays: { $sum: 1 },
                    presentDays: {
                        $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
                    },
                    totalHours: { $sum: { $ifNull: ['$hoursWorked', 0] } },
                    avgHoursPerDay: { $avg: { $ifNull: ['$hoursWorked', 0] } }
                }
            }
        ]).toArray();

        res.json({
            summary: summary.map(s => ({
                employeeId: s._id?.toString(),
                totalDays: s.totalDays,
                presentDays: s.presentDays,
                totalHours: Math.round(s.totalHours * 100) / 100,
                avgHoursPerDay: Math.round(s.avgHoursPerDay * 100) / 100
            })),
            dateRange: { startDate, endDate }
        });
    } catch (error) {
        console.error('Error getting attendance summary:', error);
        next(error);
    }
});

/**
 * GET /api/attendance/today
 * Get today's attendance status
 */
router.get('/today', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const [todayRecords, totalEmployees] = await Promise.all([
            collections.attendance()
                .find({ ...companyMatch, date: { $gte: today, $lt: tomorrow } })
                .toArray(),
            collections.employees().countDocuments({ ...companyMatch, status: 'active' })
        ]);

        const normalized = todayRecords.map(normalizeAttendanceRecord);

        const checkedIn = normalized.filter(r => r.checkIn && !r.checkOut).length;
        const checkedOut = normalized.filter(r => r.checkOut).length;
        const absent = totalEmployees - normalized.length;

        res.json({
            date: today.toISOString().split('T')[0],
            totalEmployees,
            present: normalized.length,
            checkedIn,
            checkedOut,
            absent,
            records: convertObjectIds(normalized)
        });
    } catch (error) {
        console.error('Error getting today attendance:', error);
        next(error);
    }
});

module.exports = router;
