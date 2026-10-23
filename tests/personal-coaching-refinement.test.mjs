import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { typescriptLoader } from "./helpers/load-typescript.mjs";
const load = typescriptLoader({ "./training.module.css": { default: {} } });
const { collectionPeriod, collectionPeriodLabel } = load(
  "lib/garmin/collection.ts",
);
const { coachingLead } = load("lib/training/coaching-presentation.ts");
const { CoachingDetail } = load("components/training/coaching-detail.tsx");
test("web imports include yesterday on weekdays, with complete previous-week access", () => {
  const zone = "America/Los_Angeles";
  for (const now of [
    "2026-10-22T17:00:00Z",
    "2026-03-09T07:00:00Z",
    "2026-11-02T08:00:00Z",
    "2027-01-04T08:00:00Z",
  ]) {
    const current = collectionPeriod(zone, "auto", new Date(now));
    const explicit = collectionPeriod(zone, "current", new Date(now));
    assert.equal(current.start, explicit.start);
    assert.equal(current.end, explicit.end);
    assert.equal(new Date(current.start + "T00:00:00Z").getUTCDay(), 1);
    const previous = collectionPeriod(zone, "previous", new Date(now));
    assert.ok(previous.end < current.start);
  }
  const p = collectionPeriod(zone, "auto", new Date("2026-10-22T17:00:00Z"));
  assert.equal(p.start, "2026-10-19");
  assert.equal(p.end, "2026-10-22");
  assert.equal(collectionPeriodLabel(p.start, p.end), "10.19 월 – 10.22 목");
});
test("coaching previews keep decimal prescriptions intact and preserve full evidence in accessible details", () => {
  const first = "총 8.5km를 대화 가능한 강도로 달려요.";
  const text = first + " 워밍업과 회복 거리는 전체 거리에 포함돼요.".repeat(12);
  assert.equal(coachingLead(text, 45), first);
  const html = renderToStaticMarkup(
    createElement(CoachingDetail, { text, label: "훈련 목적 전체" }),
  );
  assert.ok(html.includes("<details"));
  assert.ok(html.includes("훈련 목적 전체"));
  assert.ok(html.includes(text));
  assert.equal(coachingLead("짧은 안내예요."), "짧은 안내예요.");
  const unsafe = "<script>개인 메모</script> " + "상세 ".repeat(150);
  assert.ok(
    !renderToStaticMarkup(
      createElement(CoachingDetail, { text: unsafe }),
    ).includes("<script>"),
  );
});
