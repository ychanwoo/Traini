import { expect, test } from '@playwright/test';

test('Today and Schedule show actions appropriate to the selected screen', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: '이지런', exact: true })).toBeVisible();
  for (const label of ['이번 주 기록 보기', '오늘의 훈련 완료', '전체 설명 읽기', '계획에 사용한 리뷰', '마감은 무엇을 바꾸나요?', '평가 범위와 제한']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '오늘의 훈련 완료' })).toHaveCount(0);
  await page.goto('/schedule');
  await expect(page.locator('.schedule-row')).toHaveCount(7);
  await expect(page.getByText('계획에 사용한 리뷰')).toHaveCount(0);
});
