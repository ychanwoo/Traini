import { expect, test } from "@playwright/test";

const workflows = [
  { kind: "review", endpoint: "**/api/training/review**", title: "주간 리뷰 작성 중", action: "최신 기록으로 리뷰 업데이트", width: 768 },
  { kind: "plan", endpoint: "**/api/training/generate", title: "이번 주 훈련계획 생성 중", action: "이번 주 남은 훈련 다시 조정", width: 320 },
  { kind: "garmin", endpoint: "**/api/garmin/sync**", title: "Garmin 기록 가져오는 중", action: /^(이번 주|지난주) 가져오기$/, width: 375 },
];

for (const { kind, endpoint, title, action, width } of workflows) {
  test(`${kind} loading is frame-sized, blocks duplicates and releases on failure and retry`, async ({ page, request }, info) => {
    await request.post("/__test/control", { data: { scenario: "reset" } });
    await request.post("/__test/control", { data: { scenario: "stale" } });
    await page.clock.setFixedTime(new Date("2026-10-17T18:00:00Z"));
    await page.setViewportSize({ width, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let calls = 0, release, currentJob;
    await page.route(endpoint, async route => {
      if (route.request().method() === "GET") {
        if (currentJob) {
          const result = currentJob;
          currentJob = undefined;
          return route.fulfill({ json: result });
        }
        return route.continue();
      }
      calls++;
      await new Promise(resolve => { release = resolve; });
      if (calls === 1) return route.fulfill({ status: 503, json: { error: "잠시 후 다시 시도해 주세요." } });
      if (kind === "plan") {
        const response = await request.get("/api/training/plan?week=current");
        return route.fulfill({ json: await response.json() });
      }
      if (kind === "garmin") {
        const result = await (await route.fetch()).json();
        currentJob = result;
        return route.fulfill({ json: { ...result, job: { ...result.job, status: "running", stage: "parsing" } } });
      }
      return route.continue();
    });
    await page.goto(kind === "garmin" ? "/garmin-connect" : "/today");
    await page.locator("aside").evaluate(el => { el.hidden = true; });
    const button = page.getByRole("button", { name: action, exact: true });
    const dialog = page.getByRole("dialog", { name: title });
    for (const attempt of [1, 2]) {
      if (kind === "plan" && !(await button.isVisible())) await page.getByText("이번 주 계획 조정 열기", { exact: true }).click();
      await expect(button).toBeEnabled();
      await button.scrollIntoViewIfNeeded();
      await button.evaluate(el => { el.click(); el.click(); });
      await expect(dialog).toBeVisible();
      await expect.poll(() => calls).toBe(attempt);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(el => el.matches(":modal"))).toBe(true);
      const box = await dialog.boundingBox();
      expect(box.width).toBe(Math.min(430, width));
      expect(box.height).toBe(812);
      expect(box.x).toBe((width - box.width) / 2);
      if (attempt === 1) await page.screenshot({ path: info.outputPath(kind + "-loading.png") });
      release();
      if (kind === "garmin" && attempt === 2) await expect(dialog.getByRole("status")).toContainText("FIT");
      await expect(dialog).toHaveCount(0);
      if (attempt === 1) await expect(page.getByText("잠시 후 다시 시도해 주세요.", { exact: true })).toBeVisible();
    }
    expect(calls).toBe(2);
  });
}
