
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Capture from './pages/Capture';
import Monitor from './pages/Monitor';
import Hidrometria from './pages/Hidrometria';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './context/AuthContext';
import { downloadCatalogs, syncPendingRecords } from './lib/sync';
import { Toaster } from 'sonner';
// @ts-ignore
import { useRegisterSW } from 'virtual:pwa-register/react';

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
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered: ' + r);
      // Forzar chequeo de actualización en cada recarga
      r && setInterval(() => { r.update(); }, 60 * 1000);
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error);
    },
  });

  useEffect(() => {
    // Si la PWA detecta que hay nueva versión, forzamos recarga sin preguntar
    if (needRefresh) {
      updateServiceWorker(true);
    }
  }, [needRefresh, updateServiceWorker]);

  useEffect(() => {
    downloadCatalogs();
    const handleOnline = () => syncPendingRecords();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
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
        <Toaster position="top-center" theme="dark" toastOptions={{ style: { background: '#1e293b', border: '1px solid #334155', color: '#f8fafc' } }} />
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
