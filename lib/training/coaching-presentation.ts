/** Presentation only: original text stays available in the expanded view. */
export function coachingLead(text: string, limit = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sentences = [
    ...new Intl.Segmenter("ko", { granularity: "sentence" }).segment(clean),
  ];
  let lead = "";
  for (const { segment } of sentences) {
    if ((lead + segment).trim().length > limit) break;
    lead += segment;
  }
  if (lead.trim()) return lead.trim();
  const excerpt = [...clean].slice(0, limit).join("");
  const boundary = excerpt.lastIndexOf(" ");
  return `${boundary > limit / 2 ? excerpt.slice(0, boundary) : excerpt}…`;
}

/** Preserve original evidence and decimal values when presenting sentence bullets. */
export function coachingSentences(text: string): string[] {
  return [...new Intl.Segmenter("ko", {granularity:"sentence"}).segment(text)].map(({segment})=>segment.replace(/\s+/g," ").trim()).filter(Boolean);
}
