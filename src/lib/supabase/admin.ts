import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Admin client with SERVICE_ROLE_KEY to bypass RLS and manage users
export const createAdminClient = () => {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
};
