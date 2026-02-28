import { useState, useEffect } from 'react';
import { X, Trash2, CloudOff, Info } from 'lucide-react';
import { db, type SicaRecord, type SicaAforoRecord } from '../lib/db';
import { toast } from 'sonner';

interface PendingRecordsModalProps {
    onClose: () => void;
}

export const PendingRecordsModal = ({ onClose }: PendingRecordsModalProps) => {
    const [pendingRecords, setPendingRecords] = useState<SicaRecord[]>([]);

    useEffect(() => {
        loadPending();
    }, []);

    const loadPending = async () => {
        const records = await db.records.where({ sincronizado: 'false' }).toArray();
        setPendingRecords(records);
    };

    const handleDelete = async (id: string) => {
        if (confirm('¿Estás seguro de eliminar este registro pendiente? (No se puede recuperar)')) {
            await db.records.delete(id);
            toast.success('Registro eliminado');
            loadPending();
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">

                <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-800/50">
                    <h2 className="text-white font-bold text-lg flex items-center gap-2">
                        <CloudOff className="text-amber-500" /> Registros Pendientes
                    </h2>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:text-white bg-slate-800">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
                    <div className="bg-slate-800/50 border border-slate-700 p-3 rounded-xl mb-4 text-xs text-slate-300 flex gap-2">
                        <Info size={16} className="text-cyan-500 shrink-0" />
                        <p>Aquí puedes visualizar, ratificar o eliminar los registros que no lograron subir a la nube debido a errores de captura, validación de Supabase o conexión.</p>
                    </div>

                    {pendingRecords.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 italic">No hay registros pendientes.</div>
                    ) : (
                        <div className="space-y-3">
                            {pendingRecords.map((record, idx) => (
                                <div key={record.id} className="relative bg-slate-950 border border-slate-700 rounded-xl p-3 overflow-hidden">
                                    <div className="flex justify-between items-start mb-2 border-b border-slate-800 pb-2">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">#{idx + 1} - Tipo: <span className="text-white">{record.tipo}</span></span>
                                            <h3 className="text-amber-400 font-mono text-xs mt-0.5">{record.fecha_captura} | {record.hora_captura}</h3>
                                        </div>
                                        <button onClick={() => handleDelete(record.id)} className="text-red-400 hover:text-red-300 bg-red-950/30 p-1.5 rounded-lg border border-red-900/50">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    {/* Data Visualizer based on Type */}
                                    <div className="text-xs space-y-1 font-mono text-slate-300">
                                        <p><span className="text-slate-500">Punto ID:</span> {record.punto_id}</p>

                                        {record.tipo === 'toma' && (
                                            <>
                                                <p><span className="text-slate-500">Valor (Q):</span> {record.valor_q}</p>
                                                <p><span className="text-slate-500">Estado Op:</span> {record.estado_operativo}</p>
                                            </>
                                        )}
                                        {record.tipo === 'escala' && (
                                            <>
                                                <p><span className="text-slate-500">Escala (m):</span> {record.valor_q}</p>
                                            </>
                                        )}
                                        {record.tipo === 'aforo' && (
                                            <div className="mt-2 bg-slate-900 p-2 rounded border border-slate-800">
                                                <strong className="text-cyan-400 block mb-1 uppercase">Datos del Aforo:</strong>
                                                <p><span className="text-slate-500">Tirante Inicial:</span> {(record as SicaAforoRecord).tirante_inicial_m} m</p>
                                                <p><span className="text-slate-500">Tirante Final:</span> {(record as SicaAforoRecord).tirante_final_m} m</p>
                                                <p><span className="text-slate-500">Rango:</span> {(record as SicaAforoRecord).hora_inicial} - {(record as SicaAforoRecord).hora_final}</p>
                                                <p><span className="text-slate-500">Dobelas:</span> {((record as SicaAforoRecord).dobelas || []).length}</p>
                                                <p className="text-green-400 font-bold mt-1">Gasto Calculado: {(record as SicaAforoRecord).gasto_total_m3s} m³/s</p>
                                            </div>
                                        )}

                                        <p className="mt-2 text-[10px] text-red-500 italic font-bold">
                                            Status: {record.error_sync ? `Error de Servidor: ${record.error_sync}` : 'Error de Conexión / Pendiente de Sync'}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-800 text-center bg-slate-900">
                    <button onClick={onClose} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold text-sm transition-colors border border-slate-700">
                        Regresar a Captura
                    </button>
                </div>
            </div>
        </div>
    );
};
