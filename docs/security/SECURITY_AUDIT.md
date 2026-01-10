# VMS Security Audit - Android SSO Implementation

## Executive Summary

**Audit Date**: January 5, 2026  
**Scope**: Android SSO authentication and API access control  
**Status**: ⚠️ **CRITICAL SECURITY ISSUES IDENTIFIED**

---

## ✅ What's Working

### 1. SSO Response Includes Company Details
**Status**: ✅ **VERIFIED**

The SSO endpoint correctly returns company logo and details:

```python
# File: visitorManagementSystem/app/auth/__init__.py (lines 297-312)
return jsonify({
    'message': 'Platform SSO successful',
    'vmsToken': vms_token,
    'expiresIn': 86400,
    'companyId': company_id,
    'company': {
        'id': company_id,
        'name': company_name,  # ✅ Included
        'logo': company_logo   # ✅ Included
    },
    'user': {
        'id': user_id,
        'email': user_email,
        'name': user_name
    }
})
```

**Test Result**: Confirmed working - company logo and name returned in SSO response.

---

## ⚠️ CRITICAL SECURITY ISSUES

### Issue #1: Missing Company ID Validation in API Endpoints

**Severity**: 🔴 **CRITICAL**  
**Risk**: Users can access data from ANY company by changing the `companyId` parameter

**Problem**:
The `@require_auth` decorator extracts `company_id` from the token but **DOES NOT validate** that the requested `companyId` in the API call matches the authenticated user's company.

**Current Implementation** (`app/auth/__init__.py`):
```python
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check for Bearer token
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            payload = decode_token(token)
            if payload:
                request.user_id = payload.get('user_id')
                request.company_id = payload.get('company_id')  # ✅ Extracted
                return f(*args, **kwargs)  # ❌ No validation!
```

**Vulnerable Endpoint Example** (`app/api/visitors.py`):
```python
@visitor_bp.route('/', methods=['GET'])
@require_auth
def list_visitors():
    company_id = request.args.get('companyId')  # ❌ User-provided
    # No check: Does request.company_id == company_id?
    
    query = {'companyId': company_id}  # ❌ Queries ANY company!
    visitors = list(visitor_collection.find(query))
    return jsonify({'visitors': visitors})
```

**Attack Scenario**:
```bash
# User belongs to Company A (ID: 111)
# But requests data from Company B (ID: 222)

GET /api/visitors?companyId=222
Authorization: Bearer <token_for_company_111>

# ❌ VULNERABILITY: Returns Company B's visitors!
```

**Impact**:
- ❌ Complete data breach across all companies
- ❌ Violates data residency and isolation
- ❌ GDPR/compliance violation
- ❌ Unauthorized access to sensitive visitor data

---

### Issue #2: No Data Residency Enforcement

**Severity**: 🟡 **HIGH**  
**Risk**: Manifest-defined data residency rules not enforced

**Problem**:
While the manifest defines data residency (`app` vs `platform`), there's no runtime enforcement to ensure:
1. Data marked as `residency: app` stays in VMS
2. Cross-company queries respect residency rules
3. Federated queries validate permissions

**Current State**:
```python
# app/api/visitors.py (line 428)
return jsonify({
    'dataResidency': 'app',  # ✅ Documented
    'federatedAccess': '/api/query/visitors'  # ✅ Endpoint exists
})
# ❌ But no enforcement of who can access this data
```

---

### Issue #3: Missing Entity-Level Access Control

**Severity**: 🟡 **HIGH**  
**Risk**: Users can access entities (zones, buildings) they shouldn't

**Problem**:
The code validates access areas exist but doesn't check if the user has permission to access those specific entities.

```python
# app/api/visitors.py (lines 621-626)
access_areas = data.get('accessAreas', [])
validated_access_areas = []
for area_id in access_areas:
    if ObjectId.is_valid(area_id):  # ❌ Only checks if valid ObjectId
        validated_access_areas.append(ObjectId(area_id))
# ❌ No check: Does user have access to this area?
```

---

## 🛡️ REQUIRED FIXES

### Fix #1: Add Company ID Validation Decorator

**Priority**: 🔴 **IMMEDIATE**

Create a new decorator that validates company access:

```python
# app/auth/__init__.py

def require_company_access(f):
    """
    Decorator that validates the requested companyId matches 
    the authenticated user's company from the token.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # First check authentication
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            payload = decode_token(token)
            if not payload:
                return jsonify({'error': 'Invalid token'}), 401
            
            # Extract company from token
            token_company_id = payload.get('company_id')
            request.user_id = payload.get('user_id')
            request.company_id = token_company_id
        elif session.get('user_id'):
            token_company_id = session.get('company_id')
            request.user_id = session['user_id']
            request.company_id = token_company_id
        else:
            return jsonify({'error': 'Authentication required'}), 401
        
        # Validate company access
        requested_company_id = (
            request.args.get('companyId') or 
            request.json.get('companyId') if request.is_json else None or
            request.form.get('companyId')
        )
        
        if not requested_company_id:
            return jsonify({'error': 'companyId required'}), 400
        
        # CRITICAL: Validate token company matches requested company
        if str(token_company_id) != str(requested_company_id):
            return jsonify({
                'error': 'Access denied',
                'message': 'You can only access data from your own company'
            }), 403
        
        return f(*args, **kwargs)
    
    return decorated
```

