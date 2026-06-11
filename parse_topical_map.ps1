param(
    [string]$XlsxPath = "Refined Topical Map - TransCure (Master).xlsx",
    [string]$OutJson  = "topical-map-data.json"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$full = (Resolve-Path $XlsxPath).Path
$zip  = [System.IO.Compression.ZipFile]::OpenRead($full)

function Read-Entry($zip, $name) {
    $e = $zip.Entries | Where-Object { $_.FullName -eq $name }
    if (-not $e) { return $null }
    $sr = New-Object System.IO.StreamReader($e.Open())
    $txt = $sr.ReadToEnd()
    $sr.Close()
    return $txt
}

# Map sheetId/name -> worksheet file via workbook + rels
$wbXml = [xml](Read-Entry $zip "xl/workbook.xml")
$relXml = [xml](Read-Entry $zip "xl/_rels/workbook.xml.rels")
$relMap = @{}
foreach ($r in $relXml.Relationships.Relationship) { $relMap[$r.Id] = $r.Target }

# We only need the master sheet (first one)
$firstSheet = $wbXml.workbook.sheets.sheet | Select-Object -First 1
$rid = $firstSheet.id
if (-not $rid) { $rid = $firstSheet.GetAttribute("id","http://schemas.openxmlformats.org/officeDocument/2006/relationships") }
$target = $relMap[$rid]
$target = $target.TrimStart('/')
if ($target -notlike "xl/*") { $target = "xl/$target" }
Write-Host "Master sheet -> $target ($($firstSheet.name))"

$sheetXml = [xml](Read-Entry $zip $target)
$zip.Dispose()

function Col-Letters([string]$cellRef) {
    ($cellRef -replace '[0-9]','')
}

# Column letter -> header text (from row 1)
$headers = @{}
$rows = $sheetXml.worksheet.sheetData.row
$row1 = $rows | Where-Object { $_.r -eq "1" } | Select-Object -First 1
foreach ($c in $row1.c) {
    $col = Col-Letters $c.r
    $val = ""
    if ($c.is -and $c.is.t) { $val = [string]$c.is.t.'#text'; if (-not $val) { $val = [string]$c.is.t } }
    $headers[$col] = $val
}

$records = New-Object System.Collections.ArrayList
foreach ($row in $rows) {
    if ($row.r -eq "1") { continue }
    $obj = [ordered]@{}
    foreach ($c in $row.c) {
        $col = Col-Letters $c.r
        $key = $headers[$col]
        if (-not $key) { continue }
        $val = ""
        if ($c.t -eq "inlineStr" -and $c.is) {
            $t = $c.is.t
            if ($t -is [System.Xml.XmlElement]) { $val = [string]$t.'#text' } else { $val = [string]$t }
        } elseif ($null -ne $c.v) {
            $val = [string]$c.v
        }
        $obj[$key] = $val
    }
    # keep rows that have a Slug or Topic
    $slug = $obj['Slug']
    $topic = $obj['Topics']
    if (($slug -and $slug.Trim()) -or ($topic -and $topic.Trim())) {
        [void]$records.Add($obj)
    }
}

Write-Host "Parsed $($records.Count) data rows."
$json = $records | ConvertTo-Json -Depth 4
if (-not [System.IO.Path]::IsPathRooted($OutJson)) { $OutJson = Join-Path (Get-Location) $OutJson }
[System.IO.File]::WriteAllText($OutJson, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $OutJson"
