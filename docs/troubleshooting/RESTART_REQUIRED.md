# RESTART REQUIRED

## The Issue

The VMS server is still running the OLD code without the authentication fix.

## What Changed

I just fixed the authentication issue in `data_provider.py` (3 minutes ago), but the server has been running for 13+ minutes with the old code.

## Solution

**RESTART THE VMS SERVER**:

1. Find the terminal running VMS (port 5001)
2. Press **Ctrl + C** to stop it
3. Run: `python run.py`
4. Wait for "Running on http://127.0.0.1:5001"
5. Refresh browser (Ctrl + Shift + R)

## What to Expect After Restart

### In Platform Server Logs:
```
GET /bharatlytics/v1/entities?companyId=...&appId=vms_app_v1 HTTP/1.1" 200
```
(Should be 200, not 401!)

### In Browser Console:
```javascript
state.entities: [{name: "JBM Auto", type: "organization"}, ...]
```
(Should have data, not empty array!)

### In Dropdown:
```
All Entities
JBM Auto (organization)
Manesar Plant (organization)
```
(Should show organizations, not empty!)

---

**The fix is in the code, but the server needs to restart to use it!**
