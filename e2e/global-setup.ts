/**
 * e2e/global-setup.ts
 *
 * Playwright globalSetup: re-applies the E2E seed before every suite run
 * so that all tests start from a deterministic baseline, and pre-authenticates
 * each E2E role into Playwright storageState files so tests never touch the
 * login UI (eliminating the hydration-race login-stuck flake).
 *
 * Uses the Supabase service-role client (PostgREST) — no raw SQL driver needed.
 * Env vars loaded by @next/env (same as playwright.config.ts).
 *
 * Safety: aborts if the URL points at the production project.
 */
import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

/* ------------------------------------------------------------------ */
/*  E2E accounts (shared with auth.ts)                                 */
/* ------------------------------------------------------------------ */
const ACCOUNTS = {
  admin:   { email: 'e2e-admin@mediatek.com',   password: 'mediatek' },
  member:  { email: 'e2e-member@mediatek.com',  password: 'mediatek' },
  member2: { email: 'e2e-member2@mediatek.com', password: 'mediatek' },
  guest:   { email: 'e2e-guest@mediatek.com',   password: 'mediatek' },
} as const;

/* ------------------------------------------------------------------ */
/*  Date helpers (Asia/Taipei, matches app convention)                 */
/* ------------------------------------------------------------------ */
function todayTaipei(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function addDays(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00+08:00'); // Taipei UTC+8
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d);
}

