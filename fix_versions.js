import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('c:/Users/peper/Downloads/Antigravity/SICA 005/sica-capture/.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key && value) env[key.trim()] = value.trim().replace(/^"|"$/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function updateVersions() {
    console.log('=== Actualizando tabla app_versions ===');

    // 1. Actualizar Sica Capture a v1.2.9
    const { error: err1 } = await supabase
        .from('app_versions')
        .update({
            version: '1.2.9',
            min_supported_version: '1.0.0',
            build_hash: 'v129-pwa-fix',
            release_notes: 'PWA update system rebuilt. No more blocking banners.'
        })
        .eq('app_id', 'capture');

    if (err1) console.error('Error capture:', err1);
    else console.log('✅ Sica Capture → v1.2.9 (min: 1.0.0)');

    // 2. Actualizar Conchos Digital a v1.3.6
    const { error: err2 } = await supabase
        .from('app_versions')
        .update({
            version: '1.3.6',
            min_supported_version: '1.0.0',
            build_hash: 'v136-responsive-fix'
        })
        .eq('app_id', 'control-digital');

    if (err2) console.error('Error control-digital:', err2);
    else console.log('✅ Conchos Digital → v1.3.6 (min: 1.0.0)');

    // 3. Verificar resultado final
    const { data } = await supabase.from('app_versions').select('*');
    console.log('\n📋 Estado final de app_versions:');
    console.table(data);
}

updateVersions();
