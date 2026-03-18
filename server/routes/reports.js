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

        const report = await collections.reports().findOne({ _id: new ObjectId(report_id) });
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (format === 'csv' && report.data) {
            const data = report.data;
            if (data.length === 0) {
                res.set('Content-Type', 'text/csv');
                res.set('Content-Disposition', `attachment; filename=${report.templateId || 'report'}_${report_id.slice(-6)}.csv`);
                return res.send('No data found for the selected date range.');
            }

            const csv = buildCSV(data);
            const templateNames = { visits: 'Visits_Report', visitors: 'Visitors_Report', employees: 'Employees_Report', attendance: 'Attendance_Report' };
            const filename = `${templateNames[report.templateId] || 'Report'}_${fmtDateShort(report.dateRange?.startDate)}_to_${fmtDateShort(report.dateRange?.endDate)}.csv`;

            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send('\uFEFF' + csv); // BOM for Excel compatibility
        }

        res.json({ report: convertObjectIds(report) });
    } catch (error) {
        console.error('Error downloading report:', error);
        next(error);
    }
});

// ─── CSV Builder ────────────────────────────────────────────────────
function buildCSV(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const headerLine = headers.map(escCSV).join(',');
    const dataLines = rows.map(row =>
        headers.map(h => escCSV(formatCellValue(row[h]))).join(',')
    );
    return [headerLine, ...dataLines].join('\r\n');
}

function escCSV(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function formatCellValue(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return fmtDate(v);
    if (typeof v === 'object' && v._bsontype === 'ObjectId') return v.toString();
    if (ObjectId.isValid(v) && typeof v === 'object' && v.toString().length === 24) return v.toString();
    if (Array.isArray(v)) return v.map(formatCellValue).filter(Boolean).join('; ');
    if (typeof v === 'object') {
        // Try to get a human-readable representation
        if (v.name) return v.name;
        if (v.label) return v.label;
        if (v.toString && v.toString() !== '[object Object]') return v.toString();
        // Flatten key-value pairs
        const parts = Object.entries(v)
            .filter(([k, val]) => val !== null && val !== undefined && k !== '_id')
            .map(([k, val]) => `${k}: ${formatCellValue(val)}`);
        return parts.join('; ') || '';
    }
    return String(v);
}

function fmtDate(d) {
    if (!d) return '';
    try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '';
        return dt.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }) + ' ' +
            dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return ''; }
}

function fmtDateShort(d) {
    if (!d) return 'unknown';
    try {
        const dt = new Date(d);
        return dt.toISOString().split('T')[0];
    } catch { return 'unknown'; }
}

// ─── Report Generators (return clean, flat row objects) ─────────────

async function generateVisitsReport(companyId, startDate, endDate) {
    const sd = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ed = endDate ? new Date(endDate) : new Date();
    const companyMatch = isValidObjectId(companyId) ? { companyId: new ObjectId(companyId) } : { companyId };

    const visits = await collections.visits().find({
        ...companyMatch,
        createdAt: { $gte: sd, $lte: ed }
    }).sort({ createdAt: -1 }).toArray();

    return visits.map((v, i) => ({
        '#': i + 1,
        'Visitor Name': v.visitorName || '',
        'Phone': v.visitorMobile || v.visitorPhone || '',
        'Email': v.visitorEmail || '',
        'Host Employee': v.hostEmployeeName || '',
        'Purpose': v.purpose || '',
        'Status': capitalize(v.status),
        'Visit Type': v.visitType || '',
        'Expected Arrival': fmtDate(v.expectedDate || v.expectedArrival),
        'Actual Arrival': fmtDate(v.actualArrival),
        'Actual Departure': fmtDate(v.actualDeparture),
        'Belongings': Array.isArray(v.belongings) ? v.belongings.join(', ') : (v.belongings || ''),
        'Vehicle Number': v.vehicleNumber || '',
        'QR Code': v.qrCode || '',
        'Check-In Method': v.checkinMethod || '',
        'Notes': v.notes || '',
        'Created': fmtDate(v.createdAt),
    }));
}

async function generateVisitorsReport(companyId) {
    const companyMatch = isValidObjectId(companyId)
        ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
        : { companyId };

    const visitors = await collections.visitors().find({
        ...companyMatch,
        status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 }).toArray();

    return visitors.map((v, i) => ({
        '#': i + 1,
        'Name': v.visitorName || v.name || '',
        'Phone': v.phone || '',
        'Email': v.email || '',
        'Organization': v.organization || v.company || '',
        'Visitor Type': v.visitorType || 'General',
        'Status': capitalize(v.status),
        'Total Visits': v.totalVisits || 0,
        'Last Visit': fmtDate(v.lastVisit),
        'ID Proof Type': v.idProofType || '',
        'ID Proof Number': v.idProofNumber || '',
        'Registered On': fmtDate(v.createdAt),
    }));
}

async function generateEmployeesReport(companyId) {
    const companyMatch = isValidObjectId(companyId)
        ? { $or: [{ companyId: new ObjectId(companyId) }, { companyId }] }
        : { companyId };

    const employees = await collections.employees().find({
        ...companyMatch,
        status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 }).toArray();

    return employees.map((e, i) => ({
        '#': i + 1,
        'Employee ID': e.employeeId || '',
        'Name': e.employeeName || e.name || '',
        'Email': e.email || '',
        'Phone': e.phone || '',
        'Department': e.department || '',
        'Designation': e.designation || '',
        'Status': capitalize(e.status),
        'Can Host Visitors': e.canHostVisitors !== false ? 'Yes' : 'No',
        'Added On': fmtDate(e.createdAt),
    }));
}

async function generateAttendanceReport(companyId, startDate, endDate) {
    const sd = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ed = endDate ? new Date(endDate) : new Date();
    const companyMatch = isValidObjectId(companyId) ? { companyId: new ObjectId(companyId) } : { companyId };

    const attendance = await collections.attendance?.()?.find({
        ...companyMatch,
        date: { $gte: sd, $lte: ed }
    }).sort({ date: -1 }).toArray() || [];

    return attendance.map((a, i) => ({
        '#': i + 1,
        'Employee Name': a.employeeName || '',
        'Employee ID': a.employeeId?.toString() || '',
        'Date': fmtDate(a.date),
        'Check In': fmtDate(a.checkIn),
        'Check Out': fmtDate(a.checkOut),
        'Status': capitalize(a.status),
        'Duration (hrs)': a.duration || '',
    }));
}

function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

module.exports = router;

