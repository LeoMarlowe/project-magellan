// Graphics presets and the Auto controller. Pure logic: no renderer or DOM, so
// level selection is unit-tested independently of real frame timing.
export const QUALITY_PRESETS = ['auto', 'low', 'medium', 'high'];

// farShadow is the wide second sun shadow map (0 turns it off); see
// shadow-fade.mjs. Low and Medium grass use the cheap five-triangle tufts at a
// lower density, keeping phones near their earlier grass cost. Phones have
// small CSS viewports, so High may use a denser 2× buffer there and still draw
// fewer pixels than the desktop cap on a larger window. On a desktop Retina
// screen 1.5× (rather than 1.7×) saves about a fifth of the GPU's frame time
// for a barely visible difference under MSAA. The far shadow map only covers
// distant trees and rocks, softly: 1024 is plenty there, even on High.
export function qualityLevels(coarse) {
  const high = coarse ? 2 : 1.5;
  return [
    { name: 'low', pixelRatio: 1, shadow: 512, farShadow: 0, grass: { density: .1, range: 36, fade: 16, blades: 'simple' } },
    { name: 'medium', pixelRatio: 1.35, shadow: 1024, farShadow: 1024, grass: { density: .2, range: 48, fade: 22, blades: 'simple' } },
    { name: 'medium+', pixelRatio: (1.35 + high) / 2, shadow: 2048, farShadow: 1024, grass: { density: .75, range: 62, fade: 30, blades: 'full' } },
    { name: 'high', pixelRatio: high, shadow: 2048, farShadow: 1024, grass: { density: 1, range: 78, fade: 38, blades: 'full' } },
  ];
}
export const presetLevel = preset => ({ low: 0, medium: 1, high: 3 })[preset];
// Auto starts phones at the previous fixed mobile settings and desktop at the
// previous fixed desktop settings; it climbs only after proving smooth frames.
export const autoStartLevel = coarse => coarse ? 1 : 3;

// The display's refresh interval from recent frame intervals: their 10th
// percentile, so a run of slow frames doesn't count as the refresh rate.
export function refreshInterval(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * .1)] ?? 1000 / 60;
}
// A visible stutter: a frame over one and a half refreshes, and under 50 fps.
export const isSlowFrame = (intervalMs, refreshMs) => intervalMs > Math.max(1.5 * refreshMs, 20);

const SLOW_MS = 1000 / 48, SMOOTH_MS = 1000 / 57;
// Step down after 2 s of sustained slow frames, or when over 3% of the last
// 10 s of frames were stutters (an average near 60 fps hides those); stutters
// alone stop at Medium, since they can also come from outside the game. Step up
// after 6 s of smooth frames with few stutters, unless that level recently failed. A level that
// fails twice is not retried during this visit, so Auto never oscillates.
export function createAutoQuality({ start, max, settleMs = 1500, downMs = 2000, upMs = 6000, retryMs = 30000, stutterMs = 10000, stutterShare = .03 }) {
  let level = start, settledAt = 0, slowSince = null, smoothSince = null, refreshMs = 1000 / 60, stutters = 0, sampled = 0;
  const intervals = [], recent = [], failures = new Map();
  function reset(now) { intervals.length = recent.length = stutters = 0; slowSince = smoothSince = null; settledAt = now + settleMs; }
  function stepDown(now) {
    const failed = failures.get(level) ?? { count: 0 };
    failures.set(level, { count: failed.count + 1, until: now + retryMs });
    return change(level - 1, now);
  }
  function change(next, now) { level = next; reset(now); return level; }
  return {
    get level() { return level; },
    reset,
    // Returns the new level when it changes, otherwise null.
    sample(intervalMs, now) {
      // Long gaps are a tab switch, a pause or a debugger, not rendering cost.
      if (intervalMs > 250 || now < settledAt) return null;
      intervals.push([now, intervalMs]);
      while (intervals.length && intervals[0][0] < now - downMs) intervals.shift();
      // Stutters over a longer window, judged against the display's refresh
      // (re-estimated every 60 frames, so 120 Hz screens are judged fairly).
      if (++sampled % 60 === 0) refreshMs = refreshInterval(recent.map(([, ms]) => ms));
      const stutter = recent.length >= 30 && isSlowFrame(intervalMs, refreshMs);
      recent.push([now, intervalMs, stutter]); stutters += stutter;
      while (recent.length && recent[0][0] < now - stutterMs) stutters -= recent.shift()[2];
      if (level > 1 && recent.length >= 60 && now - recent[0][0] >= stutterMs * .75 && stutters > recent.length * stutterShare) return stepDown(now);
      // Judge once the window covers most of its time span, not a frame count:
      // a machine at 8 fps never fits 20 frames into 2 s, yet needs Low most.
      if (intervals.length < 5 || now - intervals[0][0] + intervals[0][1] < downMs * .75) return null;
      const mean = intervals.reduce((sum, [, ms]) => sum + ms, 0) / intervals.length;
      if (mean > SLOW_MS) {
        smoothSince = null; slowSince ??= now;
        if (now - slowSince >= downMs && level > 0) return stepDown(now);
      } else if (mean < SMOOTH_MS) {
        slowSince = null; smoothSince ??= now;
        const next = failures.get(level + 1);
        const allowed = (!next || (next.count < 2 && now >= next.until)) && stutters <= recent.length * stutterShare / 2;
        if (now - smoothSince >= upMs && level < max && allowed) return change(level + 1, now);
      } else slowSince = smoothSince = null;
      return null;
    },
  };
}
