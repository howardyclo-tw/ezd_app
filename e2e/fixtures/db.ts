/**
 * e2e/fixtures/db.ts
 *
 * Service-role Supabase client for DB-state assertions in E2E tests.
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * process.env (loaded by playwright.config.ts via @next/env loadEnvConfig).
 *
 * Safety: aborts if the URL points at the production project.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env ' +
      '(playwright.config.ts should load .env.local via @next/env)'
    );
  }

  // Abort if pointing at prod
  if (url.includes('zhaloqbeguzsknodrxsm')) {
    throw new Error('ABORT: env points at PRODUCTION Supabase. E2E DB assertions are for DEV only.');
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

/**
 * Look up the auth user id by email.
 */
export async function getUserIdByEmail(email: string): Promise<string> {
  const client = getAdminClient();
  const { data, error } = await client.auth.admin.listUsers();
  if (error) throw new Error(`Failed to list users: ${error.message}`);
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`User with email ${email} not found`);
  return user.id;
}

/**
 * Query attendance_records for a given user + session.
 * Returns the row or null if not found.
 */
export async function getAttendanceRecord(
  userId: string,
  sessionId: string
): Promise<{ status: string; marked_by: string } | null> {
  const client = getAdminClient();
  const { data, error } = await client
    .from('attendance_records')
    .select('status, marked_by')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to query attendance_records: ${error.message}`);
  return data;
}

/**
 * Query transfer_requests for a given course + from_user.
 * Returns matching rows (may be multiple if multiple sessions transferred).
 */
export async function getTransferRequests(
  courseId: string,
  fromUserId: string
): Promise<Array<{ id: string; session_id: string; to_user_id: string; status: string }>> {
  const client = getAdminClient();
  const { data, error } = await client
    .from('transfer_requests')
    .select('id, session_id, to_user_id, status')
    .eq('course_id', courseId)
    .eq('from_user_id', fromUserId);

  if (error) throw new Error(`Failed to query transfer_requests: ${error.message}`);
  return data || [];
}
