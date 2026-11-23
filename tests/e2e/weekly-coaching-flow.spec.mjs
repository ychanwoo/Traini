import { test, expect } from "@playwright/test";

function gate() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

test.beforeEach(async ({ request }) => {
  await request.post("/__test/control", { data: { scenario: "reset" } });
});

test("Sunday closeout waits for the confirmed snapshot and retries without requiring feedback", async ({ page, request }) => {
  await request.post("/__test/control", { data: { scenario: "closeout-sunday" } });
  await page.clock.setFixedTime(new Date("2026-10-18T19:00:00Z"));
  const post = gate(), get = gate();
  let targetedReads = 0;
  await page.route("**/api/training/closeout", async route => {
    if (route.request().method() === "POST") await post.wait;
    await route.continue();
  });
  await page.route("**/api/training/review?start=2026-10-12", async route => {
    targetedReads++;
    if (targetedReads === 1) {
      await get.wait;
      return route.fulfill({ status: 503, json: { error: "다시 확인해 주세요." } });
    }
    if (targetedReads === 2) {
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({ json: { ...body, closeout: null } });
    }
    return route.continue();
  });
  await page.goto("/today");
  const week = page.getByLabel("리뷰 주간 선택");
  await expect(week).toHaveValue("2026-10-05");
  await week.selectOption("2026-09-28");
  await expect(week).toHaveValue("2026-09-28");
  const closeout = page.getByRole("region", { name: "주간 마감", exact: true });
  await closeout.getByRole("checkbox").check();
  await closeout.getByRole("button", { name: "주간 마감 확인" }).click();
  await expect(week).toBeHidden();
  post.release();
  await expect.poll(() => targetedReads).toBe(1);
  await expect(week).toBeHidden();
  const review = page.getByRole("region", { name: "주간 훈련 리뷰", exact: true });
  const generate = review.getByRole("button", { name: "주간 리뷰 생성", exact: true });
  await expect(generate).toBeHidden();
  get.release();
  const retry = review.getByRole("button", { name: "다시 확인" });
  await retry.click();
  await expect(review.getByRole("alert")).toContainText("최신 기록");
  await expect(generate).toBeHidden();
  await retry.click();
  await expect(week).toHaveValue("2026-10-12");
  await expect(generate).toBeEnabled();
  const posted = page.waitForRequest(r => r.url().endsWith("/api/training/review") && r.method() === "POST");
  await generate.click();
  expect((await posted).postDataJSON().startsOn).toBe("2026-10-12");
});

test("saved optional feedback must be reflected in the review before generation", async ({ page, request }) => {
  await request.post("/__test/control", { data: { scenario: "stale" } });
  let saved = false, lag = true;
  await page.route("**/api/training/weekly-feedback", async route => {
    const response = await route.fetch();
    saved = true;
    await route.fulfill({ response });
  });
  await page.route("**/api/training/review**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (saved && lag) body.weeklyFeedback = null;
    await route.fulfill({ json: body });
  });
  await page.goto("/today");
  const review = page.getByRole("region", { name: "주간 훈련 리뷰", exact: true });
  const generate = review.getByRole("button", { name: "최신 기록으로 리뷰 업데이트" });
  await expect(generate).toBeEnabled();
  await review.locator("summary").filter({ hasText: "이번 주 어땠나요?" }).click();
  await review.getByRole("textbox").fill("합성 테스트 메모");
  await expect(generate).toBeDisabled();
  await review.getByRole("button", { name: "주간 피드백 저장" }).click();
  await expect(review.getByRole("alert")).toContainText("최신 기록");
  await expect(generate).toBeDisabled();
  lag = false;
  await review.getByRole("button", { name: "다시 확인" }).click();
  await expect(generate).toBeEnabled();
});
