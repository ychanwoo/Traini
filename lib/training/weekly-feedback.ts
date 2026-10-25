import { validDate } from "./goal";
export type WeeklyFeedbackNote = {rpe:number|null;memo:string|null;version:number;updatedAt:string|null};
export type WeeklyFeedbackInput = {startsOn:string; rpe:number|null;memo:string|null; version:number; requestId:string};
export function parseWeeklyFeedback(value: unknown): WeeklyFeedbackInput {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("weekly_note_input");
  const v=value as WeeklyFeedbackInput;
  if (Object.keys(v).length!==5 || !["startsOn","rpe","memo","version","requestId"].every(k=>Object.hasOwn(v,k)) ||
    !validDate(v.startsOn) || new Date(v.startsOn+"T00:00:00Z").getUTCDay()!==1 ||
    (v.rpe!==null && (!Number.isInteger(v.rpe)||v.rpe<1||v.rpe>10)) ||
    (v.memo!==null && (typeof v.memo!=="string"||v.memo.length>200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.memo))) ||
    !Number.isSafeInteger(v.version)||v.version<0 || typeof v.requestId!=="string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.requestId)) throw Error("weekly_note_input");
  return {...v,memo:v.memo?.trim() || null};
}