**Usage**:
```python
@visitor_bp.route('/', methods=['GET'])
@require_company_access  # ✅ Use new decorator
def list_visitors():
    company_id = request.company_id  # ✅ Use validated company from token
    query = {'companyId': ObjectId(company_id)}
    visitors = list(visitor_collection.find(query))
    return jsonify({'visitors': visitors})
```

---

### Fix #2: Implement Data Residency Validation

**Priority**: 🟡 **HIGH**

Add middleware to validate data residency rules:

```python
# app/services/residency_validator.py

class ResidencyValidator:
    @staticmethod
    def validate_access(company_id, actor_type, operation):
        """
        Validate if operation is allowed based on manifest residency rules.
        
        Args:
            company_id: Company requesting access
            actor_type: Type of actor (visitor, employee, etc.)
            operation: read, write, delete
        
        Returns:
            (allowed: bool, reason: str)
        """
        # Load manifest
        manifest = load_manifest()
        
        # Check data residency
        residency = manifest.get('dataAgreements', {}).get(actor_type, {}).get('residency')
        
        if residency == 'app':
            # Data stays in app - only this app can access
            return (True, 'App-resident data')
        elif residency == 'platform':
            # Data synced to platform - validate via platform
            return validate_platform_access(company_id, actor_type, operation)
        
        return (False, 'Unknown residency rule')
```

---

### Fix #3: Add Entity-Level Access Control

**Priority**: 🟡 **HIGH**

Validate user has access to specific entities:

```python
# app/services/entity_access.py

def validate_entity_access(user_id, company_id, entity_ids):
    """
    Validate user has access to specific entities (zones, buildings).
    
    Returns:
        (allowed: bool, denied_entities: list)
    """
    # Get user's entity scope from token or database
    user_entities = get_user_entity_scope(user_id, company_id)
    
    denied = []
    for entity_id in entity_ids:
        if entity_id not in user_entities:
            denied.append(entity_id)
    
    return (len(denied) == 0, denied)
```

---

## 📋 Security Checklist

### Authentication
- [x] SSO returns company details (logo, name)
- [x] JWT tokens include company ID
- [x] Token expiration set (24 hours)
- [ ] ❌ Company ID validation in API calls
- [ ] ❌ Token refresh mechanism
- [ ] ❌ Token revocation support

### Authorization
- [ ] ❌ Company-level access control
- [ ] ❌ Entity-level access control
- [ ] ❌ Role-based permissions
- [ ] ❌ Data residency enforcement

### Data Protection
- [ ] ❌ Query result filtering by company
- [ ] ❌ Cross-company data leakage prevention
- [ ] ❌ Audit logging for data access
- [ ] ❌ GDPR compliance validation

### Edge Cases
- [ ] ❌ Invalid company ID handling
- [ ] ❌ Deleted company access prevention
- [ ] ❌ Suspended user access blocking
- [ ] ❌ Concurrent session handling
- [ ] ❌ Token replay attack prevention

---

## 🚨 IMMEDIATE ACTION REQUIRED

### Priority 1: Block Data Leakage (TODAY)

1. **Implement `require_company_access` decorator**
2. **Replace `@require_auth` with `@require_company_access` on ALL endpoints**:
   - `/api/visitors/*`
   - `/api/visits/*`
   - `/api/employees/*`
   - `/api/dashboard/*`
   - `/api/analytics/*`

### Priority 2: Add Validation (THIS WEEK)

1. Implement data residency validator
2. Add entity-level access control
3. Add audit logging for all data access
4. Implement rate limiting

### Priority 3: Security Hardening (THIS MONTH)

1. Add token refresh mechanism
2. Implement token revocation
3. Add CSRF protection
4. Implement request signing
5. Add anomaly detection

---

## 📊 Risk Assessment

| Issue | Severity | Exploitability | Impact | Priority |
|-------|----------|----------------|--------|----------|
| Missing company validation | Critical | Easy | Complete data breach | P0 |
| No residency enforcement | High | Medium | Compliance violation | P1 |
| No entity access control | High | Medium | Unauthorized access | P1 |
| No audit logging | Medium | N/A | No forensics | P2 |
| No token refresh | Low | Hard | Session management | P3 |

---

## ✅ Recommendations

1. **STOP deployment** until company validation is implemented
2. **Implement `require_company_access`** decorator immediately
3. **Audit all API endpoints** for security issues
4. **Add comprehensive logging** for security events
5. **Conduct penetration testing** before production release
6. **Implement monitoring** for suspicious access patterns

---

## 📝 Conclusion

While the Android SSO implementation correctly returns company details and uses JWT tokens, **CRITICAL security vulnerabilities exist** in access control. The system currently allows users to access data from ANY company by simply changing the `companyId` parameter.

**Status**: 🔴 **NOT PRODUCTION READY**

**Required**: Implement company validation before ANY production deployment.
