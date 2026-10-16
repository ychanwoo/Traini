"use client";

import Image from "next/image";
import { AdminLogin } from "@/components/auth/admin-login";
import { WeeklySyncCard } from "@/components/garmin/weekly-sync-card";
import { WeeklyRunningSummary } from "@/components/garmin/weekly-running-summary";
import { TodayPlan, WeeklySchedule, formatPlanPace } from "@/components/training/weekly-plan-view";
import { GoalSettings } from "@/components/training/goal-settings";
import { TrainingContextCard } from "@/components/training/training-context-card";
import { timeText } from "@/lib/training/goal";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowLeftRight, BarChart3, BedDouble, CalendarDays, ChevronLeft, ChevronRight, Circle, Footprints, Gauge, HeartPulse, Info, Mail, Moon, PersonStanding, Route, Settings, ShieldCheck, Sun, TrendingUp, UserRound, type LucideIcon } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { applyWeatherPaceAdjustment } from "@/lib/algorithms/pace";

type Screen = "splash" | "login" | "garmin" | "analysis" | "goal" | "schedule" | "today" | "my" | "roadmap" | "my-goals" | "privacy" | "support";
type Props = { screen: Screen };

const iconMap: Record<string, LucideIcon> = { arrow_back:ArrowLeft, chevron_left:ChevronLeft, chevron_right:ChevronRight, settings:Settings, footprints:Footprints, today:CalendarDays, calendar_month:CalendarDays, calendar_today:CalendarDays, route:Route, person:UserRound, directions_run:PersonStanding, bar_chart:BarChart3, favorite:HeartPulse, bedtime:BedDouble, dark_mode:Moon, swap_horiz:ArrowLeftRight, shield:ShieldCheck, info:Info, trending_up:TrendingUp, speed:Gauge, light_mode:Sun, ecg_heart:Activity, block:Circle, check_circle:Circle, bolt:Footprints, event_repeat:CalendarDays, rebase_edit:Activity, insights:BarChart3, mail:Mail };
const Icon = ({ children, filled = false }: { children: string; filled?: boolean }) => { const Glyph = iconMap[children] ?? Circle; return <Glyph aria-hidden="true" strokeWidth={filled ? 2.4 : 1.65} />; };

const Brand = () => <span className="brand-mini"><Image src="/images/brand/traini-logo.png" alt="Traini" width={64} height={35} unoptimized /></span>;

