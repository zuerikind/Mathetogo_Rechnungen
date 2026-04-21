# Nachhilfe Tracker — daily database backup to Google Drive
$source = "$PSScriptRoot\prisma\dev.db"
$dest   = "H:\Meine Ablage\Daten von tracker"
$date   = Get-Date -Format "yyyy-MM-dd"
$file   = "nachhilfe-$date.db"

if (-not (Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest | Out-Null
}

Copy-Item -Path $source -Destination "$dest\$file" -Force

# Keep only the 30 most recent backups
Get-ChildItem -Path $dest -Filter "nachhilfe-*.db" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 7 |
    Remove-Item -Force

Write-Output "$(Get-Date) - backup saved: $dest\$file"
