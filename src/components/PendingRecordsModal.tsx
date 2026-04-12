import { useState, useEffect } from 'react';
import { db, type SicaRecord, type SicaAforoRecord } from '../lib/db';
import { toast } from 'sonner';
import { ManagerAuthModal } from './ManagerAuthModal';
import { syncPendingRecords } from '../lib/sync';
import { ShieldCheck, RefreshCw, X, CloudOff, Info, Trash2, Zap, AlertOctagon } from 'lucide-react';

interface PendingRecordsModalProps {
    onClose: () => void;
}

export const PendingRecordsModal = ({ onClose }: PendingRecordsModalProps) => {
    const [pendingRecords, setPendingRecords] = useState<SicaRecord[]>([]);
    const [puntosMap, setPuntosMap] = useState<Record<string, string>>({});
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [selectedRecordForAuth, setSelectedRecordForAuth] = useState<SicaRecord | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);

    const loadPending = async () => {
        const records = await db.records.where({ sincronizado: 'false' }).toArray();
        setPendingRecords(records);
        const puntos = await db.puntos.toArray();
        const names: Record<string, string> = {};
        puntos.forEach(p => { names[p.id] = p.name; });
        setPuntosMap(names);
    };

    useEffect(() => {
        loadPending();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDelete = async (id: string) => {
        if (confirm('¿Estás seguro de eliminar este registro pendiente? (No se puede recuperar)')) {
            await db.records.delete(id);
            toast.success('Registro eliminado');
            loadPending();
        }
    };

    const handleResetChronic = async (record: SicaRecord) => {
        // Limpiar estado crónico para que el próximo sync lo reintente
        await db.records.update(record.id, {
            error_sync: undefined,
            retry_count: 0,
            first_failed_at: undefined,
        });
        toast.success('Registro desbloqueado — se reintentará en el próximo sync');
        loadPending();
    };

    const handleAuthSuccess = async () => {
        if (!selectedRecordForAuth) return;
        try {
            const bypassNote = `\n[AUTORIZADO: Bypass Gerencial SRL - ${new Date().toLocaleString()}]`;
            await db.records.update(selectedRecordForAuth.id, {
                notas: (selectedRecordForAuth.notas || '') + bypassNote,
                error_sync: undefined,
                retry_count: 0,
                first_failed_at: undefined,
                confirmada: true,
            });
            setShowAuthModal(false);
            setSelectedRecordForAuth(null);
            toast.success('Registro Autorizado Localmente');
            setIsSyncing(true);
            await syncPendingRecords();
            await loadPending();
            setIsSyncing(false);
        } catch (error) {
            toast.error('Error al autorizar el registro');
            console.error(error);
        }
    };

    // Clasificar registros
    const autoRecords    = pendingRecords.filter(r => r.notas?.includes('[AUTO]'));
    const chronicRecords = pendingRecords.filter(r => !r.notas?.includes('[AUTO]') && r.error_sync?.includes('[CRÓNICO]'));
    const manualRecords  = pendingRecords.filter(r => !r.notas?.includes('[AUTO]') && !r.error_sync?.includes('[CRÓNICO]'));

    const autoDays  = new Set(autoRecords.map(r => r.fecha_captura)).size;
    const autoTomas = new Set(autoRecords.map(r => r.punto_id)).size;

    const formatError = (err: string) =>
        err.replace('[CRÓNICO] ', '').substring(0, 120) + (err.length > 120 ? '…' : '');

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
                        <p>Registros que no lograron subir a la nube. Los errores de conexión se reintentan automáticamente. Los errores estructurales requieren acción.</p>
                    </div>

                    {/* Continuidad automática — colapsado */}
                    {autoRecords.length > 0 && (
                        <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-3 mb-4 flex items-start gap-3">
                            <Zap size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-emerald-300 text-xs font-bold uppercase tracking-wide">
                                    Continuidad Automática — {autoRecords.length} registro{autoRecords.length !== 1 ? 's' : ''}
                                </p>
                                <p className="text-emerald-500 text-[10px] mt-0.5">
                                    {autoTomas} toma{autoTomas !== 1 ? 's' : ''} activa{autoTomas !== 1 ? 's' : ''} · {autoDays} día{autoDays !== 1 ? 's' : ''} con cobertura garantizada. Se subirán automáticamente.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Errores crónicos — requieren atención */}
                    {chronicRecords.length > 0 && (
                        <div className="mb-4">
                            <div className="flex items-center gap-2 mb-2">
                                <AlertOctagon size={14} className="text-red-400" />
                                <span className="text-red-400 text-[10px] font-black uppercase tracking-widest">
                                    Error Crónico — {chronicRecords.length} registro{chronicRecords.length !== 1 ? 's' : ''} bloqueado{chronicRecords.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                            <div className="space-y-2">
                                {chronicRecords.map((record, idx) => (
                                    <div key={record.id} className="bg-red-950/20 border border-red-800/40 rounded-xl p-3">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <span className="text-[10px] font-bold uppercase text-red-400">
                                                    #{idx + 1} · {record.tipo} · {record.fecha_captura}
                                                </span>
                                                <p className="text-slate-400 text-[10px] mt-0.5">
                                                    {puntosMap[record.punto_id] || record.punto_id}
                                                </p>
                                            </div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => { setSelectedRecordForAuth(record); setShowAuthModal(true); }}
                                                    title="Autorizar con bypass gerencial"
                                                    className="text-orange-400 bg-orange-950/30 p-1.5 rounded-lg border border-orange-900/50"
                                                >
                                                    <ShieldCheck size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleResetChronic(record)}
                                                    title="Desbloquear y reintentar"
                                                    className="text-cyan-400 bg-cyan-950/30 p-1.5 rounded-lg border border-cyan-900/50"
                                                >
                                                    <RefreshCw size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(record.id)}
                                                    title="Eliminar permanentemente"
                                                    className="text-red-400 bg-red-950/30 p-1.5 rounded-lg border border-red-900/50"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-red-500/80 text-[10px] font-mono leading-relaxed">
                                            {formatError(record.error_sync || '')}
                                        </p>
                                        <p className="text-slate-600 text-[9px] mt-1">
                                            {record.retry_count ?? 0} intento{(record.retry_count ?? 0) !== 1 ? 's' : ''} fallido{(record.retry_count ?? 0) !== 1 ? 's' : ''}
                                            {record.first_failed_at ? ` · desde ${new Date(record.first_failed_at).toLocaleDateString()}` : ''}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Registros manuales con error transitorio o sin error aún */}
                    {manualRecords.length === 0 && chronicRecords.length === 0 && autoRecords.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 italic">No hay registros pendientes.</div>
                    ) : manualRecords.length === 0 && chronicRecords.length === 0 ? (
                        <div className="text-center py-6 text-slate-500 italic text-sm">
                            Solo hay registros de continuidad automática pendientes de subir.
                        </div>
                    ) : manualRecords.length > 0 && (
                        <div className="space-y-3">
                            {manualRecords.map((record, idx) => (
                                <div key={record.id} className="relative bg-slate-950 border border-slate-700 rounded-xl p-3 overflow-hidden">
                                    <div className="flex justify-between items-start mb-2 border-b border-slate-800 pb-2">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                                #{idx + 1} - Tipo: <span className="text-white">{record.tipo}</span>
                                            </span>
                                            <h3 className="text-amber-400 font-mono text-xs mt-0.5">{record.fecha_captura} | {record.hora_captura}</h3>
                                        </div>
                                        <div className="flex gap-2">
                                            {record.error_sync && record.error_sync.includes('ESTRUCTURAL') && (
                                                <button
                                                    onClick={() => { setSelectedRecordForAuth(record); setShowAuthModal(true); }}
                                                    title="Autorizar Bypass Gerencial"
                                                    className="text-orange-400 hover:text-orange-300 bg-orange-950/30 p-1.5 rounded-lg border border-orange-900/50"
                                                >
                                                    <ShieldCheck size={16} />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(record.id)}
                                                title="Eliminar Registro Permanente"
                                                aria-label="Eliminar Registro"
                                                className="text-red-400 hover:text-red-300 bg-red-950/30 p-1.5 rounded-lg border border-red-900/50"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="text-xs space-y-1 font-mono text-slate-300">
                                        <p><span className="text-slate-500">Ubicación:</span> {puntosMap[record.punto_id] || record.punto_id}</p>

                                        {record.tipo === 'toma' && (
                                            <>
                                                <p><span className="text-slate-500">Valor (Q):</span> {record.valor_q}</p>
                                                <p><span className="text-slate-500">Estado Op:</span> {record.estado_operativo}</p>
                                            </>
                                        )}
                                        {record.tipo === 'escala' && (
                                            <p><span className="text-slate-500">Escala (m):</span> {record.valor_q}</p>
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
                                            Status: {record.error_sync
                                                ? `Error: ${record.error_sync.substring(0, 80)}`
                                                : 'Pendiente de conexión'}
                                        </p>
                                        {(record.retry_count ?? 0) > 0 && (
                                            <p className="text-slate-600 text-[9px]">
                                                {record.retry_count} intento{record.retry_count !== 1 ? 's' : ''} fallido{record.retry_count !== 1 ? 's' : ''}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-800 text-center bg-slate-900">
                    <button
                        onClick={async () => {
                            if (isSyncing) return;
                            setIsSyncing(true);
                            await syncPendingRecords();
                            await loadPending();
                            setIsSyncing(false);
                        }}
                        disabled={isSyncing || pendingRecords.length === 0}
                        title="Resincronizar registros pendientes con Supabase"
                        aria-label="Resincronizar Ahora"
                        className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white py-3 rounded-xl font-bold text-sm transition-colors border border-slate-700 flex items-center justify-center gap-2 mb-2"
                    >
                        {isSyncing ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                        Reintentar Sincronización
                    </button>
                    <button onClick={onClose} className="w-full bg-slate-950 hover:bg-slate-900 text-slate-400 py-3 rounded-xl font-bold text-sm transition-colors border border-slate-800">
                        Regresar a Captura
                    </button>
                </div>

                {showAuthModal && selectedRecordForAuth && (
                    <ManagerAuthModal
                        reason={selectedRecordForAuth.error_sync || 'Autorización de Registro'}
                        onClose={() => setShowAuthModal(false)}
                        onSuccess={handleAuthSuccess}
                    />
                )}
            </div>
        </div>
    );
};
