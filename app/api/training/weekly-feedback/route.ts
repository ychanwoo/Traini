import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { reviewSelection } from "@/lib/training/closeout-storage";
import { parseWeeklyFeedback } from "@/lib/training/weekly-feedback";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie, Authorization"};
export async function POST(request:Request) {
  const access=await requireAdmin(request);
  if(access.response) return access.response;
  try {
    const input=parseWeeklyFeedback(await readMutation(request));
    const {period}=await reviewSelection(access.userId,process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",input.startsOn);
    const {data,error}=await getSupabaseAdmin().rpc("save_weekly_coaching_note",{
      p_user_id:access.userId,p_starts_on:period.startsOn,p_timezone:period.timezone,
      p_version:input.version,p_rpe:input.rpe,p_memo:input.memo,p_request_id:input.requestId,
    }).abortSignal(AbortSignal.timeout(15000));
    if(error) throw Error(error.message.includes("weekly_note_changed")?"weekly_note_changed":"weekly_note_storage");
    return Response.json({note:data},{headers});
  }catch(error) {
    if(error instanceof RequestInputError) return Response.json({error:error.message},{status:error.status,headers});
    const code=error instanceof Error?error.message:"weekly_note_storage";
    const changed=code==="weekly_note_changed";
    const invalid=code==="weekly_note_input" || code==="review_period";
    return Response.json({error:changed?"다른 화면에서 주간 메모가 바뀌었어요. 저장 상태를 다시 확인해 주세요.":invalid?"대상 주간과 입력 범위를 확인해 주세요.":"주간 메모 저장 여부를 확인하지 못했어요. 입력은 유지돼요."},{status:changed?409:invalid?400:503,headers});
  }
}
