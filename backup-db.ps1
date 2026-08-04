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
$bucket    = "invoices"

# Die PDFs liegen in EINEM mitwachsenden Ordner, nicht in einem pro Tag: die
# Objekte sind unveraenderlich, taegliche Kopien waeren 14 mal dasselbe.
# Der Name endet nicht auf .dump und faellt damit nicht unter die Rotation.
$pdfDir    = Join-Path $dest "mathetogo-pdfs"

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

# Einen Wert aus .env.local lesen, ohne ihn auszugeben.
function Get-EnvValue([string]$name) {
    $line = Select-String -Path $envFile -Pattern "^\s*$name\s*=" | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line.Line -replace "^\s*$name\s*=\s*", '').Trim().Trim('"').Trim("'")
}

$dbUrl = Get-EnvValue "DATABASE_URL"
if (-not $dbUrl) { throw "DATABASE_URL steht nicht in .env.local" }

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

# ---------------------------------------------------------------------------
# Teil 1: Datenbank
#
# Beide Teile laufen getrennt und lassen ihren Fehler nicht nach aussen. Vorher
# beendete $ErrorActionPreference = "Stop" das ganze Skript beim ersten Fehler -
# ein Ausfall des Storage haette damit ein bereits geschriebenes, geprueftes
# Dump mitgerissen. Was fertig ist, bleibt liegen; gemeldet wird pro Teil.
# ---------------------------------------------------------------------------
$dbOk   = $false
$dbInfo = ""
try {
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

    $dbOk   = $true
    $dbInfo = "$file ($sizeKb KB, $tables Tabellen)"
} catch {
    $dbInfo = $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Teil 2: die Rechnungs-PDFs
#
# pg_dump sichert die Datenbank, nicht die Dateien: unter storage.objects steht
# nur die Metadatenzeile, die Bytes liegen im Bucket. Ginge der Bucket verloren,
# wuesste die Datenbank nur noch, dass es die Belege gab - bei einem System,
# dessen Regel bytegleich erhaltene r1-PDFs sind, ist das der teuerste Verlust.
#
# Die Objekte sind unveraenderlich (versionierte Pfade, r1 bleibt bytegleich),
# deshalb genuegt "laden was lokal fehlt" - ein Hash-Vergleich waere Aufwand
# ohne Aussage.
# ---------------------------------------------------------------------------
$pdfOk   = $false
$pdfInfo = ""
try {
    $supaUrl = Get-EnvValue "SUPABASE_URL"
    $supaKey = Get-EnvValue "SUPABASE_SERVICE_ROLE_KEY"
    if (-not $supaUrl -or -not $supaKey) {
        throw "SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local"
    }
    $supaUrl = $supaUrl.TrimEnd('/')
    if (-not (Test-Path $pdfDir)) { New-Item -ItemType Directory -Path $pdfDir | Out-Null }

    $headers = @{ apikey = $supaKey; Authorization = "Bearer $supaKey" }

    # Bewusst ueber die Storage-API aufgelistet und nicht per SQL: sonst haenge
    # der PDF-Teil an derselben Verbindung wie das Dump und fiele mit ihr aus.
    # Die Objekte liegen flach im Bucket, deshalb reicht Blaettern ohne Rekursion.
    $names  = @()
    $offset = 0
    $page   = 100
    while ($true) {
        $body = @{ prefix = ""; limit = $page; offset = $offset } | ConvertTo-Json
        $batch = Invoke-RestMethod -Method Post -Uri "$supaUrl/storage/v1/object/list/$bucket" `
                                   -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing
        $count = @($batch).Count
        if ($count -eq 0) { break }
        $names += @($batch) | Where-Object { $_.id } | ForEach-Object { $_.name }
        if ($count -lt $page) { break }
        $offset += $page
    }

    # Ein leeres Ergebnis waere sonst ein stiller Erfolg - und der naechste Lauf
    # meldete "0 fehlgeschlagen", obwohl nichts gesichert ist.
    if ($names.Count -eq 0) { throw "Bucket '$bucket' lieferte keine Objekte." }

    $have = 0; $new = 0; $failed = 0
    foreach ($name in $names) {
        $local = Join-Path $pdfDir $name
        if ((Test-Path $local) -and (Get-Item $local).Length -gt 0) { $have++; continue }

        $dir = Split-Path $local -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

        # Erst nach .part laden, dann umbenennen: ein abgebrochener Download darf
        # beim naechsten Lauf nicht als fertige Datei durchgehen und uebersprungen
        # werden - das waere ein lueckenhaftes Backup, das vollstaendig aussieht.
        $part = "$local.part"
        try {
            $enc = ($name.Split([char]47) | ForEach-Object { [Uri]::EscapeDataString($_) }) -join [char]47
            Invoke-WebRequest -Uri "$supaUrl/storage/v1/object/$bucket/$enc" `
                              -Headers $headers -OutFile $part -UseBasicParsing
            if ((Get-Item $part).Length -eq 0) { throw "0 Bytes erhalten" }
            Move-Item -LiteralPath $part -Destination $local -Force
            $new++
        } catch {
            if (Test-Path $part) { Remove-Item -LiteralPath $part -Force }
            $failed++
            Write-Warning "PDF fehlgeschlagen: $name - $($_.Exception.Message)"
        }
    }

    $pdfOk   = ($failed -eq 0)
    $pdfInfo = "$($names.Count) im Bucket, $have vorhanden, $new neu geladen, $failed fehlgeschlagen"
} catch {
    $pdfInfo = $_.Exception.Message
}

Write-Output ""
Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm') - Backup"
Write-Output ("  Datenbank : " + $(if ($dbOk)  { "ok      $dbInfo"  } else { "FEHLER  $dbInfo"  }))
Write-Output ("  PDFs      : " + $(if ($pdfOk) { "ok      $pdfInfo" } else { "FEHLER  $pdfInfo" }))
Write-Output "  Ziel      : $dest"

# Exit-Code meldet den Gesamtlauf, aber erst nachdem beide Teile gelaufen sind.
if (-not $dbOk -or -not $pdfOk) { exit 1 }
