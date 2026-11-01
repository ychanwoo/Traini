import assert from 'node:assert/strict';

// Compare only protected workout fields, excluding mutable Garmin matching metadata.
export function protectedWorkouts(result) {
  return (result.plan?.workouts ?? [])
    .filter(w => w.completed || w.status === 'skipped' || (w.feedback?.version ?? 0) > 0)
    .map(({id,date,kind,title,purpose,distanceKm,paceSecondsPerKm,effort,steps,completed,status,feedback}) =>
      ({id,date,kind,title,purpose,distanceKm,paceSecondsPerKm,effort,steps,completed,status,feedback}))
    .sort((a,b) => a.date.localeCompare(b.date));
}
export function verifyProtectedWorkouts(before, after) {
  const saved = new Map((after.plan?.workouts ?? []).map(w => [w.id,w]));
  for (const old of protectedWorkouts(before)) {
    const current = saved.get(old.id);
    assert.ok(current, 'A protected workout was removed');
    assert.deepEqual(protectedWorkouts({plan:{workouts:[current]}}), [old], 'A protected workout was changed');
  }
}
export function verifyCurrentEvidence(context, summary, prompt) {
  const expected = summary.activities.map(a => `${a.trainingDate}:${a.distanceMeters}:${a.timerSeconds}`).sort();
  const received = (context.currentWeek?.sessions ?? []).map(a => `${a.trainingDate}:${a.distanceMeters}:${a.timerSeconds}`).sort();
  assert.deepEqual(received, expected, 'Current-week activities are missing from training context');
  const input = JSON.parse(prompt.input[0].content);
  assert.deepEqual(input.currentWeek, context.currentWeek, 'Current-week evidence is missing from the prompt');
  assert.equal(context.history.requestedWeeks,8);
  assert.ok(context.history.end < context.currentWeek.start, 'Partial week must not enter the completed-week baseline');
  assert.ok(Array.isArray(input.sessionAnalysis), 'Session analysis is missing');
  return {currentWeekActivities:received.length, historicalActivities:context.history.activityCount,
    classifiedIntervals:input.sessionAnalysis.filter(s=>s.classification==='interval').length,
    classifiedSustained:input.sessionAnalysis.filter(s=>s.classification==='sustained').length};
}
