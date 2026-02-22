import { createClient } from './src/lib/supabase/server';
async function check() {
  const supabase = await createClient();
  const { data } = await supabase.from('system_config').select('*');
  console.log(JSON.stringify(data, null, 2));
}
check();
