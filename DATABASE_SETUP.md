# Database Setup for Vercel

## Problem
SQLite doesn't work on Vercel's serverless environment because:
- Functions are stateless (no persistent file system)
- SQLite requires a file system to store the database

## Solution: Use Vercel Postgres

### Step 1: Create Vercel Postgres Database

1. Go to your Vercel Dashboard: https://vercel.com/dashboard
2. Select your project
3. Go to **Storage** tab
4. Click **Create Database**
5. Select **Postgres**
6. Choose a plan (Hobby/Free tier is fine for development)
7. Name your database (e.g., "adtech-events")
8. Select a region close to your users
9. Click **Create**

### Step 2: Get Connection String

After creating the database:
1. Go to the **Storage** tab in your project
2. Click on your Postgres database
3. Go to the **.env.local** tab
4. Copy the `POSTGRES_PRISMA_URL` value - this is your `DATABASE_URL`

### Step 3: Add Environment Variable in Vercel

1. Go to your project **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name**: `DATABASE_URL`
   - **Value**: Paste the `POSTGRES_PRISMA_URL` from Step 2
   - **Environment**: Select all (Production, Preview, Development)
3. Click **Save**

### Step 4: Update Prisma Schema

The schema has been updated to use PostgreSQL. You'll need to:
1. Run migrations locally with the new DATABASE_URL
2. Push to GitHub
3. Vercel will automatically run migrations on deploy

### Step 5: Run Migrations

**Locally:**
```bash
# Set your local DATABASE_URL (use the POSTGRES_PRISMA_URL from Vercel)
export DATABASE_URL="your-postgres-connection-string"

# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate deploy
```

**On Vercel:**
- Migrations will run automatically if you add this to `package.json`:
  ```json
  "build": "prisma migrate deploy && next build"
  ```

## Alternative: Use Turso (Distributed SQLite)

If you prefer to stick with SQLite syntax:

1. Sign up at https://turso.tech
2. Create a database
3. Get the connection string
4. Update `DATABASE_URL` in Vercel
5. Update Prisma schema to use `libsql` provider

## Migration from SQLite to PostgreSQL

If you have existing data in SQLite:
1. Export data from SQLite using Prisma Studio or custom script
2. After setting up Postgres, import the data
3. Or use a migration tool to transfer data

