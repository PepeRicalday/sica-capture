import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Droplet, Activity, WifiOff, Scale, Calculator } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MapBounds = ({ bounds }: { bounds: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds.length > 0) {
            map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 14 });
        }
    }, [bounds, map]);
    return null;
};

// Fix para los iconos de leaflet en react (bug clásico)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const getModuloTheme = (modulo: string) => {
    const mod = (modulo || '').toLowerCase();
    if (mod.includes('12')) return { leafletColor: 'gold', twBg: 'bg-yellow-500/10', twBorder: 'border-yellow-500/40', twText: 'text-yellow-400' };
    if (mod.includes('1') && !mod.includes('12')) return { leafletColor: 'blue', twBg: 'bg-blue-500/10', twBorder: 'border-blue-500/40', twText: 'text-blue-400' };
    if (mod.includes('2')) return { leafletColor: 'green', twBg: 'bg-emerald-500/10', twBorder: 'border-emerald-500/40', twText: 'text-emerald-400' };
    if (mod.includes('3')) return { leafletColor: 'orange', twBg: 'bg-orange-500/10', twBorder: 'border-orange-500/40', twText: 'text-orange-400' };
    if (mod.includes('4')) return { leafletColor: 'red', twBg: 'bg-red-500/10', twBorder: 'border-red-500/40', twText: 'text-red-400' };
    if (mod.includes('5')) return { leafletColor: 'violet', twBg: 'bg-violet-500/10', twBorder: 'border-violet-500/40', twText: 'text-violet-400' };
    return { leafletColor: 'grey', twBg: 'bg-slate-500/10', twBorder: 'border-slate-500/40', twText: 'text-slate-400' };
};

