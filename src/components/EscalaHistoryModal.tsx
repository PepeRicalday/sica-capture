
import { useState, useEffect } from 'react';
import { X, Search, ArrowRight, Edit3, Trash2, History, Scale } from 'lucide-react';
import { db, type SicaRecord } from '../lib/db';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

interface EscalaHistoryModalProps {
    onClose: () => void;
    onEditRecord: (record: any) => void;
}

export const EscalaHistoryModal = ({ onClose, onEditRecord }: EscalaHistoryModalProps) => {
    const { profile } = useAuth();
    const isGerente = profile?.rol === 'SRL';
    const [history, setHistory] = useState<SicaRecord[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDetail, setSelectedDetail] = useState<SicaRecord | null>(null);

    const loadHistory = async () => {
        const records = await db.records
            .where('tipo')
            .equals('escala')
            .reverse()
            .toArray();

        setHistory(records);
    };

    useEffect(() => {
        loadHistory();
    }, []);

    const handleDelete = async (id: string) => {
        if (!isGerente) return;
        if (confirm('¿Eliminar permanentemente esta lectura local?')) {
            await db.records.delete(id);
            toast.success('Lectura eliminada');
            loadHistory();
            setSelectedDetail(null);
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
                            <Scale className="text-mobile-accent" size={24} /> BITÁCORA DE NIVELES
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Historial Local de Lecturas</p>
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
                                    placeholder="Buscar por Escala o Fecha..."
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 pl-10 pr-4 text-xs text-white outline-none focus:border-mobile-accent"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar space-y-2">
                            {filteredHistory.length === 0 ? (
                                <div className="text-center py-10 text-slate-600 text-xs italic">No se encontraron lecturas previas.</div>
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
                                            <span className="text-[10px] font-mono text-slate-500">{record.fecha_captura} {record.hora_captura}</span>
                                        </div>
                                        <h3 className="text-sm font-bold text-white mt-1 truncate">{record.punto_id}</h3>
                                        <div className="mt-2 flex justify-between items-center text-xs">
                                            <div className="flex flex-col">
                                                <span className="text-slate-500 text-[9px] uppercase font-bold">Nivel Arriba</span>
                                                <span className="text-mobile-accent font-mono font-bold">{record.valor_q?.toFixed(2)} m</span>
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
                                <h3 className="text-xl font-black text-white">{selectedDetail.punto_id}</h3>
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
