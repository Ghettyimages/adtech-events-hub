# Deployment Guide - AdTech Events Hub

## Quick Start (Local Development)

1. **Clone and Install**
   ```bash
   git clone <your-repo>
   cd adtech-events-hub
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Database Setup**
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   npm run seed data/sample-events.csv  # Optional: load sample data
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000

## Production Deployment

### Option 1: Vercel (Recommended for Next.js)

1. **Push to GitHub**
   ```bash
   git push origin main
   ```

2. **Connect to Vercel**
   - Go to https://vercel.com
   - Import your GitHub repository
   - Vercel auto-detects Next.js settings

3. **Configure Environment Variables**
   Add these in Vercel Dashboard → Settings → Environment Variables:
   ```
   DATABASE_URL=file:./prod.db
   SITE_URL=https://your-app.vercel.app
   DEFAULT_TIMEZONE=America/New_York
   ```

4. **Database Considerations**
   - SQLite works for MVP but consider upgrading to:
     - **Vercel Postgres** (recommended for production)
     - **Turso** (distributed SQLite)
     - **PlanetScale** (MySQL)
   
   Update Prisma schema and DATABASE_URL accordingly.

5. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - Access your app at the provided URL

6. **GitHub Actions**
   - Add `SITE_URL` secret in GitHub repo settings
   - Weekly refresh will run automatically every Monday at 7am UTC

### Option 2: Render

1. **Create Render Account**
   - Go to https://render.com
   - Create a new Web Service

2. **Configure Service**
   - **Build Command**: `npm install && npm run prisma:generate && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node 18+

3. **Environment Variables**
   ```
   DATABASE_URL=file:./prod.db
   SITE_URL=https://your-app.onrender.com
   DEFAULT_TIMEZONE=America/New_York
   ```

4. **Persistent Storage**
   - Add a disk mount for SQLite database
   - Mount path: `/app/prisma`
   - This ensures database persists across deploys

5. **Deploy**
   - Connect GitHub repo
   - Render auto-deploys on push to main

### Option 3: Fly.io

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login and Initialize**
   ```bash
   fly auth login
   fly launch
   ```

3. **Configure `fly.toml`**
   ```toml
   [env]
     NODE_ENV = "production"
     SITE_URL = "https://your-app.fly.dev"
     DEFAULT_TIMEZONE = "America/New_York"

   [mounts]
     source = "adtech_data"
     destination = "/app/prisma"
   ```

4. **Set Secrets**
   ```bash
   fly secrets set DATABASE_URL="file:/app/prisma/prod.db"
   ```

5. **Create Volume**
   ```bash
   fly volumes create adtech_data
   ```

6. **Deploy**
   ```bash
   fly deploy
   ```

## Database Migration Strategy

### For Production Database Changes

1. **Create Migration Locally**
   ```bash
   npx prisma migrate dev --name your_migration_name
   ```

2. **Test Migration**
   - Run locally first
   - Verify data integrity

3. **Deploy Migration**
   
   **Vercel/Render**: Push to git, migrations run on build
   
   **Fly.io**: SSH and run manually
   ```bash
   fly ssh console
   npm run prisma:migrate deploy
   ```

### Upgrading from SQLite to PostgreSQL

1. **Update `prisma/schema.prisma`**
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. **Export SQLite Data**
   ```bash
   npx prisma db pull
   npx prisma generate
   # Export data using custom script or Prisma Studio
   ```

3. **Set PostgreSQL DATABASE_URL**
   ```
   DATABASE_URL="postgresql://user:password@host:5432/dbname"
   ```

4. **Run Migrations**
   ```bash
   npx prisma migrate dev
   ```

5. **Re-import Data**
   ```bash
   npm run seed data/your-events.csv
   ```

## GitHub Actions Setup

### Weekly Refresh Workflow

Already configured in `.github/workflows/weekly-refresh.yml`

**Required GitHub Secret**:
- `SITE_URL`: Your production URL

**To Add Secret**:
1. Go to GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `SITE_URL`
4. Value: `https://your-app.vercel.app`

### Manual Trigger

You can manually trigger the refresh:
1. Go to Actions tab in GitHub
2. Select "Weekly Calendar Refresh"
3. Click "Run workflow"

## Post-Deployment Checklist

