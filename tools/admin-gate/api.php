<?php
/**
 * Porte d'acces a l'instance ADMIN du Nerysia Launcher.
 * Deploye sur https://apk.nerysia.fr/nerysia-laucher/admin/api.php (copie par les scripts de generation).
 *
 * Ce fichier ne contient AUCUN secret (il est dans le depot GitHub public).
 * Tout le prive est dans un dossier HORS du site web : _nerysia_admin/
 *   config.php               -> cle secrete (HMAC)
 *   admins.json              -> [{"name": "...", "uuid": "..."}]
 *   distribution-admin.json  -> modpack admin (genere par tools/generate-distribution*)
 *   servers/<id>/...         -> fichiers du modpack admin
 *
 * Actions :
 *   ?action=ping                               -> test de deploiement (PHP, curl, dossier prive)
 *   ?action=challenge&uuid=U                   -> code a usage unique si U est admin, sinon 404
 *   ?action=server&username=N&nonce=C          -> verifie chez Mojang (hasJoined) puis renvoie l'instance
 *   ?action=file&p=CHEMIN&t=JETON              -> telecharge un fichier du modpack admin (jeton 24h)
 */
declare(strict_types=1);

// api.php est dans <ftp>/apk/nerysia-laucher/admin/ -> dossier prive = <ftp>/_nerysia_admin
define('PRIVATE_DIR', dirname(__DIR__, 3) . '/_nerysia_admin');
const NONCE_TTL = 300;          // 5 min pour faire le "join" Mojang
const TOKEN_TTL = 86400;        // liens de telechargement valables 24h
const MOJANG_HAS_JOINED = 'https://sessionserver.mojang.com/session/minecraft/hasJoined';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function reply(int $code, array $data): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function secret(): string {
    $cfg = @include PRIVATE_DIR . '/config.php';
    if (!is_array($cfg) || empty($cfg['secret']) || strlen($cfg['secret']) < 32) {
        reply(500, ['error' => 'config manquante']);
    }
    return $cfg['secret'];
}

// Lit un JSON prive (tolere le BOM UTF-8 que certains editeurs Windows ajoutent).
function read_private_json(string $file): ?array {
    $raw = @file_get_contents(PRIVATE_DIR . '/' . $file);
    if ($raw === false) return null;
    $json = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $raw), true);
    return is_array($json) ? $json : null;
}

function admin_uuids(): array {
    $list = read_private_json('admins.json');
    if (!is_array($list)) {
        reply(500, ['error' => 'liste admins manquante']);
    }
    $uuids = [];
    foreach ($list as $a) {
        if (!empty($a['uuid'])) {
            $uuids[] = strtolower(str_replace('-', '', $a['uuid']));
        }
    }
    return $uuids;
}

function is_admin(string $uuid): bool {
    return in_array($uuid, admin_uuids(), true);
}

function clean_uuid(string $v): string {
    $v = strtolower(str_replace('-', '', $v));
    return preg_match('/^[0-9a-f]{32}$/', $v) ? $v : '';
}

// Code a usage unique : timestamp + signature liee a l'uuid (sans stockage cote serveur).
function make_nonce(string $uuid, int $ts): string {
    return sprintf('%08x', $ts) . substr(hash_hmac('sha256', "nonce|$ts|$uuid", secret()), 0, 32);
}

function make_token(string $uuid, int $exp): string {
    $payload = "$uuid.$exp";
    return $payload . '.' . hash_hmac('sha256', "file|$payload", secret());
}

// Renvoie l'uuid si le jeton est valide, sinon ''.
function check_token(string $token): string {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return '';
    [$uuid, $exp, $sig] = $parts;
    if (!ctype_digit($exp) || (int)$exp < time()) return '';
    if (!hash_equals(hash_hmac('sha256', "file|$uuid.$exp", secret()), $sig)) return '';
    return is_admin($uuid) ? $uuid : '';
}

