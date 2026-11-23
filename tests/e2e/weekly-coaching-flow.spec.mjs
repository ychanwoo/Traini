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

for (const [day, date, week, start, heading] of [
  ["Sunday", "2026-10-18", "next", "2026-10-19", "10.19 – 10.25"],
  ["Wednesday", "2026-10-14", "current", "2026-10-12", "10.12 – 10.18"],
]) {
  test(day + " opens the saved schedule week only after success", async ({ page, request }) => {
    await page.clock.setFixedTime(new Date(date + "T19:00:00Z"));
    await request.post("/__test/control", { data: { scenario: "empty" } });
    let attempts = 0;
    const save = gate();
    await page.route("**/api/training/generate", async route => {
      expect(route.request().postDataJSON().week).toBe(week);
      if (++attempts === 1) return route.fulfill({ status: 503, json: { error: "계획 저장 실패" } });
      await save.wait;
      await request.post("/__test/control", { data: { scenario: "normal" } });
      const response = await request.get("/api/training/plan?week=" + week);
      await route.fulfill({ json: await response.json() });
    });
    await page.goto("/today");
    const button = page.locator("#today-next").getByRole("button", { name: /만들기/ });
    await button.click();
    await expect(page.locator("#today-next").getByRole("alert")).toHaveText("계획 저장 실패");
    await expect(page).toHaveURL(/\/today$/);
    await button.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/today$/);
    save.release();
    await expect(page).toHaveURL(new RegExp("/schedule\\?start=" + start + "$"));
    await expect(page.locator(".schedule-week")).toContainText(heading);
    expect(attempts).toBe(2);
  });
}

test("step four waits for a new read of the correct plan week after saving a review", async ({ page, request }) => {
  await request.post("/__test/control", { data: { scenario: "stale" } });
  await page.clock.setFixedTime(new Date("2026-10-18T19:00:00Z"));
  let saved = false, wrongWeek = true, generations = 0;
  const reading = gate();
  await page.route("**/api/training/review**", async route => {
    const response = await route.fetch();
    if (route.request().method() === "POST") saved = true;
    return route.fulfill({ response });
  });
  await page.route("**/api/training/plan?week=next", async route => {
    if (!saved) return route.continue();
    await reading.wait;
    const response = await request.get("/api/training/plan?week=" + (wrongWeek ? "current" : "next"));
    return route.fulfill({ json: await response.json() });
  });
  await page.route("**/api/training/generate", route => { generations++; return route.abort(); });
  await page.goto("/today");
  const step = page.locator("#today-next");
  await step.locator("summary").click();
  await expect(step.getByRole("button", { name: /다시 조정/ })).toBeEnabled();
  await page.getByRole("button", { name: "최신 기록으로 리뷰 업데이트" }).click();
  await expect(step.getByRole("status")).toContainText("계획 주간");
  const locked = step.getByRole("button", { name: /만들기/ });
  await expect(locked).toBeDisabled();
  await locked.evaluate(button => button.click());
  reading.release();
  await expect(step.getByRole("alert")).toContainText("아직 반영되지");
  await expect(locked).toBeDisabled();
  wrongWeek = false;
  await step.getByRole("button", { name: "다시 확인" }).click();
  await expect(step).toContainText("2026-10-19 – 2026-10-25");
  await step.locator("summary").click();
  await expect(step.getByRole("button", { name: /다시 조정/ })).toBeEnabled();
  expect(generations).toBe(0);
});
