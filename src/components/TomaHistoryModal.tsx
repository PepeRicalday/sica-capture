
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Clock, Droplets, Activity, WifiOff, History, Edit3, CalendarRange } from 'lucide-react';
import type { OfflinePoint, SicaRecord } from '../lib/db';
import clsx from 'clsx';
import { formatCaudalLps } from '../lib/formatters';
import { useAuth } from '../context/AuthContext';

interface TomaHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    punto: OfflinePoint | null;
    onEditRecord?: (record: any) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Caudal en L/s desde m³/s. Dos valores son "iguales" si difieren < 0.5 L/s. */
const sameFlow = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * Comprime eventos consecutivos del mismo estado 'continua' y mismo caudal
 * en un único objeto de "periodo". El resto pasa sin cambios.
 */
function compressEvents(events: any[]): any[] {
    const out: any[] = [];
    let i = 0;
    while (i < events.length) {
        const ev = events[i];
        if (ev.estado_evento === 'continua') {
            let j = i;
            while (
                j + 1 < events.length &&
                events[j + 1].estado_evento === 'continua' &&
                sameFlow(events[j + 1].valor_q, ev.valor_q)
            ) j++;
            if (j > i) {
                out.push({
                    ...ev,
                    _period: true,
                    _start: ev.fecha_hora,
                    _end: events[j].fecha_hora,
                    _days: j - i + 1,
                });
                i = j + 1;
                continue;
            }
        }
        out.push(ev);
        i++;
    }
    return out;
}

/**
 * Calcula el volumen total acumulado (m³) usando Q × Δt sobre eventos ordenados.
 * Si el ciclo sigue abierto usa `now` como fin.
 */
