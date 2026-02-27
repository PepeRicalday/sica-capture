import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[SICA ErrorBoundary]', error, errorInfo.componentStack);
    }

    handleReload = () => {
        window.location.reload();
    };

    handleNuke = () => {
        if (window.confirm('¿Limpiar caché completo? Tendrás que volver a iniciar sesión.')) {
            window.location.href = '/nuke';
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-[100dvh] bg-[#0b1120] flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-red-500/10 p-5 rounded-full mb-6">
                        <AlertTriangle size={48} className="text-red-500" />
                    </div>

                    <h1 className="text-white text-2xl font-bold mb-2">Error del Sistema</h1>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">
                        SICA encontró un error inesperado. Tus datos pendientes no se perdieron.
                    </p>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-8 w-full max-w-xs text-left">
                        <span className="text-[10px] text-red-400 font-bold uppercase block mb-1">Detalle Técnico</span>
                        <code className="text-[11px] text-slate-500 font-mono break-all block max-h-20 overflow-y-auto">
                            {this.state.error?.message || 'Error desconocido'}
                        </code>
                    </div>

                    <button
                        onClick={this.handleReload}
                        className="w-full max-w-xs bg-[#0ea5e9] hover:bg-[#0284c7] text-white font-bold py-4 rounded-2xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 text-lg mb-3"
                    >
                        <RefreshCw size={20} /> Reiniciar SICA
                    </button>

                    <button
                        onClick={this.handleNuke}
                        className="text-[11px] text-orange-500/80 hover:text-orange-400 font-bold uppercase tracking-wider underline underline-offset-4 decoration-orange-500/30"
                    >
                        Limpiar Caché y Reiniciar
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
