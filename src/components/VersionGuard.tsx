/**
 * VersionGuard v3.0 — Sistema Robusto de Control de Versiones
 * 
 * REGLAS:
 * 1. NUNCA bloquea la app completamente — siempre permite el uso.
 * 2. Solo muestra un banner informativo (no-bloqueante) si la versión
 *    local es MENOR que min_supported_version en Supabase.
 * 3. Si no hay conexión o falla la consulta → pasa silenciosamente.
 * 4. El banner se puede cerrar y no vuelve a aparecer en esa sesión.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert, Droplets } from 'lucide-react';

const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const isVersionLower = (current: string, min: string): boolean => {
    const c = current.split('.').map(Number);
    const m = min.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((c[i] || 0) < (m[i] || 0)) return true;
        if ((c[i] || 0) > (m[i] || 0)) return false;
    }
    return false;
};

export const VersionGuard = ({ children }: { children: ReactNode }) => {
    const [showBanner, setShowBanner] = useState(false);
    const [serverVersion, setServerVersion] = useState('');

    useEffect(() => {
        const SESSION_KEY = 'sica_version_dismissed';

        // Si ya fue descartado en esta sesión, no volver a preguntar
        if (sessionStorage.getItem(SESSION_KEY) === CURRENT_VERSION) return;

        const checkVersion = async () => {
            try {
                if (!navigator.onLine) return;

                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version, min_supported_version')
                    .eq('app_id', 'capture')
                    .single();

                if (error || !data) return;

                // Solo bloquear si min_supported es mayor que la local
                if (isVersionLower(CURRENT_VERSION, data.min_supported_version)) {
                    setServerVersion(data.min_supported_version);
                    setShowBanner(true);
                }
            } catch {
                // Fail-safe: NUNCA bloquear por error de red
            }
        };

        checkVersion();
    }, []);


    const handleUpdate = async () => {
        try {
            // 1. Desregistrar Service Workers
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
            // 2. Limpiar caches del navegador
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (e) {
            console.warn('Cache clear partial:', e);
        }
        // 3. Forzar recarga limpia
        window.location.replace(window.location.origin + '?v=' + Date.now());
    };

    return (
        <>
            {showBanner && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-xl z-[99999] flex items-center justify-center p-6 text-center">
                    <div className="max-w-sm w-full bg-slate-900 border border-orange-500/30 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-500">
                        <div className="w-20 h-20 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
                            <ShieldAlert size={40} className="text-orange-500 animate-bounce" />
                        </div>
                        
                        <h2 className="text-2xl font-black text-white mb-4 tracking-tighter">NUEVA VERSIÓN REQUERIDA</h2>
                        <p className="text-base text-slate-400 mb-10 leading-relaxed">
                            Para reportar aforos, debes actualizar SICA Capture a la <b>v{serverVersion}</b>.
                        </p>

                        <button
                            onClick={handleUpdate}
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
            )}
            {children}
        </>
    );
};
