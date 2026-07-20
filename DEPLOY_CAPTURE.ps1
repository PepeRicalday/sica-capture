# SICA CAPTURE: Asistente de Despliegue en la Nube
# =========================================================
#
# Cadena completa: bump -> build -> git -> Vercel -> app_versions.
#
# EL ORDEN NO ES NEGOCIABLE
# app_versions se anuncia AL FINAL, cuando el bundle ya esta en produccion.
# Anunciar la version antes de publicarla hace que VersionGuard purgue la cache
# de cada tableta y la recargue contra un bundle que todavia no existe: el
# anclaje exacto que las capas anti-cache buscan evitar, provocado por nosotros.
#
# El bump va ANTES del build: vite.config.ts lee package.json para el nombre del
# service worker y el <title>. Compilar antes de subir la version produce un
# bundle etiquetado con la version anterior — asi se desincronizaron
# package.json (2.6.4), vite.config (2.6.6) e index.html (2.6.1).
#
# NOTA DE CAMPO: esta app corre en tabletas con datos moviles. Un despliegue a
# medias deja aforadores sin poder capturar, asi que cada fase aborta si falla.

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "      SICA CAPTURE: DESPLIEGUE EN LA NUBE                " -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# --- FASE 1: Version -------------------------------------------------------
$package = Get-Content "$raiz\package.json" -Raw | ConvertFrom-Json
$currentVersion = $package.version
Write-Host "`n>>> FASE 1: Salto de Version (Actual: $currentVersion)" -ForegroundColor Yellow
$newVersion = Read-Host "Ingresa la NUEVA version (Enter = mantener $currentVersion)"
if (-not $newVersion) { $newVersion = $currentVersion }

if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "[ERROR] Version invalida: '$newVersion'. Formato esperado: 2.6.7" -ForegroundColor Red
    exit 1
}

if ($newVersion -ne $currentVersion) {
    # Reemplazo dirigido al campo version de la raiz. Un -replace sobre el texto
    # completo tocaria tambien las versiones de las dependencias que coincidan.
    $package.version = $newVersion
    $package | ConvertTo-Json -Depth 100 | Set-Content "$raiz\package.json" -Encoding utf8
    Write-Host "[OK] package.json -> v$newVersion" -ForegroundColor Green
    Write-Host "     (vite.config.ts e index.html lo siguen automaticamente)" -ForegroundColor DarkGray
} else {
    Write-Host "[--] Version sin cambio ($currentVersion)." -ForegroundColor DarkGray
}

# --- FASE 2: Build ---------------------------------------------------------
Write-Host "`n>>> FASE 2: Compilacion (tsc + vite build)" -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El build fallo. Repara los errores antes de desplegar." -ForegroundColor Red
    Write-Host "        package.json quedo en v$newVersion - revisalo si abortas aqui." -ForegroundColor DarkYellow
    exit 1
}
Write-Host "[OK] Compilado con exito." -ForegroundColor Green

# --- FASE 3: GitHub --------------------------------------------------------
Write-Host "`n>>> FASE 3: Envio a GitHub (respaldo del codigo)" -ForegroundColor Yellow
$commitMsg = Read-Host "Descripcion de cambios"
if (-not $commitMsg) { $commitMsg = "deploy v$newVersion" }

$rama = (git rev-parse --abbrev-ref HEAD).Trim()
git add -A
git commit -m "deploy: $commitMsg - v$newVersion"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[--] Sin cambios que confirmar; se continua." -ForegroundColor DarkGray
}
git push origin $rama
if ($LASTEXITCODE -ne 0) {
    Write-Host "[AVISO] El push fallo. El despliegue continua (Vercel sube desde local)." -ForegroundColor DarkYellow
} else {
    Write-Host "[OK] Codigo respaldado en GitHub ($rama)." -ForegroundColor Green
}

# --- FASE 4: Vercel --------------------------------------------------------
# Este es el paso que realmente publica. `git push` no despliega por si solo.
Write-Host "`n>>> FASE 4: Despliegue a produccion (Vercel)" -ForegroundColor Yellow
npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] El despliegue a Vercel fallo." -ForegroundColor Red
    Write-Host "        NO se anunciara la version: las tabletas seguirian" -ForegroundColor Red
    Write-Host "        buscando un bundle que no existe en produccion." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Publicado en produccion." -ForegroundColor Green

# --- FASE 5: Verificacion previa al anuncio -------------------------------
# Puerta deliberada: una vez anunciada la version, cada tableta purga su cache
# y recarga. Si el bundle publicado esta roto, se quedan sin app EN CAMPO y sin
# forma de volver atras. Vale mas una confirmacion humana de 20 segundos.
Write-Host "`n>>> FASE 5: Verificacion antes de anunciar" -ForegroundColor Yellow
Write-Host "Abre https://sica-capture.vercel.app y confirma que:" -ForegroundColor Cyan
Write-Host "  1. La app carga (no pantalla en blanco)" -ForegroundColor Cyan
Write-Host "  2. El pie de pagina muestra v$newVersion" -ForegroundColor Cyan
Write-Host "  3. Puedes iniciar sesion" -ForegroundColor Cyan
$ok = Read-Host "`nEscribe SI para anunciar la version a las tabletas"
if ($ok -ne "SI") {
    Write-Host "[--] Anuncio cancelado. El codigo esta en produccion, pero las" -ForegroundColor DarkYellow
    Write-Host "     tabletas seguiran en la version anterior hasta que corras:" -ForegroundColor DarkYellow
    Write-Host "     node ..\conchos-digital\sync_versions.mjs capture" -ForegroundColor Cyan
    exit 0
}

# --- FASE 6: Anuncio a la red ---------------------------------------------
# app_versions es el interruptor del refresco forzado: VersionGuard lo consulta
# y recarga las tabletas. El script vive en conchos-digital y sirve a ambas apps.
Write-Host "`n>>> FASE 6: Anuncio a las tabletas (app_versions)" -ForegroundColor Yellow
node "$raiz\..\conchos-digital\sync_versions.mjs" capture --notas "$commitMsg"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] No se pudo anunciar la version en Supabase." -ForegroundColor Red
    Write-Host "        Requiere SUPABASE_SERVICE_KEY en el entorno (la clave" -ForegroundColor Red
    Write-Host "        anon no puede escribir en app_versions por RLS)." -ForegroundColor Red
    Write-Host "        El codigo YA esta en produccion; reintenta el anuncio con:" -ForegroundColor Red
    Write-Host "        node ..\conchos-digital\sync_versions.mjs capture" -ForegroundColor Cyan
    exit 1
}

Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host " DESPLIEGUE COMPLETO - v$newVersion en produccion" -ForegroundColor Green
Write-Host " Las tabletas se actualizaran en <=10 min, o al volver" -ForegroundColor Green
Write-Host " la app a primer plano. Si hay captura sin guardar," -ForegroundColor Green
Write-Host " esperara a que el aforador termine." -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
