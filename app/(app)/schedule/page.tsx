import { TrainiScreen } from "@/components/traini-screen";
import { scheduleWeek } from "@/lib/training/schedule-week";

export default async function SchedulePage({ searchParams }: {
  searchParams: Promise<{ start?: string | string[] }>;
}) {
  const { start } = await searchParams;
  const week = scheduleWeek(typeof start === "string" ? start : undefined,
    process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles");
  return <TrainiScreen screen="schedule" scheduleWeek={week} />;
}
