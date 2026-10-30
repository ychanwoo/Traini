import { test, expect } from '@playwright/test';

// Freeze browser time, keep the training timezone different from the device,
// and reject external requests before they can reach any provider.
test.use({ timezoneId: 'Asia/Seoul' });
async function setup(page, instant) {
  const errors = [], imports = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3027') {
      errors.push('Unexpected external request');
      return route.abort();
    }
    return route.continue();
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/garmin/sync' && request.method() === 'GET') imports.push(url.searchParams.get('week'));
    if (request.method() === 'POST' && /\/generate$/.test(url.pathname)) errors.push('Unexpected generation');
  });
  await page.clock.install({ time: new Date(instant) });
  await page.goto('/today');
  await page.getByRole('combobox', { name: 'Test scenario', exact: true }).selectOption('reset');
  await page.reload();
  return { errors, imports };
}
async function assertFlow(page, state, sunday) {
  const target = page.locator('#today-next');
  await expect(target.getByRole('region', { name: sunday ? '다음 주 계획 관리' : '이번 주 계획 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '오늘 탭 사용 순서' }).getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('region', { name: '이번 주 계획 관리', exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: '다음 주 계획 관리', exact: true })).toHaveCount(sunday ? 1 : 0);
  await expect.poll(() => state.imports.at(-1)).toBe(sunday ? 'current' : 'previous');
  expect(state.errors).toEqual([]);
}

for (const [day, instant] of [
  ['Monday', '2026-10-19T19:00:00Z'],
  ['Tuesday', '2026-10-20T19:00:00Z'],
  ['Wednesday', '2026-10-21T19:00:00Z'],
  ['Thursday', '2026-10-22T19:00:00Z'],
  ['Friday', '2026-10-23T19:00:00Z'],
  ['Saturday', '2026-10-24T19:00:00Z'],
]) {
  test(`${day} imports previous week and prepares current week`, async ({ page }) => {
    const state = await setup(page, instant);
    await assertFlow(page, state, false);
  });
}

for (const [name, start, end, beforeSunday, afterSunday, trigger] of [
  ['Saturday to Sunday', '2026-10-18T06:59:50Z', '2026-10-18T07:00:01Z', false, true, 'timer'],
  ['Sunday to Monday', '2026-10-19T06:59:50Z', '2026-10-19T07:00:01Z', true, false, 'timer'],
  ['return to tab on Monday', '2026-10-19T06:59:50Z', '2026-10-19T07:00:01Z', true, false, 'focus'],
  ['DST repeated Sunday hour', '2026-11-01T08:59:50Z', '2026-11-01T09:00:01Z', true, true, 'timer'],
  ['Monday after DST ends', '2026-11-02T07:59:50Z', '2026-11-02T08:00:01Z', true, false, 'timer'],
]) {
  test(name, async ({ page }) => {
    const state = await setup(page, start);
    await assertFlow(page, state, beforeSunday);
    if (beforeSunday !== afterSunday) state.imports.length = 0;
    await page.clock.setSystemTime(new Date(end));
    if (trigger === 'focus') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    else await page.clock.runFor(31_000);
    await assertFlow(page, state, afterSunday);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
