import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export type HydraulicEvent = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA_LLUVIA' | 'VACIADO' | 'ANOMALIA_BAJA';

export interface SICAEventLog {
    id: string;
    evento_tipo: HydraulicEvent;
    esta_activo: boolean;
    fecha_inicio: string;
    notas: string;
    hora_apertura_real: string | null;
    gasto_solicitado_m3s: number | null;
    valvulas_activas: string[] | null;
}

interface HydricStatusContextType {
    activeEvent: SICAEventLog | null;
    isLoading: boolean;
    maxKmAlcanzado: number; // Front of the water wave in KM
}

const HydricStatusContext = createContext<HydricStatusContextType>({
    activeEvent: null,
    isLoading: true,
    maxKmAlcanzado: 0
});

export const HydricStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeEvent, setActiveEvent] = useState<SICAEventLog | null>(null);
    const [maxKmAlcanzado, setMaxKmAlcanzado] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const fetchCurrent = async () => {
            try {
                const { data, error } = await supabase
                    .from('sica_eventos_log')
                    .select('*')
                    .eq('esta_activo', true)
                    .order('fecha_inicio', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    if (mounted) setActiveEvent(data);
                    
                    if (data.evento_tipo === 'LLENADO') {
                        const { data: ptData } = await supabase
                            .from('sica_llenado_seguimiento')
                            .select('km')
                            .eq('evento_id', data.id)
                            .not('hora_real', 'is', null)
                            .order('km', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        if (mounted && ptData) setMaxKmAlcanzado(ptData.km || 0);
                        else if (mounted) setMaxKmAlcanzado(0);
                    } else {
                        if (mounted) setMaxKmAlcanzado(1000); // Allow all KM if not filling
                    }
                } else {
                    if (mounted) {
                        setActiveEvent(null);
                        setMaxKmAlcanzado(1000); // Default open
                    }
                }
            } catch (err) {
                console.error('Error fetching active hydric event:', err);
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        fetchCurrent();

        // Suscripción Realtime a Cambios Generales del Tablero
        const channel1 = supabase.channel('hydric_event_changes_mobile')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'sica_eventos_log' },
                (payload) => {
                    console.log('📡 Cambio detectado en Protocolos Centrales. Actualizando HUD...');
                    
                    // Alertas Push/Hápticas en tiempo real (SICA Chronos)
                    if (payload.new && (payload.new as SICAEventLog).esta_activo === true) {
                        const newEvent = payload.new as SICAEventLog;
                        if (newEvent.evento_tipo === 'ANOMALIA_BAJA') {
                            if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]); // Patrón de emergencia
                            toast.error('⚠️ ALERTA GERENCIAL: Anomalía Baja declarada. Requiere inspección visual de taludes y tomas.', {
                                duration: 15000,
                                style: { background: '#7c3aed', color: 'white', border: '1px solid #c4b5fd' }
                            });
                        } else if (newEvent.evento_tipo === 'CONTINGENCIA_LLUVIA') {
                            if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
                            toast.warning('⛈️ CONTINGENCIA: Volumen excedente en tránsito. Precaución en desfogues.', { duration: 10000 });
                        }
                    }
                    fetchCurrent();
                }
            )
            .subscribe();

        // Suscripción Realtime al Avance Físico del Agua (Onda)
        const channel2 = supabase.channel('hydric_wave_tracking')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'sica_llenado_seguimiento' },
                () => {
                    // Update the front of the wave quietly
                    fetchCurrent();
                }
            )
            .subscribe();

        return () => {
            mounted = false;
            supabase.removeChannel(channel1);
            supabase.removeChannel(channel2);
        };
    }, []);

    return (
        <HydricStatusContext.Provider value={{ activeEvent, isLoading, maxKmAlcanzado }}>
            {children}
        </HydricStatusContext.Provider>
    );
};

export const useHydricStatus = () => useContext(HydricStatusContext);
