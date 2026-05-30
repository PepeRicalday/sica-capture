/**
 * hydraulicCalculations.ts
 *
 * Fuente única de verdad para todos los cálculos de gasto hidráulico en SICA Capture.
 * Consumido por: Capture.tsx (guardado y display), Monitor.tsx, TomaHistoryModal.
 *
 * Fórmulas aplicadas:
 *  - Con compuertas radiales:
 *      · Flujo por orificio (compuerta parcialmente abierta, ap < hArriba):
 *          Q_i = Cd × (ancho × ap_i) × √(2g × carga)  × factorCorreccion
 *      · Flujo libre / vertedor (compuerta abierta sobre el nivel del agua, ap ≥ hArriba):
 *          Q_i = Cv × ancho × carga^1.5  × factorCorreccion
 *  - Sin compuertas (garganta larga / vertedor libre):
 *      Q = Cd_gl × hArriba^n
 *
 * Constantes hidráulicas (de referencia IMTA / norma mexicana):
 *  Cd  = 0.62  — coeficiente de descarga para orificio rectangular
 *  Cv  = 1.84  — coeficiente vertedor tipo Rehbock/Bazin (m^½/s)
 *  g   = 9.81  m/s²
 *  Cd_gl = 1.84, n = 1.52  — garganta larga sin radiales
 *
 * Factores de corrección M1 (régimen remanso aguas arriba):
 *  Calibrados empíricamente por punto de control. El régimen M1 con compuertas cada
 *  10–20 km genera contrapresión aguas abajo que reduce el ΔH efectivo.
 *  Factor > 1.0 → compuerta trabaja con mayor eficiencia que la fórmula estándar
 *  Factor < 1.0 → compuerta trabaja con menor eficiencia (mayor contrapresión aguas abajo)
 */

export const HYDRAULIC_CONSTANTS = {
    Cd: 0.62,       // Coeficiente de descarga — orificio rectangular
    Cv: 1.84,       // Coeficiente de vertedor libre
    g: 9.81,        // Gravedad (m/s²)
    Cd_gl: 1.84,    // Coeficiente garganta larga
    n_gl: 1.52,     // Exponente garganta larga
    MIN_CARGA: 0.01 // Diferencial mínimo (m) para flujo significativo
} as const;

/**
 * Factores de corrección M1 por punto de control.
 * Sincronizado con conchos-digital/src/utils/hydraulics.ts — skill v3.6f
 * validado aforos campo 18/05/2026.
 * K-79+025 usa Opción A (carga → h_arriba cuando Δh ≤ 0) — ver calculateFlow().
 */
export const FACTORES_CORRECCION_M1: Record<string, number> = {
    'K-0+000':   1.1855,   // aforo molinete K1+000=27.825 m³/s 18/05/2026 (−5.5% vs 14/05)
    'K-23':      1.9031,   // CONGELADO — sifón: fórmula radial no aplica, no calibrar por balance
    'K-29':      1.2379,   // aforo anterior (restaurado; 14/05 sobreestimó +16%)
    'K-34':      1.5199,   // aforo anterior (restaurado; 14/05 sobreestimó)
    'K-44':      1.0119,   // aforo anterior (restaurado; 14/05 sobreestimó)
    'K-54':      1.0066,   // aforo 27/04/2026
    'K-62':      1.0537,   // aforo 27/04/2026
    'K-64':      1.3305,   // escala referencia — sin cambio
    'K-68':      1.0398,   // aforo anterior (restaurado; 14/05 sobreestimó +43%)
    'K-79+025':  1.5824,   // aforo anterior (restaurado; 14/05 sobreestimó +26%)
    'K-87+549':  1.2089,   // aforo anterior (restaurado; 14/05 sobreestimó +18%)
    'K-94+057':  1.1612,   // aforo anterior (restaurado; 14/05 sobreestimó +23%)
    'K-94+200':  1.2851,   // escala referencia — sin cambio
    'K-104':     0.7714,   // ancla salida — sin cambio
};

/**
 * Sifones — Q no se calcula por fórmula radial sino por propagación desde K-0+000.
 * Q_sifon = Q_K0 - delta_q  (delta_q = entregas acumuladas aguas arriba del sifón)
 * Cal. 07/05/2026 bal. Z1: entregas K-0+000 → K-23 = 0.650 m³/s
 */
