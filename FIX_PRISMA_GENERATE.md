# Fixing Prisma Generate Permission Error on Windows

## Quick Fix Steps

### Option 1: Close IDE and Regenerate (Recommended)
1. **Close Cursor/VS Code completely**
2. Open PowerShell in the project directory
3. Run: `npx prisma generate`
4. Reopen your IDE

### Option 2: Run PowerShell as Administrator
1. **Right-click PowerShell** → "Run as Administrator"
2. Navigate to your project: `cd C:\Users\aster\Documents\Adtech-events-hub\adtech-events-hub`
3. Run: `npx prisma generate`

### Option 3: Use a Different Terminal
1. Close Cursor
2. Open **Command Prompt** (cmd) or **Git Bash**
3. Navigate to project directory
4. Run: `npx prisma generate`

### Option 4: Temporarily Exclude from Antivirus
1. Add `node_modules\.prisma` folder to your antivirus exclusions
2. Try `npx prisma generate` again

### Option 5: Manual Workaround
If none of the above work, you can manually copy the generated files:

```powershell
# Stop all Node processes
taskkill /F /IM node.exe 2>$null

# Delete .prisma folder
Remove-Item -Path "node_modules\.prisma" -Recurse -Force -ErrorAction SilentlyContinue

# Generate (if it fails, the files are still in a temp location)
npx prisma generate
```

## Why This Happens

Windows locks `.dll.node` files when:
- An IDE has the file open in memory
- A Node process is running (dev server)
- Antivirus is scanning the file
- Windows Explorer has a folder open

## After Generating Successfully

Once `prisma generate` completes, you can:
1. Run the migration: `npx prisma migrate dev`
2. Seed the tags: `npx tsx scripts/seed-tags.ts`
3. Start your dev server: `npm run dev`


