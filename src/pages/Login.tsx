import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail, Droplets, ShieldCheck } from 'lucide-react';
import './Login.css';

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
        <div className="mobile-login-container">
            <div className="mobile-login-card">
                <div className="mobile-brand">
                    <div className="mobile-brand-icon">
                        <Droplets className="water-icon" />
                    </div>
                    <h1>SICA Capture</h1>
                    <p>Red Mayor del Distrito 005</p>
                </div>

                <form onSubmit={handleLogin} className="mobile-login-form">
                    <div className="mobile-form-group">
                        <label>Correo Electrónico</label>
                        <div className="mobile-input-wrapper">
                            <Mail className="mobile-icon" size={18} />
                            <input
                                type="email"
                                placeholder="usuario@srlconchos.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="mobile-form-group">
                        <label>Contraseña</label>
                        <div className="mobile-input-wrapper">
                            <Lock className="mobile-icon" size={18} />
                            <input
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    {error && <div className="mobile-error-msg">{error}</div>}

                    <button
                        type="submit"
                        className={`mobile-login-btn ${loading ? 'loading' : ''}`}
                        disabled={loading}
                    >
                        {loading ? 'Iniciando...' : (
                            <>
                                <LogIn size={20} />
                                <span>Entrar al Sistema</span>
                            </>
                        )}
                    </button>
                </form>

                <div className="mobile-login-footer">
                    <ShieldCheck size={14} />
                    <span>Conchos S. de R.L. - Control Operativo</span>
                </div>
            </div>
        </div>
    );
};

export default Login;
