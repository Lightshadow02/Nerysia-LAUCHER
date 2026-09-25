#!/usr/bin/env python3
"""
Genere le distribution.json en scannant le FTP OVH directement (sans avoir Y: monte).

Cache MD5 : tools/md5-cache.json garde {url: {size, modify, md5}}. Un fichier n'est
re-telecharge que si sa taille OU sa date de modification FTP a change. (Avant, seule
la taille comptait : une config modifiee a taille egale gardait un MD5 faux.)

Usage:
    python3 tools/generate-distribution-from-ftp.py --bump minor            # genere + upload
    python3 tools/generate-distribution-from-ftp.py --bump patch --no-upload
    python3 tools/generate-distribution-from-ftp.py --upload-only           # upload du JSON local
    python3 tools/generate-distribution-from-ftp.py --bump patch --force    # ignore la garde anti-scan-vide

Env vars requises:
    FTP_HOST, FTP_USERNAME, FTP_PASSWORD

Toute la configuration (exclusions, bloc Fabric, infos serveur) est dans
tools/distribution-config.json, partage avec tools/generate-distribution.ps1.
"""
import argparse
import ftplib
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / "tools" / "distribution-config.json"
OUTPUT_FILE = ROOT / "docs" / "distribution.json"
MD5_CACHE_FILE = ROOT / "tools" / "md5-cache.json"

CONFIG = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))

SERVER_REMOTE_PATH = CONFIG["ftpServerRoot"]
BASE_URL = CONFIG["baseUrl"]
DIST_REMOTE = CONFIG["ftpDistributionTarget"]
EXCLUDED_MODS = set(CONFIG["excludedMods"])
EXCLUDE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for key, patterns in CONFIG["excludePatterns"].items()
    if not key.startswith("_")
    for p in patterns
]
MIN_MODULE_RATIO = CONFIG["safety"]["minModuleRatio"]

# Sans date de modif FTP connue, on ne fait confiance a la taille seule que pour les
# gros fichiers (jars, zips). Les petites configs sont toujours re-hashees.
TRUST_SIZE_ONLY_ABOVE = 1024 * 1024


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------
def should_exclude(relative_path: str) -> bool:
    normalized = relative_path.replace("\\", "/")
    return any(p.search(normalized) for p in EXCLUDE_PATTERNS)


def bump_version(current: str, bump_type: str) -> str:
    """Bump semver version. bump_type: none, patch, minor, major."""
    if not current or not re.match(r"^\d+\.\d+\.\d+$", current):
        current = "1.0.0"
    major, minor, patch = map(int, current.split("."))
    if bump_type == "major":
        major += 1; minor = 0; patch = 0
    elif bump_type == "minor":
        minor += 1; patch = 0
    elif bump_type == "patch":
        patch += 1
    return f"{major}.{minor}.{patch}"


def url_encode_path(path: str) -> str:
    """URL-encode a path (spaces, brackets, +, #...). Slashes preserved."""
    return quote(path, safe="/")


def safe_id(path: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._\-]", "_", path)


def load_existing_distribution() -> dict:
    if not OUTPUT_FILE.exists():
        return {}
    try:
        return json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  [WARN] Failed to parse existing distribution.json: {e}", file=sys.stderr)
        return {}


