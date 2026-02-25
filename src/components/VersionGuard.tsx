import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert } from 'lucide-react';

interface VersionInfo {
    version: string;
    min_supported_version: string;
    update_url: string;
    build_hash: string;
}

// @ts-ignore
const CURRENT_VERSION = __APP_VERSION__;
// @ts-ignore
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
            // Give the browser a moment to process the SW unregistration before navigating
            setTimeout(() => {
                window.location.href = window.location.origin + window.location.pathname + '?hard_refresh=' + Date.now();
            }, 800);
        } catch (e) {
            console.error('Error in hard update:', e);
            setTimeout(() => {
                window.location.reload();
            }, 800);
        }
    };

    if (status === 'hard_update' && serverInfo) {
        return (
            <>
                <div className="bg-red-600 text-white text-[10px] py-1 px-4 flex items-center justify-between font-bold uppercase tracking-wider sticky top-0 z-[9999] shadow-lg">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={12} />
                        <span>SICA Desactualizado (v{CURRENT_VERSION} &lt; v{serverInfo.min_supported_version})</span>
                    </div>
                    <button onClick={handleHardUpdate} className="bg-white text-red-600 px-2 py-0.5 rounded-md hover:bg-slate-100 transition-colors cursor-pointer">
                        Forzar Redecarga
                    </button>
                </div>
                {children}
            </>
        );
    }

    return <>{children}</>;
};
