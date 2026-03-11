import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type HydraulicEvent = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA_LLUVIA' | 'VACIADO' | 'ANOMALIA_BAJA';

export interface SICAEventLog {
    id: string;
    evento_tipo: HydraulicEvent;
    activo: boolean;
    hora_apertura: string | null;
    gasto_solicitado_m3s: number | null;
    valvulas_activas: string[] | null;
}

interface HydricStatusContextType {
    activeEvent: SICAEventLog | null;
    isLoading: boolean;
}

const HydricStatusContext = createContext<HydricStatusContextType>({
    activeEvent: null,
    isLoading: true
});

export const HydricStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeEvent, setActiveEvent] = useState<SICAEventLog | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const fetchCurrent = async () => {
            try {
                const { data, error } = await supabase
                    .from('sica_eventos_log')
                    .select('*')
                    .eq('activo', true)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (error) throw error;
                if (mounted) setActiveEvent(data || null);
            } catch (err) {
                console.error('Error fetching active hydric event:', err);
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        fetchCurrent();

        // Suscripción Realtime a Cambios Generales del Tablero
        const channel = supabase.channel('hydric_event_changes_mobile')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'sica_eventos_log' },
                () => {
                    console.log('📡 Cambio detectado en Protocolos Centrales. Actualizando HUD...');
                    fetchCurrent();
                }
            )
            .subscribe();

        return () => {
            mounted = false;
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <HydricStatusContext.Provider value={{ activeEvent, isLoading }}>
            {children}
        </HydricStatusContext.Provider>
    );
};

export const useHydricStatus = () => useContext(HydricStatusContext);
