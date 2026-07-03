import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export const ACCOUNTS = {
  admin:   { email: 'e2e-admin@mediatek.com',   password: 'mediatek' },
  member:  { email: 'e2e-member@mediatek.com',  password: 'mediatek' },
  member2: { email: 'e2e-member2@mediatek.com', password: 'mediatek' },
  guest:   { email: 'e2e-guest@mediatek.com',   password: 'mediatek' },
} as const;

/**
 * Authenticate as the given role by restoring pre-built storageState
 * (cookies + localStorage saved by globalSetup's browser-based login)
 * instead of going through the login UI on every test.
 *
 * This eliminates the React-hydration race that caused intermittent
 * login-stuck flakes (form submit firing before React attaches
 * e.preventDefault, causing a native GET that reloads /login).
 */
export async function loginAs(page: Page, role: keyof typeof ACCOUNTS) {
  const authFile = path.join(process.cwd(), 'e2e', '.auth', `${role}.json`);
  if (!fs.existsSync(authFile)) {
    throw new Error(
      `Missing auth state file: ${authFile}. ` +
      'globalSetup should have created it. Check that globalSetup ran successfully.'
    );
  }

  const storageState = JSON.parse(fs.readFileSync(authFile, 'utf-8'));

  // Clear any existing auth state from prior role in this context
  await page.context().clearCookies();

  // Restore the pre-authenticated cookies (domain/path already correct
  // from the real browser login in globalSetup)
  if (storageState.cookies?.length) {
    await page.context().addCookies(storageState.cookies);
  }

  // Restore localStorage if present (Supabase browser client may store
  // auth data in localStorage as well as cookies)
  if (storageState.origins?.length) {
    // Navigate to a page first so we can access localStorage for the origin
    await page.goto('/login');
    for (const origin of storageState.origins) {
      for (const item of origin.localStorage) {
        await page.evaluate(
          ([key, value]: [string, string]) => localStorage.setItem(key, value),
          [item.name, item.value] as [string, string],
        );
      }
    }
  }

  // Navigate to dashboard to confirm auth is working.
  // The middleware will verify the session cookie and let us through.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
}
