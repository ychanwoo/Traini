import { requireAdmin } from "@/lib/security/admin";

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  return Response.json({ authorized: true }, { headers: { "Cache-Control": "no-store" } });
}
