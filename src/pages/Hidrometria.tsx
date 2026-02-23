import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Droplets, Trophy, Clock, AlertTriangle, Activity } from 'lucide-react';
import clsx from 'clsx';

const Hidrometria: React.FC = () => {
    // 1. Fetch points from offline DB
    const allPoints = useLiveQuery(() => db.puntos.toArray()) || [];

    // 2. Compute the Widgets logic
    const { totalGastoM3s, seccionData, top5, olvidadas, totalVolumenMm3 } = useMemo(() => {
        const activas = allPoints.filter(p => p.type === 'toma' && ['inicio', 'reabierto', 'continua'].includes(p.estado_hoy || ''));

        // Sum total Gasto
        let totalGastoM3s = 0;
        let totalVolumenMm3 = 0;
        const seccionMap: Record<string, { totalFlow: number, count: number }> = {};

        activas.forEach(p => {
            const flow = p.caudal_promedio || 0;
            totalGastoM3s += flow;
            totalVolumenMm3 += (p.volumen_hoy_mm3 || 0);

            const sec = p.seccion || 'Zona General';
            if (!seccionMap[sec]) seccionMap[sec] = { totalFlow: 0, count: 0 };
            seccionMap[sec].totalFlow += flow;
            seccionMap[sec].count += 1;
        });

        // Widget 1: Seccion Data
        const seccionData = Object.entries(seccionMap).map(([name, data]) => ({
            name,
            totalFlow: data.totalFlow,
            count: data.count,
            percentage: totalGastoM3s > 0 ? (data.totalFlow / totalGastoM3s) * 100 : 0
        })).sort((a, b) => b.totalFlow - a.totalFlow);

        // Widget 2: Top 5 Demand
        const top5 = [...activas].sort((a, b) => (b.caudal_promedio || 0) - (a.caudal_promedio || 0)).slice(0, 5);

        // Widget 3: Tomas Olvidadas (> 12 hours)
        const nowMs = Date.now();
        const olvidadas = activas.filter(p => {
            if (!p.hora_apertura) return false;
            const aperturaDate = new Date(p.hora_apertura).getTime();
            const diffHours = (nowMs - aperturaDate) / (1000 * 60 * 60);
            return diffHours >= 12; // 12 hours threshold
        }).map(p => {
            const diffHours = (nowMs - new Date(p.hora_apertura!).getTime()) / (1000 * 60 * 60);
            return { ...p, hoursOpen: Math.floor(diffHours) };
        }).sort((a, b) => b.hoursOpen - a.hoursOpen);

        return { totalGastoM3s, seccionData, top5, olvidadas, totalVolumenMm3 };
    }, [allPoints]);

    return (
        <div className="flex flex-col h-full bg-mobile-dark">
            <header className="px-4 py-3 bg-mobile-card border-b border-slate-800 shrink-0">
                <h1 className="text-sm font-bold text-white tracking-wide uppercase flex items-center justify-between">
                    <div>
                        <Droplets className="inline -mt-1 mr-2 text-mobile-accent" size={16} />
                        Resumen de Hidrometría
                    </div>
                </h1>
                <p className="text-[10px] text-mobile-accent/80 font-mono mt-0.5">Visión Offline de Tomas Abiertas</p>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* GLOBAL METRICS */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Caudal Global</span>
                        <div className="text-2xl font-bold text-cyan-400">
                            {totalGastoM3s.toFixed(2)} <span className="text-xs text-cyan-400/70 font-normal">m³/s</span>
                        </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Vol. Entregado</span>
                        <div className="text-2xl font-bold text-blue-400">
                            {(totalVolumenMm3 / 1000000).toFixed(3)} <span className="text-xs text-blue-400/70 font-normal">Mm³</span>
                        </div>
                    </div>
                </div>

                {/* WIDGET 1: Distribución por Zona */}
                <div className="bg-mobile-card rounded-xl p-3 border border-slate-700/50 shadow-lg">
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={14} className="text-emerald-400" />
                        Gasto Activo por Zona
                    </h2>
                    <div className="space-y-4">
                        {seccionData.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No hay tomas abiertas registradas.</p>
                        ) : (
                            seccionData.map(sec => (
                                <div key={sec.name}>
                                    <div className="flex justify-between items-end mb-1">
                                        <span className="text-[10px] text-slate-300 font-bold truncation flex-1 pr-2 uppercase">{sec.name}</span>
                                        <div className="text-right flex-shrink-0">
                                            <span className="text-xs font-bold text-emerald-400">{sec.totalFlow.toFixed(3)} m³/s</span>
                                            <span className="text-[9px] text-slate-500 ml-2">({sec.count} tomas)</span>
                                        </div>
                                    </div>
                                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                            style={{ width: `${sec.percentage}%` }}
                                        />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* WIDGET 2: Top 5 Consumo */}
                <div className="bg-mobile-card rounded-xl p-3 border border-slate-700/50 shadow-lg">
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Trophy size={14} className="text-amber-400" />
                        Top 5 Mayor Extracción
                    </h2>
                    <div className="divide-y divide-slate-800">
                        {top5.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-2">Sin tomas activas.</p>
                        ) : (
                            top5.map((p, i) => (
                                <div key={p.id} className="py-2.5 flex items-center justify-between">
                                    <div className="flex flex-col w-[70%]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-black text-slate-500 bg-slate-800 w-4 h-4 rounded-full flex items-center justify-center shrink-0">
                                                {i + 1}
                                            </span>
                                            <span className="text-[11px] text-slate-200 font-semibold truncate leading-tight">
                                                {p.name}
                                            </span>
                                        </div>
                                        <span className="text-[9px] text-slate-400 ml-6 truncate">{p.seccion}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-xs font-bold text-amber-400">
                                            {p.caudal_promedio?.toFixed(3)}
                                            <span className="text-[9px] text-amber-500/70 ml-0.5">m³/s</span>
                                        </span>
                                        <span className="text-[9px] text-blue-400">
                                            {((p.volumen_hoy_mm3 || 0) / 1000).toFixed(1)} m³
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* WIDGET 3: Tomas Olvidadas */}
                <div className={clsx(
                    "rounded-xl p-3 border shadow-lg transition-colors duration-300",
                    olvidadas.length > 0 ? "bg-red-950/20 border-red-500/30" : "bg-mobile-card border-slate-700/50"
                )}>
                    <h2 className={clsx(
                        "text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2",
                        olvidadas.length > 0 ? "text-red-400" : "text-slate-400"
                    )}>
                        <AlertTriangle size={14} className={olvidadas.length > 0 ? "text-red-500" : "text-slate-500"} />
                        Alerta: Tomas Excedidas
                    </h2>

                    {olvidadas.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-4 opacity-50">
                            <Clock size={24} className="text-emerald-500 mb-2" />
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Sin anomalías de tiempo</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {olvidadas.map(p => (
                                <div key={p.id} className="bg-red-900/10 border border-red-500/20 rounded p-2 flex justify-between items-center">
                                    <div className="flex flex-col max-w-[70%]">
                                        <span className="text-[11px] font-bold text-red-300 truncate">{p.name}</span>
                                        <span className="text-[9px] text-red-400/70 truncate">{p.seccion}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] font-black text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                                            <Clock size={10} />
                                            {p.hoursOpen}h Abierta
                                        </span>
                                        <span className="text-[9px] text-slate-400 mt-0.5">{new Date(p.hora_apertura!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Spacer */}
                <div className="h-6"></div>
            </div>
        </div>
    );
};

export default Hidrometria;
