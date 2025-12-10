# Deployment Fixes Summary

## Issues Identified

1. **Dependency Conflict**: `next-auth@4.24.7` doesn't support Next.js 16
2. **Database Error**: User table doesn't exist in production database
3. **Auth Configuration**: Code was using NextAuth v4 API which is incompatible

## Fixes Applied

### 1. Upgraded to Auth.js v5 (next-auth v5)

**Changed:**
- `package.json`: Updated `next-auth` from `^4.24.7` to `^5.0.0-beta.25`

**Why:** Auth.js v5 (next-auth v5) supports Next.js 16, while v4 only supports up to Next.js 14.

### 2. Updated Auth Configuration

**Files Changed:**
- `src/lib/auth.ts`: Migrated from NextAuth v4 to Auth.js v5 API
  - Changed from `NextAuth(authOptions)` to `NextAuth({ ... })`
  - Updated provider imports (`CredentialsProvider` → `Credentials`, `GoogleProvider` → `Google`)
  - Changed exports to use new v5 pattern: `export const { handlers, signIn, signOut, auth } = NextAuth({ ... })`
  - Updated secret to use `AUTH_SECRET` (with fallback to `NEXTAUTH_SECRET`)

- `src/app/api/auth/[...nextauth]/route.ts`: Updated route handler
  - Changed from `export const GET = handlers; export const POST = handlers;`
  - To: `export const { GET, POST } = handlers;`

### 3. Updated Server-Side Session Usage

**Files Updated:** All API routes that used `getServerSession(authOptions)`:
- `src/app/api/events/route.ts`
- `src/app/api/profile/route.ts`
- `src/app/api/follow/route.ts`
- `src/app/api/unfollow/route.ts`
- `src/app/api/subscriptions/route.ts`
- `src/app/api/subscriptions/status/route.ts`
- `src/app/api/subscriptions/full/toggle/route.ts`
- `src/app/api/subscriptions/custom/filter/route.ts`
- `src/app/api/mine/gcal/status/route.ts`
- `src/app/api/mine/gcal/sync/route.ts`

**Changes:**
- Replaced `import { getServerSession } from 'next-auth'` with `import { auth } from '@/lib/auth'`
- Removed `import { authOptions } from '@/lib/auth'`
- Changed `await getServerSession(authOptions)` to `await auth()`

**Note:** Client-side code using `useSession` from `next-auth/react` doesn't need changes - it's compatible with v5.

## Database Migration Issue

### Problem
The error `Invalid prisma.user.findUnique() invocation: The table public.User does not exist` indicates that database migrations haven't been applied to the production database.

### Solution

**For Vercel/Production Deployment:**

1. **Verify Build Script**: The `package.json` already has the correct build script:
   ```json
   "build": "prisma migrate deploy && next build"
   ```
   This should automatically run migrations during deployment.

2. **Check Environment Variables**: Ensure `DATABASE_URL` is set correctly in your deployment platform.

3. **Manual Migration (if needed)**: If migrations still don't run automatically:
   ```bash
   npx prisma migrate deploy
   ```

4. **Verify Database Connection**: Make sure your production database is accessible and the connection string is correct.

### Migration Files Present
The following migrations exist and should create the User table:
- `20251203190745_add_auth_models/migration.sql` - Creates User, Account, Session, VerificationToken tables
- `20251209170459_add_password_and_linkedin/migration.sql` - Adds password and linkedInProfile fields

## Environment Variables

### Required Variables

Make sure these are set in your deployment platform (Vercel, etc.):

1. **AUTH_SECRET** (or NEXTAUTH_SECRET as fallback)
   - Generate a random secret: `openssl rand -base64 32`
   - This is required for Auth.js to sign and encrypt tokens

2. **DATABASE_URL**
   - Your PostgreSQL connection string
   - Format: `postgresql://user:password@host:port/database`

3. **GOOGLE_CLIENT_ID** (optional, for Google OAuth)
4. **GOOGLE_CLIENT_SECRET** (optional, for Google OAuth)

## Testing Checklist

After deployment, verify:

- [ ] `npm install` completes without errors
- [ ] Build completes successfully (`npm run build`)
- [ ] Database migrations run during build
- [ ] User table exists in production database
- [ ] Sign up page works (`/signup`)
- [ ] Login page works (`/login`)
- [ ] Credentials authentication works
- [ ] Google OAuth works (if configured)
- [ ] Session persists after login
- [ ] Protected routes work correctly

## Next Steps

1. **Deploy the changes** to your platform
2. **Monitor the build logs** to ensure migrations run successfully
3. **Test signup/login** functionality
4. **Check database** to verify tables were created
5. **Set AUTH_SECRET** environment variable if not already set

## Troubleshooting

### If migrations still fail:

1. Check database connection string
2. Verify database user has CREATE TABLE permissions
3. Check if migrations table exists: `SELECT * FROM "_prisma_migrations";`
4. Try running migrations manually in production

### If auth still doesn't work:

1. Verify AUTH_SECRET is set
2. Check browser console for errors
3. Check server logs for authentication errors
4. Verify session cookies are being set

## Notes

- Client-side code (`useSession`, `signIn`, `signOut`) from `next-auth/react` works with both v4 and v5, so no changes were needed there
- The `SessionProvider` component also works with v5 without changes
- Database session strategy is still supported in v5

