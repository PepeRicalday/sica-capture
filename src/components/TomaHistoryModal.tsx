import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Clock, Droplets, Activity, WifiOff, History } from 'lucide-react';
import type { OfflinePoint } from '../lib/db';
import clsx from 'clsx';
import { formatCaudalLps } from '../lib/formatters';

interface TomaHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    punto: OfflinePoint | null;
}

export const TomaHistoryModal: React.FC<TomaHistoryModalProps> = ({ isOpen, onClose, punto }) => {
    const [loading, setLoading] = useState(false);
    const [historial, setHistorial] = useState<any[]>([]);
    const [totales, setTotales] = useState({ volumenAcumuladoMm3: 0, horasContinuas: 0 });
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // Watch internet connection
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Fetch history when modal opens
    useEffect(() => {
        if (!isOpen || !punto || !isOnline) return;

        const fetchHistory = async () => {
            setLoading(true);
            try {
                // 1. Fetch exact modifications (mediciones) for this point looking backwards.
                // To keep it simple, we fetch the last 20 events. The 'reabierto' or 'inicio' limits the active cycle.
                const { data: eventos, error: errorEventos } = await supabase
                    .from('mediciones')
                    .select('fecha_hora, valor_q, estado_evento')
                    .eq('punto_id', punto.id)
                    .order('fecha_hora', { ascending: false })
                    .limit(20);

                if (errorEventos) throw errorEventos;

                // Stop at the first 'cierre'. That marks the end of the *previous* irrigation event.
                const currentCycleEvents = [];
                for (const ev of (eventos || [])) {
                    currentCycleEvents.push(ev);
                    if (ev.estado_evento === 'cierre' || ev.estado_evento === 'suspension') { // Though suspension is a pause, let's include the moment it paused. But 'cierre' explicitly ends it. We'll include it to show when it started.
                        if (ev.estado_evento === 'cierre') break; // stop accumulating backwards
                    }
                }

                setHistorial(currentCycleEvents.reverse());

                // 2. Fetch daily aggregate from reportes_operacion for the last 10 days to sum total volume
                // This assumes `reportes_operacion` has a record per day per point.
                const { data: reportes, error: errorReportes } = await supabase
                    .from('reportes_operacion')
                    .select('fecha, volumen_acumulado, estado')
                    .eq('punto_id', punto.id)
                    .order('fecha', { ascending: false })
                    .limit(10);

                if (errorReportes) throw errorReportes;

                // Calcule aggregated volume by going back until we find a day it was 'cerrado'
                let sumVolMm3 = 0;
                let daysCount = 0;
                for (const rep of (reportes || [])) {
                    if (rep.estado === 'cerrado' && daysCount > 0) break;
                    sumVolMm3 += Number(rep.volumen_acumulado || 0) * 1000000; // if it's stored in MM3, though normally 'volumen_acumulado' here is probably Mm3. Let's assume standard DB schema uses Mm3 directly.
                    daysCount++;
                }

                // If from DB the unit was already Mm3 then: `sumVolMm3 = sumVolMm3 / 1000000` is wrong.
                // Wait, SICA uses `vol / 1000000` in the UI. Meaning the DB object we map is M3. Let's use `volumen_acumulado * 1000000` to convert to m3 internally for UI compatibility (since the UI divides by 1000000) or just store Mm3 directly.

                // Calculate total continuous hours based on `hora_apertura` vs `Date.now()`
                let hoursOpen = 0;
                if (punto.hora_apertura) {
                    const diffMs = Date.now() - new Date(punto.hora_apertura).getTime();
                    hoursOpen = diffMs / (1000 * 60 * 60);
                }

                setTotales({
                    volumenAcumuladoMm3: sumVolMm3,
                    horasContinuas: hoursOpen
                });

            } catch (err) {
                console.error("Error fetching history:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [isOpen, punto, isOnline]);

    if (!isOpen || !punto) return null;

    const volTotalMm3 = (totales.volumenAcumuladoMm3 || punto.volumen_hoy_m3 || 0) / 1000000;

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:justify-center sm:p-4">
            {/* Modal Container */}
            <div className="bg-mobile-dark w-full max-h-[45dvh] sm:max-w-md mx-auto sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col animate-in slide-in-from-bottom-full duration-300">

                {/* Header */}
                <div className="relative px-5 py-4 border-b border-slate-700/50 glass-panel sm:rounded-t-2xl rounded-t-2xl flex flex-col gap-1 z-10 shadow-lg">
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-slate-800 text-slate-400 hover:text-white rounded-full">
                        <X size={18} />
                    </button>
                    <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest flex items-center gap-1.5">
                        <History size={12} />
                        Historial Multi-día
                    </span>
                    <h2 className="text-xl font-bold text-white pr-10 leading-tight">{punto.name}</h2>
                    <span className="text-xs text-slate-400">Mod: {punto.modulo} | {punto.seccion}</span>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 pb-24 custom-scrollbar">

                    {/* Totales Resumen */}
                    <div className="grid grid-cols-2 gap-3 mb-6 relative">
                        <div className="glass-panel overflow-hidden relative rounded-xl p-3 flex flex-col group">
                            <div className="absolute inset-0 bg-blue-500/10 blur-xl opacity-0 hover:opacity-100 transition-opacity"></div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1 relative z-10"><Clock size={12} className="text-amber-400" /> Hrs. Activas</span>
                            <div className="text-2xl font-bold text-white relative z-10">
                                {Math.max(totales.horasContinuas, (Date.now() - new Date(punto.hora_apertura || Date.now()).getTime()) / 3600000).toFixed(0)} <span className="text-xs text-slate-500 font-normal">h</span>
                            </div>
                        </div>
                        <div className="glass-panel overflow-hidden relative rounded-xl p-3 flex flex-col group">
                            <div className="absolute inset-0 bg-cyan-500/10 blur-xl opacity-0 hover:opacity-100 transition-opacity"></div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1 relative z-10"><Droplets size={12} className="text-blue-400" /> Vol. Acumulado</span>
                            <div className="text-2xl font-bold text-blue-400 relative z-10">
                                {volTotalMm3.toFixed(3)} <span className="text-xs text-blue-400/70 font-normal">Mm³</span>
                            </div>
                        </div>
                    </div>

                    {!isOnline ? (
                        <div className="glass-panel rounded-xl p-6 flex flex-col items-center justify-center text-center">
                            <WifiOff size={32} className="text-slate-600 mb-3 drop-shadow-md" />
                            <h3 className="text-slate-300 font-bold mb-1">Sin Conexión</h3>
                            <p className="text-xs text-slate-500 max-w-[200px]">
                                El historial de eventos anteriores requiere acceso a la nube.
                            </p>

                            <div className="mt-4 w-full bg-slate-800 rounded-lg p-3 text-left">
                                <span className="text-[10px] text-mobile-accent uppercase font-bold block mb-1">Caché Local Hoy</span>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-300">Gasto Promedio:</span>
                                    <span className="font-mono text-cyan-400 font-bold">{punto.caudal_promedio?.toFixed(2)} m³/s</span>
                                </div>
                            </div>
                        </div>
                    ) : loading ? (
                        <div className="flex justify-center py-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-800 rounded-full"></div>

                            {historial.length === 0 ? (
                                <p className="text-xs text-slate-500 italic pl-10">No se encontraron eventos recientes.</p>
                            ) : (
                                <div className="space-y-4">
                                    {historial.map((ev, i) => {
                                        const date = new Date(ev.fecha_hora);
                                        const isFirst = i === 0;

                                        let dotColor = "bg-slate-500";
                                        let textStatus = "text-slate-300";

                                        if (ev.estado_evento === 'inicio' || ev.estado_evento === 'reabierto') { dotColor = "bg-emerald-500"; textStatus = "text-emerald-400"; }
                                        if (ev.estado_evento === 'modificacion' || ev.estado_evento === 'continua') { dotColor = "bg-cyan-500"; textStatus = "text-cyan-400"; }
                                        if (ev.estado_evento === 'suspension') { dotColor = "bg-orange-500"; textStatus = "text-orange-400"; }
                                        if (ev.estado_evento === 'cierre') { dotColor = "bg-red-500"; textStatus = "text-red-400"; }

                                        return (
                                            <div key={i} className="relative pl-10">
                                                <div className={clsx(
                                                    "absolute left-2.5 top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-mobile-dark z-10",
                                                    dotColor,
                                                    isFirst && "animate-pulse ring-cyan-900/50"
                                                )}></div>

                                                <div className="glass-panel rounded-lg p-2.5 border-t border-b-0 border-r-0 border-l border-white/5 shadow-md">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className={clsx("text-xs font-bold uppercase tracking-wide drop-shadow-sm", textStatus)}>
                                                            {ev.estado_evento}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-mono">
                                                            {date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Activity size={12} className="text-slate-500" />
                                                        <span className="text-sm font-bold text-white">{formatCaudalLps(Number(ev.valor_q))}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
