import { useState, useEffect } from 'react';
import {
    Save, Wifi, WifiOff, UploadCloud, ChevronDown, RefreshCw,
    AlertTriangle, History as HistoryIcon
} from 'lucide-react';
import { db, type SicaRecord, type SicaAforoRecord } from '../lib/db';
import { syncPendingRecords, downloadCatalogs } from '../lib/sync';
import { getTodayString } from '../lib/dateHelpers';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { AforoForm } from '../components/AforoForm';
import { PendingRecordsModal } from '../components/PendingRecordsModal';
import { AforoHistoryModal } from '../components/AforoHistoryModal';
import { EscalaHistoryModal } from '../components/EscalaHistoryModal';
import { TomaHistoryModal } from '../components/TomaHistoryModal';
import { RepresoSchema } from '../components/RepresoSchema';
import { useHydricStatus } from '../context/HydricStatusContext';
import StatusBanner from '../components/StatusBanner';
import { ManagerAuthModal } from '../components/ManagerAuthModal';

// Función Haversine para cálculo de distancia en metros
const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

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
    const [activeTab, setActiveTab] = useState<'escala' | 'toma' | 'aforo' | 'presas'>('escala');
    const [estadoToma, setEstadoToma] = useState<'inicio' | 'modificacion' | 'suspension' | 'reabierto' | 'cierre' | 'continua'>('inicio');
    const [manualDate, setManualDate] = useState<string>(getTodayString());
    const [manualTime, setManualTime] = useState<string>('');
    const [showSuccessAnim, setShowSuccessAnim] = useState(false);
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showEscalaHistoryModal, setShowEscalaHistoryModal] = useState(false);
    const [showTomaHistoryModal, setShowTomaHistoryModal] = useState(false);
    const [editingAforo, setEditingAforo] = useState<SicaAforoRecord | undefined>(undefined);
    const [editingRecord, setEditingRecord] = useState<SicaRecord | undefined>(undefined);

    // Modal de Autorización Gerencial
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authReason, setAuthReason] = useState('');
    const [pendingPayload, setPendingPayload] = useState<SicaRecord | null>(null);

    // Método de Captura: Estilo "Cajero Automático" (Evita decimales rotos y números infinitos)
    const [rawValue, setRawValue] = useState<number>(0);
    const [escalaField, setEscalaField] = useState<'arriba' | 'abajo' | 'apertura'>('arriba');
    const [escalaData, setEscalaData] = useState<{ arriba: number, abajo: number, aperturas: number[] }>({ arriba: 0, abajo: 0, aperturas: [] });
    const [activeGateIndex, setActiveGateIndex] = useState(0);

    const val = (activeTab === 'toma' || activeTab === 'presas')
        ? rawValue.toString()
        : activeTab === 'escala'
            ? (escalaField === 'apertura' ? ((escalaData.aperturas[activeGateIndex] || 0) / 100).toFixed(2) : (escalaData[escalaField] / 100).toFixed(2))
            : '0.00'; // Listros/seg para Tomas, Metros para Escalas

    // Hydric Status
    const { activeEvent, maxKmAlcanzado } = useHydricStatus();

    // Selectores Offline
    const [selectedPoint, setSelectedPoint] = useState<string>('');
    const puntos = useLiveQuery(() => db.puntos.toArray()) || [];

    // Red y Sincronía
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const pendingCount = useLiveQuery(() => db.records.where({ sincronizado: 'false' }).count(), []) || 0;

    // MEJ-10: Verificar si ya existe una confirmación de arribo local para el punto seleccionado
    const localArriboPending = useLiveQuery(
        async () => {
            if (!selectedPoint) return false;
            const records = await db.records
                .where('punto_id')
                .equals(selectedPoint)
                .filter(r => r.notas?.includes('ARRIBO VISUAL CONFIRMADO') || false)
                .toArray();
            return records.length > 0;
        },
        [selectedPoint]
    );

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
        if (activeTab === 'escala') {
            if (escalaField === 'apertura') {
                setEscalaData(prev => {
                    const prevAps = [...prev.aperturas];
                    const prevVal = prevAps[activeGateIndex] || 0;
                    const next = prevVal * 10 + num;
                    prevAps[activeGateIndex] = next > 999999 ? prevVal : next;
                    return { ...prev, aperturas: prevAps };
                });
            } else {
                setEscalaData(prev => {
                    const prevVal = prev[escalaField];
                    const next = prevVal * 10 + num;
                    return { ...prev, [escalaField]: next > 999999 ? prevVal : next };
                });
            }
        } else {
            setRawValue(prev => {
                const next = prev * 10 + num;
                return next > 999999 ? prev : next;
            });
        }
    };

    const handleClear = () => {
        if (activeTab === 'escala') {
            if (escalaField === 'apertura') {
                setEscalaData(prev => {
                    const nextAps = [...prev.aperturas];
                    nextAps[activeGateIndex] = 0;
                    return { ...prev, aperturas: nextAps };
                });
            } else {
                setEscalaData(prev => ({ ...prev, [escalaField]: 0 }));
            }
        } else {
            setRawValue(0);
        }
    };

    const handleBackspace = () => {
        if (activeTab === 'escala') {
            if (escalaField === 'apertura') {
                setEscalaData(prev => {
                    const nextAps = [...prev.aperturas];
                    nextAps[activeGateIndex] = Math.floor((nextAps[activeGateIndex] || 0) / 10);
                    return { ...prev, aperturas: nextAps };
                });
            } else {
                setEscalaData(prev => ({ ...prev, [escalaField]: Math.floor(prev[escalaField] / 10) }));
            }
        } else {
            setRawValue(prev => Math.floor(prev / 10));
        }
    };

    const handleSave = async (isAuthorized = false) => {
        if (!selectedPoint) {
            toast.error('Por favor selecciona un punto o presa antes de guardar.');
            return;
        }

        const isGerente = profile?.rol === 'SRL';

        try {

            // Validación de hora futura (Chihuahua Timezone forzada)
            // Validación de hora futura (Chihuahua Timezone forzada)
            const captureDateStr = manualDate || getTodayString();
            const nowChihuahua = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chihuahua' }));

            const hr = String(nowChihuahua.getHours()).padStart(2, '0');
            const min = String(nowChihuahua.getMinutes()).padStart(2, '0');
            const sec = String(nowChihuahua.getSeconds()).padStart(2, '0');

            const captureTimeStr = manualTime ? `${manualTime}:00` : `${hr}:${min}:${sec}`;

            if (manualTime || manualDate !== getTodayString()) {
                const inputDate = new Date(`${captureDateStr}T${captureTimeStr}`);
                if (inputDate > nowChihuahua) {
                    toast.error('La fecha y hora seleccionada no puede ser en el futuro.');
                    return;
                }
            }

            const payload: SicaRecord = {
                id: editingRecord?.id || uuidv4(),
                tipo: activeTab === 'presas' ? 'presa' : activeTab,
                punto_id: selectedPoint,
                fecha_captura: editingRecord?.fecha_captura || captureDateStr,
                hora_captura: captureTimeStr,
                sincronizado: 'false', // ALWAYS start as false so syncPendingRecords picks it up
                confirmada: true, // New field: Field reading is always confirmed
                responsable_id: profile?.id,
                responsable_nombre: profile?.nombre || 'Operador Móvil'
            };

            // Agregar valores según tipo
            if (activeTab === 'escala') {
                const hArriba = escalaData.arriba / 100;
                const hAbajo = escalaData.abajo / 100;

                // ---- REGLAS FÍSICAS Y LÓGICAS PARA ESCALAS ----
                const pt = puntos.find(p => p.id === selectedPoint);

                if (hArriba > 4.50) {
                    toast.error('Bloqueo: El nivel supera el bordo físico del canal (4.50m). Imposible guardar.');
                    return;
                }
                
                // Permitir 0 o niveles muy bajos durante el llenado
                const isLlenado = activeEvent?.evento_tipo === 'LLENADO';
                
                if (hArriba < 0) {
                    toast.error('Bloqueo: El nivel no puede ser negativo.');
                    return;
                }

                if (hArriba === 0 && !isLlenado && !isAuthorized && !isGerente) {
                    toast.error('Bloqueo: El nivel no puede ser 0 absoluto en operación normal.');
                    return;
                }
                if (hAbajo > hArriba) {
                    toast.error('Gravedad: Nivel abajo no puede ser mayor que Nivel arriba.');
                    return;
                }

                // ---- VALIDACIÓN DE SEGURIDAD ESTRUCTURAL (TASA DE VACIADO) ----
                // Comparamos con el nivel_actual del catálogo (descargado en sync)
                if (pt?.nivel_actual !== undefined && pt.nivel_actual > 0 && hArriba < pt.nivel_actual && !isAuthorized) {
                    const deltaM = pt.nivel_actual - hArriba;
                    if (deltaM > 0.15) { // Alerta a partir de 15cm (umbral preventivo)
                         const msg = `ALERTA DE SEGURIDAD: Se detecta una caída de nivel de ${(deltaM * 100).toFixed(0)}cm respecto a la última lectura oficial (${pt.nivel_actual}m).\n\nEsto puede exceder el límite estructural (30cm/día).`;
                         
                         if (isGerente) {
                             const ok = window.confirm(`${msg}\n\n¿Desea guardar el registro asumiendo responsabilidad gerencial?`);
                             if (!ok) return;
                             payload.notas = (payload.notas || '') + ` [ALERTA SEGURIDAD CONFIRMADA POR GERENCIA]`;
                         } else {
                             const confirmed = window.confirm(`${msg}\n\n¿Deseas solicitar autorización gerencial?`);
                             if (confirmed) {
                                 setAuthReason(`SEGURIDAD ESTRUCTURAL: Tasa de vaciado potencialmente peligrosa detectada en ${pt.name || (pt as any).nombre}. Caída de ${(deltaM * 100).toFixed(0)}cm.`);
                                 setPendingPayload(payload);
                                 setShowAuthModal(true);
                                 return;
                             } else {
                                 return;
                             }
                         }
                    }
                }
                
                // MEJ-7: Validación dinámica de rango operativo por escala
                // Fallback solo si el catálogo no trae valores (escala sin configurar)
                const minOp = (pt?.nivel_min_operativo && pt.nivel_min_operativo > 0) ? pt.nivel_min_operativo : 2.80;
                const maxOp = (pt?.nivel_max_operativo && pt.nivel_max_operativo > 0) ? pt.nivel_max_operativo : 3.40;
                if (!pt?.nivel_min_operativo) console.warn(`[SICA] Escala ${selectedPoint}: nivel_min_operativo no en catálogo, usando fallback ${minOp}m`);
                
                // Si es Gerente, SRL o está en LLENADO, no molestamos con el rango óptimo si es menor (porque está llenando)
                const skipRangeCheck = isAuthorized || isGerente || (isLlenado && hArriba < minOp);

                if (!skipRangeCheck && (hArriba < minOp || hArriba > maxOp)) {
                    const confirmed = window.confirm(`El nivel de ${hArriba}m está fuera del rango óptimo definido para esta escala (${minOp}m - ${maxOp}m).\n¿Desea guardar como una alerta operativa?`);
                    if (!confirmed) return;
                }
                
                // Si hArriba es 0 y es normal, avisar
                if (hArriba === 0 && !isLlenado && (isGerente || isAuthorized)) {
                    const confirmed = window.confirm("¿Seguro que desea guardar nivel 0.00m? (Afectará cálculos de volumen)");
                    if (!confirmed) return;
                }

                let q = 0;
                const realAperturasStr: any[] = [];
                let maxAperturaStr = 0;

                if (pt?.pzas_radiales && pt?.ancho_radiales && escalaData.aperturas?.length > 0) {
                    const Cd = 0.6;
                    const maxAltoCompuerta = pt.alto_radiales || 4.0; // Fallback si no hay alto

                    for (let i = 0; i < pt.pzas_radiales; i++) {
                        const ap = (escalaData.aperturas[i] || 0) / 100;

                        if (ap > maxAltoCompuerta) {
                            toast.error(`Bloqueo: La apertura de la radial ${i + 1} (${ap}m) excede su tamaño físico (${maxAltoCompuerta}m).`);
                            return;
                        }

                        realAperturasStr.push({ index: i, apertura_m: ap });
                        if (ap > maxAperturaStr) maxAperturaStr = ap;

                        if (ap > 0) {
                            const area = pt.ancho_radiales * ap;
                            // REGLA DE HIDRO-SINCRONÍA: El gasto depende de la CARGA (hArriba - hAbajo)
                            const carga = Math.max(0, hArriba - hAbajo);
                            
                            if (carga > 0.01) { // Mínimo 1cm de diferencial para flujo significativo
                                if (ap < hArriba) {
                                    // Flujo por Orificio (Compuerta sumergida o parcial)
                                    q += Cd * area * Math.sqrt(2 * 9.81 * carga);
                                } else {
                                    // Flujo Libre / Vertedor (Compuerta abierta arriba del nivel del agua)
                                    // En este caso el gasto no aumenta con 'ap', solo con 'hArriba'
                                    q += 1.84 * pt.ancho_radiales * Math.pow(carga, 1.5);
                                }
                            }
                        }
                    }
                } else {
                    // Garganta Larga
                    const cd = 1.84;
                    const n = 1.52;
                    q = hArriba > 0 ? cd * Math.pow(hArriba, n) : 0;
                }

                payload.punto_id = selectedPoint;
                payload.valor_q = hArriba; // nivel principal (arriba)
                payload.nivel_abajo_m = hAbajo;
                payload.apertura_radiales_m = maxAperturaStr; // Guardamos la máxima como numérico legacy
                payload.radiales_json = realAperturasStr; // JSON Guardamos para ver cada una al renderizar
                payload.gasto_calculado_m3s = q;

                // ---- VALIDACIÓN DE CAPACIDAD CONTRA PERFIL DE DISEÑO (Offline-First) ----
                const ptKm = pt?.km;
                if (ptKm !== undefined) {
                    const profiles = await db.perfil_hidraulico.toArray();
                    const section = profiles.find(p => ptKm >= p.km_inicio && ptKm <= p.km_fin);

                    if (section && q > section.capacidad_diseno_m3s && section.capacidad_diseno_m3s > 0) {
                        toast.error(`Violación Hidráulica: Q=${q.toFixed(2)} m³/s EXCEDE capacidad de diseño (${section.capacidad_diseno_m3s.toFixed(2)} m³/s) en el KM ${ptKm}.`);
                        return;
                    }
                }
            } else if (activeTab === 'toma') {
                const numVal = parseFloat(val);
                const refPt = puntos.find(p => p.id === selectedPoint);

                if (isNaN(numVal) || (numVal <= 0 && ['inicio', 'reabierto', 'continua', 'modificacion'].includes(estadoToma))) {
                    toast.error('Lógica Falla: El gasto no puede ser 0 L/s para una toma activa. Si no hay flujo, reporta cierre.');
                    return;
                }

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

                    // --- BLOQUEOS FÍSICOS (HIDRO-SINCRONÍA) ---
                    if (activeEvent?.evento_tipo === 'LLENADO' && isActionOpening && refPt.km !== undefined) {
                        if (refPt.km > maxKmAlcanzado) {
                            toast.error(`BLOQUEO HIDRÁULICO: El agua (KM ${maxKmAlcanzado.toFixed(1)}) aún no pasa por esta toma (KM ${refPt.km.toFixed(1)}). Imposible abrir.`);
                            return;
                        }
                    }

                    if (isActionClosing && numVal !== 0) {
                        toast.error('Bloqueo: Para cerrar o suspender la toma, el gasto capturado debe ser 0 L/s.');
                        return;
                    }
                    if (!isActionClosing && numVal === 0) {
                        toast.error('Bloqueo: Para iniciar, modificar o continuar la toma, debe introducir un gasto mayor a 0 L/s.');
                        return;
                    }
                }

                payload.punto_id = selectedPoint;
                // Solo divide entre 1000 si NO es canal (el canal captura directo en m3/s)
                payload.valor_q = refPt?.type === 'canal' ? numVal : numVal / 1000;
                payload.estado_operativo = estadoToma;
            } else if (activeTab === 'presas') {
                const numVal = parseFloat(val);
                if (isNaN(numVal)) {
                    toast.error('Gasto inválido');
                    return;
                }
                payload.valor_q = numVal;
                // No mandatory state for presas, just the flow movement
            }

            // ---- VALIDACIÓN GEOGRÁFICA (GEOFENCING) ----
            // Si el punto tiene coordenadas, validar que el usuario esté cerca (ej. < 1km)
            const pt = puntos.find(p => p.id === selectedPoint);
            const ptName = pt?.name || (pt as any).nombre || 'punto';
            if (pt?.lat && pt?.lng) {
                try {
                    const pos: any = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
                    });
                    
                    const dist = getDistanceMeters(pos.coords.latitude, pos.coords.longitude, pt.lat, pt.lng);
                    
                    if (dist > 1000) { // 1km de radio permitido
                        if (isGerente || isAuthorized) {
                            const ok = window.confirm(`DISTANCIA EXCESIVA: Estás a ${(dist / 1000).toFixed(1)}km del punto ${ptName}.\n\n¿Deseas guardar de todas formas?`);
                            if (!ok) return;
                            payload.notas = (payload.notas || '') + ` [CAPTURA DISTANTE: ${(dist/1000).toFixed(1)}km]`;
                        } else {
                            setAuthReason(`USUARIO FUERA DE UBICACIÓN: Estás a ${(dist / 1000).toFixed(1)}km del punto ${ptName}. Se requiere autorización.`);
                            setPendingPayload(payload);
                            setShowAuthModal(true);
                            return;
                        }
                    }
                } catch (err) {
                    if (isGerente || isAuthorized) {
                        toast.warning(`No se pudo verificar GPS para ${ptName}, pero se permite captura por cuenta Gerencial.`);
                    } else {
                        setAuthReason(`ERROR GPS: Imposible verificar distancia a ${ptName}.`);
                        setPendingPayload(payload);
                        setShowAuthModal(true);
                        return;
                    }
                }
            }

            if (editingRecord) {
                await db.records.put(payload);
                toast.success('Corrección guardada con éxito');
            } else {
                await db.records.add(payload);
            }

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
                toast.promise(syncPendingRecords(), {
                    loading: '🚀 Sincronizando con Red Mayor...',
                    success: '✅ Registro actualizado en Tiempo Real',
                    error: '💾 Resguardado Localmente (Pendiente de Sync)'
                });
            }

            setShowSuccessAnim(true);
            setTimeout(() => setShowSuccessAnim(false), 1500);

            // Mantener los valores capturados como referencia visual para la siguiente lectura.
            // El operador ve el último registro y solo modifica lo que cambió.
            // - escalaData se mantiene (niveles y aperturas de escala)
            // - rawValue se mantiene para 'toma' (gasto en L/s queda como referencia)
            // - rawValue se resetea solo para 'presas' y 'escala' (irrelevante para escala)
            if (activeTab !== 'toma') setRawValue(0);
            setActiveGateIndex(0);
            setManualTime('');
            setManualDate(getTodayString());
            setEditingRecord(undefined);
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
                        title="Sincronizar Catálogos"
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
                            title="Ver registros pendientes de sincronizar"
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

            <StatusBanner />

            <div className="flex-1 flex flex-col p-3 pb-8">

                {/* 1. Selector de Tipo (Rediseñado Gerencial: Alto Contraste Solar) */}
                <div className="flex bg-slate-900/90 rounded-xl p-1 mb-4 flex-shrink-0 text-[10px] sm:text-xs shadow-inner ring-1 ring-slate-800">
                    {(['escala', 'toma', 'aforo', 'presas'] as const).map(tab => {
                        // MEJ-4: Ocultar o deshabilitar tabs no relevantes
                        const isRelevant = !(activeEvent?.evento_tipo === 'LLENADO' && tab === 'aforo');
                        if (!isRelevant) return null;

                        return (
                            <button
                                key={tab}
                                onClick={() => { setActiveTab(tab); setSelectedPoint(''); }}
                                className={`flex-1 py-3 px-1 rounded-lg font-black uppercase tracking-wider transition-all duration-300 ${activeTab === tab
                                    ? 'bg-mobile-accent text-slate-900 shadow-lg shadow-mobile-accent/30 scale-[1.02]'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                            >
                                {tab === 'escala' ? 'Niveles' : tab === 'toma' ? 'Distribución' : tab === 'aforo' ? 'Aforos' : 'Presas'}
                            </button>
                        );
                    })}
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
                            title="Selecciona el punto de control o entrega"
                            onChange={(e) => {
                                const newId = e.target.value;
                                setSelectedPoint(newId);
                                if (activeTab === 'escala') {
                                    const pt = puntos.find(p => p.id === newId);
                                    const lastLevelCm = pt?.nivel_actual ? Math.round(pt.nivel_actual * 100) : 0;
                                    const lastAbajoCm = pt?.nivel_abajo_m ? Math.round(pt.nivel_abajo_m * 100) : 0;
                                    const lastAperturasCm: number[] = Array(pt?.pzas_radiales || 0).fill(0);
                                    
                                    if (pt?.radiales_json && Array.isArray(pt.radiales_json)) {
                                        pt.radiales_json.forEach((rj: any) => {
                                            if (rj.index !== undefined && rj.apertura_m !== undefined) {
                                                lastAperturasCm[rj.index] = Math.round(rj.apertura_m * 100);
                                            }
                                        });
                                    }

                                    setEscalaData({
                                        arriba: lastLevelCm,
                                        abajo: lastAbajoCm,
                                        aperturas: lastAperturasCm
                                    });
                                    setEscalaField('arriba');
                                    setActiveGateIndex(0);
                                    setRawValue(lastLevelCm);
                                } else if (activeTab === 'toma') {
                                    const pt = puntos.find(p => p.id === newId);
                                    const openStates = ['inicio', 'continua', 'modificacion', 'reabierto'];
                                    const isPtOpen = openStates.includes(pt?.estado_hoy || '');
                                    
                                    if (pt && isPtOpen && pt.caudal_promedio) {
                                        const prevQ = Number(pt.caudal_promedio);
                                        if (pt.type === 'canal') {
                                            setRawValue(Math.round(prevQ));
                                        } else {
                                            setRawValue(Math.round(prevQ * 1000));
                                        }
                                        // Default to "continua" if it's already open
                                        setEstadoToma('continua');
                                    } else {
                                        setRawValue(0);
                                        setEstadoToma('inicio');
                                    }
                                } else {
                                    setRawValue(0);
                                }
                            }}
                        >
                            <option value="" disabled>-- Elige una Opción --</option>
                            {activeTab === 'aforo' ? (
                                puntos
                                    .filter(p => p.type === 'aforo')
                                    .sort((a, b) => {
                                        const parseKm = (name: string) => {
                                            if (!name) return 999;
                                            if (name.includes('DEL K-68')) return 68.110;
                                            const match = name.match(/K-(\d+)\+(\d+)/);
                                            return match ? parseInt(match[1], 10) + parseInt(match[2], 10) / 1000 : 999;
                                        };
                                        return parseKm(a.name || '') - parseKm(b.name || '');
                                    })
                                    .map(p => <option key={p.id} value={p.id}>🌊 {p.name}</option>)
                            ) : activeTab === 'escala' ? (
                                puntos
                                    .filter(p => p.type === 'escala')
                                    .sort((a, b) => (a.km || 0) - (b.km || 0))
                                    .map(p => <option key={p.id} value={p.id}>{p.name} (km {p.km?.toFixed(3)})</option>)
                            ) : activeTab === 'presas' ? (
                                puntos
                                    .filter(p => p.type === 'presa')
                                    .map(p => <option key={p.id} value={p.id}>🏔️ {p.name}</option>)
                            ) : (
                                puntos
                                    .filter(p => p.type !== 'escala' && p.type !== 'aforo' && p.type !== 'presa')
                                    .sort((a, b) => (a.km || 0) - (b.km || 0))
                                    .map(p => {
                                        const isOpened = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(p.estado_hoy || '');
                                        const icon = isOpened ? '🟢' : '🔴';
                                        
                                        // Bloqueo visual por Hidro-Sincronía
                                        const isBlocked = activeEvent?.evento_tipo === 'LLENADO' && (p.km || 0) > maxKmAlcanzado;
                                        
                                        const modSuffix = p.modulo ? ` [Mod: ${p.modulo}]` : '';

                                        return (
                                            <option key={p.id} value={p.id}>
                                                {icon} km {p.km?.toFixed(3)} - {p.name || (p as any).nombre || 'Sin Nombre'}{modSuffix} {isBlocked ? '(Bloqueado por Hidro-Sincronía)' : ''}
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

                {/* 2.1 Mini-Widget: Fecha y Hora de Reporte (Global) */}
                {(activeTab === 'escala' || activeTab === 'toma' || activeTab === 'presas' || activeTab === 'aforo') && (
                    <div className="mb-3 flex-shrink-0 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <button
                                onClick={() => {
                                    if (activeTab === 'escala') setShowEscalaHistoryModal(true);
                                    if (activeTab === 'toma') setShowTomaHistoryModal(true);
                                }}
                                className={`text-[9px] bg-slate-800 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1.5 font-bold ${(activeTab === 'presas') ? 'invisible' : ''}`}
                            >
                                <HistoryIcon size={14} /> VER HISTORIAL
                            </button>
                            <div className="flex items-center gap-2 bg-slate-900 ring-1 ring-slate-800 rounded-lg p-1">
                                <span className="text-slate-500 text-[9px] font-black uppercase px-2">Modo Manual</span>
                                <div className="flex bg-slate-800 rounded-md p-0.5">
                                     <button 
                                        className={`px-2 py-1 rounded text-[9px] font-bold ${(!manualTime && manualDate === getTodayString()) ? 'bg-mobile-accent text-slate-900 shadow-sm' : 'text-slate-500'}`}
                                        onClick={() => { setManualTime(''); setManualDate(getTodayString()); }}
                                    >AHORA</button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                                <label className="text-slate-500 text-[9px] font-black uppercase tracking-wider ml-1">Fecha de Captura:</label>
                                <input
                                    type="date"
                                    title="Fecha de Captura"
                                    aria-label="Fecha de Captura"
                                    value={manualDate}
                                    onChange={(e) => setManualDate(e.target.value)}
                                    max={getTodayString()}
                                    className="bg-slate-900 border border-slate-800 text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-mobile-accent focus:ring-1 focus:ring-mobile-accent/50 font-mono shadow-inner w-full"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-slate-500 text-[9px] font-black uppercase tracking-wider ml-1">Hora de Captura:</label>
                                <input
                                    type="time"
                                    title="Hora de Captura"
                                    aria-label="Hora de Captura"
                                    value={manualTime || getCurrentTimeStr24()}
                                    onChange={(e) => setManualTime(e.target.value)}
                                    className="bg-slate-900 border border-slate-800 text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-mobile-accent focus:ring-1 focus:ring-mobile-accent/50 font-mono shadow-inner w-full"
                                />
                            </div>
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

                {activeTab === 'escala' && selectedPoint && puntos.find(p => p.id === selectedPoint)?.escala_confirmada === false && (
                    <div className="mb-2 bg-amber-500/10 text-amber-500 p-2 rounded-lg border border-amber-500/30 flex items-center gap-2 animate-pulse flex-shrink-0">
                        <AlertTriangle size={16} className="flex-shrink-0" />
                        <span className="text-[10px] font-black uppercase tracking-wider">Confirmación de escala requerida - Ratificar nivel en campo</span>
                    </div>
                )}

                {/* BOTÓN MÁGICO DE ARRIBO (SINCRONÍA RÁPIDA CON CONCHOS DIGITAL) */}
                {/* REGLA: Solo mostrar si el punto NO ha sido confirmado aún (ni local ni remotamente) */}
                {activeTab === 'escala' && 
                 selectedPoint && 
                 activeEvent?.evento_tipo === 'LLENADO' && 
                 puntos.find(p => p.id === selectedPoint)?.escala_confirmada === false &&
                 !localArriboPending && (
                    <div className="mb-4">
                        <button
                            disabled={!activeEvent.hora_apertura_real}
                            onClick={async () => {
                                if (navigator.geolocation) {
                                    toast.loading("Obteniendo GPS para acta de arribo...");
                                    navigator.geolocation.getCurrentPosition(async (pos) => {
                                        toast.dismiss();
                                        // Crear registro 0 instantáneo de confirmación
                                        const now = new Date();
                                        try {
                                            const payload: SicaRecord = {
                                                id: uuidv4(),
                                                tipo: 'escala',
                                                punto_id: selectedPoint,
                                                fecha_captura: getTodayString(),
                                                hora_captura: now.toLocaleTimeString('en-US', { hour12: false }),
                                                sincronizado: 'false',
                                                confirmada: true,
                                                responsable_id: profile?.id,
                                                responsable_nombre: profile?.nombre || 'Operador',
                                                valor_q: 0.01, // Trace level (1cm) to satisfy DB constraints and show water presence
                                                nivel_abajo_m: 0,
                                                apertura_radiales_m: 0,
                                                notas: `📌 ARRIBO VISUAL CONFIRMADO. Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(5)}`
                                            };
                                            await db.records.add(payload);
                                            toast.success("✅ Arribo notificado a Gerencia exitosamente");
                                            if (navigator.onLine) syncPendingRecords();
                                        } catch (e) {
                                            toast.error("Error al registrar el arribo");
                                        }
                                    }, () => toast.error("Por favor activa el GPS de tu equipo"));
                                } else {
                                    toast.error("Tu dispositivo no soporta GPS");
                                }
                            }}
                            className={`w-full p-4 rounded-xl flex items-center justify-center gap-3 font-black uppercase tracking-widest border transition-all transform active:scale-95 ${
                                activeEvent.hora_apertura_real 
                                ? "bg-blue-600 active:bg-blue-700 text-white shadow-[0_4px_20px_rgba(37,99,235,0.4)] border-blue-400/50" 
                                : "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-70"
                            }`}
                        >
                            <span className="text-2xl drop-shadow-md">{activeEvent.hora_apertura_real ? "🌊" : "🔒"}</span> 
                            <span>{activeEvent.hora_apertura_real ? "¡Confirmar LLEGADA del Agua!" : "Esperando Apertura de Presa"}</span>
                        </button>
                        <p className="text-[9px] text-blue-400 mt-2 text-center italic tracking-wider">
                            {activeEvent.hora_apertura_real 
                            ? "Esto enviará tu GPS a Conchos Digital en tiempo real." 
                            : "La Gerencia de la SRL aún no confirma la apertura física de la obra de toma."}
                        </p>
                    </div>
                )}

                {/* 2.5 Selector de Estado (Solo Tomas) */}
                {activeTab === 'toma' && (
                    <div className="mb-4 flex-shrink-0">
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-slate-400 text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
                                Acción Operativa
                                <button
                                    onClick={() => {
                                        if (selectedPoint) setShowTomaHistoryModal(true);
                                        else toast.error('Selecciona una toma primero');
                                    }}
                                    className="bg-slate-800 text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-400"
                                >
                                    Bitácora
                                </button>
                            </label>
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
                            manualDate={manualDate}
                            manualTime={manualTime}
                            onSaveSuccess={() => {
                                setRawValue(0);
                                setManualTime('');
                                setManualDate(getTodayString());
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
                        {activeTab === 'escala' ? (
                            <div className="flex bg-slate-800 rounded-lg p-1 mb-2">
                                {(
                                    [
                                        { id: 'arriba', title: 'Nivel Arriba' },
                                        { id: 'abajo', title: 'Nivel Abajo' },
                                        { id: 'apertura', title: 'Apertura Radial' }
                                    ] as const
                                ).map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => setEscalaField(f.id)}
                                        className={`flex-1 py-2 px-1 rounded-md text-[10px] font-bold uppercase transition-all flex flex-col items-center ${escalaField === f.id
                                            ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                            : 'bg-transparent text-slate-400 hover:bg-slate-700/50'
                                            }`}
                                    >
                                        <span>{f.title}</span>
                                        <span className="text-sm font-mono mt-0.5">
                                            {f.id === 'apertura'
                                                ? ((escalaData.aperturas[activeGateIndex] || 0) / 100).toFixed(2)
                                                : (escalaData[f.id as 'arriba' | 'abajo'] / 100).toFixed(2)}m
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="text-right text-slate-400 text-xs font-semibold mb-1 flex-shrink-0">
                                Captura de Gasto (L/s)
                            </div>
                        )}
                        <div className="flex flex-col items-end flex-shrink-0">
                            {selectedPoint && (
                                <span className="text-[8px] sm:text-[10px] text-mobile-accent bg-mobile-accent/10 px-2 py-0.5 rounded uppercase font-black tracking-widest border border-mobile-accent/30 mb-1">
                                    REFERENCIA ÚLTIMA
                                </span>
                            )}
                            <div className="text-right text-5xl sm:text-6xl font-mono font-bold text-white mb-1 tracking-tighter truncate w-full">
                                {val}
                            </div>
                        </div>
                        {activeTab === 'escala' && (() => {
                            const pt = puntos.find(p => p.id === selectedPoint);
                            const hArriba = escalaData.arriba / 100;
                            const realAps = (escalaData.aperturas || []).map(a => a / 100);

                            let q = 0;
                            let hasRadialesOpen = false;

                            if (pt?.pzas_radiales && pt?.ancho_radiales && realAps.length > 0) {
                                const Cd = 0.6;
                                const hAbajo = escalaData.abajo / 100;
                                const carga = Math.max(0, hArriba - hAbajo);

                                for (let i = 0; i < pt.pzas_radiales; i++) {
                                    const ap = realAps[i] || 0;
                                    if (ap > 0 && carga > 0.01) {
                                        hasRadialesOpen = true;
                                        if (ap < hArriba) {
                                            q += Cd * (pt.ancho_radiales * ap) * Math.sqrt(2 * 9.81 * carga);
                                        } else {
                                            q += 1.84 * pt.ancho_radiales * Math.pow(carga, 1.5);
                                        }
                                    }
                                }
                            } else if (!pt?.pzas_radiales && hArriba > 0) {
                                q = 1.84 * Math.pow(hArriba, 1.52);
                            }

                            return (
                                <>
                                    {pt?.pzas_radiales !== undefined && pt.pzas_radiales > 0 && escalaField === 'apertura' && (
                                        <div className="-mx-2 z-20 relative">
                                            <RepresoSchema
                                                pzasRadiales={pt.pzas_radiales}
                                                anchoRadial={pt.ancho_radiales || 0}
                                                altoRadial={pt.alto_radiales || 2}
                                                aperturas={realAps}
                                                nivelArriba={hArriba}
                                                activeGateIndex={activeGateIndex}
                                                onGateSelect={(idx) => setActiveGateIndex(idx)}
                                            />
                                        </div>
                                    )}

                                    <div className="text-right text-mobile-accent font-mono font-bold text-lg mb-4 flex-shrink-0 bg-slate-900/50 rounded p-1">
                                        <span className="text-slate-500 text-xs mr-2">
                                            {pt?.pzas_radiales && hasRadialesOpen ? 'Gasto Sumado (Radiales):' : 'Gasto Calculado:'}
                                        </span>
                                        {q.toFixed(3)} m³/s
                                    </div>
                                </>
                            );
                        })()}
                        {activeTab === 'toma' && <div className="mb-4"></div>}

                        {/* Guardar Button Movido Arriba del Numpad para Accesibilidad (Alto Contraste UI) */}
                        <div className="mb-6 flex-shrink-0 relative">
                            {showSuccessAnim && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center glow-btn-success rounded-xl animate-in zoom-in spin-in-12 duration-300">
                                    <svg className="w-10 h-10 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}
                            <button
                                className={`w-full text-lg sm:text-xl h-14 rounded-xl flex items-center justify-center gap-2 font-black tracking-widest transition-all outline-none ${editingRecord ? 'bg-mobile-accent text-white shadow-[0_4px_14px_0_rgba(6,182,212,0.39)]' : 'bg-mobile-warning text-slate-900 shadow-[0_4px_14px_0_rgba(245,158,11,0.39)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.6)]'}`}
                                onClick={() => handleSave()}
                            >
                                <Save size={24} className="drop-shadow-sm" /> {editingRecord ? 'APLICAR CORRECCIÓN' : 'GUARDAR CAPTURA'}
                            </button>
                            {editingRecord && (
                                <button
                                    onClick={() => {
                                        setEditingRecord(undefined);
                                        setRawValue(0);
                                        setEscalaData({ arriba: 0, abajo: 0, aperturas: [] });
                                        toast.info('Edición cancelada');
                                    }}
                                    className="w-full mt-2 text-[10px] text-red-400 font-bold uppercase underline"
                                >
                                    Cancelar Corrección
                                </button>
                            )}
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

            {showEscalaHistoryModal && (
                <EscalaHistoryModal
                    onClose={() => setShowEscalaHistoryModal(false)}
                    onEditRecord={(record: SicaRecord) => {
                        const pt = puntos.find(p => p.id === record.punto_id);
                        const pzas = pt?.pzas_radiales || (record.radiales_json || []).length || 0;
                        
                        // Reconstruir el arreglo de aperturas con la longitud correcta
                        const fullAps = Array(pzas).fill(0);
                        (record.radiales_json || []).forEach((r: any) => {
                            if (r.index !== undefined && r.index < pzas) {
                                fullAps[r.index] = Math.round(r.apertura_m * 100);
                            }
                        });

                        setEditingRecord(record);
                        setSelectedPoint(record.punto_id);
                        setEscalaData({
                            arriba: Math.round((record.valor_q || 0) * 100),
                            abajo: Math.round((record.nivel_abajo_m || 0) * 100),
                            aperturas: fullAps
                        });
                        setManualTime(record.hora_captura.substring(0, 5));
                        setShowEscalaHistoryModal(false);
                        toast.success('Corrigiendo nivel...');
                    }}
                />
            )}

            {showTomaHistoryModal && (
                <TomaHistoryModal
                    isOpen={showTomaHistoryModal}
                    onClose={() => setShowTomaHistoryModal(false)}
                    punto={puntos.find(p => p.id === selectedPoint) || null}
                    onEditRecord={(record: SicaRecord) => {
                        setEditingRecord(record);
                        setEstadoToma(record.estado_operativo as any);
                        const pt = puntos.find(p => p.id === selectedPoint);
                        if (pt?.type === 'canal') {
                            setRawValue(Math.round(record.valor_q || 0));
                        } else {
                            setRawValue(Math.round((record.valor_q || 0) * 1000));
                        }
                        setManualTime(record.hora_captura.substring(0, 5));
                        toast.success('Corrigiendo gasto...');
                    }}
                />
            )}

            {showAuthModal && (
                <ManagerAuthModal
                    reason={authReason}
                    onClose={() => {
                        setShowAuthModal(false);
                        setPendingPayload(null);
                    }}
                    onSuccess={() => {
                        setShowAuthModal(false);
                        if (pendingPayload) {
                            // Enviar con bandera isAuthorized=true
                            handleSave(true);
                            setPendingPayload(null);
                        }
                    }}
                />
            )}

            {/* Version Footer & Force Update */}
            <div className="fixed bottom-1 left-3 flex items-center gap-3 opacity-30 hover:opacity-100 transition-opacity z-10">
                <span className="text-[9px] font-bold text-slate-500 tracking-tighter">SICA v2.4.8</span>
                <button 
                    onClick={() => {
                        window.location.replace('/?v=248&t=' + Date.now());
                    }}
                    className="text-[9px] font-bold text-cyan-500 uppercase cursor-pointer hover:underline"
                >
                    Actualizar Ahora
                </button>
            </div>
        </div>
    );
};

export default Capture;
