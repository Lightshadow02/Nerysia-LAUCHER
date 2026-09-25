# Script PowerShell - Genere automatiquement le distribution.json
# depuis les fichiers presents sur le serveur (Y:\apk, drive FTP monte)
#
# Usage :
#   & "tools/generate-distribution.ps1" -Bump patch     # ou minor / major / sans param
#   & "tools/generate-distribution.ps1" -Bump patch -Force   # ignore la garde anti-scan-vide
#   & "tools/generate-distribution.ps1" -NoUpload            # genere en local sans publier
#
# Output : docs\distribution.json + copie vers Y:\apk\nerysia-laucher\distribution.json
#
# Toute la configuration (exclusions, bloc Fabric, infos serveur) est dans
# tools\distribution-config.json, partagee avec tools\generate-distribution-from-ftp.py.
# NB : fichier volontairement sans accents (evite les soucis d'encodage PowerShell 5.1).

param(
    [ValidateSet("none","patch","minor","major")]
    [string]$Bump = "none",
    [switch]$Force,
    [switch]$NoUpload
)

$ErrorActionPreference = "Stop"

$config       = Get-Content "$PSScriptRoot\distribution-config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$serverRoot   = $config.localServerRoot -replace "/", "\"
$baseUrl      = $config.baseUrl
$outputFile   = [System.IO.Path]::GetFullPath("$PSScriptRoot\..\docs\distribution.json")
$serverDest   = $config.localDistributionTarget -replace "/", "\"