function Topbar({ back = false, step, settings = false }: { back?: boolean; step?: string; settings?: boolean }) {
  const router = useRouter();
  return <header className="topbar grid grid-cols-3">
    <div>{back ? <button aria-label="Back" className="icon-button" onClick={() => router.back()}><Icon>arrow_back</Icon></button> : null}</div>
    <div className="justify-self-center"><Brand /></div>
    <div className="justify-self-end">{step ? <span className="text-[10px] font-semibold text-[#756e7c]">{step}</span> : settings ? <button aria-label="Settings" className="icon-button"><Icon>settings</Icon></button> : null}</div>
  </header>;
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="eyebrow">{children}</p>;
const Metric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => <div><p className="text-[10px] font-semibold tracking-[.08em] text-[#8a8290]">{label}</p><p className="mono mt-1 text-lg font-semibold tracking-[-.06em]">{value}{sub && <span className="ml-1 font-sans text-xs font-medium text-[#756e7c]">{sub}</span>}</p></div>;
const mySettingRoutes: Record<string, string> = { "내 목표 및 대회": "/my/goals", "Garmin 연결 관리": "/garmin-connect", "데이터 및 개인정보": "/my/privacy", "고객 지원": "/my/support" };

function Splash() {
  const router = useRouter();
  useEffect(() => { const timer = window.setTimeout(() => router.push("/login"), 1800); return () => window.clearTimeout(timer); }, [router]);
  return <div className="splash-grid app-frame flex min-h-dvh flex-col items-center px-7 text-center" onClick={() => router.push("/login")}>
    <div className="splash-logo-window mt-[17vh]"><Image alt="Traini AI Running Coach" src="/images/brand/traini-logo.png" width={195} height={106} unoptimized /></div>
    <div className="mt-6 h-8 w-16 border-t-[3px] border-[#dfd1eb] pt-2"><div className="mx-auto h-6 w-6 animate-spin rounded-full border-[2px] border-[#ddcceb] border-t-[#8c55b8]" /></div>
    <p className="mt-7 text-[14px] font-semibold leading-6 tracking-[-.04em] text-[#4e4654]">오늘의 컨디션에 맞춘,<br />가장 좋은 한 걸음</p>
  </div>;
}


function Garmin() {
  return <div className="app-frame"><Topbar back /><main className="garmin-sync-page">
    <header><p>데이터 관리</p><h1>Garmin 러닝 기록</h1><span>지난주 기록을 확인하고 다음 훈련을 준비해요.</span></header>
    <WeeklySyncCard detailed />
    <WeeklyRunningSummary detailed initialWeek="previous" />
    <TrainingContextCard />
    <p className="garmin-sync-note">워치를 Garmin Connect 앱과 먼저 동기화해 주세요.<br />수집한 원본 파일은 Mac에 보관됩니다.</p>
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

function Goal() { return <div className="app-frame"><Topbar back step="3 / 3" /><GoalSettings onboarding /></div>; }

function Schedule() {
  return <div className="app-frame"><Topbar back /><WeeklySchedule /></div>;
}

type WeatherData = { temperatureC: number; humidityPercent: number; summary: string };

function WeatherPaceCard({basePace}: {basePace:number|null}) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [status, setStatus] = useState<"loading" | "unavailable" | "ready">("loading");
  useEffect(() => {
    if (!navigator.geolocation) { queueMicrotask(() => setStatus("unavailable")); return; }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const response = await fetch(`/api/weather?lat=${coords.latitude}&lon=${coords.longitude}`);
        if (!response.ok) throw new Error("Weather unavailable");
        setWeather(await response.json() as WeatherData);
        setStatus("ready");
      } catch { setStatus("unavailable"); }
    }, () => setStatus("unavailable"), { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  }, []);
  const adjustedPace = weather && basePace !== null ? applyWeatherPaceAdjustment(basePace, weather.temperatureC, weather.humidityPercent) : null;
  const penalty = adjustedPace !== null && basePace !== null ? adjustedPace - basePace : 0;
  return <div className="mt-7 flex items-center gap-3 rounded-xl bg-[#f7f4f8] p-3"><Icon>light_mode</Icon><div>{status === "ready" && weather ? <><p className="text-sm font-medium">{weather.temperatureC}°C · 습도 {weather.humidityPercent}%</p><p className="text-[11px] text-[#167ca8]">{penalty > 0 ? `현재 날씨 참고 ${formatPlanPace(adjustedPace)} (+${penalty}초)` : basePace === null ? "페이스 대신 대화 가능한 강도를 참고해 주세요" : "현재 날씨 기준 추가 보정 없음"}</p></> : status === "loading" ? <><p className="text-sm font-medium">날씨 정보를 불러오는 중</p><p className="text-[11px] text-[#756e7c]">위치 권한을 확인해 주세요</p></> : <><p className="text-sm font-medium">날씨 보정 정보를 사용할 수 없어요</p><p className="text-[11px] text-[#756e7c]">{basePace === null ? "대화 가능한 강도를 기준으로 훈련해 주세요" : "기본 목표 페이스를 참고해 주세요"}</p></>}</div></div>;
}

function Today() {
  return <div className="app-frame"><Topbar back /><main className="page today-page pt-4">
    <section className="mt-6"><h1 className="text-xl font-semibold">오늘의 훈련</h1><p className="mt-1 text-sm text-[#756e7c]">목표와 러닝 기록을 바탕으로 준비한 계획을 확인해요.</p></section>
    <WeeklySyncCard />
    <WeeklyRunningSummary />
    <TodayPlan weather={(pace)=><WeatherPaceCard basePace={pace}/>} />
    <section className="mt-4 grid grid-cols-2 gap-3"><div className="card p-4"><Label>SLEEP SCORE</Label><p className="mono mt-2 text-2xl font-semibold">—</p><p className="mt-2 text-[11px] text-[#756e7c]">수면 데이터 미수집</p></div><div className="card p-4"><Label>RECOVERY</Label><p className="mt-2 text-lg font-semibold">확인 전</p><p className="mt-2 text-[11px] text-[#756e7c]">실제 회복 데이터가 없어요</p></div></section>
  </main></div>;
}

const toTime = (seconds: number | null) => timeText(seconds) || "—";

function MyGoals() { return <GoalSettings />; }

function Privacy() { const rows = [["수집하는 데이터", "프로필, 훈련 기록, 위치 기반 날씨 정보"], ["데이터 사용 목적", "개인화 훈련 가이드와 서비스 개선"], ["프로필 사진", "내 계정에서 언제든 변경할 수 있어요"]]; return <div className="page app-frame settings-page"><section className="settings-title"><Label>DATA & PRIVACY</Label><h1>데이터 및 개인정보</h1><p>영찬님의 데이터는 더 안전하고 개인화된 훈련을 위해서만 사용돼요.</p></section><section className="settings-list">{rows.map(([title, text]) => <article key={title}><Icon>shield</Icon><div><h2>{title}</h2><p>{text}</p></div></article>)}</section><section className="privacy-note"><Icon>info</Icon><p>Garmin 연결 데이터는 연결 해제 시 이후 분석에 사용되지 않아요. 데이터 삭제 요청은 고객 지원을 통해 접수할 수 있어요.</p></section></div>; }

