# Debugging Guide - "Still Line" Issue

## Current Status

✅ **Residency Detection**: WORKING - Returns 'platform' mode for 'location'  
✅ **API Changes**: Applied - `appId` parameter added  
❓ **Frontend**: Still showing "Line 1", "Line 2", "Line 3"

## Possible Causes

### 1. Browser Cache (Most Likely)
The browser may have cached the old `api.js` file.

**Solution**:
1. Open browser DevTools (F12)
2. Go to Network tab
3. Check "Disable cache"
4. Hard refresh: **Ctrl + Shift + R** (or Cmd + Shift + R on Mac)
5. Check the request to `/api/entities` - does it include `appId=vms_app_v1`?

### 2. Frontend Not Reloaded
The JavaScript file might not have been reloaded by the browser.

**Solution**:
1. Clear browser cache completely
2. Close and reopen browser
3. Navigate to VMS dashboard again

### 3. VMS Local Database Has Hardcoded Entities
The VMS local database might have "Line 1", "Line 2", "Line 3" entities that are being returned even in platform mode.

**Check**:
Run this script:
```bash
python check_vms_entities.py
```

If it shows "Line 1", "Line 2", etc., those need to be deleted.

### 4. Platform Mode Not Being Used
Even though residency detector returns 'platform', the data provider might not be using it correctly.

**Check**:
Look at browser console for logs like:
```
[DataProvider.get_entities] Company ..., mode: platform
[DataProvider] Fetching entities from Platform
```

If you see `mode: app` instead, the residency detection is not working at runtime.

## Step-by-Step Debugging

### Step 1: Check Browser Console

1. Open VMS dashboard
2. Open DevTools (F12)
3. Go to Console tab
4. Look for these logs:
   ```
   [ResidencyDetector] Entity 'location': Always from Platform (platform mode)
   [DataProvider] Fetching entities from Platform
   [API/entities] GET /entities?companyId=...&appId=vms_app_v1
   ```

5. If you see `appId=null` or `appId=undefined`, the frontend change didn't load

### Step 2: Check Network Tab

1. Open DevTools → Network tab
2. Filter by "entities"
3. Refresh the page
4. Click on the `/api/entities` request
5. Check the Request URL - should include `&appId=vms_app_v1`

**Example**:
```
http://localhost:5001/api/entities?companyId=6827296ab6e06b08639107c4&appId=vms_app_v1
```

### Step 3: Check Response Data

1. In Network tab, click on `/api/entities` request
2. Go to "Response" tab
3. Check what entities are being returned
4. Do they have `type: "organization"` or `type: "line"`?

**Expected** (if working):
```json
[
  {
    "_id": "...",
    "name": "JBM Auto",
    "type": "organization"
  },
  {
    "_id": "...",
    "name": "Manesar Plant",
    "type": "organization"
  }
]
```

**Wrong** (if not working):
```json
[
  {
    "_id": "...",
    "name": "Line 1 - Manesar Plant",
    "type": "line"
  }
]
```

### Step 4: Force Clear Cache

If hard refresh doesn't work:

**Chrome/Edge**:
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

**Firefox**:
1. Ctrl + Shift + Delete
2. Select "Cache"
3. Click "Clear Now"
4. Refresh page

### Step 5: Check if Platform Has Organizations

The Platform might not have any organizations!

**Check**:
1. Go to Platform UI: `http://localhost:5000`
2. Navigate to Entities
3. Check if there are any entities with `type: "organization"`

If there are NO organizations in the Platform, the dropdown will be empty or fall back to local data.

## Quick Fix Commands

### Clear VMS Local Entities (if they exist)
```python
# Run this in Python console
from app.db import entities_collection
from bson import ObjectId

company_id = "6827296ab6e06b08639107c4"
result = entities_collection.delete_many({
    '$or': [
        {'companyId': ObjectId(company_id)},
        {'companyId': company_id}
    ]
})
print(f"Deleted {result.deleted_count} local entities")
```

### Test API Directly
```bash
# Test the API endpoint directly
curl "http://localhost:5001/api/entities?companyId=6827296ab6e06b08639107c4&appId=vms_app_v1"
```

## Expected Behavior

When working correctly, you should see:

1. **Console logs**:
   ```
   [ResidencyDetector] Entity 'location': Always from Platform (platform mode)
   [DataProvider] Fetching entities from Platform
   [DataProvider] Allowed entity types from manifest: ['organization']
   ```

2. **Network request**:
   ```
   GET /api/entities?companyId=...&appId=vms_app_v1
   ```

3. **Response**:
   ```json
   [{"name": "JBM Auto", "type": "organization"}, ...]
   ```

4. **Dropdown**:
   ```
   All Entities
   JBM Auto (organization)
   Manesar Plant (organization)
   ```

## If Still Not Working

Please provide:
1. Screenshot of browser Console tab
2. Screenshot of Network tab showing `/api/entities` request
3. Screenshot of Response tab for `/api/entities`
4. Output of `python check_vms_entities.py`

This will help identify exactly where the issue is.

---

**Most Likely Issue**: Browser cache. Try **Ctrl + Shift + R** first!
