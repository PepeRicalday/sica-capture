import { supabase } from './supabase';
import { db, type SicaAforoRecord } from './db';

// -- 1. DESCARGA DE CATÁLOGOS (DE SUR A NORTE) --
// Llama a esto cuando el usuario inicie sesión para tener los catálogos en el teléfono
export const downloadCatalogs = async () => {
    if (!navigator.onLine) return; // Si no hay internet, usamos lo que ya tengamos local

    try {
        console.log('Downloading catalogs...');
        // A. Puntos de Entrega (Escalas)
        const { data: escalas } = await supabase
            .from('escalas')
            .select('id, nombre, latitud, longitud')
            .eq('activa', true);

        const mappedPuntos: any[] = [];
        if (escalas) {
            mappedPuntos.push(...escalas.map((p: any) => ({
                id: p.id,
                name: p.nombre,
                type: 'escala',
                lat: p.latitud,
                lng: p.longitud
            })));
        }

        // B. Puntos de Entrega (Tomas, Laterales, Cárcamos)
        const { data: tomas } = await supabase
            .from('puntos_entrega')
            .select(`
                id, 
                nombre, 
                tipo,
                seccion_id,
                coords_x,
                coords_y,
                modulos ( codigo_corto, nombre ),
                secciones ( nombre )
            `);

        // C. Traer Estado Operativo de Hoy para Ayudas Visuales
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(new Date());
        const { data: reportesHoy } = await supabase
            .from('reportes_diarios')
            .select('punto_id, estado, volumen_total_mm3')
            .eq('fecha', todayStr);

        const mapReportes = new Map(reportesHoy?.map(r => [r.punto_id, r]) || []);

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
                    estado_hoy: reporte?.estado || 'cerrado',
                    volumen_hoy_mm3: parseFloat(reporte?.volumen_total_mm3 || 0),
                    lat: p.coords_y,
                    lng: p.coords_x
                };
            }));
        }

        if (mappedPuntos.length > 0) {
            await db.puntos.clear(); // Limpiar antes de poblar
            await db.puntos.bulkPut(mappedPuntos);
        }

        console.log('Catalogs updated successfully.');
    } catch (error) {
        console.error('Failed to download catalogs:', error);
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
            escala_id: p.punto_id,
            fecha: p.fecha_captura,
            nivel_m: p.valor_q,
            hora_lectura: p.hora_captura,
            responsable: 'Operador Móvil', // Esto vendría del Auth en un entorno real
            turno: parseInt(p.hora_captura.split(':')[0]) < 14 ? 'am' : 'pm'
        }));

        let syncSuccessIds: number[] = [];

        if (escalasPayload.length > 0) {
            const { error } = await supabase.from('lecturas_escalas').insert(escalasPayload);
            if (error) {
                console.error('Error insertando escalas:', error.message);
            } else {
                // Agregar IDs a la lista de éxitos
                syncSuccessIds.push(...escalasPending.map(p => p.id as number));
            }
        }

        // 1B. Tomas y Laterales (van a mediciones)
        const tomasPending = pending.filter(p => p.tipo === 'toma');
        const tomasPayload = tomasPending.map(p => ({
            punto_id: p.punto_id,
            valor_q: p.valor_q,
            fecha_hora: `${p.fecha_captura}T${p.hora_captura}Z`, // Ajuste requerido por PostgreSQL timestamp with time zone (depende de config)
            tipo_ubicacion: 'canal',
            estado_evento: p.estado_operativo || null
        }));

        if (tomasPayload.length > 0) {
            const { error } = await supabase.from('mediciones').insert(tomasPayload);
            if (error) {
                console.error('Error insertando tomas:', error.message);
            } else {
                // Agregar IDs a la lista de éxitos
                syncSuccessIds.push(...tomasPending.map(p => p.id as number));
            }
        }

        // 1C. Aforos (van a aforos)
        const aforosPending = pending.filter(p => p.tipo === 'aforo') as (SicaAforoRecord & { id: number })[];
        const aforosPayload = aforosPending.map(p => ({
            punto_control_id: p.punto_id, // Asumiendo que es estación
            fecha: p.fecha_captura,
            hora_inicio: p.hora_inicial,
            hora_fin: p.hora_final,
            nivel_escala_inicio_m: p.tirante_inicial_m,
            nivel_escala_fin_m: p.tirante_final_m,
            espejo_agua_m: p.espejo_m,
            gasto_calculado_m3s: p.gasto_total_m3s,
            dobelas_data: p.dobelas // JSONB en Supabase
        }));

        if (aforosPayload.length > 0) {
            const { error } = await supabase.from('aforos').insert(aforosPayload);
            if (error) {
                console.error('Error insertando aforos:', error.message);
            } else {
                // Agregar IDs a la lista de éxitos
                syncSuccessIds.push(...aforosPending.map(p => p.id));
            }
        }

        // Si se subieron bien, *SOLO ESTOS* se marcan como sincronizados
        if (syncSuccessIds.length > 0) {
            await db.records.where('id').anyOf(syncSuccessIds).modify({ sincronizado: 'true' });
            console.log(`Sync complete. Successfully synced ${syncSuccessIds.length}/${pending.length} records.`);
        } else {
            console.log('Sync attempted but no records were successfully transmitted.');
        }

    } catch (error) {
        console.error('Failed to sync records:', error);
    }
};
