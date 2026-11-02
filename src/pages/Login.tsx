import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail } from 'lucide-react';


const APP_VERSION = __V2_APP_VERSION__;
const BUILD_HASH = __V2_BUILD_HASH__;

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    const handleLogin = async (e: FormEvent) => {
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
        <div className="min-h-[100dvh] w-full flex items-center justify-center bg-mobile-dark p-4 relative overflow-hidden font-sans">
            {/* Subtle background glow */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(11, 49, 112, 0.65) 0%, transparent 60%)' }}></div>

            <div className="w-full max-w-[420px] bg-mobile-card/80 backdrop-blur-md border border-[#1E4A8C] rounded-3xl p-6 md:p-8 shadow-2xl z-10 my-4 md:my-0">
                <div className="flex justify-center mb-3 shrink-0">
                    <img src="/sica005-emblema.svg" alt="SICA 005" width={112} height={112} className="w-28 h-28 object-contain" />
                </div>

                <div className="text-center mb-6">
                    <h1 className="font-display text-[30px] md:text-3xl font-extrabold text-white tracking-tight mb-1">SICA 005</h1>
                    <h2 className="text-[#3FB2F3] text-[12px] font-bold tracking-[0.12em] uppercase mb-3">
                        Captura de campo
                    </h2>
                    <p className="text-[#CBEAF9] text-[13px] leading-relaxed px-2">
                        Distrito de Riego 005 · Delicias, Chihuahua
                    </p>
                </div>

                <div className="w-full h-px bg-slate-700/50 my-4"></div>

                <div className="text-center mb-4">
                    <h3 className="text-[17px] font-bold text-white mb-2">Acceso de operadores</h3>
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
                                className="w-full bg-[#10284F] border border-[#1E4A8C] text-white rounded-2xl py-3.5 pl-11 pr-4 text-[15px] focus:outline-none focus:border-[#3FB2F3] focus:ring-2 focus:ring-[#3FB2F3]/50 transition-all shadow-inner"
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
                                className="w-full bg-[#10284F] border border-[#1E4A8C] text-white rounded-2xl py-3.5 pl-11 pr-4 text-[15px] focus:outline-none focus:border-[#3FB2F3] focus:ring-2 focus:ring-[#3FB2F3]/50 transition-all shadow-inner"
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
                        className={`w-full mt-4 bg-mobile-primary hover:bg-mobile-primary-hover shadow-lg shadow-black/30 text-white font-display font-extrabold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
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

                {/* Operador: SRL Unidad Conchos (su logo lleva su propio recuadro blanco). El emblema SICA va arriba, a color y sin opacidad. */}
                <div className="mt-8 pt-2 flex flex-col items-center">
                    <span className="text-[11px] text-slate-400 mb-2 uppercase tracking-widest font-bold">Operado por</span>
                    <div className="bg-white rounded-xl p-1.5 flex items-center justify-center">
                        <img src="/logo-srl.png" alt="SRL Unidad Conchos" className="h-9 w-auto object-contain" />
                    </div>

                    <div className="mt-4 flex flex-col items-center gap-2">
                        <span className="text-[10px] text-white/50 font-mono bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                            v{APP_VERSION}{BUILD_HASH.replace(/^v/, '') === APP_VERSION ? '' : ` • ${BUILD_HASH}`}
                        </span>

                        {/* py-3 (no solo el texto text-[9px]): esta acción borra caché y
                            sesión — antes el hitbox medía ~13px de alto pegado al borde
                            inferior de la pantalla, la zona donde iOS/Android reservan el
                            gesto de home/back. El confirm() ya protege del toque accidental,
                            pero el objetivo táctil en sí debe llegar al mínimo usable. */}
                        <button
                            onClick={() => {
                                if (window.confirm('¿Deseas FORZAR la limpieza de la aplicación? Se borrará el caché y tendrás que volver a iniciar sesión.')) {
                                    window.location.href = "/nuke";
                                }
                            }}
                            className="text-[11px] text-[#3FB2F3] hover:text-white font-bold uppercase tracking-tight underline underline-offset-4 decoration-[#3FB2F3]/40 py-3 px-4"
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
