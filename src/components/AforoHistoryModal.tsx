import { useState, useEffect } from 'react';
import { X, Search, ArrowRight, Edit3, Trash2, History, TrendingUp } from 'lucide-react';
import { db, type SicaAforoRecord } from '../lib/db';
import { TrapezoidalSchema } from './TrapezoidalSchema';
import { toast } from 'sonner';

interface AforoHistoryModalProps {
    onClose: () => void;
    onEditRecord: (record: SicaAforoRecord) => void;
}

export const AforoHistoryModal = ({ onClose, onEditRecord }: AforoHistoryModalProps) => {
    const [history, setHistory] = useState<SicaAforoRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDetail, setSelectedDetail] = useState<SicaAforoRecord | null>(null);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        // Query all aforos, descending by date/time
        const records = await db.records
            .where('tipo')
            .equals('aforo')
            .reverse()
            .toArray() as SicaAforoRecord[];

        setHistory(records);
    };

    const handleDelete = async (id: string) => {
        if (confirm('¿Eliminar permanentemente esta bitácora local?')) {
            await db.records.delete(id);
            toast.success('Bitácora eliminada');
            loadHistory();
        }
    };

    const filteredHistory = history.filter(h =>
        h.punto_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.fecha_captura.includes(searchQuery)
    );

    return (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-5 border-b border-slate-800 bg-slate-800/40 flex justify-between items-center">
                    <div>
                        <h2 className="text-white font-black text-xl tracking-tighter flex items-center gap-2">
                            <History className="text-mobile-accent" size={24} /> BITÁCORA DE AFOROS
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Historial Local y Sincronizado</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 text-slate-400 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">

                    {/* List View */}
                    <div className="w-full sm:w-1/2 border-r border-slate-800 flex flex-col bg-slate-900/50">
                        <div className="p-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar por Canal o Fecha..."
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 pl-10 pr-4 text-xs text-white outline-none focus:border-mobile-accent"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar space-y-2">
                            {filteredHistory.length === 0 ? (
                                <div className="text-center py-10 text-slate-600 text-xs italic">No se encontraron aforos previos.</div>
                            ) : (
                                filteredHistory.map(record => (
                                    <div
                                        key={record.id}
                                        onClick={() => setSelectedDetail(record)}
                                        className={`p-3 rounded-2xl border transition-all cursor-pointer group ${selectedDetail?.id === record.id ? 'bg-mobile-accent/10 border-mobile-accent ring-1 ring-mobile-accent/30' : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800'}`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${record.sincronizado === 'true' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                {record.sincronizado === 'true' ? 'Sincronizado' : 'Pendiente'}
                                            </span>
                                            <span className="text-[10px] font-mono text-slate-500">{record.fecha_captura}</span>
                                        </div>
                                        <h3 className="text-sm font-bold text-white mt-1 truncate">{record.punto_id}</h3>
                                        <div className="mt-2 flex justify-between items-center text-xs">
                                            <div className="flex flex-col">
                                                <span className="text-slate-500 text-[9px] uppercase font-bold">Gasto</span>
                                                <span className="text-emerald-400 font-mono font-bold">{record.gasto_total_m3s.toFixed(3)} m³/s</span>
                                            </div>
                                            <ArrowRight size={14} className={`text-slate-600 group-hover:text-mobile-accent group-hover:translate-x-1 transition-all ${selectedDetail?.id === record.id ? 'text-mobile-accent translate-x-1' : ''}`} />
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Detail View */}
                    <div className="hidden sm:flex flex-1 bg-slate-950/50 flex-col overflow-y-auto custom-scrollbar p-5">
                        {selectedDetail ? (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-lg font-black text-white tracking-tight uppercase">{selectedDetail.punto_id}</h3>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => onEditRecord(selectedDetail)}
                                                className="bg-mobile-accent text-white p-2 rounded-xl hover:bg-opacity-80 shadow-lg shadow-mobile-accent/20 transition-all font-bold flex items-center gap-2 text-xs"
                                            >
                                                <Edit3 size={16} /> CORREGIR AFORO
                                            </button>
                                            <button
                                                onClick={() => handleDelete(selectedDetail.id)}
                                                className="bg-red-500/10 text-red-400 p-2 rounded-xl border border-red-500/20 hover:bg-red-500/20"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mb-6">
                                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl">
                                            <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Metadatos de Campo</p>
                                            <div className="text-xs text-slate-300 space-y-1 font-mono">
                                                <p>Hora In: {selectedDetail.hora_inicial}</p>
                                                <p>Hora Fin: {selectedDetail.hora_final}</p>
                                                <p>Responsable: {selectedDetail.responsable_nombre}</p>
                                            </div>
                                        </div>
                                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl">
                                            <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Resultados</p>
                                            <div className="text-xs text-slate-300 space-y-1 font-mono">
                                                <p>Escala In: {selectedDetail.tirante_inicial_m?.toFixed(2)}m</p>
                                                <p>Escala Fin: {selectedDetail.tirante_final_m?.toFixed(2)}m</p>
                                                <p className="text-emerald-400 font-bold">Gasto: {selectedDetail.gasto_total_m3s.toFixed(3)} m³/s</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                                        <h4 className="text-[10px] text-slate-500 font-black uppercase mb-3 flex items-center gap-2">
                                            <TrendingUp size={12} className="text-mobile-accent" /> Perfil de la Medición
                                        </h4>
                                        <TrapezoidalSchema dobelasCount={selectedDetail.dobelas.length} />

                                        <div className="mt-4 grid grid-cols-3 gap-2">
                                            {selectedDetail.dobelas.map((d, i) => (
                                                <div key={i} className="bg-slate-950 border border-slate-800 p-2 rounded-lg text-center">
                                                    <span className="block text-[8px] text-slate-500 font-bold">V{i + 1}</span>
                                                    <span className="block text-xs text-white font-mono font-bold">{d.tirante_m.toFixed(2)}m</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 italic">
                                <History size={48} className="mb-4 opacity-20" />
                                <p>Selecciona un aforo para ver detalles gerenciales</p>
                            </div>
                        )}
                    </div>

                    {/* Mobile Detail Overlay (If selected on small screen) */}
                    {selectedDetail && (
                        <div className="sm:hidden absolute inset-0 bg-slate-950 z-10 flex flex-col">
                            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                                <button onClick={() => setSelectedDetail(null)} className="text-mobile-accent font-bold text-sm">← Volver</button>
                                <span className="text-xs font-black text-white">DETALLE DE AFORO</span>
                                <div className="w-10"></div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5">
                                <h3 className="text-xl font-black text-white mb-4">{selectedDetail.punto_id}</h3>
                                <TrapezoidalSchema dobelasCount={selectedDetail.dobelas.length} />
                                <div className="grid grid-cols-2 gap-3 mt-6">
                                    <div className="bg-slate-900 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-500 uppercase font-black">Caudal</p>
                                        <p className="text-xl font-black text-emerald-400">{selectedDetail.gasto_total_m3s.toFixed(3)} <span className="text-[10px]">m³/s</span></p>
                                    </div>
                                    <div className="bg-slate-900 p-3 rounded-xl">
                                        <p className="text-[9px] text-slate-500 uppercase font-black">Escala Promedio</p>
                                        <p className="text-xl font-black text-white">{((selectedDetail.tirante_inicial_m + selectedDetail.tirante_final_m) / 2).toFixed(2)} <span className="text-[10px]">m</span></p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => onEditRecord(selectedDetail)}
                                    className="w-full mt-8 bg-mobile-accent py-4 rounded-2xl font-black text-white shadow-xl shadow-mobile-accent/30 active:scale-95 transition-all"
                                >
                                    EDITAR Y RE-CAPTURAR
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
