import { Page, expect } from '@playwright/test';

export const ACCOUNTS = {
  admin:  { email: 'e2e-admin@mediatek.com',  password: 'mediatek' },
  member: { email: 'e2e-member@mediatek.com', password: 'mediatek' },
  guest:  { email: 'e2e-guest@mediatek.com',  password: 'mediatek' },
} as const;

export async function loginAs(page: Page, role: keyof typeof ACCOUNTS) {
  await page.goto('/login');
  await page.getByLabel('電子郵件').fill(ACCOUNTS[role].email);
  await page.getByLabel('密碼').fill(ACCOUNTS[role].password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/dashboard/);
}
