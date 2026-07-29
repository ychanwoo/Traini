import { roadmapPhases } from "@/constants/roadmap-phases";

export default function RoadmapPage() {
  return <main className="space-y-6 p-5"><h1 className="text-2xl font-semibold">로드맵</h1><ul className="space-y-4">{roadmapPhases.map((phase) => <li key={phase.id}><p className="font-semibold">{phase.title}</p><p className="text-sm text-[#6B6470]">{phase.weeks} · {phase.focus}</p></li>)}</ul></main>;
}