function http_get_json(string $url): ?array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true]]);
        $body = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) $code = (int)$m[1];
        }
    }
    if ($code !== 200 || !is_string($body)) return null;
    $json = json_decode($body, true);
    return is_array($json) ? $json : null;
}

// Remplace les chemins relatifs du modpack admin par des liens de telechargement signes.
function sign_urls(array &$modules, string $base, string $token): void {
    foreach ($modules as &$m) {
        $url = $m['artifact']['url'] ?? null;
        if (is_string($url) && !preg_match('#^https?://#', $url)) {
            $m['artifact']['url'] = $base . '?action=file&t=' . rawurlencode($token) . '&p=' . rawurlencode($url);
        }
        if (!empty($m['subModules']) && is_array($m['subModules'])) {
            sign_urls($m['subModules'], $base, $token);
        }
    }
}

$action = $_GET['action'] ?? '';

switch ($action) {

    case 'ping':
        // L'hebergement peut-il joindre Mojang ? (requete hasJoined bidon : 204 attendu)
        $mojang = false;
        if (function_exists('curl_init')) {
            $ch = curl_init(MOJANG_HAS_JOINED . '?username=ping&serverId=ping');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5]);
            curl_exec($ch);
            $mojang = in_array((int)curl_getinfo($ch, CURLINFO_HTTP_CODE), [200, 204], true);
            curl_close($ch);
        }
        reply(200, [
            'ok' => true,
            'php' => PHP_VERSION,
            'curl' => function_exists('curl_init'),
            'mojang' => $mojang,
            'private' => is_dir(PRIVATE_DIR),
        ]);

    case 'challenge':
        $uuid = clean_uuid((string)($_GET['uuid'] ?? ''));
        if ($uuid === '' || !is_admin($uuid)) {
            reply(404, ['admin' => false]);
        }
        reply(200, ['nonce' => make_nonce($uuid, time())]);

    case 'server':
        $username = (string)($_GET['username'] ?? '');
        $nonce = (string)($_GET['nonce'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_]{1,16}$/', $username) || !preg_match('/^[0-9a-f]{40}$/', $nonce)) {
            reply(400, ['error' => 'parametres invalides']);
        }
        $ts = hexdec(substr($nonce, 0, 8));
        if (abs(time() - $ts) > NONCE_TTL) {
            reply(403, ['error' => 'code expire']);
        }
        // Mojang confirme que le detenteur du compte a bien "rejoint" ce code avec son propre jeton
        $profile = http_get_json(MOJANG_HAS_JOINED . '?' . http_build_query(['username' => $username, 'serverId' => $nonce]));
        $uuid = clean_uuid((string)($profile['id'] ?? ''));
        if ($uuid === '' || !hash_equals(make_nonce($uuid, $ts), $nonce) || !is_admin($uuid)) {
            reply(403, ['error' => 'acces refuse']);
        }
        $distro = read_private_json('distribution-admin.json');
        $server = $distro['servers'][0] ?? null;
        if (!is_array($server)) {
            reply(503, ['error' => 'modpack admin pas encore genere']);
        }
        $base = 'https://' . $_SERVER['HTTP_HOST'] . strtok($_SERVER['REQUEST_URI'], '?');
        sign_urls($server['modules'], $base, make_token($uuid, time() + TOKEN_TTL));
        reply(200, ['server' => $server]);

    case 'file':
        if (check_token((string)($_GET['t'] ?? '')) === '') {
            reply(403, ['error' => 'lien expire ou invalide']);
        }
        $rel = (string)($_GET['p'] ?? '');
        $root = realpath(PRIVATE_DIR . '/servers');
        $full = $root === false ? false : realpath(PRIVATE_DIR . '/' . $rel);
        // Uniquement les fichiers du modpack (jamais config.php, admins.json...)
        if ($full === false || strpos($full, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($full)) {
            reply(404, ['error' => 'fichier introuvable']);
        }
        @set_time_limit(0);
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($full));
        header('Content-Disposition: attachment; filename="' . basename($full) . '"');
        readfile($full);
        exit;

    default:
        reply(400, ['error' => 'action inconnue']);
}
