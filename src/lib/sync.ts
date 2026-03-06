import { supabase } from './supabase';
import { db, type SicaAforoRecord } from './db';
import { getTodayString, getDaysAgoString, getTimezoneOffsetString } from './dateHelpers';

// -- 1. DESCARGA DE CATÁLOGOS (DE SUR A NORTE) --
// Llama a esto cuando el usuario inicie sesión para tener los catálogos en el teléfono
export const downloadCatalogs = async () => {
    if (!navigator.onLine) return; // Si no hay internet, usamos lo que ya tengamos local

    try {
        console.log('Downloading catalogs...');
        // A. Puntos de Entrega (Escalas)
        const { data: baseEscalas } = await supabase
            .from('escalas')
            .select('id, nombre, latitud, longitud, km, nivel_min_operativo, nivel_max_operativo, ancho, alto, pzas_radiales')
            .eq('activa', true);

        // Fetch daily summary for scales
        // Change: We now want to make sure we get the latest valid data, even if it was from yesterday
        // The DB maintenance job will soon create 'today' records at 00:00, but offline devices need to 
        // fallback to the most recent one if they haven't synced today yet.
        const { data: resumenEscalas } = await supabase
            .from('resumen_escalas_diario')
            .select('escala_id, nivel_actual, delta_12h, estado, fecha')
            .order('fecha', { ascending: false });

        const dictResumenEscalas = new Map<string, any>();
        if (resumenEscalas) {
            // First one is the most recent due to order desc
            resumenEscalas.forEach((r: any) => {
                if (!dictResumenEscalas.has(r.escala_id)) {
                    dictResumenEscalas.set(r.escala_id, r);
                }
            });
        }

        const mappedPuntos: any[] = [];
        if (baseEscalas) {
            mappedPuntos.push(...baseEscalas.map((p: any) => {
                const resumen = dictResumenEscalas.get(p.id);
                return {
                    id: p.id,
                    name: p.nombre,
                    type: 'escala',
                    km: parseFloat(p.km || 0),
                    lat: p.latitud,
                    lng: p.longitud,
                    nivel_min_operativo: parseFloat(p.nivel_min_operativo || 0),
                    nivel_max_operativo: parseFloat(p.nivel_max_operativo || 0),
                    nivel_actual: resumen ? parseFloat(resumen.nivel_actual || 0) : undefined,
                    delta_12h: resumen ? parseFloat(resumen.delta_12h || 0) : undefined,
                    escala_estado: resumen?.estado || 'normal',
                    ancho_radiales: p.ancho ? parseFloat(p.ancho) : undefined,
                    alto_radiales: p.alto ? parseFloat(p.alto) : undefined,
                    pzas_radiales: p.pzas_radiales ? parseInt(p.pzas_radiales) : undefined
                };
            }));
        }

        // B. Puntos de Entrega (Tomas, Laterales, Cárcamos)
        const { data: tomas } = await supabase
            .from('puntos_entrega')
            .select(`
                id, 
                nombre, 
                tipo,
                seccion_id,
                km,
                coords_x,
                coords_y,
                capacidad_max_lps,
                modulos ( codigo_corto, nombre ),
                secciones ( nombre )
            `);

        // C. Traer Estado Operativo de Hoy para Ayudas Visuales (Usando el offset local para consistencia)
        const todayStr = getTodayString();

        // Retrocedemos 5 días para asegurar que tomas que no "cruzaron" el cron job o quedaron abiertas sigan visibles
        const fiveDaysAgoStr = getDaysAgoString(5);

        // Fetch operational reports, recent ones first
        const { data: reportesRecientes } = await supabase
            .from('reportes_operacion')
            .select('punto_id, caudal_promedio, volumen_acumulado, hora_apertura, estado, fecha')
            .gte('fecha', fiveDaysAgoStr)
            .order('fecha', { ascending: false })
            .order('hora_apertura', { ascending: false });

        const mapReportes = new Map<string, any>();
        if (reportesRecientes) {
            reportesRecientes.forEach((r: any) => {
                // Al estar ordenado por fecha DESC, el primero que leemos es el estado operativo más reciente
                if (!mapReportes.has(r.punto_id)) {
                    const isToday = r.fecha === todayStr;
                    const caudalM3s = Number(r.caudal_promedio || 0);
                    let volumenM3 = isToday ? Number(r.volumen_acumulado || 0) * 1000000 : 0; // DB stores Mm³ → convert to m³

                    // Si el volumen del DB es 0 (o viene de un día anterior arrastrando estado abierto),
                    // calculamos dinámicamente: V = Q × t (m³/s × segundos)
                    // The backend job creates a new row at '00:00:00'. We should calculate volume from then.
                    const isStateOpen = ['inicio', 'continua', 'reabierto', 'modificacion'].includes(r.estado || '');
                    if ((volumenM3 === 0 || !isToday) && caudalM3s > 0 && r.hora_apertura && isStateOpen) {
                        let apertura = new Date(r.hora_apertura);
                        // If it's a continuity record from previous days, use midnight of today
                        if (!isToday) {
                            apertura = new Date(`${todayStr}T00:00:00`);
                        }
                        const ahora = new Date();
                        const segundosTranscurridos = Math.max(0, (ahora.getTime() - apertura.getTime()) / 1000);
                        volumenM3 = caudalM3s * segundosTranscurridos; // m³
                    }

                    mapReportes.set(r.punto_id, {
                        punto_id: r.punto_id,
                        estado: r.estado || 'cerrado',
                        volumen_total_m3: volumenM3, // Already in m³ from calculation
                        hora_apertura: r.hora_apertura,
                        caudal_promedio_m3s: caudalM3s
                    });
                }
            });
        }


        if (tomas) {
            mappedPuntos.push(...tomas.map((p: any) => {
                const reporte = mapReportes.get(p.id);
                return {
                    id: p.id,
                    name: p.nombre,
                    type: p.tipo, // 'toma', 'lateral', 'carcamo'
                    modulo: p.modulos?.codigo_corto || p.modulos?.nombre || 'General',
                    seccion: p.secciones?.nombre || 'S/S',
                    seccion_id: p.seccion_id,
                    km: parseFloat(p.km || 0),
                    estado_hoy: reporte?.estado || 'cerrado',
                    volumen_hoy_m3: parseFloat(reporte?.volumen_total_m3 || 0),
                    hora_apertura: reporte?.hora_apertura,
                    caudal_promedio: parseFloat(reporte?.caudal_promedio_m3s || 0),
                    capacidad_max_lps: p.capacidad_max_lps ? Number(p.capacidad_max_lps) : undefined,
                    lat: p.coords_y ? Number(p.coords_y) : 0,
                    lng: p.coords_x ? Number(p.coords_x) : 0
                };
            }));
        }

        // D. Puntos de Aforo (Aforos Principales)
        const { data: aforosControl } = await supabase
            .from('aforos_control')
            .select('id, nombre_punto, latitud, longitud, foto_url, caracteristicas_hidraulicas');

        if (aforosControl) {
            mappedPuntos.push(...aforosControl.map((p: any) => ({
                id: p.id,
                name: p.nombre_punto,
                type: 'aforo',
                lat: p.latitud ? Number(p.latitud) : 0,
                lng: p.longitud ? Number(p.longitud) : 0,
                foto_url: p.foto_url,
                caracteristicas_hidraulicas: p.caracteristicas_hidraulicas
            })));
        }

        if (mappedPuntos.length > 0) {
            // A-06: Atomic transaction — prevents empty IndexedDB if crash occurs between clear and bulkPut
            await db.transaction('rw', db.puntos, async () => {
                await db.puntos.clear();
                await db.puntos.bulkPut(mappedPuntos);
            });
        }

        console.log('Catalogs updated successfully.');
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
            responsable: p.responsable_nombre || 'Operador Móvil', // Real UUID linked
            turno: parseInt(p.hora_captura.split(':')[0]) < 14 ? 'am' : 'pm'
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
            usuario_id: p.responsable_id || null
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
            froude: p.froude
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
