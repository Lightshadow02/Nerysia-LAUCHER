# Gestion de l'instance ADMIN secrete (cf docs/INSTANCE_ADMIN.md)
#
# Usage :
#   & "tools/admin.ps1" init             # prepare le dossier prive Y:\_nerysia_admin + deploie api.php + teste
#   & "tools/admin.ps1" add <pseudo>     # ajoute un admin (pseudo Minecraft -> UUID via l'API Mojang)
#   & "tools/admin.ps1" remove <pseudo>  # retire un admin (ses liens de telechargement cessent de marcher)
#   & "tools/admin.ps1" list             # liste les admins
#   & "tools/admin.ps1" test             # verifie que api.php repond sur apk.nerysia.fr
#
# NB : fichier volontairement sans accents (PowerShell 5.1). Les fichiers lus par PHP sont
# ecrits SANS BOM (un BOM avant "<?php" casserait le script).

param(
    [Parameter(Position = 0)][ValidateSet("init", "add", "remove", "list", "test")][string]$Action = "list",
    [Parameter(Position = 1)][string]$Pseudo
)

$ErrorActionPreference = "Stop"
$config     = Get-Content "$PSScriptRoot\distribution-config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$adminRoot  = $config.admin.localRoot -replace "/", "\"
$adminsFile = Join-Path $adminRoot "admins.json"
$gateUrl    = "https://apk.nerysia.fr/nerysia-laucher/admin/api.php"
$utf8NoBom  = New-Object System.Text.UTF8Encoding $false

function Write-NoBom($path, $text) { [System.IO.File]::WriteAllText($path, $text, $utf8NoBom) }

function Assert-Drive {
    if (-not (Test-Path (Split-Path $adminRoot -Qualifier))) {
        Write-Host "ERREUR : le drive $(Split-Path $adminRoot -Qualifier) n'est pas monte." -ForegroundColor Red
        exit 1
    }
}

function Get-Admins {
    if (-not (Test-Path $adminsFile)) { return @() }
    return @(Get-Content $adminsFile -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Save-Admins($admins) {
    $sorted = @($admins | Sort-Object name)
    $json = if ($sorted.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject $sorted -Depth 3 }
    Write-NoBom $adminsFile $json
}

function Test-Gate {
    try {
        $r = Invoke-RestMethod "$($gateUrl)?action=ping" -TimeoutSec 15
        Write-Host "  api.php repond : PHP $($r.php), curl=$($r.curl), dossier prive trouve=$($r.private)" -ForegroundColor Green
        if (-not $r.private) { Write-Host "  ATTENTION : api.php ne trouve pas le dossier prive (chemin a verifier)" -ForegroundColor Red }
    } catch {
        Write-Host "  ERREUR : api.php ne repond pas ($($_.Exception.Message))" -ForegroundColor Red
        Write-Host "  -> PHP est-il active sur l'hebergement ? (OVH : Multisite / version PHP)" -ForegroundColor Yellow
    }
}

switch ($Action) {

    "init" {
        Assert-Drive
        Write-Host "=== Preparation de l'instance admin ===" -ForegroundColor Cyan
        New-Item -ItemType Directory -Force $adminRoot | Out-Null

        $cfgFile = Join-Path $adminRoot "config.php"
        if (Test-Path $cfgFile) {
            Write-Host "  config.php existe deja (cle secrete conservee)" -ForegroundColor DarkGray
        } else {
            $bytes = New-Object byte[] 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
            $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
            Write-NoBom $cfgFile "<?php return ['secret' => '$secret'];`n"
            Write-Host "  config.php cree (nouvelle cle secrete)" -ForegroundColor Green
        }

        if (-not (Test-Path $adminsFile)) { Save-Admins @(); Write-Host "  admins.json cree (vide)" -ForegroundColor Green }

        $serverFile = Join-Path $adminRoot "admin-server.json"
        if (-not (Test-Path $serverFile)) {
            $template = [ordered]@{
                id               = "Nerysia-Admin"
                name             = "Nerysia ADMIN"
                description      = "Instance reservee aux admins"
                icon             = "https://apk.nerysia.fr/Logo.png"
                address          = "A-REMPLIR:25565"
                minecraftVersion = $config.server.minecraftVersion
                fabricCore       = "same"
            }
            Write-NoBom $serverFile ($template | ConvertTo-Json)
            Write-Host "  admin-server.json cree : pense a remplir 'address' (serveur Minecraft admin)" -ForegroundColor Yellow
        }
        $srv = Get-Content $serverFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($dir in @("fabricmods\required", "files\config")) {
            New-Item -ItemType Directory -Force (Join-Path $adminRoot "servers\$($srv.id)\$dir") | Out-Null
        }
        Write-Host "  Dossier du modpack admin : $(Join-Path $adminRoot "servers\$($srv.id)")" -ForegroundColor Green

        $gateTarget = $config.admin.gateLocalTarget -replace "/", "\"
        New-Item -ItemType Directory -Force (Split-Path $gateTarget) | Out-Null
        Copy-Item (Join-Path $PSScriptRoot "admin-gate\api.php") $gateTarget -Force
        Write-Host "  api.php deploye : $gateTarget" -ForegroundColor Green

        Write-Host ""
        Write-Host "Test de api.php en ligne :" -ForegroundColor Cyan
        Test-Gate
    }

    "add" {
        Assert-Drive
        if (-not $Pseudo) { Write-Host "Usage : & tools/admin.ps1 add <pseudo>" -ForegroundColor Yellow; exit 1 }
        try {
            $mcProfile = Invoke-RestMethod "https://api.mojang.com/users/profiles/minecraft/$Pseudo" -TimeoutSec 15
        } catch { $mcProfile = $null }
        if (-not $mcProfile -or -not $mcProfile.id) {
            Write-Host "ERREUR : pseudo '$Pseudo' introuvable chez Mojang (compte Java ?)" -ForegroundColor Red
            exit 1
        }
        $admins = @(Get-Admins | Where-Object { $_.uuid -ne $mcProfile.id })
        $admins += [pscustomobject]@{ name = $mcProfile.name; uuid = $mcProfile.id }
        Save-Admins $admins
        Write-Host "Admin ajoute : $($mcProfile.name) ($($mcProfile.id))" -ForegroundColor Green
        Write-Host "Pense aussi a l'ajouter a la whitelist du serveur Minecraft admin." -ForegroundColor Yellow
    }

    "remove" {
        Assert-Drive
        $before = @(Get-Admins)
        $after = @($before | Where-Object { $_.name -ne $Pseudo })
        if ($after.Count -eq $before.Count) { Write-Host "Aucun admin nomme '$Pseudo'" -ForegroundColor Yellow; exit 1 }
        Save-Admins $after
        Write-Host "Admin retire : $Pseudo (acces coupe immediatement)" -ForegroundColor Green
    }

    "list" {
        Assert-Drive
        $admins = @(Get-Admins)
        Write-Host "$($admins.Count) admin(s) :" -ForegroundColor Cyan
        foreach ($a in $admins) { Write-Host "  - $($a.name)  ($($a.uuid))" }
    }

    "test" { Test-Gate }
}
