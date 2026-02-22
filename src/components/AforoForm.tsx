import { useState, useMemo } from 'react';
import { Save, Plus, Trash2, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { db, type SicaAforoRecord, type AforoDobela } from '../lib/db';

interface AforoFormProps {
    selectedPoint: string;
    isOnline: boolean;
    onSaveSuccess: () => void;
}

export const AforoForm = ({ selectedPoint, isOnline, onSaveSuccess }: AforoFormProps) => {
    // 1. Estados Simples Genéricos de Aforo
    const [horaInicial, setHoraInicial] = useState('');
    const [horaFinal, setHoraFinal] = useState('');
    const [escalaInicial, setEscalaInicial] = useState<number | ''>('');
    const [escalaFinal, setEscalaFinal] = useState<number | ''>('');
    const [espejo, setEspejo] = useState<number | ''>('');

    // 2. Estado Complejo: Lista de Dobelas
    const [dobelas, setDobelas] = useState<AforoDobela[]>([
        { base_m: 0, tirante_m: 0, velocidades_revoluciones: [0, 0, 0], velocidades_segundos: [0, 0, 0] }
    ]);

    // 3. Constantes de Calibración del Molinete (ROSSBACH_PRICE_No. 73201)
    // Ecuación lineal típica V = a*n + b
    // n = revoluciones / tiempo(seg)
    const MOLINETE_A = 0.6756; // Constantes temporales aproximadas de la imagen
    const MOLINETE_B = 0.0150;

    // Funciones Auxiliares de Cálculo Hidráulico (Reactivos con useMemo)
    const datosCalculados = useMemo(() => {
        let areaTotal = 0;
        let gastoTotal = 0;

        const dobelasCalculadas = dobelas.map(d => {
            const area = d.base_m * d.tirante_m;

            // Calculo de Velocidad Media: Promedio de los 3 mediciones del molinete
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
            const gasto = area * velocidadMedia; // Q = V * A

            areaTotal += area;
            gastoTotal += gasto;

            return {
                ...d,
                area,
                velocidadMedia,
                gasto
            };
        });

        return {
            dobelas: dobelasCalculadas,
            areaTotal,
            gastoTotal
        };
    }, [dobelas]);

    // Handlers
    const addDobela = () => {
        setDobelas([...dobelas, { base_m: 0, tirante_m: 0, velocidades_revoluciones: [0, 0, 0], velocidades_segundos: [0, 0, 0] }]);
    };

    const removeDobela = (index: number) => {
        if (dobelas.length > 1) {
            setDobelas(dobelas.filter((_, i) => i !== index));
        }
    };

    const updateDobela = (index: number, field: keyof AforoDobela, value: any) => {
        const newDobelas = [...dobelas];
        newDobelas[index] = { ...newDobelas[index], [field]: value };
        setDobelas(newDobelas);
    };

    const updateMolinete = (index: number, lecIndex: number, rev: number, seg: number) => {
        const newDobelas = [...dobelas];
        const newRevs = [...newDobelas[index].velocidades_revoluciones];
        const newSegs = [...newDobelas[index].velocidades_segundos];

        newRevs[lecIndex] = rev;
        newSegs[lecIndex] = seg;

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

        const payload: Omit<SicaAforoRecord, 'id'> = {
            tipo: 'aforo',
            punto_id: selectedPoint,
            fecha_captura: new Date().toISOString().split('T')[0],
            hora_captura: horaFinal,
            sincronizado: isOnline ? 'true' : 'false',
            // Campos específicos Aforo
            hora_inicial: horaInicial,
            hora_final: horaFinal,
            tirante_inicial_m: Number(escalaInicial),
            tirante_final_m: Number(escalaFinal),
            espejo_m: Number(espejo || 0),
            dobelas: dobelas,
            gasto_total_m3s: datosCalculados.gastoTotal
        };

        try {
            await db.records.add(payload as SicaAforoRecord);
            toast.success('Aforo guardado ' + (isOnline ? 'localmente (Sync Online)' : 'offline (Mochila)'));
            onSaveSuccess();
        } catch (e) {
            toast.error('Error al guardar el aforo en la base local.');
            console.error(e);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-y-auto pb-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Calculator size={24} className="text-mobile-accent" /> Captura Método Área-Velocidad</h2>

            {/* Metadatos Generales */}
            <div className="bg-slate-800 rounded-xl p-3 mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-slate-400 font-bold uppercase">Hora Inicial</label>
                        <input type="time" value={horaInicial} onChange={e => setHoraInicial(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white" />
                    </div>
                    <div>
                        <label className="text-xs text-slate-400 font-bold uppercase">Hora Final</label>
                        <input type="time" value={horaFinal} onChange={e => setHoraFinal(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-slate-400 font-bold uppercase">Escala In. (m)</label>
                        <input type="number" step="0.01" value={escalaInicial} onChange={e => setEscalaInicial(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white" placeholder="Ej. 2.65" />
                    </div>
                    <div>
                        <label className="text-xs text-slate-400 font-bold uppercase">Escala Fin. (m)</label>
                        <input type="number" step="0.01" value={escalaFinal} onChange={e => setEscalaFinal(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white" placeholder="Ej. 2.65" />
                    </div>
                </div>
                <div>
                    <label className="text-xs text-slate-400 font-bold uppercase">Espejo T (m)</label>
                    <input type="number" step="0.01" value={espejo} onChange={e => setEspejo(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white" placeholder="Opcional Ej. 22.48" />
                </div>
            </div>

            {/* Dobelas Dinámicas */}
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-2 border-b border-slate-700 pb-1">Medición por Dobela</h3>

            {datosCalculados.dobelas.map((dobela, idx) => (
                <div key={idx} className="bg-slate-800/80 border border-slate-700 p-3 mb-3 rounded-lg relative">
                    <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-mobile-accent bg-mobile-accent/10 px-2 py-0.5 rounded text-xs">V{idx + 1}</span>
                        {dobelas.length > 1 && (
                            <button onClick={() => removeDobela(idx)} className="text-mobile-danger p-1/2 bg-red-500/10 rounded">
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                            <label className="text-[10px] text-slate-400 font-bold">Base (m)</label>
                            <input type="number" step="0.01" value={dobela.base_m || ''} onChange={e => updateDobela(idx, 'base_m', parseFloat(e.target.value))} className="w-full bg-slate-900/50 border border-slate-700/50 rounded p-1 text-sm text-white" />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-400 font-bold">Tirante y (m)</label>
                            <input type="number" step="0.01" value={dobela.tirante_m || ''} onChange={e => updateDobela(idx, 'tirante_m', parseFloat(e.target.value))} className="w-full bg-slate-900/50 border border-slate-700/50 rounded p-1 text-sm text-white" />
                        </div>
                    </div>

                    <div className="text-[10px] text-slate-500 font-bold mb-1">Molinete (Rev / Seg)</div>
                    <div className="space-y-1 bg-slate-900/40 p-1.5 rounded">
                        {[0, 1, 2].map(lecIdx => (
                            <div key={lecIdx} className="grid grid-cols-2 gap-2">
                                <input type="number" placeholder="Revs" value={dobela.velocidades_revoluciones[lecIdx] || ''} onChange={e => updateMolinete(idx, lecIdx, parseFloat(e.target.value), dobela.velocidades_segundos[lecIdx])} className="w-full bg-transparent border-b border-slate-700 text-xs text-indigo-300 placeholder-indigo-300/30 p-1 text-center" />
                                <input type="number" placeholder="Segs" value={dobela.velocidades_segundos[lecIdx] || ''} onChange={e => updateMolinete(idx, lecIdx, dobela.velocidades_revoluciones[lecIdx], parseFloat(e.target.value))} className="w-full bg-transparent border-b border-slate-700 text-xs text-blue-300 placeholder-blue-300/30 p-1 text-center" />
                            </div>
                        ))}
                    </div>

                    {/* Resultados Locales */}
                    <div className="mt-2 flex justify-between bg-black/20 p-1.5 rounded border border-slate-700/30">
                        <span className="text-[10px] text-slate-400">A={dobela.area.toFixed(3)}m² | <span className="text-white">v={dobela.velocidadMedia.toFixed(3)}m/s</span></span>
                        <span className="text-[10px] text-green-400 font-bold">Q={dobela.gasto.toFixed(3)}m³/s</span>
                    </div>
                </div>
            ))}

            <button onClick={addDobela} className="w-full py-3 mt-1 mb-6 border-2 border-dashed border-slate-700 text-slate-400 rounded-xl flex items-center justify-center gap-2 font-bold text-sm hover:border-mobile-accent hover:text-mobile-accent transition-colors">
                <Plus size={16} /> AÑADIR DOBELA / SECCIÓN
            </button>

            {/* Dashboard Final Flotante Integrado */}
            <div className="sticky bottom-0 bg-slate-900 border-t-2 border-mobile-accent p-4 -mx-3 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
                <div className="flex justify-between items-end mb-3">
                    <div>
                        <div className="text-xs text-slate-400 font-bold uppercase">Área Total</div>
                        <div className="text-lg font-mono text-white">{datosCalculados.areaTotal.toFixed(3)} m²</div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-mobile-accent font-bold uppercase tracking-wider mb-1">Gasto Total Obtenido</div>
                        <div className="text-3xl font-mono text-white font-bold leading-none">{datosCalculados.gastoTotal.toFixed(3)} <span className="text-sm text-slate-500 font-sans">m³/s</span></div>
                    </div>
                </div>

                <button
                    className="w-full bg-mobile-accent text-white py-4 rounded-xl flex items-center justify-center gap-2 font-bold shadow-lg active:scale-95 transition-transform text-lg"
                    onClick={handleSave}
                >
                    <Save size={20} /> ALMACENAR AFORO
                </button>
            </div>

        </div>
    );
};
