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
    volumen_hoy_m3?: number;
    hora_apertura?: string;
    caudal_promedio?: number;
    capacidad_max_lps?: number;
    km?: number;
    lat?: number;
    lng?: number;
    // Escala Graph metrics
    nivel_min_operativo?: number;
    nivel_max_operativo?: number;
    nivel_actual?: number;
    nivel_abajo_m?: number;
    apertura_radiales_m?: number;
    radiales_json?: any[];
    delta_12h?: number;
    escala_estado?: string;
    escala_confirmada?: boolean;
    ultima_lectura_ts?: string; // ISO timestamp de la última lectura de escala

    // Configuración Radiales de la Escala
    ancho_radiales?: number;
    alto_radiales?: number;
    pzas_radiales?: number;

    // Aforo Extended
    foto_url?: string;
    caracteristicas_hidraulicas?: any;
}

// 2. Registro a Sincronizar (Mochila)
export interface SicaRecord {
    id: string; // V2 Migration: Using UUIDs locally to prevent sync collisions
    tipo: 'escala' | 'toma' | 'aforo' | 'presa' | 'entrega';

    // Auditoría
    responsable_id?: string;
    responsable_nombre?: string;

    // Payload Dinámico dependiendo del tipo
    valor_q?: number; // Para tomas (L/s)
    nivel_m?: number; // Para escalas
    nivel_abajo_m?: number;
    apertura_radiales_m?: number;
    confirmada?: boolean;
    estado_operativo?: 'inicio' | 'suspension' | 'reabierto' | 'cierre' | 'continua' | 'modificacion';

    // Metadatos operacionales
    punto_id: string; // ID del punto (PE-xxx, ESC-xxx)
    fecha_captura: string; // ISO string o date string
    hora_captura: string;
    sincronizado: 'true' | 'false'; // IndexedDB booleans workaround
    error_sync?: string;       // Por qué falló la subida (Ej. RLS, Validación)
    retry_count?: number;      // Intentos fallidos acumulados
    first_failed_at?: string;  // ISO timestamp del primer fallo (para detectar errores crónicos)
    notas?: string;            // Observaciones o metadata (como GPS para confirmaciones de arribo)

    // Nuevas métricas para Reporte de Escalas (Represos)
    gasto_calculado_m3s?: number;
    radiales_json?: any[]; // Arreglo detallado de cada compuerta radial

    // Campos exclusivos de tipo 'entrega'
    modulo_id?: string;
    zona_id?: string;
    ciclo_id?: string;
    tipo_entrega?: 'base' | 'adicional';
    hora_inicio_entrega?: string;   // HH:MM:SS
    hora_fin_entrega?: string;      // HH:MM:SS
    horas_operacion?: number;
    volumen_m3?: number;            // gasto_m3s × horas × 3600
    motivo_adicional?: string;      // requerido cuando tipo_entrega = 'adicional'
}

/** Lectura individual de molinete dentro de una dobela */
export interface AforoLectura {
    lectura_raw:   string;          // Texto exacto del campo: "46/40", "45", "44"
    tiempo_s:      number;          // Segundos usados para cálculo (primer valor si "X/Y")
    tiempo_s_alt?: number | null;   // Segundo tiempo si notación "X/Y"
    velocidad_ms:  number;          // V = coef × (n_rev / tiempo_s)
}

export interface AforoDobela {
    // Geometría
    base_m:    number;
    tirante_m: number;
    // Molinete (estructura nueva con trazabilidad completa)
    n_revoluciones?: number;        // Revoluciones fijas para esta dobela (30, 40, 45…)
    lecturas?:       AforoLectura[];// 3 lecturas individuales con raw notation
    // Calculados por dobela (persistidos para reproducir cédula exacta)
    area_m2?:           number;
    velocidad_media_ms?: number;
    gasto_m3s?:          number;
    // Legacy — mantiene compatibilidad con registros anteriores
    velocidades_revoluciones?: number[];
    velocidades_segundos?:     number[];
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
    plantilla_m?: number;
    talud_z?: number;
    tirante_calculo_m?: number;
    area_hidraulica_m2?: number;
    velocidad_media_ms?: number;
    froude?: number;
    // Campos extendidos del formato de aforo por molinete
    molinete_modelo?:  string;  // Ej. "ROSSBACH_PRICE"
    molinete_serie?:   string;  // Ej. "7320" (legacy)
    molinete_numero?:  string;  // Número completo: "73201"
    coef_molinete?:    number;  // Factor k en V = k×(N/t) — default 0.70
    aforador?:         string;  // Nombre del ingeniero aforador
    tirante_m?:        number;  // Tirante y medido en campo
    profundidad_total_m?: number;  // H (de fondo a corona)
    borde_libre_m?:    number;  // H - y
    velocidad_promedio_ms?: number; // Promedio de medias de todas las dobelas
}

