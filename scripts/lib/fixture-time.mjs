// Synthetic activities must agree with their declared training date/timezone.
// These fixture zones have whole-hour offsets; local noon avoids DST gaps.
export function fixtureNoon(date, timezone) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', hourCycle:'h23',
  });
  const base = Date.parse(`${date}T12:00:00Z`);
  for(let hour=-14;hour<=14;hour++) {
    const instant = new Date(base + hour * 3600000);
    const p = Object.fromEntries(format.formatToParts(instant).map(v=>[v.type,v.value]));
    if(`${p.year}-${p.month}-${p.day}`===date && p.hour==='12') return instant.toISOString();
  }
  throw new Error('Unsupported fixture date/timezone');
}
