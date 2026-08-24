import { test, expect } from '@playwright/test';

const password = process.env.SMOKE_PASSWORD;

test.describe('DeviceOps web journey', () => {
  test.beforeEach(() => {
    test.skip(!password, 'Set SMOKE_PASSWORD to the local seeded password.');
  });

  test('signs in, reads status, queues a run, and opens its timeline', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to DeviceOps' })).toBeVisible();
    await page.getByLabel('Email').fill('tech@alpha.test');
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Technician diagnosis workspace' })).toBeVisible();
    await page.getByLabel('Device').selectOption({ label: 'Main Wall Display · ProView-85' });
    await expect(page.getByText('● offline')).toBeVisible();

    await page.getByRole('button', { name: 'Queue diagnosis' }).click();
    await expect(page.getByText('Run queued. Open the timeline to watch durable events and citations.')).toBeVisible({ timeout: 15_000 });
    const timelineLink = page.getByRole('link', { name: /Open run timeline/ });
    await expect(timelineLink).toBeVisible();
    await timelineLink.click();
    await expect(page.getByText('Durable run timeline')).toBeVisible();
    await expect(page.getByText('Validated output')).toBeVisible({ timeout: 20_000 });
  });
});
