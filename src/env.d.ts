/// <reference types="vite/client" />

// SICA Capture — Build-time constants injected by vite.config.ts `define`
declare const __V2_APP_VERSION__: string;
declare const __V2_BUILD_HASH__: string;
declare const __BUILD_DATE__: string;

// Virtual module provided by vite-plugin-pwa at build time
declare module 'virtual:pwa-register/react' {
    import type { Dispatch, SetStateAction } from 'react';
    export function useRegisterSW(options?: {
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: any) => void;
    }): {
        needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
        offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
        updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
    };
}
