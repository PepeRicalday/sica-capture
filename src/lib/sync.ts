import { supabase } from './supabase';
import { db, type SicaAforoRecord } from './db';
import { getTodayString, getDaysAgoString, getTimezoneOffsetString } from './dateHelpers';

// -- 1. DESCARGA DE CATÁLOGOS (DE SUR A NORTE) --
// Llama a esto cuando el usuario inicie sesión para tener los catálogos en el teléfono
export const downloadCatalogs = async (forceCatalog = false) => {
    if (!navigator.onLine) return;

    try {
        console.log('Downloading catalogs (forced:', forceCatalog, ')...');
        
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
            console.log('App version changed from', lastVersion, 'to', currentVersion, '. Forcing static fetch.');
            localStorage.setItem('sica_app_version', currentVersion);
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1); // Reducimos a 1 día para lecturas recientes
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        // 1. DYNAMIC DATA (Always fetch)
        
        // A. Fetch latest readings to check for confirmation AND pre-fill values
        const { data: lastReadings } = await supabase
            .from('lecturas_escalas')
            .select('escala_id, confirmada, nivel_m, nivel_abajo_m, apertura_radiales_m, radiales_json')
            .gte('fecha', yesterdayStr)
            .order('fecha', { ascending: false })
            .order('hora_lectura', { ascending: false });

        const readingsMap = new Map<string, any>();
        (lastReadings || []).forEach(lr => {
            if (!readingsMap.has(lr.escala_id)) {
                readingsMap.set(lr.escala_id, lr);
            }
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

        const mapReportes = new Map<string, any>();
        if (reportesRecientes) {
            reportesRecientes.forEach((r: any) => {
                if (!mapReportes.has(r.punto_id)) {
                    const isToday = r.fecha === todayStr;
                    const caudalM3s = Number(r.caudal_promedio || 0);
                    let volumenM3 = isToday ? Number(r.volumen_acumulado || 0) * 1000000 : 0;

                    const isStateOpen = ['inicio', 'continua', 'reabierto', 'modificacion'].includes(r.estado || '');
                    if ((volumenM3 === 0 || !isToday) && caudalM3s > 0 && r.hora_apertura && isStateOpen) {
                        let apertura = new Date(r.hora_apertura);
                        if (!isToday) apertura = new Date(`${todayStr}T00:00:00`);
                        const ahora = new Date();
                        const segundosTranscurridos = Math.max(0, (ahora.getTime() - apertura.getTime()) / 1000);
                        volumenM3 = caudalM3s * segundosTranscurridos;
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

        if (shouldFetchStatic) {
            console.log('Fetching static catalogs...');
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
            console.log('Using local static catalogs, merging with dynamic state.');
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
                const resumen = dictResumenEscalas.get(p.id);
                const reading = readingsMap.get(p.id);
                return {
                    ...p,
                    name: p.nombre || p.name,
                    type: 'escala',
                    // Alias: DB uses 'ancho'/'alto', OfflinePoint interface expects 'ancho_radiales'/'alto_radiales'
                    ancho_radiales: p.ancho,
                    alto_radiales: p.alto,
                    nivel_actual: (reading?.nivel_m !== undefined) ? reading.nivel_m : (resumen ? parseFloat(resumen.nivel_actual || 0) : p.nivel_actual),
                    nivel_abajo_m: reading?.nivel_abajo_m ?? p.nivel_abajo_m,
                    apertura_radiales_m: reading?.apertura_radiales_m ?? p.apertura_radiales_m,
                    radiales_json: reading?.radiales_json ?? p.radiales_json,
                    delta_12h: resumen ? parseFloat(resumen.delta_12h || 0) : p.delta_12h,
                    escala_estado: resumen?.estado || p.escala_estado || 'normal',
                    escala_confirmada: reading ? (reading.confirmada !== false) : (p.escala_confirmada ?? true)
                };
            }));
        }

        if (tomas) {
            mappedPuntos.push(...tomas.map((p: any) => {
                const reporte = mapReportes.get(p.id);
                // Si fetched, o si estaba en local, mantenemos info base y actualizamos dinámica
                const modulo = p.modulos?.codigo_corto || p.modulos?.nombre || p.modulo || 'General';
                const seccion = p.secciones?.nombre || p.secciones?.nombre || p.seccion || 'S/S';
                
                return {
                    id: p.id,
                    name: p.nombre || p.name,
                    type: p.tipo || p.type,
                    modulo,
                    seccion,
                    seccion_id: p.seccion_id,
                    km: parseFloat(p.km || 0),
                    estado_hoy: reporte?.estado || (reporte === undefined ? p.estado_hoy : 'cerrado'),
                    volumen_hoy_m3: parseFloat(reporte?.volumen_total_m3 || (reporte === undefined ? p.volumen_hoy_m3 : 0)),
                    hora_apertura: reporte?.hora_apertura || p.hora_apertura,
                    caudal_promedio: parseFloat(reporte?.caudal_promedio_m3s || (reporte === undefined ? p.caudal_promedio : 0)),
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
        console.log('Sync complete. Static fetched:', shouldFetchStatic);
    } catch (error) {
        console.error('Failed to download catalogs:', error);
        throw error;
    }
};

// -- 2. SUBIDA DE REGISTROS (DE NORTE A SUR) --
// Llama a esto cuando vuelva la conexión (Listener)
export const syncPendingRecords = async () => {
    if (!navigator.onLine) return;

    try {
        const pending = await db.records.where({ sincronizado: 'false' }).toArray();
        if (pending.length === 0) return;

        console.log(`Syncing ${pending.length} records...`);

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
            confirmada: p.confirmada ?? true // Forzar confirmación para bypass de seguridad
        }));

        const syncSuccessIds: string[] = [];

        if (escalasPayload.length > 0) {
            const { error: err } = await supabase.from('lecturas_escalas').upsert(escalasPayload, { onConflict: 'id' });
            if (err) {
                console.error('Error insertando escalas:', err.message);
                // Tag individual local records with error
                await db.records.where('id').anyOf(escalasPending.map(p => p.id)).modify({ error_sync: err.message });
            } else {
                syncSuccessIds.push(...escalasPending.map(p => p.id as string));
            }
        }

        // Obtener el offset local (Ej. -06:00 o -07:00 para Chihuahua) — centralizado via Intl
        const offsetString = getTimezoneOffsetString();

        // 1B. Tomas y Laterales (van a mediciones)
        const tomasPending = pending.filter(p => p.tipo === 'toma');
        const tomasPayload: any[] = tomasPending.map(p => ({
            id: p.id,
            punto_id: p.punto_id,
            valor_q: p.valor_q ?? 0,
            fecha_hora: `${p.fecha_captura}T${p.hora_captura}${offsetString}`,
            tipo_ubicacion: 'canal',
            estado_evento: p.estado_operativo || null,
            usuario_id: p.responsable_id || null,
            notas: p.notas
        }));

        if (tomasPayload.length > 0) {
            const { error: err } = await supabase.from('mediciones').upsert(tomasPayload, { onConflict: 'id' });
            if (err) {
                console.error('Error insertando tomas:', err.message);
                await db.records.where('id').anyOf(tomasPending.map(p => p.id)).modify({ error_sync: err.message });
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
                await db.records.where('id').anyOf(aforosPending.map(p => p.id)).modify({ error_sync: err.message });
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
                await db.records.where('id').anyOf(presasPending.map(p => p.id)).modify({ error_sync: err.message });
            } else {
                syncSuccessIds.push(...presasPending.map(p => p.id as string));
            }
        }

        // Si se subieron bien, *SOLO ESTOS* se marcan como sincronizados y se limpia el error
        if (syncSuccessIds.length > 0) {
            await db.records.where('id').anyOf(syncSuccessIds).modify({ sincronizado: 'true', error_sync: undefined });
            console.log(`Sync complete. Successfully synced ${syncSuccessIds.length}/${pending.length} records.`);

            // 🔥 CRITICAL: Refresh catalogs to get the new 'estado_hoy' computed by DB triggers
            await downloadCatalogs();
        } else {
            console.log('Sync attempted but no records were successfully transmitted.');
        }

    } catch (error) {
        console.error('Failed to sync records:', error);
    }
};
