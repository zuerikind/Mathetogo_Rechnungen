# Nachhilfe Tracker - taegliches Backup der PostgreSQL-Datenbank nach Google Drive.
#
# Sicherte frueher prisma/dev.db. Diese SQLite-Datei ist seit dem Umzug auf
# Supabase tot - das taegliche Backup hat monatelang eine Datei kopiert, in der
# keine Produktivdaten mehr stehen. Jetzt: echtes pg_dump im Custom-Format.
#
# Verbindung ueber den IPv4-Session-Pooler (Port 5432). Der direkte Host aus
# DIRECT_URL (db.<ref>.supabase.co) ist hier nur ueber IPv6 erreichbar und
# laeuft deshalb in einen Timeout.
#
# Bewusst reines ASCII: PowerShell 5.1 liest .ps1 ohne BOM als ANSI, ein
# Gedankenstrich im Kommentar zerlegt dann den Parser.

$ErrorActionPreference = "Stop"

$dest      = "H:\Meine Ablage\Daten von tracker"
$keepCount = 14
$envFile   = "$PSScriptRoot\.env.local"
$date      = Get-Date -Format "yyyy-MM-dd"
$file      = "mathetogo-$date.dump"
$target    = Join-Path $dest $file

# Der PostgreSQL-Installer legt die Binaries nicht zwingend in den PATH. Erst dort
# suchen, dann in den Standard-Installationspfaden - und die neueste Version nehmen,
# denn pg_dump muss mindestens so neu sein wie der Server.
function Find-PgTool([string]$name) {
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Name -replace '\D','0') } -Descending |
        ForEach-Object { Join-Path $_.FullName "bin\$name.exe" } |
        Where-Object { Test-Path $_ }
    return $candidates | Select-Object -First 1
}

$pgDump    = Find-PgTool "pg_dump"
$pgRestore = Find-PgTool "pg_restore"
if (-not $pgDump) {
    throw "pg_dump nicht gefunden. PostgreSQL-Client installieren: winget install PostgreSQL.PostgreSQL.17"
}
if (-not (Test-Path $envFile)) { throw "Keine .env.local gefunden: $envFile" }

# DATABASE_URL lesen, ohne sie auszugeben.
$line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL steht nicht in .env.local" }
$dbUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")

# Auf den Session-Pooler umbiegen: Port 6543 (Transaction-Pooler, pgbouncer)
# kann kein pg_dump bedienen, 5432 auf demselben Host schon.
$uri = [System.Uri]$dbUrl
if ($uri.Host -notlike "*pooler.supabase.com") {
    Write-Warning "Host $($uri.Host) ist nicht der Pooler - bei IPv6-Problemen schlaegt der Dump fehl."
}
$builder = [System.UriBuilder]::new($uri)
$builder.Port = 5432
$builder.Query = "sslmode=require"
$conn = $builder.Uri.AbsoluteUri

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

# -Fc: Custom-Format, komprimiert und von pg_restore selektiv wiederherstellbar.
& $pgDump --dbname=$conn --format=custom --no-owner --no-privileges --file=$target
if ($LASTEXITCODE -ne 0) { throw "pg_dump ist mit Code $LASTEXITCODE fehlgeschlagen - kein Backup geschrieben." }

# Ein leeres oder abgeschnittenes Dump ist schlimmer als keines, weil es wie eines
# aussieht. Deshalb Groesse pruefen UND das Inhaltsverzeichnis lesen lassen.
$sizeKb = [math]::Round((Get-Item $target).Length / 1KB, 1)
if ($sizeKb -lt 20) {
    Remove-Item $target -Force
    throw "Dump war nur $sizeKb KB gross - verworfen."
}
$toc = if ($pgRestore) { & $pgRestore --list $target 2>&1 } else { @() }
if ($LASTEXITCODE -ne 0) {
    Remove-Item $target -Force
    throw "pg_restore --list konnte das Dump nicht lesen - verworfen."
}
$tables = ($toc | Select-String -Pattern "TABLE DATA").Count

# Alte Backups aufraeumen (der Kommentar sagte frueher 30, der Code behielt 7).
Get-ChildItem -Path $dest -Filter "mathetogo-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $keepCount |
    Remove-Item -Force

Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm') - Backup: $target ($sizeKb KB, $tables Tabellen)"
