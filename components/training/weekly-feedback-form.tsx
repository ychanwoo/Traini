"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/http/client-request";
import type { WeeklyFeedbackNote } from "@/lib/training/weekly-feedback";
import styles from "./workout-feedback.module.css";
export function WeeklyFeedbackForm({ startsOn, note, pending, onSaved, onEditingChange }: {
  startsOn:string; note:WeeklyFeedbackNote|null; pending:boolean; onSaved:()=>void; onEditingChange:(dirty:boolean)=>void;
}) {
  const [rpe,setRpe]=useState(note?.rpe?.toString() ?? "");
  const [memo,setMemo]=useState(note?.memo ?? "");
  const [saved,setSaved]=useState(note);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;onEditingChange(false);};},[onEditingChange]);
  useEffect(()=>{onEditingChange(busy || rpe!==(saved?.rpe?.toString()??"") || memo.trim()!==(saved?.memo??""));},[rpe,memo,saved,busy,onEditingChange]);
  const lock=useRef(false);
  const retry=useRef<{payload:string;requestId:string}|null>(null);
  // Accept a newer background read only while the local draft is untouched.
  if (!busy && rpe===(saved?.rpe?.toString()??"") && memo.trim()===(saved?.memo??"") && (note?.version??0)>(saved?.version??0)) {
    setSaved(note);setRpe(note?.rpe?.toString()??"");setMemo(note?.memo??"");
  }

  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if(lock.current || pending) return;
    const body={startsOn,rpe:rpe?Number(rpe):null,memo:memo.trim()||null,version:saved?.version ?? 0};
    const payload=JSON.stringify(body);
    if(retry.current?.payload!==payload) retry.current={payload,requestId:crypto.randomUUID()};
    lock.current=true;setBusy(true);setMessage("");
    try {
      const result=await requestJson<{note:WeeklyFeedbackNote}>("/api/training/weekly-feedback",{method:"POST",body:{...body,requestId:retry.current!.requestId},timeoutMs:25000});
      if(!result.note || !Number.isSafeInteger(result.note.version) || result.note.version<1) throw Error("저장 결과를 확인하지 못했어요.");
      if(!active.current) {window.dispatchEvent(new Event("traini:plan-changed"));return;}
      setSaved(result.note);setMessage("저장했어요. 이 주의 리뷰 생성에 반영돼요.");onSaved();
    } catch(error) {
      if(!active.current) return;
      onSaved();
      setMessage(error instanceof Error?error.message:"저장 여부를 확인해 주세요. 입력은 유지했어요.");
    } finally {lock.current=false;if(active.current) setBusy(false);}
  }
  return <section className={styles.quick} aria-label="주간 체감 강도와 메모">
    <h3>이번 주 어땠나요? <span>선택</span></h3>
    <p className={styles.help}>{startsOn} 시작 주간 · 매일 작성하지 않아도 돼요.</p>
    <form onSubmit={event=>void submit(event)}>
      <fieldset className={styles.fields} disabled={pending || busy}>
        <label>주간 체감 강도 · RPE
          <select value={rpe} onChange={event=>setRpe(event.target.value)}>
            <option value="">미입력</option>
            {Array.from({length:10},(_,i)=><option value={i+1} key={i+1}>{i+1}{i===0?" · 매우 가벼움":i===9?" · 최대 노력":""}</option>)}
          </select>
        </label>
        <label>주간 메모 <span>선택 · 200자</span>
          <textarea rows={2} maxLength={200} value={memo} onChange={event=>setMemo(event.target.value)} placeholder="한 주의 컨디션이나 불편했던 점을 남겨요" />
        </label>
        <button disabled={busy || (!rpe && !memo.trim() && !saved)}>{busy?"저장 중…":"주간 피드백 저장"}</button>
      </fieldset>
    </form>
    {(note?.version??0)>(saved?.version??0) && <button type="button" className={styles.reload} onClick={()=>{setSaved(note);setRpe(note?.rpe?.toString()??"");setMemo(note?.memo??"");setMessage("");}}>저장된 내용 불러오기</button>}
    <p className={styles.help}>메모 저장과 AI 리뷰 생성은 별개예요. 현재 통증은 오늘 컨디션에서도 확인해 주세요.</p>
    <p className={styles.help} role="status">{message || (saved?"저장된 주간 피드백":"")}</p>
  </section>;
}