export const SIFON_DELTA_Q: Record<string, number> = {
    'K-23': 0.650,
};

/** Devuelve Q propagado desde K-0+000 para una escala tipo sifón. */
export function propagarQSifon(nombre: string, q_k0: number): number {
    const clave = Object.keys(SIFON_DELTA_Q).find(k => nombre?.toUpperCase().includes(k));
    if (clave === undefined) return 0;
    return Math.max(0, q_k0 - SIFON_DELTA_Q[clave]);
}

/** True si la escala es un sifón (Q por propagación, no por fórmula). */
export function esSifon(nombre: string): boolean {
    return Object.keys(SIFON_DELTA_Q).some(k => nombre?.toUpperCase().includes(k));
}

/**
 * Estructuras mixtas — compuertas + vertedor de sobrepaso superior.
 * Q_total = Q_compuertas(M1) + Q_sobrepaso  cuando H > H_crit
 * Q_sobrepaso = Cw × L_vertedor × (H - H_crit)^1.5
 * M1 se CONGELA al valor calibrado cuando H > H_crit (no ajustar por balance).
 * Ref: Informe Técnico K-68 07/05/2026. L estimada ≈ 8.5m para Q_sobrepaso=0.20 m³/s a ΔH=0.05m.
 * Pendiente: medir L real en campo.
 */
export const SOBREPASO_CONFIG: Record<string, { h_crit: number; Cw: number; L: number }> = {
    'K-68': { h_crit: 3.56, Cw: 2.1, L: 10.80 },  // 2 vertedores × 5.40m = 10.80m (medido campo 07/05/2026)
};

/** Calcula Q_sobrepaso para una escala con estructura mixta. Retorna 0 si H ≤ H_crit. */
export function calcQSobrepaso(nombre: string, hArriba: number): number {
    const cfg = Object.entries(SOBREPASO_CONFIG).find(([k]) => nombre?.toUpperCase().includes(k))?.[1];
    if (!cfg || hArriba <= cfg.h_crit) return 0;
    return cfg.Cw * cfg.L * Math.pow(hArriba - cfg.h_crit, 1.5);
}

// Posiciones kilométricas nominales de cada punto de control (para búsqueda por km más cercano)
const _KM_BY_NAME: Record<string, number> = {
    'K-23':      23.0,
    'K-29':      29.0,
    'K-34':      34.0,
    'K-44':      44.0,
    'K-54':      54.0,
    'K-62':      62.0,
    'K-64':      64.0,
    'K-68':      68.0,
    'K-79+025':  79.025,
    'K-87+549':  87.549,
    'K-94+057':  94.057,
    'K-94+200':  94.200,
    'K-104':    104.0,
};

/**
 * Devuelve el factor de corrección M1 para un punto de control.
 * Búsqueda por nombre exacto (normalizado). Si no coincide, busca el punto de
 * control más cercano por km. Si km tampoco está disponible, retorna 1.0.
 *
 * @param nombre  - Nombre del punto (p.ej. "K-23", "K-79+025")
 * @param km      - Posición kilométrica numérica (opcional, como respaldo)
 */
export function getFactorCorreccion(nombre?: string, km?: number): number {
    if (nombre) {
        // Intento 1: coincidencia exacta (normalizada — trim + mayúsculas)
        const key = nombre.trim().toUpperCase();
        for (const [k, v] of Object.entries(FACTORES_CORRECCION_M1)) {
            if (k.toUpperCase() === key) return v;
        }

        // Intento 2: el nombre contiene alguna clave conocida (ej. "Derivadora K-23")
        for (const [k, v] of Object.entries(FACTORES_CORRECCION_M1)) {
            if (key.includes(k.toUpperCase()) || k.toUpperCase().includes(key)) return v;
        }
    }

    // Intento 3: km más cercano dentro de ±2 km
    if (km !== undefined && km !== null) {
        let bestName = '';
        let bestDist = 2.0;
        for (const [name, nomKm] of Object.entries(_KM_BY_NAME)) {
            const dist = Math.abs(km - nomKm);
            if (dist < bestDist) { bestDist = dist; bestName = name; }
        }
        if (bestName) return FACTORES_CORRECCION_M1[bestName];
    }

    // Sin coincidencia → factor neutro
    return 1.0;
}

