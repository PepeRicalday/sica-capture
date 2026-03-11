import { type ReactNode, useState, useEffect } from 'react';
import { MapPin, LogOut, Activity, Droplets } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const APP_VERSION = __APP_VERSION__;

const Layout = ({ children }: { children: ReactNode }) => {
    const { signOut } = useAuth();
    const navigate = useNavigate();
    const [lastSync, setLastSync] = useState<number | null>(null);

    useEffect(() => {
        const checkSync = () => {
            const ls = localStorage.getItem('sica_last_sync');
            if (ls) setLastSync(parseInt(ls));
        };
        checkSync();
        const interval = setInterval(checkSync, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    return (
        <div className="flex flex-col h-[100dvh] fixed inset-0 overflow-hidden bg-mobile-dark">
            {/* Main Content */}
            <main className="flex-1 overflow-y-auto pb-20">
                {children}
            </main>

            {/* Bottom Nav */}
            <nav className="fixed bottom-0 w-full bg-mobile-card border-t border-slate-800 pb-safe z-50">
                <div className="flex justify-around items-center h-14">
                    <NavLink
                        to="/monitor"
                        className={({ isActive }) => `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive ? 'text-mobile-accent bg-slate-800/50' : 'text-slate-400'}`}
                    >
                        {({ isActive }) => (
                            <>
                                <Activity size={22} className={isActive ? '-translate-y-0.5 transition-transform' : ''} />
                                <span className={`text-[9px] mt-0.5 ${isActive ? 'font-bold' : ''}`}>Monitor</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink
                        to="/hidrometria"
                        className={({ isActive }) => `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive ? 'text-mobile-accent bg-slate-800/50' : 'text-slate-400'}`}
                    >
                        {({ isActive }) => (
                            <>
                                <Droplets size={22} className={isActive ? '-translate-y-0.5 transition-transform' : ''} />
                                <span className={`text-[9px] mt-0.5 ${isActive ? 'font-bold' : ''}`}>Hidro</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink
                        to="/captura"
                        className={({ isActive }) => `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive ? 'text-mobile-accent bg-slate-800/50' : 'text-slate-400'}`}
                    >
                        {({ isActive }) => (
                            <>
                                <MapPin size={22} className={isActive ? '-translate-y-0.5 transition-transform' : ''} />
                                <span className={`text-[9px] mt-0.5 ${isActive ? 'font-bold' : ''}`}>Captura</span>
                            </>
                        )}
                    </NavLink>
                    <button
                        onClick={handleLogout}
                        className="flex flex-col items-center justify-center w-full h-full text-slate-400 hover:text-red-400 transition-colors"
                    >
                        <LogOut size={22} />
                        <span className="text-[9px] mt-0.5">Salir</span>
                    </button>
                </div>
                {/* Version Badge & Sync Latency (MEJ-1) */}
                <div className="flex justify-between items-center px-4 pb-1 -mt-1">
                    <span className="text-[8px] text-slate-600 font-mono tracking-wider">
                        SICA v{APP_VERSION} 
                    </span>
                    {lastSync && (
                        <span className={`text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded-sm ${
                            ((Date.now() - lastSync) / 60000) > 30 ? 'bg-amber-500/10 text-amber-500' : 'text-slate-500'
                        }`}>
                            Sync: {Math.floor((Date.now() - lastSync) / 60000)}m
                        </span>
                    )}
                </div>
            </nav>
        </div>
    );
};

export default Layout;
