import { expect, type Browser, type Page } from '@playwright/test';

export async function signIn(page: Page, who: 'admin' | 'manager' | 'riya' | 'rohan') {
  await page.goto('/');
  await page.getByLabel('Work email').fill(`${who}@e2e.crm`);
  await page.getByLabel('Password').fill('Password@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
}

export async function newSession(browser: Browser, who: 'admin' | 'manager' | 'riya' | 'rohan') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, who);
  return page;
}

/** Toast messages appear at the bottom of the screen. */
export const toast = (page: Page, text: string | RegExp) =>
  page.locator('[aria-live=polite]').getByText(text);
