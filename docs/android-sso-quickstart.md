# Android SSO Authentication - Quick Reference

## ✅ Implementation Complete & Verified

**Status**: All tests passed successfully (January 5, 2026)

## What Changed

**Single file modified**: `visitorManagementSystem/app/auth/__init__.py`
- Enhanced POST response to include `vmsToken` for mobile apps
- Maintains backward compatibility with dashboard (GET requests unchanged)

## Authentication Flow

```
Android App → Platform Login → Platform JWT
           ↓
Android App → VMS SSO → VMS JWT Token
           ↓
Android App → VMS APIs (with VMS JWT)
```

## Quick Start for Android Developers

### 1. Login to Platform

```http
POST http://localhost:5000/bharatlytics/v1/users/login
Content-Type: application/json

{
  "email": "your-email@company.com",
  "password": "your-password"
}
```

**Response**: Save `token` and `context.companyId`

### 2. Get VMS Token

```http
POST http://localhost:5001/auth/platform-sso
Content-Type: application/json

{
  "token": "<platform_token>",
  "companyId": "<company_id>"
}
```

**Response**: Save `vmsToken`

### 3. Call VMS APIs

```http
GET http://localhost:5001/api/visitors?companyId=<company_id>
Authorization: Bearer <vms_token>
```

## Test Results

✅ Platform Login: Working  
✅ VMS SSO: Working  
✅ VMS Token Generation: Working (24h expiry)  
✅ Visitors API: Working  
✅ Visits API: Working (53 visits found)  
✅ Employees API: Working  

## Key Endpoints

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Platform | `/bharatlytics/v1/users/login` | Get platform JWT |
| VMS | `/auth/platform-sso` | Get VMS JWT |
| VMS | `/api/visitors` | List visitors |
| VMS | `/api/visits` | List visits |
| VMS | `/api/employees` | List employees |

## Android Code Example

```kotlin
// 1. Login
val platformResponse = platformApi.login(email, password)
val platformToken = platformResponse.token
val companyId = platformResponse.context.companyId

// 2. Get VMS token
val vmsResponse = vmsApi.platformSso(platformToken, companyId)
val vmsToken = vmsResponse.vmsToken

// 3. Call VMS APIs
val visitors = vmsApi.getVisitors(
    companyId = companyId,
    token = "Bearer $vmsToken"
)
```

## Security Notes

- Store tokens in `EncryptedSharedPreferences`
- Use HTTPS in production
- Implement token refresh for long sessions
- Clear tokens on logout

## Documentation

- **Full Implementation Plan**: `implementation_plan.md`
- **Complete Walkthrough**: `walkthrough.md` (includes full Kotlin examples)
- **Test Script**: `test_android_sso.ps1`

## Support

For issues or questions, refer to the complete walkthrough documentation which includes:
- Detailed architecture diagrams
- Complete Android integration guide
- Error handling examples
- Security best practices
