"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowLeftRight, BarChart3, BedDouble, CalendarDays, ChevronLeft, ChevronRight, Circle, Footprints, Gauge, Heart, HeartPulse, Info, Moon, PersonStanding, Route, Settings, ShieldCheck, Sun, TrendingUp, UserRound, type LucideIcon } from "lucide-react";

type Screen = "splash" | "login" | "garmin" | "analysis" | "goal" | "schedule" | "today" | "my" | "roadmap";
type Props = { screen: Screen };

const iconMap: Record<string, LucideIcon> = { arrow_back:ArrowLeft, chevron_left:ChevronLeft, chevron_right:ChevronRight, settings:Settings, footprints:Footprints, today:CalendarDays, calendar_month:CalendarDays, calendar_today:CalendarDays, route:Route, person:UserRound, directions_run:PersonStanding, bar_chart:BarChart3, favorite:HeartPulse, bedtime:BedDouble, dark_mode:Moon, swap_horiz:ArrowLeftRight, shield:ShieldCheck, info:Info, trending_up:TrendingUp, speed:Gauge, light_mode:Sun, ecg_heart:Activity, block:Circle, check_circle:Circle, bolt:Footprints, event_repeat:CalendarDays, rebase_edit:Activity, insights:BarChart3 };
const Icon = ({ children, filled = false }: { children: string; filled?: boolean }) => { const Glyph = iconMap[children] ?? Circle; return <Glyph aria-hidden="true" strokeWidth={filled ? 2.4 : 1.65} />; };

const Brand = () => <span className="brand-mini"><img src="/images/brand/traini-logo.png" alt="Traini" /></span>;

function Topbar({ back = false, step, settings = false }: { back?: boolean; step?: string; settings?: boolean }) {
  const router = useRouter();
  return <header className="topbar grid grid-cols-3">
    <div>{back ? <button aria-label="Back" className="icon-button" onClick={() => router.back()}><Icon>arrow_back</Icon></button> : null}</div>
    <div className="justify-self-center"><Brand /></div>
    <div className="justify-self-end">{step ? <span className="text-[10px] font-semibold text-[#756e7c]">{step}</span> : settings ? <button aria-label="Settings" className="icon-button"><Icon>settings</Icon></button> : null}</div>
  </header>;
}

function Navigation({ active }: { active: "today" | "schedule" | "roadmap" | "my" }) {
  const items = [["today", "/today", "footprints", "오늘"], ["schedule", "/schedule", "calendar_month", "일정"], ["roadmap", "/roadmap", "route", "로드맵"], ["my", "/my", "person", "마이"]] as const;
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map(([id, href, icon, label]) => <Link key={id} href={href} className={active === id ? "active" : ""}><Icon filled={active === id}>{icon}</Icon><span>{label}</span></Link>)}</nav>;
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="eyebrow">{children}</p>;
const Metric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => <div><p className="text-[10px] font-semibold tracking-[.08em] text-[#8a8290]">{label}</p><p className="mono mt-1 text-lg font-semibold tracking-[-.06em]">{value}{sub && <span className="ml-1 font-sans text-xs font-medium text-[#756e7c]">{sub}</span>}</p></div>;

function Splash() {
  const router = useRouter();
  useEffect(() => { const timer = window.setTimeout(() => router.push("/login"), 1800); return () => window.clearTimeout(timer); }, [router]);
  return <div className="splash-grid app-frame flex min-h-dvh flex-col items-center px-7 text-center" onClick={() => router.push("/login")}>
    <div className="splash-logo-window mt-[17vh]"><img alt="Traini AI Running Coach" src="/images/brand/traini-logo.png" /></div>
    <div className="mt-6 h-8 w-16 border-t-[3px] border-[#dfd1eb] pt-2"><div className="mx-auto h-6 w-6 animate-spin rounded-full border-[2px] border-[#ddcceb] border-t-[#8c55b8]" /></div>
    <p className="mt-7 text-[14px] font-semibold leading-6 tracking-[-.04em] text-[#4e4654]">오늘의 컨디션에 맞춘,<br />가장 좋은 한 걸음</p>
  </div>;
}