export interface RadialGate {
    index: number;
    apertura_m: number;
}

export interface FlowConfig {
    hArriba: number;           // Nivel aguas arriba (m)
    hAbajo: number;            // Nivel aguas abajo (m)
    pzasRadiales?: number;     // Número de compuertas radiales
    anchoRadial?: number;      // Ancho por compuerta (m)
    altoRadial?: number;       // Altura máxima física de la compuerta (m)
    aperturas: number[];       // Apertura por compuerta (m), longitud = pzasRadiales
    factorCorreccion?: number; // Factor de corrección M1 empírico por punto de control (default 1.0)
    esGargantaLarga?: boolean; // true → usar fórmula Cd·H^n (p.ej. K-94+200). false/absent → escala de referencia pura (K-64), Q=0
}

export interface FlowResult {
    q_total: number;            // Gasto total (m³/s)
    hasRadialesOpen: boolean;   // Si hay al menos una compuerta con flujo
    gatesFlow: number[];        // Gasto por compuerta (m³/s)
}

/**
 * Calcula el gasto total en m³/s para una escala.
 * Acepta tanto configuraciones con compuertas radiales como garganta larga.
 */
export function calculateFlow(config: FlowConfig): FlowResult {
    const { hArriba, hAbajo, pzasRadiales, anchoRadial, aperturas, factorCorreccion, esGargantaLarga } = config;
    const { Cd, Cv, g, Cd_gl, n_gl, MIN_CARGA } = HYDRAULIC_CONSTANTS;

    // Factor de corrección M1 empírico — solo se aplica a compuertas radiales.
    // Un valor de 1.0 (por defecto) reproduce el comportamiento anterior sin cambios.
    const fcm1 = (factorCorreccion !== undefined && factorCorreccion > 0) ? factorCorreccion : 1.0;

    const carga = Math.max(0, hArriba - hAbajo);
    const gatesFlow: number[] = [];
    let q_total = 0;
    let hasRadialesOpen = false;

    if (pzasRadiales && pzasRadiales > 0 && anchoRadial && anchoRadial > 0 && aperturas.length > 0) {
        for (let i = 0; i < pzasRadiales; i++) {
            const ap = aperturas[i] || 0;
            let q_gate = 0;

            if (ap > 0 && hArriba > MIN_CARGA) {
                hasRadialesOpen = true;
                const area = anchoRadial * ap;

                // Opción A (cal. 22/04/2026): cuando Δh ≤ 0 (remanso extremo, h_abajo ≥ h_arriba)
                // se usa h_arriba como carga absoluta en lugar del diferencial.
                // Aplica a K-79+025 y cualquier punto con contrapresión aguas abajo que
                // iguale o supere el nivel aguas arriba.
                const cargaEfectiva = carga > MIN_CARGA ? carga : hArriba;

                if (ap < hArriba) {
                    // Orificio: compuerta sumergida o parcialmente abierta
                    q_gate = Cd * area * Math.sqrt(2 * g * cargaEfectiva) * fcm1;
                } else {
                    // Vertedor libre: compuerta alzada por encima del nivel del agua
                    q_gate = Cv * anchoRadial * Math.pow(cargaEfectiva, 1.5) * fcm1;
                }
            }

            gatesFlow.push(q_gate);
            q_total += q_gate;
        }
    } else if (esGargantaLarga) {
        // Garganta larga explícita (sin radiales, con fórmula Cd·H^n) — factor M1 no aplica
        if (hArriba > 0) {
            q_total = Cd_gl * Math.pow(hArriba, n_gl);
        }
    }
    // Si no hay radiales y no es garganta larga → escala de referencia pura (p.ej. K-64): Q = 0

    return { q_total, hasRadialesOpen, gatesFlow };
}

/**
 * Valida que la apertura de una compuerta no exceda su altura física.
 * Retorna mensaje de error o null si es válida.
 */
export function validateGateAperture(
    apertura_m: number,
    altoRadial: number,
    gateIndex: number
): string | null {
    if (apertura_m > altoRadial) {
        return `Apertura de radial ${gateIndex + 1} (${apertura_m.toFixed(2)}m) excede tamaño físico (${altoRadial.toFixed(2)}m).`;
    }
    return null;
}