# ----------------------------------------------------------------
# GARDE : refuse de tourner si le drive Y: n'est pas monte.
# Sinon le script ecrirait un distribution.json vide (0 mods) qui
# pourrait corrompre la version locale.
# ----------------------------------------------------------------
if (-not (Test-Path $serverRoot)) {
    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Red
    Write-Host "  ERREUR : Le drive Y: n'est pas monte !" -ForegroundColor Red
    Write-Host "==============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Chemin attendu : $serverRoot" -ForegroundColor Yellow
    Write-Host "  Statut         : INTROUVABLE" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Le script REFUSE de tourner pour eviter de corrompre" -ForegroundColor White
    Write-Host "  ton distribution.json local avec un fichier vide." -ForegroundColor White
    Write-Host ""
    Write-Host "  Action a faire :" -ForegroundColor Cyan
    Write-Host "    1. Monter ton drive Y: (FileZilla, mount FTP, etc.)" -ForegroundColor Cyan
    Write-Host "    2. Verifier dans l'explorateur que Y:\apk\... est accessible" -ForegroundColor Cyan
    Write-Host "    3. Relancer ce script" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# ----------------------------------------------------------------
# VERSION : lit l'existant et calcule la nouvelle version
# ----------------------------------------------------------------
function Get-NextVersion($current, $bumpType) {
    if ([string]::IsNullOrWhiteSpace($current)) { $current = "1.0.0" }
    $parts = $current -split "\."
    if ($parts.Count -ne 3) {
        Write-Host "  [WARN] Version $current invalide, reset a 1.0.0" -ForegroundColor Yellow
        $parts = @("1","0","0")
    }
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    switch ($bumpType) {
        "major" { $major++; $minor = 0; $patch = 0 }
        "minor" { $minor++; $patch = 0 }
        "patch" { $patch++ }
        default { } # "none" = pas de changement
    }
    return "$major.$minor.$patch"
}

$currentVersion = "1.0.0"
$previousModuleCount = 0
if (Test-Path $outputFile) {
    try {
        $existing = Get-Content $outputFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($existing.servers -and $existing.servers[0].version) {
            $currentVersion = $existing.servers[0].version
        }
        if ($existing.servers -and $existing.servers[0].modules) {
            $previousModuleCount = @($existing.servers[0].modules).Count
        }
    } catch {
        Write-Host "  [WARN] Impossible de parser distribution.json existant, defaut = 1.0.0" -ForegroundColor Yellow
    }
}

$newVersion = Get-NextVersion $currentVersion $Bump
Write-Host ""
if ($Bump -eq "none") {
    Write-Host "Version serveur : $currentVersion (inchangee)" -ForegroundColor Cyan
} else {
    Write-Host "Version serveur : $currentVersion -> $newVersion (bump $Bump)" -ForegroundColor Green
}

# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------
# Regex d'exclusion (cf distribution-config.json), testees sur le chemin relatif avec des /
$excludePatterns = @()
foreach ($group in $config.excludePatterns.PSObject.Properties) {
    if ($group.Name.StartsWith("_")) { continue }
    $excludePatterns += @($group.Value)
}

function Test-Excluded($relativePath) {
    foreach ($pattern in $excludePatterns) {
        if ($relativePath -match $pattern) { return $true }
    }
    return $false
}

# MD5 d'un fichier. S'il est illisible (ouvert par un autre programme), on ARRETE :
# publier un hash faux bloquerait le lancement du jeu chez tous les joueurs.
function Get-MD5($path) {
    try {
        return (Get-FileHash $path -Algorithm MD5).Hash.ToLower()
    } catch {
        Write-Host ""
        Write-Host "  ERREUR : impossible de lire $path" -ForegroundColor Red
        Write-Host "  Le fichier est probablement ouvert par un autre programme." -ForegroundColor Red
        Write-Host "  Ferme-le puis relance le script. Rien n'a ete publie." -ForegroundColor Red
        exit 1
    }
}

# Encode chaque segment du chemin (espaces, +, #, [], accents...) comme le script Python
function ConvertTo-UrlPath($relativePath) {
    return (($relativePath -split "/") | ForEach-Object { [Uri]::EscapeDataString($_) }) -join "/"
}

# Tri ordinal (meme ordre que le script Python -> diffs git plus lisibles)
function Sort-Ordinal($items, [scriptblock]$key) {
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($i in $items) { $list.Add($i) }
    $list.Sort([System.Comparison[object]]{ param($a, $b) [string]::CompareOrdinal((& $key $a), (& $key $b)) })
    return ,$list
}

Write-Host "=== Generation du distribution.json ===" -ForegroundColor Cyan
Write-Host ""

$modules = [System.Collections.Generic.List[object]]::new()

# ----------------------------------------------------------------
# FABRIC CORE (entree statique, cf distribution-config.json)
# ----------------------------------------------------------------
Write-Host "[1/5] Ajout du bloc Fabric Core..." -ForegroundColor Yellow
$modules.Add($config.fabricCore)

# ----------------------------------------------------------------
# MODS : required / optionaloff / optionalon
# ----------------------------------------------------------------
$modFolders = @(
    @{ step = "[2/5]"; dir = "required";    label = "[MOD]"; color = "Green";   required = $null },
    @{ step = "[3/5]"; dir = "optionaloff"; label = "[OFF]"; color = "Magenta"; required = [ordered]@{ value = $false; def = $false } },
    @{ step = "[4/5]"; dir = "optionalon";  label = "[ON] "; color = "Cyan";    required = [ordered]@{ value = $false; def = $true } }
)

$modCount = 0
foreach ($folder in $modFolders) {
    Write-Host "$($folder.step) Scan des mods ($($folder.dir)/)..." -ForegroundColor Yellow
    $jars = Get-ChildItem "$serverRoot\fabricmods\$($folder.dir)\" -Filter "*.jar" -File
    foreach ($mod in (Sort-Ordinal $jars { param($f) $f.Name })) {
        if ($config.excludedMods -contains $mod.Name) {
            Write-Host "  [SKIP] $($mod.Name) (ancienne version)" -ForegroundColor DarkGray
            continue
        }
        Write-Host "  $($folder.label)  $($mod.Name)" -ForegroundColor $folder.color -NoNewline
        $md5 = Get-MD5 $mod.FullName
        Write-Host " -> $md5" -ForegroundColor DarkGray
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($mod.Name)
        $entry = [ordered]@{
            id       = "generated.fabricmod:$($baseName):1.0.0@jar"
            name     = $baseName
            type     = "FabricMod"
            artifact = [ordered]@{
                size = $mod.Length
                MD5  = $md5
                url  = "$baseUrl/fabricmods/$($folder.dir)/$(ConvertTo-UrlPath $mod.Name)"
            }
        }
        if ($null -ne $folder.required) { $entry["required"] = $folder.required }
        $modules.Add($entry)
        $modCount++
    }
}
Write-Host "  -> $modCount mods ajoutes" -ForegroundColor Cyan

# ----------------------------------------------------------------
# FICHIERS (configs, resourcepacks, shaders...)
# ----------------------------------------------------------------
Write-Host "[5/5] Scan des fichiers (config, resourcepacks, shaders...)..." -ForegroundColor Yellow
$filesRoot = (Resolve-Path "$serverRoot\files").ProviderPath.TrimEnd("\") + "\"
$allFiles = Get-ChildItem $filesRoot -Recurse -File |
    ForEach-Object { [pscustomobject]@{ File = $_; Rel = $_.FullName.Substring($filesRoot.Length).Replace("\", "/") } }
$fileCount = 0
foreach ($item in (Sort-Ordinal $allFiles { param($x) $x.Rel })) {
    $relativePath = $item.Rel
    if (Test-Excluded $relativePath) {
        Write-Host "  [SKIP] $relativePath" -ForegroundColor DarkGray
        continue
    }
    Write-Host "  [FILE] $relativePath" -ForegroundColor Blue -NoNewline
    $md5 = Get-MD5 $item.File.FullName
    Write-Host " -> $md5" -ForegroundColor DarkGray
    $safeId = $relativePath -replace "[^a-zA-Z0-9._\-]", "_"
    $modules.Add([ordered]@{
        id       = "generated.file:$($safeId):1.0.0"
        name     = $item.File.Name
        type     = "File"
        artifact = [ordered]@{
            size = $item.File.Length
            MD5  = $md5
            url  = "$baseUrl/files/$(ConvertTo-UrlPath $relativePath)"
            path = $relativePath
        }
    })
    $fileCount++
}
Write-Host "  -> $fileCount fichiers ajoutes" -ForegroundColor Cyan

# ----------------------------------------------------------------
# GARDE-FOU : refuse de publier un modpack vide ou ampute
# ----------------------------------------------------------------
$ratio = [double]$config.safety.minModuleRatio
if ($modCount -eq 0) {
    Write-Host "  ERREUR : 0 mod trouve. Rien n'a ete publie." -ForegroundColor Red
    exit 1
}
if ($previousModuleCount -gt 0 -and $modules.Count -lt $previousModuleCount * $ratio) {
    $msg = "Le nombre de modules chute de $previousModuleCount a $($modules.Count) (seuil $([int]($ratio*100))%)."
    if ($Force) {
        Write-Host "  [WARN] $msg -Force utilise, on continue." -ForegroundColor Yellow
    } else {
        Write-Host "  ERREUR : $msg Scan incomplet ? Relance avec -Force si c'est voulu. Rien n'a ete publie." -ForegroundColor Red
        exit 1
    }
}

# ----------------------------------------------------------------
# ASSEMBLAGE DU JSON FINAL
# ----------------------------------------------------------------
Write-Host ""
Write-Host "Assemblage du JSON..." -ForegroundColor Yellow
$srv = $config.server
$distribution = [ordered]@{
    version = "1.0.0"   # Schema version Helios (ne pas toucher)
    rss     = $config.rss
    servers = @(
        [ordered]@{
            id               = $srv.id
            name             = $srv.name
            description      = $srv.description
            icon             = $srv.icon
            version          = $newVersion
            address          = $srv.address
            minecraftVersion = $srv.minecraftVersion
            mainServer       = $srv.mainServer
            autoconnect      = $srv.autoconnect
            modules          = $modules.ToArray()
        }
    )
}

$json = $distribution | ConvertTo-Json -Depth 20 -Compress:$false

# Ecrire SANS BOM (UTF-8 sans BOM), important pour que Node.js puisse parser le JSON
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outputFile, $json, $utf8NoBom)

# ----------------------------------------------------------------
# UPLOAD : copie vers un .tmp puis renommage, pour que les joueurs
# ne recuperent jamais un JSON a moitie copie.
# ----------------------------------------------------------------
Write-Host ""
Write-Host "=== UPLOAD vers le serveur ===" -ForegroundColor Yellow
if ($NoUpload) {
    Write-Host "  -NoUpload : rien n'a ete publie" -ForegroundColor Yellow
} elseif (Test-Path (Split-Path $serverDest)) {
    $tmpDest = "$serverDest.tmp"
    Copy-Item $outputFile $tmpDest -Force
    try {
        Move-Item $tmpDest $serverDest -Force
    } catch {
        # Certains drives FTP refusent d'ecraser en renommant : on supprime puis on renomme
        Remove-Item $serverDest -Force
        Move-Item $tmpDest $serverDest
    }
    Write-Host "  Upload OK : $serverDest" -ForegroundColor Green
} else {
    Write-Host "  Serveur non monte (Y:\apk introuvable) - upload manuel requis" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== TERMINE ===" -ForegroundColor Green
Write-Host "Fichier genere : $outputFile" -ForegroundColor White
Write-Host "Version modpack: $newVersion" -ForegroundColor White
Write-Host "Total modules  : $($modules.Count)" -ForegroundColor White
