import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Droplet, Activity, WifiOff } from 'lucide-react';

// Fix para los iconos de leaflet en react (bug clásico)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Icono verde personalizado para puntos activos
const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
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

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(timer);
        };
    }, []);

    // 1. Filtrar solo tomas (ignorar escalas para el cálculo de volumen)
    const tomas = puntos.filter(p => p.type !== 'escala');

    // 2. Calcular volumen total por módulo
    const volPorModulo = tomas.reduce((acc, current) => {
        const mod = current.modulo || 'Sin Módulo';
        const vol = current.volumen_hoy_mm3 || 0;
        if (!acc[mod]) acc[mod] = 0;
        acc[mod] += vol;
        return acc;
    }, {} as Record<string, number>);

    // Puntos actualmente abiertos y con coordenadas válidas para dibujar en mapa
    const puntosActivosMapa = tomas.filter(p =>
        ['inicio', 'reabierto', 'continua'].includes(p.estado_hoy || '') &&
        p.lat !== undefined && p.lng !== undefined && p.lat !== 0 && p.lng !== 0
    );

    const dateStr = currentTime.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
    const timeStr = currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="flex flex-col h-full bg-mobile-dark">
            {/* Header */}
            <header className="bg-mobile-card px-4 py-3 flex justify-between items-center shadow-md">
                <div className="flex flex-col">
                    <h1 className="text-xl font-bold leading-tight">Monitor Operativo</h1>
                    <span className="text-mobile-accent font-mono text-xs font-semibold tracking-wider">
                        {dateStr} • {timeStr}
                    </span>
                </div>
            </header>

            <div className="flex-1 flex flex-col overflow-y-auto">
                {/* 1. Panel de Volumen por Módulo */}
                <div className="p-4 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-3">
                        <Droplet className="text-mobile-accent" size={20} />
                        <h2 className="text-white font-bold text-sm tracking-widest uppercase">
                            Volumen Entregado Hoy
                        </h2>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {Object.entries(volPorModulo).length === 0 ? (
                            <div className="col-span-2 text-slate-500 text-xs italic">Sincronizando catálogos...</div>
                        ) : (
                            Object.entries(volPorModulo).sort((a, b) => b[1] - a[1]).map(([modulo, vol]) => (
                                <div key={modulo} className="bg-slate-800 rounded-xl p-3 border border-slate-700/50 shadow-sm flex flex-col">
                                    <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1 line-clamp-1">
                                        MOD {modulo}
                                    </span>
                                    <span className="text-white text-lg font-mono font-bold">
                                        {(vol / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} <span className="text-[10px] text-mobile-accent">Mm³</span>
                                    </span>
                                </div>
                            ))
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
                                // Coordenadas aproximadas del Distrito 005 (Delicias)
                                center={[28.188, -105.474]}
                                zoom={10}
                                style={{ height: '100%', width: '100%', background: '#0f172a' }}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                    url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
                                    className="map-tiles"
                                />
                                {puntosActivosMapa.map(p => (
                                    <Marker key={p.id} position={[p.lat!, p.lng!]} icon={greenIcon}>
                                        <Popup className="custom-popup">
                                            <div className="text-xs text-slate-300">
                                                <strong className="block text-mobile-accent uppercase border-b border-slate-700 pb-1 mb-1">{p.name}</strong>
                                                <span className="block text-slate-400">MOD {p.modulo} | {p.seccion}</span>
                                                <span className="block mt-1 font-mono text-mobile-success font-bold text-sm">
                                                    Vol: {((p.volumen_hoy_mm3 || 0) / 1000000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Mm³
                                                </span>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
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
                                    {puntosActivosMapa.length > 0 ? puntosActivosMapa.map(p => (
                                        <div key={p.id} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                                            <div className="text-left">
                                                <span className="text-xs font-bold text-mobile-accent block">{p.name}</span>
                                                <span className="text-[10px] text-slate-500">MOD {p.modulo} | {p.seccion}</span>
                                            </div>
                                            <span className="text-xs font-mono text-mobile-success font-bold">
                                                {((p.volumen_hoy_mm3 || 0) / 1000000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Mm³
                                            </span>
                                        </div>
                                    )) : (
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
