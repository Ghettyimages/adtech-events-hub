# Fix Prisma Generate Permission Error on Windows
# Run this script from PowerShell

Write-Host "Attempting to fix Prisma generate permission error..." -ForegroundColor Yellow

# Check if Node processes are running
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Found running Node processes. Stopping them..." -ForegroundColor Yellow
    Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Remove .prisma client folder
if (Test-Path "node_modules\.prisma\client") {
    Write-Host "Removing existing .prisma client folder..." -ForegroundColor Yellow
    Remove-Item -Path "node_modules\.prisma\client" -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Try to generate
Write-Host "Attempting to generate Prisma client..." -ForegroundColor Green
npx prisma generate

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Prisma client generated successfully!" -ForegroundColor Green
} else {
    Write-Host "`n❌ Generation failed. Try these solutions:" -ForegroundColor Red
    Write-Host "1. Close Cursor/VS Code completely and run this script again" -ForegroundColor Yellow
    Write-Host "2. Run PowerShell as Administrator and try again" -ForegroundColor Yellow
    Write-Host "3. Check FIX_PRISMA_GENERATE.md for more solutions" -ForegroundColor Yellow
}