export interface PerfilHidraulico {
    id: string;
    km_inicio: number;
    km_fin: number;
    nombre_tramo: string;
    capacidad_diseno_m3s: number;
    plantilla_m: number;
    talud_z: number;
    tirante_diseno_m: number;
    pendiente_s0: number;
    ancho_corona_m: number;
    bordo_libre_m: number;
    velocidad_diseno_ms: number;
    inicio_lat?: number;
    inicio_lng?: number;
    fin_lat?: number;
    fin_lng?: number;
}

// Catálogo de zonas del canal (descargado de zonas_canal)
export interface ZonaCatalog {
    id: string;
    nombre: string;
    codigo: string;         // 'Z1' | 'Z2' | 'Z3' | 'Z4'
    km_inicio: number;
    km_fin: number;
    escala_entrada_id?: string;
    escala_salida_id?: string;
    color?: string;
}

// Relación módulo ↔ zona (muchos a muchos — modulo_zonas)
export interface ModuloZona {
    modulo_id: string;
    zona_id: string;
    es_primaria: boolean;
}

// Balance por módulo-zona (descargado de balance_volumen_modulo)
// Un módulo multizona (ej. M2) genera una fila por zona.
// En zonas secundarias vol_base_m3, vol_base_disponible_m3 y pct_base_consumido son null.
export interface ModuloBalance {
    modulo_id: string;
    modulo_nombre: string;
    codigo_corto?: string;
    zona_id?: string;
    zona_codigo?: string;
    zona_nombre?: string;
    es_primaria?: boolean;
    ciclo_id?: string;
    vol_base_m3: number | null;
    vol_base_consumido_m3: number;
    vol_adicional_consumido_m3: number;
    vol_total_consumido_m3: number;
    vol_base_disponible_m3: number | null;
    pct_base_consumido: number | null;
    ultimo_adicional_fecha?: string;
    estado_volumen: 'normal' | 'alerta_base' | 'base_agotado' | 'adicional_activo';
}

export class SicaCaptureDB extends Dexie {
    records!: Table<SicaRecord>;
    puntos!: Table<OfflinePoint>;
    perfil_hidraulico!: Table<PerfilHidraulico>;
    zonas!: Table<ZonaCatalog>;
    modulos_balance!: Table<ModuloBalance>;
    modulo_zonas!: Table<ModuloZona>;

    constructor() {
        super('sica_capture_db_v2');
        // v2: Catálogos, v3: Tomas, v5: Aforos Canal Principal, v6: Offline UUIDs,
        // v7: Hidrometria metrics, v8: Canal Profiles, v9: Zonas + Entregas Módulo
        // v10: modulo_zonas (M2M) + PK compuesta en modulos_balance para multizona
        this.version(8).stores({
            records: 'id, sincronizado, tipo, punto_id',
            puntos: 'id, type',
            perfil_hidraulico: 'id, km_inicio, km_fin'
        });
        this.version(9).stores({
            records: 'id, sincronizado, tipo, punto_id',
            puntos: 'id, type',
            perfil_hidraulico: 'id, km_inicio, km_fin',
            zonas: 'id, codigo',
            modulos_balance: 'modulo_id, zona_id'
        });
        this.version(10).stores({
            records: 'id, sincronizado, tipo, punto_id',
            puntos: 'id, type',
            perfil_hidraulico: 'id, km_inicio, km_fin',
            zonas: 'id, codigo',
            modulos_balance: '[modulo_id+zona_id], modulo_id, zona_id',
            modulo_zonas: '[modulo_id+zona_id], modulo_id, zona_id'
        });
    }
}

export const db = new SicaCaptureDB();
