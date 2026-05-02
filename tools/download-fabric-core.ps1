# Script PowerShell — Télécharger les fichiers Fabric Core depuis l'ancien serveur
# Exécute ce script UNE SEULE FOIS pour récupérer les fichiers Fabric Core
# Usage: .\download-fabric-core.ps1

$outputBase = ".\nerysia-modpack\repo"

$files = @(
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/net/fabricmc/fabric-loader/0.17.3/fabric-loader-0.17.3.jar"
        dest = "$outputBase\lib\net\fabricmc\fabric-loader\0.17.3\fabric-loader-0.17.3.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/versions/1.21.1-fabric-0.17.3/1.21.1-fabric-0.17.3.json"
        dest = "$outputBase\versions\1.21.1-fabric-0.17.3\1.21.1-fabric-0.17.3.json"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/org/ow2/asm/asm/9.9/asm-9.9.jar"
        dest = "$outputBase\lib\org\ow2\asm\asm\9.9\asm-9.9.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/org/ow2/asm/asm-analysis/9.9/asm-analysis-9.9.jar"
        dest = "$outputBase\lib\org\ow2\asm\asm-analysis\9.9\asm-analysis-9.9.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/org/ow2/asm/asm-commons/9.9/asm-commons-9.9.jar"
        dest = "$outputBase\lib\org\ow2\asm\asm-commons\9.9\asm-commons-9.9.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/org/ow2/asm/asm-tree/9.9/asm-tree-9.9.jar"
        dest = "$outputBase\lib\org\ow2\asm\asm-tree\9.9\asm-tree-9.9.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/org/ow2/asm/asm-util/9.9/asm-util-9.9.jar"
        dest = "$outputBase\lib\org\ow2\asm\asm-util\9.9\asm-util-9.9.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/net/fabricmc/sponge-mixin/0.16.5+mixin.0.8.7/sponge-mixin-0.16.5+mixin.0.8.7.jar"
        dest = "$outputBase\lib\net\fabricmc\sponge-mixin\0.16.5+mixin.0.8.7\sponge-mixin-0.16.5+mixin.0.8.7.jar"
    },
    @{
        url  = "https://apk.nerysia.fr/nerysia-laucher/repo/lib/net/fabricmc/intermediary/1.21.1/intermediary-1.21.1.jar"
        dest = "$outputBase\lib\net\fabricmc\intermediary\1.21.1\intermediary-1.21.1.jar"
    }
)

Write-Host ""
Write-Host "=== Téléchargement des fichiers Fabric Core ===" -ForegroundColor Cyan
Write-Host ""

$success = 0
$errors  = 0

foreach ($f in $files) {
    $filename = Split-Path $f.dest -Leaf
    $dir = Split-Path $f.dest -Parent

    # Créer le dossier de destination si besoin
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # Ne pas re-télécharger si déjà présent
    if (Test-Path $f.dest) {
        Write-Host "  [SKIP] $filename (déjà présent)" -ForegroundColor DarkGray
        $success++
        continue
    }

    try {
        Write-Host "  [DL]   $filename ..." -ForegroundColor Yellow -NoNewline
        Invoke-WebRequest -Uri $f.url -OutFile $f.dest -UseBasicParsing
        Write-Host " OK" -ForegroundColor Green
        $success++
    } catch {
        Write-Host " ERREUR" -ForegroundColor Red
        Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
        $errors++
    }
}

Write-Host ""
Write-Host "=== Résultat : $success OK / $errors erreur(s) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Les fichiers sont dans : $outputBase" -ForegroundColor White
Write-Host "Uploadez ce dossier sur : www.nerysia.fr/launcher/repo/" -ForegroundColor Green