function Login() {
  const router = useRouter();
  const [appleNotice, setAppleNotice] = useState(false);
  return <div className="app-frame"><main className="page flex min-h-dvh flex-col pt-0">
    <div className="login-hero text-center"><div className="login-logo-window mx-auto"><img alt="Traini AI Running Coach" src="/images/brand/traini-logo.png" /></div><h1 className="mt-8 text-[16px] font-semibold leading-[1.3] tracking-[-.04em]">반가워요,<br />트레이니와 함께 달려볼까요?</h1><div className="mx-auto mt-7 h-[238px] w-[238px] overflow-hidden rounded-full shadow-[0_12px_25px_rgba(91,63,112,.14)]"><img alt="Runner shoes" className="h-full w-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBmWV8-nCJHFZHBBrk3xBtaIVmlWYIXLp5sXXYBOdzz0DETK6ONT6tCkcOFMbIS2nvMtyM9lc5CzD6QJ1MciCk7xjMAQ82wbIix0xAOuz0oSevdr0K5f9-Odlw5AsJ11ZapkJ7Pj6iTEjDDSuC9hHTex-UYidBZJvvm7wn5XZtXIouk8bacDIN6xlHnQTUg7gMIE5A62Fg4Gba0xijQVs3qFAdxiUG_SUa1KJZ3m7NSg60TW7e5KQNkpg" /></div></div>
    <div className="mt-auto space-y-[10px]"><button className="auth-button auth-button-apple" onClick={() => setAppleNotice(true)}><span className="auth-button-content"><span className="apple-mark"></span><span>Apple로 로그인</span></span></button>{appleNotice && <p className="apple-login-notice" role="status">Apple 로그인은 준비 중이에요.<br />Google 계정으로 계속해 주세요.</p>}<button className="auth-button auth-button-google" onClick={() => router.push("/garmin-connect")}><span className="auth-button-content"><img src="/icons/google.svg" alt="" aria-hidden="true" /><span>Google 계정으로 계속하기</span></span></button><p className="pt-8 text-center text-[10px] leading-5 text-[#756e7c]">이용약관&nbsp;&nbsp; · &nbsp;&nbsp;개인정보 처리방침</p></div>
  </main></div>;
}

function Garmin() {
  const router = useRouter();
  const rows = [["directions_run", "러닝 기록", "활동 거리, 페이스, 경로 데이터"], ["bar_chart", "회복 지표", "VO₂ Max, HRV, 심박수 변동"], ["dark_mode", "수면 데이터", "수면 단계, 수면 점수 및 휴식 수준"]];
  return <div className="app-frame"><Topbar back step="1 / 3" /><main className="garmin-page">
    <h1>Garmin을 연결하면<br />현재 몸 상태를 분석할 수 있어요</h1>
    <section className="garmin-data-card"><div className="garmin-watch-mark" aria-hidden="true"><i /></div><div className="garmin-data-heading"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e8f4fb]"><img className="h-5 w-5" src="/icons/garmin.svg" alt="" aria-hidden="true" /></span><div><p className="text-[10px] font-bold tracking-[.13em] text-[#0277BD]">HEALTH CONNECT</p><p>가민 데이터 연동 항목</p></div></div><div className="garmin-data-list">{rows.map(([icon, title, description]) => <div key={title} className="garmin-data-row"><span><Icon>{icon}</Icon></span><div><p>{title}</p><small>{description}</small></div></div>)}</div></section>
    <div className="garmin-privacy"><Icon>shield</Icon><p>데이터는 분석에만 안전하게 사용되며, 사용자의 허가 없이 제3자에게 제공되지 않습니다.</p></div>
    <p className="garmin-revoke"><Icon>info</Icon> 언제든 연결을 해제할 수 있어요</p>
    <div className="garmin-actions"><button className="primary-button" onClick={() => { localStorage.setItem("traini-garmin-connected", "true"); router.push("/running-analysis"); }}><span className="mr-3 inline-block h-4 w-4 bg-white align-[-3px]" />Garmin 계정 연결하기</button><button className="garmin-later" onClick={() => { localStorage.setItem("traini-garmin-connected", "false"); router.push("/goal-setting"); }}>나중에 연결할게요</button></div>
  </main></div>;
}