function Support() { const faqs = [["훈련 일정은 언제 바뀌나요?", "매주 리뷰 후 다음 1~2주 플랜이 새로 발행돼요."], ["날씨 보정은 어떻게 적용되나요?", "현재 기온과 습도를 반영해 목표 페이스를 안내해요."], ["Garmin 연결은 왜 필요한가요?", "실제 활동과 회복 상태를 훈련 계획에 반영하기 위해 필요해요."]]; return <div className="page app-frame settings-page"><section className="settings-title"><Label>SUPPORT</Label><h1>고객 지원</h1><p>Traini 이용 중 궁금한 점을 빠르게 확인해 보세요.</p></section><section className="support-faq">{faqs.map(([q, a]) => <details key={q}><summary>{q}<Icon>chevron_right</Icon></summary><p>{a}</p></details>)}</section><a className="support-contact" href="mailto:support@traini.app"><Icon>mail</Icon><span><b>문의하기</b><small>support@traini.app</small></span><Icon>chevron_right</Icon></a><p className="support-version">Traini · Version 0.1.0</p></div>; }

function MyPage() {
  const rows = ["내 목표 및 대회", "Garmin 연결 관리", "알림 설정", "데이터 및 개인정보", "고객 지원"];
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("영찬");
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  useEffect(() => {
    const loadProfileImage = async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const googleAvatar = user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null;
      const googleName = user.user_metadata.full_name ?? user.user_metadata.name ?? user.email?.split("@")[0] ?? "영찬";
      const { data: profile } = await supabase.from("profiles").select("avatar_url, display_name").eq("id", user.id).maybeSingle();
      setProfileImage(profile?.avatar_url || googleAvatar);
      setDisplayName(profile?.display_name || googleName);
    };
    void loadProfileImage();
  }, []);
  useEffect(() => {
    const handleSettingsNavigation = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest("button");
      const destination = button ? mySettingRoutes[button.textContent?.trim() ?? ""] : undefined;
      if (destination) router.push(destination);
    };
    document.addEventListener("click", handleSettingsNavigation);
    return () => document.removeEventListener("click", handleSettingsNavigation);
  }, [router]);
  const updateProfileImage = async (file?: File) => {
    if (!file) return;
    setProfileImage(URL.createObjectURL(file));
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const filePath = `${user.id}/profile.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(filePath, file, { upsert: true, contentType: file.type });
    if (uploadError) return;
    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
    const avatarUrl = `${publicUrl}?v=${Date.now()}`;
    const { error: profileError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", user.id);
    if (!profileError) setProfileImage(avatarUrl);
  };
  const logout = async () => { await getSupabaseBrowserClient().auth.signOut(); localStorage.removeItem("traini-garmin-connected"); localStorage.removeItem("traini-plan"); router.replace("/login"); };
  return <div className="page app-frame"><header className="flex h-10 items-center justify-between"><Brand /><Icon>settings</Icon></header><section className="mt-5 text-center"><input ref={uploadRef} className="sr-only" type="file" accept="image/*" onChange={(event) => void updateProfileImage(event.target.files?.[0])} /><button type="button" className="profile-upload" aria-label="프로필 사진 업로드" onClick={() => uploadRef.current?.click()}><span className="profile-image-clip">{profileImage ? <Image src={profileImage} alt={`${displayName} 프로필`} width={104} height={104} unoptimized /> : <Icon>person</Icon>}</span><span>+</span></button><h1 className="mt-3 text-xl font-semibold">{displayName}</h1><p className="mt-1 text-sm text-[#756e7c]">풀코스 3시간 30분 목표</p><span className="mt-2 inline-block rounded-full bg-[#eaf7ff] px-2 py-1 text-[10px] font-semibold text-[#147eaf]">Garmin 연결됨</span></section><section className="mt-6 grid grid-cols-3 divide-x divide-[#ece8ef] rounded-xl border border-[#ece8ef] py-3 text-center"><Metric label="VDOT" value="44"/><Metric label="훈련 연속" value="6" sub="weeks"/><Metric label="평균 거리" value="38.4" sub="km"/></section><section className="my-insight-card"><div className="my-insight-title"><div><p>최근 4주 훈련 인사이트</p><small>꾸준함이 페이스 향상으로 이어지고 있어요</small></div><Icon>insights</Icon></div><div className="my-insight-metrics"><div><small>평균 페이스</small><strong className="mono">5&apos;42&quot; <i>→</i> <b>5&apos;34&quot;</b></strong><p>km당 8초 향상</p></div><div><small>훈련 완료율</small><strong className="mono"><b>89%</b></strong><p>목표 18회 중 16회</p></div></div><div className="my-insight-weeks" aria-label="최근 4주 훈련 완료율"><div><i style={{height:"66%"}}/><span>1주</span></div><div><i style={{height:"74%"}}/><span>2주</span></div><div><i style={{height:"82%"}}/><span>3주</span></div><div><i className="is-current" style={{height:"92%"}}/><span>이번 주</span></div></div></section><section className="mt-5 divide-y divide-[#ece8ef] border-y border-[#ece8ef]">{rows.map((row)=><button className="flex w-full items-center justify-between py-4 text-sm" key={row}>{row}<Icon>chevron_right</Icon></button>)}</section><button type="button" className="logout-button" onClick={() => setShowLogoutModal(true)}>로그아웃</button>{showLogoutModal && <div className="logout-modal-backdrop" role="presentation" onClick={() => setShowLogoutModal(false)}><section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title" onClick={(event) => event.stopPropagation()}><h2 id="logout-title">로그아웃 하시겠습니까?</h2><p>현재 기기에서 Traini를 로그아웃합니다.</p><div><button type="button" onClick={() => setShowLogoutModal(false)}>아니오</button><button type="button" onClick={logout}>예, 로그아웃</button></div></section></div>}</div>;
}

function RoadmapProfileSync() {
  useEffect(() => {
    const syncRoadmap = async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("race_name, target_date, target_time_seconds").eq("id", user.id).maybeSingle();
      if (!data) return;
      const overview = document.querySelector(".roadmap-overview");
      const raceLabel = overview?.previousElementSibling?.querySelector(".eyebrow");
      const raceDate = data.target_date ? new Date(`${data.target_date}T00:00:00`) : null;
      const dDay = raceDate ? Math.max(0, Math.ceil((raceDate.getTime() - Date.now()) / 86400000)) : null;
      if (raceLabel) raceLabel.textContent = `${data.race_name || "나의 목표 대회"} · ${dDay === null ? "D-Day" : `D-${dDay}`}`;
      const target = overview?.querySelector("div:first-child .mono");
      if (target) target.textContent = toTime(data.target_time_seconds);
    };
    void syncRoadmap();
  }, []);
  return null;
}

function Roadmap() { const phases=[["1–6주차","기초 체력 및 마일리지 확장","완료"],["7–16주차","심폐·역치 강화","진행 중"],["17–21주차","레이스 페이스 적응","예정"],["22–24주차","테이퍼링 & D-Day","예정"]]; return <div className="page app-frame"><RoadmapProfileSync /><header className="flex h-10 items-center justify-between"><Brand /><Icon>settings</Icon></header><section className="mt-6"><Label>2026 SEOUL MARATHON · D-42</Label><h1 className="mt-2 text-[25px] font-semibold tracking-[-.04em]">나의 훈련 로드맵</h1></section><section className="roadmap-overview"><div><Label>GOAL RECORD</Label><p className="mono">03:30:00</p></div><div><Label>ESTIMATED</Label><p className="mono">03:45:20</p></div></section><section className="roadmap-phase"><div className="roadmap-phase-meta"><span>PHASE 2</span><p>심폐 · 역치 강화</p><small>9&nbsp; / &nbsp;24주차 (38%)</small></div><h2>지구력 기반 위에 스피드 지구력을<br/>더하는 단계예요.</h2><div className="roadmap-phase-line"><b /></div></section><section className="roadmap-timeline mt-6">{phases.map(([week,title,status],i)=><div className="roadmap-timeline-row" key={title}><span className={`roadmap-timeline-dot ${i===1?"is-active":i<1?"is-complete":""}`}/><div><p className="text-[11px] text-[#756e7c]">{week}</p><h3>{title}</h3><small className={status==="진행 중"?"is-active":""}>{status}</small></div></div>)}</section><section className="card mt-2 p-5"><h2 className="font-semibold">이번 단계의 핵심 목표</h2><p className="mt-2 text-sm leading-6 text-[#756e7c]">주간 거리 40→48km, 주 1회 역치주, 격주 장거리주</p><div className="mt-4 border-t border-[#ece8ef] pt-4"><Label>이번 주 포커스</Label><p className="mt-1 text-sm font-semibold">T-Pace 역치주 8km</p></div></section></div>; }

export function TrainiScreen({ screen }: Props) { const content = { splash:<Splash/>, login:<AdminLogin/>, garmin:<Garmin/>, analysis:<Analysis/>, goal:<Goal/>, schedule:<Schedule/>, today:<Today/>, my:<MyPage/>, roadmap:<Roadmap/>, "my-goals":<MyGoals/>, privacy:<Privacy/>, support:<Support/> }; return content[screen]; }
