
import { useEffect, useState } from 'react';
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
import { useRegisterSW } from 'virtual:pwa-register/react';
import { UpdateBanner } from './components/UpdateBanner';


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
  const [showUpdateBanner, setShowUpdateBanner] = useState(true);
  const [manualUpdateAvailable, setManualUpdateAvailable] = useState(false);

  const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered: ' + r);
      if (r) {
        r.update();
        setInterval(() => { r.update(); }, 5 * 60 * 1000); // Check every 5 min (was 60s — too aggressive for mobile data)
      }
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error);
    },
  });

  useEffect(() => {
    // Check version against Supabase to force banner if SW fails to detect it
    const checkActualVersion = async () => {
      try {
        const { data } = await supabase
          .from('app_versions')
          .select('version')
          .eq('app_id', 'capture')
          .single();

        if (data && data.version !== CURRENT_VERSION) {
          console.log(`[Update] Server has ${data.version}, local is ${CURRENT_VERSION}. Forcing banner.`);
          setManualUpdateAvailable(true);
        }
      } catch (e) {
        console.error("Version check failed", e);
      }
    };
    checkActualVersion();

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
  }, [CURRENT_VERSION]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
        <Route path="/hidrometria" element={<ProtectedRoute><Hidrometria /></ProtectedRoute>} />
        <Route path="/captura" element={<ProtectedRoute><Capture /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/monitor" replace />} />
        <Route path="*" element={<Navigate to="/monitor" replace />} />
      </Routes>
      {(needRefresh || manualUpdateAvailable) && showUpdateBanner && (
        <UpdateBanner
          onUpdate={() => {
            if (needRefresh) {
              updateServiceWorker(true);
            } else {
              // Forced manual update if SW didn't trigger
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                  for (let registration of registrations) {
                    registration.unregister();
                  }
                  window.location.reload();
                });
              } else {
                window.location.reload();
              }
            }
          }}
          onClose={() => setShowUpdateBanner(false)}
        />
      )}
    </>
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
