/**
 * SICA NUCLEAR RESET — FORCED v2.0.0
 */
(function() {
    const EPOCH_ID = 'sica_epoch_200_unified';
    if (typeof localStorage !== 'undefined' && localStorage.getItem('sica_active_epoch') !== EPOCH_ID) {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('sica_active_epoch', EPOCH_ID);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                for (let reg of regs) reg.unregister();
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    }
})();

import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
