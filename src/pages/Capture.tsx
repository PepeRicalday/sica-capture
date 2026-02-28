import { useState, useEffect } from 'react';
import { Save, Wifi, WifiOff, UploadCloud, ChevronDown, RefreshCw, History as HistoryIcon } from 'lucide-react';
import { db, type SicaRecord, type SicaAforoRecord } from '../lib/db';
import { syncPendingRecords, downloadCatalogs } from '../lib/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { AforoForm } from '../components/AforoForm';
import { PendingRecordsModal } from '../components/PendingRecordsModal';
import { AforoHistoryModal } from '../components/AforoHistoryModal';

// Micro-Componente Aislado para Reloj: Evita el re-renderizado masivo de toda la App
const LiveClock = () => {
    const [time, setTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    const dateStr = time.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
    const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return (
        <span className="text-mobile-accent font-mono text-[10px] font-semibold tracking-wider mt-0.5">
            {dateStr} • {timeStr}
        </span>
    );
};

const Capture = () => {
    const { profile } = useAuth();
    // Formularios Dinámicos
    const [activeTab, setActiveTab] = useState<'escala' | 'toma' | 'aforo'>('escala');
    const [estadoToma, setEstadoToma] = useState<'inicio' | 'modificacion' | 'suspension' | 'reabierto' | 'cierre' | 'continua'>('inicio');
    const [manualTime, setManualTime] = useState<string>('');
    const [showSuccessAnim, setShowSuccessAnim] = useState(false);
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editingAforo, setEditingAforo] = useState<SicaAforoRecord | undefined>(undefined);

    // Método de Captura: Estilo "Cajero Automático" (Evita decimales rotos y números infinitos)
    const [rawValue, setRawValue] = useState<number>(0);
    const val = activeTab === 'toma' ? rawValue.toString() : (rawValue / 100).toFixed(2); // Litros/seg para Tomas, Metros para Escalas

    // Selectores Offline
    const [selectedPoint, setSelectedPoint] = useState<string>('');
    const puntos = useLiveQuery(() => db.puntos.toArray()) || [];

    // Red y Sincronía
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const pendingCount = useLiveQuery(() => db.records.where({ sincronizado: 'false' }).count(), []) || 0;

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

    const getCurrentTimeStr24 = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const handleKeypad = (num: number) => {
        setRawValue(prev => {
            const next = prev * 10 + num;
            // Cap to 9999.99 (999999 raw) to prevent absurd numbers
            return next > 999999 ? prev : next;
        });
    };

    const handleClear = () => setRawValue(0);
    const handleBackspace = () => setRawValue(prev => Math.floor(prev / 10));

    const handleSave = async () => {
        if (!selectedPoint) {
            toast.error('Por favor selecciona un punto o presa antes de guardar.');
            return;
        }

        // Validación de hora futura
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const captureDateStr = `${y}-${m}-${d}`; // Local Date

        const captureTimeStr = manualTime ? `${manualTime}:00` : now.toTimeString().split(' ')[0];

        if (manualTime) {
            const currentNow = new Date();
            const inputDate = new Date(`${captureDateStr}T${captureTimeStr}`);
            if (inputDate > currentNow) {
                toast.error('La hora seleccionada no puede ser en el futuro.');
                return;
            }
        }

        const payload: SicaRecord = {
            id: uuidv4(),
            tipo: activeTab,
            fecha_captura: captureDateStr,
            hora_captura: captureTimeStr,
            sincronizado: 'false', // ALWAYS start as false so syncPendingRecords picks it up
            responsable_id: profile?.id,
            responsable_nombre: profile?.nombre || 'Operador Móvil'
        };

        // Agregar valores según tipo
        if (activeTab === 'escala') {
            payload.punto_id = selectedPoint;
            payload.valor_q = parseFloat(val);
        } else if (activeTab === 'toma') {
            const numVal = parseFloat(val);
            const refPt = puntos.find(p => p.id === selectedPoint);

            if (refPt?.type !== 'canal' && refPt?.capacidad_max_lps && numVal > refPt.capacidad_max_lps) {
                toast.error(`Excede capacidad máxima de diseño (${refPt.capacidad_max_lps} L/s)`);
                return;
            }

            if (refPt) {
                const ptStatus = refPt.estado_hoy || 'cerrado';
                const isPtOpen = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(ptStatus);
                const isActionClosing = ['suspension', 'cierre'].includes(estadoToma);
                const isActionOpening = ['inicio', 'reabierto'].includes(estadoToma);
                const isActionOpenState = ['modificacion', 'continua', 'suspension', 'cierre'].includes(estadoToma);

                if (isPtOpen && isActionOpening) {
                    toast.error('La toma ya está abierta. Solo puedes modificarla, continuarla o cerrarla.');
                    return;
                }
                if (!isPtOpen && isActionOpenState) {
                    toast.error('La toma está cerrada. Debes iniciarla o reabrirla.');
                    return;
                }

                if (isActionClosing && numVal !== 0) {
                    toast.error('Para cerrar o suspender la toma, el gasto capturado debe ser 0.');
                    return;
                }
                if (!isActionClosing && numVal === 0) {
                    toast.error('Para iniciar, modificar o continuar la toma, el gasto capturado debe ser mayor a 0.');
                    return;
                }
            }

            payload.punto_id = selectedPoint;
            // Solo divide entre 1000 si NO es canal (el canal captura directo en m3/s)
            payload.valor_q = refPt?.type === 'canal' ? numVal : numVal / 1000;
            payload.estado_operativo = estadoToma;
        }

        try {
            await db.records.add(payload);

            // Actualización Optimista del UI (Cambia el punto a Verde Localmente de inmediato)
            if (activeTab === 'toma' && selectedPoint) {
                const pt = await db.puntos.get(selectedPoint);
                if (pt) {
                    await db.puntos.update(selectedPoint, {
                        estado_hoy: estadoToma
                    });
                }
            }

            if (!isOnline) {
                toast.warning('💾 Guardado Offline (En Mochila)');
            } else {
                // Sincronización Proactiva: Intentar subir de inmediato
                toast.promise(syncPendingRecords(), {
                    loading: '🚀 Sincronizando con Red Mayor...',
                    success: '✅ Sincronizado en Tiempo Real',
                    error: '💾 Resguardado Localmente (Pendiente de Sync)'
                });
            }

            setShowSuccessAnim(true);
            setTimeout(() => setShowSuccessAnim(false), 1500);

            setRawValue(0);
            setManualTime('');
        } catch (e) {
            toast.error('Error al guardar reporte.');
            console.error(e);
        }
    };

    return (
        <div className="flex flex-col min-h-full bg-mobile-dark relative">
            {/* Header Glassmorfico */}
            <header className="glass-panel px-3 py-2 flex justify-between items-center z-10 sticky top-0 pb-1 shrink-0 rounded-b-xl border-t-0 mx-[-1px]">
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold leading-none">Captura de Campo</h1>
                    <LiveClock />
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={async () => {
                            toast.promise(
                                (async () => {
                                    if (pendingCount > 0) await syncPendingRecords();
                                    await downloadCatalogs();
                                })(), {
                                loading: 'Sincronizando servidor...',
                                success: 'Canal sincronizado y actualizado',
                                error: (err) => `Error: ${err.message || 'No se pudo sincronizar'}`
                            });
                        }}
                        className="flex items-center justify-center bg-slate-800 text-slate-300 p-2 rounded-full active:scale-95 transition-transform"
                    >
                        <RefreshCw size={18} />
                    </button>
                    {pendingCount > 0 && (
                        <div
                            onClick={() => setShowPendingModal(true)}
                            className="flex items-center gap-1 text-mobile-warning bg-mobile-warning/10 px-2 py-1 rounded-full text-xs font-bold ring-1 ring-mobile-warning/30 cursor-pointer active:scale-95 transition-transform"
                        >
                            <UploadCloud size={14} />
                            <span>{pendingCount} Pendientes</span>
                        </div>
                    )}
                    {isOnline ? (
                        <Wifi className="text-mobile-success" />
                    ) : (
                        <WifiOff className="text-mobile-danger animate-pulse" />
                    )}
                </div>
            </header>

            <div className="flex-1 flex flex-col p-3 pb-8">

                {/* 1. Selector de Tipo (Rediseñado Gerencial: Alto Contraste Solar) */}
                <div className="flex bg-slate-900/90 rounded-xl p-1 mb-4 flex-shrink-0 text-[10px] sm:text-xs shadow-inner ring-1 ring-slate-800">
                    {(['escala', 'toma', 'aforo'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => { setActiveTab(tab); setSelectedPoint(''); }}
                            className={`flex-1 py-3 px-1 rounded-lg font-black uppercase tracking-wider transition-all duration-300 ${activeTab === tab
                                ? 'bg-mobile-accent text-slate-900 shadow-lg shadow-mobile-accent/30 scale-[1.02]'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {tab === 'escala' ? 'Niveles' : tab === 'toma' ? 'Distribución' : 'Aforos'}
                        </button>
                    ))}
                </div>

                {/* 2. Selector de Punto */}
                <div className="mb-2 relative flex-shrink-0">
                    <label className="block text-slate-400 text-[10px] mb-0.5 uppercase tracking-wider font-semibold">
                        SELECCIONAR UBICACIÓN
                    </label>
                    <div className="relative">
                        <select
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white appearance-none focus:border-mobile-accent outline-none font-bold text-sm"
                            value={selectedPoint}
                            onChange={(e) => {
                                const newId = e.target.value;
                                setSelectedPoint(newId);
                                if (activeTab === 'toma') {
                                    const pt = puntos.find(p => p.id === newId);
                                    const openStates = ['inicio', 'continua', 'modificacion', 'reabierto'];
                                    if (pt && openStates.includes(pt.estado_hoy || '') && pt.caudal_promedio) {
                                        const prevQ = Number(pt.caudal_promedio);
                                        if (pt.type === 'canal') {
                                            setRawValue(Math.round(prevQ));
                                        } else {
                                            setRawValue(Math.round(prevQ * 1000));
                                        }
                                    } else {
                                        setRawValue(0);
                                    }
                                } else {
                                    setRawValue(0);
                                }
                            }}
                        >
                            <option value="" disabled>-- Elige una Opción --</option>
                            {activeTab === 'aforo' ? (
                                <>
                                    <option value="CANAL-0+580">🟢 CANAL K- 0+580 (ENTRADA)</option>
                                    <option value="CANAL-106">🔵 CANAL K-106+000 (CONTROL EST.)</option>
                                    <option value="CANAL-104">🔴 CANAL K-104+000 (SALIDA FINAL)</option>
                                </>
                            ) : activeTab === 'escala' ? (
                                puntos
                                    .filter(p => p.type === 'escala')
                                    .sort((a, b) => (a.km || 0) - (b.km || 0))
                                    .map(p => <option key={p.id} value={p.id}>{p.name} (km {p.km?.toFixed(3)})</option>)
                            ) : (
                                puntos
                                    .filter(p => p.type !== 'escala')
                                    .sort((a, b) => (a.km || 0) - (b.km || 0))
                                    .map(p => {
                                        const modSec = [p.modulo && `Mod: ${p.modulo}`, p.seccion && `Sec: ${p.seccion}`].filter(Boolean).join(' | ');
                                        const suffix = modSec ? ` [${modSec}]` : '';
                                        const icon = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(p.estado_hoy || '') ? '🟢' : '🔴';
                                        return (
                                            <option key={p.id} value={p.id}>
                                                {icon} km {p.km?.toFixed(3)} - {p.name}{suffix}
                                            </option>
                                        );
                                    })
                            )}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    {puntos.length === 0 && (
                        <p className="text-mobile-warning text-[10px] mt-1">Buscando catálogos en caché...</p>
                    )}
                </div>

                {/* 2.1 Mini-Widget: Hora Manual de Escala (Solo Escalas) */}
                {activeTab === 'escala' && (
                    <div className="mb-2 flex-shrink-0 flex justify-end items-center">
                        <div className="flex items-center gap-2 glass-pill px-2 py-1 rounded-lg">
                            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Hora Reporte:</label>
                            <input
                                type="time"
                                value={manualTime || getCurrentTimeStr24()}
                                onChange={(e) => setManualTime(e.target.value)}
                                className="bg-slate-900 border border-slate-700/50 text-white text-xs px-2 py-1 rounded-md outline-none focus:border-mobile-accent focus:ring-1 focus:ring-mobile-accent/50 font-mono shadow-inner"
                            />
                        </div>
                    </div>
                )}

                {/* 2.2 Mini-Widget: Volumen Acumulado de la Zona (Solo Tomas) */}
                {activeTab === 'toma' && selectedPoint && (
                    <div className="mb-2 glass-pill p-1.5 px-2 rounded-lg flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                Volumen Entregado Hoy - {puntos.find(p => p.id === selectedPoint)?.seccion || 'Zona General'}
                            </span>
                            <span className="text-white text-sm font-bold flex items-center mt-0.5">
                                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></span>
                                {(() => {
                                    const currentPt = puntos.find(p => p.id === selectedPoint);
                                    if (!currentPt?.seccion_id) return '0.00 Mm³';

                                    // 1. Volumen de catálogo (descargado)
                                    const volCatalogo = puntos
                                        .filter(p => p.seccion_id === currentPt.seccion_id)
                                        .reduce((acc, curr) => acc + (curr.volumen_hoy_m3 || 0), 0);

                                    // 2. Mostrar formateado en Mm³ (millones de m³)
                                    return `${(volCatalogo / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Mm³`;
                                })()}
                            </span>
                        </div>
                        {['inicio', 'reabierto', 'continua', 'modificacion'].includes(puntos.find(p => p.id === selectedPoint)?.estado_hoy || '') && (
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded uppercase font-bold border border-green-500/30">
                                Abierta
                            </span>
                        )}
                        {['suspension', 'cierre', 'cerrado'].includes(puntos.find(p => p.id === selectedPoint)?.estado_hoy || 'cerrado') && (
                            <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded uppercase font-bold border border-red-500/30">
                                Cerrada
                            </span>
                        )}
                    </div>
                )}



                {/* 2.5 Selector de Estado (Solo Tomas) */}
                {activeTab === 'toma' && (
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-slate-400 text-xs uppercase tracking-wider font-semibold">
                                Acción Operativa
                            </label>
                            <div className="flex items-center gap-2">
                                <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Hora:</label>
                                <input
                                    type="time"
                                    value={manualTime || getCurrentTimeStr24()}
                                    onChange={(e) => setManualTime(e.target.value)}
                                    className="bg-slate-800 text-white text-xs px-2 py-1 rounded-md border border-slate-700 outline-none focus:border-mobile-accent font-mono shadow-inner"
                                />
                            </div>
                        </div>
                        <div className="flex bg-slate-800 rounded-lg p-1">
                            {(['inicio', 'modificacion', 'continua', 'suspension', 'reabierto', 'cierre'] as const).map(estado => {
                                const refPt = puntos.find(p => p.id === selectedPoint);
                                const ptStatus = refPt?.estado_hoy || 'cerrado';
                                const isPtOpen = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(ptStatus);

                                const isValidForOpen = ['modificacion', 'continua', 'suspension', 'cierre'].includes(estado);
                                const isValidForClosed = ['inicio', 'reabierto'].includes(estado);
                                const isAvailable = selectedPoint
                                    ? (isPtOpen ? isValidForOpen : isValidForClosed)
                                    : true; // Disable invalid ones

                                return (
                                    <button
                                        key={estado}
                                        onClick={() => {
                                            if (isAvailable) setEstadoToma(estado);
                                        }}
                                        className={`flex-1 py-1 px-1 rounded-md text-[10px] font-bold uppercase transition-all ${estadoToma === estado
                                            ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                            : !isAvailable
                                                ? 'bg-slate-900 text-slate-600 opacity-50 cursor-not-allowed'
                                                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                                            }`}
                                        disabled={!isAvailable}
                                    >
                                        {estado === 'modificacion' ? 'Modif.' : estado === 'continua' ? 'Cont.' : estado}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* SI ES AFORO -> RENDERIZAR NUEVO COMPONENTE */}
                {activeTab === 'aforo' && (
                    <div className="flex-1 min-h-0 overflow-hidden mt-2">
                        <div className="flex justify-between items-center mb-2 px-1">
                            <div className="h-1 w-1"></div>
                            <button
                                onClick={() => setShowHistoryModal(true)}
                                className="text-[10px] bg-slate-800 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5 font-bold hover:bg-slate-700 hover:text-white transition-all shadow-sm"
                            >
                                <HistoryIcon size={14} /> VER BITÁCORA ANTERIOR
                            </button>
                        </div>
                        <AforoForm
                            selectedPoint={selectedPoint}
                            isOnline={isOnline}
                            editRecord={editingAforo}
                            onSaveSuccess={() => {
                                setRawValue(0);
                                setManualTime('');
                                setSelectedPoint('');
                                setEditingAforo(undefined);
                                setActiveTab('escala');
                            }}
                        />
                    </div>
                )}

                {/* 3. Main Display Numérico (SOLO SI NO ES AFORO) */}
                {activeTab !== 'aforo' && (
                    <div className="flex-1 flex flex-col justify-end mt-4">
                        <div className="text-right text-slate-400 text-xs font-semibold mb-1 flex-shrink-0">
                            {activeTab === 'escala' ? 'Lectura de Nivel (m)' : 'Captura de Gasto (L/s)'}
                        </div>
                        <div className="text-right text-5xl sm:text-6xl font-mono font-bold text-white mb-4 tracking-tighter truncate flex-shrink-0">
                            {val}
                        </div>

                        {/* Guardar Button Movido Arriba del Numpad para Accesibilidad */}
                        <div className="mb-6 flex-shrink-0 relative">
                            {showSuccessAnim && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center glow-btn-success rounded-xl animate-in zoom-in spin-in-12 duration-300">
                                    <svg className="w-10 h-10 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}
                            <button
                                className="glow-btn-active w-full text-lg sm:text-xl h-14 rounded-xl flex items-center justify-center gap-2 font-bold shadow-[0_4px_14px_0_rgba(14,165,233,0.39)] hover:shadow-[0_6px_20px_rgba(14,165,233,0.23)] active:scale-95 transition-all"
                                onClick={handleSave}
                            >
                                <Save size={20} className="drop-shadow-sm" /> GUARDAR CAPTURA
                            </button>
                        </div>

                        {/* Numpad */}
                        <div className="grid grid-cols-3 grid-rows-4 gap-2 mb-2 flex-1">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                <button
                                    key={num}
                                    className="btn-calc"
                                    onClick={() => handleKeypad(num)}
                                >
                                    {num}
                                </button>
                            ))}
                            <button className="btn-calc danger" onClick={handleClear}>C</button>
                            <button className="btn-calc" onClick={() => handleKeypad(0)}>0</button>
                            <button className="btn-calc text-slate-400" onClick={handleBackspace}>⌫</button>
                        </div>
                    </div>
                )}

            </div>

            {showPendingModal && (
                <PendingRecordsModal onClose={() => setShowPendingModal(false)} />
            )}

            {showHistoryModal && (
                <AforoHistoryModal
                    onClose={() => setShowHistoryModal(false)}
                    onEditRecord={(record: SicaAforoRecord) => {
                        setEditingAforo(record);
                        setSelectedPoint(record.punto_id);
                        setShowHistoryModal(false);
                        toast.success(`Modo edición activo para ${record.punto_id}`);
                    }}
                />
            )}
        </div>
    );
};

export default Capture;
