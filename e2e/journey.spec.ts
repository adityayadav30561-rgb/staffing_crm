import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { newSession, signIn, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

test('each role sees the right menus', async ({ browser }) => {
  const riya = await newSession(browser, 'riya');
  await expect(riya.getByRole('link', { name: 'Pipeline' })).toBeVisible();
  await expect(riya.getByRole('link', { name: 'Placements' })).toHaveCount(0);
  await expect(riya.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  const manager = await newSession(browser, 'manager');
  await expect(manager.getByRole('link', { name: 'Placements' })).toBeVisible();
  await expect(manager.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  const admin = await newSession(browser, 'admin');
  await expect(admin.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('requirement intake to submission, worked by two recruiters', async ({ browser, page }) => {
  // Manager: client -> requirement (draft) -> open -> assign both recruiters (doc step 1)
  await signIn(page, 'manager');
  await page.goto('/clients?new=1');
  await page.getByLabel('Company name').fill('ABC Technologies');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'ABC Technologies' })).toBeVisible();

  await page.getByRole('button', { name: 'New requirement' }).click();
  await page.getByLabel('Job title').fill('Senior React Developer');
  await page.getByLabel('Positions').fill('5');
  await page.getByLabel('Skills').fill('React, TypeScript');
  await page.getByRole('button', { name: 'Create requirement' }).click();
  await expect(page.getByText('This requirement is a draft')).toBeVisible();

  await page.getByLabel('Change status').selectOption('open');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
  const requirementUrl = page.url();

  await page.getByRole('tab', { name: 'Details & postings' }).click();
  await page.getByRole('button', { name: 'Assign recruiters' }).click();
  await page.getByLabel('Riya Recruiter').check();
  await page.getByLabel('Rohan Recruiter').check();
  await page.getByRole('button', { name: 'Save team' }).click();
  await expect(toast(page, 'Team updated')).toBeVisible();

  // Riya adds Amit to the shared database (doc step 3)
  const riya = await newSession(browser, 'riya');
  await riya.goto('/candidates?new=1');
  await riya.getByLabel('Full name').fill('Amit Kumar');
  await riya.getByLabel('Mobile').fill('98450 12345');
  await riya.getByLabel('Current company').fill('Infosys');
  await riya.getByLabel('Experience (yrs)').fill('6');
  await riya.getByLabel('Current CTC (LPA)').fill('18');
  await riya.getByLabel('Expected CTC (LPA)').fill('24');
  await riya.getByLabel('Notice (days)').fill('30');
  await riya.getByRole('button', { name: 'Save' }).click();
  await expect(riya.getByRole('heading', { name: 'Amit Kumar' })).toBeVisible();

  // Rohan tries to add him again: the duplicate warning shows up
  const rohan = await newSession(browser, 'rohan');
  await rohan.goto('/candidates?new=1');
  await rohan.getByLabel('Mobile').fill('+91 9845012345');
  await expect(rohan.getByText(/Possible duplicate/)).toBeVisible();
  await expect(rohan.getByRole('dialog').getByRole('link', { name: 'Amit Kumar' })).toBeVisible();
  await rohan.keyboard.press('Escape');

  // Both open the requirement and try to map Amit at the same time (doc step 5 guard)
  await riya.goto(requirementUrl);
  await rohan.goto(requirementUrl);
  for (const p of [riya, rohan]) {
    await p.getByRole('button', { name: 'Add candidate' }).click();
    await p.getByPlaceholder('Search name, phone, company or skill').fill('Amit');
    await expect(p.getByText('Amit Kumar')).toBeVisible();
  }
  await Promise.all([
    riya.getByRole('dialog').getByRole('button', { name: 'Add' }).first().click(),
    rohan.getByRole('dialog').getByRole('button', { name: 'Add' }).first().click(),
  ]);
  // Exactly one of them is told the candidate is already on the requirement
  await expect
    .poll(
      async () =>
        (await toast(riya, /Already on this requirement/).count()) +
        (await toast(rohan, /Already on this requirement/).count()),
    )
    .toBe(1);

  // Whoever won works the application from the drawer; use Riya's view after reload
  await riya.goto(requirementUrl);
  await riya.getByRole('button', { name: /Amit Kumar/ }).click();
  const drawer = riya.locator('aside.bg-detail');
  await drawer.getByRole('button', { name: 'Interested', exact: true }).click();
  await drawer.getByRole('button', { name: 'Move to Screening' }).click();
  await expect(drawer.getByRole('heading', { name: 'Screening card' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Mark submitted to client' })).toBeDisabled();
  await drawer.getByLabel('Current location').fill('Pune');
  await drawer.getByLabel('Skill rating (1–5)').selectOption('4');
  await drawer
    .getByLabel('Remarks for the client')
    .fill('Strong React, ready to interview this week');
  await drawer.getByRole('button', { name: 'Save screening' }).click();
  await expect(toast(riya, 'Screening saved')).toBeVisible();

  await drawer.getByRole('button', { name: 'Mark submitted to client' }).click();
  await riya.getByRole('dialog').getByLabel('Channel').selectOption('whatsapp');
  await riya.getByRole('button', { name: 'Log submission' }).click();
  await expect(toast(riya, /Submission logged/)).toBeVisible();
  await expect(drawer.getByText('Awaiting feedback')).toBeVisible();

  // Manager sees it in the pipeline (doc step 6)
  await page.goto('/pipeline');
  await page.getByRole('tab', { name: /Submitted/ }).click();
  await expect(page.getByRole('row', { name: /Amit Kumar/ })).toContainText('Feedback pending');
});

test('Excel import wizard', async ({ page }, testInfo) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tracker');
  ws.addRow([
    'Candidate Name',
    'Mobile No',
    'Email ID',
    'Current Company',
    'Total Exp',
    'CTC',
    'Notice Period',
  ]);
  ws.addRow(['Neha Sharma', '9811100001', 'neha@x.com', 'TCS', '4 yrs', '9 LPA', '30 days']);
  ws.addRow(['Vikram Rao', '9811100002', 'vikram@x.com', 'Wipro', 7, 15, '2 months']);
  ws.addRow(['Amit Kumar again', '98450 12345', '', '', '', '', '']);
  const file = testInfo.outputPath('tracker.xlsx');
  await wb.xlsx.writeFile(file);

  await signIn(page, 'manager');
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByText('tracker.xlsx · 3 rows')).toBeVisible();
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByText('Ready to import').locator('..')).toContainText('2');
  await expect(page.getByText(/Matches Amit Kumar/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 candidates' }).click();
  await expect(page.getByRole('main').getByText('2 candidates imported')).toBeVisible();
  await page.getByRole('button', { name: 'Go to candidates' }).click();
  await expect(page.getByText('Vikram Rao')).toBeVisible();
});