- [ ] Test home page loads with calendar
- [ ] Test event submission at /submit
- [ ] Verify event appears as PENDING
- [ ] Test admin approval at /admin
- [ ] Verify approved event shows on calendar
- [ ] Test "Add to Google Calendar" button
- [ ] Test iCal feed download at /api/feed
- [ ] Verify Google Calendar subscription link works
- [ ] Test GitHub Actions weekly refresh
- [ ] Monitor logs for any errors
- [ ] Set up monitoring/alerting (optional)

## Monitoring & Maintenance

### Vercel
- Dashboard shows builds, errors, and analytics
- Configure alerts in Settings

### Render
- Logs available in dashboard
- Set up email/Slack notifications

### Fly.io
- View logs: `fly logs`
- Monitor health: `fly status`

## Scaling Considerations

### When to Upgrade

Upgrade from SQLite when:
- Database exceeds 1GB
- Concurrent write operations increase
- Need multi-region deployment
- Want better backup/restore

### Recommended Upgrades

1. **Database**: PostgreSQL (Vercel/Supabase) or MySQL (PlanetScale)
2. **CDN**: Vercel Edge Network or CloudFlare
3. **Caching**: Redis for event data
4. **Search**: Algolia or Elasticsearch for advanced filtering
5. **Auth**: NextAuth.js or Clerk for admin panel
6. **Analytics**: Vercel Analytics or Google Analytics

## Troubleshooting

### Build Fails

**Error**: Prisma client not generated
```bash
npm run prisma:generate
```

**Error**: Missing environment variables
- Check .env file exists
- Verify all required vars are set

### Database Issues

**Error**: Database locked
- SQLite doesn't handle concurrent writes well
- Consider upgrading to PostgreSQL

**Error**: Migration failed
```bash
npx prisma migrate reset  # ⚠️ Deletes all data!
npm run prisma:migrate
```

### Runtime Errors

**Error**: API routes return 500
- Check server logs
- Verify DATABASE_URL is correct
- Ensure Prisma client is generated

**Error**: Calendar doesn't load
- Check browser console for errors
- Verify /api/events returns data
- Test API endpoint directly

## Backup Strategy

### SQLite Backup

**Manual Backup**:
```bash
cp prisma/dev.db prisma/backup-$(date +%Y%m%d).db
```

**Automated Backup** (add to cron or GitHub Actions):
```yaml
- name: Backup Database
  run: |
    curl https://your-app.com/api/events > backup-events.json
```

### PostgreSQL Backup

Use your hosting provider's backup features:
- **Vercel Postgres**: Automatic daily backups
- **Supabase**: Point-in-time recovery
- **Heroku**: Automatic backups with paid plans

## Security Hardening

### Before Production

1. **Add Authentication to /admin**
   ```bash
   npm install next-auth @auth/prisma-adapter
   ```

2. **Rate Limiting**
   ```bash
   npm install @upstash/ratelimit
   ```

3. **CORS Configuration**
   Update `next.config.mjs`:
   ```js
   headers: async () => [
     {
       source: '/api/:path*',
       headers: [
         { key: 'Access-Control-Allow-Origin', value: 'your-domain.com' },
       ],
     },
   ]
   ```

4. **API Key for /api/revalidate**
   ```typescript
   const authHeader = request.headers.get('authorization');
   if (authHeader !== `Bearer ${process.env.REVALIDATE_SECRET}`) {
     return new Response('Unauthorized', { status: 401 });
   }
   ```

5. **HTTPS Only**
   Ensure all production deployments use HTTPS

## Cost Estimation

### Free Tier (Good for MVP)
- **Vercel**: Free for personal projects, 100GB bandwidth
- **Render**: Free tier available with limits
- **Fly.io**: Free allowance for small apps

### Paid Options (Recommended for Production)
- **Vercel Pro**: $20/month, better limits
- **Render Standard**: $7-25/month depending on usage
- **Fly.io**: Pay-as-you-go, ~$5-15/month for small app

### Database Costs
- **SQLite**: Free (file-based)
- **Vercel Postgres**: $20/month for starter
- **PlanetScale**: Free tier available, $29/month for prod
- **Supabase**: Free tier available, $25/month for pro

## Support & Resources

- **Next.js Docs**: https://nextjs.org/docs
- **Prisma Docs**: https://www.prisma.io/docs
- **Vercel Docs**: https://vercel.com/docs
- **Render Docs**: https://render.com/docs
- **Fly.io Docs**: https://fly.io/docs

For issues with this project, check the main README.md or open a GitHub issue.

---

**Last Updated**: 2025-10-30  
**Version**: 1.0.0
