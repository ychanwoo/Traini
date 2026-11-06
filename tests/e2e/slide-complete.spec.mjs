import { test, expect } from '@playwright/test';

test('slide requires a full gesture, prevents duplicate saves and permits retry', async ({ page }) => {
  let calls = 0, completed = false;
  let releaseRead;
  const refreshedPlan = new Promise(resolve => { releaseRead = resolve; });
  await page.route('**/api/training/complete', async route => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { error: '테스트 저장 실패' } });
    completed = true;
    await route.fulfill({ json: { saved: true } });
  });
  await page.route('**/api/training/plan?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (completed) await refreshedPlan;
    if (completed && data.plan) data.plan.workouts.forEach(w => { if (w.date === data.period.today) w.completed = true; });
    await route.fulfill({ response, json: data });
  });
  await page.goto('/today');
  const handle = page.getByRole('button', { name: '오늘의 훈련 완료', exact: true });
  await handle.click();
  expect(calls).toBe(0);
  async function drag(fraction) {
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const track = await handle.locator('..').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (track.width - box.width - 2) * fraction, box.y + box.height / 2, { steps: 12 });
    const expanded = await handle.boundingBox();
    expect(expanded.x).toBeCloseTo(box.x, 0);
    expect(expanded.width).toBeGreaterThan(box.width);
    if (fraction === 0.4) await handle.locator('..').screenshot({ path: '/tmp/traini-expanding-slider.png' });
    await page.mouse.up();
  }
  await drag(0.4);
  expect(calls).toBe(0);
  await expect(handle).toHaveCSS('width', '64px');
  await drag(1);
  await expect(page.getByRole('alert').filter({ hasText: '테스트 저장 실패' })).toBeVisible();
  await expect(handle).toBeEnabled();
  await drag(1);
  await expect(page.getByRole('button', { name: '훈련 완료됨', exact: true })).toBeDisabled();
  releaseRead();
  expect(calls).toBe(2);
  const savedHandle = page.getByRole('button', { name: '훈련 완료됨', exact: true });
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await expect.poll(async () => {
      const knob = await savedHandle.boundingBox(), rail = await savedHandle.locator('..').boundingBox();
      return Math.abs(rail.x + rail.width - knob.x - knob.width - 1);
    }).toBeLessThan(1);
  }
});

test('completion supports keyboard without a drag', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/training/complete', route => { calls++; return route.fulfill({ status: 503, json: { error: '테스트 저장 실패' } }); });
  await page.goto('/today');
  const handle = page.getByRole('button', { name: '오늘의 훈련 완료', exact: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(handle).toHaveCSS('transition-duration', '0s');
  await handle.focus();
  await handle.press('Enter');
  await expect.poll(() => calls).toBe(1);
});

test('touch slide completes only on release and cancelled gestures do not save', async ({ page, context }) => {
  let calls = 0;
  await page.route('**/api/training/complete', route => { calls++; return route.fulfill({ status: 503, json: { error: '테스트 저장 실패' } }); });
  await page.goto('/today');
  const handle = page.getByRole('button', { name: '오늘의 훈련 완료', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox(), track = await handle.locator('..').boundingBox();
  const client = await context.newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x, y }]);
  await touch('touchMove', [{ x: x + 45, y }]);
  await touch('touchCancel', []);
  expect(calls).toBe(0);
  await expect(handle).toHaveCSS('width', '64px');
  await touch('touchStart', [{ x, y }]);
  for (let step = 1; step <= 10; step++) await touch('touchMove', [{ x: x + (track.width - box.width - 2) * step / 10, y }]);
  expect(calls).toBe(0);
  await touch('touchEnd', []);
  await expect.poll(() => calls).toBe(1);
  await client.detach();
});