function calcVolumeM3(events: any[]): number {
    if (events.length === 0) return 0;
    const sorted = [...events].sort(
        (a, b) => new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime()
    );
    const lastEv = sorted[sorted.length - 1];
    const isOpen = lastEv.estado_evento !== 'cierre' && lastEv.estado_evento !== 'suspension';
    const endMs = isOpen ? Date.now() : new Date(lastEv.fecha_hora).getTime();

    let vol = 0;
    for (let i = 0; i < sorted.length; i++) {
        const q = Number(sorted[i].valor_q) || 0;
        if (q <= 0) continue;
        const t0 = new Date(sorted[i].fecha_hora).getTime();
        const t1 = i + 1 < sorted.length ? new Date(sorted[i + 1].fecha_hora).getTime() : endMs;
        const dtSec = Math.max(0, (t1 - t0) / 1000);
        vol += q * dtSec; // m³
    }
    return vol;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TomaHistoryModal: React.FC<TomaHistoryModalProps> = ({ isOpen, onClose, punto, onEditRecord }) => {
    const { profile } = useAuth();
    const isGerente = profile?.rol === 'SRL';
    const [loading, setLoading] = useState(false);
    const [historial, setHistorial] = useState<any[]>([]);
    const [totales, setTotales] = useState({ volumenM3: 0, horasContinuas: 0 });
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline  = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online',  handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online',  handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (!isOpen || !punto || !isOnline) return;

        const fetchHistory = async () => {
            setLoading(true);
            try {
                // ── 1. Reportes diarios del ciclo activo (hasta 60 días) ──────
                const { data: reportesDiarios } = await supabase
                    .from('reportes_operacion')
                    .select('id, fecha, estado, caudal_promedio, hora_apertura, volumen_acumulado')
                    .eq('punto_id', punto.id)
                    .order('fecha', { ascending: false })
                    .limit(60);

                // Recorrer de más reciente a más antiguo hasta encontrar cierre/suspension
                const cicloReportes: any[] = [];
                let cycleStartTs: string | null = null;

                for (const rep of (reportesDiarios || [])) {
                    if (rep.estado === 'suspension' && cicloReportes.length === 0) {
                        cicloReportes.push(rep);
                        break;
                    }
                    if (rep.estado === 'cierre') {
                        cicloReportes.push(rep);
                        break;
                    }
                    cicloReportes.push(rep);
                    // El inicio real del ciclo: el primer 'inicio' o 'reabierto' encontrado
                    if (rep.estado === 'inicio' || rep.estado === 'reabierto') {
                        cycleStartTs = rep.hora_apertura || `${rep.fecha}T06:00:00Z`;
                    }
                }

                // ── 2. Mediciones individuales (eventos reales de operador) ───
                const { data: mediciones } = await supabase
                    .from('mediciones')
                    .select('id, fecha_hora, valor_q, estado_evento, usuario_id, notas')
                    .eq('punto_id', punto.id)
                    .order('fecha_hora', { ascending: false })
                    .limit(60);

                // Filtrar solo mediciones del ciclo actual (después del cycleStartTs)
                // y excluir virtuales del cron
                const cycleStartMs = cycleStartTs ? new Date(cycleStartTs).getTime() : 0;
                const medicionesCiclo = (mediciones || []).filter(m => {
                    const isCronNote = m.notas?.includes('Continuidad de medianoche') || m.notas?.includes('automático');
                    if (isCronNote) return false;
                    return new Date(m.fecha_hora).getTime() >= cycleStartMs - 60_000;
                });

                // ── 3. Construir lista unificada ──────────────────────────────
                // Días cubiertos por mediciones reales
                const fechasConMedicion = new Set(
                    medicionesCiclo.map(m =>
                        new Date(m.fecha_hora).toLocaleDateString('en-CA')
                    )
                );

                const allEvents: any[] = [...medicionesCiclo];

                // Agregar entradas sintéticas de reportes para días sin medición real
                for (const rep of cicloReportes) {
                    if (rep.estado === 'cierre') continue; // el cierre ya lo incluye medicion
                    const apertura = rep.hora_apertura
                        ? new Date(rep.hora_apertura)
                        : new Date(`${rep.fecha}T06:00:00Z`);
                    const repDate = apertura.toLocaleDateString('en-CA');
                    if (fechasConMedicion.has(repDate)) continue;

                    allEvents.push({
                        id: `rep-${rep.id}`,
                        fecha_hora: apertura.toISOString(),
                        valor_q: rep.caudal_promedio,
                        estado_evento: rep.estado,
                        virtual: true,
                    });
                }

                // Ordenar ascendente
                allEvents.sort((a, b) =>
                    new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime()
                );

                // ── 4. Cálculo de horas activas (desde el INICIO real) ────────
                // cycleStartTs es la hora_apertura del primer 'inicio'/'reabierto'
                const actualStartTs = cycleStartTs || punto.hora_apertura;
                const hoursOpen = actualStartTs
                    ? (Date.now() - new Date(actualStartTs).getTime()) / 3_600_000
                    : 0;

                // ── 5. Cálculo de volumen por Q×Δt ────────────────────────────
                const volM3 = calcVolumeM3(allEvents);

                setHistorial(allEvents);
                setTotales({ volumenM3: volM3, horasContinuas: hoursOpen });

            } catch (err) {
                console.error('Error fetching toma history:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [isOpen, punto, isOnline]);

    if (!isOpen || !punto) return null;

    // ── Datos de fallback offline ─────────────────────────────────────────────
    const offlineHours = punto.hora_apertura
        ? (Date.now() - new Date(punto.hora_apertura).getTime()) / 3_600_000
        : 0;

    // Volumen aproximado offline: Q × tiempo_desde_apertura
    const offlineVolM3 = punto.caudal_promedio && punto.hora_apertura
        ? Number(punto.caudal_promedio) * Math.max(0, (Date.now() - new Date(punto.hora_apertura).getTime()) / 1000)
        : (punto.volumen_hoy_m3 || 0);

    const displayHours  = isOnline ? totales.horasContinuas  : offlineHours;
    const displayVolM3  = isOnline ? totales.volumenM3        : offlineVolM3;
    // Convertir m³ → dam³ (decametros cúbicos, lo que el sistema llama "mm³")
    const displayVolDam3 = displayVolM3 / 1000;

    // Historial comprimido (solo online)
    const compressedHistorial = compressEvents(historial);

    // ── Offline: primer y último evento sintético desde el punto cacheado ─────
    const offlineEvents = !isOnline && punto.hora_apertura
        ? [
            {
                id: 'offline-inicio',
                fecha_hora: punto.hora_apertura,
                valor_q: punto.caudal_promedio || 0,
                estado_evento: 'inicio',
                virtual: true,
            },
            {
                id: 'offline-last',
                fecha_hora: new Date().toISOString(),
                valor_q: punto.caudal_promedio || 0,
                estado_evento: punto.estado_hoy || 'continua',
                virtual: true,
                _isNow: true,
            },
          ]
        : [];

    const handleEdit = (ev: any) => {
        if (!onEditRecord || ev.virtual) return;
        const date = new Date(ev.fecha_hora);
        const record: Partial<SicaRecord> = {
            id: ev.id,
            tipo: 'toma',
            punto_id: punto.id,
            fecha_captura: date.toISOString().split('T')[0],
            hora_captura: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            valor_q: ev.valor_q,
            estado_operativo: ev.estado_evento,
            sincronizado: 'true',
        };
        onEditRecord(record);
        onClose();
    };

    // ── Colores por estado ────────────────────────────────────────────────────
    const stateColors = (state: string) => {
        if (state === 'inicio' || state === 'reabierto')  return { dot: 'bg-emerald-500', text: 'text-emerald-400' };
        if (state === 'continua' || state === 'modificacion') return { dot: 'bg-cyan-500',   text: 'text-cyan-400' };
        if (state === 'suspension')                        return { dot: 'bg-orange-500',  text: 'text-orange-400' };
        if (state === 'cierre')                            return { dot: 'bg-red-500',     text: 'text-red-400' };
        return { dot: 'bg-slate-500', text: 'text-slate-300' };
    };

    const renderEvent = (ev: any, i: number, arr: any[]) => {
        const isFirst = i === arr.length - 1;
        const { dot, text } = stateColors(ev.estado_evento);
        const date = new Date(ev.fecha_hora);

        // ── Periodo comprimido ────────────────────────────────────────────────
        if (ev._period) {
            const startDate = new Date(ev._start);
            const endDate   = new Date(ev._end);
            const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
            return (
                <div key={ev.id} className="relative pl-10">
                    <div className="absolute left-2.5 top-1.5 w-2.5 h-2.5 rounded-full bg-cyan-800 ring-4 ring-mobile-dark z-10"></div>
                    <div className="glass-panel rounded-lg p-2.5 border border-cyan-900/40 shadow-md">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold uppercase tracking-wide text-cyan-600 flex items-center gap-1">
                                <CalendarRange size={11} />
                                CONTINUA · {ev._days} días
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                                {fmt(startDate)} → {fmt(endDate)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Activity size={12} className="text-slate-500" />
                            <span className="text-sm font-bold text-white">{formatCaudalLps(Number(ev.valor_q))}</span>
                            <span className="text-[10px] text-slate-500 italic">sin modificaciones</span>
                        </div>
                    </div>
                </div>
            );
        }

        // ── Evento individual ─────────────────────────────────────────────────
        return (
            <div key={ev.id ?? i} className="relative pl-10">
                <div className={clsx(
                    "absolute left-2.5 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-mobile-dark z-10",
                    dot,
                    isFirst && "animate-pulse ring-cyan-900/50"
                )}></div>
                <div className="glass-panel rounded-lg p-2.5 border-t border-b-0 border-r-0 border-l border-white/5 shadow-md">
                    <div className="flex justify-between items-start mb-1">
                        <span className={clsx("text-xs font-bold uppercase tracking-wide drop-shadow-sm", text)}>
                            {ev.estado_evento}{ev._isNow ? ' (ahora)' : ''}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                            {date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}{' '}
                            {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity size={12} className="text-slate-500" />
                            <span className="text-sm font-bold text-white">{formatCaudalLps(Number(ev.valor_q))}</span>
                        </div>
                        {isGerente && !ev.virtual && (
                            <button
                                type="button"
                                onClick={() => handleEdit(ev)}
                                aria-label="Corregir registro"
                                className="text-mobile-accent p-1 hover:bg-mobile-accent/10 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold uppercase"
                            >
                                <Edit3 size={14} /> Corregir
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:justify-center sm:p-4">
            <div className="bg-mobile-dark w-full max-h-[70dvh] sm:max-w-md mx-auto sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col animate-in slide-in-from-bottom-full duration-300">

                <div className="relative px-5 py-4 border-b border-slate-700/50 glass-panel sm:rounded-t-2xl rounded-t-2xl flex flex-col gap-1 z-10 shadow-lg">
                    <button type="button" onClick={onClose} aria-label="Cerrar historial" className="absolute top-4 right-4 p-2 bg-slate-800 text-slate-400 hover:text-white rounded-full">
                        <X size={18} />
                    </button>
                    <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest flex items-center gap-1.5">
                        <History size={12} />
                        Historial Multi-día
                    </span>
                    <h2 className="text-xl font-bold text-white pr-10 leading-tight">{punto.name}</h2>
                    <span className="text-xs text-slate-400">Mod: {punto.modulo} | {punto.seccion}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pb-10 custom-scrollbar">

                    {/* ── KPIs ───────────────────────────────────────────── */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="glass-panel rounded-xl p-3 flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Clock size={12} className="text-amber-400" /> Hrs. Activas
                            </span>
                            <div className="text-2xl font-bold text-white">
                                {displayHours > 0 ? displayHours.toFixed(0) : '—'}
                                <span className="text-xs text-slate-500 font-normal"> h</span>
                            </div>
                            {!isOnline && (
                                <span className="text-[9px] text-slate-600 mt-0.5">desde apertura (aprox.)</span>
                            )}
                        </div>
                        <div className="glass-panel rounded-xl p-3 flex flex-col">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Droplets size={12} className="text-blue-400" /> Vol. Acumulado
                            </span>
                            <div className="text-2xl font-bold text-blue-400">
                                {displayVolDam3 > 0
                                    ? displayVolDam3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : '—'}
                                <span className="text-xs text-blue-400/70 font-normal"> dam³</span>
                            </div>
                            {!isOnline && (
                                <span className="text-[9px] text-slate-600 mt-0.5">estimado (sin conexión)</span>
                            )}
                        </div>
                    </div>

                    {/* ── Sin conexión: primer + último evento ───────────── */}
                    {!isOnline ? (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 mb-3">
                                <WifiOff size={13} className="text-slate-600" />
                                <span className="text-[10px] text-slate-500 uppercase tracking-widest">
                                    Sin conexión · Mostrando primer y último evento
                                </span>
                            </div>
                            <div className="relative">
                                <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-800 rounded-full"></div>
                                <div className="space-y-4">
                                    {offlineEvents.map((ev, i) => renderEvent(ev, i, offlineEvents))}
                                </div>
                            </div>
                        </div>

                    /* ── Cargando ─────────────────────────────────────────── */
                    ) : loading ? (
                        <div className="flex justify-center py-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
                        </div>

                    /* ── Historial online ─────────────────────────────────── */
                    ) : (
                        <div className="relative">
                            <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-800 rounded-full"></div>
                            {compressedHistorial.length === 0 ? (
                                <p className="text-xs text-slate-500 italic pl-10">No se encontraron eventos recientes.</p>
                            ) : (
                                <div className="space-y-4">
                                    {compressedHistorial.map((ev, i, arr) => renderEvent(ev, i, arr))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
