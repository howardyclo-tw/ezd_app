import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
    
    // Exact same queries as page.tsx
    const { data: leaves } = await supabase.from('leave_requests').select('id, status').gte('created_at', thirtyDaysAgoIso);
    const { data: makeups } = await supabase.from('makeup_requests').select('id, status').gte('created_at', thirtyDaysAgoIso);
    const { data: transfers } = await supabase.from('transfer_requests').select('id, status').gte('created_at', thirtyDaysAgoIso);

    console.log("Leaves:");
    console.table(leaves);
    console.log("Makeups:");
    console.table(makeups);
    console.log("Transfers:");
    console.table(transfers);
}
run().catch(console.error);
