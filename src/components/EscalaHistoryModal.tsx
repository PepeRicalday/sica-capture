
import { useState, useEffect, useCallback } from 'react';
import { X, Search, ArrowRight, Edit3, Trash2, History, Scale } from 'lucide-react';
import { db, type SicaRecord, type OfflinePoint } from '../lib/db';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface EscalaHistoryModalProps {
    onClose: () => void;
    onEditRecord: (record: any) => void;
}

export const EscalaHistoryModal = ({ onClose, onEditRecord }: EscalaHistoryModalProps) => {
    const { profile } = useAuth();
    const isGerente = profile?.rol === 'SRL';
    const [history, setHistory] = useState<SicaRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDate, setFilterDate] = useState('');
    const [selectedDetail, setSelectedDetail] = useState<SicaRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [puntosMap, setPuntosMap] = useState<Record<string, string>>({});

    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            // 1. Cargar locales (Mochila)
            const localRecords = await db.records
                .where('tipo')
                .equals('escala')
                .reverse()
                .toArray();

            // 1.1 Cargar Nombres de Puntos
            const puntos: OfflinePoint[] = await db.puntos.where('type').equals('escala').toArray();
            const names: Record<string, string> = {};
            puntos.forEach(p => { names[p.id] = p.name; });
            setPuntosMap(names);

            let allRecords = [...localRecords];

            // 2. Cargar remotos si hay internet
            if (navigator.onLine) {
                const { data: remoteRecords, error } = await supabase
                    .from('lecturas_escalas')
                    .select('*')
                    .order('fecha', { ascending: false })
                    .order('hora_lectura', { ascending: false })
                    .limit(200);

                if (error) {
                    console.error('Error fetching remote scales:', error);
                } else if (remoteRecords) {
                    // Mapear Supabase -> SicaRecord
                    const mappedRemote: SicaRecord[] = remoteRecords.map(r => ({
                        id: r.id,
                        tipo: 'escala',
                        punto_id: r.escala_id,
                        fecha_captura: r.fecha,
                        hora_captura: r.hora_lectura,
                        valor_q: r.nivel_m,
                        nivel_abajo_m: r.nivel_abajo_m,
                        apertura_radiales_m: r.apertura_radiales_m,
                        radiales_json: r.radiales_json,
                        gasto_calculado_m3s: r.gasto_calculado_m3s,
                        responsable_nombre: r.responsable,
                        sincronizado: 'true',
                        notas: r.notas
                    }));

                    // Mezclar deduplicando por ID
                    const localIds = new Set(localRecords.map(l => l.id));
                    const newRemote = mappedRemote.filter(r => !localIds.has(r.id));
                    allRecords = [...allRecords, ...newRemote].sort((a, b) => {
                        const dateA = new Date(`${a.fecha_captura}T${a.hora_captura}`).getTime();
                        const dateB = new Date(`${b.fecha_captura}T${b.hora_captura}`).getTime();
                        return dateB - dateA;
                    });
                }
            }

            setHistory(allRecords);
        } catch (err) {
            console.error('Failed to load history:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const handleDelete = async (id: string) => {
        if (!isGerente) return;
        if (confirm('¿Eliminar permanentemente esta lectura local?')) {
            await db.records.delete(id);
            toast.success('Lectura eliminada');
            loadHistory();
            setSelectedDetail(null);
        }
    };

    const filteredHistory = history.filter(h => {
        const name = puntosMap[h.punto_id] || h.punto_id;
        const query = searchQuery.toLowerCase();
        const puntoMatch = h.punto_id.toLowerCase().includes(query) || name.toLowerCase().includes(query);
        const dateMatch = h.fecha_captura.includes(query) || (filterDate && h.fecha_captura === filterDate);
        
        // Soporte para búsqueda por fecha en formato local (DD/MM/YYYY o MM/DD/YYYY)
        const [y, m, d] = h.fecha_captura.split('-');
        const dateNormal = `${d}/${m}/${y}`;
        const dateUS = `${m}/${d}/${y}`;
        const altDateMatch = dateNormal.includes(query) || dateUS.includes(query);

        return (puntoMatch || dateMatch || altDateMatch) && (!filterDate || h.fecha_captura === filterDate);
    });

    // NUEVA LÓGICA: Obtener solo el más reciente de cada punto y ordenar por KM
    const latestByPoint = Array.from(
        filteredHistory.reduce((map, record) => {
            if (!map.has(record.punto_id)) {
                map.set(record.punto_id, record);
            }
            return map;
        }, new Map<string, SicaRecord>()).values()
    ).sort((a, b) => {
        // Ordenar por ID de Punto (ESC-000, ESC-001...) de menor a mayor
        return a.punto_id.localeCompare(b.punto_id, undefined, { numeric: true, sensitivity: 'base' });
    });

    return (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-5 border-b border-slate-800 bg-slate-800/40 flex justify-between items-center">
                    <div>
                        <h2 className="text-white font-black text-xl tracking-tighter flex items-center gap-2">
                            <Scale className="text-mobile-accent" size={24} /> BITÁCORA DE NIVELES
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Historial Local de Lecturas</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 text-slate-400 transition-colors" title="Cerrar bitácora" aria-label="Cerrar">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">

                    {/* List View */}
                    <div className="w-full sm:w-1/2 border-r border-slate-800 flex flex-col bg-slate-900/50">
                        <div className="p-3 flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar..."
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white outline-none focus:border-mobile-accent"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <input
                                type="date"
                                title="Filtrar por fecha"
                                aria-label="Filtrar por fecha"
                                className="bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white outline-none focus:border-mobile-accent w-32"
                                value={filterDate}
                                onChange={(e) => setFilterDate(e.target.value)}
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar space-y-2">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-10 gap-3">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-mobile-accent"></div>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest animate-pulse">Sincronizando Bitácora...</p>
                                </div>
                            ) : latestByPoint.length === 0 ? (
                                <div className="text-center py-10 text-slate-600 text-xs italic">No se encontraron lecturas para los filtros aplicados.</div>
                            ) : (
                                    latestByPoint.map((record) => {
                                        const name = puntosMap[record.punto_id] || record.punto_id;
                                        
                                        // Cálculo de tendencia (comparando con el siguiente más antiguo del mismo punto en TODO el historial)
                                        const recordIdx = history.findIndex(r => r.id === record.id);
                                        const nextOldest = history.slice(recordIdx + 1).find(r => r.punto_id === record.punto_id);
                                        const trend = (nextOldest && record.valor_q !== undefined && nextOldest.valor_q !== undefined) 
                                            ? record.valor_q - nextOldest.valor_q 
                                            : null;

                                        return (
                                            <div
                                                key={record.id}
                                                onClick={() => setSelectedDetail(record)}
                                                className={`p-3 rounded-2xl border transition-all cursor-pointer group ${selectedDetail?.id === record.id ? 'bg-mobile-accent/10 border-mobile-accent ring-1 ring-mobile-accent/30' : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800'}`}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${record.sincronizado === 'true' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                        {record.sincronizado === 'true' ? 'Sincronizado' : 'Pendiente'}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-500">{record.fecha_captura} {record.hora_captura}</span>
                                                </div>
                                                <h3 className="text-sm font-bold text-white mt-1 truncate">{name}</h3>
                                                <div className="mt-2 flex justify-between items-center text-xs">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-slate-500 text-[9px] uppercase font-bold">Nivel Arriba</span>
                                                            <span className="text-mobile-accent font-mono font-bold">{record.valor_q?.toFixed(2)} m</span>
                                                        </div>
                                                        {trend !== null && (
                                                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg ${trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : trend < 0 ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                                                                {trend > 0 ? <TrendingUp size={10} /> : trend < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
                                                                <span className="text-[10px] font-bold">{trend > 0 ? '+' : ''}{trend.toFixed(2)}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <ArrowRight size={14} className={`text-slate-600 group-hover:text-mobile-accent group-hover:translate-x-1 transition-all ${selectedDetail?.id === record.id ? 'text-mobile-accent translate-x-1' : ''}`} />
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                    </div>

                    {/* Detail View */}
                    <div className="hidden sm:flex flex-1 bg-slate-950/50 flex-col overflow-y-auto custom-scrollbar p-5">
                        {selectedDetail ? (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-lg font-black text-white tracking-tight uppercase">
                                            {puntosMap[selectedDetail.punto_id] || selectedDetail.punto_id}
                                        </h3>
                                        {isGerente && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => onEditRecord(selectedDetail)}
                                                    className="bg-mobile-accent text-white p-2 px-4 rounded-xl hover:bg-opacity-80 shadow-lg shadow-mobile-accent/20 transition-all font-bold flex items-center gap-2 text-xs"
                                                >
                                                    <Edit3 size={16} /> CORREGIR
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(selectedDetail.id)}
                                                    className="bg-red-500/10 text-red-400 p-2 rounded-xl border border-red-500/20 hover:bg-red-500/20"
                                                    title="Eliminar registro"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 mb-6">
                                        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                                            <p className="text-[9px] text-slate-500 font-black uppercase mb-2">Detalles de la Lectura</p>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Nivel Arriba</span>
                                                    <span className="text-xl font-black text-white font-mono">{selectedDetail.valor_q?.toFixed(2)} m</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Nivel Abajo</span>
                                                    <span className="text-xl font-black text-slate-300 font-mono">{selectedDetail.nivel_abajo_m?.toFixed(2)} m</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Apertura Máx</span>
                                                    <span className="text-xl font-black text-slate-300 font-mono">{selectedDetail.apertura_radiales_m?.toFixed(2)} m</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Gasto Calc.</span>
                                                    <span className="text-xl font-black text-emerald-400 font-mono">{selectedDetail.gasto_calculado_m3s?.toFixed(3)} m³/s</span>
                                                </div>
                                                {(() => {
                                                    const idx = history.findIndex(r => r.id === selectedDetail.id);
                                                    const nextOldest = history.slice(idx + 1).find(r => r.punto_id === selectedDetail.punto_id);
                                                    const trend = (nextOldest && selectedDetail.valor_q && nextOldest.valor_q) 
                                                        ? selectedDetail.valor_q - nextOldest.valor_q 
                                                        : null;
                                                    
                                                    if (trend === null) return null;

                                                    return (
                                                        <div className="col-span-2 mt-2 p-2 bg-slate-950/50 rounded-xl border border-slate-800 flex justify-between items-center">
                                                            <span className="text-[10px] text-slate-500 uppercase font-bold">Tendencia vs Anterior</span>
                                                            <div className={`flex items-center gap-2 font-mono font-bold ${trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                                                {trend > 0 ? <TrendingUp size={14} /> : trend < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
                                                                <span>{trend > 0 ? '+' : ''}{trend.toFixed(3)} m</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                                            <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Metadatos</p>
                                            <div className="text-xs text-slate-300 space-y-1 font-mono">
                                                <p>Responsable: {selectedDetail.responsable_nombre}</p>
                                                <p>Módulo ID: {profile?.modulo_id || 'SRL RED MAYOR'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 italic">
                                <History size={48} className="mb-4 opacity-20" />
                                <p>Selecciona una lectura para ver detalles</p>
                            </div>
                        )}
                    </div>

                    {/* Mobile Detail Overlay */}
                    {selectedDetail && (
                        <div className="sm:hidden absolute inset-0 bg-slate-950 z-20 flex flex-col">
                            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                                <button onClick={() => setSelectedDetail(null)} className="text-mobile-accent font-bold text-sm">← Volver</button>
                                <span className="text-xs font-black text-white uppercase">Detalle de Nivel</span>
                                <div className="w-10"></div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                                <h3 className="text-xl font-black text-white">
                                    {puntosMap[selectedDetail.punto_id] || selectedDetail.punto_id}
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-900 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-500 uppercase font-black">Nivel Arriba</p>
                                        <p className="text-xl font-black text-mobile-accent font-mono">{selectedDetail.valor_q?.toFixed(2)} m</p>
                                    </div>
                                    <div className="bg-slate-900 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-500 uppercase font-black">Gasto</p>
                                        <p className="text-xl font-black text-emerald-400 font-mono">{selectedDetail.gasto_calculado_m3s?.toFixed(3)} m³/s</p>
                                    </div>
                                </div>
                                {isGerente && (
                                    <button
                                        onClick={() => onEditRecord(selectedDetail)}
                                        className="w-full bg-mobile-accent py-4 rounded-2xl font-black text-white shadow-xl shadow-mobile-accent/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                                    >
                                        <Edit3 size={20} /> CORREGIR LECTURA
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
