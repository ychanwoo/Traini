import { test, expect } from '@playwright/test';

const guidance = '검토한 주의 거리와 최장 달리기 증가를 근거로 거리를 15% 줄이고, 템포·인터벌은 합계 최대 2회 이내로 권합니다.';
const followup = '회복 상태를 확인하면서 다음 훈련의 강도를 조절해 주세요.';
const longUrl = 'https://example.test/training/' + 'long-unbroken-reference'.repeat(12);
const rationale = `${guidance} 자세한 기준: ${longUrl}`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3027' || route.request().method() !== 'GET') return route.abort();
    return route.continue();
  });
  await page.route('**/api/training/review**', async route => {
    const response = await route.fetch(), data = await response.json();
    if (data.review) {
      data.review.fresh = true;
      data.review.content.nextWeek.rationale = `${guidance} ${followup}`;
    }
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/training/plan?*', async route => {
    const response = await route.fetch(), data = await response.json();
    if (data.plan) data.plan.summary = rationale;
    await route.fulfill({ response, json: data });
  });
});

for (const width of [320, 375, 430]) {
  test(`Korean coaching words stay intact and long references wrap at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/today');
    const list = page.getByRole('list', { name: '다음 훈련 방향', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toHaveText(guidance);
    const splits = await list.evaluate(element => {
      const broken = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (const match of node.textContent.matchAll(/[가-힣]+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
          if (lines.size > 1) broken.push(match[0]);
        }
      }
      return broken;
    });
    expect(splits).toEqual([]);
    await list.screenshot({ path: testInfo.outputPath('coaching-guidance.png') });
    await page.getByText('이번 주 계획 근거', { exact: true }).click();
    await page.getByText('전체 설명 읽기', { exact: true }).click();
    const full = page.getByText(rationale, { exact: true });
    await expect(full).toBeVisible();
    expect(await full.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const bounds = await full.evaluate((el, url) => {
      const text = el.firstChild;
      const start = text.textContent.indexOf(url);
      const range = document.createRange();
      range.setStart(text, start); range.setEnd(text, start + url.length);
      const box = el.getBoundingClientRect();
      const rects = [...range.getClientRects()];
      return { lines: rects.length, contained: rects.every(r => r.left >= box.left - 1 && r.right <= box.right + 1) };
    }, longUrl);
    expect(bounds.lines).toBeGreaterThan(1);
    expect(bounds.contained).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.app-frame').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(430);
  });
}
