import React from 'react';
import { useHydricStatus } from '../context/HydricStatusContext';
import { Waves, Droplets, AlertTriangle, Shield } from 'lucide-react';

const StatusBanner: React.FC = () => {
    const { activeEvent, isLoading } = useHydricStatus();

    if (isLoading || !activeEvent) return null;

    let bannerProps = {
        bgStart: '#1e293b', 
        bgEnd: '#0f172a',
        borderColor: '#334155',
        icon: <Waves size={16} />,
        title: 'ESTADO DESCONOCIDO',
        desc: 'Sincronizando con Red Mayor...'
    };

    switch(activeEvent.evento_tipo) {
        case 'LLENADO':
            const isProgrammed = !activeEvent.hora_apertura_real;
            bannerProps = {
                bgStart: isProgrammed ? 'rgba(245, 158, 11, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                bgEnd: isProgrammed ? 'rgba(180, 83, 9, 0.1)' : 'rgba(29, 78, 216, 0.1)',
                borderColor: isProgrammed ? 'rgba(245, 158, 11, 0.5)' : 'rgba(59, 130, 246, 0.5)',
                icon: <Waves size={16} className={isProgrammed ? "text-amber-400" : "text-blue-400"} />,
                title: isProgrammed ? 'PROTOCOLO PROGRAMADO' : 'PROTOCOLO DE LLENADO ACTIVO',
                desc: isProgrammed 
                    ? `Esperando apertura de presa. Gasto programado: ${activeEvent.gasto_solicitado_m3s || '--'} m³/s`
                    : `Onda en tránsito (${activeEvent.gasto_solicitado_m3s} m³/s). Reportar arribos.`
            };
            break;
        case 'ESTABILIZACION':
            bannerProps = {
                bgStart: 'rgba(16, 185, 129, 0.2)', // emerald-500
                bgEnd: 'rgba(4, 120, 87, 0.1)',     // emerald-700
                borderColor: 'rgba(16, 185, 129, 0.5)',
                icon: <Droplets size={16} className="text-emerald-400" />,
                title: 'FLUJO ESTABILIZADO',
                desc: 'Operación normal. Monitoreando distribución a tomas.'
            };
            break;
        case 'CONTINGENCIA_LLUVIA':
            bannerProps = {
                bgStart: 'rgba(245, 158, 11, 0.2)', // amber-500
                bgEnd: 'rgba(180, 83, 9, 0.1)',     // amber-700
                borderColor: 'rgba(245, 158, 11, 0.5)',
                icon: <AlertTriangle size={16} className="text-amber-400" />,
                title: 'CONTINGENCIA POR EXCEDENTES',
                desc: 'Alerta climática. Inspeccionar nivel y desfogues.'
            };
            break;
        case 'VACIADO':
            bannerProps = {
                bgStart: 'rgba(239, 68, 68, 0.2)',  // red-500
                bgEnd: 'rgba(185, 28, 28, 0.1)',    // red-700
                borderColor: 'rgba(239, 68, 68, 0.5)',
                icon: <Shield size={16} className="text-red-400" />,
                title: 'CORTINA EN VACIADO',
                desc: 'Cierre en progreso. Vigilar abatimiento max 30cm/día.'
            };
            break;
        case 'ANOMALIA_BAJA':
            bannerProps = {
                bgStart: 'rgba(124, 58, 237, 0.2)', // violet-500
                bgEnd: 'rgba(91, 33, 182, 0.1)',    // violet-700
                borderColor: 'rgba(124, 58, 237, 0.5)',
                icon: <AlertTriangle size={16} className="text-violet-400" />,
                title: 'ANOMALÍA: BAJA SÚBITA',
                desc: 'Caída nivel no programada. Inspección de ruta requerida.'
            };
            break;
    }

    return (
        <div style={{
            background: `linear-gradient(90deg, ${bannerProps.bgStart} 0%, ${bannerProps.bgEnd} 100%)`,
            borderBottom: `2px solid ${bannerProps.borderColor}`,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            position: 'sticky',
            top: 0,
            zIndex: 40, // Below header
            backdropFilter: 'blur(8px)'
        }}>
            <div style={{
                background: bannerProps.bgEnd,
                padding: '6px',
                borderRadius: '8px',
                border: `1px solid ${bannerProps.borderColor}`
            }}>
                {bannerProps.icon}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-[10px] font-black tracking-widest text-slate-200">
                    {bannerProps.title}
                </span>
                <span className="text-[10px] text-slate-300 italic opacity-90 leading-tight">
                    {bannerProps.desc}
                </span>
            </div>
        </div>
    );
};

export default StatusBanner;
