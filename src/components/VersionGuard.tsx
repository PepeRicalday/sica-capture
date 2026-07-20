/**
 * VersionGuard v4.0 — Actualización forzada desde la nube (SICA Capture)
 *
 * QUÉ RESUELVE
 * Las capas del PWA (epoch, sw-purge, polling del SW) viven DENTRO del bundle:
 * solo las ejecuta quien ya bajó la versión nueva. Un dispositivo anclado en
 * una versión vieja nunca las corre — es circular. Este guardián rompe el
 * círculo porque consulta Supabase, que responde igual sea cual sea el bundle
 * que el dispositivo esté ejecutando.
 *
 * CÓMO DECIDE
 * Compara la versión compilada contra `version` en app_versions (no contra
 * `min_supported_version`: el deploy iguala mínimo y versión, así que ese
 * campo nunca dispara nada). Si la nube va adelante:
 *
 *   · sin captura en curso  → purga y recarga SOLA, sin preguntar.
 *   · con captura en curso  → banner no bloqueante; el operador elige cuándo.
 *     Al terminar de guardar, la actualización procede sola.
 *
 * `min_supported_version` se conserva para el caso duro: si la versión local
 * quedó por debajo del mínimo, el banner sí bloquea, porque seguir capturando
 * con un bundle incompatible corrompería datos.
 *
 * NUNCA bloquea por error de red o falta de conexión.
 */
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert, Droplets } from 'lucide-react';
import { hayTrabajoSinGuardar, observarTrabajoSinGuardar } from '../utils/trabajoSinGuardar';

const CURRENT_VERSION = typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : '0.0.0';

/** ¿`a` es una versión menor que `b`? Compara major.minor.patch. */
const esVersionMenor = (a: string, b: string): boolean => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) < (y[i] || 0)) return true;
        if ((x[i] || 0) > (y[i] || 0)) return false;
    }
    return false;
};

/** Purga SW + cachés y recarga contra el origen, sorteando la caché del navegador. */
const purgarYRecargar = async (): Promise<void> => {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (e) {
        // Purga parcial: recargamos igual — mejor intentarlo que quedar anclado.
        console.warn('Purga de caché incompleta:', e);
    }
    window.location.replace(`${window.location.origin}?v=${Date.now()}`);
};

const INTERVALO_SONDEO_MS = 10 * 60 * 1000;   // 10 min

export const VersionGuard = ({ children }: { children: ReactNode }) => {
    const [mostrarBanner, setMostrarBanner] = useState(false);
    const [versionNube, setVersionNube] = useState('');
    const [bloqueante, setBloqueante] = useState(false);
    // Evita disparar dos recargas si el sondeo y el aviso de "ya guardé"
    // coinciden; window.location.replace no es instantáneo.
    const recargando = useRef(false);
    // Leídos dentro de callbacks de larga vida (intervalo, observador). Como
    // refs, esos callbacks ven el valor actual sin tener que recrearse —el
    // efecto se monta una sola vez y el intervalo no se reinicia solo.
    const bannerRef = useRef(false);
    const bloqueanteRef = useRef(false);

    useEffect(() => {
        let vivo = true;

        const aplicar = () => {
            if (recargando.current) return;
            recargando.current = true;
            void purgarYRecargar();
        };

        const consultar = async () => {
            if (!vivo || recargando.current || !navigator.onLine) return;
            try {
                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version, min_supported_version')
                    .eq('app_id', 'capture')
                    .single();

                if (!vivo || error || !data?.version) return;
                if (!esVersionMenor(CURRENT_VERSION, data.version)) return;

                // Por debajo del mínimo soportado: capturar con este bundle
                // puede escribir datos mal formados. El banner bloquea.
                const incompatible = Boolean(
                    data.min_supported_version &&
                    esVersionMenor(CURRENT_VERSION, data.min_supported_version)
                );

                if (!incompatible && !hayTrabajoSinGuardar()) {
                    aplicar();
                    return;
                }

                setVersionNube(data.version);
                setBloqueante(incompatible);
                bloqueanteRef.current = incompatible;
                setMostrarBanner(true);
                bannerRef.current = true;
            } catch {
                // Fail-safe: jamás interrumpir la captura por un fallo de red.
            }
        };

        void consultar();
        const id = setInterval(consultar, INTERVALO_SONDEO_MS);

        // El operador terminó de guardar: si había una versión nueva esperando
        // y no es un caso bloqueante, se aplica en ese momento.
        const dejarDeObservar = observarTrabajoSinGuardar((hay) => {
            if (!hay && bannerRef.current && !bloqueanteRef.current) aplicar();
        });

        // Al volver del segundo plano, revisar antes que el siguiente intervalo.
        const alVolver = () => {
            if (document.visibilityState === 'visible') void consultar();
        };
        document.addEventListener('visibilitychange', alVolver);

        return () => {
            vivo = false;
            clearInterval(id);
            dejarDeObservar();
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, []);

    return (
        <>
            {mostrarBanner && (
                bloqueante ? (
                    // Incompatible: no se permite seguir capturando.
                    <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-xl z-[99999] flex items-center justify-center p-6 text-center">
                        <div className="max-w-sm w-full bg-slate-900 border border-orange-500/30 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-500">
                            <div className="w-20 h-20 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
                                <ShieldAlert size={40} className="text-orange-500 animate-bounce" />
                            </div>
                            <h2 className="text-2xl font-black text-white mb-4 tracking-tighter">NUEVA VERSIÓN REQUERIDA</h2>
                            <p className="text-base text-slate-400 mb-10 leading-relaxed">
                                Para reportar aforos, debes actualizar SICA Capture a la <b>v{versionNube}</b>.
                            </p>
                            <button
                                onClick={() => void purgarYRecargar()}
                                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl active:scale-95 flex items-center justify-center gap-4 text-lg"
                            >
                                <Droplets size={22} />
                                ACTUALIZAR AHORA
                            </button>
                            <div className="mt-8 text-[11px] text-slate-600 uppercase tracking-[0.2em] font-bold">
                                SICA CAPTURE • MÓDULO RIEGO
                            </div>
                        </div>
                    </div>
                ) : (
                    // Hay captura en curso: avisar sin estorbar. La actualización
                    // se aplica sola en cuanto el operador guarde.
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] w-[90%] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-[#1e293b] border border-orange-500/50 rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="bg-orange-500/20 p-2 rounded-xl shrink-0">
                                    <ShieldAlert className="text-orange-500" size={20} />
                                </div>
                                <div>
                                    <h4 className="text-white text-sm font-bold">Actualización v{versionNube} lista</h4>
                                    <p className="text-slate-400 text-xs">Se aplicará al guardar tu captura.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => void purgarYRecargar()}
                                className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-lg shrink-0"
                            >
                                Ahora
                            </button>
                        </div>
                    </div>
                )
            )}
            {children}
        </>
    );
};