def load_md5_cache(existing: dict) -> dict:
    """{url: {size, modify, md5}}. Complete avec l'ancien distribution.json (sans date)."""
    cache = {}
    for module in (existing.get("servers") or [{}])[0].get("modules", []):
        art = module.get("artifact", {})
        if art.get("url") and art.get("MD5"):
            cache[art["url"]] = {"size": art.get("size", 0), "modify": None, "md5": art["MD5"]}
    if MD5_CACHE_FILE.exists():
        try:
            cache.update(json.loads(MD5_CACHE_FILE.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"  [WARN] Failed to parse md5-cache.json: {e}", file=sys.stderr)
    return cache


# ----------------------------------------------------------------
# FTP helpers
# ----------------------------------------------------------------
def ftp_connect() -> ftplib.FTP:
    host = os.environ.get("FTP_HOST", "").strip()
    user = os.environ.get("FTP_USERNAME", "")
    pwd = os.environ.get("FTP_PASSWORD", "")
    if not (host and user and pwd):
        raise SystemExit("ERROR: FTP_HOST / FTP_USERNAME / FTP_PASSWORD env vars missing")
    # Sanitize host (strip protocol prefix)
    host = re.sub(r"^[a-z]+://", "", host, flags=re.IGNORECASE).rstrip("/")
    print(f"Connecting to FTP {host}...")
    ftp = ftplib.FTP(host, timeout=30)
    ftp.login(user, pwd)
    ftp.set_pasv(True)
    ftp.voidcmd("TYPE I")  # Binary mode
    print(f"  Connected. PWD = {ftp.pwd()}")
    return ftp


def ftp_list_files(ftp: ftplib.FTP, remote_dir: str, required: bool = True) -> list:
    """List files in remote_dir. Returns [(name, size, is_dir, modify), ...].

    Si required=True et que le dossier n'existe pas, on ARRETE le script : mieux vaut
    ne rien publier que publier un modpack incomplet.
    """
    try:
        ftp.cwd(remote_dir)
    except ftplib.error_perm as e:
        if required:
            raise SystemExit(f"ERROR: dossier FTP introuvable : {remote_dir} ({e}). Rien n'a ete publie.")
        print(f"  [SKIP] {remote_dir} does not exist ({e})")
        return []

    entries = []
    try:
        # mlsd is more reliable when available, and gives the modification date
        for name, facts in ftp.mlsd():
            if name in (".", "..") or facts.get("type") in ("cdir", "pdir"):
                continue
            is_dir = facts.get("type") == "dir"
            size = int(facts.get("size", 0)) if not is_dir else 0
            entries.append((name, size, is_dir, facts.get("modify")))
    except (ftplib.error_perm, AttributeError):
        # Fallback: parse list (pas de date fiable -> modify=None)
        lines = []
        ftp.retrlines("LIST", lines.append)
        for line in lines:
            parts = line.split(maxsplit=8)
            if len(parts) < 9:
                continue
            mode = parts[0]
            name = parts[8]
            if name in (".", ".."):
                continue
            is_dir = mode.startswith("d")
            try:
                size = int(parts[4])
            except (ValueError, IndexError):
                size = 0
            entries.append((name, size, is_dir, None))
    return entries


def ftp_list_recursive(ftp: ftplib.FTP, remote_dir: str, prefix: str = "") -> list:
    """Recursively list all files under remote_dir. Returns [(relative_path, size, modify), ...]."""
    results = []
    for name, size, is_dir, modify in ftp_list_files(ftp, remote_dir):
        rel = f"{prefix}{name}"
        if is_dir:
            results.extend(ftp_list_recursive(ftp, f"{remote_dir}/{name}", prefix=f"{rel}/"))
        else:
            results.append((rel, size, modify))
    return results


def ftp_download_md5(ftp: ftplib.FTP, remote_path: str) -> str:
    """Download a remote file (streaming) and return its MD5 hash."""
    h = hashlib.md5()
    ftp.voidcmd("TYPE I")
    ftp.retrbinary(f"RETR {remote_path}", h.update)
    return h.hexdigest()


def ftp_upload_atomic(ftp: ftplib.FTP, local_path: Path, remote_path: str) -> None:
    """Upload vers un .tmp puis renomme : les joueurs ne voient jamais un JSON a moitie envoye."""
    tmp_path = remote_path + ".tmp"
    ftp.voidcmd("TYPE I")
    with open(local_path, "rb") as f:
        ftp.storbinary(f"STOR {tmp_path}", f)
    try:
        ftp.rename(tmp_path, remote_path)
    except ftplib.error_perm:
        # Certains serveurs refusent d'ecraser via RNTO : on supprime puis on renomme
        ftp.delete(remote_path)
        ftp.rename(tmp_path, remote_path)


# ----------------------------------------------------------------
# Module builders
# ----------------------------------------------------------------
class Hasher:
    def __init__(self, ftp, cache):
        self.ftp = ftp
        self.cache = cache
        self.new_cache = {}
        # Stats pour voir le gain du cache (affichees en fin de script + resume GitHub)
        self.hits = 0
        self.hits_bytes = 0
        self.downloads = 0
        self.download_bytes = 0

    def md5(self, url, remote_path, label, size, modify):
        cached = self.cache.get(url)
        reuse = False
        if cached and cached.get("md5") and cached.get("size") == size:
            if modify and cached.get("modify"):
                reuse = cached["modify"] == modify
            else:
                reuse = size > TRUST_SIZE_ONLY_ABOVE
        if reuse:
            md5 = cached["md5"]
            print(f"  [CACHE] {label} -> {md5}")
            self.hits += 1
            self.hits_bytes += size
        else:
            print(f"  [DL]    {label} (downloading to compute MD5)...", end=" ", flush=True)
            t0 = time.time()
            md5 = ftp_download_md5(self.ftp, remote_path)
            print(f"-> {md5} ({time.time()-t0:.1f}s)")
            self.downloads += 1
            self.download_bytes += size
        self.new_cache[url] = {"size": size, "modify": modify, "md5": md5}
        return md5


def build_mod_entry(hasher, jar_name, subdir, size, modify, required=None):
    base_id = jar_name[:-4] if jar_name.lower().endswith(".jar") else jar_name
    full_url = f"{BASE_URL}/{subdir}/{url_encode_path(jar_name)}"
    md5 = hasher.md5(full_url, f"{SERVER_REMOTE_PATH}/{subdir}/{jar_name}", jar_name, size, modify)
    entry = {
        "id": f"generated.fabricmod:{base_id}:1.0.0@jar",
        "name": base_id,
        "type": "FabricMod",
        "artifact": {"size": size, "MD5": md5, "url": full_url},
    }
    if required is not None:
        entry["required"] = required
    return entry


def build_file_entry(hasher, relative_path, size, modify):
    full_url = f"{BASE_URL}/files/{url_encode_path(relative_path)}"
    md5 = hasher.md5(full_url, f"{SERVER_REMOTE_PATH}/files/{relative_path}", relative_path, size, modify)
    return {
        "id": f"generated.file:{safe_id(relative_path)}:1.0.0",
        "name": os.path.basename(relative_path),
        "type": "File",
        "artifact": {"size": size, "MD5": md5, "url": full_url, "path": relative_path},
    }


def check_sanity(distribution: dict, previous: dict, force: bool) -> None:
    """Refuse de publier un modpack vide ou qui a perdu une grosse partie de ses modules."""
    modules = distribution["servers"][0]["modules"]
    mods = [m for m in modules if m["type"] == "FabricMod"]
    if not mods:
        raise SystemExit("ERROR: 0 mod trouve. Rien n'a ete publie.")
    prev_modules = (previous.get("servers") or [{}])[0].get("modules", [])
    if prev_modules and len(modules) < len(prev_modules) * MIN_MODULE_RATIO:
        msg = (f"Le nombre de modules chute de {len(prev_modules)} a {len(modules)} "
               f"(seuil {int(MIN_MODULE_RATIO*100)}%).")
        if force:
            print(f"  [WARN] {msg} --force utilise, on continue.")
        else:
            raise SystemExit(f"ERROR: {msg} Scan incomplet ? Relance avec --force si c'est voulu. Rien n'a ete publie.")


def upload(ftp) -> None:
    # Re-valide le JSON local avant de l'envoyer
    data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    if not data["servers"][0]["modules"]:
        raise SystemExit("ERROR: distribution.json local sans modules, upload annule.")
    print("Upload distribution.json sur le FTP...")
    ftp_upload_atomic(ftp, OUTPUT_FILE, DIST_REMOTE)
    print(f"  Upload OK : {DIST_REMOTE}")


# ----------------------------------------------------------------
# Main
# ----------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bump", choices=["none", "patch", "minor", "major"], default="minor",
                        help="Type de bump version (default: minor)")
    parser.add_argument("--no-upload", action="store_true", help="Generate locally but do not upload to FTP")
    parser.add_argument("--upload-only", action="store_true", help="Only upload the existing docs/distribution.json")
    parser.add_argument("--force", action="store_true", help="Ignore la garde anti-scan-vide")
    args = parser.parse_args()

    if args.upload_only:
        ftp = ftp_connect()
        try:
            upload(ftp)
        finally:
            ftp.close()
        return

    previous = load_existing_distribution()
    current_version = (previous.get("servers") or [{}])[0].get("version", "1.0.0")
    new_version = bump_version(current_version, args.bump)
    if args.bump == "none":
        print(f"Version serveur : {current_version} (inchangee)")
    else:
        print(f"Version serveur : {current_version} -> {new_version} (bump {args.bump})")

    cache = load_md5_cache(previous)
    print(f"Cache MD5 charge : {len(cache)} entries")
    print()

    ftp = ftp_connect()
    hasher = Hasher(ftp, cache)
    modules = []

    print("[1/5] Ajout du bloc Fabric Core (statique)")
    modules.append(CONFIG["fabricCore"])

    mod_dirs = [
        ("[2/5]", "fabricmods/required", None),
        ("[3/5]", "fabricmods/optionaloff", {"value": False, "def": False}),
        ("[4/5]", "fabricmods/optionalon", {"value": False, "def": True}),
    ]
    for step, subdir, required in mod_dirs:
        print(f"{step} Scan {subdir}/")
        for name, size, is_dir, modify in sorted(ftp_list_files(ftp, f"{SERVER_REMOTE_PATH}/{subdir}")):
            if is_dir or not name.endswith(".jar"):
                continue
            if name in EXCLUDED_MODS:
                print(f"  [SKIP] {name} (excluded version)")
                continue
            modules.append(build_mod_entry(hasher, name, subdir, size, modify, required=required))

    print("[5/5] Scan files/ (recursif)")
    file_count = 0
    for rel, size, modify in sorted(ftp_list_recursive(ftp, f"{SERVER_REMOTE_PATH}/files")):
        if should_exclude(rel):
            print(f"  [SKIP] {rel}")
            continue
        modules.append(build_file_entry(hasher, rel, size, modify))
        file_count += 1
    print(f"  -> {file_count} fichiers ajoutes")

    print()
    print("Assemblage du JSON...")
    server = dict(CONFIG["server"])
    distribution = {
        "version": "1.0.0",  # Schema version (do not touch)
        "rss": CONFIG["rss"],
        "servers": [
            {
                "id": server["id"],
                "name": server["name"],
                "description": server["description"],
                "icon": server["icon"],
                "version": new_version,
                "address": server["address"],
                "minecraftVersion": server["minecraftVersion"],
                "mainServer": server["mainServer"],
                "autoconnect": server["autoconnect"],
                "modules": modules,
            }
        ],
    }

    check_sanity(distribution, previous, args.force)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(distribution, indent=4, ensure_ascii=False), encoding="utf-8")
    print(f"Fichier ecrit : {OUTPUT_FILE}")
    MD5_CACHE_FILE.write_text(json.dumps(hasher.new_cache, indent=1, sort_keys=True), encoding="utf-8")
    print(f"Cache MD5 ecrit : {MD5_CACHE_FILE}")

    try:
        if not args.no_upload:
            print()
            upload(ftp)
    finally:
        ftp.close()

    print()
    print("=== TERMINE ===")
    print(f"Version modpack: {new_version}")
    print(f"Total modules  : {len(modules)}")
    print_cache_stats(hasher)


def print_cache_stats(hasher) -> None:
    mb = lambda b: f"{b / 1048576:.1f} Mo"
    lines = [
        f"Repris du cache (inchanges) : {hasher.hits} fichiers ({mb(hasher.hits_bytes)} evites)",
        f"Telecharges (nouveaux/modifies) : {hasher.downloads} fichiers ({mb(hasher.download_bytes)})",
    ]
    print()
    for line in lines:
        print(line)
    # Resume visible directement sur la page du run GitHub Actions
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Cache MD5\n\n")
            for line in lines:
                f.write(f"- {line}\n")
            f.write("\n")


if __name__ == "__main__":
    main()
