# VMS Data Residency - Deployment Guide

## Overview

This guide covers deploying the robust data residency architecture to production.

## Pre-Deployment Checklist

- [ ] Review implementation plan
- [ ] Review walkthrough documentation
- [ ] Backup VMS database
- [ ] Backup Platform database
- [ ] Verify environment variables are set

## Environment Variables

Ensure these are set in production (Vercel):

```bash
# Platform Integration
PLATFORM_API_URL=https://face-recognition-server-01.vercel.app
PLATFORM_WEB_URL=https://face-recognition-server-01.vercel.app
PLATFORM_JWT_SECRET=supersecret  # Must match Platform's JWT_SECRET

# VMS Configuration
JWT_SECRET=vms-production-secret
VMS_MONGODB_URI=mongodb+srv://...
```

## Deployment Steps

### 1. Push Code to GitHub

```bash
git push origin main
```

Vercel will auto-deploy.

### 2. Run Cleanup Script (DRY RUN)

First, run in dry-run mode to see what would be deleted:

```bash
python cleanup_duplicates.py
```

Review the output carefully.

### 3. Run Cleanup Script (LIVE)

If dry-run looks correct, run live cleanup:

```bash
python cleanup_duplicates.py --live
```

This will delete duplicate data based on residency mode.

### 4. Start Background Worker (Optional)

If you want automatic sync queue processing:

```bash
# In a separate terminal or as a background service
python -m app.workers.sync_queue_worker
```

Or add to your process manager (PM2, systemd, etc.).

### 5. Verify Deployment

Test employee registration in both modes:

**Platform Mode:**
```bash
curl -X POST https://visitor-management-system-pearl.vercel.app/api/employees \
  -H "Authorization: Bearer <token>" \
  -F "companyId=6827296ab6e06b08639107c4" \
  -F "employeeId=TEST001" \
  -F "employeeName=Test Employee"
```

Expected: 201 response, employee created on Platform, VMS DB empty.

**App Mode:**
```bash
# For a company in app mode
curl -X POST http://localhost:5001/api/employees \
  -H "Authorization: Bearer <token>" \
  -F "companyId=<app_mode_company_id>" \
  -F "employeeId=TEST002" \
  -F "employeeName=Test Employee 2"
```

Expected: 201 response, employee created in VMS DB, no Platform call.

## Monitoring

### Check Sync Queue Stats

```python
from app.services.sync_queue import SyncQueue

stats = SyncQueue.get_stats()
print(stats)
# {'pending': 0, 'processing': 0, 'failed': 0}
```

### Verify Zero Duplication

```python
from app.services.residency_detector import ResidencyDetector
from app.db import employees_collection

company_id = '6827296ab6e06b08639107c4'
mode = ResidencyDetector.get_mode(company_id, 'employee')

if mode == 'platform':
    # Should be 0
    count = employees_collection.count_documents({'companyId': company_id})
    print(f"VMS DB count (should be 0): {count}")
```

## Rollback Plan

If issues occur:

1. **Revert code:**
   ```bash
   git revert HEAD~3..HEAD
   git push origin main
   ```

2. **Restore database from backup**

3. **Clear sync queue:**
   ```python
   from app.db import db
   db['sync_queue'].delete_many({})
   ```

## Troubleshooting

### Issue: Platform Down During Registration

**Symptom:** 202 response with queueId

**Solution:** This is expected behavior. Background worker will retry.

**Check queue:**
```python
from app.services.sync_queue import SyncQueue
SyncQueue.get_stats()
```

### Issue: Duplicate Data Still Exists

**Symptom:** Data in both VMS and Platform

**Solution:** Run cleanup script again:
```bash
python cleanup_duplicates.py <company_id> --live
```

### Issue: Embedding Not Found

**Symptom:** 404 when downloading embedding

**Solution:** Check residency mode and verify embedding is in correct location:
- Platform mode: Should be on Platform
- App mode: Should be in VMS GridFS

## Success Criteria

- ✅ Zero data duplication (Platform mode: 0 records in VMS DB)
- ✅ All employee registrations working
- ✅ Sync queue processing correctly
- ✅ Embedding downloads working
- ✅ No errors in logs

## Support

For issues, check:
1. Vercel logs
2. VMS application logs
3. Sync queue stats
4. Database state

---

**Deployment Complete!** 🎉
