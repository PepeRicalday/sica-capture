/**
 * hydraulicCalculations.ts
 *
 * Fuente única de verdad para todos los cálculos de gasto hidráulico en SICA Capture.
 * Consumido por: Capture.tsx (guardado y display), Monitor.tsx, TomaHistoryModal.
 *
 * Fórmulas aplicadas:
 *  - Con compuertas radiales:
 *      · Flujo por orificio (compuerta parcialmente abierta, ap < hArriba):
 *          Q_i = Cd × (ancho × ap_i) × √(2g × carga)
 *      · Flujo libre / vertedor (compuerta abierta sobre el nivel del agua, ap ≥ hArriba):
 *          Q_i = Cv × ancho × carga^1.5
 *  - Sin compuertas (garganta larga / vertedor libre):
 *      Q = Cd_gl × hArriba^n
 *
 * Constantes hidráulicas (de referencia IMTA / norma mexicana):
 *  Cd  = 0.62  — coeficiente de descarga para orificio rectangular
 *  Cv  = 1.84  — coeficiente vertedor tipo Rehbock/Bazin (m^½/s)
 *  g   = 9.81  m/s²
 *  Cd_gl = 1.84, n = 1.52  — garganta larga sin radiales
 */

export const HYDRAULIC_CONSTANTS = {
    Cd: 0.62,       // Coeficiente de descarga — orificio rectangular
    Cv: 1.84,       // Coeficiente de vertedor libre
    g: 9.81,        // Gravedad (m/s²)
    Cd_gl: 1.84,    // Coeficiente garganta larga
    n_gl: 1.52,     // Exponente garganta larga
    MIN_CARGA: 0.01 // Diferencial mínimo (m) para flujo significativo
} as const;

export interface RadialGate {
    index: number;
    apertura_m: number;
}

export interface FlowConfig {
    hArriba: number;        // Nivel aguas arriba (m)
    hAbajo: number;         // Nivel aguas abajo (m)
    pzasRadiales?: number;  // Número de compuertas radiales
    anchoRadial?: number;   // Ancho por compuerta (m)
    altoRadial?: number;    // Altura máxima física de la compuerta (m)
    aperturas: number[];    // Apertura por compuerta (m), longitud = pzasRadiales
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
    const { hArriba, hAbajo, pzasRadiales, anchoRadial, aperturas } = config;
    const { Cd, Cv, g, Cd_gl, n_gl, MIN_CARGA } = HYDRAULIC_CONSTANTS;

    const carga = Math.max(0, hArriba - hAbajo);
    const gatesFlow: number[] = [];
    let q_total = 0;
    let hasRadialesOpen = false;

    if (pzasRadiales && pzasRadiales > 0 && anchoRadial && anchoRadial > 0 && aperturas.length > 0) {
        for (let i = 0; i < pzasRadiales; i++) {
            const ap = aperturas[i] || 0;
            let q_gate = 0;

            if (ap > 0 && carga > MIN_CARGA) {
                hasRadialesOpen = true;
                const area = anchoRadial * ap;

                if (ap < hArriba) {
                    // Orificio: compuerta sumergida o parcialmente abierta
                    q_gate = Cd * area * Math.sqrt(2 * g * carga);
                } else {
                    // Vertedor libre: compuerta alzada por encima del nivel del agua
                    q_gate = Cv * anchoRadial * Math.pow(carga, 1.5);
                }
            }

            gatesFlow.push(q_gate);
            q_total += q_gate;
        }
    } else {
        // Garganta larga (sin radiales)
        if (hArriba > 0) {
            q_total = Cd_gl * Math.pow(hArriba, n_gl);
        }
    }

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
