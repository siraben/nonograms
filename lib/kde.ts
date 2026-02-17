/**
 * Compute a KDE (Kernel Density Estimation) SVG path from move timestamps.
 * Shared between server (leaderboard) and client (replay scrubber).
 *
 * @param atMsValues  Array of at_ms timestamps for each move
 * @param totalMs     Total duration in ms (used to normalize positions)
 * @param bins        Number of histogram bins (default 80)
 * @param viewWidth   SVG viewBox width (default 100)
 * @param viewHeight  SVG viewBox height (default 28)
 * @returns SVG path string, or "" if insufficient data
 */
export function computeKdePath(
  atMsValues: number[],
  totalMs: number,
  bins = 80,
  viewWidth = 100,
  viewHeight = 28
): string {
  if (atMsValues.length < 2 || totalMs <= 0) return "";

  const bandwidth = Math.max(totalMs / 20, 1);
  const density = new Float64Array(bins);

  for (const atMs of atMsValues) {
    const center = (atMs / totalMs) * bins;
    for (let b = 0; b < bins; b++) {
      const dist = (b + 0.5 - center) * (totalMs / bins);
      density[b] += Math.exp(-0.5 * (dist / bandwidth) ** 2);
    }
  }

  let maxD = 0;
  for (let b = 0; b < bins; b++) if (density[b] > maxD) maxD = density[b];
  if (maxD === 0) return "";

  // Smoothstep damping at edges (f'(1)=0, no visible kink at taper boundary)
  const TAPER = Math.min(16, Math.floor(bins / 5));
  for (let i = 0; i < TAPER; i++) {
    const t = (i + 1) / (TAPER + 1);  // 0..1
    const w = t * t * (3 - 2 * t);    // smoothstep
    density[i] *= w;
    density[bins - 1 - i] *= w;
  }

  let d = `M0,${viewHeight}`;
  for (let b = 0; b < bins; b++) {
    const x = ((b + 0.5) / bins) * viewWidth;
    const y = viewHeight - (density[b] / maxD) * (viewHeight - 2);
    d += ` L${x.toFixed(2)},${y.toFixed(1)}`;
  }
  d += ` L${viewWidth},${viewHeight} Z`;
  return d;
}
