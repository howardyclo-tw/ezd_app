/**
 * e2e/seed-users.mjs
 *
 * Creates the three E2E test auth users via the Supabase Admin API.
 * Idempotent: if a user already exists, fetches and continues.
 *
 * Usage:  node e2e/seed-users.mjs
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Load .env.local ─────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envText = readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  let val = trimmed.slice(eqIdx + 1);
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Safety: abort if pointing at prod
if (supabaseUrl.includes('zhaloqbeguzsknodrxsm')) {
  console.error('ABORT: .env.local points at PRODUCTION Supabase. This script is for DEV only.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Users to create ─────────────────────────────────────────────
const USERS = [
  { email: 'e2e-admin@mediatek.com',   password: 'mediatek', name: 'E2E Admin'   },
  { email: 'e2e-member@mediatek.com',  password: 'mediatek', name: 'E2E Member'  },
  { email: 'e2e-member2@mediatek.com', password: 'mediatek', name: 'E2E Member2' },
  { email: 'e2e-guest@mediatek.com',   password: 'mediatek', name: 'E2E Guest'   },
];

async function ensureUser({ email, password, name }) {
  // Try to create the user
  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createData?.user) {
    console.log(`  CREATED  ${email}  id=${createData.user.id}`);
    return createData.user.id;
  }

  // If user already exists, treat as success (seed.sql resolves IDs by email)
  if (createError?.message?.includes('already been registered') ||
      createError?.message?.includes('already exists')) {
    console.log(`  EXISTS   ${email}  (skipped — ID resolved by seed.sql)`);
    return;
  }

  console.error(`  ERROR creating ${email}: ${createError?.message}`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────
console.log('Creating E2E test users on DEV Supabase...');
console.log(`  URL: ${supabaseUrl}\n`);

const ids = {};
for (const u of USERS) {
  ids[u.email] = await ensureUser(u);
}

console.log('\nAll user IDs:');
for (const [email, id] of Object.entries(ids)) {
  console.log(`  ${email} => ${id}`);
}
console.log('\nDone. Now run:  Apply e2e/seed.sql via Supabase MCP or psql.');