// Generador de iconos dinámico para leaflet
const createColoredIcon = (colorName: string) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${colorName}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const Monitor = () => {
    const puntos = useLiveQuery(() => db.puntos.toArray()) || [];
    const [currentTime, setCurrentTime] = useState(new Date());
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [balanceCanal, setBalanceCanal] = useState({ entrada000: 0, salida104: 0 });

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const fetchAforos = async () => {
            if (!navigator.onLine) return;
            try {
                const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
                const { data } = await supabase
                    .from('aforos')
                    .select('punto_control_id, gasto_calculado_m3s, hora_fin')
                    .eq('fecha', today)
                    .in('punto_control_id', ['CANAL-000', 'CANAL-104'])
                    .order('hora_fin', { ascending: false });

                if (data && data.length > 0) {
                    const latest000 = data.find(d => d.punto_control_id === 'CANAL-000');
                    const latest104 = data.find(d => d.punto_control_id === 'CANAL-104');
                    setBalanceCanal({
                        entrada000: latest000?.gasto_calculado_m3s || 0,
                        salida104: latest104?.gasto_calculado_m3s || 0
                    });
                }
            } catch (error) {
                console.error("Error fetching aforos for balance", error);
            }
        };

        fetchAforos();
        const aforoInterval = setInterval(fetchAforos, 60000); // 1 min refresh

        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(timer);
            clearInterval(aforoInterval);
        };
    }, []);

    // 1. Filtrar solo tomas (ignorar escalas para el cálculo de volumen)
    const tomas = puntos.filter(p => p.type !== 'escala');

    // 2. Calcular volumen total por módulo
    const volPorModulo = tomas.reduce((acc, current) => {
        const mod = current.modulo || 'Sin Módulo';
        const vol = current.volumen_hoy_m3 || 0;
        if (!acc[mod]) acc[mod] = 0;
        acc[mod] += vol;
        return acc;
    }, {} as Record<string, number>);

    // Puntos actualmente abiertos y con coordenadas válidas para dibujar en mapa
    const puntosActivosMapa = tomas.filter(p =>
        ['inicio', 'reabierto', 'continua', 'modificacion'].includes(p.estado_hoy || '') &&
        p.lat !== undefined && p.lng !== undefined && p.lat !== 0 && p.lng !== 0
    );

    // 3. Calcular Gasto Instantáneo Total Extraído (m3/s)
    const entregadoModulosM3s = tomas.filter(p => ['inicio', 'reabierto', 'continua', 'modificacion'].includes(p.estado_hoy || '')).reduce((acc, p) => acc + (p.caudal_promedio || 0), 0);

    // 4. Balance: Diferencia No Contabilizada = Entrada - Entregado - Salida
    const diferenciaGasto = balanceCanal.entrada000 - entregadoModulosM3s - balanceCanal.salida104;

    const dateStr = currentTime.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
    const timeStr = currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="flex flex-col h-[100dvh] bg-mobile-dark">
            {/* Header */}
            <header className="px-4 py-4 bg-slate-900 border-b border-indigo-500/30 shrink-0 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-500/5 blur-3xl rounded-full -ml-16 -mt-16"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex flex-col">
                        <h1 className="text-base font-black text-white tracking-widest uppercase flex items-center gap-2">
                            <Scale className="text-indigo-400" size={18} />
                            Balance Hidrodinámico
                        </h1>
                        <span className="text-indigo-400 font-mono text-[10px] font-bold tracking-wider">
                            {dateStr} • {timeStr}
                        </span>
                    </div>
                    {isOnline ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-[8px] text-emerald-400 font-black tracking-tighter">RED ACTIVA</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
                            <WifiOff size={10} className="text-slate-500" />
                            <span className="text-[8px] text-slate-500 font-black tracking-tighter">LOCAL MODE</span>
                        </div>
                    )}
                </div>
            </header>

            <div className="flex-1 flex flex-col overflow-y-auto">
                {/* 0. Widget de Balance del Canal */}
                <div className="p-4 flex-shrink-0 bg-slate-900/50 border-b border-slate-700/50">
                    <div className="flex items-center gap-2 mb-3">
                        <Scale className="text-indigo-400" size={20} />
                        <h2 className="text-indigo-100 font-bold text-sm tracking-widest uppercase">
                            Balance Operativo del Canal
                        </h2>
                    </div>

                    <div className="bg-slate-800 rounded-xl p-3 shadow-inner border border-slate-700">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-700/50">
                            <span className="text-xs text-slate-400 font-bold uppercase"><span className="text-green-400">⬇️ ENTRADA</span> (K- 0+000)</span>
                            <span className="text-sm font-mono text-white font-bold">{balanceCanal.entrada000.toFixed(3)} <span className="text-[9px] text-slate-500">m³/s</span></span>
                        </div>
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-700/50">
                            <span className="text-xs text-slate-400 font-bold uppercase"><span className="text-amber-400">↘️ EXTRACCIÓN</span> MÓDULOS</span>
                            <span className="text-sm font-mono text-white font-bold">{entregadoModulosM3s.toFixed(3)} <span className="text-[9px] text-slate-500">m³/s</span></span>
                        </div>
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-xs text-slate-400 font-bold uppercase"><span className="text-blue-400">⬇️ SALIDA</span> (K-104+000)</span>
                            <span className="text-sm font-mono text-white font-bold">{balanceCanal.salida104.toFixed(3)} <span className="text-[9px] text-slate-500">m³/s</span></span>
                        </div>

                        <div className={`p-2 rounded-lg flex justify-between items-center border ${Math.abs(diferenciaGasto) > (balanceCanal.entrada000 * 0.1) ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-900 border-slate-700'}`}>
                            <div className="flex items-center gap-1.5">
                                <Calculator size={14} className={Math.abs(diferenciaGasto) > (balanceCanal.entrada000 * 0.1) ? 'text-red-400' : 'text-slate-400'} />
                                <span className={`text-[10px] font-bold tracking-wider ${Math.abs(diferenciaGasto) > (balanceCanal.entrada000 * 0.1) ? 'text-red-300' : 'text-slate-400'}`}>DIFERENCIA (PÉRDIDA)</span>
                            </div>
                            <span className={`text-base font-mono font-bold ${Math.abs(diferenciaGasto) > (balanceCanal.entrada000 * 0.1) ? 'text-red-400' : 'text-white'}`}>
                                {diferenciaGasto.toFixed(3)} <span className="text-[10px] opacity-70">m³/s</span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* 1. Panel de Volumen por Módulo */}
                <div className="p-4 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-3">
                        <Droplet className="text-mobile-accent" size={20} />
                        <h2 className="text-white font-bold text-sm tracking-widest uppercase">
                            Volumen Entregado Hoy
                        </h2>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {Object.entries(volPorModulo).filter(([_, vol]) => vol > 0).length === 0 ? (
                            <div className="col-span-2 text-slate-500 text-xs italic mt-2 text-center w-full">Sin entregas de volumen registradas hoy en los módulos.</div>
                        ) : (
                            Object.entries(volPorModulo)
                                .filter(([_, vol]) => vol > 0)
                                .sort((a, b) => b[1] - a[1])
                                .map(([modulo, vol]) => {
                                    const theme = getModuloTheme(modulo);
                                    return (
                                        <div key={modulo} className={`rounded-xl p-3 border shadow-sm flex flex-col ${theme.twBg} ${theme.twBorder}`}>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider mb-1 line-clamp-1 ${theme.twText}`}>
                                                MOD {modulo}
                                            </span>
                                            <span className="text-white text-lg font-mono font-bold">
                                                {(vol / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} <span className="text-[10px] opacity-70">Mm³</span>
                                            </span>
                                        </div>
                                    );
                                })
                        )}
                    </div>
                </div>

                {/* 2. Mapa Interactivo */}
                <div className="flex-1 flex flex-col p-4 pt-0 min-h-[350px]">
                    <div className="flex items-center gap-2 mb-3">
                        <Activity className="text-mobile-success" size={20} />
                        <h2 className="text-white font-bold text-sm tracking-widest uppercase">
                            Tomas Activas en Red
                        </h2>
                    </div>
                    <div className="flex-1 rounded-xl overflow-hidden border border-slate-700/50 relative z-0 flex flex-col bg-[#0f172a]">
                        {isOnline ? (
                            <MapContainer
                                // Fallback center
                                center={[28.188, -105.474]}
                                zoom={10}
                                style={{ height: '100%', width: '100%', background: '#0f172a' }}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                                    url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
                                    className="map-tiles"
                                />
                                {puntosActivosMapa.length > 0 && <MapBounds bounds={puntosActivosMapa.map(p => [p.lat!, p.lng!] as [number, number])} />}
                                {puntosActivosMapa.map(p => {
                                    const theme = getModuloTheme(p.modulo || 'general');
                                    return (
                                        <Marker key={p.id} position={[p.lat!, p.lng!]} icon={createColoredIcon(theme.leafletColor)}>
                                            <Popup className="custom-popup">
                                                <div className="text-xs text-slate-300">
                                                    <strong className={`block uppercase border-b border-slate-700 pb-1 mb-1 ${theme.twText}`}>{p.name}</strong>
                                                    <span className="block text-slate-400">MOD {p.modulo} | {p.seccion}</span>
                                                    <span className="block mt-1 font-mono text-white font-bold text-sm">
                                                        Vol: {((p.volumen_hoy_m3 || 0) / 1000000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Mm³
                                                    </span>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    );
                                })}
                            </MapContainer>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                                <WifiOff size={48} className="text-slate-600 mb-4" />
                                <h3 className="text-slate-400 font-bold mb-2">Mapa No Disponible Offline</h3>
                                <p className="text-xs text-slate-500 max-w-[250px]">
                                    Conéctate a internet para visualizar la ubicación geográfica de las tomas.
                                </p>

                                {/* Lista de Tomas Activas (Fallback) */}
                                <div className="mt-4 w-full flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                    {puntosActivosMapa.length > 0 ? puntosActivosMapa.map(p => {
                                        const theme = getModuloTheme(p.modulo || 'general');
                                        return (
                                            <div key={p.id} className={`flex justify-between items-center py-2 border-b border-slate-800 last:border-0`}>
                                                <div className="text-left">
                                                    <span className={`text-xs font-bold block ${theme.twText}`}>{p.name}</span>
                                                    <span className="text-[10px] text-slate-500">MOD {p.modulo} | {p.seccion}</span>
                                                </div>
                                                <span className="text-xs font-mono text-white font-bold">
                                                    {((p.volumen_hoy_m3 || 0) / 1000000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Mm³
                                                </span>
                                            </div>
                                        );
                                    }) : (
                                        <span className="text-xs text-slate-500 italic mt-4 block">No hay tomas activas registradas.</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Monitor;
