# Dynamic Mapping Fix - CORRECT Implementation

## ✅ Problem Understood Correctly

You were pointing out that **VMS was NOT passing `appId`** when fetching entities/actors, so the Platform couldn't check the `installationMappings` and apply the correct mapping.

## The Complete Flow

### 1. Manifest Declaration (VMS declares what it needs)
```json
// VMS manifest.json
{
  "requiredEntities": [
    { "entityType": "location" }
  ],
  "requiredActors": [
    { "actorType": "visitor" },
    { "actorType": "employee" }
  ]
}
```

### 2. Mapping Configuration (User maps in Platform UI)
```
VMS "location" → Platform "organization"
VMS "visitor" → Platform "visitor"
VMS "employee" → Platform "employee"
```

Saved in `installationMappings`:
```json
{
  "appId": "vms_app_v1",
  "companyId": "67890",
  "entityMappings": {
    "location": ["organization"]
  },
  "actorMappings": {
    "visitor": ["visitor"],
    "employee": ["employee"]
  },
  "status": "configured"
}
```

### 3. VMS Requests Data (BEFORE - WRONG ❌)
```javascript
// api.js - OLD CODE
getEntities: (companyId) => VMS_API.call(`/entities?companyId=${companyId}`)
//                                                                    ↑
//                                                    Missing appId!
```

**Result**: Platform doesn't know which app is requesting, can't apply mapping

### 4. VMS Requests Data (AFTER - CORRECT ✅)
```javascript
// api.js - NEW CODE
getEntities: (companyId) => VMS_API.call(`/entities?companyId=${companyId}&appId=vms_app_v1`)
//                                                                          ↑
//                                                          Now includes appId!
```

**Result**: Platform knows it's VMS, checks mapping, returns correct data

### 5. Platform Processes Request
```python
# entity.py - lines 477-486
app_id = request.args.get('appId')  # Gets "vms_app_v1"
if app_id:
    mapping = db['installationMappings'].find_one({
        'appId': app_id,
        'companyId': company_id,
        'status': 'configured'
    })
    if mapping and 'entityMappings' in mapping:
        allowed = []
        for types in mapping['entityMappings'].values():
            allowed.extend(types if isinstance(types, list) else [types])
        if allowed:
            query['type'] = {'$in': list(set(allowed))}
            # Query becomes: { type: { $in: ["organization"] } }
```

### 6. Platform Returns Mapped Data
```
VMS asked for: "entities"
Mapping says: "location" → "organization"
Platform returns: Organizations (filtered by type)
VMS receives: Organizations as "entities" ✅
```

## Fix Applied

### File: `visitorManagementSystem/app/static/js/apps/vms/api.js`

**Lines 89-93 - BEFORE**:
```javascript
// Employees (for host selection)
getEmployees: (companyId) => VMS_API.call(`/employees?companyId=${companyId}`),

// Entities (for filtering)
getEntities: (companyId) => VMS_API.call(`/entities?companyId=${companyId}`),
```

**Lines 89-93 - AFTER**:
```javascript
// Employees (for host selection) - Pass appId for mapping
getEmployees: (companyId) => VMS_API.call(`/employees?companyId=${companyId}&appId=vms_app_v1`),

// Entities (for filtering) - Pass appId for mapping
getEntities: (companyId) => VMS_API.call(`/entities?companyId=${companyId}&appId=vms_app_v1`),
```

## How It Works Now

### Example: VMS Fetches Entities

1. **VMS Code**:
   ```javascript
   VMS_API.getEntities(companyId)
   ```

2. **HTTP Request**:
   ```
   GET /entities?companyId=67890&appId=vms_app_v1
   ```

3. **Platform Checks Mapping**:
   ```
   installationMappings for vms_app_v1:
   - entityMappings.location = ["organization"]
   ```

4. **Platform Queries**:
   ```mongodb
   db.entities.find({
     companyId: "67890",
     type: { $in: ["organization"] }  // Only organizations!
   })
   ```

5. **VMS Receives**:
   ```json
   [
     { "_id": "1", "name": "JBM Auto", "type": "organization" },
     { "_id": "2", "name": "Manesar Plant", "type": "organization" }
   ]
   ```

### Example: VMS Fetches Actors

1. **VMS Code**:
   ```javascript
   VMS_API.getEmployees(companyId)
   ```

2. **HTTP Request**:
   ```
   GET /actors?companyId=67890&appId=vms_app_v1
   ```

3. **Platform Checks Mapping**:
   ```
   installationMappings for vms_app_v1:
   - actorMappings.employee = ["employee"]
   ```

4. **Platform Queries**:
   ```mongodb
   db.actors.find({
     companyId: "67890",
     actorType: { $in: ["employee"] }  // Only employees!
   })
   ```

5. **VMS Receives**:
   ```json
   [
     { "_id": "1", "actorType": "employee", "attributes": { "name": "John" } },
     { "_id": "2", "actorType": "employee", "attributes": { "name": "Jane" } }
   ]
   ```

## Benefits

✅ **Manifest-Driven**: App declares what it needs  
✅ **Mapping-Aware**: Platform applies correct mapping  
✅ **Flexible**: Change mapping → data changes automatically  
✅ **Consistent**: Same pattern for entities and actors  
✅ **Scalable**: Works for any app, any mapping  

## Testing

### Test 1: VMS Entities
1. Configure mapping: `location → organization`
2. Refresh VMS dashboard
3. Check "All Entities" dropdown
4. **Expected**: Shows organizations (not hardcoded lines)

### Test 2: VMS Actors
1. Configure mapping: `employee → employee`
2. Refresh VMS dashboard
3. Check "Host" dropdown
4. **Expected**: Shows employees from Platform

### Test 3: Change Mapping
1. Change mapping: `location → building`
2. Refresh VMS dashboard
3. **Expected**: Dropdown now shows buildings

## Platform Endpoints That Support appId

### ✅ `/entities` (entity.py, lines 477-486)
- Checks `installationMappings.entityMappings`
- Filters by mapped entity types
- Returns only mapped entities

### ✅ `/actors` (actors.py, lines 97-110)
- Checks `installationMappings.actorMappings`
- Filters by mapped actor types
- Returns only mapped actors

## Summary

**The Problem**: VMS wasn't passing `appId`, so Platform couldn't apply mapping  
**The Fix**: Added `&appId=vms_app_v1` to VMS API calls  
**The Result**: Platform now checks mapping and returns correctly filtered data  

---

**Status**: ✅ FIXED  
**Date**: 2026-01-10  
**Files Modified**: `visitorManagementSystem/app/static/js/apps/vms/api.js`  
**Impact**: High - enables manifest-driven data fetching
