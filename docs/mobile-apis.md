# VMS Mobile App API Reference

**Version:** 2.0  
**Base URL:** `http://<vms-server>:5001`  
**Last Updated:** December 2024

> 📱 **For Mobile App Developers**  
> Complete API reference for building VMS mobile apps (kiosk, host notification, security patrol, admin app). The mobile app can perform all functions available in the web VMS.

---

## Table of Contents

1. [Authentication (SSO)](#1-authentication-sso)
2. [Visitors](#2-visitors)
3. [Visits](#3-visits)
4. [Employees (Hosts)](#4-employees-hosts)
5. [Dashboard & Stats](#5-dashboard--stats)
6. [Security](#6-security)
7. [Settings](#7-settings)
8. [Error Handling](#8-error-handling)
9. [Mobile Flows](#9-mobile-flows)
10. [SDK Helper](#10-sdk-helper)

---

## 1. Authentication (SSO)

VMS uses Bharatlytics Platform Single Sign-On. Users log in via the platform and receive a JWT token.

### 1.1 SSO Login Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Mobile App │────▶│  Platform Login  │────▶│  VMS Server │
│             │     │  (WebView/OAuth) │     │  (Token)    │
└─────────────┘     └──────────────────┘     └─────────────┘
```

**Step 1: Open Platform Login**

Open a WebView or in-app browser to:
```
https://<platform-url>/auth/login?app=vms&redirect_uri=<your-app-callback>
```

**Step 2: Handle Callback**

After successful login, platform redirects to your callback URL with token:
```
your-app://callback?token=<JWT_TOKEN>&companyId=<COMPANY_ID>&companyName=<COMPANY_NAME>
```

**Step 3: Store Token & Company Info**

```javascript
// Parse callback URL
const params = new URLSearchParams(callbackUrl.split('?')[1]);
const token = params.get('token');
const companyId = params.get('companyId');
const companyName = params.get('companyName');

// Store securely (use SecureStore/Keychain)
await SecureStore.setItemAsync('vms_token', token);
await SecureStore.setItemAsync('vms_company_id', companyId);
await SecureStore.setItemAsync('vms_company_name', companyName);
```

### 1.2 Using the Token

Include in all API requests:

```http
Authorization: Bearer <JWT_TOKEN>
```

### 1.3 Token Contents (Decoded JWT)

```json
{
  "sub": "user_abc123",
  "email": "user@company.com",
  "name": "John Doe",
  "companyId": "507f1f77bcf86cd799439011",
  "companyName": "Acme Corp",
  "role": "admin",
  "exp": 1702641600
}
```

| Field | Description |
|-------|-------------|
| `companyId` | Use this for all API calls requiring companyId |
| `companyName` | Display in app header |
| `role` | User's role (admin, security, receptionist) |
| `exp` | Token expiration (Unix timestamp) |

### 1.4 Check Token Validity

```javascript
function isTokenValid(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
```

### 1.5 Refresh Token

If token expires, redirect user back to platform login.

---

## 2. Visitors

**Base Path:** `/api/visitors`

### 2.1 List All Visitors

```http
GET /api/visitors?companyId={companyId}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | ✅ | Company ID from SSO token |
| `status` | string | ❌ | `active`, `inactive` |
| `phone` | string | ❌ | Search by phone number |

**Response:**
```json
{
  "visitors": [
    {
      "_id": "visitor_abc123",
      "visitorName": "John Doe",
      "email": "john@example.com",
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

### 2.2 Search Visitor by Phone

```http
GET /api/visitors?companyId={companyId}&phone=+919876543210
```

Use this to check if a returning visitor is already registered.

---

### 2.3 Get Single Visitor

```http
GET /api/visitors/{visitor_id}
```

**Response:**
```json
{
  "_id": "visitor_abc123",
  "visitorName": "John Doe",
  "email": "john@example.com",
  "phone": "+919876543210",
  "organization": "Acme Corp",
  "visitorType": "guest",
  "status": "active",
  "blacklisted": false,
  "visitorImages": {
    "left": "img_left_123",
    "center": "img_center_123",
    "right": "img_right_123"
  },
  "visits": ["visit_001", "visit_002"],
  "createdAt": "2024-12-10T09:00:00Z"
}
```

---

### 2.4 Register New Visitor

```http
POST /api/visitors/register
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | string | ✅ | Company ID |
| `visitorName` | string | ✅ | Full name |
| `phone` | string | ✅ | Phone (+919876543210) |
| `hostEmployeeId` | string | ✅ | Host employee ID |
| `email` | string | ❌ | Email address |
| `visitorType` | string | ❌ | `guest`, `vendor`, `contractor`, `interview`, `vip` |
| `organization` | string | ❌ | Visitor's company |
| `purpose` | string | ❌ | Purpose of visit |
| `idType` | string | ❌ | `pan_card`, `aadhar_card`, `driving_license`, `passport` |
| `idNumber` | string | ❌ | ID document number |
| `left` | file | ❌ | Left-facing photo (JPEG) |
| `center` | file | ❌ | Front-facing photo (JPEG) - **Recommended** |
| `right` | file | ❌ | Right-facing photo (JPEG) |

**Example (React Native):**
```javascript
const formData = new FormData();
formData.append('companyId', companyId);
formData.append('visitorName', 'John Doe');
formData.append('phone', '+919876543210');
formData.append('hostEmployeeId', selectedHost._id);
formData.append('visitorType', 'guest');

// Add photo from camera
if (photoUri) {
  formData.append('center', {
    uri: photoUri,
    type: 'image/jpeg',
    name: 'photo.jpg'
  });
}

const response = await fetch(`${BASE_URL}/api/visitors/register`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

**Response:**
```json
{
  "message": "Visitor registration successful",
  "_id": "visitor_abc123",
  "visit": {
    "_id": "visit_xyz789",
    "status": "checked_in"
  }
}
```

---

### 2.5 Update Visitor

```http
PATCH /api/visitors/update
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Required |
|-------|------|----------|
| `visitorId` | string | ✅ |
| `visitorName` | string | ❌ |
| `email` | string | ❌ |
| `phone` | string | ❌ |
| `organization` | string | ❌ |

**Response:**
```json
{
  "message": "Visitor updated successfully"
}
```

---

### 2.6 Get Visitor Image

```http
GET /api/visitors/images/{image_id}
```

**Response:** Binary JPEG image (`image/jpeg`)

**Usage (React Native):**
```javascript
<Image 
  source={{ 
    uri: `${BASE_URL}/api/visitors/images/${imageId}`,
    headers: { Authorization: `Bearer ${token}` }
  }}
  style={{ width: 100, height: 100, borderRadius: 50 }}
/>
```

---

### 2.7 Blacklist Visitor

```http
POST /api/visitors/blacklist
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "visitor_abc123",
  "reason": "Security violation"
}
```

---

### 2.8 Unblacklist Visitor

```http
POST /api/visitors/unblacklist
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "visitor_abc123"
}
```

---

## 3. Visits

**Base Path:** `/api/visits`

### 3.1 List Visits

```http
GET /api/visits?companyId={companyId}&status={status}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | ✅ | Company ID |
| `status` | string | ❌ | `scheduled`, `checked_in`, `checked_out`, `cancelled` |

**Response:**
```json
[
  {
    "_id": "visit_001",
    "visitorId": "visitor_abc123",
    "visitorName": "John Doe",
    "hostEmployeeId": "emp_001",
    "hostEmployeeName": "Jane Smith",
    "visitType": "guest",
    "purpose": "Business Meeting",
    "status": "scheduled",
    "expectedArrival": "2024-12-14T10:00:00Z",
    "expectedDeparture": "2024-12-14T12:00:00Z"
  }
]
```

---

### 3.2 Get Single Visit

```http
GET /api/visits/{visit_id}
```

---

### 3.3 Schedule New Visit

```http
POST /api/visits
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "visitorId": "visitor_abc123",
  "hostEmployeeId": "emp_001",
  "visitType": "guest",
  "purpose": "Business Meeting",
  "expectedArrival": "2024-12-15T10:00:00Z",
  "expectedDeparture": "2024-12-15T12:00:00Z",
  "durationHours": 2,
  "requiresApproval": false,
  "assets": {
    "laptop": true,
    "mobile": true
  },
  "facilities": {
    "wifiAccess": true,
    "parkingRequired": false
  },
  "vehicleNumber": "KA01AB1234",
  "notes": "Guest WiFi needed"
}
```

**Response:**
```json
{
  "id": "visit_xyz789",
  "message": "Visit scheduled"
}
```

---

### 3.4 Check In

```http
POST /api/visits/{visit_id}/check-in
Content-Type: application/json
```

**Request Body:**
```json
{
  "method": "face",
  "deviceId": "mobile_kiosk_01",
  "deviceName": "Reception iPad"
}
```

| Field | Type | Options |
|-------|------|---------|
| `method` | string | `face`, `qr`, `manual` |

**Response:**
```json
{
  "message": "Checked in successfully",
  "checkInTime": "2024-12-14T10:05:00Z",
  "method": "face"
}
```

---

### 3.5 Check Out

```http
POST /api/visits/{visit_id}/check-out
Content-Type: application/json
```

**Request Body:**
```json
{
  "method": "qr",
  "deviceId": "mobile_kiosk_01"
}
```

**Response:**
```json
{
  "message": "Checked out successfully",
  "checkOutTime": "2024-12-14T15:30:00Z",
  "durationMinutes": 325,
  "method": "qr"
}
```

---

### 3.6 Get Visit QR Code

```http
GET /api/visits/{visit_id}/qr
```

**Response:** Binary PNG image (`image/png`)

---

### 3.7 Cancel Visit

```http
DELETE /api/visits/{visit_id}
```

---

## 4. Employees (Hosts)

**Base Path:** `/api/employees`

### 4.1 List Employees

```http
GET /api/employees?companyId={companyId}
```

Use this to populate "Select Host" dropdown in your app.

> 💡 **How it works:** VMS automatically fetches employees based on admin configuration. It may fetch from the central platform OR from local VMS database - your app doesn't need to worry about this. Just call the endpoint with companyId.

**Response:**
```json
{
  "employees": [
    {
      "_id": "emp_001",
      "employeeId": "EMP001",
      "employeeName": "Jane Smith",
      "email": "jane@company.com",
      "phone": "+919876543210",
      "department": "Engineering",
      "designation": "Manager"
    },
    {
      "_id": "emp_002",
      "employeeId": "EMP002",
      "employeeName": "Bob Wilson",
      "email": "bob@company.com",
      "department": "HR"
    }
  ]
}
```

> ✅ **Same as Web:** The mobile app gets the same employee list as the web VMS dashboard. The data source (platform or local) is configured by admin in the web interface.

---

## 5. Dashboard & Stats

**Base Path:** `/api/dashboard`

### 5.1 Get Dashboard Stats

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
      "time": "2024-12-14T10:05:00Z",
      "visitId": "visit_001",
      "hostName": "Jane Smith"
    }
  ]
}
```

---

### 5.2 Get Visitor Trends (7 days)

```http
GET /api/dashboard/trends?companyId={companyId}
```

**Response:**
```json
{
  "trends": [
    { "date": "2024-12-08", "count": 15 },
    { "date": "2024-12-09", "count": 22 },
    { "date": "2024-12-10", "count": 18 },
    { "date": "2024-12-11", "count": 25 },
    { "date": "2024-12-12", "count": 20 },
    { "date": "2024-12-13", "count": 28 },
    { "date": "2024-12-14", "count": 12 }
  ]
}
```

---

### 5.3 Security Dashboard

```http
GET /api/dashboard/security?companyId={companyId}
```

**Response:**
```json
{
  "liveVisitors": [
    {
      "_id": "visit_001",
      "visitorName": "John Doe",
      "hostEmployeeName": "Jane Smith",
      "actualArrival": "2024-12-14T10:05:00Z",
      "hoursInside": 2.5
    }
  ],
  "liveCount": 12,
  "overstayed": [],
  "overstayedCount": 0,
  "pendingApprovals": [],
  "pendingCount": 0
}
```

---

### 5.4 Summary Report

```http
GET /api/dashboard/reports/summary?companyId={companyId}
```

**Response:**
```json
{
  "monthlyVisits": 250,
  "byVisitorType": [
    { "type": "guest", "count": 120 },
    { "type": "vendor", "count": 80 }
  ],
  "byCheckInMethod": [
    { "method": "face", "count": 180 },
    { "method": "qr", "count": 50 }
  ],
  "avgDurationMinutes": 145,
  "peakHours": [
    { "hour": 10, "count": 45 },
    { "hour": 11, "count": 38 }
  ]
}
```

---

### 5.5 Approve/Deny Visits

```http
POST /api/dashboard/approvals/{visit_id}/approve
POST /api/dashboard/approvals/{visit_id}/deny
Content-Type: application/json
```

**Request Body (Deny):**
```json
{
  "deniedBy": "user_id",
  "reason": "Host unavailable"
}
```

---

## 6. Security

**Base Path:** `/api/security`

### 6.1 Get Watchlist

```http
GET /api/security/watchlist?companyId={companyId}
```

**Response:**
```json
[
  {
    "_id": "visitor_xyz",
    "visitorName": "Flagged Person",
    "securityStatus": "blacklisted",
    "securityReason": "Policy violation",
    "securityUpdatedAt": "2024-12-10T15:00:00Z"
  }
]
```

---

### 6.2 Get Security Alerts

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
      "visitorName": "Blocked Person",
      "reason": "Blacklisted visitor attempted entry"
    },
    {
      "type": "OVERSTAY",
      "severity": "warning",
      "visitorName": "Long Stay Visitor",
      "reason": "Inside for 11.5 hours"
    }
  ],
  "totalCount": 2,
  "criticalCount": 1
}
```

---

### 6.3 Check Visitor Security Status

```http
GET /api/security/check/{visitor_id}
```

Use before check-in to verify visitor is not blocked.

**Response:**
```json
{
  "visitorId": "visitor_abc123",
  "visitorName": "John Doe",
  "securityStatus": "clear",
  "isBlocked": false,
  "requiresAttention": false
}
```

---

## 7. Settings

**Base Path:** `/api/settings`

### 7.1 Get Company Settings

```http
GET /api/settings?companyId={companyId}
```

**Response:**
```json
{
  "companyId": "507f1f77bcf86cd799439011",
  "autoCheckoutHours": 8,
  "requireApproval": false,
  "visitorTypes": ["guest", "vendor", "contractor", "interview", "vip"],
  "notifications": {
    "email": true,
    "sms": false
  }
}
```

---

### 7.2 Get Locations

```http
GET /api/settings/locations?companyId={companyId}
```

**Response:**
```json
[
  {
    "_id": "loc_001",
    "name": "Main Lobby",
    "type": "reception"
  },
  {
    "_id": "loc_002",
    "name": "Building B Gate",
    "type": "gate"
  }
]
```

---

### 7.3 Get Devices

```http
GET /api/settings/devices?companyId={companyId}
```

**Response:**
```json
[
  {
    "_id": "device_001",
    "name": "Lobby Kiosk",
    "type": "kiosk",
    "status": "active"
  }
]
```

---

## 8. Error Handling

All errors return JSON:

```json
{
  "error": "Error description"
}
```

**HTTP Status Codes:**

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | ✅ |
| 400 | Bad request | Check required fields |
| 401 | Unauthorized | Token expired - re-login |
| 403 | Forbidden | User doesn't have permission OR visitor is blacklisted |
| 404 | Not found | Resource doesn't exist |
| 409 | Conflict | Duplicate or conflicting data |
| 500 | Server error | Retry later |

---

## 9. Mobile Flows

### Flow 1: New Walk-in Visitor

```
1. User enters phone number
2. GET /api/visitors?phone=X         → Check if registered
3. If NOT found:
   a. GET /api/employees             → Load host dropdown
   b. Capture photo
   c. POST /api/visitors/register    → Register + auto check-in
4. If found:
   a. GET /api/security/check/{id}   → Verify not blacklisted
   b. POST /api/visits               → Schedule visit
   c. POST /api/visits/{id}/check-in → Check in
```

### Flow 2: Pre-Scheduled Visitor

```
1. Visitor scans QR code (contains visit_id)
2. GET /api/visits/{visit_id}        → Get visit details
3. GET /api/security/check/{visitor_id} → Security check
4. POST /api/visits/{id}/check-in    → Check in
5. Display badge / print pass
```

### Flow 3: Check Out

```
1. Visitor scans QR or face verified
2. GET /api/visits?status=checked_in → Find active visit
3. POST /api/visits/{id}/check-out   → Check out
4. Show "Thank you" screen
```

### Flow 4: Security Patrol

```
1. GET /api/dashboard/security       → Get live visitors
2. GET /api/security/alerts          → Get active alerts
3. For suspicious visitor:
   a. POST /api/visitors/blacklist   → Block visitor
   b. POST /api/visits/{id}/check-out → Force checkout
```

---

## 10. SDK Helper

### Complete React Native / JavaScript SDK

```javascript
class VMSMobileClient {
  constructor(baseUrl, token, companyId) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.companyId = companyId;
  }

  // ─────────────────────────────────────
  // Core Request Method
  // ─────────────────────────────────────
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    // Handle image responses
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('image')) {
      return response.blob();
    }
    
    return response.json();
  }

  // ─────────────────────────────────────
  // Visitors
  // ─────────────────────────────────────
  getVisitors(filters = {}) {
    const params = new URLSearchParams({ companyId: this.companyId, ...filters });
    return this.request(`/api/visitors?${params}`);
  }

  getVisitor(visitorId) {
    return this.request(`/api/visitors/${visitorId}`);
  }

  searchByPhone(phone) {
    return this.request(`/api/visitors?companyId=${this.companyId}&phone=${encodeURIComponent(phone)}`);
  }

  async registerVisitor(data, photoUri = null) {
    const formData = new FormData();
    formData.append('companyId', this.companyId);
    formData.append('visitorName', data.name);
    formData.append('phone', data.phone);
    formData.append('hostEmployeeId', data.hostId);
    
    if (data.email) formData.append('email', data.email);
    if (data.organization) formData.append('organization', data.organization);
    if (data.visitorType) formData.append('visitorType', data.visitorType);
    if (data.purpose) formData.append('purpose', data.purpose);
    
    if (photoUri) {
      formData.append('center', {
        uri: photoUri,
        type: 'image/jpeg',
        name: 'photo.jpg'
      });
    }

    const response = await fetch(`${this.baseUrl}/api/visitors/register`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }
    return response.json();
  }

  blacklistVisitor(visitorId, reason) {
    return this.request('/api/visitors/blacklist', {
      method: 'POST',
      body: JSON.stringify({ visitorId, reason })
    });
  }

  // ─────────────────────────────────────
  // Employees
  // ─────────────────────────────────────
  getEmployees() {
    return this.request(`/api/employees?companyId=${this.companyId}`);
  }

  // ─────────────────────────────────────
  // Visits
  // ─────────────────────────────────────
  getVisits(status = null) {
    let url = `/api/visits?companyId=${this.companyId}`;
    if (status) url += `&status=${status}`;
    return this.request(url);
  }

  getVisit(visitId) {
    return this.request(`/api/visits/${visitId}`);
  }

  scheduleVisit(data) {
    return this.request('/api/visits', {
      method: 'POST',
      body: JSON.stringify({ companyId: this.companyId, ...data })
    });
  }

  checkIn(visitId, method = 'manual', deviceId = null) {
    return this.request(`/api/visits/${visitId}/check-in`, {
      method: 'POST',
      body: JSON.stringify({ method, deviceId })
    });
  }

  checkOut(visitId, method = 'manual', deviceId = null) {
    return this.request(`/api/visits/${visitId}/check-out`, {
      method: 'POST',
      body: JSON.stringify({ method, deviceId })
    });
  }

  getVisitQRUrl(visitId) {
    return `${this.baseUrl}/api/visits/${visitId}/qr`;
  }

  // ─────────────────────────────────────
  // Dashboard
  // ─────────────────────────────────────
  getStats() {
    return this.request(`/api/dashboard/stats?companyId=${this.companyId}`);
  }

  getTrends() {
    return this.request(`/api/dashboard/trends?companyId=${this.companyId}`);
  }

  getSecurityDashboard() {
    return this.request(`/api/dashboard/security?companyId=${this.companyId}`);
  }

  // ─────────────────────────────────────
  // Security
  // ─────────────────────────────────────
  getWatchlist() {
    return this.request(`/api/security/watchlist?companyId=${this.companyId}`);
  }

  getAlerts() {
    return this.request(`/api/security/alerts?companyId=${this.companyId}`);
  }

  checkVisitorSecurity(visitorId) {
    return this.request(`/api/security/check/${visitorId}`);
  }

  // ─────────────────────────────────────
  // Settings
  // ─────────────────────────────────────
  getSettings() {
    return this.request(`/api/settings?companyId=${this.companyId}`);
  }

  getLocations() {
    return this.request(`/api/settings/locations?companyId=${this.companyId}`);
  }
}

// ─────────────────────────────────────
// Usage Example
// ─────────────────────────────────────
const vms = new VMSMobileClient(
  'http://192.168.1.100:5001',
  userToken,      // from SSO login
  companyId       // from SSO callback
);

// Get employees for dropdown
const { employees } = await vms.getEmployees();

// Check if visitor exists
const { visitors } = await vms.searchByPhone('+919876543210');

// Register new visitor
const result = await vms.registerVisitor({
  name: 'John Doe',
  phone: '+919876543210',
  hostId: employees[0]._id,
  visitorType: 'guest'
}, photoUri);

// Check in
await vms.checkIn(result.visit._id, 'face', 'mobile_001');

// Get dashboard stats
const stats = await vms.getStats();
console.log(`Currently inside: ${stats.currentVisitors}`);
```

---

## Quick Reference

| Action | Endpoint | Method |
|--------|----------|--------|
| **Visitors** | | |
| List visitors | `/api/visitors?companyId=X` | GET |
| Search by phone | `/api/visitors?companyId=X&phone=Y` | GET |
| Register visitor | `/api/visitors/register` | POST |
| Update visitor | `/api/visitors/update` | PATCH |
| Blacklist | `/api/visitors/blacklist` | POST |
| Get image | `/api/visitors/images/{id}` | GET |
| **Visits** | | |
| List visits | `/api/visits?companyId=X` | GET |
| Schedule visit | `/api/visits` | POST |
| Check in | `/api/visits/{id}/check-in` | POST |
| Check out | `/api/visits/{id}/check-out` | POST |
| Get QR | `/api/visits/{id}/qr` | GET |
| **Employees** | | |
| List employees | `/api/employees?companyId=X` | GET |
| **Dashboard** | | |
| Stats | `/api/dashboard/stats?companyId=X` | GET |
| Trends | `/api/dashboard/trends?companyId=X` | GET |
| Security | `/api/dashboard/security?companyId=X` | GET |
| **Security** | | |
| Watchlist | `/api/security/watchlist?companyId=X` | GET |
| Alerts | `/api/security/alerts?companyId=X` | GET |
| Check visitor | `/api/security/check/{id}` | GET |

---

*For questions, contact the VMS backend team.*
