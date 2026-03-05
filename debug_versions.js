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

async function check() {
    console.log('Fetching app_versions...');
    const { data, error } = await supabase
        .from('app_versions')
        .select('*');

    if (error) {
        console.error('ERROR FROM SUPABASE:', error);
    } else {
        console.log(`SUCCESS. Got ${data?.length} rows.`);
        console.log(data);
    }
}

check();
