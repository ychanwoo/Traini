import { test, expect } from '@playwright/test';

test('main tabs share card radii and preserve the mobile frame', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3027' ? route.continue() : route.abort());
  await page.goto('/today');
  await page.getByRole('combobox', { name: 'Test scenario', exact: true }).selectOption('reset');
  const importCard = page.getByRole('region', { name: 'Garmin 주간 기록 가져오기', exact: true });
  await expect(importCard).toHaveCSS('border-radius', '8px');
  await expect(importCard.getByRole('button', { name: /가져오기$/, exact: false })).toHaveCSS('border-radius', '6px');
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

test('a long Korean workout title reflows inside the schedule row', async ({ page }) => {
  const workout = '대화가 가능한 강도로 호흡을 고르게 유지하며 달리는 장거리 훈련';
  await page.route('**/api/training/plan?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.plan.workouts[0].title = workout;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/schedule');
  const title = page.getByText(workout, { exact: true });
  await expect(title).toBeVisible();
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 812 });
    const fits = await title.evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = node.getBoundingClientRect();
      const lines = [...range.getClientRects()];
      return lines.length > 1 && lines.every(line =>
        line.left >= box.left - 1 && line.right <= box.right + 1 && line.bottom <= box.bottom + 1);
    });
    expect(fits).toBe(true);
  }
});
