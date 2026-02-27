/**
 * SICA Capture — Utilidades de Formato Hidráulico
 * Centraliza la conversión y formateo de unidades para evitar
 * inconsistencias entre componentes.
 */

/**
 * Formatea un caudal en m³/s para display en L/s.
 * @param m3s - Caudal en metros cúbicos por segundo
 * @param decimals - Dígitos decimales (default 0)
 * @returns String formateado, e.g. "125 L/s"
 */
export const formatCaudalLps = (m3s: number | undefined | null, decimals = 0): string => {
    if (!m3s) return '0 L/s';
    return `${(m3s * 1000).toFixed(decimals)} L/s`;
};

/**
 * Formatea un caudal en m³/s para display.
 * @param m3s - Caudal en m³/s
 * @param decimals - Dígitos decimales (default 3)
 * @returns String formateado, e.g. "1.250 m³/s"
 */
export const formatCaudalM3s = (m3s: number | undefined | null, decimals = 3): string => {
    if (!m3s) return '0.000 m³/s';
    return `${m3s.toFixed(decimals)} m³/s`;
};

/**
 * Convierte un volumen en m³ a display en Mm³ (millones de metros cúbicos).
 * @param m3 - Volumen en metros cúbicos
 * @param decimals - Dígitos decimales (default 3)
 * @returns String formateado, e.g. "0.045 Mm³"
 */
export const formatVolumenMm3 = (m3: number | undefined | null, decimals = 3): string => {
    if (!m3) return '0.000 Mm³';
    return `${(m3 / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })} Mm³`;
};
