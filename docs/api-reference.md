# VMS API Reference - Enterprise Edition

**Version:** 3.0  
**Base URL:** `http://localhost:5001/api`  
**Last Updated:** December 2024

---

## Authentication

All protected endpoints require one of the following:

| Method | Header | Description |
|--------|--------|-------------|
| Session Cookie | `Cookie: session=...` | Browser-based access |
| Bearer Token | `Authorization: Bearer <JWT>` | API access |
| Platform Token | `X-Platform-Token: <token>` | Platform-to-App calls |

---

## Table of Contents

1. [Visitors](#1-visitors)
2. [Visits](#2-visits)
3. [Employees](#3-employees)
4. [Dashboard](#4-dashboard)
5. [Analytics](#5-analytics)
6. [Settings](#6-settings)
7. [Security](#7-security)
8. [Data Residency](#8-data-residency)
9. [Webhooks](#9-webhooks)
10. [Error Codes](#10-error-codes)
11. [Data Models](#11-data-models)

---

## 1. Visitors

**Base Path:** `/api/visitors`

### 1.1 List Visitors

```http
GET /api/visitors?companyId={companyId}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |

**Response:**
```json
{
  "visitors": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "visitorName": "John Doe",
      "email": "john.doe@example.com",
      "phone": "+919876543210",
      "organization": "Acme Corp",
      "visitorType": "guest",
      "status": "active",
      "blacklisted": false,
      "createdAt": "2024-12-10T09:00:00Z"
    }
  ]
}
```

---

### 1.2 Register Visitor

```http
POST /api/visitors/register
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `visitorName` | string | Yes | Full name |
| `phone` | string | Yes | Phone number (E.164 format) |
| `hostEmployeeId` | string | Yes | Host employee ID |
| `email` | string | No | Email address |
| `visitorType` | string | No | `guest`, `vendor`, `contractor`, `interview`, `vip` |
| `organization` | string | No | Visitor's company |
| `idType` | string | No | `pan_card`, `aadhar_card`, `driving_license`, `passport` |
| `idNumber` | string | No | ID document number |
| `left` | file | No | Left-facing photo |
| `center` | file | No | Center-facing photo |
| `right` | file | No | Right-facing photo |

**Example Request (cURL):**
```bash
curl -X POST http://localhost:5001/api/visitors/register \
  -H "Authorization: Bearer <token>" \
  -F "companyId=507f1f77bcf86cd799439011" \
  -F "visitorName=John Doe" \
  -F "phone=+919876543210" \
  -F "hostEmployeeId=emp_12345" \
  -F "email=john@example.com" \
  -F "visitorType=guest" \
  -F "center=@/path/to/photo.jpg"
```

**Response:**
```json
{
  "message": "Visitor registration successful",
  "_id": "507f1f77bcf86cd799439012",
  "embeddingStatus": {
    "Facenet512": "queued"
  }
}
```

---

### 1.3 Update Visitor

```http
PATCH /api/visitors/update
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `visitorId` | string | Yes | Visitor ObjectId |
| `visitorName` | string | No | Updated name |
| `email` | string | No | Updated email |
| `phone` | string | No | Updated phone |
| `organization` | string | No | Updated organization |

**Response:**
```json
{
  "message": "Visitor updated successfully"
}
```

---

### 1.4 Blacklist Visitor

```http
POST /api/visitors/blacklist
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "507f1f77bcf86cd799439012",
  "reason": "Security violation"
}
```

**Response:**
```json
{
  "message": "Visitor blacklisted successfully"
}
```

---

### 1.5 Unblacklist Visitor

```http
POST /api/visitors/unblacklist
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "507f1f77bcf86cd799439012"
}
```

**Response:**
```json
{
  "message": "Visitor unblacklisted successfully"
}
```

---

### 1.6 Get Visitor Image

```http
GET /api/visitors/images/{image_id}
```

**Response:** Binary image data (`image/jpeg`)

---

## 2. Visits

**Base Path:** `/api/visits` and `/api/visitors`

### 2.1 List Visits

```http
GET /api/visits?companyId={companyId}&status={status}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `status` | string | No | `scheduled`, `checked_in`, `checked_out`, `cancelled` |

**Response:**
```json
[
  {
    "_id": "visit_abc123",
    "visitorId": "507f1f77bcf86cd799439012",
    "visitorName": "John Doe",
    "hostEmployeeId": "emp_12345",
    "hostEmployeeName": "Jane Smith",
    "visitType": "guest",
    "purpose": "Business Meeting",
    "status": "scheduled",
    "expectedArrival": "2024-12-13T10:00:00Z",
    "expectedDeparture": "2024-12-13T12:00:00Z",
    "assets": {
      "laptop": true,
      "bag": false
    },
    "facilities": {
      "wifiAccess": true,
      "parkingRequired": false
    }
  }
]
```

---

### 2.2 Get Single Visit

```http
GET /api/visits/{visit_id}
```

**Response:**
```json
{
  "_id": "visit_abc123",
  "visitorId": "507f1f77bcf86cd799439012",
  "visitorName": "John Doe",
  "hostEmployeeId": "emp_12345",
  "hostEmployeeName": "Jane Smith",
  "visitType": "guest",
  "status": "checked_in",
  "actualArrival": "2024-12-13T10:05:00Z",
  "checkInMethod": "face"
}
```

---

### 2.3 Schedule Visit

```http
POST /api/visits
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "visitorId": "507f1f77bcf86cd799439012",
  "hostEmployeeId": "emp_12345",
  "visitType": "guest",
  "purpose": "Business Meeting",
  "expectedArrival": "2024-12-13T10:00:00Z",
  "expectedDeparture": "2024-12-13T12:00:00Z",
  "durationHours": 2,
  "requiresApproval": false,
  "assets": {
    "laptop": true,
    "camera": false,
    "pendrive": false,
    "mobile": true,
    "bag": true,
    "tools": false
  },
  "facilities": {
    "lunchIncluded": false,
    "parkingRequired": true,
    "wifiAccess": true,
    "mealPreference": "veg"
  },
  "vehicleNumber": "KA01AB1234",
  "vehicleType": "car",
  "driverName": "Driver Name",
  "ndaRequired": true,
  "safetyBriefing": true,
  "escortRequired": false,
  "accessAreas": ["zone_lobby", "zone_meeting_room"],
  "notes": "Please provide guest WiFi access"
}
```

**Response:**
```json
{
  "id": "visit_abc123",
  "message": "Visit scheduled"
}
```

---

### 2.4 Schedule Visit (Alternative - via Visitor)

```http
POST /api/visitors/{visitorId}/schedule-visit
Content-Type: application/json
```

Same request body as above. Returns additional QR code URL:

```json
{
  "message": "Visit scheduled successfully",
  "visit": {
    "_id": "visit_abc123",
    "qrCode": "visit_abc123",
    "qrCodeUrl": "/api/visitors/visits/qr/visit_abc123"
  }
}
```

---

### 2.5 Check In

```http
POST /api/visits/{visit_id}/check-in
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "device_001",
  "deviceName": "Lobby Kiosk",
  "method": "face"
}
```

| Field | Type | Required | Options |
|-------|------|----------|---------|
| `deviceId` | string | No | Device identifier |
| `deviceName` | string | No | Device display name |
| `method` | string | Yes | `face`, `qr`, `manual` |

**Response:**
```json
{
  "message": "Checked in successfully",
  "checkInTime": "2024-12-13T10:05:00Z",
  "method": "face"
}
```

**Events Published:**
- `visit.checked_in` → Platform

**Metrics Reported:**
- `active_visitors` (count)
- `visits_today` (count)

---

### 2.6 Check Out

```http
POST /api/visits/{visit_id}/check-out
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "device_001",
  "deviceName": "Exit Turnstile",
  "method": "qr"
}
```

**Response:**
```json
{
  "message": "Checked out successfully",
  "checkOutTime": "2024-12-13T12:30:00Z",
  "durationMinutes": 145,
  "method": "qr"
}
```

**Events Published:**
- `visit.checked_out` → Platform

**Metrics Reported:**
- `active_visitors` (updated count)
- `avg_visit_duration` (minutes)

---

### 2.7 Get Visit QR Code

```http
GET /api/visits/{visit_id}/qr
GET /api/visitors/visits/qr/{visit_id}
```

**Response:** Binary PNG image (`image/png`)

---

## 3. Employees

**Base Path:** `/api/employees`

VMS fetches employee data respecting the **Data Mapping** configuration from the platform. The data source and actor type are determined by the company's mapping settings.

### 3.1 List Employees (Hosts)

```http
GET /api/employees?companyId={companyId}
```

**Data Source Logic:**

| Mapping Mode | Source | Description |
|--------------|--------|-------------|
| `platform` | Platform API | Fetches actors of the **mapped type** from Platform |
| `app` | Local VMS Database | Returns VMS's local employee records |

**Actor Type Mapping:**

The platform mapping configuration determines WHICH actor type to fetch. For example:

```json
{
  "actorMappings": {
    "employee": ["shift_supervisor"]
  }
}
```

This means VMS's "employee" concept maps to Platform's "shift_supervisor" actor type. VMS will fetch shift_supervisors, not employees.

**Response:**
```json
{
  "employees": [
    {
      "_id": "emp_12345",
      "employeeId": "EMP001",
      "employeeName": "Jane Smith",
      "email": "jane.smith@company.com",
      "phone": "+919876543210",
      "department": "Engineering",
      "designation": "Manager",
      "actorType": "shift_supervisor"
    }
  ],
  "source": "platform",
  "mappedType": "shift_supervisor"
}
```

### 3.2 Data Flow

```
VMS Request → _get_full_mapping_config() 
            → Fetch mapping from Platform API
            → Determine: mode (platform/app), actorType (mapped type)
            → If mode=platform: Call platform_client.get_actors_by_type(actorType)
            → If mode=app: Query local employees_collection
```

---

### 3.3 Register Employee

```http
POST /api/employees/register
Content-Type: multipart/form-data
```

Register a new employee with face images for biometric recognition.

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `employeeId` | string | Yes | Unique employee code (e.g., EMP001) |
| `employeeName` | string | Yes | Full name |
| `employeeEmail` | string | No | Email address |
| `employeeMobile` | string | No | Phone number (10 digits) |
| `department` | string | No | Department name |
| `front` | file | No | Front-facing photo |
| `side` | file | No | Side-facing photo |
| `left` | file | No | Left-facing photo (alt format) |
| `center` | file | No | Center-facing photo (alt format) |
| `right` | file | No | Right-facing photo (alt format) |

**Example Request:**
```bash
curl -X POST http://localhost:5001/api/employees/register \
  -H "Authorization: Bearer <token>" \
  -F "companyId=507f1f77bcf86cd799439011" \
  -F "employeeId=EMP001" \
  -F "employeeName=John Doe" \
  -F "front=@/path/to/front.jpg" \
  -F "side=@/path/to/side.jpg"
```

**Response:**
```json
{
  "message": "Employee registration successful",
  "_id": "507f1f77bcf86cd799439012",
  "employeeId": "EMP001",
  "embeddingStatus": { "Facenet512": "queued" },
  "hasBiometric": true,
  "syncedToPlatform": false
}
```

---

## 4. Dashboard

**Base Path:** `/api/dashboard`

### 4.1 Get Stats

```http
GET /api/dashboard/stats?companyId={companyId}
```

**Response:**
```json
{
  "currentVisitors": 12,
  "expectedToday": 25,
  "checkedInToday": 18,
  "checkedOutToday": 6,
  "recentActivity": [
    {
      "visitorName": "John Doe",
      "action": "Checked In",
      "time": "2024-12-13T10:05:00Z",
      "visitId": "visit_abc123",
      "hostName": "Jane Smith"
    }
  ]
}
```

---

### 4.2 Get Trends

```http
GET /api/dashboard/trends?companyId={companyId}
```

**Response:**
```json
{
  "trends": [
    { "date": "2024-12-07", "count": 15 },
    { "date": "2024-12-08", "count": 22 },
    { "date": "2024-12-09", "count": 18 },
    { "date": "2024-12-10", "count": 25 },
    { "date": "2024-12-11", "count": 20 },
    { "date": "2024-12-12", "count": 28 },
    { "date": "2024-12-13", "count": 12 }
  ]
}
```

---

### 4.3 Security Dashboard

```http
GET /api/dashboard/security?companyId={companyId}
```

**Response:**
```json
{
  "liveVisitors": [
    {
      "_id": "visit_abc123",
      "visitorName": "John Doe",
      "hostEmployeeName": "Jane Smith",
      "actualArrival": "2024-12-13T10:05:00Z",
      "hoursInside": 2.5
    }
  ],
  "liveCount": 12,
  "overstayed": [
    {
      "visitorName": "Bob Wilson",
      "hostName": "Alice Brown",
      "hoursInside": 11.2,
      "expected": 8,
      "visitId": "visit_xyz789"
    }
  ],
  "overstayedCount": 1,
  "pendingApprovals": [],
  "pendingCount": 0
}
```

---

### 4.4 Export Visits Report

```http
GET /api/dashboard/reports/visits?companyId={companyId}&format=json
GET /api/dashboard/reports/visits?companyId={companyId}&format=csv&startDate=2024-12-01&endDate=2024-12-13
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `startDate` | string | No | ISO 8601 date |
| `endDate` | string | No | ISO 8601 date |
| `format` | string | No | `json` (default) or `csv` |

**JSON Response:**
```json
{
  "count": 50,
  "data": [
    {
      "visitId": "visit_abc123",
      "visitorName": "John Doe",
      "hostName": "Jane Smith",
      "visitType": "guest",
      "purpose": "Meeting",
      "status": "checked_out",
      "expectedArrival": "2024-12-13T10:00:00Z",
      "actualArrival": "2024-12-13T10:05:00Z",
      "actualDeparture": "2024-12-13T12:30:00Z",
      "durationMinutes": 145,
      "checkInMethod": "face",
      "hasLaptop": true,
      "lunchIncluded": false,
      "vehicleNumber": "KA01AB1234",
      "ndaRequired": true,
      "ndaSigned": false
    }
  ]
}
```

---

### 4.5 Summary Report

```http
GET /api/dashboard/reports/summary?companyId={companyId}
```

**Response:**
```json
{
  "monthlyVisits": 250,
  "byVisitorType": [
    { "type": "guest", "count": 120 },
    { "type": "vendor", "count": 80 },
    { "type": "interview", "count": 50 }
  ],
  "byCheckInMethod": [
    { "method": "face", "count": 180 },
    { "method": "qr", "count": 50 },
    { "method": "manual", "count": 20 }
  ],
  "avgDurationMinutes": 145,
  "peakHours": [
    { "hour": 10, "count": 45 },
    { "hour": 11, "count": 38 },
    { "hour": 14, "count": 32 }
  ]
}
```

---

### 4.6 Approve Visit

```http
POST /api/dashboard/approvals/{visit_id}/approve
Content-Type: application/json
```

**Request Body:**
```json
{
  "approvedBy": "admin_user_id"
}
```

**Response:**
```json
{
  "message": "Visit approved"
}
```

---

### 4.7 Deny Visit

```http
POST /api/dashboard/approvals/{visit_id}/deny
Content-Type: application/json
```

**Request Body:**
```json
{
  "deniedBy": "admin_user_id",
  "reason": "Host unavailable on requested date"
}
```

**Response:**
```json
{
  "message": "Visit denied"
}
```

---

## 5. Analytics

**Base Path:** `/api/analytics`

### 5.1 Dashboard Analytics

```http
GET /api/analytics/dashboard?companyId={companyId}
```

**Response:**
```json
{
  "totalVisitors": 1500,
  "activeVisits": 12,
  "visitsToday": 25,
  "topZones": [
    { "zoneName": "Main Lobby", "count": 450 },
    { "zoneName": "Meeting Room A", "count": 320 },
    { "zoneName": "Cafeteria", "count": 280 }
  ]
}
```

---

### 5.2 Visitor Trends

```http
GET /api/analytics/trends?companyId={companyId}
```

Same response format as `/api/dashboard/trends`.

---

## 6. Settings

**Base Path:** `/api/settings`

### 6.1 Get Settings

```http
GET /api/settings?companyId={companyId}
```

**Response:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "autoCheckoutHours": 8,
  "requireVisitorName": true,
  "notifications": {
    "email": true,
    "sms": false,
    "whatsapp": false
  },
  "visitorTypes": ["guest", "vendor", "contractor", "interview", "vip"],
  "requireApproval": false,
  "badgeTemplate": "default",
  "devices": [
    {
      "_id": "device_001",
      "name": "Lobby Kiosk",
      "type": "kiosk",
      "status": "active"
    }
  ],
  "updatedAt": "2024-12-13T08:00:00Z"
}
```

---

### 6.2 Update Settings

```http
PUT /api/settings
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "autoCheckoutHours": 10,
  "requireApproval": true,
  "notifications": {
    "email": true,
    "sms": true,
    "whatsapp": false
  },
  "visitorTypes": ["guest", "vendor", "contractor", "interview", "vip", "government"]
}
```

**Response:**
```json
{
  "message": "Settings updated successfully"
}
```

---

### 6.3 Devices

#### List Devices

```http
GET /api/settings/devices?companyId={companyId}
```

#### Create Device

```http
POST /api/settings/devices
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "name": "Main Gate Turnstile",
  "type": "turnstile",
  "entityId": "zone_main_gate",
  "entityName": "Main Gate",
  "mode": "both"
}
```

| Field | Type | Options |
|-------|------|---------|
| `type` | string | `kiosk`, `tablet`, `turnstile`, `camera` |
| `mode` | string | `checkin`, `checkout`, `both` |

**Response:**
```json
{
  "id": "device_002",
  "message": "Device created successfully"
}
```

#### Update Device

```http
PUT /api/settings/devices/{device_id}
```

#### Delete Device

```http
DELETE /api/settings/devices/{device_id}
```

---

### 6.4 Locations

#### List Locations

```http
GET /api/settings/locations?companyId={companyId}
```

**Response:**
```json
[
  {
    "_id": "loc_001",
    "name": "Main Lobby",
    "type": "reception",
    "address": "123 Main Street",
    "timezone": "Asia/Kolkata",
    "platformEntityId": null,
    "status": "active"
  }
]
```

#### Create Location

```http
POST /api/settings/locations
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "name": "Building B Entrance",
  "type": "gate",
  "address": "456 Second Avenue",
  "timezone": "Asia/Kolkata"
}
```

| Field | Type | Options |
|-------|------|---------|
| `type` | string | `gate`, `reception`, `floor`, `building` |

---

## 7. Security

**Base Path:** `/api/security`

### 7.1 Get Watchlist

```http
GET /api/security/watchlist?companyId={companyId}
```

**Response:**
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
    "visitorName": "Flagged Visitor",
    "securityStatus": "blacklisted",
    "securityReason": "Security policy violation",
    "securityUpdatedAt": "2024-12-10T15:00:00Z"
  }
]
```

---

### 7.2 Add to Watchlist

```http
POST /api/security/watchlist/{visitor_id}
Content-Type: application/json
```

**Request Body:**
```json
{
  "status": "blacklisted",
  "reason": "Attempted unauthorized access",
  "updatedBy": "security_admin_id"
}
```

| Field | Options |
|-------|---------|
| `status` | `watchlist`, `blacklisted` |

---

### 7.3 Remove from Watchlist

```http
DELETE /api/security/watchlist/{visitor_id}
```

---

### 7.4 Check Security Status

```http
GET /api/security/check/{visitor_id}
```

**Response:**
```json
{
  "visitorId": "507f1f77bcf86cd799439012",
  "visitorName": "John Doe",
  "securityStatus": "clear",
  "reason": "",
  "isBlocked": false,
  "requiresAttention": false
}
```

---

### 7.5 Get Security Alerts

```http
GET /api/security/alerts?companyId={companyId}
```

**Response:**
```json
{
  "alerts": [
    {
      "type": "BLACKLISTED_ENTRY",
      "severity": "critical",
      "visitId": "visit_xyz789",
      "visitorName": "Blocked Person",
      "reason": "Blacklisted visitor checked in",
      "time": "2024-12-13T11:00:00Z"
    },
    {
      "type": "OVERSTAY",
      "severity": "warning",
      "visitId": "visit_abc123",
      "visitorName": "Long Stay Visitor",
      "reason": "Inside for 11.5 hours",
      "time": "2024-12-12T23:30:00Z"
    },
    {
      "type": "PENDING_APPROVAL",
      "severity": "info",
      "count": 3,
      "reason": "3 visit(s) awaiting approval"
    }
  ],
  "totalCount": 3,
  "criticalCount": 1,
  "warningCount": 1
}
```

**Alert Types:**

| Type | Severity | Description |
|------|----------|-------------|
| `BLACKLISTED_ENTRY` | critical | Blacklisted visitor is inside |
| `WATCHLIST_ENTRY` | warning | Watchlist visitor is inside |
| `OVERSTAY` | warning | Visitor inside > 10 hours |
| `PENDING_APPROVAL` | info | Visits awaiting approval |

---

## 8. Data Residency

**Base Path:** `/api`

These endpoints support the Bharatlytics Platform v3 Data Residency feature.

### Overview

VMS respects the company's **Data Mapping** configuration from the platform:

| Configuration | VMS Behavior |
|---------------|--------------|
| `residencyMode.actor_employee.mode = 'platform'` | Fetch employees from Platform |
| `residencyMode.actor_employee.mode = 'app'` | Use VMS's local employees (standalone) |
| `actorMappings.employee = ['shift_supervisor']` | Fetch Platform's `shift_supervisor` actors instead of `employee` |

### How VMS Fetches Configuration

```
1. Get app_id from local installations collection (stored by install webhook)
2. Call Platform API: GET /bharatlytics/integration/v1/installations/mapping?appId=X&companyId=Y
3. Parse response:
   - residencyMode.actor_employee.mode → determines source (platform/app)
   - actorMappings.employee → determines which actor type to fetch
```

### 8.1 Federated Query (Platform → VMS)

```http
POST /api/query/visitors
X-Platform-Token: <platform_token>
Content-Type: application/json
```

Called by the Platform when residency mode is `app` (federated).

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "filters": {
    "status": "active",
    "blacklisted": false,
    "visitorType": "guest"
  },
  "fields": ["name", "phone", "email", "embedding"],
  "limit": 100,
  "offset": 0
}
```

**Response:**
```json
{
  "actors": [
    {
      "id": "507f1f77bcf86cd799439012",
      "name": "John Doe",
      "phone": "+919876543210",
      "email": "john@example.com",
      "embedding": {
        "Facenet512": {
          "embeddingId": "emb_abc123",
          "status": "done",
          "model": "Facenet512"
        }
      }
    }
  ],
  "count": 1,
  "total": 150,
  "offset": 0,
  "limit": 100
}
```

---

### 8.2 Trigger Sync (VMS → Platform)

```http
POST /api/sync/visitors
Content-Type: application/json
```

Trigger manual sync when residency mode is `platform`.

**Request Body:**
```json
{
  "mode": "incremental",
  "since": "2024-12-12T00:00:00Z"
}
```

| Field | Options |
|-------|---------|
| `mode` | `full`, `incremental` |

**Response:**
```json
{
  "message": "Sync completed",
  "mode": "incremental",
  "total": 25,
  "synced": 24,
  "failed": 1
}
```

---

### 8.3 Sync Single Visitor

```http
POST /api/sync/visitors/{visitor_id}
```

**Response:**
```json
{
  "message": "Visitor synced successfully"
}
```

---

## 9. Webhooks

**Base Path:** `/api/webhooks`

These endpoints are called by the Bharatlytics Platform.

### 9.1 Install Webhook

```http
POST /api/webhooks/install
Content-Type: application/json
```

Called when the app is installed for a company.

**Request Body:**
```json
{
  "company_id": "507f1f77bcf86cd799439011",
  "installation_id": "install_abc123",
  "app_id": "app_bharatlytics_vms_366865a4",
  "credentials": {
    "client_id": "vms_client_abc",
    "client_secret": "secret_xyz...",
    "app_id": "app_bharatlytics_vms_366865a4"
  },
  "timestamp": "2024-12-13T10:00:00Z"
}
```

> **Note:** The `app_id` is the platform-generated identifier for this app. VMS stores this locally to fetch data mapping configurations from the platform.

**Response:**
```json
{
  "status": "success",
  "message": "Installation completed"
}
```

---

### 9.2 Uninstall Webhook

```http
POST /api/webhooks/uninstall
Content-Type: application/json
```

**Request Body:**
```json
{
  "company_id": "507f1f77bcf86cd799439011"
}
```

---

### 9.3 Residency Change Webhook

```http
POST /api/webhooks/residency-change
Content-Type: application/json
```

Called when company changes data residency mode.

**Request Body:**
```json
{
  "dataType": "actor_visitor",
  "oldMode": "app",
  "newMode": "platform",
  "company_id": "507f1f77bcf86cd799439011"
}
```

---

### 9.4 Data Update Webhook

```http
POST /api/webhooks/data-update
Content-Type: application/json
```

Called when platform data changes.

**Request Body:**
```json
{
  "type": "actor_updated",
  "entityType": "employee",
  "entityId": "emp_12345"
}
```

---

## 10. Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | BAD_REQUEST | Invalid request parameters |
| 401 | UNAUTHORIZED | Missing or invalid authentication |
| 403 | FORBIDDEN | Access denied (e.g., blacklisted visitor) |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Conflicting operation (e.g., overlapping visit) |
| 415 | UNSUPPORTED_MEDIA_TYPE | Invalid content type |
| 500 | INTERNAL_ERROR | Server error |

**Error Response Format:**
```json
{
  "error": "Error description message"
}
```

---

## 11. Data Models

### Visitor

```json
{
  "_id": "ObjectId",
  "companyId": "ObjectId",
  "visitorName": "string",
  "email": "string",
  "phone": "string (+91...)",
  "organization": "string",
  "visitorType": "guest|vendor|contractor|interview|vip|government",
  "idType": "pan_card|aadhar_card|driving_license|passport",
  "idNumber": "string",
  "status": "active|inactive",
  "blacklisted": "boolean",
  "blacklistReason": "string",
  "securityStatus": "clear|watchlist|blacklisted",
  "visitorImages": {
    "left": "GridFS ObjectId",
    "center": "GridFS ObjectId",
    "right": "GridFS ObjectId"
  },
  "visitorEmbeddings": {
    "Facenet512": {
      "embeddingId": "string",
      "status": "queued|processing|done|failed",
      "model": "string"
    }
  },
  "visits": ["visit_id_1", "visit_id_2"],
  "createdAt": "ISO8601",
  "lastUpdated": "ISO8601"
}
```

---

### Visit

```json
{
  "_id": "ObjectId",
  "companyId": "ObjectId",
  "visitorId": "ObjectId",
  "visitorName": "string",
  "hostEmployeeId": "string",
  "hostEmployeeName": "string",
  "visitType": "guest|vendor|contractor|interview|delivery|government",
  "purpose": "string",
  "status": "scheduled|checked_in|checked_out|cancelled",
  "approvalStatus": "pending|approved|denied",
  "requiresApproval": "boolean",
  
  "expectedArrival": "ISO8601",
  "expectedDeparture": "ISO8601",
  "actualArrival": "ISO8601",
  "actualDeparture": "ISO8601",
  "durationHours": "number",
  "durationMinutes": "number (calculated)",
  
  "locationId": "string",
  "locationName": "string",
  "accessAreas": ["zone_id_1", "zone_id_2"],
  
  "assets": {
    "laptop": "boolean",
    "camera": "boolean",
    "pendrive": "boolean",
    "mobile": "boolean",
    "bag": "boolean",
    "tools": "boolean",
    "details": "string"
  },
  
  "facilities": {
    "lunchIncluded": "boolean",
    "parkingRequired": "boolean",
    "wifiAccess": "boolean",
    "mealPreference": "veg|non-veg"
  },
  
  "vehicle": {
    "number": "string",
    "type": "car|bike|other",
    "driverName": "string"
  },
  
  "compliance": {
    "ndaRequired": "boolean",
    "ndaSigned": "boolean",
    "safetyBriefingRequired": "boolean",
    "safetyBriefingCompleted": "boolean",
    "escortRequired": "boolean",
    "idVerified": "boolean"
  },
  
  "checkInDeviceId": "string",
  "checkInDeviceName": "string",
  "checkInMethod": "face|qr|manual",
  "checkOutDeviceId": "string",
  "checkOutDeviceName": "string",
  "checkOutMethod": "face|qr|manual",
  
  "notes": "string",
  "createdAt": "ISO8601",
  "lastUpdated": "ISO8601"
}
```

---

### Device

```json
{
  "_id": "ObjectId",
  "companyId": "string",
  "name": "string",
  "type": "kiosk|tablet|turnstile|camera",
  "entityId": "string (Zone ID)",
  "entityName": "string",
  "mode": "checkin|checkout|both",
  "status": "active|inactive",
  "lastSeen": "ISO8601",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

### Location

```json
{
  "_id": "ObjectId",
  "companyId": "string",
  "name": "string",
  "type": "gate|reception|floor|building",
  "address": "string",
  "timezone": "string (IANA)",
  "platformEntityId": "ObjectId (Platform mapping)",
  "status": "active|inactive",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

## 12. Actor Registration (Platform Sync)

**Base Path:** `/api/actors`

VMS provides actor registration endpoints that **directly sync to Bharatlytics Platform**. Only actor types declared in the manifest can be synced.

### 12.1 Get Manifest Info

```http
GET /api/actors/manifest
```

Returns what actor types VMS can produce (per manifest).

**Response:**
```json
{
  "appId": "vms_app_v1",
  "canProduce": ["visitor", "employee"],
  "actorFields": {
    "visitor": ["name", "phone", "email", "photo", "company", "embedding"],
    "employee": ["name", "phone", "email", "photo", "embedding", "department", "code"]
  },
  "message": "Only these actor types can be synced to platform"
}
```

---

### 12.2 Create Employee (Direct to Platform)

```http
POST /api/actors/employee
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "name": "John Doe",
  "email": "john@company.com",
  "phone": "+919876543210",
  "department": "Engineering",
  "code": "EMP001",
  "photo": "base64_or_url",
  "embedding": "optional_base64_embedding"
}
```

**Response:**
```json
{
  "_id": "actor_id_on_platform",
  "name": "John Doe",
  "message": "Employee registered on platform",
  "syncedFields": ["name", "email", "phone", "department", "photo"],
  "hasBiometric": true,
  "source": "platform"
}
```

---

### 12.3 Create Visitor (Direct to Platform)

```http
POST /api/actors/visitor
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "name": "Jane Visitor",
  "email": "jane@example.com",
  "phone": "+919876543211",
  "company": "Acme Corp",
  "photo": "base64_or_url"
}
```

**Response:**
```json
{
  "_id": "actor_id_on_platform",
  "name": "Jane Visitor",
  "message": "Visitor registered on platform",
  "syncedFields": ["name", "email", "phone", "company", "photo"],
  "hasBiometric": false
}
```

---

### 12.4 List Actors by Type

```http
GET /api/actors/{actorType}?companyId={companyId}
```

**Example:** `GET /api/actors/employee?companyId=...`

**Response:**
```json
{
  "actors": [
    {
      "_id": "actor_123",
      "actorType": "employee",
      "attributes": {
        "name": "John Doe",
        "email": "john@company.com"
      }
    }
  ],
  "count": 1,
  "source": "platform"
}
```

---

### 12.5 Update Actor

```http
PATCH /api/actors/{actorType}/{actorId}
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "department": "New Department"
}
```

**Response:**
```json
{
  "_id": "actor_123",
  "message": "employee updated"
}
```

---

### 12.6 Delete Actor

```http
DELETE /api/actors/{actorType}/{actorId}
```

**Response:**
```json
{
  "message": "employee deleted"
}
```

---

## Platform Integration

When connected to Bharatlytics Platform, VMS integrates as follows:

| VMS Concept | Platform Mapping |
|-------------|------------------|
| Location | Entity (Zone/Building) |
| Visitor | Actor (visitor type) |
| Host Employee | Actor (employee type) |

**Events Published to Platform:**
- `visitor.registered`
- `visit.scheduled`
- `visit.checked_in`
- `visit.checked_out`

**Metrics Reported to Platform:**
- `active_visitors` (gauge)
- `visits_today` (counter)
- `avg_visit_duration` (gauge, minutes)

---

*End of API Reference*
