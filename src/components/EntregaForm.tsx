import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { Save, Droplets, TrendingUp, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { db, type OfflinePoint, type ZonaCatalog, type ModuloBalance, type ModuloZona, type SicaRecord } from '../lib/db';
import { supabase } from '../lib/supabase';
import { getTodayString } from '../lib/dateHelpers';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { EntregaImageCapture, type EntregaInformeExtraido, type EntregaCeldaExtraida } from './EntregaImageCapture';
import { marcarTrabajoSinGuardar } from '../utils/trabajoSinGuardar';

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

// "Mod.1", "Mód.5", "Mod 12", "M12" → código_corto del catálogo ("M1".."M12")
const normalizeModuloLabel = (label: string): string | null => {
    const m = (label || '').match(/(\d+)/);
    return m ? `M${parseInt(m[1], 10)}` : null;
};

// Una fila de la cuadrícula resuelta a IDs reales del catálogo, lista para guardar/editar.
interface CeldaResuelta {
    key: string;             // modulo_id|zona_id — clave de upsert (igual que handleSave)
    modulo_id: string;
    modulo_label: string;    // texto del catálogo: "[M1] Módulo 1"
    zona_id: string;
    zona_codigo: string;
    gasto_m3s: number;
    nota?: string;
    es_primaria: boolean;
    incluir: boolean;        // checkbox de la tabla de revisión
    error?: string;          // p.ej. módulo/zona no encontrado o relación inexistente
}

// Un informe (día) en revisión. La foto puede traer uno o dos.
interface InformeRevision {
    fecha: string;           // YYYY-MM-DD editable
    sumaTotalOCR: number | null;
    celdas: CeldaResuelta[];
}

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

                if (resZonas.error) console.error('[EntregaForm] zonas_canal:', resZonas.error);
                if (resMZ.error)    console.error('[EntregaForm] modulo_zonas:', resMZ.error);
                if (resMod.error)   console.error('[EntregaForm] modulos:', resMod.error);
                if (resBal.error)   console.error('[EntregaForm] balance_volumen_modulo:', resBal.error);

                console.log('[EntregaForm] zonas rows:', resZonas.data?.length, '| modulos rows:', resMod.data?.length);

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

    // ── OCR: revisión de la(s) cuadrícula(s) extraída(s) del informe físico ──
    // Un array porque la foto puede traer uno o dos días apilados.
    const [informesRevision, setInformesRevision] = useState<InformeRevision[] | null>(null);
    const [savingGrid,        setSavingGrid]        = useState(false);

    // ── Aviso de captura en curso ───────────────────────────────────────────
    // Ver utils/trabajoSinGuardar.ts: bloquea la recarga automática por versión
    // nueva mientras haya datos escritos sin guardar. Incluye la cuadrícula del
    // OCR pendiente de revisión — reponerla exige volver a fotografiar el
    // informe físico, que en campo puede ya no estar a la mano.
    const hayCaptura = Boolean(
        gastoLps || motivo || notas || selectedModuloId || selectedZonaId ||
        (informesRevision && informesRevision.length > 0)
    );
    useEffect(() => {
        marcarTrabajoSinGuardar('entrega-form', hayCaptura);
        return () => marcarTrabajoSinGuardar('entrega-form', false);
    }, [hayCaptura]);

    // Resuelve una celda del OCR a (modulo_id, zona_id) reales del catálogo.
    const resolverCelda = (c: EntregaCeldaExtraida): CeldaResuelta => {
        const codigo = normalizeModuloLabel(c.modulo_label);
        const modulo = codigo
            ? modulos.find(m => (m.codigo_corto || '').toUpperCase() === codigo.toUpperCase())
            : undefined;
        const zona = zonas.find(z => z.codigo?.toUpperCase() === `Z${c.zona_numero}`);

        let error: string | undefined;
        if (!modulo) error = `Módulo "${c.modulo_label}" no está en el catálogo`;
        else if (!zona) error = `Zona ${c.zona_numero} no encontrada`;

        // Validar que el módulo realmente sirve esa zona (modulo_zonas)
        let es_primaria = false;
        if (modulo && zona) {
            const rel = moduloZonas.find(mz => mz.modulo_id === modulo.id && mz.zona_id === zona.id);
            if (!rel) error = `${codigo} no opera en Z${c.zona_numero} (revisar)`;
            else es_primaria = rel.es_primaria;
        }

        return {
            key:          `${modulo?.id ?? '?'}|${zona?.id ?? '?'}`,
            modulo_id:    modulo?.id ?? '',
            modulo_label: modulo ? `${codigo} ${modulo.nombre}` : c.modulo_label,
            zona_id:      zona?.id ?? '',
            zona_codigo:  zona?.codigo ?? `Z${c.zona_numero}`,
            gasto_m3s:    c.gasto_m3s,
            nota:         c.nota,
            es_primaria,
            incluir:      !error,    // por defecto se incluyen solo las válidas
            error,
        };
    };

    // Recibe uno o dos informes del OCR y los prepara para revisión.
    const resolverInformes = (informes: EntregaInformeExtraido[]) => {
        const hoy = getTodayString();
        const revisiones: InformeRevision[] = informes.map(inf => ({
            fecha:        inf.fecha || hoy,
            sumaTotalOCR: inf.suma_total_m3s ?? null,
            celdas:       inf.celdas.map(resolverCelda),
        }));
        setInformesRevision(revisiones);
    };

    // Guarda todas las celdas marcadas de todos los informes (m³/s → L/s).
    // Reusa la misma clave de upsert (modulo_id, zona_id, tipo_entrega, fecha) que handleSave.
    const guardarCuadricula = async () => {
        if (!informesRevision) return;
        const planes = informesRevision.flatMap(inf =>
            inf.celdas
                .filter(c => c.incluir && !c.error && c.gasto_m3s > 0)
                .map(c => ({ celda: c, fecha: inf.fecha }))
        );
        if (planes.length === 0) {
            toast.error('No hay celdas válidas para guardar.');
            return;
        }
        setSavingGrid(true);
        try {
            const horaCaptura = new Date().toTimeString().slice(0, 8);
            for (const { celda: c, fecha } of planes) {
                const gastoLpsVal = Math.round(c.gasto_m3s * 1000); // m³/s → L/s
                const existente = await db.records
                    .filter(r =>
                        r.tipo === 'entrega' &&
                        r.modulo_id === c.modulo_id &&
                        r.fecha_captura === fecha &&
                        r.tipo_entrega === 'base' &&
                        r.zona_id === c.zona_id
                    )
                    .first();

                await db.records.put({
                    id:                  existente?.id ?? uuidv4(),
                    tipo:                'entrega' as const,
                    punto_id:            c.modulo_id,
                    modulo_id:           c.modulo_id,
                    zona_id:             c.zona_id,
                    ciclo_id:            cicloActivoId || undefined,
                    fecha_captura:       fecha,
                    hora_captura:        horaCaptura,
                    valor_q:             gastoLpsVal,
                    tipo_entrega:        'base' as const,
                    hora_inicio_entrega: '06:00:00',
                    hora_fin_entrega:    '18:00:00',
                    horas_operacion:     12,
                    volumen_m3:          calcVolumen(gastoLpsVal, 12),
                    estado_operativo:    existente ? 'modificacion' as const : 'inicio' as const,
                    notas:               `Informe Jefes de Zona ${fecha}` + (c.nota ? ` · sangría ${c.nota}` : ''),
                    responsable_id:      profile?.id,
                    responsable_nombre:  profile?.nombre || 'Operador',
                    sincronizado:        'false' as const,
                });
            }
            const dias = new Set(planes.map(p => p.fecha)).size;
            toast.success(
                dias > 1
                    ? `${planes.length} entregas guardadas (${dias} días)`
                    : `${planes.length} entregas guardadas del informe ${planes[0].fecha}`
            );
            setInformesRevision(null);
            onSaved?.();
        } catch (e) {
            console.error('[EntregaForm] guardarCuadricula:', e);
            toast.error('Error al guardar la cuadrícula');
        } finally {
            setSavingGrid(false);
        }
    };

    // Helpers de edición sobre informesRevision[idxInf].celdas[idxCelda]
    const patchCelda = (idxInf: number, idxCelda: number, patch: Partial<CeldaResuelta>) =>
        setInformesRevision(prev => prev!.map((inf, i) =>
            i !== idxInf ? inf : {
                ...inf,
                celdas: inf.celdas.map((c, j) => j === idxCelda ? { ...c, ...patch } : c),
            }));
    const patchFecha = (idxInf: number, fecha: string) =>
        setInformesRevision(prev => prev!.map((inf, i) => i === idxInf ? { ...inf, fecha } : inf));

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

    // Registro existente hoy (para advertencia de sobreescritura)
    const registroHoy = useLiveQuery(
        async () => {
            if (!selectedModuloId) return null;
            const zonasDelMod = moduloZonas.filter(mz => mz.modulo_id === selectedModuloId);
            const efectivaZona = selectedZonaId ||
                (zonasDelMod.length === 1 ? zonasDelMod[0].zona_id : undefined);
            return db.records
                .filter(r =>
                    r.tipo === 'entrega' &&
                    r.modulo_id === selectedModuloId &&
                    r.fecha_captura === fecha &&
                    r.tipo_entrega === tipoEntrega &&
                    (efectivaZona === undefined || r.zona_id === efectivaZona)
                )
                .first();
        },
        [selectedModuloId, fecha, tipoEntrega, selectedZonaId, moduloZonas]
    );

    // Última entrega activa (puede ser de días anteriores — continuidad)
    // undefined = cargando | null = no hay entrega activa | SicaRecord = activa
    const ultimaEntrega = useLiveQuery(
        async (): Promise<SicaRecord | null> => {
            if (!selectedModuloId) return null;
            const registros = await db.records
                .filter(r =>
                    r.tipo === 'entrega' &&
                    r.modulo_id === selectedModuloId &&
                    r.tipo_entrega === tipoEntrega &&
                    // Multizona: aislar continuidad por zona — M2/Z2 y M2/Z3 son independientes
                    (!selectedZonaId || r.zona_id === selectedZonaId)
                )
                .toArray();
            if (registros.length === 0) return null;
            registros.sort((a, b) => {
                const dc = b.fecha_captura.localeCompare(a.fecha_captura);
                return dc !== 0 ? dc : b.hora_captura.localeCompare(a.hora_captura);
            });
            const ultimo = registros[0];
            if (ultimo.estado_operativo === 'cierre' || (ultimo.valor_q ?? 0) <= 0) return null;
            return ultimo;
        },
        [selectedModuloId, tipoEntrega, selectedZonaId]
    ) as SicaRecord | null | undefined;

    // Pre-llenar formulario desde entrega activa al cambiar módulo/zona/tipo.
    // Si no hay entrega activa, resetear campos para que no queden valores de otro contexto.
    useEffect(() => {
        if (ultimaEntrega === undefined) return; // cargando — no tocar
        if (!ultimaEntrega) {
            setGastoLps('');
            setMotivo('');
            setNotas('');
            setHoraInicio('06:00');
            setHoraFin('18:00');
            return;
        }
        if (ultimaEntrega.tipo_entrega !== tipoEntrega) return;
        setGastoLps(String(ultimaEntrega.valor_q ?? ''));
        if (ultimaEntrega.hora_inicio_entrega) setHoraInicio(ultimaEntrega.hora_inicio_entrega.slice(0, 5));
        if (ultimaEntrega.hora_fin_entrega)    setHoraFin(ultimaEntrega.hora_fin_entrega.slice(0, 5));
        if (tipoEntrega === 'adicional' && ultimaEntrega.motivo_adicional) setMotivo(ultimaEntrega.motivo_adicional);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ultimaEntrega, tipoEntrega, selectedModuloId, selectedZonaId]);

    // Cierre explícito de entrega activa
    const handleCierre = async () => {
        if (!ultimaEntrega?.modulo_id) return;
        setIsSaving(true);
        try {
            await db.records.put({
                id:                   uuidv4(),
                tipo:                 'entrega' as const,
                punto_id:             ultimaEntrega.modulo_id,
                modulo_id:            ultimaEntrega.modulo_id,
                zona_id:              ultimaEntrega.zona_id,
                ciclo_id:             cicloActivoId || ultimaEntrega.ciclo_id || undefined,
                tipo_entrega:         ultimaEntrega.tipo_entrega ?? 'base',
                valor_q:              0,
                hora_inicio_entrega:  ultimaEntrega.hora_inicio_entrega,
                hora_fin_entrega:     ultimaEntrega.hora_fin_entrega,
                horas_operacion:      0,
                volumen_m3:           0,
                estado_operativo:     'cierre' as const,
                fecha_captura:        getTodayString(),
                hora_captura:         new Date().toTimeString().slice(0, 8),
                responsable_id:       profile?.id,
                responsable_nombre:   profile?.nombre || 'Operador',
                sincronizado:         'false' as const,
                notas:                'Cierre manual de entrega',
            });
            toast.success('Entrega cerrada — se sincronizará al conectar');
            onSaved?.();
        } catch {
            toast.error('Error al registrar cierre');
        } finally {
            setIsSaving(false);
        }
    };

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
        const zonasDelModuloActual = moduloZonas.filter(mz => mz.modulo_id === selectedModuloId);
        const esMultiZona = zonasDelModuloActual.length > 1;
        if (esMultiZona && !selectedZonaId) {
            toast.error('Selecciona la zona antes de guardar (módulo multizona).');
            return;
        }
        // Para módulos de zona única, auto-asignar su zona aunque SRL no la seleccionó
        const efectivaZonaId = selectedZonaId ||
            (zonasDelModuloActual.length === 1 ? zonasDelModuloActual[0].zona_id : undefined);

        // Determinar estado: 'inicio' si no hay entrega activa, 'modificacion' si la hay
        const estadoOp: SicaRecord['estado_operativo'] = ultimaEntrega ? 'modificacion' : 'inicio';

        setIsSaving(true);
        try {
            // Consulta fresca a Dexie para evitar el ID stale de useLiveQuery cuando
            // el usuario cambia tipoEntrega y guarda antes de que el query reactivo se actualice.
            // Sin esto: al cambiar BASE→ADICIONAL y guardar rápido, registroHoy devuelve
            // el ID del registro BASE y db.records.put() lo sobreescribe con tipo_entrega='adicional'.
            // Multizona: incluir zona_id en la clave de upsert para que M2/Z2 y M2/Z3
            // sean registros independientes y no se sobreescriban entre sí.
            const registroHoyFresh = await db.records
                .filter(r =>
                    r.tipo === 'entrega' &&
                    r.modulo_id === selectedModuloId &&
                    r.fecha_captura === fecha &&
                    r.tipo_entrega === tipoEntrega &&
                    (efectivaZonaId === undefined || r.zona_id === efectivaZonaId)
                )
                .first();

            const record = {
                id:                   registroHoyFresh?.id ?? uuidv4(),
                tipo:                 'entrega' as const,
                punto_id:             selectedModuloId,
                modulo_id:            selectedModuloId,
                zona_id:              efectivaZonaId || undefined,
                ciclo_id:             cicloActivoId || undefined,
                fecha_captura:        fecha,
                hora_captura:         new Date().toTimeString().slice(0, 8),
                valor_q:              parseFloat(gastoLps),
                tipo_entrega:         tipoEntrega,
                hora_inicio_entrega:  `${horaInicio}:00`,
                hora_fin_entrega:     `${horaFin}:00`,
                horas_operacion:      horas,
                volumen_m3:           volumen,
                estado_operativo:     estadoOp,
                motivo_adicional:     tipoEntrega === 'adicional' ? motivo.trim() : undefined,
                notas:                notas.trim() || undefined,
                responsable_id:       profile?.id,
                responsable_nombre:   profile?.nombre || 'Operador',
                sincronizado:         'false' as const,
            };

            await db.records.put(record);
            toast.success(
                ultimaEntrega
                    ? 'Entrega modificada — continúa con el nuevo gasto'
                    : `Entrega ${tipoEntrega} iniciada — continúa automáticamente`
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

    const totalIncluidas = useMemo(
        () => (informesRevision ?? []).reduce(
            (n, inf) => n + inf.celdas.filter(c => c.incluir && !c.error).length, 0),
        [informesRevision]
    );

    return (
        <div className="space-y-4 pb-6">

            {/* ── OCR: captura del Informe Diario de Jefes de Zona ── */}
            <EntregaImageCapture onExtracted={resolverInformes} />

            {/* ── Revisión de la(s) cuadrícula(s) extraída(s) — uno o dos días ── */}
            {informesRevision && (
                <div className="rounded-xl border border-indigo-500/40 bg-slate-900/80 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-indigo-500/10">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                                Revisar gastos del informe
                            </p>
                            <p className="text-[10px] text-slate-400">
                                {informesRevision.length > 1
                                    ? `${informesRevision.length} días detectados · ajusta y confirma`
                                    : 'Ajusta y confirma'}
                            </p>
                        </div>
                        <button
                            type="button"
                            title="Descartar"
                            onClick={() => setInformesRevision(null)}
                            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {informesRevision.map((inf, idxInf) => {
                        const totalM3s = inf.celdas
                            .filter(c => c.incluir && !c.error)
                            .reduce((s, c) => s + (c.gasto_m3s || 0), 0);
                        const desfase = inf.sumaTotalOCR != null && Math.abs(totalM3s - inf.sumaTotalOCR) > 0.05;
                        return (
                            <div key={idxInf} className={idxInf > 0 ? 'border-t-4 border-slate-800' : ''}>
                                {/* Fecha del informe (una por día) */}
                                <div className="px-4 pt-3">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                                        {informesRevision.length > 1 ? `Informe ${idxInf + 1} — fecha` : 'Fecha del informe'}
                                    </label>
                                    <input
                                        type="date"
                                        title="Fecha del informe"
                                        value={inf.fecha}
                                        max={getTodayString()}
                                        onChange={e => patchFecha(idxInf, e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>

                                {/* Tabla de celdas */}
                                <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
                                    {inf.celdas.map((c, idxCelda) => (
                                        <div
                                            key={`${c.key}-${idxCelda}`}
                                            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
                                                c.error
                                                    ? 'bg-rose-900/20 border-rose-800/50'
                                                    : c.incluir
                                                        ? 'bg-slate-800/60 border-slate-700'
                                                        : 'bg-slate-800/20 border-slate-800 opacity-60'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                title="Incluir esta entrega"
                                                checked={c.incluir}
                                                disabled={!!c.error}
                                                onChange={e => patchCelda(idxInf, idxCelda, { incluir: e.target.checked })}
                                                className="w-4 h-4 flex-shrink-0 accent-indigo-500"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-white truncate">
                                                    {c.modulo_label}
                                                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">{c.zona_codigo}</span>
                                                    {!c.es_primaria && !c.error && (
                                                        <span className="ml-1.5 text-[9px] text-sky-400">2ª</span>
                                                    )}
                                                </p>
                                                {c.error
                                                    ? <p className="text-[10px] text-rose-400">{c.error}</p>
                                                    : c.nota && <p className="text-[10px] text-slate-500">sangría {c.nota}</p>}
                                            </div>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.001"
                                                    title="Gasto m³/s"
                                                    value={c.gasto_m3s}
                                                    disabled={!!c.error}
                                                    onChange={e => patchCelda(idxInf, idxCelda, { gasto_m3s: parseFloat(e.target.value) || 0 })}
                                                    className="w-20 bg-slate-900 border border-slate-700 text-white rounded-md px-2 py-1 text-xs text-right font-bold disabled:opacity-50"
                                                />
                                                <span className="text-[10px] text-slate-500 w-7">m³/s</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Total y verificación contra Suma Total del formato */}
                                <div className="px-4 py-2 border-t border-slate-700/60 flex items-center justify-between text-[11px]">
                                    <span className="text-slate-400 font-semibold">
                                        Σ incluidos: <span className="text-white font-bold">{totalM3s.toFixed(3)} m³/s</span>
                                    </span>
                                    {inf.sumaTotalOCR != null && (
                                        <span className={desfase ? 'text-amber-400' : 'text-emerald-400'}>
                                            Suma Total formato: {inf.sumaTotalOCR.toFixed(3)}{desfase && ' ⚠'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    <div className="p-3">
                        <button
                            type="button"
                            onClick={guardarCuadricula}
                            disabled={savingGrid || totalIncluidas === 0}
                            className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white disabled:opacity-40"
                        >
                            <Save size={16} />
                            {savingGrid ? 'Guardando…' : `Guardar ${totalIncluidas} entregas`}
                        </button>
                    </div>
                </div>
            )}

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

            {/* ── Estado de entrega activa ─────────────────────────────────── */}
            {ultimaEntrega && (
                <div className="flex items-center justify-between px-4 py-3 bg-emerald-900/20 border border-emerald-700/40 rounded-xl">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-0.5">
                            Entrega activa — continúa automáticamente
                        </p>
                        <p className="text-white font-bold text-sm">
                            {(ultimaEntrega.valor_q ?? 0).toLocaleString('es-MX')} L/s
                            <span className="ml-2 text-slate-400 font-normal text-[11px]">
                                {ultimaEntrega.hora_inicio_entrega?.slice(0, 5)}–{ultimaEntrega.hora_fin_entrega?.slice(0, 5)}
                            </span>
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            Último registro: {ultimaEntrega.fecha_captura} · Para modificar, captura abajo
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleCierre}
                        disabled={isSaving}
                        className="ml-3 flex-shrink-0 px-3 py-2 text-[11px] font-black uppercase tracking-wider bg-rose-900/40 border border-rose-700/50 text-rose-300 rounded-lg disabled:opacity-40"
                    >
                        Cerrar
                    </button>
                </div>
            )}

            {selectedModuloId && !loadingCat && ultimaEntrega === null && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/30 border border-slate-700/30 rounded-lg">
                    <div className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
                    <p className="text-[11px] text-slate-500">Sin entrega activa — iniciar nueva entrega</p>
                </div>
            )}

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
            {registroHoy && registroHoy.tipo_entrega === tipoEntrega && (
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
                {isSaving
                    ? 'Guardando...'
                    : ultimaEntrega
                        ? `Modificar entrega ${tipoEntrega}`
                        : `Iniciar entrega ${tipoEntrega}`}
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
