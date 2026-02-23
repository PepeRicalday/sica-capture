import Dexie, { type Table } from 'dexie';

// 1. Catálogos Offline (Para que el dropdown funcione sin red)
export interface OfflinePoint {
    id: string; // UUID from Supabase
    name: string;
    type: string; // 'toma', 'lateral', 'escala'
    modulo?: string;
    seccion?: string;
    seccion_id?: string;
    estado_hoy?: string;
    volumen_hoy_mm3?: number;
    hora_apertura?: string;
    caudal_promedio?: number;
    km?: number;
    lat?: number;
    lng?: number;
}

// 2. Registro a Sincronizar (Mochila)
export interface SicaRecord {
    id: string; // V2 Migration: Using UUIDs locally to prevent sync collisions
    tipo: 'escala' | 'toma' | 'aforo';

    // Payload Dinámico dependiendo del tipo
    punto_id?: string; // UUID
    valor_q?: number; // Para escalas/tomas
    estado_operativo?: 'inicio' | 'suspension' | 'reabierto' | 'cierre' | 'continua' | 'modificacion'; // Para Tomas

    fecha_captura: string;
    hora_captura: string;
    sincronizado: 'true' | 'false'; // IndexedDB booleans workaround
}

export interface AforoDobela {
    base_m: number;
    tirante_m: number;
    velocidades_revoluciones: number[];
    velocidades_segundos: number[];
}

export interface SicaAforoRecord extends SicaRecord {
    tipo: 'aforo';
    punto_id: string; // ID del punto de control en el canal principal
    tirante_inicial_m: number;
    tirante_final_m: number;
    hora_inicial: string;
    hora_final: string;
    espejo_m: number;
    dobelas: AforoDobela[]; // Array con los datos de cada sección (v1, v2, v3...)
    gasto_total_m3s: number; // Resultado calculado
}

export class MySubClassedDexie extends Dexie {
    records!: Table<SicaRecord>;
    puntos!: Table<OfflinePoint>;

    constructor() {
        super('sica_capture_db');
        // v2: Catálogos, v3: Tomas, v5: Aforos Canal Principal, v6: Offline UUIDs, v7: Hidrometria metrics
        this.version(7).stores({
            records: 'id, sincronizado, tipo, punto_id', // Primary key is now a UUID string
            puntos: 'id, type', // Catálogo offline de ubicaciones
        }).upgrade(() => {
            // Migrate old records to have UUIDs if any
        });
    }
}

export const db = new MySubClassedDexie();
