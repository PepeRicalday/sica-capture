import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert } from 'lucide-react';

interface VersionInfo {
    version: string;
    min_supported_version: string;
    update_url: string;
    build_hash: string;
}

const CURRENT_VERSION = __APP_VERSION__;
const BUILD_HASH = __BUILD_HASH__;

export const VersionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [status, setStatus] = useState<'checking' | 'ok' | 'hard_update' | 'error'>('checking');
    const [serverInfo, setServerInfo] = useState<VersionInfo | null>(null);

    useEffect(() => {
        const checkVersion = async () => {
            try {
                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version, min_supported_version, update_url, build_hash')
                    .eq('app_id', 'capture')
                    .single();

                if (error) throw error;
                if (!data) return setStatus('ok');

                setServerInfo(data);

                // Check for Hard Update (current < min_supported)
                if (isVersionLower(CURRENT_VERSION, data.min_supported_version)) {
                    setStatus('hard_update');
                    return;
                }

                // Security Check (Hash mismatch)
                if (BUILD_HASH !== 'initial-dev' && BUILD_HASH !== data.build_hash) {
                    console.warn('SICA Security: Build hash mismatch detected.');
                }

                setStatus('ok');
            } catch (err) {
                console.error('Failed to check version:', err);
                // Fail-safe: if offline or error, allow entry but log it
                setStatus('ok');
            }
        };

        checkVersion();
    }, []);

    // Aggressive cache clearing on hard update
    useEffect(() => {
        if (status === 'hard_update') {
            const clearCaches = async () => {
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                    }
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        for (let name of cacheNames) {
                            await caches.delete(name);
                        }
                    }
                    console.log('Caches cleared due to hard update requirement.');
                } catch (e) {
                    console.error('Error clearing caches:', e);
                }
            };
            clearCaches();
        }
    }, [status]);

    const isVersionLower = (current: string, min: string) => {
        const c = current.split('.').map(Number);
        const m = min.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (c[i] < m[i]) return true;
            if (c[i] > m[i]) return false;
        }
        return false;
    };

    if (status === 'checking') {
        return (
            <div className="min-h-screen bg-[#0b1120] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    const handleHardUpdate = async () => {
        try {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    await registration.unregister();
                }
            }
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                for (let name of cacheNames) {
                    await caches.delete(name);
                }
            }
        } catch (e) {
            console.error("Error clearing caches on manual update", e);
        }

        // Force reload without cache by changing the URL slightly
        window.location.href = window.location.origin + "?update=" + Date.now();
    };

    if (status === 'hard_update' && serverInfo) {
        return (
            <div className="fixed inset-0 z-[99999] bg-[#0b1120] flex flex-col items-center justify-center p-6 text-center overflow-hidden">
                <div className="bg-red-500/10 p-6 rounded-full mb-6 animate-pulse">
                    <ShieldAlert size={64} className="text-red-500" />
                </div>

                <h2 className="text-white text-2xl font-bold mb-2">RECARGA OBLIGATORIA</h2>
                <p className="text-slate-400 text-sm mb-8 max-w-xs">
                    Estamos actualizando SICA (v{CURRENT_VERSION} → v{serverInfo.min_supported_version}) para activar el nuevo Balance de Canal.
                </p>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-10 w-full max-w-xs text-left">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-slate-500 text-[10px] font-bold uppercase">Estado</span>
                        <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">Desactualizado</span>
                    </div>
                </div>

                <button
                    onClick={handleHardUpdate}
                    className="w-full max-w-xs bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-orange-900/40 active:scale-95 text-lg"
                >
                    Actualizar Ahora
                </button>

                <p className="mt-8 text-[10px] text-slate-600 font-mono">
                    ID: {serverInfo.build_hash}
                </p>
            </div>
        );
    }

    return <>{children}</>;
};
