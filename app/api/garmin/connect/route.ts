// The personal service uses the local collector, not the unapproved OAuth flow.
export async function GET() {
  return Response.json({ error: "Garmin OAuth 연동은 종료되었습니다. 지난주 가져오기를 이용해 주세요." }, { status: 410 });
}
