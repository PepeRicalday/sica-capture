import type { ReactNode } from 'react';
import { MapPin, LogOut, Activity, Droplets } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const APP_VERSION = __APP_VERSION__;
const BUILD_HASH = __BUILD_HASH__;

const Layout = ({ children }: { children: ReactNode }) => {
    const { signOut } = useAuth();
    const navigate = useNavigate();

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
                {/* Version Badge */}
                <div className="flex justify-center pb-1 -mt-1">
                    <span className="text-[8px] text-slate-600 font-mono tracking-wider">
                        SICA v{APP_VERSION} • {BUILD_HASH}
                    </span>
                </div>
            </nav>
        </div>
    );
};

export default Layout;
