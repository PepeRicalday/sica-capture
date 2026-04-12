import { supabase } from './supabase';
import { db, type SicaAforoRecord } from './db';
import { getTodayString, getDaysAgoString, getTimezoneOffsetString } from './dateHelpers';
import { calcVolumeM3 } from './volumeCalculations';

// -- 1. DESCARGA DE CATÁLOGOS (DE SUR A NORTE) --
// Llama a esto cuando el usuario inicie sesión para tener los catálogos en el teléfono
export const downloadCatalogs = async (forceCatalog = false) => {
    if (!navigator.onLine) return;

    try {
        const lastSyncStr = localStorage.getItem('sica_last_sync');
        const lastSyncTime = lastSyncStr ? parseInt(lastSyncStr) : 0;
        const lastVersion = localStorage.getItem('sica_app_version');
        const currentVersion = __V2_APP_VERSION__;
        
        const now = Date.now();
        // Solo descargar catálogos estáticos (puntos, escalas, perfil) una vez cada 12 horas
        // o si la versión de la app ha cambiado
        const shouldFetchStatic = forceCatalog || 
                                (lastVersion !== currentVersion) ||
                                (now - lastSyncTime > 12 * 60 * 60 * 1000);

        if (lastVersion !== currentVersion) {
            localStorage.setItem('sica_app_version', currentVersion);
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        // Ventana extendida para pre-llenado de nivel_abajo y aperturas:
        // Las escalas no se leen todos los días — con 1 día se perdía el último registro
        // si no hubo lectura ayer. 7 días garantiza capturar la última lectura real.
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

        // 1. DYNAMIC DATA (Always fetch)

        // A. Fetch latest readings to check for confirmation AND pre-fill values
        // Incluye nivel_abajo_m y radiales_json (no existen en tabla escalas estática).
        // Se traen TODAS las lecturas de los últimos 7 días (no solo 1 por escala)
        // porque el registro más reciente puede tener esos campos en null si el
        // operador solo capturó nivel_arriba. Se busca el último valor no-nulo
        // de cada campo de forma independiente.
        const { data: lastReadings } = await supabase
            .from('lecturas_escalas')
            .select('escala_id, confirmada, nivel_m, nivel_abajo_m, apertura_radiales_m, radiales_json, fecha, hora_lectura')
            .gte('fecha', sevenDaysAgoStr)
            .order('fecha', { ascending: false })
            .order('hora_lectura', { ascending: false });

        // readingsMap: escala_id → array de lecturas ordenadas desc
        // Permite buscar el último valor no-nulo por campo
        const readingsMap = new Map<string, any[]>();
        (lastReadings || []).forEach(lr => {
            if (!readingsMap.has(lr.escala_id)) readingsMap.set(lr.escala_id, []);
            readingsMap.get(lr.escala_id)!.push(lr);
        });

        // B. Fetch daily summary for scales
        const { data: resumenEscalas } = await supabase
            .from('resumen_escalas_diario')
            .select('escala_id, nivel_actual, delta_12h, estado, fecha')
            .gte('fecha', yesterdayStr)
            .order('fecha', { ascending: false });

        const dictResumenEscalas = new Map<string, any>();
        if (resumenEscalas) {
            resumenEscalas.forEach((r: any) => {
                if (!dictResumenEscalas.has(r.escala_id)) {
                    dictResumenEscalas.set(r.escala_id, r);
                }
            });
        }

        // C. Traer Estado Operativo de Hoy (Tomas)
        const todayStr = getTodayString();
        // Retrocedemos solo 3 días en vez de 5 para ahorrar egress
        const threeDaysAgoStr = getDaysAgoString(3);

        const { data: reportesRecientes } = await supabase
            .from('reportes_operacion')
            .select('punto_id, caudal_promedio, volumen_acumulado, hora_apertura, estado, fecha')
            .gte('fecha', threeDaysAgoStr)
            .order('fecha', { ascending: false })
            .order('hora_apertura', { ascending: false });

        // Registros locales de hoy para recalcular volumen con Q variable (tramo a tramo).
        // Incluye tanto registros ya sincronizados como pendientes — todos tienen fecha_hora y valor_q reales.
        const localTodayRecords = await db.records
            .where('tipo').equals('toma')
            .filter(r => r.fecha_captura === todayStr)
            .toArray();

        // Agrupar por punto_id para acceso O(1)
        const localByPunto = new Map<string, typeof localTodayRecords>();
        localTodayRecords.forEach(r => {
            if (!localByPunto.has(r.punto_id)) localByPunto.set(r.punto_id, []);
            localByPunto.get(r.punto_id)!.push(r);
        });

        const mapReportes = new Map<string, any>();
        if (reportesRecientes) {
            reportesRecientes.forEach((r: any) => {
                if (!mapReportes.has(r.punto_id)) {
                    const isToday = r.fecha === todayStr;
                    const caudalM3s = Number(r.caudal_promedio || 0);
                    const isStateOpen = ['inicio', 'continua', 'reabierto', 'modificacion'].includes(r.estado || '');

                    let volumenM3 = 0;

                    // P2: Usar registros locales de hoy para integrar Q×Δt por tramos.
                    // Si el técnico modificó el gasto dos veces en el día, cada tramo
                    // se calcula con su Q real en vez de usar el último Q para todo el período.
                    const localEvents = localByPunto.get(r.punto_id) || [];
                    if (isToday && localEvents.length > 0) {
                        // Construir eventos con fecha_hora desde fecha_captura + hora_captura
                        const offsetString = getTimezoneOffsetString();
                        const eventsForCalc = localEvents
                            .filter(e => !['cierre', 'suspension'].includes(e.estado_operativo || '') || (e.valor_q || 0) === 0)
                            .map(e => ({
                                fecha_hora: `${e.fecha_captura}T${e.hora_captura}${offsetString}`,
                                valor_q: e.valor_q ?? 0,
                                estado_evento: e.estado_operativo
                            }));
                        volumenM3 = calcVolumeM3(eventsForCalc);
                    } else if (isStateOpen && caudalM3s > 0 && r.hora_apertura) {
                        // Fallback: sin registros locales de hoy, estimar desde apertura
                        // con el último caudal conocido (capeado a 24h)
                        const apertura = isToday
                            ? new Date(r.hora_apertura)
                            : new Date(`${todayStr}T00:00:00`);
                        const segundosTranscurridos = Math.min(
                            Math.max(0, (Date.now() - apertura.getTime()) / 1000),
                            86400
                        );
                        volumenM3 = caudalM3s * segundosTranscurridos;
                    } else if (isToday) {
                        // Reporte de hoy con volumen_acumulado del servidor
                        volumenM3 = Number(r.volumen_acumulado || 0) * 1000000;
                    }

                    mapReportes.set(r.punto_id, {
                        punto_id: r.punto_id,
                        estado: r.estado || 'cierre',
                        volumen_total_m3: volumenM3,
                        hora_apertura: r.hora_apertura,
                        caudal_promedio_m3s: caudalM3s
                    });
                }
            });
        }

        // 2. STATIC DATA (Conditional fetch)
        const mappedPuntos: any[] = [];
        let baseEscalas: any[] | null = null;
        let tomas: any[] | null = null;
        let aforosControl: any[] | null = null;
        let presas: any[] | null = null;
        let perfiles: any[] | null = null;

        // Mapa de respaldo: última lectura conocida del catálogo local Dexie.
        // Necesario cuando shouldFetchStatic=true: la tabla 'escalas' no tiene
        // nivel_abajo_m ni radiales_json. Este mapa preserva esos campos de la
        // descarga anterior para no perderlos en un refresco de catálogo estático.
        const localEscalasFallback = new Map<string, any>();
        const localDexieEscalas = await db.puntos.where('type').equals('escala').toArray();
        localDexieEscalas.forEach(p => localEscalasFallback.set(p.id, p));

        if (shouldFetchStatic) {
            const { data: e } = await supabase.from('escalas').select('id, nombre, latitud, longitud, km, nivel_min_operativo, nivel_max_operativo, ancho, alto, pzas_radiales').eq('activa', true);
            const { data: t } = await supabase.from('puntos_entrega').select('id, nombre, tipo, seccion_id, km, coords_x, coords_y, capacidad_max_lps, modulos ( codigo_corto, nombre ), secciones ( nombre )');
            const { data: a } = await supabase.from('aforos_control').select('id, nombre_punto, latitud, longitud, foto_url, caracteristicas_hidraulicas');
            const { data: pr } = await supabase.from('presas').select('id, nombre, nombre_corto');
            const { data: pf } = await supabase.from('perfil_hidraulico_canal').select('id, km_inicio, km_fin, capacidad_diseno_m3s');
            
            baseEscalas = e;
            tomas = t;
            aforosControl = a;
            presas = pr;
            perfiles = pf;
        } else {
            // Re-mapear desde Dexie para mezclar con el estado dinámico nuevo
            const localPuntos = await db.puntos.toArray();
            // Separamos por tipo para procesar el merge de forma idéntica
            baseEscalas = localPuntos.filter(p => p.type === 'escala');
            tomas = localPuntos.filter(p => p.type !== 'escala' && p.type !== 'aforo' && p.type !== 'presa');
            aforosControl = localPuntos.filter(p => p.type === 'aforo');
            presas = localPuntos.filter(p => p.type === 'presa');
        }

        // 3. MERGE & MAP
        if (baseEscalas) {
            mappedPuntos.push(...baseEscalas.map((p: any) => {
                const resumen   = dictResumenEscalas.get(p.id);
                const readings  = readingsMap.get(p.id) || [];  // array ordenado desc
                const fallback  = localEscalasFallback.get(p.id);

                // Para cada campo: tomar el primer registro (más reciente) que lo tenga no-nulo.
                // Así si hoy solo se capturó nivel_arriba, nivel_abajo sigue desde la última lectura
                // que sí lo incluía (puede ser de hace 3-4 días).
                const latest    = readings[0];   // lectura más reciente (nivel_m, confirmada, ts)
                const rAbajo    = readings.find((r: any) => r.nivel_abajo_m    != null);
                const rApertura = readings.find((r: any) =>
                    r.apertura_radiales_m != null || (r.radiales_json != null && Array.isArray(r.radiales_json) && r.radiales_json.length > 0)
                );

                return {
                    ...p,
                    name: p.nombre || p.name,
                    type: 'escala',
                    ancho_radiales: p.ancho,
                    alto_radiales:  p.alto,
                    // nivel_actual: lectura más reciente > resumen diario > fallback Dexie
                    nivel_actual: (latest?.nivel_m != null)
                        ? latest.nivel_m
                        : (resumen ? parseFloat(resumen.nivel_actual || 0) : (p.nivel_actual ?? fallback?.nivel_actual)),
                    // nivel_abajo_m: último registro que lo tenga → fallback Dexie → estático
                    nivel_abajo_m:       rAbajo?.nivel_abajo_m        ?? fallback?.nivel_abajo_m        ?? p.nivel_abajo_m,
                    // apertura_radiales_m y radiales_json: último registro con apertura → fallback
                    apertura_radiales_m: rApertura?.apertura_radiales_m ?? fallback?.apertura_radiales_m ?? p.apertura_radiales_m,
                    radiales_json:       rApertura?.radiales_json        ?? fallback?.radiales_json        ?? p.radiales_json,
                    delta_12h: resumen ? parseFloat(resumen.delta_12h || 0) : (p.delta_12h ?? fallback?.delta_12h ?? 0),
                    escala_estado: resumen?.estado || p.escala_estado || fallback?.escala_estado || 'normal',
                    escala_confirmada: latest ? true : (p.escala_confirmada ?? fallback?.escala_confirmada ?? true),
                    ultima_lectura_ts: latest?.fecha && latest?.hora_lectura
                        ? `${latest.fecha}T${latest.hora_lectura}`
                        : (p.ultima_lectura_ts ?? fallback?.ultima_lectura_ts)
                };
            }));
        }

        if (tomas) {
            mappedPuntos.push(...tomas.map((p: any) => {
                const reporte = mapReportes.get(p.id);
                // Si fetched, o si estaba en local, mantenemos info base y actualizamos dinámica
                const modulo = p.modulos?.codigo_corto || p.modulos?.nombre || p.modulo || 'General';
                const seccion = p.secciones?.nombre || p.secciones?.nombre || p.seccion || 'S/S';
                
                // reporte === undefined → punto no apareció en la consulta (puede ser toma antigua o fuera del rango de 3 días).
                //   En este caso preservamos el estado local de Dexie para no perder una toma activa.
                // reporte !== undefined pero sin estado → BD dice 'cerrado'.
                const estadoFinal = reporte !== undefined
                    ? (reporte.estado || 'cerrado')
                    : (p.estado_hoy || 'cerrado');

                return {
                    id: p.id,
                    name: p.nombre || p.name,
                    type: p.tipo || p.type,
                    modulo,
                    seccion,
                    seccion_id: p.seccion_id,
                    km: parseFloat(p.km || 0),
                    estado_hoy: estadoFinal,
                    volumen_hoy_m3: parseFloat(reporte?.volumen_total_m3 ?? (p.volumen_hoy_m3 ?? 0)),
                    hora_apertura: reporte?.hora_apertura || p.hora_apertura,
                    caudal_promedio: parseFloat(reporte?.caudal_promedio_m3s ?? (p.caudal_promedio ?? 0)),
                    capacidad_max_lps: p.capacidad_max_lps ? Number(p.capacidad_max_lps) : undefined,
                    lat: p.coords_y || p.lat || 0,
                    lng: p.coords_x || p.lng || 0
                };
            }));
        }

        if (aforosControl) {
            mappedPuntos.push(...aforosControl.map((p: any) => ({
                id: p.id,
                name: p.nombre_punto || p.name,
                type: 'aforo',
                lat: Number(p.latitud || p.lat || 0),
                lng: Number(p.longitud || p.lng || 0),
                foto_url: p.foto_url,
                caracteristicas_hidraulicas: p.caracteristicas_hidraulicas
            })));
        }

        if (presas) {
            mappedPuntos.push(...presas.map((p: any) => ({
                id: p.id,
                name: p.nombre_corto || p.nombre || p.name,
                type: 'presa'
            })));
        }

        if (mappedPuntos.length > 0) {
            await db.transaction('rw', [db.puntos, db.perfil_hidraulico], async () => {
                await db.puntos.clear();
                await db.puntos.bulkPut(mappedPuntos);

                if (perfiles && perfiles.length > 0) {
                    await db.perfil_hidraulico.clear();
                    await db.perfil_hidraulico.bulkPut(perfiles);
                }
            });
        }

        if (shouldFetchStatic) localStorage.setItem('sica_last_sync', now.toString());
    } catch (error) {
        console.error('Failed to download catalogs:', error);
        throw error;
    }
};

// -- 2A. AUTO-CONTINUIDAD (Generación automática de registros de tomas activas) --
// Para cada toma abierta, genera registros 'continua' para TODOS los días sin
// cobertura desde la última captura hasta hoy (backfill). Garantiza continuidad
// hídrica en reportes de consumo aunque el técnico no toque la toma días consecutivos.
//
// Cadena de continuidad:
//   Día 1: inicio  50 L/s  (técnico)
//   Día 2: continua 50 L/s (auto)
//   Día 3: continua 50 L/s (auto)
//   Día 4: modificacion 60 L/s (técnico)
//   Día 5: continua 60 L/s (auto)  ← hereda el último gasto conocido
//   ...hasta cierre

// Lock para evitar race condition si syncPendingRecords() se llama concurrentemente
// (evento 'online' + post-save simultáneos)
let _autoGenerateLock: Promise<number> | null = null;

export const autoGenerateContinua = async (userId?: string, userName?: string): Promise<number> => {
    // Si ya hay una ejecución en curso, esperar su resultado en vez de ejecutar en paralelo
    if (_autoGenerateLock) return _autoGenerateLock;

    _autoGenerateLock = (async () => {
        try {
            const today = getTodayString();
            const now = new Date();
            const horaHoy = now.toTimeString().slice(0, 8);

            // Tomas y laterales con estado abierto y caudal válido
            const allPuntos = await db.puntos.toArray();
            const openTomas = allPuntos.filter(p =>
                p.type !== 'escala' && p.type !== 'aforo' && p.type !== 'presa' &&
                ['inicio', 'continua', 'reabierto', 'modificacion'].includes(p.estado_hoy || '') &&
                Number(p.caudal_promedio || 0) > 0
            );
            if (openTomas.length === 0) return 0;

            const continuas: any[] = [];

            for (const pt of openTomas) {
                // Obtener registros locales de esta toma (sincronizados y pendientes)
                const existing = await db.records
                    .where('punto_id').equals(pt.id)
                    .filter(r => r.tipo === 'toma')
                    .toArray();

                const existingDates = new Set(existing.map(r => r.fecha_captura));

                // Inicio del backfill: día siguiente al registro más reciente.
                // Si hora_apertura es ISO timestamp de días atrás, parse solo la fecha
                // para evitar generar cientos de registros históricos incorrectos.
                // Cap máximo: 60 días hacia atrás.
                let startDate = today;
                if (existing.length > 0) {
                    const maxDate = existing.reduce(
                        (max, r) => (r.fecha_captura > max ? r.fecha_captura : max), ''
                    );
                    const d = new Date(maxDate + 'T12:00:00');
                    d.setDate(d.getDate() + 1);
                    startDate = d.toISOString().split('T')[0];
                } else if (pt.hora_apertura) {
                    // Extraer solo la parte de fecha del ISO timestamp (evita offset timezone)
                    const aperturaDate = pt.hora_apertura.split('T')[0];
                    const d = new Date(aperturaDate + 'T12:00:00');
                    d.setDate(d.getDate() + 1);
                    startDate = d.toISOString().split('T')[0];
                }

                // Cap: no generar más de 60 días de backfill por toma
                const capDate = new Date(today + 'T12:00:00');
                capDate.setDate(capDate.getDate() - 60);
                const capDateStr = capDate.toISOString().split('T')[0];
                if (startDate < capDateStr) startDate = capDateStr;

                // Generar un registro por cada día faltante (startDate → hoy)
                const cursor = new Date(startDate + 'T12:00:00');
                const todayDate = new Date(today + 'T12:00:00');

                while (cursor <= todayDate) {
                    const dateStr = cursor.toISOString().split('T')[0];
                    if (!existingDates.has(dateStr)) {
                        continuas.push({
                            id: crypto.randomUUID(),
                            tipo: 'toma' as const,
                            punto_id: pt.id,
                            valor_q: Number(pt.caudal_promedio), // m³/s
                            estado_operativo: 'continua' as const,
                            fecha_captura: dateStr,
                            hora_captura: dateStr === today ? horaHoy : '23:59:00',
                            sincronizado: 'false' as const,
                            responsable_id: userId,
                            responsable_nombre: userName || 'Sistema',
                            notas: '[AUTO] Continuidad sin modificación'
                        });
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
            }

            if (continuas.length > 0) {
                // Transacción para garantizar atomicidad — si falla, no quedan registros parciales
                await db.transaction('rw', [db.records], async () => {
                    await db.records.bulkAdd(continuas);
                });
            }
            return continuas.length;
        } finally {
            _autoGenerateLock = null;
        }
    })();

    return _autoGenerateLock;
};

// -- CLASIFICACIÓN DE ERRORES DE SYNC --
// Distingue errores transitorios (red, timeout) de estructurales (constraints, FK).
// Los transitorios se reintentan siempre. Los estructurales se descartan tras MAX_RETRIES.

const MAX_RETRIES_STRUCTURAL = 5; // Intentos máximos para errores estructurales
const CHRONIC_HOURS = 24;         // Horas sin sync exitoso para considerar "crónico"

const STRUCTURAL_ERROR_PATTERNS = [
    'violates foreign key',
    'violates check constraint',
    'violates not-null constraint',
    'duplicate key value',
    'invalid input syntax',
    'value too long',
    'permission denied',
    'row-level security',
    'new row violates',
    'ESTRUCTURAL',
];

function isStructuralError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return STRUCTURAL_ERROR_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

function isChronicError(record: { error_sync?: string; retry_count?: number; first_failed_at?: string }): boolean {
    if (!record.error_sync) return false;
    // Crónico si: es estructural Y lleva más de CHRONIC_HOURS o más de MAX_RETRIES intentos
    const retries = record.retry_count ?? 0;
    if (retries >= MAX_RETRIES_STRUCTURAL) return true;
    if (record.first_failed_at) {
        const hours = (Date.now() - new Date(record.first_failed_at).getTime()) / 3_600_000;
        if (hours >= CHRONIC_HOURS && isStructuralError(record.error_sync)) return true;
    }
    return false;
}

// -- 2. SUBIDA DE REGISTROS (DE NORTE A SUR) --
// Llama a esto cuando vuelva la conexión (Listener)
export const syncPendingRecords = async () => {
    if (!navigator.onLine) return;

    try {
        // Verificar sesión activa antes de sincronizar — sin sesión, esperar re-login
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Generar registros de continuidad automática antes de subir
        await autoGenerateContinua(session.user.id, session.user.email ?? undefined);

        const allPending = await db.records.where({ sincronizado: 'false' }).toArray();
        if (allPending.length === 0) return;

        // Separar registros reintenables de crónicos (errores estructurales sin solución automática)
        const chronicIds: string[] = [];
        const pending = allPending.filter(r => {
            if (isChronicError(r)) {
                chronicIds.push(r.id);
                return false;
            }
            return true;
        });

        // Marcar crónicos con prefijo para que PendingRecordsModal los destaque
        if (chronicIds.length > 0) {
            await db.records.where('id').anyOf(chronicIds).modify(r => {
                if (r.error_sync && !r.error_sync.startsWith('[CRÓNICO]')) {
                    r.error_sync = `[CRÓNICO] ${r.error_sync}`;
                }
            });
        }

        if (pending.length === 0) return;

        // 1. Escalas (van a lecturas_escalas)
        const escalasPending = pending.filter(p => p.tipo === 'escala');
        const escalasPayload = escalasPending.map(p => ({
            id: p.id,
            escala_id: p.punto_id,
            fecha: p.fecha_captura,
            nivel_m: p.valor_q,
            nivel_abajo_m: p.nivel_abajo_m,
            apertura_radiales_m: p.apertura_radiales_m,
            radiales_json: p.radiales_json,
            gasto_calculado_m3s: p.gasto_calculado_m3s,
            hora_lectura: p.hora_captura,
            responsable: p.responsable_nombre || 'Operador Móvil',
            turno: parseInt(p.hora_captura.split(':')[0]) < 14 ? 'am' : 'pm',
            notas: p.notas, // Incluir notas (GPS, Arribos, etc.)
            confirmada: p.confirmada === true ? true : false // Solo true si fue explícitamente autorizado
        }));

        const syncSuccessIds: string[] = [];

        if (escalasPayload.length > 0) {
            const { error: err } = await supabase.from('lecturas_escalas').upsert(escalasPayload, { onConflict: 'escala_id,fecha,turno' });
            if (err) {
                console.error('Error insertando escalas:', err.message);
                const now = new Date().toISOString();
                await db.records.where('id').anyOf(escalasPending.map(p => p.id)).modify(r => {
                    r.error_sync = err.message;
                    r.retry_count = (r.retry_count ?? 0) + 1;
                    if (!r.first_failed_at) r.first_failed_at = now;
                });
            } else {
                syncSuccessIds.push(...escalasPending.map(p => p.id as string));
            }
        }

        // Obtener el offset local (Ej. -06:00 o -07:00 para Chihuahua) — centralizado via Intl
        const offsetString = getTimezoneOffsetString();

        // 1B. Tomas y Laterales (van a mediciones)
        const tomasPending = pending.filter(p => p.tipo === 'toma');
        // Mapear tipo de punto a tipo_ubicacion (evita que todos queden como 'canal')
        const puntosMap = new Map<string, string>();
        (await db.puntos.toArray()).forEach(pt => puntosMap.set(pt.id, pt.type));
        // Valores aceptados por measurements_location_type_check: 'toma', 'lateral', 'carcamo', 'canal', 'dam'
        const TIPO_UBICACION_VALIDOS = new Set(['toma', 'lateral', 'carcamo', 'canal', 'dam']);
        const normTipoUbicacion = (raw: string | undefined): string => {
            if (!raw) return 'toma';
            return TIPO_UBICACION_VALIDOS.has(raw) ? raw : 'toma';
        };

        const tomasPayload: any[] = tomasPending.map(p => ({
            id: p.id,
            punto_id: p.punto_id,
            valor_q: p.valor_q ?? 0,
            fecha_hora: `${p.fecha_captura}T${p.hora_captura}${offsetString}`,
            tipo_ubicacion: normTipoUbicacion(puntosMap.get(p.punto_id)),
            estado_evento: p.estado_operativo || null,
            usuario_id: p.responsable_id || null,
            notas: p.notas
        }));

        if (tomasPayload.length > 0) {
            const { error: err } = await supabase.from('mediciones').upsert(tomasPayload, { onConflict: 'id' });
            if (err) {
                console.error('Error insertando tomas:', err.message);
                const now = new Date().toISOString();
                await db.records.where('id').anyOf(tomasPending.map(p => p.id)).modify(r => {
                    r.error_sync = err.message;
                    r.retry_count = (r.retry_count ?? 0) + 1;
                    if (!r.first_failed_at) r.first_failed_at = now;
                });
            } else {
                syncSuccessIds.push(...tomasPending.map(p => p.id as string));
            }
        }

        // 1C. Aforos (van a aforos)
        const aforosPending = pending.filter(p => p.tipo === 'aforo') as (SicaAforoRecord & { id: string })[];
        const aforosPayload: any[] = aforosPending.map(p => ({
            id: p.id,
            punto_control_id: p.punto_id,
            fecha: p.fecha_captura,
            hora_inicio: p.hora_inicial,
            hora_fin: p.hora_final,
            nivel_escala_inicio_m: p.tirante_inicial_m,
            nivel_escala_fin_m: p.tirante_final_m,
            espejo_agua_m: p.espejo_m,
            gasto_calculado_m3s: p.gasto_total_m3s,
            dobelas_data: p.dobelas as any,
            plantilla_m: p.plantilla_m,
            talud_z: p.talud_z,
            tirante_calculo_m: p.tirante_calculo_m,
            area_hidraulica_m2: p.area_hidraulica_m2,
            velocidad_media_ms: p.velocidad_media_ms,
            froude: p.froude,
            molinete_modelo: p.molinete_modelo,
            molinete_serie: p.molinete_serie,
            aforador: p.aforador,
            tirante_m: p.tirante_m
        }));

        if (aforosPayload.length > 0) {
            const { error: err } = await supabase.from('aforos').upsert(aforosPayload, { onConflict: 'id' });
            if (err) {
                console.error('Error insertando aforos:', err.message);
                const now = new Date().toISOString();
                await db.records.where('id').anyOf(aforosPending.map(p => p.id)).modify(r => {
                    r.error_sync = err.message;
                    r.retry_count = (r.retry_count ?? 0) + 1;
                    if (!r.first_failed_at) r.first_failed_at = now;
                });
            } else {
                syncSuccessIds.push(...aforosPending.map(p => p.id));
            }
        }

        // 1D. Movimientos de Presa (van a movimientos_presas)
        const presasPending = pending.filter(p => p.tipo === 'presa');
        const presasPayload = presasPending.map(p => ({
            id: p.id,
            presa_id: p.punto_id,
            fecha_hora: `${p.fecha_captura}T${p.hora_captura}${offsetString}`,
            gasto_m3s: p.valor_q,
            fuente_dato: 'SICA_CAPTURE'
        }));

        if (presasPayload.length > 0) {
            const { error: err } = await supabase.from('movimientos_presas').upsert(presasPayload, { onConflict: 'id' });
            if (err) {
                console.error('Error insertando movimientos_presas:', err.message);
                const now = new Date().toISOString();
                await db.records.where('id').anyOf(presasPending.map(p => p.id)).modify(r => {
                    r.error_sync = err.message;
                    r.retry_count = (r.retry_count ?? 0) + 1;
                    if (!r.first_failed_at) r.first_failed_at = now;
                });
            } else {
                syncSuccessIds.push(...presasPending.map(p => p.id as string));
            }
        }

        // Marcar como sincronizados solo los registros exitosos
        if (syncSuccessIds.length > 0) {
            await db.records.where('id').anyOf(syncSuccessIds).modify({ sincronizado: 'true', error_sync: undefined });
        }

        // Refrescar catálogo SIEMPRE después del intento (con o sin éxito):
        // Necesario para que nivel_actual, estado_hoy y escala_confirmada reflejen
        // el estado real de la BD, incluso si algunos registros fallaron por constraints.
        await downloadCatalogs();

    } catch (error) {
        console.error('Failed to sync records:', error);
    }
};