function Analysis() {
  const router = useRouter();
  const insights = [["trending_up", "심박 안정성이 좋아지고 있어요", "같은 페이스에서 평균 심박수가 5bpm 감소했습니다. 심폐 기능이 강화되고 있는 긍정적인 신호입니다."], ["bar_chart", "레이스 페이스 적응이 더 필요해요", "목표 페이스로 달리는 훈련 비중이 낮습니다. 주 1회 포인트 훈련으로 페이스 감각을 익혀보세요."], ["dark_mode", "긴 거리 훈련 뒤 회복을 확보하세요", "LSD 훈련 후 수면 점수가 15% 낮아지는 경향이 있어요. 회복 후 훈련 강도를 조정할게요."]];
  return <div className="app-frame"><Topbar back step="2 / 3" /><main className="analysis-page"><section><h1>영찬님의 러닝 베이스라인</h1><p>최근 8주간의 기록을 분석했어요.</p></section>
    <section className="analysis-summary"><Label>훈련 준비도 · 양호</Label><h2>탄탄한 유산소 기반 위에 스피드 지구력을<br />더할 타이밍이에요.</h2><p>최근 러닝 24회 · 수면 데이터 42일 분석</p></section>
    <section className="analysis-metric-grid"><div><Metric label="현재 러닝 레벨" value="44" sub="VDOT"/><small>풀 3:45:20</small></div><div><Metric label="유산소 베이스" value="38.4" sub="KM/주"/><small className="good">안정적</small><em>주간 거리 변동폭이 적어요</em></div><div><Metric label="회복 상태" value="82" sub="/ 100"/><small className="blue">좋음</small><em>HRV 정상 범위 유지</em></div><div><Metric label="훈련 부하" value="적정"/><small className="good">무리 없음</small><em>고강도는 주 2회 이내 권장</em></div></section>
    <section className="analysis-insights"><Label>COACHING INSIGHTS</Label>{insights.map(([icon, title, text]) => <div key={title}><span><Icon>{icon}</Icon></span><article><h3>{title}</h3><p>{text}</p></article></div>)}</section>
    <section className="analysis-plan"><h2>그래서, 이렇게 훈련할게요</h2><ol><li>주간 거리 38km → 42km로 천천히 확장</li><li>주 1회 T-Pace 역치주 추가</li><li>장거리주 다음 날 회복 훈련 고정</li></ol><p><Icon>info</Icon>컨디션 변화에 따라 다음 주 계획은 자동으로 조정돼요.</p></section>
    <button className="primary-button analysis-submit" onClick={() => router.push("/goal-setting")}>내 목표 설정하기</button><p className="analysis-skip">분석 내용을 나중에 볼게요</p>
  </main></div>;
}

