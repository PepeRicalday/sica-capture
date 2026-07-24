import { useState, useEffect } from 'react';
import {
    Save, Wifi, WifiOff, UploadCloud, ChevronDown, RefreshCw,
    AlertTriangle, History as HistoryIcon
} from 'lucide-react';
import { db, type SicaRecord, type SicaAforoRecord } from '../lib/db';
import { syncPendingRecords, downloadCatalogs } from '../lib/sync';
import { getTodayString } from '../lib/dateHelpers';
import { calculateFlow, validateGateAperture, getFactorCorreccion, calcGastoCurvaNivel } from '../lib/hydraulicCalculations';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { AforoForm } from '../components/AforoForm';
import { EntregaForm } from '../components/EntregaForm';
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
    const dateStr = time.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' }).replace('.', '').toUpperCase();
    const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });
    return (
        <span className="text-mobile-accent font-mono text-[10px] font-semibold tracking-wider mt-0.5">
            {dateStr} • {timeStr}
        </span>
    );
};

const Capture = () => {
    const { profile } = useAuth();
    // Formularios Dinámicos
    const [activeTab, setActiveTab] = useState<'escala' | 'toma' | 'aforo' | 'presas' | 'entrega'>('escala');
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
    // Método de gasto elegido por el operador cuando el punto tiene curva nivel-gasto.
    // 'compuertas' = fórmula radial M1 · 'curva' = rating curve Q=C·h^n.
    const [metodoGasto, setMetodoGasto] = useState<'compuertas' | 'curva'>('compuertas');
    // Desglose de obras de toma para presas — mismo patrón "cajero automático" que
    // escalaData/escalaField: cada obra guarda su gasto en centésimas de m³/s.
    const [presaField, setPresaField] = useState<'tomaBaja' | 'cfe' | 'tomaIzq' | 'tomaDer'>('tomaBaja');
    const [presaData, setPresaData] = useState<{ tomaBaja: number; cfe: number; tomaIzq: number; tomaDer: number }>({ tomaBaja: 0, cfe: 0, tomaIzq: 0, tomaDer: 0 });
    // Posición de compuerta por obra de toma — solo trazabilidad (ej. "1/10"), no
    // hay curva calibrada posición→gasto para obras de toma como sí existe para
    // compuertas radiales de canal. El gasto real sigue viniendo de presaData.
    const [presaPosicion, setPresaPosicion] = useState<{ tomaBaja: string; cfe: string; tomaIzq: string; tomaDer: string }>({ tomaBaja: '', cfe: '', tomaIzq: '', tomaDer: '' });
    // Sub-modo de la pestaña "presas": gasto por obra de toma, o nivel del embalse.
    const [presaModo, setPresaModo] = useState<'obras' | 'nivel'>('obras');
    // Nivel de embalse: elevación en centésimas de metro (msnm) y % de llenado en centésimas.
    const [nivelData, setNivelData] = useState<{ elevacion: number; porcentaje: number }>({ elevacion: 0, porcentaje: 0 });
    const [nivelField, setNivelField] = useState<'elevacion' | 'porcentaje'>('elevacion');

    // val: valor formateado para el display principal
    // - toma:   entero L/s  (rawValue directo)
    // - presas (obras): m³/s con 2 decimales, por obra de toma activa (presaField)
    // - presas (nivel): msnm o % con 2 decimales, por campo activo (nivelField)
    // - escala: metros con 2 decimales (rawValue / 100)
    const val = activeTab === 'toma'
        ? rawValue.toString()
        : activeTab === 'presas'
            ? (presaModo === 'nivel' ? (nivelData[nivelField] / 100).toFixed(2) : (presaData[presaField] / 100).toFixed(2))
            : activeTab === 'escala'
                ? (escalaField === 'apertura' ? ((escalaData.aperturas[activeGateIndex] || 0) / 100).toFixed(2) : (escalaData[escalaField] / 100).toFixed(2))
                : '0.00';

    // Hydric Status
    const { activeEvent, maxKmAlcanzado } = useHydricStatus();

    // Selectores Offline — punto seleccionado independiente por tab
    const [selectedPoints, setSelectedPoints] = useState<Record<string, string>>({
        escala: '', toma: '', aforo: '', presas: ''
    });
    const selectedPoint = selectedPoints[activeTab] || '';
    const setSelectedPoint = (id: string) => {
        setSelectedPoints(prev => ({ ...prev, [activeTab]: id }));
        setMetodoGasto('compuertas'); // cada punto arranca en compuertas; el operador cambia a curva si aplica
    };
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

    // Rehidratar display al volver a un tab con punto ya seleccionado.
    // Sin esto, al cambiar de toma→escala→toma el rawValue queda en 0
    // aunque selectedPoint siga apuntando al punto correcto.
    useEffect(() => {
        if (!selectedPoint || puntos.length === 0) return;
        const pt = puntos.find(p => p.id === selectedPoint);
        if (!pt) return;

        if (activeTab === 'escala') {
            const lastLevelCm = pt.nivel_actual ? Math.round(pt.nivel_actual * 100) : 0;
            const lastAbajoCm = pt.nivel_abajo_m ? Math.round(pt.nivel_abajo_m * 100) : 0;
            const lastAperturasCm: number[] = Array(pt.pzas_radiales || 0).fill(0);
            if (pt.radiales_json && Array.isArray(pt.radiales_json)) {
                pt.radiales_json.forEach((rj: any) => {
                    if (rj.index !== undefined && rj.apertura_m !== undefined) {
                        lastAperturasCm[rj.index] = Math.round(rj.apertura_m * 100);
                    }
                });
            }
            setEscalaData({ arriba: lastLevelCm, abajo: lastAbajoCm, aperturas: lastAperturasCm });
            setEscalaField('arriba');
            setActiveGateIndex(0);
            setRawValue(lastLevelCm);
        } else if (activeTab === 'toma') {
            const openStates = ['inicio', 'continua', 'modificacion', 'reabierto'];
            const isPtOpen = openStates.includes(pt.estado_hoy || '');
            if (isPtOpen) {
                const prevQ = Number(pt.caudal_promedio || 0);
                setRawValue(prevQ > 0
                    ? (pt.type === 'canal' ? Math.round(prevQ) : Math.round(prevQ * 1000))
                    : 0
                );
                setEstadoToma('modificacion');
            } else {
                setRawValue(0);
                setEstadoToma('inicio');
            }
        } else {
            setRawValue(0);
        }
    // Solo se dispara cuando cambia de tab (activeTab), no en cada keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const getCurrentTimeStr24 = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });

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
        } else if (activeTab === 'presas' && presaModo === 'nivel') {
            setNivelData(prev => {
                const prevVal = prev[nivelField];
                const next = prevVal * 10 + num;
                return { ...prev, [nivelField]: next > 999999 ? prevVal : next };
            });
        } else if (activeTab === 'presas') {
            setPresaData(prev => {
                const prevVal = prev[presaField];
                const next = prevVal * 10 + num;
                return { ...prev, [presaField]: next > 999999 ? prevVal : next };
            });
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
        } else if (activeTab === 'presas' && presaModo === 'nivel') {
            setNivelData(prev => ({ ...prev, [nivelField]: 0 }));
        } else if (activeTab === 'presas') {
            setPresaData(prev => ({ ...prev, [presaField]: 0 }));
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
        } else if (activeTab === 'presas' && presaModo === 'nivel') {
            setNivelData(prev => ({ ...prev, [nivelField]: Math.floor(prev[nivelField] / 10) }));
        } else if (activeTab === 'presas') {
            setPresaData(prev => ({ ...prev, [presaField]: Math.floor(prev[presaField] / 10) }));
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

                const realAperturasStr: any[] = [];
                let maxAperturaStr = 0;

                // Validar alturas físicas de compuertas antes de calcular
                const maxAltoCompuerta = pt?.alto_radiales || 4.0;
                if (pt?.pzas_radiales && escalaData.aperturas?.length > 0) {
                    for (let i = 0; i < pt.pzas_radiales; i++) {
                        const ap = (escalaData.aperturas[i] || 0) / 100;
                        const err = validateGateAperture(ap, maxAltoCompuerta, i);
                        if (err) { toast.error(`Bloqueo: ${err}`); return; }
                        realAperturasStr.push({ index: i, apertura_m: ap });
                        if (ap > maxAperturaStr) maxAperturaStr = ap;
                    }
                }

                const aperturas_m = (pt?.pzas_radiales ? Array.from({ length: pt.pzas_radiales }, (_, i) =>
                    (escalaData.aperturas[i] || 0) / 100
                ) : []);

                const { q_total: q } = calculateFlow({
                    hArriba,
                    hAbajo,
                    pzasRadiales: pt?.pzas_radiales,
                    anchoRadial: pt?.ancho_radiales,
                    altoRadial: maxAltoCompuerta,
                    aperturas: aperturas_m,
                    factorCorreccion: getFactorCorreccion(pt?.name, pt?.km),
                    esGargantaLarga: !pt?.pzas_radiales && !!(pt?.ancho_radiales && pt.ancho_radiales > 0),
                    nombre: pt?.name,
                });

                // Gasto a reportar: si el punto tiene curva nivel-gasto y el operador
                // eligió 'curva', se guarda ese valor (robusto ante compuertas taponadas);
                // si no, el de compuertas. El método elegido queda registrado para auditoría.
                const curvaSave = calcGastoCurvaNivel(pt?.name, hAbajo);
                const usarCurva = curvaSave !== null && metodoGasto === 'curva';
                const qReporte = usarCurva ? curvaSave!.q : q;

                payload.punto_id = selectedPoint;
                payload.valor_q = hArriba; // nivel principal (arriba)
                payload.nivel_abajo_m = hAbajo;
                payload.apertura_radiales_m = maxAperturaStr; // Guardamos la máxima como numérico legacy
                payload.radiales_json = realAperturasStr; // JSON Guardamos para ver cada una al renderizar
                payload.gasto_calculado_m3s = qReporte;
                payload.gasto_metodo = usarCurva ? 'curva_nivel' : 'compuertas_m1';

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

                if (isNaN(numVal) || (numVal <= 0 && ['inicio', 'reabierto', 'modificacion'].includes(estadoToma))) {
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
                    const isActionRequiresOpen = ['modificacion', 'continua', 'suspension', 'cierre'].includes(estadoToma);

                    if (isPtOpen && isActionOpening) {
                        toast.error('La toma ya está abierta. Solo puedes modificarla, continuarla o cerrarla.');
                        return;
                    }
                    if (!isPtOpen && isActionRequiresOpen) {
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
            } else if (activeTab === 'presas' && presaModo === 'nivel') {
                const elevacion = nivelData.elevacion / 100;
                const porcentaje = nivelData.porcentaje / 100;

                if (isNaN(elevacion) || elevacion <= 0) {
                    toast.error('Elevación inválida. Debe ser mayor a 0 msnm.');
                    return;
                }
                if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
                    toast.error('% de llenado inválido. Debe estar entre 0 y 100.');
                    return;
                }

                const ptPresa = puntos.find(p => p.id === selectedPoint);
                payload.presa_subtipo = 'nivel';
                payload.escala_msnm = elevacion;
                payload.porcentaje_llenado = porcentaje;
                // Derivado, no capturado directo: % × capacidad máxima de la presa.
                if (ptPresa?.capacidad_max_mm3) {
                    payload.almacenamiento_mm3 = (porcentaje / 100) * ptPresa.capacidad_max_mm3;
                }
            } else if (activeTab === 'presas') {
                const tomaBaja = presaData.tomaBaja / 100;
                const cfe = presaData.cfe / 100;
                const tomaIzq = presaData.tomaIzq / 100;
                const tomaDer = presaData.tomaDer / 100;
                const total = tomaBaja + cfe + tomaIzq + tomaDer;

                if ([tomaBaja, cfe, tomaIzq, tomaDer].some(v => isNaN(v) || v < 0)) {
                    toast.error('Gasto inválido en alguna obra de toma.');
                    return;
                }
                if (total === 0) {
                    toast.error('El gasto total no puede ser 0. Captura al menos una obra de toma.');
                    return;
                }

                payload.presa_subtipo = 'obras';
                payload.valor_q = total; // total — sync lo sube a movimientos_presas.gasto_m3s
                payload.gasto_toma_baja_m3s = tomaBaja;
                payload.gasto_cfe_m3s = cfe;
                payload.gasto_toma_izq_m3s = tomaIzq;
                payload.gasto_toma_der_m3s = tomaDer;

                const posicionesLlenas = Object.fromEntries(
                    Object.entries(presaPosicion).filter(([, v]) => v.trim() !== '')
                );
                if (Object.keys(posicionesLlenas).length > 0) {
                    payload.posiciones_compuerta = posicionesLlenas;
                }
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
            // También actualiza caudal_promedio para que autoGenerateContinua use el gasto correcto
            // incluso si la sincronización ocurre antes de que descarguen los catálogos remotos.
            if (activeTab === 'toma' && selectedPoint) {
                const pt = await db.puntos.get(selectedPoint);
                if (pt) {
                    const optimisticUpdate: Partial<typeof pt> = { estado_hoy: estadoToma };
                    // Para estados activos que registran un gasto real, actualizar caudal_promedio
                    if (['inicio', 'reabierto', 'modificacion'].includes(estadoToma) && payload.valor_q) {
                        optimisticUpdate.caudal_promedio = payload.valor_q; // ya en m³/s
                    }
                    // Para cierre/suspensión, limpiar el caudal
                    if (['cierre', 'suspension'].includes(estadoToma)) {
                        optimisticUpdate.caudal_promedio = 0;
                    }
                    await db.puntos.update(selectedPoint, optimisticUpdate);
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
            if (activeTab === 'presas') {
                setPresaData({ tomaBaja: 0, cfe: 0, tomaIzq: 0, tomaDer: 0 });
                setPresaPosicion({ tomaBaja: '', cfe: '', tomaIzq: '', tomaDer: '' });
                // nivelData se mantiene como referencia (misma lógica que escalaData):
                // el operador ve la última elevación capturada al reabrir el formulario.
            }
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
                    {(['escala', 'toma', 'aforo', 'presas', 'entrega'] as const).map(tab => {
                        // MEJ-4: Ocultar o deshabilitar tabs no relevantes
                        const isRelevant = !(activeEvent?.evento_tipo === 'LLENADO' && tab === 'aforo');
                        if (!isRelevant) return null;

                        const labels: Record<string, string> = {
                            escala: 'Niveles', toma: 'Distribución',
                            aforo: 'Aforos', presas: 'Presas', entrega: 'Entrega'
                        };
                        return (
                            <button
                                key={tab}
                                onClick={() => { setActiveTab(tab); setRawValue(0); setEscalaData({ arriba: 0, abajo: 0, aperturas: [] }); setMetodoGasto('compuertas'); }}
                                className={`flex-1 py-3 px-1 rounded-lg font-black uppercase tracking-wider transition-all duration-300 ${activeTab === tab
                                    ? 'bg-mobile-accent text-slate-900 shadow-lg shadow-mobile-accent/30 scale-[1.02]'
                                    : 'text-slate-500 hover:text-slate-300'
                                    }`}
                            >
                                {labels[tab]}
                            </button>
                        );
                    })}
                </div>

                {/* SI ES ENTREGA -> RENDERIZAR COMPONENTE PROPIO Y SALTAR EL RESTO */}
                {activeTab === 'entrega' && (
                    <div className="flex-1 overflow-y-auto mt-1 pr-0.5">
                        <EntregaForm onSaved={() => { if (navigator.onLine) syncPendingRecords(); }} />
                    </div>
                )}

                {/* 2. Selector de Punto (no aplica a tab entrega) */}
                <div className={`mb-2 relative flex-shrink-0 ${activeTab === 'entrega' ? 'hidden' : ''}`}>
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

                                    if (pt && isPtOpen) {
                                        // Toma abierta: pre-llenar con último gasto para referencia
                                        const prevQ = Number(pt.caudal_promedio || 0);
                                        if (prevQ > 0) {
                                            setRawValue(pt.type === 'canal' ? Math.round(prevQ) : Math.round(prevQ * 1000));
                                        } else {
                                            setRawValue(0);
                                        }
                                        // Default a modificacion — continua es automática vía sync
                                        setEstadoToma('modificacion');
                                    } else {
                                        setRawValue(0);
                                        setEstadoToma('inicio');
                                    }
                                } else if (activeTab === 'presas') {
                                    const pt = puntos.find(p => p.id === newId);
                                    setPresaData({ tomaBaja: 0, cfe: 0, tomaIzq: 0, tomaDer: 0 });
                                    setPresaPosicion({ tomaBaja: '', cfe: '', tomaIzq: '', tomaDer: '' });
                                    setNivelData({
                                        elevacion: pt?.nivel_actual ? Math.round(pt.nivel_actual * 100) : 0,
                                        porcentaje: pt?.porcentaje_llenado_actual ? Math.round(pt.porcentaje_llenado_actual * 100) : 0,
                                    });
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

                                        const modSuffix = p.modulo ? ` [${p.modulo}]` : '';

                                        // Badge: gasto actual en L/s
                                        const caudalLps = isOpened && p.caudal_promedio && p.caudal_promedio > 0
                                            ? ` · ${Math.round(p.caudal_promedio * 1000)} L/s`
                                            : '';

                                        // Badge: días abierta desde hora_apertura
                                        let diasBadge = '';
                                        if (isOpened && p.hora_apertura) {
                                            const apertura = new Date(p.hora_apertura);
                                            const diffMs = Date.now() - apertura.getTime();
                                            const dias = Math.floor(diffMs / 86400000);
                                            diasBadge = dias >= 1 ? ` · ${dias}d` : '';
                                        }

                                        return (
                                            <option key={p.id} value={p.id}>
                                                {icon} km {p.km?.toFixed(3)} - {p.name || (p as any).nombre || 'Sin Nombre'}{modSuffix}{caudalLps}{diasBadge}{isBlocked ? ' ⚠ Bloqueado' : ''}
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

                {/* 1.5 Sub-modo de Presas: Obras de Toma vs Nivel de Embalse */}
                {activeTab === 'presas' && (
                    <div className="flex bg-slate-900 rounded-lg p-1 mb-3 flex-shrink-0 ring-1 ring-slate-800">
                        {(
                            [
                                { id: 'obras', title: '💧 Obras de Toma' },
                                { id: 'nivel', title: '🏔️ Nivel de Embalse' },
                            ] as const
                        ).map(m => (
                            <button
                                key={m.id}
                                onClick={() => setPresaModo(m.id)}
                                className={`flex-1 py-2 rounded-md text-[10px] font-bold uppercase transition-all ${presaModo === m.id
                                    ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                    : 'bg-transparent text-slate-400 hover:bg-slate-700/50'
                                    }`}
                            >
                                {m.title}
                            </button>
                        ))}
                    </div>
                )}

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

                {/* 2.2 Mini-Widget: Volumen Acumulado de la Zona + Estado de Toma Seleccionada */}
                {activeTab === 'toma' && selectedPoint && (() => {
                    const currentPt = puntos.find(p => p.id === selectedPoint);
                    const isOpened = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(currentPt?.estado_hoy || '');
                    const caudalLps = currentPt?.caudal_promedio ? Math.round(currentPt.caudal_promedio * 1000) : 0;
                    const diasAbierta = (() => {
                        if (!isOpened || !currentPt?.hora_apertura) return 0;
                        return Math.floor((Date.now() - new Date(currentPt.hora_apertura).getTime()) / 86400000);
                    })();
                    const volCatalogo = currentPt?.seccion_id
                        ? puntos.filter(p => p.seccion_id === currentPt.seccion_id).reduce((acc, p) => acc + (p.volumen_hoy_m3 || 0), 0)
                        : 0;

                    return (
                        <div className="mb-2 flex flex-col gap-1.5">
                            {/* Fila superior: estado de la toma seleccionada */}
                            {isOpened ? (
                                <div className="glass-pill px-3 py-2 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0"></span>
                                        <div className="flex flex-col">
                                            <span className="text-green-400 text-[9px] font-black uppercase tracking-widest">Toma Abierta</span>
                                            <span className="text-white font-mono font-bold text-sm">{caudalLps > 0 ? `${caudalLps} L/s` : '— L/s'}</span>
                                        </div>
                                    </div>
                                    {diasAbierta >= 1 && (
                                        <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded-lg font-bold border border-cyan-500/30 font-mono">
                                            {diasAbierta}d abierta
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <div className="glass-pill px-3 py-2 rounded-xl flex items-center gap-2">
                                    <span className="inline-block w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></span>
                                    <span className="text-red-400 text-[9px] font-black uppercase tracking-widest">Toma Cerrada</span>
                                </div>
                            )}
                            {/* Fila inferior: volumen de sección */}
                            <div className="glass-pill p-1.5 px-3 rounded-lg flex items-center justify-between">
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                    Vol. Hoy · {currentPt?.seccion || 'Zona General'}
                                </span>
                                <span className="text-white text-xs font-bold font-mono">
                                    {(volCatalogo / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} Mm³
                                </span>
                            </div>
                        </div>
                    );
                })()}

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
                                                hora_captura: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Chihuahua' }),
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
                            {(['inicio', 'modificacion', 'suspension', 'reabierto', 'cierre'] as const).map(estado => {
                                const refPt = puntos.find(p => p.id === selectedPoint);
                                const ptStatus = refPt?.estado_hoy || 'cerrado';
                                const isPtOpen = ['inicio', 'reabierto', 'continua', 'modificacion'].includes(ptStatus);

                                const isValidForOpen = ['modificacion', 'suspension', 'cierre'].includes(estado);
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
                                        {estado === 'modificacion' ? 'Modif.' : estado}
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
                            onPointDetected={(puntoId, _nombre) => {
                                // Seleccionar automáticamente el punto detectado en la imagen
                                setSelectedPoints(prev => ({ ...prev, aforo: puntoId }));
                            }}
                            onDateDetected={(fecha) => {
                                // Ajustar la fecha de captura al día señalado en el formato
                                setManualDate(fecha);
                            }}
                        />
                    </div>
                )}

                {/* 3. Main Display Numérico (SOLO SI NO ES AFORO NI ENTREGA) */}
                {activeTab !== 'aforo' && activeTab !== 'entrega' && (
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
                                        {/* Apertura total acumulada (Σ todas las compuertas) */}
                                        {f.id === 'apertura' && (() => {
                                            const totalAp = (escalaData.aperturas || []).reduce((s, a) => s + a, 0) / 100;
                                            const abiertas = (escalaData.aperturas || []).filter(a => a > 0).length;
                                            const pt2 = puntos.find(p => p.id === selectedPoint);
                                            if (!pt2?.pzas_radiales || totalAp <= 0) return null;
                                            return (
                                                <span className={`text-[9px] font-mono mt-0.5 opacity-90 ${escalaField === 'apertura' ? 'text-mobile-dark' : 'text-mobile-accent'}`}>
                                                    Σ {totalAp.toFixed(2)}m · {abiertas}/{pt2.pzas_radiales}
                                                </span>
                                            );
                                        })()}
                                    </button>
                                ))}
                            </div>
                        ) : activeTab === 'presas' && presaModo === 'nivel' ? (
                            <div className="flex bg-slate-800 rounded-lg p-1 mb-2">
                                {(
                                    [
                                        { id: 'elevacion', title: 'Elevación (msnm)' },
                                        { id: 'porcentaje', title: '% Llenado' },
                                    ] as const
                                ).map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => setNivelField(f.id)}
                                        className={`flex-1 py-2 px-1 rounded-md text-[10px] font-bold uppercase transition-all flex flex-col items-center ${nivelField === f.id
                                            ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                            : 'bg-transparent text-slate-400 hover:bg-slate-700/50'
                                            }`}
                                    >
                                        <span>{f.title}</span>
                                        <span className="text-sm font-mono mt-0.5">
                                            {(nivelData[f.id] / 100).toFixed(2)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : activeTab === 'presas' ? (
                            <div className="flex bg-slate-800 rounded-lg p-1 mb-2">
                                {(
                                    [
                                        { id: 'tomaBaja', title: 'Toma Baja' },
                                        { id: 'cfe', title: 'CFE' },
                                        { id: 'tomaIzq', title: 'Toma Izq.' },
                                        { id: 'tomaDer', title: 'Toma Der.' },
                                    ] as const
                                ).map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => setPresaField(f.id)}
                                        className={`flex-1 py-2 px-1 rounded-md text-[10px] font-bold uppercase transition-all flex flex-col items-center ${presaField === f.id
                                            ? 'bg-mobile-accent text-mobile-dark shadow-lg scale-105'
                                            : 'bg-transparent text-slate-400 hover:bg-slate-700/50'
                                            }`}
                                    >
                                        <span>{f.title}</span>
                                        <span className="text-sm font-mono mt-0.5">
                                            {(presaData[f.id] / 100).toFixed(2)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="text-right text-slate-400 text-xs font-semibold mb-1 flex-shrink-0">
                                {'Captura de Gasto (L/s)'}
                            </div>
                        )}
                        {activeTab === 'presas' && presaModo === 'obras' && (
                            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                                <label className="text-slate-500 text-[9px] font-black uppercase tracking-wider whitespace-nowrap">
                                    Posición compuerta:
                                </label>
                                <input
                                    type="text"
                                    inputMode="text"
                                    placeholder="ej. 1/10"
                                    maxLength={10}
                                    value={presaPosicion[presaField]}
                                    onChange={(e) => setPresaPosicion(prev => ({ ...prev, [presaField]: e.target.value }))}
                                    className="bg-slate-900 border border-slate-800 text-white text-xs px-2 py-1.5 rounded-lg outline-none focus:border-mobile-accent focus:ring-1 focus:ring-mobile-accent/50 font-mono w-24"
                                />
                                <span className="text-slate-600 text-[9px] italic">solo referencia — no calcula gasto</span>
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
                        {activeTab === 'presas' && presaModo === 'obras' && (() => {
                            const total = (presaData.tomaBaja + presaData.cfe + presaData.tomaIzq + presaData.tomaDer) / 100;
                            return (
                                <div className="flex items-center justify-between bg-slate-900/50 rounded p-2 mb-2 flex-shrink-0">
                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Gasto Total (Σ obras)</span>
                                    <span className="font-mono font-bold text-sm text-cyan-300">{total.toFixed(2)} m³/s</span>
                                </div>
                            );
                        })()}
                        {activeTab === 'presas' && presaModo === 'nivel' && (() => {
                            const pt = puntos.find(p => p.id === selectedPoint);
                            const elevAnterior = pt?.nivel_actual ?? null;
                            const elevActual = nivelData.elevacion / 100;
                            const diffM = (elevAnterior != null && elevActual > 0) ? elevActual - elevAnterior : null;
                            return (
                                <div className="flex items-center justify-between bg-slate-900/50 rounded p-2 mb-2 flex-shrink-0">
                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Variación vs. última lectura</span>
                                    <span className="font-mono font-bold text-sm text-cyan-300">
                                        {diffM != null ? `${diffM >= 0 ? '+' : ''}${(diffM * 100).toFixed(0)} cm` : 'Sin referencia'}
                                    </span>
                                </div>
                            );
                        })()}
                        {activeTab === 'escala' && (() => {
                            const pt = puntos.find(p => p.id === selectedPoint);
                            const hArriba = escalaData.arriba / 100;
                            const hAbajo = escalaData.abajo / 100;
                            const realAps = (escalaData.aperturas || []).map(a => a / 100);

                            const { q_total: q, hasRadialesOpen } = calculateFlow({
                                hArriba,
                                hAbajo,
                                pzasRadiales: pt?.pzas_radiales,
                                anchoRadial: pt?.ancho_radiales,
                                altoRadial: pt?.alto_radiales,
                                aperturas: realAps,
                                factorCorreccion: getFactorCorreccion(pt?.name, pt?.km),
                                esGargantaLarga: !pt?.pzas_radiales && !!(pt?.ancho_radiales && pt.ancho_radiales > 0),
                                nombre: pt?.name,
                            });

                            // Curva nivel-gasto (rating curve) — solo puntos calibrados (K-0+000).
                            // Se alimenta del NIVEL ABAJO (tirante del cauce = escala aforada),
                            // no del remanso aguas arriba de la compuerta.
                            const curva = calcGastoCurvaNivel(pt?.name, hAbajo);
                            const tieneCurva = curva !== null;

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

                                    <div className="flex-shrink-0 bg-slate-900/50 rounded p-1 mb-4">
                                        {/* Apertura Total Acumulada — visible solo con compuertas radiales */}
                                        {pt?.pzas_radiales && pt.pzas_radiales > 0 && (() => {
                                            const totalAp  = realAps.reduce((s, a) => s + a, 0);
                                            const abiertas = realAps.filter(a => a > 0).length;
                                            return (
                                                <div className="flex items-center justify-between border-b border-slate-700/50 pb-1 mb-1">
                                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Apertura Total Acumulada</span>
                                                    <span className="font-mono font-bold text-sm text-cyan-300">
                                                        {totalAp.toFixed(2)} m
                                                        <span className="text-slate-500 font-normal text-[10px] ml-1">· {abiertas}/{pt.pzas_radiales} abiertas</span>
                                                    </span>
                                                </div>
                                            );
                                        })()}

                                        {tieneCurva ? (
                                            // ── Selector de método: compuertas vs curva nivel-gasto ──
                                            // El operador elige cuál se guarda en el reporte de gasto.
                                            (() => {
                                                const qCompuertas = q;
                                                const qCurva = curva!.q;
                                                const divergPct = qCurva > 0 ? Math.abs(qCompuertas - qCurva) / qCurva * 100 : 0;
                                                const opciones = [
                                                    { id: 'compuertas' as const, label: 'Compuertas (M1)', val: qCompuertas, sub: hasRadialesOpen ? 'Σ radiales' : 'sin apertura' },
                                                    { id: 'curva' as const,      label: 'Curva nivel-gasto', val: qCurva, sub: `Q=C·h^n · R²=${curva!.r2.toFixed(2)}` },
                                                ];
                                                return (
                                                    <div>
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <span className="text-[9px] text-amber-400 uppercase tracking-wide font-black">Elige gasto a guardar</span>
                                                            {divergPct > 15 && (
                                                                <span className="text-[8px] text-amber-500 font-bold uppercase">⚠ divergen {divergPct.toFixed(0)}%</span>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {opciones.map(o => {
                                                                const activo = metodoGasto === o.id;
                                                                return (
                                                                    <button
                                                                        key={o.id}
                                                                        type="button"
                                                                        onClick={() => setMetodoGasto(o.id)}
                                                                        className={`rounded-lg p-2 border text-left transition-all ${activo ? 'bg-mobile-accent/15 border-mobile-accent ring-1 ring-mobile-accent/40' : 'bg-slate-950/60 border-slate-700/50'}`}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <span className={`text-[9px] font-black uppercase ${activo ? 'text-mobile-accent' : 'text-slate-400'}`}>{o.label}</span>
                                                                            {activo && <span className="text-[8px] text-mobile-accent font-black">✓</span>}
                                                                        </div>
                                                                        <div className={`font-mono font-bold text-lg ${activo ? 'text-white' : 'text-slate-400'}`}>{o.val.toFixed(3)}<span className="text-[9px] text-slate-500 ml-1">m³/s</span></div>
                                                                        <div className="text-[8px] text-slate-500 font-mono">{o.sub}</div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        {curva!.fueraDeRango && metodoGasto === 'curva' && (
                                                            <div className="text-[8px] text-amber-500/80 mt-1 font-bold uppercase">⚠ nivel fuera del rango aforado — curva extrapolada</div>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        ) : (
                                            <div className="flex items-center justify-end">
                                                <span className="text-slate-500 text-xs mr-2">
                                                    {pt?.pzas_radiales && hasRadialesOpen ? 'Gasto Sumado (Radiales):' : 'Gasto Calculado:'}
                                                </span>
                                                <span className="text-mobile-accent font-mono font-bold text-lg">{q.toFixed(3)} m³/s</span>
                                            </div>
                                        )}
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
