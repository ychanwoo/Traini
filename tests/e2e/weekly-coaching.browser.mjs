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
    if (await p.evaluate(() => document.location.pathname) === (path ?? "/coaching-regression")) await tab.reload();
    else await tab.goto(`${base}${path ?? "/coaching-regression"}`);
    if (path !== "/today") await show(review(), "비교 기준보다 러닝 거리가 늘었어요.");
    // Review and plan load independently. Wait for the fresh reset plan too,
    // before touching forms whose identity changes when that read completes.
    if (!path || path === "/today" || path === "/coaching-regression") await p.getByRole("button",{name:"오늘의 훈련 완료",exact:true}).waitFor({state:"visible"});
    else await p.getByRole("region",{name:"주간 훈련 일정",exact:true}).locator("article").first().getByText("이지런",{exact:true}).waitFor({state:"visible"});
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
  const openCoachingDetails = async () => {
    const item=review().getByText("평가 근거·계획 반영 상세",{exact:true});
    if (!(await item.evaluate(e => e.closest("details").open))) await item.click();
  };
  const firstWorkout = () => p.getByRole("region", {name: "지난 훈련 기록", exact: true}).locator("article").first();
  const openFeedback = async row => {
    await row.locator("summary").filter({hasText: /훈련.*피드백|직접 건너뜀/}).click();
    await row.getByRole("combobox", {name: "훈련 결과", exact: true}).waitFor({state: "visible"});
  };
  return {
    async weeklyFeedback() {
      await reset("/today");
      for(const label of ["오늘 어땠나요?","완료·건너뜀 수정","훈련 결과·피드백 기록","지난 훈련 기록·수정"]) assert.equal(await p.getByText(label,{exact:true}).count(),0,label);
      const note=p.getByRole("region",{name:"주간 체감 강도와 메모",exact:true});
      await note.getByRole("combobox",{name:"주간 체감 강도 · RPE",exact:true}).selectOption("6");
      await note.getByRole("textbox",{name:/주간 메모/}).fill("이번 주에는 다리가 무거웠어요");
      await note.getByRole("button",{name:"주간 피드백 저장",exact:true}).click();
      await show(note,"저장했어요. 이 주의 리뷰 생성에 반영돼요.");
      let counts=await diagnostic();
      assert.equal(counts.feedbackRequests.length,0);
      assert.equal(counts.weeklyFeedbackRequests.length,1);
      assert.equal(counts.weeklyFeedbackRequests[0].startsOn,"2026-10-05");
      assert.equal(counts.weeklyFeedbackRequests[0].rpe,6);
      await tab.reload();
      await note.getByRole("textbox",{name:/주간 메모/}).waitFor({state:"visible"});
      assert.equal(await note.getByRole("textbox",{name:/주간 메모/}).evaluate(e=>e.value),"이번 주에는 다리가 무거웠어요");
      await review().getByRole("combobox",{name:"리뷰 주간 선택",exact:true}).selectOption("2026-09-28");
      await note.getByRole("textbox",{name:/주간 메모/}).waitFor({state:"visible"});
      assert.equal(await note.getByRole("textbox",{name:/주간 메모/}).evaluate(e=>e.value),"");
      await review().getByRole("combobox",{name:"리뷰 주간 선택",exact:true}).selectOption("2026-10-05");
      await note.getByRole("textbox",{name:/주간 메모/}).waitFor({state:"visible"});
      assert.equal(await note.getByRole("textbox",{name:/주간 메모/}).evaluate(e=>e.value),"이번 주에는 다리가 무거웠어요");
      for(const width of [320,375,430,768]) {
        await viewport.set({width,height:812});
        const sizes=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,frame:document.querySelector(".app-frame").getBoundingClientRect().width}));
        assert.ok(sizes.scroll<=sizes.width);assert.ok(sizes.frame<=Math.min(width,430));
      }
      await diagnostic();
    },
    async weeklyFeedbackFailures() {
      for(const mode of ["save-error","save-conflict","save-lost"]) {
        await reset("/today");
        const note=p.getByRole("region",{name:"주간 체감 강도와 메모",exact:true});
        await note.getByRole("textbox",{name:/주간 메모/}).fill("실패해도 유지할 주간 메모");
        await scenario(mode);
        await note.getByRole("button",{name:"주간 피드백 저장",exact:true}).click();
        await show(note,/저장 실패|메모가 바뀌었어요|응답을 확인하지/);
        assert.equal(await note.getByRole("textbox",{name:/주간 메모/}).evaluate(e=>e.value),"실패해도 유지할 주간 메모");
        let counts=await diagnostic();assert.equal(counts.weeklyFeedbackRequests.length,1);
        await scenario("normal");
        await note.getByRole("button",{name:"주간 피드백 저장",exact:true}).click();
        await show(note,"저장했어요. 이 주의 리뷰 생성에 반영돼요.");
        counts=await diagnostic();assert.equal(counts.weeklyFeedbackRequests.length,2);
        assert.equal(counts.weeklyFeedbackRequests[0].requestId,counts.weeklyFeedbackRequests[1].requestId);
        assert.equal(counts.feedbackRequests.length,0);
      }
    },
    async todayWorkflow({ sunday = false } = {}) {
      await reset("/today");
      const flow=p.getByRole("navigation",{name:"오늘 탭 사용 순서",exact:true});
      assert.equal(await flow.getByRole("link").count(),4);
      const order=await p.evaluate(()=>Array.from(document.querySelectorAll('[id^="today-"]')).map(e=>e.id));
      assert.equal(order.join(","),"today-import,today-session,today-review,today-next");
      const session=p.getByRole("region",{name:"오늘 훈련 단계",exact:true});
      const current=p.getByRole("region",{name:"이번 주 계획 관리",exact:true});
      const next=p.getByRole("region",{name:"다음 주 계획 관리",exact:true});
      await current.getByText("이번 주 계획 조정 열기",{exact:true}).click();
      await show(current,"새로 반영할 변경사항이 없어요. 저장된 계획을 따르면 돼요.");
      assert.equal(await current.getByRole("button").count(),0);
      await scenario("empty");
      await show(current,"이번 주 남은 훈련 계획 만들기");
      if (sunday) await show(next,"다음 주 계획 만들기");
      else assert.equal(await next.count(),0);
      await scenario("plan-generating");
      await current.getByRole("button",{name:"훈련계획 생성 중…",exact:true}).waitFor({state:"visible"});
      assert.equal(await current.getByRole("button").isEnabled(),false);
      await scenario("plan-adjustment-invalid");
      // Session presentation contains no generation button; adjustment has its own card.
      assert.equal(await session.locator('section.card').first().getByRole("button",{name:/다시 조정|계획 만들기/}).count(),0);
      for(const [region,week,name] of [[current,"current","이번 주 남은 훈련 다시 조정"],...(sunday ? [[next,"next","다음 주 계획 다시 조정"]] : [])]) {
        await region.getByText(`${week === "current" ? "이번 주" : "다음 주"} 계획 조정 열기`,{exact:true}).click();
        await region.getByRole("button",{name,exact:true}).click();
        await region.getByRole("alert").waitFor({state:"visible"});
        await show(region,/기존 계획은 유지/);
      }
      await show(session,"이지런");
      const counts=await diagnostic();
      assert.deepEqual(counts.planGenerationRequests,sunday ? [{week:"current"},{week:"next"}] : [{week:"current"}]);
    },
    async compactSchedule() {
      await reset();
      await tab.goto(`${base}/schedule`);
      const rows=p.getByRole("region",{name:"주간 훈련 일정",exact:true}).locator("article");
      await rows.first().getByText("이지런",{exact:true}).waitFor({state:"visible"});
      assert.equal(await rows.count(),7);
      for(const label of ["Garmin 기록 확인","훈련 결과·피드백 기록","주간 훈련 리뷰","주간 마감","훈련 구성"]) assert.equal(await p.getByText(label,{exact:true}).count(),0,label);
      await show(rows.first(),/km/);
      await show(rows.first(),/km.*km/);
      for(const width of [320,375,430,768]) {
        await viewport.set({width,height:812});
        const sizes=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,frame:document.querySelector(".app-frame").getBoundingClientRect().width}));
        assert.ok(sizes.scroll<=sizes.width);
        assert.ok(sizes.frame<=430);
      }
      await p.getByRole("button",{name:"지난주 보기",exact:true}).click();
      await show(p,"10.05 – 10.11");
      await diagnostic();
    },
    async metricStates() {
      await reset("/today");
      const card=p.getByRole("region",{name:"이번 주 러닝 기록",exact:true});
      await show(card,"15");
      await scenario("partial");
      await show(card,/부분 합계/);
      await show(card,"7");
      await scenario("empty");
      await show(card,"0");
      assert.equal(await card.getByText(/부분 합계/).count(),0);
      await scenario("progress-error");
      await show(card,/갱신 실패, 마지막 확인 기록/);
      await show(card,"0");
      await diagnostic();
    },
    async roadmapPhases() {
      await reset();
      await scenario("race-preparation");
      await tab.goto(`${base}/roadmap`);
      await p.getByRole("heading",{name:"테스트 주목표",exact:true}).waitFor({state:"visible"});
      await show(p,"실제 기록에 맞춰 다음 한 주를 준비해요.");
      await p.getByText("단계 적용 이유·회복 확인 기준",{exact:true}).click();
      await show(p,/테이퍼 14일/);
      await scenario("race-taper");
      await show(p,"훈련량을 줄이며 익숙한 자극을 조절하는 시기예요.");
      await scenario("race-recovery");
      await show(p,"복귀 전 상태와 러닝 기록을 확인해 주세요.");
      await show(p,/고강도·장거리 배치를 보류/);
      for(const width of [320,375,430,768]) {
        await viewport.set({width,height:812});
        const bounds=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        assert.ok(bounds.scroll<=bounds.width,JSON.stringify(bounds));
      }
      await diagnostic();
    },
    async authRefresh() {
      await reset();
      await tab.goto(`${base}/auth-refresh`);
      const card=p.getByRole("region",{name:"내 실제 훈련 요약",exact:true});
      await show(card,"30");
      await scenario("slow");
      await p.getByRole("button",{name:"Recheck fixture session",exact:true}).click();
      assert.equal(await card.getByText("30",{exact:false}).first().isVisible(),true);
      assert.equal(await p.getByRole("status",{name:"관리자 로그인 상태 확인 중",exact:true}).count(),0);
      await scenario("auth-check-failed");
      await p.getByRole("button",{name:"Recheck fixture session",exact:true}).click();
      await show(p,/로그인 상태를 확인하지 못했습니다/);
      assert.equal(await card.count(),0);
      await scenario("normal");
      await p.getByRole("button",{name:"다시 확인하기",exact:true}).click();
      await show(card,"30");
      await diagnostic();
    },
    async currentImport() {
      await reset();
      await tab.goto(`${base}/garmin-connect`);
      const card=p.getByRole("region",{name:"Garmin 주간 기록 가져오기",exact:true});
      await card.getByRole("button",{name:"이번 주 가져오기",exact:true}).waitFor({state:"visible"});
      await card.getByRole("button",{name:"이번 주 가져오기",exact:true}).click();
      await show(card,/러닝 2개를 저장·확인/);
      await show(card,/연결을 확인했어요/);
      await card.getByRole("button",{name:"지난주 기록 보기",exact:true}).click();
      await card.getByRole("button",{name:"지난주 가져오기",exact:true}).waitFor({state:"visible"});
      await card.getByRole("button",{name:"이번 주 기록 보기",exact:true}).click();
      await card.getByRole("button",{name:"이번 주 가져오기",exact:true}).waitFor({state:"visible"});
      await diagnostic();
    },
    async progressRefresh() {
      await reset();
      await tab.goto(`${base}/my`);
      const card=p.getByRole("region",{name:"내 실제 훈련 요약",exact:true});
      await show(card,"최근 8주 훈련 인사이트");
      await show(card,"30");
      await scenario("slow");
      assert.equal(await card.getByText("30",{exact:false}).first().isVisible(),true);
      assert.equal(await card.getByText("목표와 저장된 러닝 기록을 확인하고 있어요.",{exact:true}).isVisible(),false);
      await scenario("progress-error");
      await show(card,/마지막으로 확인한 기록/);
      await show(card,"30");
      await scenario("reset");
      await card.getByRole("link",{name:"러닝 기록 자세히 보기"}).click();
      await show(p,"최근 8주 기록 요약");
      assert.equal(await p.getByText("목표와 저장된 러닝 기록을 확인하고 있어요.",{exact:true}).isVisible(),false);
      await diagnostic();
    },
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
      await openCoachingDetails();
      await show(review(), /선택한 주의 리뷰를 참고한 계획/);
      await review().getByRole("combobox", {name: "리뷰 주간 선택"}).selectOption("2026-09-28");
      await show(review(), /총 42km/);
      await openCoachingDetails();
      await show(review(), /선택한 리뷰가 직접 반영된 것은 아니에요/);
      await review().getByText("저장된 AI 리뷰 원문", {exact: true}).click();
      await show(review(), "이전 주에는 42km를 달렸어요.");
      await review().getByRole("combobox", {name: "리뷰 주간 선택"}).selectOption("2026-10-05");
      await show(review(), /총 38.5km/);
      assert.ok(!(await review().innerText()).includes("총 42km"));
      await tab.goto(`${base}/schedule`);
      await p.getByRole("button", {name: "다음 주 보기", exact: true}).click();
      await show(p, "10.19 – 10.25");
      assert.equal(await p.getByRole("button", {name: "결과·피드백 저장", exact: true}).count(), 0, "Future training feedback remains closed");
      await p.getByRole("button", {name: "이번 주 보기", exact: true}).click();
      await tab.goto(`${base}/coaching-regression`);
      await show(p, "이번 주 계획 근거");
      await diagnostic();
    },
    async feedback() {
      await reset();
      // A late report belongs to the original completed week, not today's date.
      await p.getByText("지난 훈련 기록·수정", {exact:true}).click();
      await p.getByRole("combobox", {name:"기록할 주",exact:true}).selectOption("previous");
      await p.getByRole("combobox", {name:"기록할 훈련",exact:true}).waitFor({state:"visible"});
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
      await tab.goto(`${base}/coaching-regression`);
      await show(review(), /검토한 주에 통증·불편감 보고/);
      await p.getByRole("link", {name: "일정", exact: true}).click();
      assert.equal(await review().count(),0);
      await p.getByRole("link", {name:"오늘",exact:true}).click();
      await tab.goto(`${base}/coaching-regression`);
      await show(review(), /검토한 주에 통증·불편감 보고/);
      assert.equal((await diagnostic()).feedbackRequests.length, 1);
    },
    async skip() {
      await reset("/coaching-regression");
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
      await show(p, /× 건너뜀/);
      await tab.goto(`${base}/coaching-regression`);
      await p.getByText("× 직접 건너뜀 · 사유 및 수정", {exact: true}).click();
      assert.equal(await p.getByRole("textbox", {name: /건너뛴 사유/}).evaluate(e => e.value), "일정이 바빠 쉬었어요. actualKm은 메모 그대로");
      await tab.reload();
      await show(p, "× 직접 건너뜀 · 사유 및 수정");
      const counts = await diagnostic();
      assert.equal(counts.feedbackRequests.length, 1);
      assert.equal(counts.feedbackRequests[0].workoutId, "current-5");
      assert.equal(counts.feedbackRequests[0].outcome, "skipped");
    },
    async importedHistory() {
      await reset("/today");
      await p.getByText("주간 기록 자세히",{exact:true}).click();
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
      await show(p, "이번 주 계획 근거");
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
      await show(p, /입력이 바뀌어 계획 재검토/);
      await show(review(), /저장된 AI 리뷰 이후 자료가 바뀌어/);
      await scenario("pain");
      await show(review(), /상태를 다시 확인하기 전까지 러닝 제한/);
      await openCoachingDetails();
      await show(review(), /현재 제한과 맞게 저장됐어요/);
      await scenario("empty");
      await show(review(), "러닝 기록을 먼저 확인할 주예요.");
      await show(p, "오늘의 계획이 없어요");
      await scenario("slow");
      await tab.reload();
      await show(p, "저장된 훈련계획을 확인하고 있어요.");
      await show(review(), /총 38.5km/);
      await diagnostic();
    },
    async saveFailures() {
      for (const mode of ["save-error", "save-conflict", "save-lost"]) {
        await reset("/coaching-regression");
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
      await p.getByText("훈련 결과·피드백 기록", {exact: true}).click();
      await p.getByRole("combobox", {name: "훈련 결과", exact: true}).selectOption("skipped");
      await p.getByRole("textbox", {name: /건너뛴 사유/}).fill("LongUnbrokenReason".repeat(5));
      await openCoachingDetails();
      await review().getByText("저장된 AI 리뷰 원문", {exact: true}).click();
      for (const width of [320, 375, 430, 768]) {
        await viewport.set({width, height: 812});
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
