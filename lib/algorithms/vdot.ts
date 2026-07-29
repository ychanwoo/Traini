/** A deliberately simple MVP estimate; replace with a validated model before production. */
export function estimateVdotFromVo2Max(vo2Max: number | null) {
  return vo2Max === null ? null : Math.round(vo2Max * 0.88);
}
