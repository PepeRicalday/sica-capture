import { useState, useEffect } from 'react';
import { Save, Wifi, WifiOff, UploadCloud, ChevronDown, RefreshCw } from 'lucide-react';
import { db, type SicaRecord } from '../lib/db';
import { syncPendingRecords, downloadCatalogs } from '../lib/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { AforoForm } from '../components/AforoForm';

const Capture = () => {
    const { profile } = useAuth();
    // Formularios Dinámicos
    const [activeTab, setActiveTab] = useState<'escala' | 'toma' | 'aforo'>('escala');
    const [currentTime, setCurrentTime] = useState(new Date());
    const [estadoToma, setEstadoToma] = useState<'inicio' | 'modificacion' | 'suspension' | 'reabierto' | 'cierre' | 'continua'>('inicio');
    const [manualTime, setManualTime] = useState<string>('');

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

        // Reloj en vivo
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(timer);
        };
    }, []);

    const dateStr = currentTime.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
    const timeStr = currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const timeStr24 = currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:mm para input type="time"

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
            payload.punto_id = selectedPoint;
            payload.valor_q = parseFloat(val) / 1000; // Aquí se captura L/s, guardamos en la DB / sync como m3/s
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
            setRawValue(0);
            setManualTime('');
        } catch (e) {
            toast.error('Error al guardar reporte.');
            console.error(e);
        }
    };

    return (
        <div className="flex flex-col min-h-full bg-mobile-dark">
            {/* Header */}
            <header className="bg-mobile-card px-3 py-2 flex justify-between items-center shadow-md pb-1 shrink-0">
                <div className="flex flex-col">
                    <h1 className="text-lg font-bold leading-none">Captura de Campo</h1>
                    <span className="text-mobile-accent font-mono text-[10px] font-semibold tracking-wider mt-0.5">
                        {dateStr} • {timeStr}
                    </span>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            toast.promise(downloadCatalogs(), {
                                loading: 'Descargando catálogos...',
                                success: 'Catálogos actualizados',
                                error: (err) => `Error: ${err.message || 'No se pudo actualizar'}`
                            });
                        }}
                        className="flex items-center justify-center bg-slate-800 text-slate-300 p-2 rounded-full active:scale-95 transition-transform"
                    >
                        <RefreshCw size={18} />
                    </button>
                    {pendingCount > 0 && (
                        <div className="flex items-center gap-1 text-mobile-warning bg-mobile-warning/10 px-2 py-1 rounded-full text-xs font-bold ring-1 ring-mobile-warning/30">
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

                {/* 1. Selector de Tipo */}
                <div className="flex bg-slate-800 rounded-lg p-0.5 mb-2 flex-shrink-0 text-[10px] sm:text-xs">
                    {(['escala', 'toma', 'aforo'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => { setActiveTab(tab); setSelectedPoint(''); }}
                            className={`flex-1 py-1.5 px-1 rounded-md font-bold uppercase transition-colors ${activeTab === tab ? 'bg-mobile-dark text-mobile-accent' : 'text-slate-400'
                                }`}
                        >
                            {tab === 'escala' ? 'Control de Niveles' : tab === 'toma' ? 'Distribución' : 'Aforos'}
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
                            className="w-full bg-slate-800 border.5 border-slate-700 rounded-lg p-2 text-white appearance-none focus:border-mobile-accent outline-none font-bold text-sm"
                            value={selectedPoint}
                            onChange={(e) => setSelectedPoint(e.target.value)}
                        >
                            <option value="" disabled>-- Elige una Opción --</option>
                            {activeTab === 'aforo' ? (
                                <>
                                    <option value="CANAL-000">🟢 CANAL K- 0+000 (ENTRADA)</option>
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
                        <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur border border-slate-700/50 px-2 py-1 rounded-lg">
                            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Hora Reporte:</label>
                            <input
                                type="time"
                                value={manualTime || timeStr24}
                                onChange={(e) => setManualTime(e.target.value)}
                                className="bg-slate-800 text-white text-xs px-2 py-1 rounded-md border border-slate-700 outline-none focus:border-mobile-accent font-mono shadow-inner"
                            />
                        </div>
                    </div>
                )}

                {/* 2.2 Mini-Widget: Volumen Acumulado de la Zona (Solo Tomas) */}
                {activeTab === 'toma' && selectedPoint && (
                    <div className="mb-2 bg-slate-800/50 backdrop-blur border border-slate-700/50 p-1.5 px-2 rounded-lg flex items-center justify-between">
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
                                        .reduce((acc, curr) => acc + (curr.volumen_hoy_mm3 || 0), 0);

                                    // 2. Volumen de récords pendientes (no sincronizados aún)
                                    // Nota: Como no tenemos una función de cálculo de volumen JS idéntica al trigger,
                                    // mostramos esto como una ayuda visual, pero lo ideal es el sync.
                                    // Por ahora solo sumamos lo que viene del catálogo.
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
                                    value={manualTime || timeStr24}
                                    onChange={(e) => setManualTime(e.target.value)}
                                    className="bg-slate-800 text-white text-xs px-2 py-1 rounded-md border border-slate-700 outline-none focus:border-mobile-accent font-mono shadow-inner"
                                />
                            </div>
                        </div>
                        <div className="flex bg-slate-800 rounded-lg p-1">
                            {(['inicio', 'modificacion', 'continua', 'suspension', 'reabierto', 'cierre'] as const).map(estado => (
                                <button
                                    key={estado}
                                    onClick={() => setEstadoToma(estado)}
                                    className={`flex-1 py-1 px-1 rounded-md text-[10px] font-bold uppercase transition-all ${estadoToma === estado
                                        ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                                        }`}
                                >
                                    {estado === 'modificacion' ? 'Modif.' : estado === 'continua' ? 'Cont.' : estado}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* SI ES AFORO -> RENDERIZAR NUEVO COMPONENTE */}
                {activeTab === 'aforo' && (
                    <div className="flex-1 min-h-0 overflow-hidden mt-2">
                        <AforoForm
                            selectedPoint={selectedPoint}
                            isOnline={isOnline}
                            onSaveSuccess={() => {
                                setRawValue(0);
                                setManualTime('');
                                setActiveTab('escala');
                                setSelectedPoint('');
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
                        <div className="mb-6 flex-shrink-0">
                            <button
                                className="bg-mobile-accent text-white w-full text-lg sm:text-xl h-14 rounded-xl flex items-center justify-center gap-2 font-bold shadow-lg active:scale-95 transition-transform"
                                onClick={handleSave}
                            >
                                <Save size={20} /> GUARDAR CAPTURA
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
        </div>
    );
};

export default Capture;
