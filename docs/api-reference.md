# VMS API Reference - Enterprise Edition

**Version:** 4.0  
**Base URL:** `http://localhost:5001/api`  
**Last Updated:** January 2026

---

## Authentication

VMS supports multiple authentication methods for different client types:

### Browser-Based Access (Dashboard)

| Method | Header | Description |
|--------|--------|-------------|
| Session Cookie | `Cookie: session=...` | Automatic after login |
| Platform SSO | Query parameter redirect | From main platform |

### API Access (Mobile/Server)

| Method | Header | Description |
|--------|--------|-------------|
| Bearer Token | `Authorization: Bearer <JWT>` | VMS JWT token |
| Platform Token | `X-Platform-Token: <token>` | Platform-to-App calls |

---

## Mobile/Android Authentication (SSO)

### Overview

Mobile apps authenticate using a two-step SSO flow:
1. Login to main platform → Get platform JWT
2. Exchange platform JWT for VMS JWT → Access VMS APIs

This is the **same SSO mechanism** used by the dashboard, ensuring consistency and security.

### Authentication Flow

```
┌─────────────┐
│ Mobile App  │
└──────┬──────┘
       │
       │ 1. POST /bharatlytics/v1/users/login
       │    {email, password}
       ▼
┌──────────────────────┐
│  Main Platform       │
│  (Port 5000)         │
└──────┬───────────────┘
       │
       │ 2. Returns Platform JWT
       │    {token, user, context}
       ▼
┌─────────────┐
│ Mobile App  │ Stores platform token
└──────┬──────┘
       │
       │ 3. POST /auth/platform-sso
       │    {token, companyId}
       ▼
┌──────────────────────┐
│  VMS Application     │
│  (Port 5001)         │
└──────┬───────────────┘
       │
       │ 4. Returns VMS JWT
       │    {vmsToken, expiresIn, ...}
       ▼
┌─────────────┐
│ Mobile App  │ Stores VMS token
└──────┬──────┘
       │
       │ 5. API Requests
       │    Authorization: Bearer <vms_token>
       ▼
┌──────────────────────┐
│  VMS APIs            │
└──────────────────────┘
```

### Step 1: Platform Login

**Endpoint**: `POST http://localhost:5000/bharatlytics/v1/users/login`

**Request**:
```json
{
  "email": "user@company.com",
  "password": "your-password"
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "user_id",
    "email": "user@company.com",
    "roles": ["user"]
  },
  "context": {
    "companyId": "company_id",
    "companyName": "Company Name",
    "companyLogo": "https://..."
  }
}
```

**Save**: `token` (platform JWT) and `context.companyId`

### Step 2: VMS SSO Authentication

**Endpoint**: `POST /auth/platform-sso`

**Request**:
```json
{
  "token": "<platform_jwt_from_step_1>",
  "companyId": "<company_id_from_step_1>"
}
```

**Response**:
```json
{
  "message": "Platform SSO successful",
  "vmsToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 86400,
  "companyId": "company_id",
  "company": {
    "id": "company_id",
    "name": "Company Name",
    "logo": "https://..."
  },
  "user": {
    "id": "user_id",
    "email": "user@company.com",
    "name": "User Name"
  }
}
```

**Save**: `vmsToken` for all subsequent VMS API calls

### Step 3: Using VMS APIs

Include the VMS token in the `Authorization` header for all API requests:

```http
GET /api/visitors?companyId=<company_id>
Authorization: Bearer <vms_token>
```

```http
POST /api/visitors/register
Authorization: Bearer <vms_token>
Content-Type: multipart/form-data
```

### Android/Kotlin Example

```kotlin
// 1. Login to Platform
val platformResponse = platformApi.login(
    LoginRequest(email = "user@company.com", password = "password")
)
val platformToken = platformResponse.token
val companyId = platformResponse.context.companyId

// 2. Get VMS Token
val vmsResponse = vmsApi.platformSso(
    SsoRequest(token = platformToken, companyId = companyId)
)
val vmsToken = vmsResponse.vmsToken

// 3. Use VMS APIs
val visitors = vmsApi.getVisitors(
    companyId = companyId,
    authorization = "Bearer $vmsToken"
)
```

### Token Management

**Token Expiration**:
- VMS tokens expire after 24 hours (86400 seconds)
- Check `expiresIn` field in SSO response
- Implement token refresh or re-authentication before expiry

**Secure Storage** (Android):
```kotlin
// Use EncryptedSharedPreferences
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val sharedPreferences = EncryptedSharedPreferences.create(
    context,
    "vms_auth",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

sharedPreferences.edit()
    .putString("vms_token", vmsToken)
    .putLong("token_expiry", System.currentTimeMillis() + (expiresIn * 1000))
    .apply()
```

### Error Handling

| Error | Code | Response | Action |
|-------|------|----------|--------|
| Invalid credentials | 401 | `{"message": "Invalid email or password"}` | Verify credentials |
| Token expired | 401 | `{"error": "SSO token expired"}` | Re-login to platform |
| Invalid SSO token | 401 | `{"error": "Invalid SSO token"}` | Re-login to platform |
| Missing token | 401 | `{"error": "Authentication required"}` | Provide VMS token |

### Security Best Practices

