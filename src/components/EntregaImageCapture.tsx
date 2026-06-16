import { useRef, useState } from 'react';
import { Camera, Image, Loader2, XCircle, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

/**
 * Una celda de la matriz Zona×Módulo del "Informe Diario de Jefes de Zona".
 * El formato físico anota el gasto en m³/s en la celda donde se cruzan
 * la fila de Zona (1–4) y la columna de Módulo (Mod.1…Mod.12).
 */
export interface EntregaCeldaExtraida {
    modulo_label: string;   // "Mod.1", "Mod.2", "Mód.5", "Mod.12" — texto exacto de la columna
    zona_numero:  number;   // 1 | 2 | 3 | 4 — número de la fila
    gasto_m3s:    number;   // gasto leído en la celda (m³/s)
    nota?:        string;   // anotación pequeña sobre la celda (ej. "0.150 0.060" — sangrías/parciales)
}

export interface EntregaInformeExtraido {
    fecha?:        string;  // "YYYY-MM-DD" — del encabezado "Fecha: ..."
    hora?:         string;  // "HH:MM" — típicamente "12:00"
    suma_total_m3s?: number; // "Suma Total" reportada en el formato (verificación)
    celdas:        EntregaCeldaExtraida[];
}

interface Props {
    // Recibe TODOS los informes detectados en la foto (uno o dos días apilados).
    onExtracted: (informes: EntregaInformeExtraido[]) => void;
}

type Estado = 'idle' | 'preview' | 'extracting' | 'ok' | 'error';

export const EntregaImageCapture = ({ onExtracted }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const galleryRef = useRef<HTMLInputElement>(null);
    const [estado, setEstado] = useState<Estado>('idle');
    const [preview, setPreview] = useState<string | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<string>('image/jpeg');
    const [errorMsg, setErrorMsg] = useState<string>('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setMediaType(file.type || 'image/jpeg');
        const reader = new FileReader();
        reader.onload = ev => {
            const result = ev.target?.result as string;
            // result = "data:image/jpeg;base64,XXXXX"
            const base64 = result.split(',')[1];
            setImageBase64(base64);
            setPreview(result);
            setEstado('preview');
        };
        reader.readAsDataURL(file);
        // Reset input so same file can be re-selected
        e.target.value = '';
    };

    const handleExtraer = async () => {
        if (!imageBase64) return;
        setEstado('extracting');

        try {
            const { data, error } = await supabase.functions.invoke('extract-entregas-imagen', {
                body: { image_base64: imageBase64, media_type: mediaType }
            });

            if (error) {
                // En errores non-2xx, el SDK guarda la respuesta en error.context;
                // intentamos leer el {error:"..."} real que devuelve la función.
                let detalle = error.message;
                try {
                    const body = await (error as any).context?.json?.();
                    if (body?.error) detalle = body.error;
                } catch { /* sin cuerpo legible */ }
                throw new Error(detalle);
            }
            // La función devolvió { error: "..." } en lugar de { data: ... }
            if (data?.error) throw new Error(data.error);
            if (!data?.data) throw new Error('Respuesta vacía del servidor');

            // Servidor devuelve { informes: [...] }; tolera la forma antigua (un informe suelto).
            const payload = data.data as { informes?: EntregaInformeExtraido[] } | EntregaInformeExtraido;
            const informes: EntregaInformeExtraido[] = Array.isArray((payload as any).informes)
                ? (payload as { informes: EntregaInformeExtraido[] }).informes
                : [payload as EntregaInformeExtraido];

            const conGastos = informes.filter(inf => inf.celdas?.length);
            if (conGastos.length === 0) throw new Error('No se detectaron gastos en la cuadrícula');

            onExtracted(conGastos);
            setEstado('ok');
            const totalCeldas = conGastos.reduce((s, inf) => s + inf.celdas.length, 0);
            toast.success(
                conGastos.length > 1
                    ? `${conGastos.length} informes · ${totalCeldas} gastos extraídos`
                    : `${totalCeldas} gastos extraídos del informe`
            );
        } catch (err: any) {
            console.error('Error extrayendo informe de entregas:', err);
            setEstado('error');
            setErrorMsg(err.message || 'Error desconocido');
            toast.error(err.message, { duration: 8000 });
        }
    };

    const handleReset = () => {
        setEstado('idle');
        setPreview(null);
        setImageBase64(null);
        setErrorMsg('');
    };

    return (
        <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-indigo-400 font-black uppercase tracking-wider flex items-center gap-1.5">
                    <ScanLine size={12} />
                    Capturar Informe Diario de Jefes de Zona
                </span>
                {estado === 'ok' && (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-black border border-emerald-500/30">
                        GASTOS EXTRAÍDOS
                    </span>
                )}
            </div>

            {/* Estado: idle */}
            {(estado === 'idle' || estado === 'ok') && (
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-sm font-bold active:scale-95 transition-all"
                    >
                        <Camera size={15} /> Cámara
                    </button>
                    <button
                        type="button"
                        onClick={() => galleryRef.current?.click()}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 text-sm font-bold active:scale-95 transition-all"
                    >
                        <Image size={15} /> Galería
                    </button>
                    {estado === 'ok' && (
                        <span className="col-span-2 text-center text-[10px] text-emerald-400 font-bold">
                            ↑ Capturar otro informe
                        </span>
                    )}
                </div>
            )}

            {/* Estado: preview */}
            {estado === 'preview' && preview && (
                <div className="flex flex-col gap-2">
                    <div className="relative rounded-lg overflow-hidden border border-slate-700 max-h-48">
                        <img src={preview} alt="Vista previa" className="w-full h-full object-contain bg-slate-900" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={handleReset}
                            className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 text-xs font-bold"
                        >
                            <XCircle size={14} /> Cancelar
                        </button>
                        <button
                            onClick={handleExtraer}
                            className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-indigo-500/50 bg-indigo-500/20 text-indigo-300 text-xs font-bold active:scale-95"
                        >
                            <ScanLine size={14} /> Extraer gastos
                        </button>
                    </div>
                </div>
            )}

            {/* Estado: extracting */}
            {estado === 'extracting' && (
                <div className="flex flex-col items-center gap-2 py-4">
                    <Loader2 size={24} className="text-indigo-400 animate-spin" />
                    <span className="text-xs text-indigo-300 font-bold">Analizando cuadrícula con IA...</span>
                    <span className="text-[10px] text-slate-500">Esto puede tomar unos segundos</span>
                </div>
            )}

            {/* Estado: error */}
            {estado === 'error' && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-red-400 text-xs">
                        <XCircle size={14} className="shrink-0 mt-0.5" />
                        <span className="break-all">{errorMsg || 'Error al extraer datos'}</span>
                    </div>
                    <button
                        onClick={handleReset}
                        className="w-full py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 text-xs font-bold"
                    >
                        Intentar de nuevo
                    </button>
                </div>
            )}

            {/* Input cámara — abre cámara directamente en móvil */}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
            />
            {/* Input galería — abre selector de archivos/fotos */}
            <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                title="Seleccionar imagen de galería"
                className="hidden"
                onChange={handleFileChange}
            />
        </div>
    );
};
