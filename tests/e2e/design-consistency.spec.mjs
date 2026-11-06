import { test, expect } from '@playwright/test';

test('main tabs share card radii and preserve the mobile frame', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3027' ? route.continue() : route.abort());
  await page.goto('/today');
  await page.getByRole('combobox', { name: 'Test scenario', exact: true }).selectOption('reset');
  const importCard = page.getByRole('region', { name: 'Garmin 주간 기록 가져오기', exact: true });
  await expect(importCard).toHaveCSS('border-radius', '8px');
  await expect(importCard.getByRole('button', { name: /가져오기$/, exact: false })).toHaveCSS('border-radius', '6px');
  await expect(page.getByRole('button', { name: '오늘의 훈련 완료', exact: true }).locator('..')).toHaveCSS('border-radius', '999px');
  await page.getByRole('combobox', { name: 'Test scenario', exact: true }).selectOption('race-preparation');
  for (const path of ['/today', '/schedule', '/roadmap', '/my']) {
    await page.goto(path);
    const card = path === '/today' ? page.getByRole('region', { name: 'Garmin 주간 기록 가져오기', exact: true })
      : path === '/schedule' ? page.locator('.schedule-row').first()
      : path === '/roadmap' ? page.getByRole('heading', { name: '테스트 주목표', exact: true }).locator('..')
      : page.getByRole('region', { name: '내 실제 훈련 요약', exact: true });
    await expect(card).toHaveCSS('border-radius', '8px');
    for (const width of [320, 375, 430, 768]) {
      await page.setViewportSize({ width, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.app-frame').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(430);
    }
  }
});
