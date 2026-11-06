import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3027'
    ? route.continue() : route.abort());
  await page.goto('/today');
  await page.getByRole('combobox', { name: 'Test scenario', exact: true }).selectOption('reset');
});

test('Today stays focused and schedule details follow the selected week', async ({ page }) => {
  await expect(page.getByText('주간 기록 자세히', { exact: true })).toHaveCount(0);
  await expect(page.getByText('WEEKLY DISTANCE', { exact: true })).toHaveCount(0);
  await expect(page.getByText('RUNS THIS WEEK', { exact: true })).toHaveCount(0);
  const weeks = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/garmin/weekly-summary') weeks.push(url.searchParams.get('week'));
  });
  await page.goto('/schedule');
  const summary = page.getByRole('region', { name: '주간 러닝 요약', exact: true });
  await expect(summary).toHaveCount(0);
  expect(weeks).toEqual([]);
  await page.getByText('주간 기록 자세히', { exact: true }).click();
  await expect(summary).toContainText('총 거리15km');
  await expect.poll(() => weeks.at(-1)).toBe('current');
  await expect(summary.getByRole('group', { name: '조회할 주간' })).toHaveCount(0);
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.app-frame').evaluate(e => e.getBoundingClientRect().width)).toBeLessThanOrEqual(430);
  }
  await summary.screenshot({ path: '/tmp/traini-schedule-records.png' });
  await page.getByRole('button', { name: '지난주 보기' }).click();
  await expect(summary).toHaveCount(0);
  await page.getByText('주간 기록 자세히', { exact: true }).click();
  await expect(summary).toContainText('총 거리15km');
  await expect.poll(() => weeks.at(-1)).toBe('previous');
  await page.getByRole('button', { name: '이번 주 보기' }).click();
  await page.getByRole('button', { name: '다음 주 보기' }).click();
  await expect(page.getByText('주간 기록 자세히', { exact: true })).toHaveCount(0);
});

test('weather pace comparison stays readable and clears on failed refresh', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 33, longitude: -117 });
  let failed = false;
  await page.route('**/api/weather?*', route => route.fulfill({
    status: failed ? 503 : 200,
    json: failed ? { code: 'weather_provider' } : {
      kind: 'current', temperatureC: 23, feelsLikeC: 23, humidityPercent: 40,
      windMetersPerSecond: 2, gustMetersPerSecond: null, conditionCode: 800,
      summary: '맑음', validAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), requestedFor: null,
    },
  }));
  await page.reload();
  const weather = page.getByRole('region', { name: '현재 날씨 안내', exact: true });
  await weather.getByRole('button', { name: '현재 위치로 날씨 확인' }).click();
  const paces = weather.locator('dl[aria-label="처방과 날씨 보정 페이스"]');
  await expect(paces).toContainText('5′30″/km');
  await expect(paces).toContainText('5′36″/km');
  await expect(paces).toContainText('+2%');
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await paces.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await weather.screenshot({ path: '/tmp/traini-weather-refinement.png' });
  failed = true;
  await weather.getByRole('button').first().click();
  await expect(weather).toContainText('날씨 정보를 가져오지 못했어요');
  await expect(paces).toHaveCount(0);
});

test('opening weekly records scrolls the app content without moving the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/schedule');
  const toggle = page.locator('summary').filter({ hasText: '주간 기록 자세히' });
  await toggle.focus();
  const before = await page.evaluate(() => ({
    scroll: document.querySelector('.app-tab-content').scrollTop,
    page: window.scrollY,
  }));
  await toggle.press('Enter');
  await expect(page.getByRole('region', { name: '주간 러닝 요약', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.app-tab-content').evaluate(el => el.scrollTop)).toBeGreaterThan(before.scroll);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.page);
  await toggle.press('Enter');
  await expect(page.getByRole('region', { name: '주간 러닝 요약', exact: true })).toHaveCount(0);
});
