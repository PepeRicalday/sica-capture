/**
 * volumeCalculations.ts
 *
 * Cálculo de volumen acumulado integrando Q × Δt sobre cada tramo del ciclo.
 * Maneja correctamente cambios de gasto intra-día (modificaciones).
 *
 * Consumido por: TomaHistoryModal, sync.ts (volumen en catálogo).
 */

/**
 * Calcula el volumen total acumulado (m³) para un conjunto de eventos ordenados.
 * Integra Q × Δt tramo a tramo — si el técnico modificó el gasto a las 14:00,
 * los tramos anterior y posterior se calculan con su Q correspondiente.
 *
 * @param events  Array de mediciones con fecha_hora (ISO) y valor_q (m³/s).
 * @param endMs   Timestamp de cierre (ms). Si no se pasa, se usa Date.now() si el ciclo sigue abierto.
 */
export function calcVolumeM3(
    events: Array<{ fecha_hora: string; valor_q: number | string; estado_evento?: string }>,
    endMs?: number
): number {
    if (events.length === 0) return 0;

    const sorted = [...events].sort(
        (a, b) => new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime()
    );

    const lastEv = sorted[sorted.length - 1];
    const isOpen =
        lastEv.estado_evento !== 'cierre' && lastEv.estado_evento !== 'suspension';
    const tFin = endMs ?? (isOpen ? Date.now() : new Date(lastEv.fecha_hora).getTime());

    let vol = 0;
    for (let i = 0; i < sorted.length; i++) {
        const q = Number(sorted[i].valor_q) || 0;
        if (q <= 0) continue;

        const t0 = new Date(sorted[i].fecha_hora).getTime();
        const t1 =
            i + 1 < sorted.length
                ? new Date(sorted[i + 1].fecha_hora).getTime()
                : tFin;

        const dtSec = Math.max(0, (t1 - t0) / 1000);
        vol += q * dtSec; // m³
    }

    return vol;
}

/**
 * Formatea un volumen en m³ eligiendo unidad apropiada.
 * < 1000 m³ → "XXX m³"
 * ≥ 1000 m³ → "X.XX Mm³" (miles de m³)  [uso interno — no confundir con Mm³ = 10^6]
 */
export function formatVolume(m3: number): string {
    if (m3 >= 1_000_000) return `${(m3 / 1_000_000).toFixed(3)} Mm³`;
    if (m3 >= 1_000) return `${(m3 / 1_000).toFixed(2)} Mm³`;
    return `${m3.toFixed(0)} m³`;
}
