# Deployment Plan

Minimal deployment using Cloudflare Pages (frontend) + AWS App Runner (backend).

## Prerequisites

- Domain configured in Cloudflare DNS
- AWS account with App Runner access
- GitHub repo connected to both services

## Architecture

```
[Cloudflare Pages] → static frontend (app/)
         ↓
[AWS App Runner]  → Bun backend (server/)
         ↓
[S3 bucket]       → image uploads (optional)
```

## Step 1: Deploy Backend (AWS App Runner)

1. Use the repo `Dockerfile` (already present in the root).

2. In AWS Console → App Runner → Create Service:
   - Source: GitHub repo
   - Branch: `main`
   - Build: Use Dockerfile
   - Port: `4000`
   - Environment variables: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, optional storage envs.

3. Note the App Runner URL (e.g., `https://xxx.us-east-1.awsapprunner.com`)

## Step 2: Deploy Frontend (Cloudflare Pages)

1. In Cloudflare Dashboard → Pages → Create project:
   - Connect GitHub repo
   - Build command: `bun run build:client`
   - Build output: `app/dist`
   - Root directory: `/`

2. Add environment variables:
   - `VITE_MODEL_SERVICE_URL` = your App Runner URL from Step 1 (uploads + model calls)
   - `VITE_SERVER_URL` = your App Runner URL from Step 1 (API + voice)

3. Add custom domain in Pages settings

## Step 3: Configure CORS

Update `server/server.ts` to allow your production domain:
```typescript
const corsAllowlist = new Set([
  "https://yourdomain.com",
  "http://localhost:5173"
]);
```

## Step 4: (Optional) S3 for Uploads

1. Create S3 bucket with public read access
2. Add to App Runner environment:
   - `S3_BUCKET` = bucket name
   - `S3_PUBLIC_BASE_URL` = `https://bucket.s3.amazonaws.com` (direct CDN/S3 URLs)
   - Optional: `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_SIGNED_URL_EXPIRES`
   - AWS credentials via IAM role (App Runner handles this)

## Result

- Frontend auto-deploys on git push via Cloudflare Pages
- Backend auto-deploys on git push via App Runner
- SSL handled automatically by both services
- No servers to manage

## Cost Estimate

- Cloudflare Pages: Free tier (unlimited requests)
- App Runner: ~$5-15/month (pay per use, scales to zero optional)
- S3: ~$1-5/month depending on usage
