export async function GET() {
  return Response.json({ error: "Garmin OAuth 콜백은 더 이상 사용하지 않습니다." }, { status: 410 });
}
