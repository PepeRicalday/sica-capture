
const { createClient } = require('@supabase/supabase-js');

async function checkK0() {
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
    
    console.log('--- BUSCANDO ESCALA K-0 ---');
    const { data: scale } = await supabase.from('escalas').select('id, nombre, pzas_radiales, ancho').eq('km', 0).single();
    if (!scale) {
        console.log('No se encontró escala en KM 0');
        return;
    }
    console.log(`ID: ${scale.id}, Nombre: ${scale.nombre}, Pzas: ${scale.pzas_radiales}, Ancho: ${scale.ancho}`);

    console.log('\n--- LECTURAS RECIENTES ---');
    const { data: readings } = await supabase.from('lecturas_escalas')
        .select('*')
        .eq('escala_id', scale.id)
        .order('creado_en', { ascending: false })
        .limit(5);
    
    readings.forEach(r => {
        console.log(`Fecha: ${r.fecha} ${r.hora_lectura}, Arriba: ${r.nivel_m}, Apertura Max: ${r.apertura_radiales_m}, Q: ${r.gasto_calculado_m3s}`);
        if(r.radiales_json) {
            const open = (r.radiales_json || []).filter(rj => rj.apertura_m > 0).length;
            console.log(`   --> ${open} compuertas abiertas en JSON`);
        }
    });

    console.log('\n--- AFOROS DE HOY ---');
    const today = new Date().toLocaleDateString('en-CA');
    const { data: aforos } = await supabase.from('aforos')
        .select('*')
        .eq('punto_control_id', 'CANAL-000')
        .eq('fecha', today);
    console.log('Aforos hoy:', aforos?.length || 0);
    aforos?.forEach(a => console.log(`   Q: ${a.gasto_calculado_m3s} m3/s`));
}

checkK0();
