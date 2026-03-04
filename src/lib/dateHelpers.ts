/**
 * Centralized Date Helpers — SICA Capture
 * Mirrors conchos-digital/src/utils/dateHelpers.ts for consistency.
 * Uses 'America/Chihuahua' timezone consistently across the platform.
 * Delicias, Chihuahua observes Tiempo del Centro (UTC-6 DST / UTC-7 Std).
 *
 * REPLACES: Manual offset calculations via getTimezoneOffset() in sync.ts
 * that were prone to DST transition errors.
 */

const SICA_TIMEZONE = 'America/Chihuahua';

/**
 * Returns today's date as YYYY-MM-DD in the local Chihuahua timezone.
 * Uses Intl.DateTimeFormat with 'en-CA' locale for ISO format.
 */
export const getTodayString = (): string => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SICA_TIMEZONE
    }).format(new Date());
};

/**
 * Converts any Date object to a YYYY-MM-DD string in Chihuahua timezone.
 */
export const toDateString = (date: Date): string => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SICA_TIMEZONE
    }).format(date);
};

/**
 * Checks if a given Date is "today" in the Chihuahua timezone.
 */
export const isToday = (date: Date): boolean => {
    return toDateString(date) === getTodayString();
};

/**
 * Returns a date N days ago as YYYY-MM-DD in Chihuahua timezone.
 */
export const getDaysAgoString = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toDateString(d);
};

/**
 * Returns the local timezone offset string (e.g., "-06:00") for Chihuahua.
 * Uses Intl.DateTimeFormat to avoid manual getTimezoneOffset() calculations
 * that break during DST transitions.
 */
export const getTimezoneOffsetString = (): string => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: SICA_TIMEZONE,
        timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart) {
        // tzPart.value is like "GMT-6" or "GMT-7"
        const match = tzPart.value.match(/GMT([+-]\d+)/);
        if (match) {
            const hours = parseInt(match[1]);
            const sign = hours >= 0 ? '+' : '-';
            return `${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`;
        }
    }
    // Fallback: CST (Chihuahua standard)
    return '-06:00';
};
