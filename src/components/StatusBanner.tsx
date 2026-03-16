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

    let statusClass = 'status-unknown';

    switch(activeEvent.evento_tipo) {
        case 'LLENADO':
            statusClass = !activeEvent.hora_apertura_real ? 'status-llenado-prog' : 'status-llenado-active';
            bannerProps = {
                icon: <Waves size={16} />,
                title: !activeEvent.hora_apertura_real ? 'PROTOCOLO PROGRAMADO' : 'PROTOCOLO DE LLENADO ACTIVO',
                desc: !activeEvent.hora_apertura_real 
                    ? `Esperando apertura de presa. Gasto programado: ${activeEvent.gasto_solicitado_m3s || '--'} m³/s`
                    : `Onda en tránsito (${activeEvent.gasto_solicitado_m3s} m³/s). Reportar arribos.`
            };
            break;
        case 'ESTABILIZACION':
            statusClass = 'status-estabilizado';
            bannerProps = {
                icon: <Droplets size={16} />,
                title: 'FLUJO ESTABILIZADO',
                desc: 'Operación normal. Monitoreando distribución a tomas.'
            };
            break;
        case 'CONTINGENCIA_LLUVIA':
            statusClass = 'status-contingencia';
            bannerProps = {
                icon: <AlertTriangle size={16} />,
                title: 'CONTINGENCIA POR EXCEDENTES',
                desc: 'Alerta climática. Inspeccionar nivel y desfogues.'
            };
            break;
        case 'VACIADO':
            statusClass = 'status-vaciado';
            bannerProps = {
                icon: <Shield size={16} />,
                title: 'CORTINA EN VACIADO',
                desc: 'Cierre en progreso. Vigilar abatimiento max 30cm/día.'
            };
            break;
        case 'ANOMALIA_BAJA':
            statusClass = 'status-anomalia';
            bannerProps = {
                icon: <AlertTriangle size={16} />,
                title: 'ANOMALÍA: BAJA SÚBITA',
                desc: 'Caída nivel no programada. Inspección de ruta requerida.'
            };
            break;
    }

    return (
        <div className={`status-banner ${statusClass}`}>
            <div className="status-banner-icon">
                {bannerProps.icon}
            </div>
            <div className="flex flex-col">
                <span className="status-banner-title">
                    {bannerProps.title}
                </span>
                <span className="status-banner-desc">
                    {bannerProps.desc}
                </span>
            </div>
        </div>
    );
};

export default StatusBanner;
