# VMS API Reference - Enterprise Edition

**Base URL:** `http://localhost:5001/api`

**Authentication:** Session-based or Bearer token

---

## Table of Contents
1. [Visitors](#visitors)
2. [Visits](#visits)
3. [Locations](#locations)
4. [Devices](#devices)
5. [Settings](#settings)
6. [Dashboard](#dashboard)
7. [Security Dashboard](#security-dashboard)
8. [Reports & Analytics](#reports--analytics)
9. [Approval Workflow](#approval-workflow)
10. [Watchlist & Blacklist](#watchlist--blacklist)
11. [Platform Integration](#platform-integration)

---

## Visitors

### GET /visitors
List all visitors.

### POST /visitors/register
Register a new visitor with photo capture.

### GET /visitors/{id}
Get single visitor.

### PUT /visitors/{id}/blacklist
Blacklist a visitor.

---

## Visits

### GET /visitors/visits
List all visits with enterprise fields.

### POST /visitors/{visitorId}/schedule-visit
Schedule a visit with full enterprise fields:
- visitType, purpose, location, device
- expectedArrival, expectedDeparture, durationHours
- assets (laptop, camera, pendrive, mobile, bag, tools)
- facilities (lunch, parking, wifi, mealPreference)
- vehicle (number, type, driverName)
- compliance (nda, safety, escort, idVerified)

### POST /visitors/visits/{visitId}/check-in
```json
{
  "deviceId": "device_001",
  "deviceName": "Lobby Kiosk",
  "method": "face|qr|manual"
}
```

### POST /visitors/visits/{visitId}/check-out
Records device, method, and calculates duration.

---

## Locations

### GET /settings/locations
### POST /settings/locations
### PUT /settings/locations/{id}
### DELETE /settings/locations/{id}

VMS Location Schema:
```json
{
  "_id": "loc_001",
  "name": "Main Lobby",
  "type": "gate|reception|floor|building",
  "address": "123 Main St",
  "timezone": "Asia/Kolkata",
  "platformEntityId": null,
  "status": "active"
}
```

---

## Devices

### GET /settings/devices
### POST /settings/devices
### PUT /settings/devices/{id}
### DELETE /settings/devices/{id}

Device Types: `kiosk`, `tablet`, `turnstile`, `camera`

---

## Settings

### GET /settings
### PUT /settings

---

## Dashboard

### GET /dashboard/stats
Basic statistics: currentVisitors, expectedToday, checkedInToday, checkedOutToday.

### GET /dashboard/trends
7-day visitor trends.

---

## Security Dashboard

### GET /dashboard/security
```json
{
  "liveVisitors": [...],
  "liveCount": 12,
  "overstayed": [...],
  "overstayedCount": 2,
  "pendingApprovals": [...],
  "pendingCount": 3
}
```

---

## Reports & Analytics

### GET /dashboard/reports/visits
Export visits data.

**Query Parameters:**
- `companyId` (required)
- `startDate` (optional, ISO format)
- `endDate` (optional, ISO format)
- `format`: `json` or `csv`

### GET /dashboard/reports/summary
```json
{
  "monthlyVisits": 250,
  "byVisitorType": [{"type": "guest", "count": 120}, ...],
  "byCheckInMethod": [{"method": "face", "count": 180}, ...],
  "avgDurationMinutes": 240,
  "peakHours": [{"hour": 10, "count": 45}, ...]
}
```

---

## Approval Workflow

### POST /dashboard/approvals/{visitId}/approve
Approve a pending visit.

### POST /dashboard/approvals/{visitId}/deny
Deny a pending visit.
```json
{ "reason": "Optional denial reason" }
```

---

## Watchlist & Blacklist

### GET /security/watchlist
Get all watchlist/blacklist entries.

### POST /security/watchlist/{visitorId}
Add visitor to watchlist/blacklist.
```json
{
  "status": "watchlist|blacklisted",
  "reason": "Reason for flagging"
}
```

### DELETE /security/watchlist/{visitorId}
Remove from watchlist.

### GET /security/check/{visitorId}
Check visitor security status.

### GET /security/alerts
```json
{
  "alerts": [
    {
      "type": "BLACKLISTED_ENTRY|WATCHLIST_ENTRY|OVERSTAY|PENDING_APPROVAL",
      "severity": "critical|warning|info",
      "visitorName": "John Doe",
      "reason": "Description"
    }
  ],
  "criticalCount": 1,
  "warningCount": 3
}
```

---

## Visit Types

| Type | Use Case |
|------|----------|
| `guest` | General visitors, VIPs |
| `interview` | Job candidates |
| `vendor` | Suppliers, service providers |
| `contractor` | Contract staff |
| `delivery` | Courier, material delivery |
| `government` | Regulatory officials |

---

## Check-in Methods

| Method | Description |
|--------|-------------|
| `face` | Facial recognition |
| `qr` | QR code scan |
| `manual` | Front desk entry |

---

## Security Status

| Status | Description |
|--------|-------------|
| `clear` | Normal visitor |
| `watchlist` | Requires attention |
| `blacklisted` | Entry denied |

---

## Platform Integration

When connected to Bharatlytics Platform:

| VMS Schema | Maps To |
|------------|---------|
| Location | Platform Entity |
| Visitor | Platform Actor (visitor) |
| Host | Platform Actor (employee) |

---

## Error Codes

| Code | Message |
|------|---------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 500 | Server Error |
