import assert from "node:assert/strict";
// Shared by Playwright and Codex's browser driver. Only public UI interactions;
// never writes browser storage, patches fetch, or invokes private React state.
export function coachingScenarios(tab, viewport, base = "http://127.0.0.1:3027") {
  const p = tab.playwright;
  const review = () => p.getByRole("region", {name: "주간 훈련 리뷰", exact: true});
  const scenario = async value => {
    await p.getByRole("combobox", {name: "Test scenario", exact: true}).selectOption(value);
    await p.getByLabel("Active test scenario", {exact: true}).getByText(value, {exact: true}).waitFor({state: "visible"});
    await tab.getAXState({emit: false});
  };
  const show = async (scope, text) => {
    await scope.getByText(text).first().waitFor({state: "visible"});
  };
  const reset = async path => {
    await tab.reload();
    await tab.getAXState({emit: false});
    await scenario("reset");
    if (await p.evaluate(() => document.location.pathname) === (path ?? "/schedule")) await tab.reload();
    else await tab.goto(`${base}${path ?? "/schedule"}`);
    await show(review(), "비교 기준보다 러닝 거리가 늘었어요.");
  };
  const diagnostic = async () => {
    await p.getByRole("button", {name: "Inspect test requests", exact: true}).click();
    await show(p, /inferenceRequests/);
    const counts = JSON.parse(await p.getByLabel("Test request counts", {exact: true}).innerText());
    assert.equal(counts.inferenceRequests, 0);
    assert.equal(counts.reviewGenerationRequests, 0, "Reading and recording feedback must not generate a review");
    assert.deepEqual(counts.unexpectedRequests, [], "Unexpected APIs fail closed");
    return counts;
  };
  const firstWorkout = () => p.getByRole("region", {name: "주간 훈련 일정", exact: true}).locator("article").first();
  const openFeedback = async row => {
    await row.locator("summary").filter({hasText: /훈련.*피드백|직접 건너뜀/}).click();
    await row.getByRole("combobox", {name: "훈련 결과", exact: true}).waitFor({state: "visible"});
  };
  return {
    async closeout() {
      await reset();
      const card = p.getByRole("region", {name:"주간 마감",exact:true});
      await scenario("closeout-sunday");
      await show(card,"2026-10-12 – 2026-10-18 · America/Los_Angeles");
      await show(card,/2026-10-19부터 7일/);
      const close = card.getByRole("button",{name:"주간 마감 확인",exact:true});
      assert.equal(await close.isEnabled(),false);
      await card.getByRole("checkbox").check();await close.click();
      await show(card,"이 주의 기록으로 마감을 확인했어요. 리뷰와 계획 생성은 각각 직접 실행해 주세요.");
      await show(review(),/아직 저장된 AI 리뷰가 없어/);
      assert.equal((await diagnostic()).closeoutRequests.length,1);
      await tab.reload();
      await show(card,/이 주의 기록으로 마감을 확인했어요/);
      await scenario("closeout-monday");
      await show(card,/완료된 지난주 기록을 확인해 주세요/);
      await show(card,"2026-10-12 – 2026-10-18 · America/Los_Angeles");
      await scenario("closeout-stale");
      await show(card,/마감 이후 기록·목표·피드백이 바뀌었어요/);
      await show(review(),/일요일 마감 이후 기록이 바뀌었어요/);
      assert.equal(await review().getByRole("button",{name:"주간 리뷰 생성",exact:true}).isEnabled(),false);
      await card.getByRole("checkbox").check();
      await card.getByRole("button",{name:"주간 마감 갱신",exact:true}).click();
      // Leave stale scenario after the explicit POST so subsequent GETs do not invent another edit.
      await scenario("closeout-sunday");
      await show(card,/이 주의 기록으로 마감을 확인했어요/);
      assert.equal((await diagnostic()).closeoutRequests.length,2);
    },
    async history() {
      await reset();
      await show(review(), /38.5km/);
      await show(review(), /선택한 주의 리뷰를 참고한 계획/);
      await review().getByRole("combobox", {name: "리뷰 주간 선택"}).selectOption("2026-09-28");
      await show(review(), /총 42km/);
      await show(review(), /선택한 리뷰가 직접 반영된 것은 아니에요/);
      await review().getByText("저장된 AI 리뷰 원문", {exact: true}).click();
      await show(review(), "이전 주에는 42km를 달렸어요.");
      await review().getByRole("combobox", {name: "리뷰 주간 선택"}).selectOption("2026-10-05");
      await show(review(), /총 38.5km/);
      assert.ok(!(await review().innerText()).includes("총 42km"));
      await p.getByRole("button", {name: "다음 주 보기", exact: true}).click();
      await show(p, "다음 주 훈련 방향");
      assert.equal(await p.getByRole("button", {name: "결과·피드백 저장", exact: true}).count(), 0, "Future training feedback remains closed");
      await p.getByRole("button", {name: "이번 주 보기", exact: true}).click();
      await show(p, "이번 주 훈련 방향");
      await diagnostic();
    },
    async feedback() {
      await reset();
      // A late report belongs to the original completed week, not today's date.
      await p.getByRole("button", {name: "지난주 보기", exact: true}).click();
      await show(p, "지난주 훈련 방향");
      let row = firstWorkout();
      await openFeedback(row);
      await row.getByRole("combobox", {name: "훈련 결과", exact: true}).selectOption("completed");
      await row.getByRole("combobox", {name: "체감 강도 · RPE", exact: true}).selectOption("7");
      await row.getByRole("combobox", {name: "피로", exact: true}).selectOption("moderate");
      await row.getByRole("combobox", {name: "통증·불편감", exact: true}).selectOption("discomfort");
      await row.getByRole("textbox", {name: /메모/}).fill("늦게 남긴 테스트 피드백 <script>memo</script>");
      await row.getByRole("button", {name: "결과·피드백 저장", exact: true}).click();
      await show(row, "완료 · 직접 표시");
      await row.getByText("훈련 피드백 · 기록 및 수정", {exact: true}).click();
      assert.equal(await row.getByRole("combobox", {name: "체감 강도 · RPE", exact: true}).evaluate(e => e.value), "7");
      await review().getByText("수행 기록·피드백", {exact: true}).click();
      await show(review(), /피드백 입력 1개/);
      await review().getByText("훈련 피드백·건너뜀 사유", {exact: true}).click();
      await show(review(), /늦게 남긴 테스트 피드백/);
      await tab.reload();
      await review().getByText("수행 기록·피드백", {exact: true}).click();
      await show(review(), /피드백 입력 1개/);
      const counts = await diagnostic();
      assert.equal(counts.feedbackRequests.length, 1);
      assert.equal(counts.feedbackRequests[0].workoutId, "previous-0");
      assert.equal(counts.feedbackRequests[0].assessment.rpe, 7);
      await p.getByRole("link", {name: "오늘", exact: true}).click();
      await show(review(), /통증·불편감이 남아 있어요/);
      await p.getByRole("link", {name: "일정", exact: true}).click();
      await show(review(), /통증·불편감이 남아 있어요/);
      assert.equal((await diagnostic()).feedbackRequests.length, 1);
    },
    async skip() {
      await reset("/today");
      await p.getByText("훈련 결과·피드백 기록", {exact: true}).click();
      await p.getByRole("combobox", {name: "훈련 결과", exact: true}).selectOption("skipped");
      const save = p.getByRole("button", {name: "결과·피드백 저장", exact: true});
      assert.equal(await save.isEnabled(), false, "Skip requires a reason");
      await p.getByRole("textbox", {name: /건너뛴 사유/}).fill("일정이 바빠 쉬었어요. actualKm은 메모 그대로");
      await save.click();
      await show(p, "× 직접 건너뜀 · 사유 및 수정");
      await p.getByText("× 직접 건너뜀 · 사유 및 수정", {exact: true}).click();
      await show(p, /사유 · 일정이 바빠 쉬었어요/);
      await p.getByRole("link", {name: "일정", exact: true}).click();
      await show(p, "× 직접 건너뜀");
      await p.getByText("× 직접 건너뜀 · 사유 및 수정", {exact: true}).click();
      assert.equal(await p.getByRole("textbox", {name: /건너뛴 사유/}).evaluate(e => e.value), "일정이 바빠 쉬었어요. actualKm은 메모 그대로");
      await tab.reload();
      await show(p, "× 직접 건너뜀");
      const counts = await diagnostic();
      assert.equal(counts.feedbackRequests.length, 1);
      assert.equal(counts.feedbackRequests[0].workoutId, "current-5");
      assert.equal(counts.feedbackRequests[0].outcome, "skipped");
    },
    async importedHistory() {
      await reset("/today");
      const summary = p.getByRole("region", {name: "주간 러닝 요약", exact: true});
      await show(summary, "분석·업로드가 완료된 FIT 기록 기준");
      await show(summary, /15/);
      await summary.getByRole("button", {name: "지난주", exact: true}).click();
      await show(summary, "지난주 러닝 2개를 불러왔어요.");
      await scenario("summary-error");
      await summary.getByRole("button", {name: "주간 기록 새로고침", exact: true}).click();
      await summary.getByRole("alert").waitFor({state: "visible"});
      await show(summary, "분석·업로드가 완료된 FIT 기록 기준");
      await summary.getByRole("button", {name: "이번 주", exact: true}).click();
      await summary.getByRole("alert").waitFor({state: "visible"});
      assert.equal(await summary.getByText("분석·업로드가 완료된 FIT 기록 기준", {exact: true}).count(), 0, "Do not retain a different week's data");
      await scenario("normal");
      await summary.getByRole("button", {name: "다시 확인", exact: true}).click();
      await show(summary, "이번 주 러닝 2개를 불러왔어요.");
      await scenario("partial");
      await summary.getByRole("button", {name: "주간 기록 새로고침", exact: true}).click();
      await show(summary, "거리는 값이 있는 1/2개 기록의 합계예요.");
      await scenario("empty");
      await summary.getByRole("button", {name: "주간 기록 새로고침", exact: true}).click();
      await show(summary, "이번 주에 저장된 러닝 기록이 없어요.");
      await diagnostic();
    },
    async readFailures() {
      await reset();
      for (const [mode, message] of [["review-error", "테스트 리뷰 조회 실패"], ["unauthorized", "관리자 로그인 상태를 확인해 주세요."], ["forbidden", "관리자 로그인 상태를 확인해 주세요."], ["malformed", "서버 응답을 확인하지 못했어요."]]) {
        await scenario(mode);
        await review().getByRole("alert").filter({hasText: message}).waitFor({state: "visible"});
        assert.ok((await review().innerText()).includes("38.5km"), "Retain loaded review after failed refresh");
        await scenario("normal");
        await review().getByRole("alert").waitFor({state: "hidden"});
        await show(review(), /총 38.5km/);
      }
      await scenario("plan-error");
      await show(p, "테스트 계획 조회 실패");
      await show(p, "이번 주 훈련 방향");
      await scenario("normal");
      await tab.reload();
      await show(review(), /총 38.5km/);
      await scenario("review-error");
      await tab.reload();
      await review().getByRole("button", {name: "다시 확인"}).waitFor({state: "visible"});
      assert.equal(await review().getByText("현재 계획에서는", {exact: true}).count(), 0);
      await scenario("normal");
      await show(review(), /총 38.5km/);
      await diagnostic();
    },
    async dataStates() {
      await reset();
      await scenario("partial");
      await show(review(), "이번 주 거리는 일부만 확인됐어요.");
      await show(review(), /부분 합계여서 평소보다 늘거나 줄었다고 평가하지 않았어요/);
      await scenario("stale");
      await show(p, /표시된 계획은 변경 전 데이터/);
      await show(review(), /저장된 AI 리뷰 이후 자료가 바뀌어/);
      await scenario("pain");
      await show(review(), /상태를 다시 확인하기 전까지 러닝 제한/);
      await show(review(), /현재 제한과 맞게 저장됐어요/);
      await scenario("empty");
      await show(review(), "러닝 기록을 먼저 확인할 주예요.");
      await show(p, "이 주에 저장된 계획이 없어요.");
      await scenario("slow");
      await tab.reload();
      await show(p, "저장된 훈련계획을 확인하고 있어요.");
      await show(review(), /총 38.5km/);
      await diagnostic();
    },
    async saveFailures() {
      for (const mode of ["save-error", "save-conflict", "save-lost"]) {
        await reset("/today");
        await scenario(mode);
        await p.getByText("훈련 결과·피드백 기록", {exact: true}).click();
        await p.getByRole("combobox", {name: "훈련 결과", exact: true}).selectOption("completed");
        await p.getByRole("textbox", {name: /메모/}).fill("실패 후 유지 · 저장 확인용 메모");
        await p.getByRole("button", {name: "결과·피드백 저장", exact: true}).click();
        await p.getByRole("alert").waitFor({state: "visible"});
        if (mode === "save-lost") {
          await show(p, "훈련 피드백 · 기록 및 수정");
          await p.getByText("훈련 피드백 · 기록 및 수정", {exact: true}).click();
        }
        assert.equal(await p.getByRole("textbox", {name: /메모/}).evaluate(e => e.value), "실패 후 유지 · 저장 확인용 메모");
        const firstAttempt = await diagnostic();
        assert.equal(firstAttempt.feedbackRequests.length, 1, "No automatic mutation retry");
        if (mode === "save-error") {
          await p.getByRole("button", {name: "결과·피드백 저장", exact: true}).click();
          await show(p, "저장 여부를 확인해 주세요. 입력은 유지했어요.");
          const retried = await diagnostic();
          assert.equal(retried.feedbackRequests.length, 2);
          assert.equal(retried.feedbackRequests[0].requestId, retried.feedbackRequests[1].requestId, "An unchanged explicit retry keeps its operation ID");
        }
        await scenario("normal");
        await tab.reload();
        if (mode === "save-lost") await show(p, "훈련 완료됨 ✓");
        else await show(p, "오늘의 훈련 완료");
      }
    },
    async responsive() {
      await reset();
      await firstWorkout().getByText("훈련 결과·피드백 기록", {exact: true}).click();
      await firstWorkout().getByRole("combobox", {name: "훈련 결과", exact: true}).selectOption("skipped");
      await firstWorkout().getByRole("textbox", {name: /건너뛴 사유/}).fill("LongUnbrokenReason".repeat(5));
      await review().getByText("저장된 AI 리뷰 원문", {exact: true}).click();
      for (const width of [320, 375, 430, 768]) {
        await viewport.set({width, height: 812});
        await review().getByText("현재 계획에서는", {exact: true}).click();
        const sizes = await p.evaluate(() => {
          const frame = document.querySelector(".app-frame"), nav = document.querySelector(".bottom-nav");
          return { width: window.innerWidth, documentWidth: document.documentElement.scrollWidth, frame: frame.getBoundingClientRect().width, nav: nav.getBoundingClientRect().width,
            overflow: [...document.querySelectorAll(".app-frame section, .app-frame article, .app-frame details")].filter(e => e.scrollWidth > e.clientWidth + 1).length };
        });
        assert.ok(sizes.documentWidth <= sizes.width, JSON.stringify(sizes));
        assert.ok(sizes.frame <= Math.min(width, 430));
        assert.equal(sizes.nav, sizes.frame);
        assert.equal(sizes.overflow, 0, JSON.stringify(sizes));
      }
      await diagnostic();
    },
  };
}
