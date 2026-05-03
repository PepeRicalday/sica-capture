import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { Save, Droplets, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db, type OfflinePoint, type ZonaCatalog, type ModuloBalance, type ModuloZona } from '../lib/db';
import { supabase } from '../lib/supabase';
import { getTodayString } from '../lib/dateHelpers';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

// ── Helpers ──────────────────────────────────────────────────

const calcHoras = (inicio: string, fin: string): number => {
    if (!inicio || !fin) return 0;
    const [ih, im] = inicio.split(':').map(Number);
    const [fh, fm] = fin.split(':').map(Number);
    const diff = (fh * 60 + fm) - (ih * 60 + im);
    return diff > 0 ? Math.round((diff / 60) * 100) / 100 : 0;
};

const calcVolumen = (gastoLps: number, horas: number): number =>
    Math.round(gastoLps / 1000 * horas * 3600);

const fmtM3 = (v: number) =>
    v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(3)} Mm³`
        : v.toLocaleString('es-MX') + ' m³';

// ── Estado semáforo ───────────────────────────────────────────
const ESTADO_COLOR: Record<string, string> = {
    normal:           'text-emerald-400',
    alerta_base:      'text-amber-400',
    base_agotado:     'text-rose-400',
    adicional_activo: 'text-sky-400',
};
const ESTADO_LABEL: Record<string, string> = {
    normal:           'En rango',
    alerta_base:      '>85% del base',
    base_agotado:     'Base agotado',
    adicional_activo: 'Solo adicional',
};

// ── Componente ────────────────────────────────────────────────

interface EntregaFormProps {
    onSaved?: () => void;
}

// Tipo liviano para los módulos que necesita el selector
interface ModuloItem {
    id: string;
    nombre: string;
    codigo_corto: string | null;
}

export function EntregaForm({ onSaved }: EntregaFormProps) {
    const { profile } = useAuth();
    const isSRL = profile?.rol === 'SRL';
    const userModuloId = profile?.modulo_id ?? null;

    // ── Catálogos: Supabase como fuente primaria, Dexie como fallback offline ──
    const [zonas,       setZonas]       = useState<ZonaCatalog[]>([]);
    const [moduloZonas, setModuloZonas] = useState<ModuloZona[]>([]);
    const [modulos,     setModulos]     = useState<ModuloItem[]>([]);
    const [todoBalance, setTodoBalance] = useState<ModuloBalance[]>([]);
    const [loadingCat,  setLoadingCat]  = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoadingCat(true);
            try {
                const [resZonas, resMZ, resMod, resBal] = await Promise.all([
                    supabase.from('zonas_canal')
                        .select('id, nombre, codigo, km_inicio, km_fin, escala_entrada_id, escala_salida_id, color')
                        .order('km_inicio'),
                    supabase.from('modulo_zonas')
                        .select('modulo_id, zona_id, es_primaria'),
                    supabase.from('modulos')
                        .select('id, nombre, codigo_corto')
                        .order('codigo_corto'),
                    supabase.from('balance_volumen_modulo').select('*'),
                ]);
                if (cancelled) return;

                const zonasData  = (resZonas.data  ?? []) as ZonaCatalog[];
                const mzData     = (resMZ.data     ?? []) as ModuloZona[];
                const modData    = (resMod.data     ?? []) as ModuloItem[];
                const balData    = (resBal.data     ?? []) as ModuloBalance[];

                // Si Supabase devuelve datos, úsalos y guarda en Dexie
                if (zonasData.length > 0) {
                    setZonas(zonasData);
                    db.zonas.bulkPut(zonasData).catch(() => {});
                } else {
                    // Fallback Dexie offline
                    const local = await db.zonas.toArray();
                    setZonas(local.sort((a, b) => a.km_inicio - b.km_inicio));
                }
                if (mzData.length > 0) {
                    setModuloZonas(mzData);
                    db.modulo_zonas.bulkPut(mzData).catch(() => {});
                } else {
                    setModuloZonas(await db.modulo_zonas.toArray());
                }
                setModulos(modData);
                if (balData.length > 0) {
                    setTodoBalance(balData);
                    db.modulos_balance.bulkPut(balData).catch(() => {});
                } else {
                    setTodoBalance(await db.modulos_balance.toArray());
                }
            } catch {
                // Sin red: usar Dexie
                const [z, mz, b] = await Promise.all([
                    db.zonas.toArray(),
                    db.modulo_zonas.toArray(),
                    db.modulos_balance.toArray(),
                ]);
                if (!cancelled) {
                    setZonas(z.sort((a, b) => a.km_inicio - b.km_inicio));
                    setModuloZonas(mz);
                    setTodoBalance(b);
                }
            } finally {
                if (!cancelled) setLoadingCat(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    // Formulario
    const [selectedZonaId,   setSelectedZonaId]   = useState('');
    const [selectedModuloId, setSelectedModuloId] = useState('');
    const [fecha,            setFecha]            = useState(getTodayString());
    const [tipoEntrega,      setTipoEntrega]      = useState<'base' | 'adicional'>('base');
    const [gastoLps,         setGastoLps]         = useState('');
    const [horaInicio,       setHoraInicio]       = useState('06:00');
    const [horaFin,          setHoraFin]          = useState('18:00');
    const [motivo,           setMotivo]           = useState('');
    const [notas,            setNotas]            = useState('');
    const [isSaving,         setIsSaving]         = useState(false);

    // Ciclo activo
    const [cicloActivoId, setCicloActivoId] = useState<string | null>(null);
    useEffect(() => {
        supabase.from('ciclos_agricolas').select('id').eq('activo', true).single()
            .then(({ data }) => { if (data) setCicloActivoId(data.id); });
    }, []);

    // Pre-selección ACU: fija el módulo; la zona se auto-selecciona solo si es única
    useEffect(() => {
        if (!isSRL && userModuloId && moduloZonas.length > 0) {
            setSelectedModuloId(userModuloId);
            const zonasDelModulo = moduloZonas.filter(mz => mz.modulo_id === userModuloId);
            if (zonasDelModulo.length === 1) {
                setSelectedZonaId(zonasDelModulo[0].zona_id);
            }
        }
    }, [isSRL, userModuloId, moduloZonas]);

    // Módulos del selector — desde tabla modulos filtrada por modulo_zonas de la zona activa
    const modulosZona = useMemo(() => {
        // IDs de módulos en la zona seleccionada (o todos si no hay zona)
        const idsEnZona = selectedZonaId
            ? new Set(moduloZonas.filter(mz => mz.zona_id === selectedZonaId).map(mz => mz.modulo_id))
            : new Set(moduloZonas.map(mz => mz.modulo_id));

        return modulos.filter(m => {
            if (!isSRL && userModuloId && m.id !== userModuloId) return false;
            // Si hay zona seleccionada, solo mostrar módulos de esa zona;
            // si modulo_zonas está vacío (sin ciclo/seed), mostrar todos los módulos
            return moduloZonas.length === 0 || idsEnZona.has(m.id);
        });
    }, [selectedZonaId, modulos, moduloZonas, isSRL, userModuloId]);

    // Balance del módulo — busca (modulo_id, zona_id) exacto; fallback a zona primaria
    const balanceModulo = useMemo(() => {
        if (!selectedModuloId) return null;
        if (selectedZonaId) {
            const exact = todoBalance.find(
                m => m.modulo_id === selectedModuloId && m.zona_id === selectedZonaId
            );
            if (exact) return exact;
        }
        return todoBalance.find(m => m.modulo_id === selectedModuloId && m.es_primaria === true)
            ?? todoBalance.find(m => m.modulo_id === selectedModuloId)
            ?? null;
    }, [selectedModuloId, selectedZonaId, todoBalance]);

    // Escala de entrada de la zona seleccionada
    const zonaSeleccionada = useMemo(
        () => zonas.find(z => z.id === selectedZonaId) ?? null,
        [selectedZonaId, zonas]
    );
    const escalaEntrada = useLiveQuery(
        async () => {
            if (!zonaSeleccionada?.escala_entrada_id) return undefined;
            return db.puntos.get(zonaSeleccionada.escala_entrada_id);
        },
        [zonaSeleccionada?.escala_entrada_id]
    ) as OfflinePoint | undefined;

    const qEntrada = escalaEntrada?.nivel_actual
        ? (escalaEntrada as any).gasto_calculado_m3s ?? 0
        : 0;

    // Valores calculados
    const horas   = useMemo(() => calcHoras(horaInicio, horaFin), [horaInicio, horaFin]);
    const volumen = useMemo(
        () => calcVolumen(parseFloat(gastoLps) || 0, horas),
        [gastoLps, horas]
    );

    // Registro existente hoy (para mostrar advertencia de sobreescritura)
    const registroHoy = useLiveQuery(
        async () => {
            if (!selectedModuloId) return null;
            return db.records
                .filter(r =>
                    r.tipo === 'entrega' &&
                    r.modulo_id === selectedModuloId &&
                    r.fecha_captura === fecha &&
                    r.tipo_entrega === tipoEntrega
                )
                .first();
        },
        [selectedModuloId, fecha, tipoEntrega]
    );

    const handleSave = async () => {
        if (!selectedModuloId) {
            toast.error('Selecciona un módulo antes de guardar.');
            return;
        }
        if (!gastoLps || parseFloat(gastoLps) <= 0) {
            toast.error('El gasto debe ser mayor a 0 L/s.');
            return;
        }
        if (horas <= 0) {
            toast.error('La hora fin debe ser posterior a la hora inicio.');
            return;
        }
        if (tipoEntrega === 'adicional' && !motivo.trim()) {
            toast.error('El motivo es obligatorio para una entrega adicional.');
            return;
        }

        setIsSaving(true);
        try {
            const record = {
                id:                   registroHoy?.id ?? uuidv4(),
                tipo:                 'entrega' as const,
                punto_id:             selectedModuloId,
                modulo_id:            selectedModuloId,
                zona_id:              selectedZonaId || undefined,
                ciclo_id:             cicloActivoId || undefined,
                fecha_captura:        fecha,
                hora_captura:         new Date().toTimeString().slice(0, 8),
                valor_q:              parseFloat(gastoLps),
                tipo_entrega:         tipoEntrega,
                hora_inicio_entrega:  `${horaInicio}:00`,
                hora_fin_entrega:     `${horaFin}:00`,
                horas_operacion:      horas,
                volumen_m3:           volumen,
                motivo_adicional:     tipoEntrega === 'adicional' ? motivo.trim() : undefined,
                notas:                notas.trim() || undefined,
                responsable_id:       profile?.id,
                responsable_nombre:   profile?.nombre || 'Operador',
                sincronizado:         'false' as const,
            };

            await db.records.put(record);
            toast.success(
                registroHoy
                    ? 'Entrega actualizada (pendiente de sync)'
                    : `Entrega ${tipoEntrega} registrada`
            );
            setGastoLps('');
            setMotivo('');
            setNotas('');
            onSaved?.();
        } finally {
            setIsSaving(false);
        }
    };

    // ── Render ────────────────────────────────────────────────

    const pctBase    = balanceModulo?.pct_base_consumido ?? 0;
    const estadoColor = ESTADO_COLOR[balanceModulo?.estado_volumen ?? 'normal'];
    const esZonaSecundaria = balanceModulo !== null && balanceModulo?.es_primaria === false;

    return (
        <div className="space-y-4 pb-6">

            {/* ── Selectores ── */}
            <div className="grid grid-cols-2 gap-3">
                {/* Zona */}
                <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Zona
                    </label>
                    <select
                        title="Zona del canal"
                        value={selectedZonaId}
                        onChange={e => { setSelectedZonaId(e.target.value); setSelectedModuloId(''); }}
                        disabled={loadingCat || (!isSRL && moduloZonas.filter(mz => mz.modulo_id === userModuloId).length <= 1)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    >
                        <option value="">{loadingCat ? 'Cargando…' : '— Todas —'}</option>
                        {zonas.map(z => (
                            <option key={z.id} value={z.id}>{z.codigo} — km {z.km_inicio}–{z.km_fin}</option>
                        ))}
                    </select>
                </div>

                {/* Módulo */}
                <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Módulo
                    </label>
                    <select
                        title="Módulo de riego"
                        value={selectedModuloId}
                        onChange={e => setSelectedModuloId(e.target.value)}
                        disabled={!isSRL && !!userModuloId}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    >
                        <option value="">{loadingCat ? 'Cargando…' : '— Seleccionar —'}</option>
                        {modulosZona.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.codigo_corto ? `[${m.codigo_corto}] ` : ''}{m.nombre}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Indicador zona secundaria para M2 */}
            {esZonaSecundaria && (
                <div className="flex items-center gap-2 px-3 py-2 bg-sky-900/20 border border-sky-700/40 rounded-lg">
                    <AlertTriangle size={11} className="text-sky-400 flex-shrink-0" />
                    <p className="text-[11px] text-sky-300">
                        Zona secundaria — solo se registra consumo (la dotación base se controla en {
                            todoBalance.find(b => b.modulo_id === selectedModuloId && b.es_primaria)?.zona_codigo ?? 'zona primaria'
                        }).
                    </p>
                </div>
            )}

            {/* ── Fecha ── */}
            <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Fecha
                </label>
                <input
                    type="date"
                    title="Fecha de entrega"
                    value={fecha}
                    max={getTodayString()}
                    onChange={e => setFecha(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
                />
            </div>

            {/* ── Tipo de Entrega ── */}
            <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Tipo de entrega
                </label>
                <div className="flex gap-2">
                    {(['base', 'adicional'] as const).map(t => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTipoEntrega(t)}
                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${
                                tipoEntrega === t
                                    ? t === 'base'
                                        ? 'bg-sky-600 border-sky-500 text-white'
                                        : 'bg-amber-600 border-amber-500 text-white'
                                    : 'bg-slate-800 border-slate-700 text-slate-400'
                            }`}
                        >
                            {t === 'base' ? 'Dotación Base' : 'Adicional'}
                        </button>
                    ))}
                </div>
                {tipoEntrega === 'adicional' && (
                    <p className="text-[10px] text-amber-400 mt-1 font-semibold">
                        Se registrará como volumen adicional. El motivo es obligatorio.
                    </p>
                )}
            </div>

            {/* ── Disponibilidad zona (solo cuando hay escala y es adicional) ── */}
            {escalaEntrada && tipoEntrega === 'adicional' && (
                <div className="flex items-start gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <Droplets size={14} className="text-sky-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs">
                        <p className="font-black text-slate-300 uppercase tracking-wider text-[10px] mb-1">
                            Disponibilidad zona — {zonaSeleccionada?.codigo}
                        </p>
                        <p className="text-slate-400">
                            Escala entrada: <span className="text-white font-bold">{escalaEntrada.name}</span>
                        </p>
                        {qEntrada > 0 && (
                            <p className="text-sky-300 font-bold mt-0.5">
                                Q registrado: {qEntrada.toFixed(3)} m³/s
                            </p>
                        )}
                        {qEntrada === 0 && (
                            <p className="text-slate-500 italic">Sin lectura de escala reciente</p>
                        )}
                    </div>
                </div>
            )}

            {/* ── Gasto y horario ── */}
            <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Gasto (L/s)
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={gastoLps}
                        onChange={e => setGastoLps(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm text-center font-bold"
                    />
                    {gastoLps && parseFloat(gastoLps) > 0 && (
                        <p className="text-[10px] text-slate-500 text-center mt-0.5">
                            {(parseFloat(gastoLps) / 1000).toFixed(3)} m³/s
                        </p>
                    )}
                </div>
                <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Inicio
                    </label>
                    <input
                        type="time"
                        title="Hora inicio de entrega"
                        value={horaInicio}
                        onChange={e => setHoraInicio(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Fin
                    </label>
                    <input
                        type="time"
                        title="Hora fin de entrega"
                        value={horaFin}
                        onChange={e => setHoraFin(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
                    />
                </div>
            </div>

            {/* ── Volumen calculado ── */}
            {volumen > 0 && (
                <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    tipoEntrega === 'adicional'
                        ? 'bg-amber-900/20 border-amber-700/40'
                        : 'bg-sky-900/20 border-sky-700/40'
                }`}>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            Volumen calculado • {horas.toFixed(1)} h
                        </p>
                        <p className={`text-2xl font-black mt-0.5 ${
                            tipoEntrega === 'adicional' ? 'text-amber-300' : 'text-sky-300'
                        }`}>
                            {fmtM3(volumen)}
                        </p>
                    </div>
                    <TrendingUp size={28} className={tipoEntrega === 'adicional' ? 'text-amber-500/40' : 'text-sky-500/40'} />
                </div>
            )}

            {/* ── Motivo adicional ── */}
            {tipoEntrega === 'adicional' && (
                <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Motivo <span className="text-rose-400">*</span>
                    </label>
                    <input
                        type="text"
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        placeholder="ej. déficit lluvia, excedente presa, solicitud productor..."
                        className="w-full bg-slate-800 border border-amber-700/50 text-white rounded-lg px-3 py-2 text-sm"
                    />
                </div>
            )}

            {/* ── Notas opcionales ── */}
            <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Notas (opcional)
                </label>
                <input
                    type="text"
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder="Observaciones operativas..."
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
                />
            </div>

            {/* ── Registro existente hoy ── */}
            {registroHoy && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-lg">
                    <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                    <p className="text-[11px] text-amber-300">
                        Ya existe una entrega {tipoEntrega} para este módulo hoy. Guardar sobreescribirá ese registro.
                    </p>
                </div>
            )}

            {/* ── Botón guardar ── */}
            <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !selectedModuloId || !gastoLps || volumen <= 0}
                className={`w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 ${
                    tipoEntrega === 'adicional'
                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white'
                        : 'bg-gradient-to-r from-sky-600 to-blue-600 text-white'
                }`}
            >
                <Save size={16} />
                {isSaving ? 'Guardando...' : `Guardar entrega ${tipoEntrega}`}
            </button>

            {/* ── Balance del módulo ── */}
            {balanceModulo && (
                <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {balanceModulo.modulo_nombre}
                            {balanceModulo.zona_codigo && (
                                <span className="ml-2 text-slate-600">— {balanceModulo.zona_codigo}</span>
                            )}
                        </p>
                        <span className={`text-[10px] font-black ${estadoColor}`}>
                            {ESTADO_LABEL[balanceModulo.estado_volumen ?? 'normal']}
                        </span>
                    </div>

                    <div className="p-4 space-y-3">

                        {/* Zona primaria: mostrar dotación base + barra */}
                        {!esZonaSecundaria && balanceModulo.vol_base_m3 != null && (
                            <div>
                                <div className="flex justify-between text-[11px] mb-1">
                                    <span className="text-slate-400 font-semibold">Dotación base</span>
                                    <span className="text-white font-bold">{fmtM3(balanceModulo.vol_base_m3)}</span>
                                </div>
                                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-2 rounded-full transition-all ${
                                            pctBase >= 100 ? 'bg-rose-500' :
                                            pctBase >= 85  ? 'bg-amber-500' : 'bg-sky-500'
                                        }`}
                                        style={{ width: `${Math.min(pctBase, 100)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] mt-1 text-slate-500">
                                    <span>Consumido: {fmtM3(balanceModulo.vol_base_consumido_m3)}</span>
                                    <span className="font-bold">{pctBase.toFixed(1)}%</span>
                                </div>
                            </div>
                        )}

                        {/* Adicional capturado */}
                        {balanceModulo.vol_adicional_consumido_m3 > 0 && (
                            <div>
                                <div className="flex justify-between text-[11px] mb-1">
                                    <span className="text-amber-400 font-semibold">Adicional capturado</span>
                                    <span className="text-amber-300 font-bold">
                                        {fmtM3(balanceModulo.vol_adicional_consumido_m3)}
                                    </span>
                                </div>
                                {balanceModulo.ultimo_adicional_fecha && (
                                    <p className="text-[10px] text-slate-600">
                                        Último: {balanceModulo.ultimo_adicional_fecha}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Disponible (solo zona primaria) */}
                        {!esZonaSecundaria && (
                            <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                                <span className="text-[11px] text-slate-400">Disponible base</span>
                                <span className={`text-sm font-black ${
                                    (balanceModulo.vol_base_disponible_m3 ?? 0) <= 0
                                        ? 'text-rose-400'
                                        : 'text-emerald-400'
                                }`}>
                                    {(balanceModulo.vol_base_disponible_m3 ?? 0) > 0
                                        ? fmtM3(balanceModulo.vol_base_disponible_m3 ?? 0)
                                        : 'Agotado'}
                                </span>
                            </div>
                        )}

                        {balanceModulo.estado_volumen === 'base_agotado' && (
                            <div className="flex items-center gap-2 text-[11px] text-rose-300 bg-rose-900/20 border border-rose-800/40 rounded-lg px-3 py-2">
                                <AlertTriangle size={12} className="flex-shrink-0" />
                                Sin dotación base. Cualquier entrega se registra como adicional.
                            </div>
                        )}

                        {balanceModulo.estado_volumen === 'normal' &&
                            balanceModulo.vol_adicional_consumido_m3 === 0 && !esZonaSecundaria && (
                            <div className="flex items-center gap-2 text-[11px] text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
                                <CheckCircle2 size={12} className="flex-shrink-0" />
                                Dentro de dotación base. Sin adicionales en este ciclo.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
