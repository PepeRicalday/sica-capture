import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail } from 'lucide-react';
import './Login.css';

// @ts-ignore
const APP_VERSION = __APP_VERSION__;
// @ts-ignore
const BUILD_HASH = __BUILD_HASH__;

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            navigate('/monitor');
        } catch (err: any) {
            console.error('Login error:', err);
            setError('Credenciales inválidas. Verifica tu correo y contraseña.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[#0b1120] p-4 relative overflow-hidden font-sans">
            {/* Subtle background glow */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(30, 58, 138, 0.3) 0%, transparent 60%)' }}></div>

            <div className="w-full max-w-[420px] bg-[#111827]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl z-10 my-4 md:my-0">
                <div className="flex justify-center mb-5 shrink-0">
                    <div className="bg-white p-3 rounded-2xl shadow-lg ring-1 ring-white/10 flex items-center justify-center">
                        <img src="/logo-srl.png" alt="SRL Unidad Conchos" className="max-w-[140px] w-auto h-auto max-h-[120px] object-contain" />
                    </div>
                </div>

                <div className="text-center mb-6">
                    <h1 className="text-[28px] md:text-3xl font-extrabold text-white tracking-tight mb-2">Unidad Conchos</h1>
                    <h2 className="text-[#f59e0b] text-[10px] font-bold tracking-[0.15em] uppercase mb-4">
                        HIDRO-SINCRONÍA DIGITAL
                    </h2>
                    <p className="text-slate-300 text-[11px] leading-relaxed px-2">
                        Sociedad de Asociaciones de Usuarios Unidad<br />Conchos S.R.L. De I.P. y C.V.
                    </p>
                </div>

                <div className="w-full h-px bg-slate-700/50 my-6"></div>

                <div className="text-center mb-6">
                    <h3 className="text-[17px] font-bold text-white mb-2">Centro de Control Operativo</h3>
                    <p className="text-slate-400 text-[13px]">
                        Ingresa tus credenciales para acceder al sistema
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block ml-1">
                            CORREO ELECTRÓNICO
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="email"
                                placeholder="correo@srlconchos.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full bg-[#1e293b] border border-slate-700 text-white rounded-2xl py-3.5 pl-11 pr-4 text-[15px] focus:outline-none focus:border-[#ea580c] focus:ring-1 focus:ring-[#ea580c] transition-all shadow-inner"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block ml-1">
                            CONTRASEÑA
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full bg-[#1e293b] border border-slate-700 text-white rounded-2xl py-3.5 pl-11 pr-4 text-[15px] focus:outline-none focus:border-[#ea580c] focus:ring-1 focus:ring-[#ea580c] transition-all shadow-inner"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center p-3 rounded-xl">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full mt-4 bg-[#ea580c] hover:bg-[#c2410c] shadow-lg shadow-orange-900/20 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <LogIn size={20} />
                                <span>Iniciar Sesión</span>
                            </>
                        )}
                    </button>
                </form>

                {/* SICA Logo Pequeño en la parte inferior */}
                <div className="mt-8 pt-2 flex flex-col items-center">
                    <span className="text-[9px] text-slate-500 mb-2 uppercase tracking-widest font-bold">Respaldo Tecnológico</span>
                    <img src="/SICA005.png" alt="SICA Captura" className="h-6 w-auto object-contain opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-300" />

                    <div className="mt-4 flex flex-col items-center gap-2">
                        <span className="text-[10px] text-white/50 font-mono bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                            SICA v{APP_VERSION} • {BUILD_HASH}
                        </span>

                        <button
                            onClick={() => {
                                if (window.confirm('¿Deseas FORZAR la limpieza de la aplicación? Se borrará el caché y tendrás que volver a iniciar sesión.')) {
                                    window.location.href = "/nuke";
                                }
                            }}
                            className="text-[9px] text-orange-500/80 hover:text-orange-400 font-bold uppercase tracking-tighter underline underline-offset-4 decoration-orange-500/30"
                        >
                            Limpiar Caché y Actualizar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
