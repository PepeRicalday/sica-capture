
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Clock, Droplets, Activity, WifiOff, History, Edit3 } from 'lucide-react';
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

export const TomaHistoryModal: React.FC<TomaHistoryModalProps> = ({ isOpen, onClose, punto, onEditRecord }) => {
    const { profile } = useAuth();
    const isGerente = profile?.rol === 'SRL';
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
                // 1. Fetch individual events (mediciones) for this point
                const { data: eventos, error: errorEventos } = await supabase
                    .from('mediciones')
                    .select('id, fecha_hora, valor_q, estado_evento, usuario_id')
                    .eq('punto_id', punto.id)
                    .order('fecha_hora', { ascending: false })
                    .limit(30);

                if (errorEventos) throw errorEventos;

                // Break at the first real (non-automatic) 'cierre' going backwards
                const currentCycleEvents = [];
                for (const ev of (eventos || [])) {
                    currentCycleEvents.push(ev);
                    if (ev.estado_evento === 'cierre' || ev.estado_evento === 'suspension') {
                        if (ev.estado_evento === 'cierre') break;
                    }
                }

                // 2. Fetch daily reports to fill gaps where mediciones are missing
                const { data: reportesDiarios, error: errorReportes2 } = await supabase
                    .from('reportes_operacion')
                    .select('id, fecha, estado, caudal_promedio, hora_apertura')
                    .eq('punto_id', punto.id)
                    .order('fecha', { ascending: false })
                    .limit(20);

                if (!errorReportes2 && reportesDiarios && reportesDiarios.length > 0) {
                    // Build a set of dates already covered by mediciones events
                    const fechasConMedicion = new Set(
                        currentCycleEvents.map(ev =>
                            new Date(ev.fecha_hora).toLocaleDateString('en-CA') // YYYY-MM-DD
                        )
                    );

                    // Determine start of current cycle (earliest medicion or first apertura)
                    const cicloInicio = currentCycleEvents.length > 0
                        ? new Date(currentCycleEvents[currentCycleEvents.length - 1].fecha_hora)
                        : null;

                    for (const rep of reportesDiarios) {
                        // Skip days beyond start of current medicion cycle
                        if (cicloInicio && new Date(rep.hora_apertura || rep.fecha) < cicloInicio) break;
                        // Skip closed/suspended reports (they end the cycle)
                        if (rep.estado === 'cierre' || rep.estado === 'suspension') break;
                        // Skip days that already have a medicion event
                        if (fechasConMedicion.has(rep.fecha)) continue;

                        // Add a synthetic daily entry for this gap day
                        const apertura = rep.hora_apertura
                            ? new Date(rep.hora_apertura)
                            : new Date(`${rep.fecha}T06:00:00Z`);

                        currentCycleEvents.push({
                            id: `daily-${rep.id}`,
                            fecha_hora: apertura.toISOString(),
                            valor_q: rep.caudal_promedio,
                            estado_evento: rep.estado,
                            virtual: true,
                            fromReporte: true
                        });
                    }
                }

                // Sort all events ascending by timestamp
                currentCycleEvents.sort((a: any, b: any) =>
                    new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime()
                );

                const processedHistory = currentCycleEvents;

                // Síntesis de continuidad (Si el último evento fue ayer y sigue abierto)
                if (processedHistory.length > 0) {
                    const lastEv = processedHistory[processedHistory.length - 1];
                    const lastDate = new Date(lastEv.fecha_hora).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const todayDate = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

                    if (lastDate !== todayDate && lastEv.estado_evento !== 'cierre' && lastEv.estado_evento !== 'suspension') {
                        const todayMidnight = new Date();
                        todayMidnight.setHours(0, 0, 0, 0);

                        (processedHistory as any[]).push({
                            id: `virtual-cont-${Date.now()}`,
                            fecha_hora: todayMidnight.toISOString(),
                            valor_q: lastEv.valor_q,
                            estado_evento: 'continua',
                            virtual: true
                        });
                    }
                }

                setHistorial(processedHistory);

                // 2. Fetch daily aggregate
                const { data: reportes, error: errorReportes } = await supabase
                    .from('reportes_operacion')
                    .select('fecha, volumen_acumulado, estado')
                    .eq('punto_id', punto.id)
                    .order('fecha', { ascending: false })
                    .limit(10);

                if (errorReportes) throw errorReportes;

                let sumVolMm3 = 0;
                let daysCount = 0;
                for (const rep of (reportes || [])) {
                    if (rep.estado === 'cierre' && daysCount > 0) break;
                    sumVolMm3 += Number(rep.volumen_acumulado || 0) * 1000000;
                    daysCount++;
                }

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

    const volAcumuladoM3 = totales.volumenAcumuladoMm3 || punto.volumen_hoy_m3 || 0;

    const handleEdit = (ev: any) => {
        if (!onEditRecord) return;

        // Convert Supabase event to SicaRecord format for Capture.tsx
        const date = new Date(ev.fecha_hora);
        const record: Partial<SicaRecord> = {
            id: ev.id,
            tipo: 'toma',
            punto_id: punto.id,
            fecha_captura: date.toISOString().split('T')[0],
            hora_captura: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            valor_q: ev.valor_q,
            estado_operativo: ev.estado_evento,
            sincronizado: 'true' // It was already in Supabase
        };

        onEditRecord(record);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:justify-center sm:p-4">
            <div className="bg-mobile-dark w-full max-h-[70dvh] sm:max-w-md mx-auto sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col animate-in slide-in-from-bottom-full duration-300">

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

                <div className="flex-1 overflow-y-auto p-5 pb-10 custom-scrollbar">

                    <div className="grid grid-cols-2 gap-3 mb-6 relative">
                        <div className="glass-panel overflow-hidden relative rounded-xl p-3 flex flex-col group">
                            <div className="absolute inset-0 bg-blue-500/10 blur-xl opacity-0 transition-opacity"></div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1 relative z-10"><Clock size={12} className="text-amber-400" /> Hrs. Activas</span>
                            <div className="text-2xl font-bold text-white relative z-10">
                                {Math.max(totales.horasContinuas, (Date.now() - new Date(punto.hora_apertura || Date.now()).getTime()) / 3600000).toFixed(0)} <span className="text-xs text-slate-500 font-normal">h</span>
                            </div>
                        </div>
                        <div className="glass-panel overflow-hidden relative rounded-xl p-3 flex flex-col group">
                            <div className="absolute inset-0 bg-cyan-500/10 blur-xl opacity-0 transition-opacity"></div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1 relative z-10"><Droplets size={12} className="text-blue-400" /> Vol. Acumulado</span>
                            <div className="text-2xl font-bold text-blue-400 relative z-10">
                                {punto.type === 'aforo'
                                    ? volAcumuladoM3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
                                    : (volAcumuladoM3 / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
                                } <span className="text-xs text-blue-400/70 font-normal">{punto.type === 'aforo' ? 'm³' : 'mm³'}</span>
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
                                        const isFirst = i === historial.length - 1;

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

                                                <div className="glass-panel rounded-lg p-2.5 border-t border-b-0 border-r-0 border-l border-white/5 shadow-md group">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className={clsx("text-xs font-bold uppercase tracking-wide drop-shadow-sm", textStatus)}>
                                                            {ev.estado_evento}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-mono">
                                                            {date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <Activity size={12} className="text-slate-500" />
                                                            <span className="text-sm font-bold text-white">{formatCaudalLps(Number(ev.valor_q))}</span>
                                                        </div>
                                                        {isGerente && (
                                                            <button
                                                                onClick={() => handleEdit(ev)}
                                                                className="text-mobile-accent p-1 hover:bg-mobile-accent/10 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold uppercase"
                                                            >
                                                                <Edit3 size={14} /> Corregir
                                                            </button>
                                                        )}
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
