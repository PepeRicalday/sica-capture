
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Capture from './pages/Capture';
import Monitor from './pages/Monitor';
import Hidrometria from './pages/Hidrometria';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './context/AuthContext';
import { downloadCatalogs, syncPendingRecords } from './lib/sync';
import { supabase } from './lib/supabase';
import { Toaster } from 'sonner';
import { VersionGuard } from './components/VersionGuard';

/**
 * PWA Update System v3.0 — Robusto y Sin Bloqueos
 * 
 * ARQUITECTURA:
 * 1. Service Worker se registra en modo 'autoUpdate' (prompt desactivado).
 * 2. El SW se actualiza automáticamente sin mostrar banners que bloqueen.
 * 3. La app se recarga limpiamente solo cuando el SW detecta un cambio. 
 * 4. NO se compara versión contra Supabase para evitar falsos positivos.
 * 5. VersionGuard solo actúa si min_supported_version > local (caso extremo).
 */

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-mobile-dark text-mobile-accent">
        <div className="animate-pulse font-bold">Iniciando SICA...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
};

function AppContent() {
  useEffect(() => {
    // --- PWA SERVICE WORKER: Registro silencioso ---
    if ('serviceWorker' in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.ready.then(registration => {
        // Verificar actualizaciones cada 10 minutos (no agresivo)
        setInterval(() => {
          registration.update().catch(() => { /* silencioso */ });
        }, 10 * 60 * 1000);
      });

      // Cuando un nuevo SW toma el control, recargar automáticamente
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('[SICA PWA] Nuevo Service Worker activo. Recargando...');
        window.location.reload();
      });
    }

    // --- Sincronización de catálogos ---
    downloadCatalogs();

    // Sync pending records when device comes online
    const handleOnline = () => syncPendingRecords();
    window.addEventListener('online', handleOnline);

    // C-4: Realtime — refresh catalogs when another operator syncs measurements
    const channel = supabase.channel('capture_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mediciones' }, () => {
        console.log('📡 Medición detectada. Refrescando catálogos...');
        downloadCatalogs();
      })
      .subscribe();

    // C-5: Refresh when app returns to foreground (critical for mobile PWA)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('👁️ App visible. Sincronizando...');
        syncPendingRecords();
        downloadCatalogs();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
      <Route path="/hidrometria" element={<ProtectedRoute><Hidrometria /></ProtectedRoute>} />
      <Route path="/captura" element={<ProtectedRoute><Capture /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/monitor" replace />} />
      <Route path="*" element={<Navigate to="/monitor" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <VersionGuard>
          <Toaster position="top-center" theme="dark" toastOptions={{ style: { background: '#1e293b', border: '1px solid #334155', color: '#f8fafc' } }} />
          <AppContent />
        </VersionGuard>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
