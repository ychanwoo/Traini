import assert from 'node:assert/strict';

const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

// Calendar dates come from the authenticated server, never the machine timezone.
export function verifyCyclePeriods(context, review, plan) {
  assert.equal(plan.period.today, context.asOfDate, 'Planning date changed');
  assert.equal(plan.period.timezone, context.timezone, 'Planning timezone changed');
  assert.equal(review.period.timezone, context.timezone, 'Review timezone changed');
  assert.equal(new Date(`${plan.period.start}T12:00:00Z`).getUTCDay(), 1, 'Plan must start on Monday');
  assert.equal(plan.period.end, addDays(plan.period.start, 6), 'Plan must cover seven calendar days');
  assert.equal(review.period.startsOn, addDays(plan.period.start, -7), 'Review must use the previous week');
  assert.equal(review.period.endsOn, addDays(plan.period.start, -1), 'Review must end on Sunday');
  assert.ok(context.asOfDate >= plan.period.start && context.asOfDate <= plan.period.end, 'Plan is not the current week');
}

export function verifyReviewLink(review, plan) {
  assert.ok(review.review?.fresh, 'Review is not fresh');
  assert.ok(plan.plan, 'Plan is missing');
  assert.equal(plan.plan.review?.id, review.review.id, 'Plan uses a different review');
  assert.equal(plan.plan.review?.revision, review.review.revision, 'Plan uses a different review revision');
  assert.equal(plan.plan.review?.startsOn, review.period.startsOn, 'Plan uses a different review week');
}

export function verifyFullWeek(plan) {
  assert.ok(plan.plan, 'Plan is missing');
  const expected = Array.from({length: 7}, (_, day) => addDays(plan.period.start, day));
  assert.deepEqual(plan.plan.workouts.map(w => w.date).sort(), expected, 'Full-week plan must contain each day exactly once');
}

export function verifyReviewEvidence(summary, review) {
  assert.equal(summary.period.start, review.period.startsOn, 'Imported week differs from review');
  assert.equal(summary.period.end, review.period.endsOn, 'Imported week differs from review');
  const measured = summary.activities.map(a => JSON.stringify([
    a.trainingDate,
    a.distanceMeters === null ? null : Math.round(a.distanceMeters) / 1000,
    a.timerSeconds,
  ])).sort();
  const reviewed = review.metrics.activities.map(a => JSON.stringify([a.date,a.distanceKm,a.timerSeconds])).sort();
  assert.deepEqual(reviewed, measured, 'Review does not contain the imported activity measurements');
  assert.equal(review.metrics.activityCount, measured.length, 'Review activity count differs');
}

// Each stage can make at most one POST. Failure stops the cycle; no retry/fallback.
export async function runWeeklyCycle({request, generate = false, onAttempt = () => {},
  now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const context = await request('/api/training/context');
  let review = await request('/api/training/review');
  let plan = await request('/api/training/plan?week=current');
  verifyCyclePeriods(context, review, plan);
  const attempts = {review: 0, plan: 0};
  if (!generate) return {context, review, plan, attempts};

  const ready = async () => {
    let quota = await request('/api/training/generation-status');
    assert.equal(quota.active, null, 'Generation is busy');
    assert.ok(quota.quota.remaining > 0, 'Generation quota exhausted');
    // The DB owns the cooldown. Its clock can differ from the local test host.
    const checkedAt = value => value.checkedAt ? Date.parse(value.checkedAt) : now();
    const delay = quota.quota.retryAt ? Date.parse(quota.quota.retryAt) - checkedAt(quota) : 0;
    assert.ok(Number.isFinite(delay) && delay <= 60000, 'Generation cooldown requires a later run');
    if (delay > 0) {
      await wait(delay);
      quota = await request('/api/training/generation-status');
      assert.equal(quota.active, null, 'Generation is busy');
      assert.ok(quota.quota.remaining > 0, 'Generation quota exhausted');
      assert.ok(!quota.quota.retryAt || Date.parse(quota.quota.retryAt) <= checkedAt(quota), 'Generation cooldown remains active');
    }
  };
  if (!review.review?.fresh) {
    await ready();
    attempts.review++;
    onAttempt('review');
    review = await request('/api/training/review', {
      method: 'POST', body: {startsOn: review.period.startsOn}, timeoutMs: 300000,
    });
  }
  assert.ok(review.review?.fresh, 'Review did not become fresh');
  // Saving a review may invalidate an otherwise-current plan. Always read again.
  plan = await request('/api/training/plan?week=current');
  const linked = plan.plan?.review?.id === review.review.id &&
    plan.plan?.review?.revision === review.review.revision;
  if (!plan.plan || plan.inputsChanged || !linked) {
    await ready();
    attempts.plan++;
    onAttempt('plan');
    await request('/api/training/generate', {
      method: 'POST', body: {week: 'current'}, timeoutMs: 300000,
    });
  }
  plan = await request('/api/training/plan?week=current');
  verifyCyclePeriods(context, review, plan);
  verifyReviewLink(review, plan);
  assert.equal(plan.inputsChanged, false, 'Saved plan is stale');
  if (context.asOfDate === plan.period.start) verifyFullWeek(plan);
  return {context, review, plan, attempts};
}
