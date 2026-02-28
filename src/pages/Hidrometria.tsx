import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Activity, Trophy, Clock, AlertTriangle, TrendingUp, AlertCircle, WifiOff } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import clsx from 'clsx';
import { TomaHistoryModal } from '../components/TomaHistoryModal';
import { formatCaudalLps } from '../lib/formatters';
import { useAuth } from '../context/AuthContext';

const Hidrometria: React.FC = () => {
    const { user } = useAuth();
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [selectedToma, setSelectedToma] = useState<any | null>(null);
    const [selectedZonaFiltro, setSelectedZonaFiltro] = useState<string>('Todas');
    const isAdmin = user?.email === 'gerente@srlconchos.com' || user?.email === 'aforador@srlconchos.com';

    React.useEffect(() => {
        const handle = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', handle);
        window.addEventListener('offline', handle);
        return () => {
            window.removeEventListener('online', handle);
            window.removeEventListener('offline', handle);
        };
    }, []);

    // 1. Fetch points from offline DB
    const allPoints = useLiveQuery(() => db.puntos.toArray()) || [];

    // 2. Compute the Widgets logic
    const { totalGastoM3s, seccionData, top5, olvidadas, totalVolumenMm3, tomasPorZona, escalasGraphData, escalasAlertas } = useMemo(() => {
        const activas = allPoints.filter(p => ['toma', 'lateral'].includes(p.type || '') && ['inicio', 'reabierto', 'continua', 'modificacion'].includes(p.estado_hoy || ''));

        // Sum total Gasto
        let totalGastoM3s = 0;
        let totalVolumenMm3 = 0;
        const seccionMap: Record<string, { totalFlow: number, count: number }> = {};

        activas.forEach(p => {
            const flow = p.caudal_promedio || 0;
            totalGastoM3s += flow;
            totalVolumenMm3 += (p.volumen_hoy_m3 || 0);

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

        // Group tomas by Zona for new Widget
        const tomasPorZona: Record<string, typeof activas> = {};
        activas.forEach(p => {
            const sec = p.seccion || 'Zona General';
            if (!tomasPorZona[sec]) tomasPorZona[sec] = [];
            tomasPorZona[sec].push(p);
        });

        // WIDGET ESCALAS: Profile Data
        const escalasPoints = allPoints
            .filter(p => p.type === 'escala' && p.km !== undefined)
            .sort((a, b) => (a.km || 0) - (b.km || 0));

        const escalasGraphData = escalasPoints.map(p => ({
            nombre: p.name,
            km: p.km,
            nivel_actual: p.nivel_actual, // can be undefined
            min: p.nivel_min_operativo,
            max: p.nivel_max_operativo,
            delta: p.delta_12h,
            estado: p.escala_estado
        }));

        const escalasAlertas = escalasPoints.filter(p => p.escala_estado === 'alto' || p.escala_estado === 'bajo');

        return { totalGastoM3s, seccionData, top5, olvidadas, totalVolumenMm3, tomasPorZona, escalasGraphData, escalasAlertas };
    }, [allPoints]);

    // Custom Tooltip for Escalas Graph
    const EscalasTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-slate-900 border border-slate-700 p-2 rounded-lg shadow-xl text-xs">
                    <p className="text-white font-bold mb-1 border-b border-slate-700 pb-1">{data.nombre}</p>
                    <p className="text-slate-400">Km: <span className="text-white font-mono">{data.km}</span></p>
                    {data.nivel_actual !== undefined ? (
                        <>
                            <p className="text-cyan-400 font-bold mt-1">Nivel: {data.nivel_actual.toFixed(2)}m</p>
                            <p className="text-slate-500">Min: {data.min?.toFixed(2)}m | Max: {data.max?.toFixed(2)}m</p>
                            {data.delta !== 0 && data.delta !== undefined && (
                                <p className={clsx("mt-1 flex items-center gap-1 font-bold", data.delta > 0 ? "text-emerald-400" : "text-amber-400")}>
                                    <TrendingUp size={12} className={data.delta < 0 ? "rotate-180" : ""} />
                                    {Math.abs(data.delta).toFixed(2)}m (12h)
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="text-amber-500/70 italic mt-1">Sin lectura reciente</p>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-mobile-dark">
            <header className="px-4 py-4 bg-slate-900 border-b border-mobile-accent/30 shrink-0 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-mobile-accent/5 blur-3xl rounded-full -mr-16 -mt-16"></div>
                <h1 className="text-base font-black text-white tracking-widest uppercase flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2">
                        <Activity className="text-mobile-accent animate-pulse" size={20} />
                        Centro de Control Hidrométrico
                    </div>
                    {isOnline ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-[8px] text-emerald-400 font-black">ONLINE</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                            <WifiOff size={10} className="text-slate-400" />
                            <span className="text-[8px] text-slate-400 font-black">OFFLINE</span>
                        </div>
                    )}
                </h1>
                <div className="flex justify-between items-center mt-1 relative z-10 font-mono">
                    <p className="text-[10px] text-slate-400">Hidro-Sincronía Digital SRL </p>
                    <p className="text-[9px] text-mobile-accent font-bold">V.1.2.1-PRO</p>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar pb-20">
                {/* EXEC METRICS: Glassmorphism Style */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="glass-panel rounded-2xl p-4 flex flex-col items-start justify-center relative overflow-hidden group border-mobile-accent/20">
                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-cyan-500/10 blur-2xl rounded-full"></div>
                        <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">Gasto en Red Mayor</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-black text-white tracking-tighter">{totalGastoM3s.toFixed(2)}</span>
                            <span className="text-[10px] text-cyan-400 font-mono font-bold">m³/s</span>
                        </div>
                        <div className="mt-2 h-1 w-12 bg-cyan-500/30 rounded-full"></div>
                    </div>

                    <div className="glass-panel rounded-2xl p-4 flex flex-col items-start justify-center relative overflow-hidden group border-blue-500/20">
                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 blur-2xl rounded-full"></div>
                        <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">Volumen Entregado</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-black text-white tracking-tighter">{(totalVolumenMm3 / 1000000).toFixed(3)}</span>
                            <span className="text-[10px] text-blue-400 font-mono font-bold">Mm³</span>
                        </div>
                        <div className="mt-2 h-1 w-12 bg-blue-500/30 rounded-full"></div>
                    </div>
                </div>

                {/* WIDGET ESCALAS: Perfil Hidráulico */}
                <div className="glass-panel rounded-xl overflow-hidden relative">
                    <div className="p-3 border-b border-slate-700/50 bg-slate-900/30">
                        <h2 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                            <TrendingUp size={14} className="text-cyan-500" />
                            Perfil Hidráulico Red Mayor
                        </h2>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">Comportamiento del Canal Principal Conchos</p>
                    </div>

                    <div className="p-2 pt-4 bg-[#0b1120]/50" style={{ height: 220, width: '100%' }}>
                        {escalasGraphData.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
                                Sincroniza para descargar las escalas
                            </div>
                        ) : (
                            <ResponsiveContainer>
                                <ComposedChart data={escalasGraphData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis
                                        dataKey="km"
                                        type="number"
                                        domain={['dataMin', 'dataMax']}
                                        tick={{ fill: '#64748b', fontSize: 9 }}
                                        tickFormatter={(val: number) => `K-${val}`}
                                    />
                                    <YAxis
                                        tick={{ fill: '#64748b', fontSize: 9 }}
                                        domain={['auto', 'auto']}
                                        tickFormatter={(val: number) => val.toFixed(1)}
                                    />
                                    <Tooltip content={<EscalasTooltip />} />

                                    <Line
                                        type="monotone"
                                        dataKey="max"
                                        stroke="#ef4444"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        name="Máximo Operativo"
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="min"
                                        stroke="#f59e0b"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        name="Mínimo Operativo"
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="nivel_actual"
                                        stroke="#06b6d4"
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: '#06b6d4', strokeWidth: 0 }}
                                        activeDot={{ r: 6, fill: '#fff', stroke: '#06b6d4', strokeWidth: 2 }}
                                        name="Nivel M"
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* Alertas Operativas de Escalas */}
                    {escalasAlertas.length > 0 && (
                        <div className="bg-red-950/30 p-3 border-t border-red-900/40">
                            <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                <AlertCircle size={12} className="text-red-500" />
                                Alertas Operativas
                            </h3>
                            <div className="space-y-1.5">
                                {escalasAlertas.map(e => (
                                    <div key={e.id} className="flex justify-between items-center text-xs bg-red-900/20 px-2 py-1.5 rounded">
                                        <span className="text-red-200 font-medium truncate pr-2 flex-1">{e.name}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={clsx("text-[9px] uppercase px-1.5 py-0.5 rounded font-bold", e.escala_estado === 'alto' ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400")}>
                                                {e.escala_estado}
                                            </span>
                                            <span className="font-mono font-bold text-white">{e.nivel_actual?.toFixed(2)}m</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* WIDGET 1: Distribución por Zona */}
                <div className="glass-panel rounded-xl p-3 relative">
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
                                        <span className="text-[10px] text-slate-300 font-bold truncate flex-1 pr-2 uppercase">{sec.name}</span>
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

                {/* NUEVO WIDGET: Tomas Abiertas en la Red (Por Zona) */}
                <div className="glass-panel rounded-xl p-3 relative">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                            </span>
                            Tomas Abiertas en la Red
                        </h2>
                        {isAdmin && Object.keys(tomasPorZona).length > 0 && (
                            <select
                                className="bg-slate-800 text-white text-[10px] sm:text-xs rounded border border-slate-600 px-2 py-1 outline-none"
                                value={selectedZonaFiltro}
                                onChange={(e) => setSelectedZonaFiltro(e.target.value)}
                            >
                                <option value="Todas">Todas las Zonas</option>
                                {Object.keys(tomasPorZona).sort().map(z => (
                                    <option key={z} value={z}>{z}</option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div className="space-y-4">
                        {Object.keys(tomasPorZona).length === 0 ? (
                            <p className="text-[10px] text-slate-500 italic">Ninguna toma registrada como abierta hoy.</p>
                        ) : (
                            Object.entries(tomasPorZona)
                                .filter(([zona]) => selectedZonaFiltro === 'Todas' || zona === selectedZonaFiltro)
                                .map(([zona, tomas]) => (
                                    <div key={zona} className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">
                                        <h3 className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-2 border-b border-cyan-900/50 pb-1">
                                            {zona} <span className="text-slate-500 ml-1 font-normal">({tomas.length})</span>
                                        </h3>
                                        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar min-h-[44px]">
                                            {tomas.map(p => (
                                                <div
                                                    key={p.id}
                                                    onClick={() => setSelectedToma(p)}
                                                    className="flex-shrink-0 bg-slate-900 border border-slate-700 rounded p-1.5 min-w-[120px] max-w-[150px] cursor-pointer hover:bg-slate-800 transition-colors"
                                                >
                                                    <div className="text-[10px] text-white font-bold truncate flex justify-between items-center">
                                                        <span className="truncate pr-1">{p.name}</span>
                                                    </div>
                                                    <div className="mt-1 flex justify-between items-center">
                                                        <span className="text-[9px] text-cyan-400 bg-cyan-900/30 px-1 rounded">
                                                            {formatCaudalLps(p.caudal_promedio)}
                                                        </span>
                                                        <span className="text-[8px] text-slate-500">
                                                            Mod: {p.modulo}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                        )}
                    </div>
                </div>

                {/* WIDGET 2: Top 5 Consumo */}
                <div className="glass-panel rounded-xl p-3 relative">
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Trophy size={14} className="text-amber-400" />
                        Top 5 Mayor Volumen Entregado
                    </h2>
                    <div className="divide-y divide-slate-800">
                        {top5.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-2">Sin tomas activas.</p>
                        ) : (
                            top5.map((p, i) => (
                                <div
                                    key={p.id}
                                    onClick={() => setSelectedToma(p)}
                                    className="py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 px-2 -mx-2 rounded transition-colors"
                                >
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
                                            {formatCaudalLps(p.caudal_promedio)}
                                        </span>
                                        <span className="text-[9px] text-blue-400">
                                            {(p.volumen_hoy_m3 || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} m³
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* WIDGET 3: Tomas Olvidadas */}
                <div className={clsx(
                    "rounded-xl p-3 border shadow-lg transition-colors duration-300 relative",
                    olvidadas.length > 0 ? "glass-panel border-red-500/50 bg-red-950/20" : "glass-panel"
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

            <TomaHistoryModal
                isOpen={!!selectedToma}
                onClose={() => setSelectedToma(null)}
                punto={selectedToma}
            />
        </div>
    );
};

export default Hidrometria;
