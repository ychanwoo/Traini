// Old webhook payloads must never overwrite verified FIT activities.
export async function POST() {
  return Response.json({ error: "Garmin 웹훅은 종료되었습니다. 로컬 FIT 수집기를 이용해 주세요." }, { status: 410 });
}