function Goal() {
  const router = useRouter();
  const [distance, setDistance] = useState("FULL");
  const [targetTimes, setTargetTimes] = useState<Record<string, string>>({ "5K":"00:25:00", "10K":"00:52:00", "HALF":"01:55:00", "FULL":"03:30:00" });
  const [raceName, setRaceName] = useState("서울마라톤"); const [raceDate, setRaceDate] = useState("2026-10-18"); const [showRaceEditor, setShowRaceEditor] = useState(false);
  const [garminConnected, setGarminConnected] = useState(false);
  const time = targetTimes[distance];
  const predictedTimes: Record<string, string> = { "5K":"00:27:30", "10K":"00:57:40", "HALF":"02:06:15", "FULL":"03:45:20" };
  const predictedTime = predictedTimes[distance];
  const formatTime = (value: string) => { const digits = value.replace(/\D/g, "").slice(0, 6); return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join(":"); };
  const updateTime = (value: string) => setTargetTimes((times) => ({ ...times, [distance]: formatTime(value) }));
  const dayDiff = Math.ceil((new Date(`${raceDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const raceDateLabel = new Intl.DateTimeFormat("ko-KR", { year:"numeric", month:"long", day:"numeric" }).format(new Date(`${raceDate}T00:00:00`));
  useEffect(() => setGarminConnected(localStorage.getItem("traini-garmin-connected") === "true"), []);
  return <div className="app-frame"><Topbar back step="3 / 3" /><main className="goal-page"><h1>어떤 결승선을 향해<br />달려볼까요?</h1>
    <section><Label>TARGET RACE</Label><button type="button" className="goal-race-card" onClick={() => setShowRaceEditor((value) => !value)}><span><Icon>route</Icon></span><div><p>{raceName}</p><small><b>{dayDiff >= 0 ? `D-${dayDiff}` : "완료"}</b>&nbsp;&nbsp;{raceDateLabel}</small></div><Icon>chevron_right</Icon></button>{showRaceEditor && <div className="race-editor"><label>마라톤명<input value={raceName} onChange={(event) => setRaceName(event.target.value)} placeholder="대회명을 입력하세요" /></label><label>대회 날짜<input type="date" value={raceDate} onChange={(event) => setRaceDate(event.target.value)} /></label></div>}</section>
    <div className="goal-segments">{["5K","10K","HALF","FULL"].map((item) => <button key={item} onClick={() => setDistance(item)} className={distance === item ? "active" : ""}>{item}</button>)}</div>
    <section className="goal-time"><Label>{distance} GOAL TIME</Label><input inputMode="numeric" aria-label={`${distance} goal time`} value={time} onChange={(e) => updateTime(e.target.value)} /><span>⌁ 도전 목표</span><p>종목별 목표 기록은 각각 따로 저장됩니다</p></section>
    <section className="goal-hint"><Icon>trending_up</Icon><p>현재 분석 기준 예상 기록은 <b>{predictedTime}</b>이에요.<br /><b>{time}</b> 목표를 위해서는 약 6개월의 점진적인 훈련이 필요해요.</p></section>
    {garminConnected ? <section className="goal-report"><div className="flex items-center justify-between"><p>AI 페이스 분석 리포트</p><Label>SMART DIAGNOSIS</Label></div><div className="goal-gap"><small>Gap Analysis</small><p>현재 예상보다 <b>15분 20초</b> 빠름</p></div><div className="goal-metrics"><Metric label="VDOT" value="44"/><Metric label="PREDICTED FULL" value={predictedTime}/></div><div className="mt-4"><div className="flex justify-between text-[10px]"><span className="text-[#756e7c]">주간 평균 거리</span><b>38.4km</b></div><div className="mt-2 h-[3px] w-full bg-[#eee9f0]"><div className="h-full w-[62%] bg-[#1584b6]" /></div></div></section> : <section className="goal-connect-prompt"><span><Icon>bar_chart</Icon></span><div><p>AI 페이스 분석 리포트</p><small>Garmin을 연동하면 현재 기록을 분석해<br />예상 기록과 훈련 페이스를 알려드려요.</small><button onClick={() => router.push("/garmin-connect")}>Garmin 연동하고 리포트 확인하기</button></div></section>}
    <section className="goal-notice"><Icon>info</Icon><p>무리한 목표는 매주 훈련 강도 조정으로 안전하게 관리해드려요.</p></section>
    <button className="primary-button goal-submit" onClick={() => { localStorage.setItem("traini-plan", "created"); router.push("/schedule"); }}>나만의 훈련 플랜 만들기</button>
  </main></div>;
}

const workouts = [["월", "12", "Recovery Rest", "Complete recovery day", "완료", "dark_mode"], ["화", "13", "Easy Run 6km", "Easy aerobic run", "완료", "directions_run"], ["수", "14", "T-Pace Interval 8km", "Focus: 4'20”–4'35” Pace", "오늘", "trending_up"], ["목", "15", "Recovery Rest", "Low-impact recovery day", "예정", "dark_mode"], ["금", "16", "Easy Run 7km", "Easy aerobic run", "예정", "directions_run"], ["토", "17", "LSD 18km", "Long slow distance", "예정", "route"], ["일", "18", "Full Rest", "Deep restoration", "예정", "bedtime"]];
const nextWeekWorkouts = [["월", "19", "Recovery Rest", "Complete recovery day", "예정", "dark_mode"], ["화", "20", "Easy Run 8km", "Easy aerobic run", "예정", "directions_run"], ["수", "21", "Interval 6 × 800m", "Focus: I-Pace 4'10”/km", "예정", "trending_up"], ["목", "22", "Recovery Rest", "Low-impact recovery day", "예정", "dark_mode"], ["금", "23", "Easy Run 6km", "Easy aerobic run", "예정", "directions_run"], ["토", "24", "LSD 20km", "Long slow distance", "예정", "route"], ["일", "25", "Full Rest", "Deep restoration", "예정", "bedtime"]];
function Schedule() {
  const [week, setWeek] = useState(0); const router = useRouter();
  return <div className="app-frame"><Topbar back /><main className="schedule-page"><header className="schedule-week"><button onClick={() => setWeek(Math.max(0, week-1))}><Icon>chevron_left</Icon></button><p>{week === 0 ? "8월 12일–8월 18일" : "8월 19일–8월 25일"}</p><button onClick={() => setWeek(Math.min(1, week+1))}><Icon>chevron_right</Icon></button></header>
    <section className="schedule-progress"><div><Label>WEEKLY PROGRESS</Label><span className="mono">22 <i>/ 40 km</i></span></div><div className="schedule-progress-line"><b /></div><p>이번 주 목표까지 18km 남았습니다.</p></section>
    <section className="schedule-list">{(week === 0 ? workouts : nextWeekWorkouts).map(([day,date,title,detail,status,icon]) => <button key={date} onClick={() => status === "오늘" && router.push("/today")} className={`schedule-row ${status === "오늘" ? "today" : ""}`}><div className="schedule-date"><small>{day}</small><b>{date}</b></div><div className="schedule-copy"><p>{title}</p><small className={status === "완료" ? "complete" : status === "오늘" ? "focus" : "upcoming"}>{status === "완료" ? "● Completed" : status === "오늘" ? `⚡ ${detail}` : status === "예정" && title !== "Recovery Rest" && title !== "Full Rest" ? "UPCOMING" : detail}</small></div>{status === "오늘" ? <span className="schedule-play"><Icon>trending_up</Icon></span> : <span className="schedule-icon"><Icon>{icon}</Icon></span>}</button>)}</section><Navigation active="schedule" />
  </main></div>;
}

function Today() {
  const [done, setDone] = useState(false);
  return <div className="app-frame"><Topbar back /><main className="page today-page pt-4"><header className="flex h-10 items-center justify-between"><div className="flex gap-2"><span className="rounded-full bg-[#f3edf6] px-2 py-1 text-[10px] font-semibold">D-42</span><span className="rounded-full bg-[#eaf7ff] px-2 py-1 text-[10px] font-semibold text-[#147eaf]">Phase 2 · 심폐 강화</span></div></header>
    <section className="mt-6"><h1 className="text-xl font-semibold">좋은 아침이에요, 영찬님</h1><p className="mt-1 text-sm text-[#756e7c]">오늘의 컨디션은 ‘최상’입니다. 훈련을 시작해볼까요?</p></section>
    <section className="today-week">{[["월","block"],["화","check_circle"],["수","today"],["목","calendar_today"],["금","directions_run"],["토","bolt"],["일","event_repeat"]].map(([day, icon], i) => <div key={day} className={`today-week-day ${i === 2 && !done ? "is-today" : ""} ${i === 2 && done ? "is-done" : ""}`}><p>{day}</p>{i === 2 ? <strong>{done ? "✓" : "오늘"}</strong> : <Icon>{icon}</Icon>}</div>)}</section>
    <section className="card mt-4 p-4"><div className="flex justify-between"><Label>WEEKLY PROGRESS</Label><span className="mono text-sm text-[#6B21A8]">22/40km</span></div><div className="mt-3 h-2 rounded-full bg-[#eee9f0]"><div className="h-full w-[55%] rounded-full bg-[#6B21A8]" /></div><p className="mt-3 text-xs text-[#756e7c]">이번 주 목표 40km 중 55%를 달성했습니다.</p></section>
    <section className="card mt-4 p-6"><div className="flex items-start justify-between"><div><Label>TODAY’S SESSION</Label><h2 className="mt-2 text-xl font-semibold">T-Pace 역치주</h2></div><span className="rounded-full bg-[#f3edf6] p-2 text-[#6B21A8]"><Icon>trending_up</Icon></span></div><div className="mt-8 grid grid-cols-2"><div><Label>DISTANCE</Label><p className="mono mt-1 text-5xl font-semibold tracking-[-.11em]">8.0<span className="ml-2 font-sans text-base font-medium tracking-normal">km</span></p></div><div className="space-y-3 self-end text-sm"><p className="today-pace"><Icon>speed</Icon><span className="mono ml-2">4{String.fromCharCode(39)}50”/km</span></p><p className="today-heart"><Icon>favorite</Icon><span className="ml-2">Zone 4 · 155–168</span></p></div></div><div className="mt-7 flex items-center gap-3 rounded-xl bg-[#f7f4f8] p-3"><Icon>light_mode</Icon><div><p className="text-sm font-medium">28°C · 습도 80%</p><p className="text-[11px] text-[#167ca8]">페이스 +12초 보정 적용됨</p></div></div><button className="primary-button mt-6" onClick={() => setDone(!done)}>{done ? "훈련 완료됨 ✓" : "오늘의 훈련 완료"}</button></section>
    <section className="mt-4 grid grid-cols-2 gap-3"><div className="card p-4"><Label>SLEEP SCORE</Label><p className="mono mt-2 text-2xl font-semibold">82 <span className="font-sans text-xs text-[#756e7c]">pts</span></p><div className="mt-3 h-1.5 rounded-full bg-[#e7e0e9]"><div className="h-full w-[82%] rounded-full bg-[#38BDF8]" /></div></div><div className="card p-4"><Label>RECOVERY</Label><p className="mt-2 text-2xl font-semibold">Good</p><div className="mt-3 flex gap-1"><i className="h-1.5 flex-1 rounded bg-[#38BDF8]"/><i className="h-1.5 flex-1 rounded bg-[#38BDF8]"/><i className="h-1.5 flex-1 rounded bg-[#38BDF8]"/><i className="h-1.5 flex-1 rounded bg-[#e7e0e9]"/></div></div></section><Navigation active="today" />
  </main></div>;
}

function MyPage() {
  const rows = ["내 목표 및 대회", "Garmin 연결 관리", "알림 설정", "데이터 및 개인정보", "고객 지원"];
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const updateProfileImage = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileImage(String(reader.result));
    reader.readAsDataURL(file);
  };
  const logout = () => { localStorage.removeItem("traini-garmin-connected"); localStorage.removeItem("traini-plan"); router.push("/login"); };
  return <div className="page app-frame"><header className="flex h-10 items-center justify-between"><Brand /><Icon>settings</Icon></header><section className="mt-5 text-center"><input ref={uploadRef} className="sr-only" type="file" accept="image/*" onChange={(event) => updateProfileImage(event.target.files?.[0])} /><button type="button" className="profile-upload" aria-label="프로필 사진 업로드" onClick={() => uploadRef.current?.click()}><span className="profile-image-clip">{profileImage ? <img src={profileImage} alt="영찬 프로필" /> : <Icon>person</Icon>}</span><span>+</span></button><h1 className="mt-3 text-xl font-semibold">영찬</h1><p className="mt-1 text-sm text-[#756e7c]">풀코스 3시간 30분 목표</p><span className="mt-2 inline-block rounded-full bg-[#eaf7ff] px-2 py-1 text-[10px] font-semibold text-[#147eaf]">Garmin 연결됨</span></section><section className="mt-6 grid grid-cols-3 divide-x divide-[#ece8ef] rounded-xl border border-[#ece8ef] py-3 text-center"><Metric label="VDOT" value="44"/><Metric label="훈련 연속" value="6" sub="weeks"/><Metric label="평균 거리" value="38.4" sub="km"/></section><section className="my-insight-card"><div className="my-insight-title"><div><p>최근 4주 훈련 인사이트</p><small>꾸준함이 페이스 향상으로 이어지고 있어요</small></div><Icon>insights</Icon></div><div className="my-insight-metrics"><div><small>평균 페이스</small><strong className="mono">5&apos;42&quot; <i>→</i> <b>5&apos;34&quot;</b></strong><p>km당 8초 향상</p></div><div><small>훈련 완료율</small><strong className="mono"><b>89%</b></strong><p>목표 18회 중 16회</p></div></div><div className="my-insight-weeks" aria-label="최근 4주 훈련 완료율"><div><i style={{height:"66%"}}/><span>1주</span></div><div><i style={{height:"74%"}}/><span>2주</span></div><div><i style={{height:"82%"}}/><span>3주</span></div><div><i className="is-current" style={{height:"92%"}}/><span>이번 주</span></div></div></section><section className="mt-5 divide-y divide-[#ece8ef] border-y border-[#ece8ef]">{rows.map((row)=><button className="flex w-full items-center justify-between py-4 text-sm" key={row}>{row}<Icon>chevron_right</Icon></button>)}</section><button type="button" className="logout-button" onClick={() => setShowLogoutModal(true)}>로그아웃</button>{showLogoutModal && <div className="logout-modal-backdrop" role="presentation" onClick={() => setShowLogoutModal(false)}><section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title" onClick={(event) => event.stopPropagation()}><h2 id="logout-title">로그아웃 하시겠습니까?</h2><p>현재 기기에서 Traini를 로그아웃합니다.</p><div><button type="button" onClick={() => setShowLogoutModal(false)}>아니오</button><button type="button" onClick={logout}>예, 로그아웃</button></div></section></div>}<Navigation active="my" /></div>;
}

function Roadmap() { const phases=[["1–6주차","기초 체력 및 마일리지 확장","완료"],["7–16주차","심폐·역치 강화","진행 중"],["17–21주차","레이스 페이스 적응","예정"],["22–24주차","테이퍼링 & D-Day","예정"]]; return <div className="page app-frame"><header className="flex h-10 items-center justify-between"><Brand /><Icon>settings</Icon></header><section className="mt-6"><Label>2026 SEOUL MARATHON · D-42</Label><h1 className="mt-2 text-[25px] font-semibold tracking-[-.04em]">나의 훈련 로드맵</h1></section><section className="roadmap-overview"><div><Label>GOAL RECORD</Label><p className="mono">03:30:00</p></div><div><Label>ESTIMATED</Label><p className="mono">03:45:20</p></div></section><section className="roadmap-phase"><div className="roadmap-phase-meta"><span>PHASE 2</span><p>심폐 · 역치 강화</p><small>9&nbsp; / &nbsp;24주차 (38%)</small></div><h2>지구력 기반 위에 스피드 지구력을<br/>더하는 단계예요.</h2><div className="roadmap-phase-line"><b /></div></section><section className="roadmap-timeline mt-6">{phases.map(([week,title,status],i)=><div className="roadmap-timeline-row" key={title}><span className={`roadmap-timeline-dot ${i===1?"is-active":i<1?"is-complete":""}`}/><div><p>{week}</p><h3>{title}</h3><small className={status==="진행 중"?"is-active":""}>{status}</small></div></div>)}</section><section className="card mt-2 p-5"><h2 className="font-semibold">이번 단계의 핵심 목표</h2><p className="mt-2 text-sm leading-6 text-[#756e7c]">주간 거리 40→48km, 주 1회 역치주, 격주 장거리주</p><div className="mt-4 border-t border-[#ece8ef] pt-4"><Label>이번 주 포커스</Label><p className="mt-1 text-sm font-semibold">T-Pace 역치주 8km</p></div></section><Navigation active="roadmap" /></div>; }

export function TrainiScreen({ screen }: Props) { const content = { splash:<Splash/>, login:<Login/>, garmin:<Garmin/>, analysis:<Analysis/>, goal:<Goal/>, schedule:<Schedule/>, today:<Today/>, my:<MyPage/>, roadmap:<Roadmap/> }; return content[screen]; }