function nowISO(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Seed IDs — single source of truth (globalSetup IS the seeder)      */
/* ------------------------------------------------------------------ */
const IDS = {
  memberGroup: 'e2e00000-0000-0000-0000-000000000001',
  courseGroup:  'e2e00000-0000-0000-0000-000000000010',
  course:      'e2e00000-0000-0000-0000-000000000020',
  singleCourse:'e2e00000-0000-0000-0000-000000000021',
  multiCourse: 'e2e00000-0000-0000-0000-000000000022',
  ntdCourse:   'e2e00000-0000-0000-0000-000000000023',
  workshop:    'e2e00000-0000-0000-0000-000000000024',
  oversellCourse: 'e2e00000-0000-0000-0000-000000000025',
  sessions: {
    past14:  'e2e00000-0000-0000-0000-00000000002f',
    past7:   'e2e00000-0000-0000-0000-000000000030',
    future7: 'e2e00000-0000-0000-0000-000000000031',
    future14:'e2e00000-0000-0000-0000-000000000032',
    future21:'e2e00000-0000-0000-0000-000000000033',
    single1: 'e2e00000-0000-0000-0000-000000000034',
    single2: 'e2e00000-0000-0000-0000-000000000035',
    single3: 'e2e00000-0000-0000-0000-000000000036',
    multi1:  'e2e00000-0000-0000-0000-000000000037',
    ntd1:    'e2e00000-0000-0000-0000-000000000038',
    ntd2:    'e2e00000-0000-0000-0000-000000000039',
    ntd3:    'e2e00000-0000-0000-0000-00000000003a',
    ws1:     'e2e00000-0000-0000-0000-00000000003b',
    ws2:     'e2e00000-0000-0000-0000-00000000003c',
    ws3:     'e2e00000-0000-0000-0000-00000000003d',
    ws4:     'e2e00000-0000-0000-0000-00000000003e',
    oversell1:'e2e00000-0000-0000-0000-00000000003f',
  },
  enrollments: {
    memberFull:      'e2e00000-0000-0000-0000-000000000060',
    multiSingle:     'e2e00000-0000-0000-0000-000000000061',
    ntdPending:      'e2e00000-0000-0000-0000-000000000062',
    workshopFull:    'e2e00000-0000-0000-0000-000000000063',
    singleWaitlist: 'e2e00000-0000-0000-0000-000000000064',
  },
  orders: {
    card10:   'e2e00000-0000-0000-0000-000000000040',
    card2:    'e2e00000-0000-0000-0000-000000000041',
    courseFee:'e2e00000-0000-0000-0000-000000000042',
  },
  transactions: {
    purchase10: 'e2e00000-0000-0000-0000-000000000050',
    purchase2:  'e2e00000-0000-0000-0000-000000000051',
  },
} as const;

const SEED_ORDER_IDS = [IDS.orders.card10, IDS.orders.card2, IDS.orders.courseFee];
const SEED_TX_IDS = [IDS.transactions.purchase10, IDS.transactions.purchase2];

/* ------------------------------------------------------------------ */
/*  Helper: throw on Supabase errors                                   */
/* ------------------------------------------------------------------ */
function check<T>(label: string, result: { data: T; error: unknown }): T {
  if (result.error) {
    throw new Error(`globalSetup ${label}: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
export default async function globalSetup() {
  loadEnvConfig(process.cwd());

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  if (url.includes('zhaloqbeguzsknodrxsm')) {
    throw new Error('ABORT: env points at PRODUCTION Supabase. E2E seed is for DEV only.');
  }

  const sb: SupabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Resolve user IDs ──────────────────────────────────────────
  const { data: usersData, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) throw new Error(`listUsers failed: ${usersErr.message}`);

  const findUser = (email: string) => {
    const u = usersData.users.find((x) => x.email === email);
    if (!u) throw new Error(`E2E user ${email} not found. Run: node e2e/seed-users.mjs`);
    return u.id;
  };

  const adminId   = findUser('e2e-admin@mediatek.com');
  const memberId  = findUser('e2e-member@mediatek.com');
  const member2Id = findUser('e2e-member2@mediatek.com');
  const guestId   = findUser('e2e-guest@mediatek.com');

  const today = todayTaipei();
  const now   = nowISO();

  // ── 1. Upsert member_group ────────────────────────────────────
  check('member_groups', await sb.from('member_groups').upsert({
    id: IDS.memberGroup, name: 'E2E Test Group 2026', valid_until: '2026-12-31',
  }, { onConflict: 'id' }));

  // ── 2. Reset profiles ─────────────────────────────────────────
  check('profile admin', await sb.from('profiles').update({
    name: 'E2E Admin', role: 'admin', card_balance: 0, makeup_quota: 0,
    member_valid_until: '2026-12-31', member_group_id: null,
  }).eq('id', adminId));

  check('profile member', await sb.from('profiles').update({
    name: 'E2E Member', role: 'member', card_balance: 10, makeup_quota: 0,
    member_valid_until: '2026-12-31', member_group_id: IDS.memberGroup,
  }).eq('id', memberId));

  check('profile member2', await sb.from('profiles').update({
    name: 'E2E Member2', role: 'member', card_balance: 5, makeup_quota: 0,
    member_valid_until: '2026-12-31', member_group_id: IDS.memberGroup,
  }).eq('id', member2Id));

  check('profile guest', await sb.from('profiles').update({
    name: 'E2E Guest', role: 'guest', card_balance: 0, makeup_quota: 0,
    member_valid_until: null, member_group_id: null,
  }).eq('id', guestId));

  // ── 3. Upsert course_group ────────────────────────────────────
  check('course_groups', await sb.from('course_groups').upsert({
    id: IDS.courseGroup,
    title: 'E2E H2 2026 Course Group',
    description: 'Deterministic E2E test course group',
    region: 'HQ',
    period_start: today,
    period_end: addDays(today, 90),
    registration_phase1_start: new Date(Date.now() - 86400000).toISOString(),
    registration_phase1_end:   new Date(Date.now() + 7 * 86400000).toISOString(),
  }, { onConflict: 'id' }));

  // ── 4. Upsert courses ─────────────────────────────────────────
  const enrollStart = new Date(Date.now() - 86400000).toISOString();
  const enrollEnd   = new Date(Date.now() + 30 * 86400000).toISOString();

  const courses = [
    { id: IDS.course,       name: 'E2E Basic Groove',      description: 'E2E regression test course',
      type: 'normal',  start_time: '19:00', end_time: '20:30', capacity: 20, cards_per_session: 1 },
    { id: IDS.singleCourse, name: 'E2E Single Course',      description: 'E2E single-session enrollment test course',
      type: 'normal',  start_time: '20:00', end_time: '21:30', capacity: 20, cards_per_session: 1 },
    { id: IDS.multiCourse,  name: 'E2E Multi-Card Course',  description: 'E2E multi-card refund test course (cards_per_session=2)',
      type: 'normal',  start_time: '18:00', end_time: '19:30', capacity: 20, cards_per_session: 2 },
    { id: IDS.ntdCourse,    name: 'E2E NTD Course',         description: 'E2E course-fee payment test course (pricing_mode=ntd)',
      type: 'normal',  start_time: '17:00', end_time: '18:30', capacity: 20, cards_per_session: 0,
      pricing_mode: 'ntd' },
    { id: IDS.workshop,     name: 'E2E Workshop',           description: 'E2E workshop transfer test course',
      type: 'workshop',start_time: '21:00', end_time: '22:30', capacity: 20, cards_per_session: 1 },
    { id: IDS.oversellCourse, name: 'E2E Oversell Guard',  description: 'Capacity-1 course for concurrency oversell test',
      type: 'normal',  start_time: '12:00', end_time: '13:00', capacity: 1,  cards_per_session: 0 },
  ];

  for (const c of courses) {
    check(`course ${c.name}`, await sb.from('courses').upsert({
      ...c,
      group_id: IDS.courseGroup,
      teacher: 'E2E Teacher',
      room: 'E2E Room',
      enrollment_start_at: enrollStart,
      enrollment_end_at: enrollEnd,
    }, { onConflict: 'id' }));
  }

  // ── 5. Upsert course_sessions ─────────────────────────────────
  const sessions = [
    // Basic Groove: 2 past + 3 future
    { id: IDS.sessions.past14,  course_id: IDS.course, session_date: addDays(today, -14), session_number: -1 },
    { id: IDS.sessions.past7,   course_id: IDS.course, session_date: addDays(today,  -7), session_number:  0 },
    { id: IDS.sessions.future7, course_id: IDS.course, session_date: addDays(today,   7), session_number:  1 },
    { id: IDS.sessions.future14,course_id: IDS.course, session_date: addDays(today,  14), session_number:  2 },
    { id: IDS.sessions.future21,course_id: IDS.course, session_date: addDays(today,  21), session_number:  3 },
    // Single Course: 3 future
    { id: IDS.sessions.single1, course_id: IDS.singleCourse, session_date: addDays(today,  8), session_number: 1 },
    { id: IDS.sessions.single2, course_id: IDS.singleCourse, session_date: addDays(today, 15), session_number: 2 },
    { id: IDS.sessions.single3, course_id: IDS.singleCourse, session_date: addDays(today, 22), session_number: 3 },
    // Multi-Card Course: 1 future
    { id: IDS.sessions.multi1,  course_id: IDS.multiCourse,  session_date: addDays(today, 10), session_number: 1 },
    // NTD Course: 3 future
    { id: IDS.sessions.ntd1,    course_id: IDS.ntdCourse,    session_date: addDays(today,  9), session_number: 1 },
    { id: IDS.sessions.ntd2,    course_id: IDS.ntdCourse,    session_date: addDays(today, 16), session_number: 2 },
    { id: IDS.sessions.ntd3,    course_id: IDS.ntdCourse,    session_date: addDays(today, 23), session_number: 3 },
    // Workshop: 4 future
    { id: IDS.sessions.ws1,     course_id: IDS.workshop,     session_date: addDays(today,  3), session_number: 1 },
    { id: IDS.sessions.ws2,     course_id: IDS.workshop,     session_date: addDays(today, 10), session_number: 2 },
    { id: IDS.sessions.ws3,     course_id: IDS.workshop,     session_date: addDays(today, 17), session_number: 3 },
    { id: IDS.sessions.ws4,     course_id: IDS.workshop,     session_date: addDays(today, 24), session_number: 4 },
    // Oversell Guard: 1 future session (capacity-1 course)
    { id: IDS.sessions.oversell1, course_id: IDS.oversellCourse, session_date: addDays(today, 12), session_number: 1 },
  ];

  for (const s of sessions) {
    check(`session ${s.id}`, await sb.from('course_sessions').upsert({
      ...s, is_cancelled: false,
    }, { onConflict: 'id' }));
  }

  // ── 6. Upsert course_fee order + linked enrollment ────────────
  check('order courseFee', await sb.from('orders').upsert({
    id: IDS.orders.courseFee,
    user_id: memberId,
    order_type: 'course_fee',
    quantity: 1, used: 0, unit_price: 0, total_amount: 0, amount: 800,
    status: 'remitted',
    course_group_id: IDS.courseGroup,
    remittance_bank_code: '012',
    remittance_account_last5: '54321',
    remittance_date: now,
  }, { onConflict: 'id' }));

  // ── 7. Cleanup non-seed data (FK-safe order) ──────────────────
  // All e2e session IDs for cleanup queries
  const allSessionIds = Object.values(IDS.sessions);

  // 7a. makeup_requests
  check('cleanup makeup_requests', await sb.from('makeup_requests').delete()
    .eq('user_id', memberId)
    .in('original_course_id', [IDS.course, IDS.singleCourse, IDS.workshop]));
  // Also clean by target_course_id
  check('cleanup makeup_requests target', await sb.from('makeup_requests').delete()
    .eq('user_id', memberId)
    .in('target_course_id', [IDS.course, IDS.singleCourse, IDS.workshop]));

  // 7b. transfer_requests
  check('cleanup transfer_requests from', await sb.from('transfer_requests').delete()
    .in('course_id', [IDS.course, IDS.singleCourse, IDS.workshop])
    .eq('from_user_id', memberId));
  check('cleanup transfer_requests to', await sb.from('transfer_requests').delete()
    .in('course_id', [IDS.course, IDS.singleCourse, IDS.workshop])
    .eq('to_user_id', member2Id));

  // 7c. leave_requests
  check('cleanup leave_requests', await sb.from('leave_requests').delete()
    .eq('user_id', memberId)
    .in('session_id', allSessionIds));

  // 7d. attendance_records
  check('cleanup attendance member', await sb.from('attendance_records').delete()
    .eq('user_id', memberId)
    .in('session_id', allSessionIds));
  check('cleanup attendance member2', await sb.from('attendance_records').delete()
    .eq('user_id', member2Id)
    .in('session_id', allSessionIds));

  // 7e. card_transactions tied to single-course enrollments
  // First get enrollment IDs for single course
  const { data: singleEnrollments } = await sb.from('enrollments')
    .select('id').eq('course_id', IDS.singleCourse);
  if (singleEnrollments?.length) {
    check('cleanup card_tx single', await sb.from('card_transactions').delete()
      .in('enrollment_id', singleEnrollments.map(e => e.id)));
  }

  // card_transactions tied to multi-card course enrollments
  const { data: multiEnrollments } = await sb.from('enrollments')
    .select('id').eq('course_id', IDS.multiCourse);
  if (multiEnrollments?.length) {
    const nonSeed = multiEnrollments.filter(e => e.id !== IDS.enrollments.multiSingle);
    if (nonSeed.length) {
      check('cleanup card_tx multi', await sb.from('card_transactions').delete()
        .in('enrollment_id', nonSeed.map(e => e.id)));
    }
  }

  // 7f. Non-seed enrollments
  check('cleanup enroll basic', await sb.from('enrollments').delete()
    .eq('course_id', IDS.course)
    .neq('id', IDS.enrollments.memberFull));

  check('cleanup enroll single', await sb.from('enrollments').delete()
    .eq('course_id', IDS.singleCourse)
    .neq('id', IDS.enrollments.singleWaitlist));

  check('cleanup enroll multi', await sb.from('enrollments').delete()
    .eq('course_id', IDS.multiCourse)
    .neq('id', IDS.enrollments.multiSingle));

  check('cleanup enroll ntd', await sb.from('enrollments').delete()
    .eq('course_id', IDS.ntdCourse)
    .neq('id', IDS.enrollments.ntdPending));

  check('cleanup enroll workshop', await sb.from('enrollments').delete()
    .eq('course_id', IDS.workshop)
    .neq('id', IDS.enrollments.workshopFull));

  check('cleanup enroll oversell', await sb.from('enrollments').delete()
    .eq('course_id', IDS.oversellCourse));

  // 7g. Non-seed orders
  check('cleanup orders', await sb.from('orders').delete()
    .eq('user_id', memberId)
    .not('id', 'in', `(${SEED_ORDER_IDS.join(',')})`));

  // 7h. Non-seed card_transactions
  check('cleanup card_tx', await sb.from('card_transactions').delete()
    .eq('user_id', memberId)
    .not('id', 'in', `(${SEED_TX_IDS.join(',')})`));

  // ── 8. Upsert seed enrollments ────────────────────────────────
  const seedEnrollments = [
    { id: IDS.enrollments.memberFull, course_id: IDS.course, user_id: memberId,
      status: 'enrolled', type: 'full', session_id: null, source: 'self' },
    { id: IDS.enrollments.multiSingle, course_id: IDS.multiCourse, user_id: memberId,
      status: 'enrolled', type: 'single', session_id: IDS.sessions.multi1, source: 'self' },
    { id: IDS.enrollments.ntdPending, course_id: IDS.ntdCourse, user_id: memberId,
      status: 'pending_payment', type: 'full', session_id: null, source: 'self',
      order_id: IDS.orders.courseFee },
    { id: IDS.enrollments.workshopFull, course_id: IDS.workshop, user_id: memberId,
      status: 'enrolled', type: 'full', session_id: null, source: 'self' },
    { id: IDS.enrollments.singleWaitlist, course_id: IDS.singleCourse, user_id: member2Id,
      status: 'waitlist', type: 'full', session_id: null, source: 'self', waitlist_position: 1 },
  ];

  for (const e of seedEnrollments) {
    check(`enrollment ${e.id}`, await sb.from('enrollments').upsert(e, { onConflict: 'id' }));
  }

  // ── 9. Upsert seed orders ─────────────────────────────────────
  check('order card10', await sb.from('orders').upsert({
    id: IDS.orders.card10,
    user_id: memberId, quantity: 10, used: 0, unit_price: 270, total_amount: 2700,
    status: 'confirmed', expires_at: '2026-12-31', confirmed_at: now,
    confirmed_by: adminId, order_type: 'card_purchase',
  }, { onConflict: 'id' }));

  check('order card2', await sb.from('orders').upsert({
    id: IDS.orders.card2,
    user_id: memberId, quantity: 2, used: 2, unit_price: 270, total_amount: 540,
    status: 'confirmed', expires_at: '2026-12-31', confirmed_at: now,
    confirmed_by: adminId, order_type: 'card_purchase',
  }, { onConflict: 'id' }));

  // ── 10. Upsert seed card_transactions ─────────────────────────
  check('tx purchase10', await sb.from('card_transactions').upsert({
    id: IDS.transactions.purchase10,
    user_id: memberId, type: 'purchase', amount: 10, balance_after: 10,
    order_id: IDS.orders.card10, note: 'E2E seed: 10 cards purchased',
    created_by: adminId,
  }, { onConflict: 'id' }));

  check('tx purchase2', await sb.from('card_transactions').upsert({
    id: IDS.transactions.purchase2,
    user_id: memberId, type: 'purchase', amount: 2, balance_after: 12,
    order_id: IDS.orders.card2, note: 'E2E seed: 2 cards for multi-card course',
    created_by: adminId,
  }, { onConflict: 'id' }));

  // ── 11. Upsert absence on past session ────────────────────────
  check('attendance absence', await sb.from('attendance_records').upsert({
    session_id: IDS.sessions.past7,
    user_id: memberId,
    status: 'absent',
    marked_by: adminId,
    marked_at: now,
  }, { onConflict: 'session_id,user_id' }));

  console.log('[globalSetup] E2E seed applied successfully.');

  // ── 12. Generate storageState for each role ───────────────────
  // Use a real Playwright browser to log in each role via the UI and
  // save the resulting storageState. This produces correct cookies with
  // proper domain/path that the middleware accepts -- avoiding manual
  // cookie construction and IPv6 domain-matching issues.
  //
  // The login runs ONCE per role in globalSetup (not per-test), so even
  // if the React hydration race hits, we can retry aggressively here.
  const authDir = path.join(process.cwd(), 'e2e', '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();

  for (const [role, creds] of Object.entries(ACCOUNTS)) {
    const context = await browser.newContext();
    const page = await context.newPage();

    let loggedIn = false;
    // Retry login up to 3 times to handle the hydration race that only
    // affects the first ever login attempt in a cold browser context.
    for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
      await page.goto('http://[::1]:3000/login');
      // Wait for full network idle to ensure React hydration completes
      await page.waitForLoadState('networkidle');
      // Extra guard: wait for the submit button to be interactive
      const submitBtn = page.getByRole('button', { name: '登入' });
      await submitBtn.waitFor({ state: 'visible', timeout: 15000 });

      await page.getByLabel('電子郵件').fill(creds.email);
      await page.getByLabel('密碼').fill(creds.password);
      await submitBtn.click();

      try {
        await page.waitForURL(/dashboard/, { timeout: 15000 });
        loggedIn = true;
      } catch {
        console.warn(`[globalSetup] Login attempt ${attempt}/3 for ${role} timed out, retrying...`);
      }
    }

    if (!loggedIn) {
      await context.close();
      await browser.close();
      throw new Error(`[globalSetup] Failed to log in as ${role} after 3 attempts`);
    }

    await context.storageState({ path: path.join(authDir, `${role}.json`) });
    await context.close();
  }

  await browser.close();
  console.log('[globalSetup] Auth storageState files written for all roles.');
}
