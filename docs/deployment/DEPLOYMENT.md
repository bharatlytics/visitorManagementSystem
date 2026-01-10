# VMS Production Deployment - Environment Variables

## Issue
Production VMS on Vercel is trying to connect to `http://localhost:5000` for the Platform API, which doesn't exist in production.

## Solution
Set the correct Platform URL in Vercel environment variables.

## Steps to Fix

### 1. Get Your Platform Production URL
First, determine where your Platform (faceRecognitionServer) is deployed:
- If on Vercel: `https://your-platform-app.vercel.app`
- If on another service: Use that URL

### 2. Set Environment Variables in Vercel

Go to your Vercel dashboard:
1. Navigate to your VMS project
2. Go to **Settings** → **Environment Variables**
3. Add the following variables:

| Variable Name | Value (Example) | Description |
|--------------|-----------------|-------------|
| `PLATFORM_API_URL` | `https://your-platform.vercel.app` | Platform API endpoint |
| `PLATFORM_WEB_URL` | `https://your-platform.vercel.app` | Platform web URL for navigation |
| `PLATFORM_JWT_SECRET` | `your-secret-key` | Must match Platform's JWT_SECRET |
| `JWT_SECRET` | `your-vms-secret` | VMS JWT secret |
| `VMS_MONGODB_URI` | `mongodb+srv://...` | MongoDB connection string |

**Important:** Make sure `PLATFORM_JWT_SECRET` matches the `JWT_SECRET` used by your Platform deployment!

### 3. Redeploy

After setting the environment variables:
1. Go to **Deployments** tab
2. Click on the latest deployment
3. Click **Redeploy**

Or simply push a new commit:
```bash
git commit --allow-empty -m "Trigger redeploy with env vars"
git push origin main
```

### 4. Verify

Test the embedding endpoint:
```bash
curl "https://visitor-management-system-pearl.vercel.app/api/visitors/embeddings/{id}" \
  -H "Authorization: Bearer {your_token}"
```

## Current Configuration

**Development (localhost):**
- VMS: `http://localhost:5001`
- Platform: `http://localhost:5000`

**Production (Vercel):**
- VMS: `https://visitor-management-system-pearl.vercel.app`
- Platform: `???` ← **YOU NEED TO SET THIS**

## Quick Reference

The embedding endpoint flow:
1. Mobile app → VMS (`/api/visitors/embeddings/{id}`)
2. VMS checks residency mode
3. If `platform` mode → VMS proxies to Platform
4. Platform URL comes from `PLATFORM_API_URL` env var
5. Platform serves embedding from GridFS

**Without the correct `PLATFORM_API_URL`, VMS can't reach the Platform!**
