import { useState, useMemo, useEffect } from 'react';
import { Save, Calculator, AlertTriangle, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { db, type SicaAforoRecord, type AforoDobela } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { syncPendingRecords } from '../lib/sync';
import { v4 as uuidv4 } from 'uuid';
import { TrapezoidalSchema } from './TrapezoidalSchema';

interface AforoFormProps {
    selectedPoint: string;
    isOnline: boolean;
    onSaveSuccess: () => void;
    editRecord?: SicaAforoRecord;
}

export const AforoForm = ({ selectedPoint, isOnline, onSaveSuccess, editRecord }: AforoFormProps) => {
    const { profile } = useAuth();

    // 1. Estados Simples Genéricos de Aforo
    const [horaInicial, setHoraInicial] = useState('');
    const [horaFinal, setHoraFinal] = useState('');
    const [escalaInicial, setEscalaInicial] = useState<number | ''>('');
    const [escalaFinal, setEscalaFinal] = useState<number | ''>('');
    const [espejo, setEspejo] = useState<number | ''>('');

    // --- NUEVOS: AYUDAS DE DISEÑO ---
    const [plantilla, setPlantilla] = useState<number | ''>('');
    const [talud, setTalud] = useState<number | ''>('');
    const [tiranteCalc, setTiranteCalc] = useState<number | ''>('');
    const [autoCalcularBase, setAutoCalcularBase] = useState(true);

    // Estado para Generar X Dobelas Automáticamente
    const [numDobelasInput, setNumDobelasInput] = useState<number | ''>(1);
    const [activeDobelaIdx, setActiveDobelaIdx] = useState<number>(0);

    // 2. Estado Complejo: Lista de Dobelas
    const [dobelas, setDobelas] = useState<AforoDobela[]>([
        { base_m: 0, tirante_m: 0, velocidades_revoluciones: [0, 0, 0], velocidades_segundos: [0, 0, 0] }
    ]);

    // EFECTO DE HIDRATACIÓN (Para Corregir Aforos Anteriores)
    useEffect(() => {
        if (editRecord) {
            setHoraInicial(editRecord.hora_inicial || '');
            setHoraFinal(editRecord.hora_final || '');
            setEscalaInicial(editRecord.tirante_inicial_m || 0);
            setEscalaFinal(editRecord.tirante_final_m || 0);
            setEspejo(editRecord.espejo_m || 0);
            setDobelas(editRecord.dobelas || []);
            setNumDobelasInput(editRecord.dobelas?.length || 1);
            setActiveDobelaIdx(0);
            toast.info('Cargando datos para corrección técnica.');
        }
    }, [editRecord]);

    // Sugerir Distribución de Dobelas
    const handleSugerirDistribucion = () => {
        // Usamos el tirante de cálculo si existe, si no el promedio de escalas
        const tiranteRef = tiranteCalc !== '' ? Number(tiranteCalc) : ((Number(escalaInicial || 0) + Number(escalaFinal || 0)) / 2);

        if (tiranteRef <= 0 && tiranteCalc === '') {
            toast.error('Ingrese Tirante de Cálculo o Escalas para determinar el Espejo (T)');
            return;
        }

        // Calcular Espejo Teórico T = b + 2*z*y
        const tTeorico = Number(plantilla || 0) + (2 * Number(talud || 0) * tiranteRef);
        setEspejo(Number(tTeorico.toFixed(3)));

        // Sugerencia de número de dobelas (Regla: T / 3-5m o min 5 para precisión)
        const sugerenciaN = Math.max(5, Math.ceil(tTeorico / 2.5));
        setNumDobelasInput(Math.min(20, sugerenciaN));

        toast.info(`Geometría Trapezoidal: T=${tTeorico.toFixed(2)}m (y=${tiranteRef.toFixed(2)}m)`);
    };

    // Generar las dobelas de forma automática
    const handleGenerarDobelas = () => {
        if (!numDobelasInput || numDobelasInput < 1) {
            toast.error('Número de dobelas inválido');
            return;
        }

        const tirantePromedio = ((Number(escalaInicial || 0) + Number(escalaFinal || 0)) / 2);
        const tTeorico = Number(plantilla || 0) + (2 * Number(talud || 0) * tirantePromedio);
        const espejoReal = Number(espejo) || tTeorico;
        const baseCalculada = espejoReal > 0 ? (espejoReal / Number(numDobelasInput)) : 0;

        const newArray: AforoDobela[] = Array.from({ length: Number(numDobelasInput) }).map((_, i) => {
            return {
                base_m: autoCalcularBase ? Number(baseCalculada.toFixed(3)) : (dobelas[i]?.base_m || 0),
                tirante_m: dobelas[i]?.tirante_m || 0,
                velocidades_revoluciones: dobelas[i]?.velocidades_revoluciones || [0, 0, 0],
                velocidades_segundos: dobelas[i]?.velocidades_segundos || [0, 0, 0]
            };
        });

        setDobelas(newArray);
        setActiveDobelaIdx(0);
        toast.success('Distribución generada con ayuda de diseño.');
    };

    // 3. Constantes de Calibración del Molinete (ROSSBACH_PRICE_No. 73201)
    const MOLINETE_A = 0.6756;
    const MOLINETE_B = 0.0150;

    // Funciones Auxiliares de Cálculo Hidráulico (Reactivos con useMemo)
    const datosCalculados = useMemo(() => {
        const dobelasCalculadas = dobelas.map(d => {
            const area = d.base_m * d.tirante_m;

            let sumaVelocidades = 0;
            let lecturasValidas = 0;

            for (let i = 0; i < 3; i++) {
                if (d.velocidades_segundos[i] > 0) {
                    const n = d.velocidades_revoluciones[i] / d.velocidades_segundos[i];
                    const v = (MOLINETE_A * n) + MOLINETE_B;
                    sumaVelocidades += v;
                    lecturasValidas++;
                }
            }

            const velocidadMedia = lecturasValidas > 0 ? sumaVelocidades / lecturasValidas : 0;
            const gasto = area * velocidadMedia;

            return {
                ...d,
                area,
                velocidadMedia,
                gasto
            };
        });

        // RE-CALCULO PARA PROGRESIVAS (Acumuladas) Y TOTALES ESTRICTOS
        let cumulX = 0;
        let totalA = 0;
        let totalQ = 0;
        const dobelasFinales = dobelasCalculadas.map((d) => {
            const centerOffset = d.base_m / 2;
            const currentX = cumulX + centerOffset;
            cumulX += d.base_m;
            totalA += d.area;
            totalQ += d.gasto;
            return { ...d, x: currentX };
        });

        // Cálculo de Régimen (Froude)
        const t_prom = totalA > 0 && espejo ? (totalA / Number(espejo)) : (totalQ > 0 ? 0.5 : 0);
        const velGlobal = totalA > 0 ? (totalQ / totalA) : 0;
        const froude = t_prom > 0 ? (velGlobal / Math.sqrt(9.81 * t_prom)) : 0;

        return {
            dobelas: dobelasFinales,
            areaTotal: totalA,
            gastoTotal: totalQ,
            froude,
            tiranteMedio: t_prom
        };
    }, [dobelas, espejo]);

    // Handlers
    const updateDobela = (index: number, field: keyof AforoDobela, value: number) => {
        const newDobelas = [...dobelas];
        newDobelas[index] = { ...newDobelas[index], [field]: isNaN(value) ? 0 : value };
        setDobelas(newDobelas);
    };

    const updateMolinete = (index: number, lecIndex: number, rev: number, seg: number) => {
        const newDobelas = [...dobelas];
        const newRevs = [...newDobelas[index].velocidades_revoluciones];
        const newSegs = [...newDobelas[index].velocidades_segundos];

        newRevs[lecIndex] = isNaN(rev) ? 0 : rev;
        newSegs[lecIndex] = isNaN(seg) ? 0 : seg;

        newDobelas[index].velocidades_revoluciones = newRevs;
        newDobelas[index].velocidades_segundos = newSegs;

        setDobelas(newDobelas);
    };

    const handleSave = async () => {
        if (!selectedPoint) {
            toast.error('Selecciona el Canal/Punto de Control');
            return;
        }
        if (!horaInicial || !horaFinal || escalaInicial === '' || escalaFinal === '') {
            toast.error('Faltan datos de Metadatos (Horas/Escalas)');
            return;
        }

        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const captureDateStr = `${y}-${m}-${d}`;

        const payload: SicaAforoRecord = {
            id: editRecord?.id || uuidv4(),
            tipo: 'aforo',
            punto_id: selectedPoint,
            fecha_captura: editRecord?.fecha_captura || captureDateStr,
            hora_captura: editRecord?.hora_captura || now.toTimeString().split(' ')[0],
            sincronizado: 'false',
            responsable_id: profile?.id,
            responsable_nombre: profile?.nombre || 'Operador Móvil',
            hora_inicial: horaInicial,
            hora_final: horaFinal,
            tirante_inicial_m: Number(escalaInicial),
            tirante_final_m: Number(escalaFinal),
            espejo_m: Number(espejo || 0),
            dobelas: dobelas,
            gasto_total_m3s: datosCalculados.gastoTotal,
            plantilla_m: plantilla !== '' ? Number(plantilla) : undefined,
            talud_z: talud !== '' ? Number(talud) : undefined,
            tirante_calculo_m: tiranteCalc !== '' ? Number(tiranteCalc) : undefined,
            area_hidraulica_m2: datosCalculados.areaTotal,
            velocidad_media_ms: datosCalculados.areaTotal > 0 ? (datosCalculados.gastoTotal / datosCalculados.areaTotal) : 0,
            froude: datosCalculados.froude
        };

        try {
            if (editRecord) {
                await db.records.put(payload);
            } else {
                await db.records.add(payload);
            }

            if (isOnline) {
                toast.promise(syncPendingRecords(), {
                    loading: '🚀 Sincronizando Aforo...',
                    success: '✅ Aforo en la Nube',
                    error: '💾 Guardado en Mochila (Pendiente)'
                });
            } else {
                toast.warning('💾 Aforo guardado en Mochila (Offline)');
            }

            onSaveSuccess();
        } catch (e) {
            toast.error('Error al guardar el aforo en la base local.');
            console.error(e);
        }
    };

    return (
        <div className="flex flex-col pb-12">
            <h2 className="text-lg font-bold mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Calculator size={20} className="text-mobile-accent" /> Captura Area-Velocidad
                </div>
                {editRecord && <span className="text-[9px] bg-amber-500 text-white px-2 py-0.5 rounded-full animate-pulse uppercase font-black">Modo Corrección</span>}
            </h2>

            {/* Metadatos Generales */}
            <div className="bg-slate-800 rounded-lg p-2.5 mb-3 space-y-2 relative border border-slate-700/50">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Hora Inicial</label>
                        <input type="time" value={horaInicial} onChange={e => setHoraInicial(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm" />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Hora Final</label>
                        <input type="time" value={horaFinal} onChange={e => setHoraFinal(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Escala In. (m)</label>
                        <input type="number" step="0.01" value={escalaInicial} onChange={e => setEscalaInicial(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm" placeholder="Ej. 2.65" />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Escala Fin. (m)</label>
                        <input type="number" step="0.01" value={escalaFinal} onChange={e => setEscalaFinal(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm" placeholder="Ej. 2.65" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Espejo T (m)</label>
                        <input type="number" step="0.01" value={espejo} onChange={e => setEspejo(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm" placeholder="Espejo real" />
                    </div>
                    <div>
                        <label className="text-[10px] text-sky-400 font-bold uppercase">Ayuda: Diseño</label>
                        <button
                            onClick={handleSugerirDistribucion}
                            className="w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 rounded p-1.5 text-[9px] font-black uppercase tracking-tighter"
                        >
                            Calcular Geometría
                        </button>
                    </div>
                </div>
            </div>

            {/* SECCIÓN NUEVA: ASISTENTE DE GEOMETRÍA */}
            <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3 mb-3">
                <h3 className="text-[9px] text-mobile-accent font-black uppercase mb-2 flex items-center gap-1.5 px-1">
                    <TrendingUp size={12} /> Parámetros de Sección Trapezoidal
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                        <label className="text-[8px] text-slate-500 uppercase font-black ml-1">Plantilla (b)</label>
                        <div className="relative">
                            <input type="number" step="0.01" value={plantilla} onChange={e => setPlantilla(parseFloat(e.target.value) || '')} className="w-full bg-slate-800 border-0 rounded-lg p-2.5 text-white text-sm font-mono text-center" placeholder="Ancho fondo (m)" />
                            <span className="absolute right-2 top-2.5 text-[8px] text-slate-600 font-bold uppercase">m</span>
                        </div>
                    </div>
                    <div>
                        <label className="text-[8px] text-slate-500 uppercase font-black ml-1">Talud (z:1)</label>
                        <div className="relative">
                            <input type="number" step="0.1" value={talud} onChange={e => setTalud(parseFloat(e.target.value) || '')} className="w-full bg-slate-800 border-0 rounded-lg p-2.5 text-white text-sm font-mono text-center" placeholder="z (Horiz)" />
                            <span className="absolute right-2 top-2.5 text-[8px] text-slate-600 font-bold uppercase">z</span>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                        <label className="text-[8px] text-sky-400 uppercase font-black ml-1 italic">Tirante de Diseño para T</label>
                        <div className="relative">
                            <input type="number" step="0.01" value={tiranteCalc} onChange={e => setTiranteCalc(parseFloat(e.target.value) || '')} className="w-full bg-sky-950/30 border border-sky-500/20 rounded-lg p-2.5 text-sky-300 text-sm font-mono text-center" placeholder="y (m)" />
                            <span className="absolute right-2 top-2.5 text-[8px] text-sky-600 font-bold">m</span>
                        </div>
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => setAutoCalcularBase(!autoCalcularBase)}
                            className={`flex-1 py-3 rounded-lg text-[8px] font-black uppercase transition-all ${autoCalcularBase ? 'bg-mobile-accent text-white shadow-lg shadow-mobile-accent/20' : 'bg-slate-800 text-slate-500'}`}
                        >
                            {autoCalcularBase ? 'Auto-Dist' : 'Manual'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Generador Gráfico de Dobelas */}
            <div className="bg-slate-800/80 rounded-lg p-2.5 mb-2 border border-slate-700 flex flex-col sm:flex-row items-end gap-2">
                <div className="w-full">
                    <label className="text-[10px] text-cyan-400 font-bold uppercase block mb-1">
                        Determinar Número de Dobelas Medidas (V)
                    </label>
                    <input
                        type="number"
                        min="1"
                        max="20"
                        value={numDobelasInput}
                        onChange={e => setNumDobelasInput(parseInt(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-center"
                    />
                </div>
                <button
                    onClick={handleGenerarDobelas}
                    className="w-full sm:w-auto mt-2 sm:mt-0 bg-cyan-600/20 text-cyan-400 font-bold border border-cyan-800 py-2.5 px-4 rounded-lg uppercase text-xs hover:bg-cyan-600/40 transition-colors"
                >
                    Generar Esquema
                </button>
            </div>

            {/* Esquema Interactivo Trapezoidal */}
            <TrapezoidalSchema
                dobelasCount={dobelas.length}
                activeDobelaIndex={activeDobelaIdx}
                activeTirante={dobelas[activeDobelaIdx]?.tirante_m || 0}
                activeX={datosCalculados.dobelas[activeDobelaIdx]?.x || 0}
                plantilla={Number(plantilla || 0)}
                talud={Number(talud || 0)}
                tiranteDiseno={tiranteCalc !== '' ? Number(tiranteCalc) : ((Number(escalaInicial || 0) + Number(escalaFinal || 0)) / 2)}
                espejoDiseno={Number(espejo || 0)}
                onDobelaSelect={setActiveDobelaIdx}
            />

            {/* Panel de Captura de la Dobela Activa */}
            <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2 border-b border-slate-700 pb-1 px-1 flex items-center justify-between">
                <span>Captura Directa (Molinete)</span>
                <span className="bg-amber-500/20 text-amber-500 px-2 rounded-t font-mono">
                    MODIFICANDO V{activeDobelaIdx + 1} DE {dobelas.length}
                </span>
            </h3>

            {datosCalculados.dobelas.length > 0 && (
                <div className="bg-slate-800/80 border-2 border-amber-900/50 p-3 mb-2 rounded-xl relative ring-1 ring-amber-500/20 transition-all">

                    {/* Botones Prev / Next (Cambiador Rápido) */}
                    <div className="flex justify-between items-center mb-3">
                        <button
                            disabled={activeDobelaIdx === 0}
                            onClick={() => setActiveDobelaIdx(prev => Math.max(0, prev - 1))}
                            className="bg-slate-900 text-slate-400 border border-slate-700 px-3 py-1 rounded text-xs disabled:opacity-30 font-bold"
                        >
                            &larr; Anterior (V{Math.max(1, activeDobelaIdx)})
                        </button>
                        <button
                            disabled={activeDobelaIdx === dobelas.length - 1}
                            onClick={() => setActiveDobelaIdx(prev => Math.min(dobelas.length - 1, prev + 1))}
                            className="bg-slate-900 text-slate-400 border border-slate-700 px-3 py-1 rounded text-xs disabled:opacity-30 font-bold"
                        >
                            Siguiente (V{Math.min(dobelas.length, activeDobelaIdx + 2)}) &rarr;
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label className="text-[10px] text-amber-400 font-bold">Base 'b' en V{activeDobelaIdx + 1} (m)</label>
                            <input
                                type="number" step="0.01"
                                value={dobelas[activeDobelaIdx].base_m || ''}
                                onChange={e => updateDobela(activeDobelaIdx, 'base_m', parseFloat(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-700/50 rounded-lg px-2 text-lg font-mono py-2 text-white placeholder-slate-600 focus:border-amber-500 outline-none transition-colors"
                                placeholder="0.00"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-amber-400 font-bold">Tirante 'y' en V{activeDobelaIdx + 1} (m)</label>
                            <input
                                type="number" step="0.01"
                                value={dobelas[activeDobelaIdx].tirante_m || ''}
                                onChange={e => updateDobela(activeDobelaIdx, 'tirante_m', parseFloat(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-700/50 rounded-lg px-2 text-lg font-mono py-2 text-white placeholder-slate-600 focus:border-amber-500 outline-none transition-colors"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-bold mb-1.5 uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle size={12} /> Lecturas del Molinete
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {[0, 1, 2].map(lecIdx => {
                                const y = dobelas[activeDobelaIdx].tirante_m || 0;
                                const profSugerida = lecIdx === 0 ? (y * 0.2) : lecIdx === 1 ? (y * 0.6) : (y * 0.8);
                                const hSugerida = y - profSugerida; // Altura desde la plantilla

                                return (
                                    <div key={lecIdx} className="flex flex-col gap-1.5 border-r last:border-0 border-slate-700/30 pr-2 last:pr-0 relative group">
                                        <div className="flex justify-between items-center px-1">
                                            <span className="text-[8px] text-sky-400 uppercase font-black">y_{lecIdx === 0 ? '0.2' : lecIdx === 1 ? '0.6' : '0.8'}: {profSugerida.toFixed(2)}m</span>
                                            <span className="text-[7px] text-amber-500 font-mono font-bold">H: {hSugerida.toFixed(2)}m</span>
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="number" title="Revoluciones" placeholder="Rev"
                                                value={dobelas[activeDobelaIdx].velocidades_revoluciones[lecIdx] || ''}
                                                onChange={e => updateMolinete(activeDobelaIdx, lecIdx, parseFloat(e.target.value), dobelas[activeDobelaIdx].velocidades_segundos[lecIdx])}
                                                className="w-full bg-slate-950 border border-slate-800 text-sm text-indigo-300 font-mono rounded px-1.5 py-1 text-center focus:border-indigo-500 outline-none"
                                            />
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="number" title="Segundos" placeholder="Seg"
                                                value={dobelas[activeDobelaIdx].velocidades_segundos[lecIdx] || ''}
                                                onChange={e => updateMolinete(activeDobelaIdx, lecIdx, dobelas[activeDobelaIdx].velocidades_revoluciones[lecIdx], parseFloat(e.target.value))}
                                                className="w-full bg-slate-950 border border-slate-800 text-sm text-blue-300 font-mono rounded px-1.5 py-1 text-center focus:border-blue-500 outline-none"
                                            />
                                        </div>
                                        <div className="absolute -bottom-4 left-0 w-full opacity-100 transition-opacity pointer-events-none">
                                            <p className="text-[7px] text-slate-500 text-center uppercase font-black tracking-tighter">
                                                y: {profSugerida.toFixed(2)}m | H: {hSugerida.toFixed(2)}m
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Resultados Locales de la Vertical */}
                    <div className="mt-3 flex justify-between bg-black/40 px-2 py-1.5 border border-slate-700/30">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-mono">
                                XL (Izq): {datosCalculados.dobelas[activeDobelaIdx].x.toFixed(2)}m | XR (Der): {(Number(espejo) - datosCalculados.dobelas[activeDobelaIdx].x).toFixed(2)}m<br />
                                A: {datosCalculados.dobelas[activeDobelaIdx].area.toFixed(3)} m² | v: {datosCalculados.dobelas[activeDobelaIdx].velocidadMedia.toFixed(3)} m/s
                            </span>
                        </div>
                        <div className="text-right">
                            <div className="text-[9px] text-green-500 uppercase font-bold tracking-wider text-[10px]">Aforo Parcial (Q)</div>
                            <span className="text-sm text-green-400 font-black font-mono">{datosCalculados.dobelas[activeDobelaIdx].gasto.toFixed(4)} m³/s</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Dashboard Final Integrado */}
            <div className="mt-4 bg-slate-900 border-t-2 border-mobile-accent p-3 -mx-3 shadow-lg z-10 pb-12">
                <div className="flex justify-between items-end mb-4 px-1">
                    <div className="flex flex-col gap-1">
                        <div>
                            <div className="text-[8px] text-slate-500 font-black uppercase">Area / Espejo B</div>
                            <div className="text-xs font-mono text-white font-bold leading-none">
                                {datosCalculados.areaTotal.toFixed(3)} m² | {espejo || '0.00'} m
                            </div>
                        </div>
                        <div>
                            <div className="text-[8px] text-slate-500 font-black uppercase">Num. Froude</div>
                            <div className={`text-[10px] font-mono leading-none font-bold ${datosCalculados.froude > 1 ? 'text-red-400' : 'text-cyan-400'}`}>
                                {datosCalculados.froude.toFixed(3)} ({datosCalculados.froude > 1 ? 'Supercrit' : 'Subcrit'})
                            </div>
                        </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <div className="text-[10px] text-mobile-accent font-black uppercase tracking-wider mb-0.5">GASTO CALCULADO</div>
                        <div className="text-3xl font-black text-white leading-none tracking-tighter">
                            {datosCalculados.gastoTotal.toFixed(3)} <span className="text-[10px] text-slate-500 font-black">m³/s</span>
                        </div>
                        {datosCalculados.areaTotal > 0 && (datosCalculados.gastoTotal / datosCalculados.areaTotal) < 0.05 && (
                            <span className="text-[7px] bg-red-500/20 text-red-500 px-1 rounded mt-1 font-bold animate-pulse">VELOCIDAD BAJA - POSIBLE ERROR INSTRUMENTAL</span>
                        )}
                    </div>
                </div>

                <button
                    className="w-full bg-mobile-accent text-white py-3.5 rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg active:scale-95 transition-transform text-lg"
                    onClick={handleSave}
                >
                    <Save size={20} /> ALMACENAR AFORO TOTAL
                </button>
            </div>

        </div>
    );
};
