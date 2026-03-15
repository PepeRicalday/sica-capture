import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldCheck, X, Lock, Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ManagerAuthModalProps {
    onSuccess: () => void;
    onClose: () => void;
    reason: string;
}

export const ManagerAuthModal = ({ onSuccess, onClose, reason }: ManagerAuthModalProps) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // we sign in with a temporary client to check credentials without messing up the current session
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            // Check if user is manager (SRL)
            const { data: profile, error: profileError } = await supabase
                .from('perfiles_usuario')
                .select('rol')
                .eq('id', data.user.id)
                .single();

            if (profileError || profile?.rol !== 'SRL') {
                throw new Error('El usuario no tiene privilegios de Gerente (SRL).');
            }

            toast.success('Autorización Exitosa');
            onSuccess();
        } catch (err: any) {
            toast.error(err.message || 'Credenciales de Gerente inválidas');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950/90 z-[60] flex items-center justify-center p-4 backdrop-blur-md">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                <div className="p-5 border-b border-slate-800 bg-slate-800/40 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="bg-orange-500/20 p-2 rounded-xl">
                            <ShieldCheck className="text-orange-500" size={20} />
                        </div>
                        <div>
                            <h2 className="text-white font-black text-sm tracking-tight">AUTORIZACIÓN GERENCIAL</h2>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Nivel de Acceso: SRL RED MAYOR</p>
                        </div>
                    </div>
                    <button onClick={onClose} title="Cerrar" className="text-slate-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 bg-orange-500/10 border border-orange-500/20 p-3 rounded-xl">
                        <p className="text-[10px] text-orange-400 font-bold leading-relaxed">
                            <span className="block uppercase underline mb-1">Motivo de Bloqueo:</span>
                            {reason}
                        </p>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Correo del Gerente</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="gerencia@srlconchos.com"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white outline-none focus:border-orange-500 transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Pin / Contraseña</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white outline-none focus:border-orange-500 transition-all"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] mt-2 shadow-lg shadow-orange-900/20"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : 'AUTORIZAR REGISTRO'}
                        </button>
                    </form>
                    
                    <button 
                        onClick={onClose}
                        className="w-full mt-4 text-[10px] text-slate-500 font-bold uppercase hover:text-slate-300 transition-colors"
                    >
                        Cancelar y Volver
                    </button>
                </div>
            </div>
        </div>
    );
};
