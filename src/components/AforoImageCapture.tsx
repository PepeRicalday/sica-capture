import { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, XCircle, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

export interface AforoExtraido {
    punto_control?: string;
    fecha?: string;
    hora_inicio?: string;
    hora_fin?: string;
    escala_inicial?: number;
    escala_final?: number;
    molinete_modelo?: string;
    molinete_serie?: string;
    aforador?: string;
    tirante_m?: number;
    plantilla_m?: number;
    espejo_m?: number;
    area_total_m2?: number;
    gasto_total_m3s?: number;
    velocidad_media_ms?: number;
    dobelas?: Array<{
        base_m: number;
        tirante_m: number;
        revoluciones: number;
        lecturas: Array<{ tiempo_s: number }>;
    }>;
}

interface Props {
    onExtracted: (data: AforoExtraido) => void;
}

type Estado = 'idle' | 'preview' | 'extracting' | 'ok' | 'error';

export const AforoImageCapture = ({ onExtracted }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [estado, setEstado] = useState<Estado>('idle');
    const [preview, setPreview] = useState<string | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<string>('image/jpeg');

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
            const { data, error } = await supabase.functions.invoke('extract-aforo-imagen', {
                body: { image_base64: imageBase64, media_type: mediaType }
            });

            if (error) throw new Error(error.message);
            if (!data?.data) throw new Error('Respuesta vacía del servidor');

            onExtracted(data.data as AforoExtraido);
            setEstado('ok');
            toast.success('Datos del aforo extraídos correctamente');
        } catch (err: any) {
            console.error('Error extrayendo aforo:', err);
            setEstado('error');
            toast.error(`Error al extraer: ${err.message}`);
        }
    };

    const handleReset = () => {
        setEstado('idle');
        setPreview(null);
        setImageBase64(null);
    };

    return (
        <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-indigo-400 font-black uppercase tracking-wider flex items-center gap-1.5">
                    <ScanLine size={12} />
                    Captura desde Formato Impreso
                </span>
                {estado === 'ok' && (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-black border border-emerald-500/30">
                        DATOS APLICADOS
                    </span>
                )}
            </div>

            {/* Estado: idle */}
            {(estado === 'idle' || estado === 'ok') && (
                <button
                    onClick={() => inputRef.current?.click()}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-bold transition-all ${
                        estado === 'ok'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 active:scale-95'
                    }`}
                >
                    {estado === 'ok'
                        ? <><CheckCircle2 size={16} /> Capturar otra imagen</>
                        : <><Camera size={16} /> Fotografiar formato de aforo</>
                    }
                </button>
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
                            <ScanLine size={14} /> Extraer datos
                        </button>
                    </div>
                </div>
            )}

            {/* Estado: extracting */}
            {estado === 'extracting' && (
                <div className="flex flex-col items-center gap-2 py-4">
                    <Loader2 size={24} className="text-indigo-400 animate-spin" />
                    <span className="text-xs text-indigo-300 font-bold">Analizando imagen con IA...</span>
                    <span className="text-[10px] text-slate-500">Esto puede tomar unos segundos</span>
                </div>
            )}

            {/* Estado: error */}
            {estado === 'error' && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-red-400 text-xs">
                        <XCircle size={14} />
                        <span>No se pudo extraer los datos. Intenta con mejor imagen.</span>
                    </div>
                    <button
                        onClick={handleReset}
                        className="w-full py-2 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 text-xs font-bold"
                    >
                        Intentar de nuevo
                    </button>
                </div>
            )}

            {/* Input oculto — activa cámara en móvil */}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
            />
        </div>
    );
};