> [!IMPORTANT]
> **Production Deployment**
> 
> - ✅ Use HTTPS for all API calls
> - ✅ Store tokens in secure storage (Android Keystore/EncryptedSharedPreferences)
> - ✅ Implement certificate pinning
> - ✅ Clear tokens on logout
> - ✅ Handle token expiration gracefully
> - ✅ Never log tokens in production


---

## Table of Contents

0. [Authentication](#authentication)
   - [Browser-Based Access](#browser-based-access-dashboard)
   - [API Access (Mobile/Server)](#api-access-mobileserver)
   - [Mobile/Android SSO](#mobileandroid-authentication-sso)
1. [Visitors](#1-visitors)
2. [Visits](#2-visits)
3. [Employees](#3-employees)
4. [Locations](#4-locations)
5. [Dashboard](#5-dashboard)
6. [Analytics](#6-analytics)
7. [Settings](#7-settings)
8. [Security](#8-security)
9. [Data Residency & Mapping](#9-data-residency--mapping)
10. [Webhooks](#10-webhooks)
11. [Error Codes](#11-error-codes)
12. [Data Models](#12-data-models)

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

### 1.2 Get Visitor

```http
GET /api/visitors/{visitor_id}
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `visitor_id` | string | Yes | Visitor ObjectId |

**Response:**
```json
{
  "visitor": {
    "_id": "507f1f77bcf86cd799439011",
    "visitorName": "John Doe",
    "email": "john.doe@example.com",
    "phone": "+919876543210",
    "organization": "Acme Corp",
    "visitorType": "guest",
    "status": "active",
    "blacklisted": false,
    "visitorEmbeddings": {
      "buffalo_l": {
        "status": "done",
        "downloadUrl": "http://localhost:5001/api/visitors/embeddings/emb123"
      }
    },
    "createdAt": "2024-12-10T09:00:00Z"
  }
}
```

---

### 1.3 Register Visitor

```http
POST /api/visitors/register
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `visitorName` | string | Yes | Full name of the visitor |
| `phone` | string | Yes | Phone number (10 digits, E.164 format preferred) |
| `hostEmployeeId` | string | Yes | Host employee ID (ObjectId or employeeId code) |
| `email` | string | No | Email address (validated format) |
| `visitorType` | string | No | `general`, `guest`, `vendor`, `contractor`, `interview`, `vip` (default: `general`) |
| `organization` | string | No | Visitor's company/organization name |
| `purpose` | string | No | Purpose of the visit |
| `idType` | string | No | ID document type: `pan_card`, `aadhar_card`, `driving_license`, `passport` |
| `idNumber` | string | No | ID document number |
| `status` | string | No | Initial status: `active` (default), `inactive` |
| `blacklisted` | string | No | Set to `true` to pre-blacklist visitor |
| `blacklistReason` | string | No | Reason for blacklisting (if applicable) |

**Face Image Fields (for biometric registration):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `left` | file | No | Left-facing photo (JPEG/PNG, max 5MB) |
| `center` | file | No | Center/front-facing photo |
| `right` | file | No | Right-facing photo |

> [!TIP]
> **Multi-pose Registration**: Providing all 3 face images (left, center, right) enables higher accuracy face recognition by generating averaged embeddings.

**ID Document Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pan_card` | file | No | PAN card image |
| `aadhar_card` | file | No | Aadhaar card image |
| `driving_license` | file | No | Driving license image |
| `passport` | file | No | Passport image |

**Pre-computed Embedding Fields (advanced):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `embeddingAttached` | string | No | Set to `true` if uploading pre-computed embedding |
| `embeddingVersion` | string | Conditional | Model name: `buffalo_l`, `facenet`, `arcface`, `vggface`, `mobile_facenet_v1` |
| `embedding` | file | Conditional | Pre-computed embedding file (.npy or .pkl format) |

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
  -F "organization=Acme Corp" \
  -F "purpose=Business Meeting" \
  -F "idType=aadhar_card" \
  -F "idNumber=1234-5678-9012" \
  -F "center=@/path/to/center.jpg" \
  -F "left=@/path/to/left.jpg" \
  -F "right=@/path/to/right.jpg"
```

**Success Response (201 Created):**
```json
{
  "message": "Visitor registration successful",
  "_id": "507f1f77bcf86cd799439012",
  "embeddingStatus": {
    "buffalo_l": "queued",
    "facenet": "queued"
  },
  "hasBiometric": true,
  "dataResidency": "app",
  "federatedAccess": "/api/query/visitors"
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Success message |
| `_id` | string | Created visitor's ObjectId |
| `embeddingStatus` | object | Status per model: `queued`, `started`, `done`, `failed` |
| `hasBiometric` | boolean | Whether face images were provided |
| `dataResidency` | string | Where data is stored: `app` (VMS local) |
| `federatedAccess` | string | API path for cross-app queries |

**Existing Visitor Response (200 OK):**
```json
{
  "message": "Visitor already registered with this phone number",
  "_id": "507f1f77bcf86cd799439011",
  "visitorId": "507f1f77bcf86cd799439011",
  "visitorName": "John Doe",
  "existing": true
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

### 1.6 Delete Visitor

```http
DELETE /api/visitors/delete
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "507f1f77bcf86cd799439012"
}
```

**Behavior:**
- Performs a **soft delete** (sets `status` to `deleted`)
- Automatically **cancels all scheduled visits** for this visitor
- Publishes `visitor.deleted` event

**Response:**
```json
{
  "message": "Visitor deleted successfully"
}
```

> [!NOTE]
> Soft-deleted visitors are kept in the database for audit purposes. They will not appear in regular listing queries that filter by `status: 'active'`.

---

### 1.7 Get Visitor Image

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

### 2.5 Update Visit

```http
PATCH /api/visits/{visit_id}
Content-Type: application/json
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `visit_id` | string | Yes | Visit ObjectId |

**Request Body (all fields optional):**
```json
{
  "purpose": "Updated purpose",
  "expectedArrival": "2024-12-13T11:00:00Z",
  "expectedDeparture": "2024-12-13T14:00:00Z",
  "hostEmployeeId": "new_host_id",
  "locationId": "location_xyz",
  "notes": "Updated notes",
  "vehicleNumber": "KA01CD5678",
  "assets": {
    "laptop": false,
    "camera": true
  },
  "facilities": {
    "parkingRequired": true
  },
  "accessAreas": ["zone_lab"]
}
```

**Allowed Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `purpose` | string | Visit purpose |
| `expectedArrival` | datetime | Scheduled arrival time |
| `expectedDeparture` | datetime | Scheduled departure time |
| `durationHours` | number | Expected duration |
| `hostEmployeeId` | string | New host employee ID |
| `locationId` | string | Location/zone ID |
| `locationName` | string | Location name |
| `notes` | string | Additional notes |
| `vehicleNumber` | string | Vehicle registration |
| `vehicleType` | string | Vehicle type |
| `driverName` | string | Driver name |
| `requiresApproval` | boolean | Approval requirement |
| `approvalStatus` | string | `pending`, `approved`, `rejected` |
| `assets` | object | Asset flags (laptop, camera, etc.) |
| `facilities` | object | Facility requirements |
| `compliance` | object | Compliance flags |
| `vehicle` | object | Vehicle details |
| `accessAreas` | array | List of allowed zones |

> [!IMPORTANT]
> Visits can only be updated when in `scheduled` or `pending` status. Once checked-in, visits cannot be modified.

**Response:**
```json
{
  "message": "Visit updated successfully",
  "visit": {
    "_id": "visit_abc123",
    "purpose": "Updated purpose",
    "expectedArrival": "2024-12-13T11:00:00Z",
    "status": "scheduled",
    "lastUpdated": "2024-12-12T15:30:00Z"
  }
}
```

---

### 2.6 Delete/Cancel Visit

```http
DELETE /api/visits/{visit_id}
Content-Type: application/json
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `visit_id` | string | Yes | Visit ObjectId |

**Request Body (optional):**
```json
{
  "reason": "Meeting rescheduled"
}
```

**Status Transitions:**

| Current Status | New Status | Behavior |
|----------------|------------|----------|
| `scheduled` | `cancelled` | Visit is cancelled, can be re-scheduled |
| `checked_out` | `deleted` | Marked as deleted for audit trail |
| `checked_in` | ❌ Error | Cannot delete active visits |

**Response:**
```json
{
  "message": "Visit cancelled successfully",
  "visitId": "visit_abc123",
  "status": "cancelled"
}
```

> [!WARNING]
> Visits that are currently checked-in cannot be deleted. The visitor must check-out first.

---

### 2.7 Check In

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

### 2.8 Check Out

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

### 2.9 Get Visit QR Code

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

**Data Source Logic (Residency-Aware):**

| Residency Mode | Source | Description |
|--------------|--------|-------------|
| `platform` | Platform API | Fetches actors of the **mapped type** from Platform |
| `app` | Local VMS Database | Returns VMS's local employee records |

**How Residency is Determined:**

1. **Check ResidencyDetector** for company's employee residency mode
2. **Safe Defaults:**
   - Employees: `platform` (if company not in VMS DB)
   - Visitors: `app` (always stay in VMS for safety)

**Actor Type Mapping:**

The manifest configuration determines WHICH Platform actor type to fetch. For example:

```json
{
  "actorMappings": {
    "employee": ["shift_supervisor"]
  }
}
```

This means VMS's "employee" concept maps to Platform's "shift_supervisor" actor type. VMS will fetch shift_supervisors from Platform, not employees.

**Response:**
```json
[
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
]
```

### 3.2 Data Flow

```
VMS Request → ResidencyDetector.get_mode(companyId, 'employee')
            → Returns: 'platform' or 'app'
            
If mode = 'app':
  → Fetch from VMS local database
  → Query: employees_collection.find({companyId})
  → Return local employee records

If mode = 'platform':
  → Check manifest for actor mapping
  → Get mapped actor type (e.g., 'shift_supervisor')
  → Call Platform API: GET /actors?actorType={mapped_type}
  → Return Platform actors (transformed to VMS format)
```

**Key Points:**
- ✅ Always checks residency FIRST
- ✅ Never hits Platform API without checking residency
- ✅ Respects manifest-based actor type mappings
- ✅ No fallback to VMS DB in platform mode (prevents data duplication)

---

### 3.3 Register Employee

```http
POST /api/employees/register
Content-Type: multipart/form-data
```

Register a new employee with face images for biometric recognition. Behavior differs based on **data residency mode**:
- **Platform mode**: Creates employee on Platform (embedding generated by Platform worker)
- **App mode**: Creates employee in VMS local DB (embedding generated by VMS worker)

**Required Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `employeeId` | string | Yes | Unique employee code (e.g., EMP001) |
| `employeeName` | string | Yes | Full name |

**Optional Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `employeeEmail` | string | No | Email address (validated format) |
| `employeeMobile` | string | No | Phone number (10 digits) |
| `department` | string | No | Department name |
| `designation` | string | No | Job title / designation |
| `employeeDesignation` | string | No | Alternative field for designation |
| `gender` | string | No | Gender: `male`, `female`, `other` |
| `joiningDate` | string | No | Date of joining (ISO 8601 format) |
| `employeeReportingId` | string | No | Reporting manager's employee ID |
| `status` | string | No | Initial status: `active` (default), `inactive` |

**Face Image Fields (for biometric registration):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `front` | file | No | Front-facing photo (legacy format) |
| `side` | file | No | Side-facing photo (legacy format) |
| `left` | file | No | Left-facing photo |
| `center` | file | No | Center/front-facing photo |
| `right` | file | No | Right-facing photo |

> [!TIP]
> **Multi-pose Registration**: Providing multiple face images (left, center, right) enables higher accuracy face recognition via averaged embeddings.

**Pre-computed Embedding Fields (advanced):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `embeddingAttached` | string | No | Set to `true` if uploading pre-computed embedding |
| `embeddingVersion` | string | Conditional | Model: `buffalo_l`, `facenet`, `arcface`, `vggface`, `mobile_facenet_v1` |
| `embedding` | file | Conditional | Pre-computed embedding file (.npy or .pkl) |

**Example Request:**
```bash
curl -X POST http://localhost:5001/api/employees/register \
  -H "Authorization: Bearer <token>" \
  -F "companyId=507f1f77bcf86cd799439011" \
  -F "employeeId=EMP001" \
  -F "employeeName=John Doe" \
  -F "employeeEmail=john.doe@company.com" \
  -F "employeeMobile=9876543210" \
  -F "department=Engineering" \
  -F "designation=Software Engineer" \
  -F "center=@/path/to/center.jpg" \
  -F "left=@/path/to/left.jpg" \
  -F "right=@/path/to/right.jpg"
```

**Success Response - App Mode (201 Created):**
```json
{
  "message": "Employee registration successful",
  "_id": "507f1f77bcf86cd799439012",
  "employeeId": "EMP001",
  "employeeName": "John Doe",
  "embeddingStatus": {
    "buffalo_l": "queued",
    "facenet": "queued"
  },
  "hasBiometric": true,
  "residencyMode": "app",
  "platformSync": null
}
```

**Success Response - Platform Mode (201 Created):**
```json
{
  "message": "Employee registered successfully on Platform",
  "employee": {
    "actor": {
      "_id": "platform_actor_id",
      "actorType": "employee",
      "attributes": {
        "employeeName": "John Doe",
        "employeeId": "EMP001"
      }
    }
  },
  "residencyMode": "platform",
  "hasPhoto": true
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Success message |
| `_id` | string | Created employee ObjectId (app mode) |
| `employeeId` | string | Employee code |
| `employeeName` | string | Full name |
| `embeddingStatus` | object | Status per model: `queued`, `started`, `done`, `failed` |
| `hasBiometric` | boolean | Whether face images were provided |
| `residencyMode` | string | Where data is stored: `app` (local) or `platform` |
| `platformSync` | object | Platform sync details (app mode only) |
| `employee` | object | Created actor data (platform mode only) |

---

## 4. Locations

**Base Path:** `/api/entities`

VMS uses "location" as its app-specific term for places where visits occur. Internally, this maps to **entity** types in the Platform (e.g., `organization`, `plant`, `building`, `zone`, `line`). The exact Platform entity type used is configured in the **Data Mapping** settings.

### 4.1 App-Centric Design

VMS APIs use **app-specific terminology**:

| VMS Term | Internal Type | Platform Mapping (Configurable) |
|----------|---------------|--------------------------------|
| `location` | Entity | `organization`, `plant`, `building`, `line`, etc. |
| `employee` | Actor | `employee`, `shift_supervisor`, `manager`, etc. |
| `visitor` | Actor | `visitor` (managed by VMS) |

This design allows VMS to work with different Platform entity structures without code changes.

### 5.2 List Locations

```http
GET /api/entities?companyId={companyId}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |

**Data Source Logic (Residency-Aware):**

| Residency Mode | Source | Description |
|--------------|--------|-------------|
| `platform` | Platform API | Fetches entities of the **mapped type** from Platform |
| `app` | Local VMS Database | Returns VMS's local location records |

**How Mapping Works:**

1. VMS checks `installationMappings` for entity type configuration
2. Gets the mapped Platform entity types (e.g., `location → ['organization']`)
3. Fetches those entity types from Platform
4. Returns results using VMS terminology

**Example Mapping Configuration:**

```json
{
  "entityMappings": {
    "location": ["organization"]
  }
}
```

This means VMS's "location" concept maps to Platform's "organization" entity type.

**Response:**

```json
{
  "entities": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "JBM Group Holdings",
      "type": "organization",
      "status": "active",
      "companyId": "company_id",
      "parentId": null,
      "path": ["root"]
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Manesar Plant",
      "type": "plant",
      "status": "active",
      "companyId": "company_id",
      "parentId": "507f1f77bcf86cd799439011",
      "path": ["root", "507f1f77bcf86cd799439011"]
    }
  ],
  "count": 2
}
```

### 5.3 Get Single Location

```http
GET /api/entities/{entity_id}?companyId={companyId}
```

**Response:**

```json
{
  "_id": "507f1f77bcf86cd799439011",
  "name": "JBM Group Holdings",
  "type": "organization",
  "status": "active",
  "companyId": "company_id",
  "metadata": {
    "address": "Delhi NCR",
    "capacity": 5000
  }
}
```

### 5.4 Data Flow

```
VMS Request → GET /api/entities?companyId=...
            ↓
ResidencyDetector.get_mode(companyId, 'location')
            ↓
Returns: 'platform' or 'app'
            
If mode = 'app':
  → Fetch from VMS local database
  → Query: entities_collection.find({companyId})
  → Return local location records

If mode = 'platform':
  → Check installationMappings for entity mapping
  → Get mapped entity types (e.g., ['organization'])
  → Call Platform API: GET /entities?companyId=...&appId=...
  → Platform filters by mapping → Returns organizations
  → VMS returns results (transformed to VMS format)
```

**Key Points:**
- ✅ VMS uses app-specific terminology (`location`)
- ✅ Platform entity types are configurable via Data Mapping
- ✅ No hardcoded entity types in VMS code
- ✅ Respects residency mode for data source selection
- ✅ Platform filters entities based on `appId` and `installationMappings`

### 5.5 Changing Entity Mappings

Entity mappings are configured in the **Platform UI** under:
1. Navigate to Company → Installed Apps
2. Click on VMS → Data Mapping
3. Under "Entity Requirements", select the Platform entity type
4. Click Save

Changes take effect immediately on the next API request.

---

## 5. Dashboard

**Base Path:** `/api/dashboard`

### 5.1 Get Stats

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

### 5.2 Get Trends

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

### 5.3 Security Dashboard

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

### 5.4 Export Visits Report

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

### 5.5 Summary Report

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

### 5.6 Approve Visit

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

### 5.7 Deny Visit

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

## 13. Emergency & Evacuation APIs

Critical endpoints for emergency response and visitor safety.

### 13.1 Get Evacuation List

```http
GET /api/emergency/evacuation-list?companyId={companyId}
```

Returns real-time list of all currently checked-in visitors for emergency headcount.

**Response:**
```json
{
  "evacuationList": [
    {
      "visitId": "visit_123",
      "visitorName": "John Doe",
      "visitorPhone": "+91-9876543210",
      "hostEmployeeName": "Jane Smith",
      "locationName": "Building A",
      "checkInTime": "2024-12-13T10:00:00Z",
      "evacuationStatus": "on_site"
    }
  ],
  "summary": {
    "totalOnSite": 25,
    "evacuatedCount": 20,
    "missingCount": 5,
    "percentAccountedFor": 80.0
  }
}
```

---

### 13.2 Trigger Evacuation

```http
POST /api/emergency/trigger
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "reason": "fire_drill",
  "musterPoints": ["Main Gate", "Parking Lot B"]
}
```

---

### 13.3 Muster Check-in

```http
POST /api/emergency/muster-checkin
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitId": "visit_123",
  "musterPoint": "Main Gate",
  "method": "manual"
}
```

---

### 13.4 End Evacuation

```http
POST /api/emergency/end
Content-Type: application/json
```

---

## 14. Bulk Operations APIs

For event management and mass operations.

### 14.1 Bulk Register Visitors

```http
POST /api/visitors/bulk-register
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "visitors": [
    {
      "visitorName": "John Doe",
      "phone": "+91-9876543210",
      "hostEmployeeId": "emp_001",
      "email": "john@example.com",
      "organization": "ABC Corp"
    }
  ]
}
```

**Response:**
```json
{
  "summary": {
    "total": 100,
    "successful": 95,
    "failed": 5,
    "existing": 10
  },
  "successful": [...],
  "failed": [...]
}
```

---

### 14.2 Bulk Schedule Visits

```http
POST /api/visitors/bulk-schedule
Content-Type: application/json
```

---

### 14.3 Bulk Cancel Visits

```http
POST /api/visitors/bulk-cancel
Content-Type: application/json
```

---

## 15. Pre-Registration Portal APIs

Self-service visitor pre-registration with QR codes.

### 15.1 Create Invite

```http
POST /api/preregistration/invite
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "hostEmployeeId": "emp_001",
  "visitorEmail": "visitor@example.com",
  "expectedArrival": "2024-12-15T10:00:00Z",
  "purpose": "Business Meeting"
}
```

**Response:**
```json
{
  "inviteToken": "abc123xyz...",
  "inviteUrl": "https://vms.example.com/visitor-registration/abc123xyz",
  "qrCodeUrl": "/api/preregistration/abc123xyz/qr",
  "expiresAt": "2024-12-18T10:00:00Z"
}
```

---

### 15.2 Get Invite Details (Public)

```http
GET /api/preregistration/{token}
```

No authentication required. Returns invite details for visitor.

---

### 15.3 Submit Registration (Public)

```http
POST /api/preregistration/{token}/submit
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorName": "John Doe",
  "phone": "+91-9876543210",
  "email": "john@example.com",
  "organization": "ABC Corp"
}
```

---

## 16. Approval Workflow APIs

Multi-level approval chains for visitor management.

### 16.1 Get Pending Approvals

```http
GET /api/approvals/pending?companyId={companyId}&approverId={approverId}
```

---

### 16.2 Approve Visit

```http
POST /api/approvals/{approval_id}/approve
Content-Type: application/json
```

**Request Body:**
```json
{
  "approverId": "emp_001",
  "comment": "Approved for meeting"
}
```

---

### 16.3 Reject Visit

```http
POST /api/approvals/{approval_id}/reject
Content-Type: application/json
```

**Request Body:**
```json
{
  "approverId": "emp_001",
  "reason": "Meeting cancelled"
}
```

---

### 16.4 Delegate Approval

```http
POST /api/approvals/{approval_id}/delegate
Content-Type: application/json
```

**Request Body:**
```json
{
  "fromApproverId": "emp_001",
  "toApproverId": "emp_002",
  "reason": "Out of office"
}
```

---

### 16.5 Configure Approval Rules

```http
POST /api/approvals/rules
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "visitorType": "contractor",
  "mode": "sequential",
  "levels": [
    {"role": "host", "timeoutHours": 24},
    {"role": "manager", "timeoutHours": 48}
  ],
  "requiresApproval": true
}
```

---

## 17. Audit Trail APIs

Complete audit logging for compliance.

### 17.1 Search Audit Logs

```http
GET /api/audit/logs?companyId={companyId}&action={action}&startDate={date}&endDate={date}
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Filter by action (visitor.created, visit.checkin, etc.) |
| `entityType` | string | Filter by entity (visitor, visit, employee) |
| `severity` | string | Filter by severity (info, warning, critical) |
| `startDate` | ISO date | Start of date range |
| `endDate` | ISO date | End of date range |

---

### 17.2 Get Entity History

```http
GET /api/audit/entity/{entity_type}/{entity_id}
```

Returns complete audit history for a specific entity.

---

### 17.3 Export Audit Logs

```http
GET /api/audit/export?companyId={companyId}&format=csv&startDate={date}&endDate={date}
```

Returns downloadable CSV or JSON file for compliance reporting.

---

### 17.4 Security Events

```http
GET /api/audit/security-events?companyId={companyId}&days=7
```

Returns security-related events (login failures, blacklist matches, etc.)

---

## 18. Watchlist APIs

Categorized watchlist management (VIP, Blacklist, Restricted, Banned).

### 18.1 Add to Watchlist

```http
POST /api/watchlist/entries
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "category": "blacklist",
  "name": "John Doe",
  "phone": "+91-9876543210",
  "reason": "Security violation",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Categories:**

| Category | Behavior |
|----------|----------|
| `vip` | Fast-track check-in, notify leadership |
| `blacklist` | Block entry, alert security |
| `restricted` | Extra verification required |
| `banned` | Permanent block, legal hold |

---

### 18.2 Check Against Watchlist

```http
POST /api/watchlist/check
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "phone": "+91-9876543210",
  "email": "visitor@example.com"
}
```

**Response:**
```json
{
  "matches": [...],
  "hasBlacklist": true,
  "hasVip": false,
  "hasRestricted": false
}
```

---

### 18.3 List Watchlist Entries

```http
GET /api/watchlist/entries?companyId={companyId}&category=blacklist
```

---

### 18.4 Remove from Watchlist

```http
DELETE /api/watchlist/entries/{entry_id}
```

---

## 19. GDPR Compliance APIs

Data privacy and compliance endpoints.

### 19.1 Export Visitor Data

```http
GET /api/gdpr/export/{visitor_id}?format=json&includeVisits=true
```

GDPR Right to Access - exports all visitor data.

---

### 19.2 Create Deletion Request

```http
POST /api/gdpr/deletion-request
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "visitorId": "visitor_456",
  "reason": "Visitor requested data deletion"
}
```

---

### 19.3 Purge Visitor Data

```http
DELETE /api/gdpr/purge/{visitor_id}
Content-Type: application/json
```

**Request Body:**
```json
{
  "confirmation": "PERMANENTLY DELETE",
  "reason": "GDPR deletion request"
}
```

> [!CAUTION]
> This action is **irreversible**. All visitor data, images, embeddings, and visit history will be permanently deleted.

---

### 19.4 Record Consent

```http
POST /api/gdpr/consent
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitorId": "visitor_456",
  "consentType": "biometric",
  "granted": true,
  "method": "digital"
}
```

---

## 20. Mobile API

Optimized endpoints for mobile security guard and host apps.

### 20.1 Sync Visitors (Delta)

```http
GET /api/mobile/sync/visitors?companyId={companyId}&since={timestamp}&cursor={cursor}
```

Returns visitor records updated since timestamp for offline sync.

**Response:**
```json
{
  "visitors": [...],
  "nextCursor": "cursor_string",
  "hasMore": true,
  "syncTimestamp": "2024-12-13T10:00:00Z"
}
```

---

### 20.2 Sync Visits

```http
GET /api/mobile/sync/visits?companyId={companyId}&role=guard
```

Returns today's visits for security guards or host's pending visits.

---

### 20.3 Quick Check-in

```http
POST /api/mobile/quick-checkin
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitId": "visit_123",
  "deviceId": "device_abc",
  "method": "qr"
}
```

Supports QR code scan, face recognition, or manual lookup.

---

### 20.4 Quick Check-out

```http
POST /api/mobile/quick-checkout
Content-Type: application/json
```

---

### 20.5 Register Push Device

```http
POST /api/mobile/push/register
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "emp_001",
  "deviceToken": "fcm_token_here",
  "platform": "android"
}
```

---

### 20.6 Dashboard Summary

```http
GET /api/mobile/dashboard-summary?companyId={companyId}
```

Returns quick stats for mobile home screen.

---

## 21. Access Control APIs

Physical access control system integration.

### 21.1 Grant Access

```http
POST /api/access/grant
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitId": "visit_123",
  "zones": ["main_lobby", "meeting_rooms"],
  "credentialType": "qr",
  "validUntil": "2024-12-13T18:00:00Z"
}
```

**Response:**
```json
{
  "accessId": "access_456",
  "credentialCode": "abc123...",
  "zones": ["main_lobby", "meeting_rooms"],
  "validUntil": "2024-12-13T18:00:00Z"
}
```

---

### 21.2 Revoke Access

```http
POST /api/access/revoke
Content-Type: application/json
```

**Request Body:**
```json
{
  "visitId": "visit_123",
  "reason": "Visit ended early"
}
```

---

### 21.3 Verify Access

```http
POST /api/access/verify
Content-Type: application/json
```

Called by access control hardware to verify credentials.

**Request Body:**
```json
{
  "credentialCode": "abc123...",
  "zoneId": "meeting_rooms",
  "doorId": "door_101"
}
```

**Response:**
```json
{
  "authorized": true,
  "visitorName": "John Doe",
  "zones": ["main_lobby", "meeting_rooms"]
}
```

---

### 21.4 Get Access Zones

```http
GET /api/access/zones?companyId={companyId}
```

---

### 21.5 Door Event

```http
POST /api/access/door-event
Content-Type: application/json
```

Receive door open/close events from hardware.

---

## 22. Advanced Analytics APIs

Enterprise analytics for dashboards and insights.

### 22.1 Dashboard Metrics

```http
GET /api/advanced-analytics/dashboard?companyId={companyId}&period=today
```

Returns comprehensive dashboard stats: current on-site, today's visits, pending approvals.

---

### 22.2 Visit Trends

```http
GET /api/advanced-analytics/trends?companyId={companyId}&days=30
```

Returns daily visit data for trend charts.

---

### 22.3 Peak Hours Analysis

```http
GET /api/advanced-analytics/peak-hours?companyId={companyId}&days=30
```

Returns hourly distribution of check-ins for capacity planning.

---

### 22.4 Visitor Type Breakdown

```http
GET /api/advanced-analytics/visitor-types?companyId={companyId}
```

---

### 22.5 Host Statistics

```http
GET /api/advanced-analytics/host-stats?companyId={companyId}&limit=20
```

Returns visit statistics by host employee.

---

### 22.6 Compliance Metrics

```http
GET /api/advanced-analytics/compliance?companyId={companyId}
```

---

### 22.7 Occupancy Data

```http
GET /api/advanced-analytics/occupancy?companyId={companyId}
```

Real-time and by-location occupancy data.

---

## 23. Report Builder APIs

Custom report generation and scheduling.

### 23.1 List Report Templates

```http
GET /api/reports/templates
```

**Available Templates:**

| Template | Description |
|----------|-------------|
| `daily_summary` | Daily visit overview |
| `visitor_log` | Detailed visitor log |
| `host_activity` | Visits by host |
| `security_events` | Security alerts |
| `compliance` | Compliance metrics |

---

### 23.2 Generate Report

```http
POST /api/reports/generate
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "templateId": "daily_summary",
  "startDate": "2024-12-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "format": "csv"
}
```

---

### 23.3 Schedule Report

```http
POST /api/reports/schedule
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "templateId": "daily_summary",
  "frequency": "weekly",
  "recipients": ["admin@company.com"],
  "time": "08:00"
}
```

---

### 23.4 List Scheduled Reports

```http
GET /api/reports/scheduled?companyId={companyId}
```

---

## 24. Webhooks APIs

Event subscription and delivery.

### 24.1 List Available Events

```http
GET /api/webhooks/events
```

**Available Events:**
- `visitor.registered`, `visitor.updated`, `visitor.deleted`
- `visit.scheduled`, `visit.checked_in`, `visit.checked_out`
- `approval.requested`, `approval.approved`, `approval.rejected`
- `evacuation.triggered`, `security.alert`

---

### 24.2 Create Subscription

```http
POST /api/webhooks/subscriptions
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "url": "https://your-server.com/webhook",
  "events": ["visit.checked_in", "visit.checked_out"],
  "name": "Visit notifications"
}
```

**Response:**
```json
{
  "subscriptionId": "sub_123",
  "secret": "whsec_...",
  "note": "Store the secret securely. It will not be shown again."
}
```

---

### 24.3 Test Webhook

```http
POST /api/webhooks/subscriptions/{subscription_id}/test
```

Sends a test delivery to verify endpoint configuration.

---

### 24.4 Delivery History

```http
GET /api/webhooks/deliveries?companyId={companyId}&subscriptionId={id}
```

---

## 25. API Keys Management

Programmatic access management.

### 25.1 List API Key Scopes

```http
GET /api/keys/scopes
```

**Available Scopes:**
- `read:visitors`, `write:visitors`
- `read:visits`, `write:visits`
- `read:analytics`, `read:audit`
- `admin`, `*` (full access)

---

### 25.2 Create API Key

```http
POST /api/keys/
Content-Type: application/json
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "name": "Mobile App Integration",
  "scopes": ["read:visitors", "write:visits"]
}
```

**Response:**
```json
{
  "keyId": "key_123",
  "rawKey": "vms_abc123...",
  "warning": "Store this key securely. It will NOT be shown again."
}
```

---

### 25.3 Revoke API Key

```http
POST /api/keys/{key_id}/revoke
```

---

### 25.4 Get Key Usage

```http
GET /api/keys/{key_id}/usage
```

Returns usage statistics and current rate limit status.

---

## 26. Device Management

**Base Path:** `/api/devices`

Device management for tracking check-in kiosks, tablets, and desktops across locations.

### 26.1 List Devices

```http
GET /api/devices?companyId={companyId}
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyId` | string | Yes | Company ObjectId |
| `locationId` | string | No | Filter by location |
| `status` | string | No | Filter: `active`, `inactive`, `maintenance` |
| `deviceType` | string | No | Filter: `kiosk`, `tablet`, `desktop`, `mobile` |

**Response:**
```json
{
  "devices": [
    {
      "_id": "device_123",
      "deviceId": "VMS-A1B2C3D4",
      "deviceName": "Reception Kiosk 1",
      "deviceType": "kiosk",
      "locationId": "loc_123",
      "locationName": "Main Lobby",
      "status": "active",
      "lastSeen": "2026-01-18T10:30:00Z",
      "isOnline": true,
      "ipAddress": "192.168.1.100",
      "appVersion": "1.0.0",
      "features": {
        "faceRecognition": true,
        "badgePrinting": false,
        "qrScanning": true
      }
    }
  ],
  "count": 1
}
```

---

### 26.2 Register Device

```http
POST /api/devices/register
```

**Request Body:**
```json
{
  "companyId": "company_123",
  "deviceName": "Reception Kiosk 1",
  "deviceType": "kiosk",
  "locationId": "loc_123",
  "locationName": "Main Lobby",
  "features": {
    "faceRecognition": true,
    "badgePrinting": false,
    "qrScanning": true
  }
}
```

**Response:**
```json
{
  "message": "Device registered successfully",
  "device": {
    "_id": "device_123",
    "deviceId": "VMS-A1B2C3D4",
    "deviceName": "Reception Kiosk 1"
  }
}
```

---

### 26.3 Device Heartbeat

```http
POST /api/devices/{device_id}/heartbeat
```

Called periodically by devices to report status. No authentication required.

**Request Body:**
```json
{
  "ipAddress": "192.168.1.100",
  "status": "active",
  "appVersion": "1.0.0",
  "metrics": {
    "cpu": 45,
    "memory": 60
  }
}
```

**Response:**
```json
{
  "message": "Heartbeat received",
  "serverTime": "2026-01-18T10:30:00Z"
}
```

---

### 26.4 Get Device Statistics

```http
GET /api/devices/stats?companyId={companyId}
```

**Response:**
```json
{
  "stats": {
    "total": 10,
    "online": 8,
    "offline": 1,
    "maintenance": 1,
    "byType": {
      "kiosk": 5,
      "tablet": 3,
      "desktop": 2
    },
    "byLocation": {
      "Main Lobby": 3,
      "Building A": 4,
      "Building B": 3
    }
  }
}
```

---

### 26.5 Generate Activation Code

```http
POST /api/devices/activation-codes
```

Generate a code for device self-activation.

**Request Body:**
```json
{
  "companyId": "company_123",
  "locationId": "loc_123",
  "locationName": "Main Lobby",
  "expiresIn": 24
}
```

**Response:**
```json
{
  "message": "Activation code created",
  "code": "A1B2C3D4",
  "expiresAt": "2026-01-19T10:30:00Z"
}
```

---

### 26.6 Activate Device

```http
POST /api/devices/activate
```

Activate a device using an activation code.

**Request Body:**
```json
{
  "activationCode": "A1B2C3D4",
  "deviceInfo": {
    "name": "Kiosk 5",
    "type": "kiosk",
    "os": "Android 12",
    "appVersion": "1.0.0"
  }
}
```

---

### 26.7 Update Device

```http
PATCH /api/devices/{device_id}
```

**Request Body:**
```json
{
  "deviceName": "Updated Name",
  "locationId": "new_loc_id",
  "status": "maintenance",
  "features": {
    "badgePrinting": true
  }
}
```

---

### 26.8 Delete Device

```http
DELETE /api/devices/{device_id}?companyId={companyId}
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

*End of API Reference - Enterprise Edition v4.0*

