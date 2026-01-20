/**
 * Reports API
 * Report generation and export
 * Matching Python app/api/reports.py
 */
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { collections } = require('../db');
const { requireCompanyAccess } = require('../middleware/auth');
const { convertObjectIds, isValidObjectId } = require('../utils/helpers');

/**
 * GET /api/reports/visits
 * Generate visits report
 */
router.get('/visits', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        const format = req.query.format || 'json'; // json, csv

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const visits = await collections.visits()
            .find({
                ...companyMatch,
                createdAt: { $gte: startDate, $lte: endDate }
            })
            .sort({ createdAt: -1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Visit ID', 'Visitor Name', 'Host', 'Purpose', 'Status', 'Expected Arrival', 'Actual Arrival', 'Actual Departure'];
            const rows = visits.map(v => [
                v._id.toString(),
                v.visitorName || '',
                v.hostEmployeeName || '',
                v.purpose || '',
                v.status || '',
                v.expectedArrival?.toISOString() || '',
                v.actualArrival?.toISOString() || '',
                v.actualDeparture?.toISOString() || ''
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=visits_report_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        }

        res.json({
            reportType: 'visits',
            dateRange: { startDate, endDate },
            totalCount: visits.length,
            data: convertObjectIds(visits)
        });
    } catch (error) {
        console.error('Error generating visits report:', error);
        next(error);
    }
});

/**
 * GET /api/reports/visitors
 * Generate visitors report
 */
router.get('/visitors', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const format = req.query.format || 'json';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const visitors = await collections.visitors()
            .find({ ...companyMatch, status: { $ne: 'deleted' } })
            .sort({ createdAt: -1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Visitor ID', 'Name', 'Phone', 'Email', 'Organization', 'Type', 'Status', 'Created At'];
            const rows = visitors.map(v => [
                v._id.toString(),
                v.visitorName || '',
                v.phone || '',
                v.email || '',
                v.organization || '',
                v.visitorType || '',
                v.status || '',
                v.createdAt?.toISOString() || ''
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=visitors_report_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        }

        res.json({
            reportType: 'visitors',
            totalCount: visitors.length,
            data: convertObjectIds(visitors)
        });
    } catch (error) {
        console.error('Error generating visitors report:', error);
        next(error);
    }
});

/**
 * GET /api/reports/employees
 * Generate employees report
 */
router.get('/employees', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const format = req.query.format || 'json';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        const employees = await collections.employees()
            .find({ ...companyMatch, status: { $ne: 'deleted' } })
            .sort({ createdAt: -1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Employee ID', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Status'];
            const rows = employees.map(e => [
                e.employeeId || e._id.toString(),
                e.employeeName || '',
                e.email || '',
                e.phone || '',
                e.department || '',
                e.designation || '',
                e.status || ''
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=employees_report_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        }

        res.json({
            reportType: 'employees',
            totalCount: employees.length,
            data: convertObjectIds(employees)
        });
    } catch (error) {
        console.error('Error generating employees report:', error);
        next(error);
    }
});

/**
 * GET /api/reports/attendance
 * Generate attendance report
 */
router.get('/attendance', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        const format = req.query.format || 'json';

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { companyId: new ObjectId(companyId) }
            : { companyId };

        const attendance = await collections.attendance()
            .find({
                ...companyMatch,
                date: { $gte: startDate, $lte: endDate }
            })
            .sort({ date: -1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Employee ID', 'Date', 'Check In', 'Check Out', 'Status'];
            const rows = attendance.map(a => [
                a.employeeId?.toString() || '',
                a.date?.toISOString().split('T')[0] || '',
                a.checkIn?.toISOString() || '',
                a.checkOut?.toISOString() || '',
                a.status || ''
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=attendance_report_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        }

        res.json({
            reportType: 'attendance',
            dateRange: { startDate, endDate },
            totalCount: attendance.length,
            data: convertObjectIds(attendance)
        });
    } catch (error) {
        console.error('Error generating attendance report:', error);
        next(error);
    }
});

/**
 * GET /api/reports
 * List all generated reports for a company
 */
router.get('/', requireCompanyAccess, async (req, res, next) => {
    try {
        const companyId = req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required.' });
        }

        const companyMatch = isValidObjectId(companyId)
            ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
            : { companyId };

        // Get generated reports from reports collection
        const reports = await collections.reports?.()?.find(companyMatch)
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray() || [];

        res.json({ reports: convertObjectIds(reports) });
    } catch (error) {
        console.error('Error listing reports:', error);
        next(error);
    }
});

/**
 * GET /api/reports/templates
 * List available report templates
 */
router.get('/templates', requireCompanyAccess, async (req, res, next) => {
    try {
        // Return static list of available report templates
        const templates = [
            {
                id: 'visits',
                name: 'Visits Report',
                description: 'Report of all visitor visits with arrival and departure times',
                parameters: ['startDate', 'endDate', 'format']
            },
            {
                id: 'visitors',
                name: 'Visitors Report',
                description: 'List of all registered visitors',
                parameters: ['format']
            },
            {
                id: 'employees',
                name: 'Employees Report',
                description: 'List of all employees who can host visitors',
                parameters: ['format']
            },
            {
                id: 'attendance',
                name: 'Attendance Report',
                description: 'Employee attendance tracking report',
                parameters: ['startDate', 'endDate', 'format']
            },
            {
                id: 'analytics',
                name: 'Analytics Report',
                description: 'Visitor analytics and trends',
                parameters: ['startDate', 'endDate']
            }
        ];

        res.json({ templates });
    } catch (error) {
        console.error('Error fetching report templates:', error);
        next(error);
    }
});

/**
 * POST /api/reports/generate
 * Generate a new report
 */
router.post('/generate', requireCompanyAccess, async (req, res, next) => {
    try {
        const { companyId, templateId, startDate, endDate, format = 'json' } = req.body;

        if (!companyId || !templateId) {
            return res.status(400).json({ error: 'Company ID and template ID are required.' });
        }

        // Generate report based on template
        let reportData;
        switch (templateId) {
            case 'visits':
                reportData = await generateVisitsReport(companyId, startDate, endDate);
                break;
            case 'visitors':
                reportData = await generateVisitorsReport(companyId);
                break;
            case 'employees':
                reportData = await generateEmployeesReport(companyId);
                break;
            case 'attendance':
                reportData = await generateAttendanceReport(companyId, startDate, endDate);
                break;
            default:
                return res.status(400).json({ error: `Unknown template: ${templateId}` });
        }

        // Store the generated report
        const reportDoc = {
            _id: new ObjectId(),
            companyId: isValidObjectId(companyId) ? new ObjectId(companyId) : companyId,
            templateId,
            reportType: templateId,
            dateRange: { startDate: new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000), endDate: new Date(endDate || Date.now()) },
            totalCount: reportData.length,
            generatedAt: new Date(),
            status: 'completed',
            format,
            data: reportData
        };

        // Try to store in reports collection (create if doesn't exist)
        try {
            await collections.reports?.()?.insertOne(reportDoc);
        } catch (e) {
            // Collection might not exist, that's OK
        }

        res.json({
            message: 'Report generated successfully',
            reportId: reportDoc._id.toString(),
            report: convertObjectIds(reportDoc)
        });
    } catch (error) {
        console.error('Error generating report:', error);
        next(error);
    }
});

/**
 * GET /api/reports/:report_id/download
 * Download a generated report
 */
router.get('/:report_id/download', requireCompanyAccess, async (req, res, next) => {
    try {
        const { report_id } = req.params;
        const format = req.query.format || 'csv';

        if (!isValidObjectId(report_id)) {
            return res.status(400).json({ error: 'Invalid report ID format' });
        }

        // Try to find the report
        const report = await collections.reports?.()?.findOne({ _id: new ObjectId(report_id) });

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (format === 'csv' && report.data) {
            // Generate CSV from report data
            const data = report.data;
            if (data.length === 0) {
                return res.send('');
            }

            const headers = Object.keys(data[0] || {}).join(',');
            const rows = data.map(row => Object.values(row).map(v => String(v || '')).join(','));
            const csv = [headers, ...rows].join('\n');

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=report_${report_id}.csv`);
            return res.send(csv);
        }

        res.json({ report: convertObjectIds(report) });
    } catch (error) {
        console.error('Error downloading report:', error);
        next(error);
    }
});

// Helper functions for report generation
async function generateVisitsReport(companyId, startDate, endDate) {
    const sd = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ed = endDate ? new Date(endDate) : new Date();
    const companyMatch = isValidObjectId(companyId) ? { companyId: new ObjectId(companyId) } : { companyId };

    return await collections.visits().find({
        ...companyMatch,
        createdAt: { $gte: sd, $lte: ed }
    }).sort({ createdAt: -1 }).toArray();
}

async function generateVisitorsReport(companyId) {
    const companyMatch = isValidObjectId(companyId)
        ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
        : { companyId };

    return await collections.visitors().find({
        ...companyMatch,
        status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 }).toArray();
}

async function generateEmployeesReport(companyId) {
    const companyMatch = isValidObjectId(companyId)
        ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
        : { companyId };

    return await collections.employees().find({
        ...companyMatch,
        status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 }).toArray();
}

async function generateAttendanceReport(companyId, startDate, endDate) {
    const sd = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ed = endDate ? new Date(endDate) : new Date();
    const companyMatch = isValidObjectId(companyId) ? { companyId: new ObjectId(companyId) } : { companyId };

    return await collections.attendance?.()?.find({
        ...companyMatch,
        date: { $gte: sd, $lte: ed }
    }).sort({ date: -1 }).toArray() || [];
}

module.exports = router;

