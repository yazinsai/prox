/** Pure layout helpers for the pool chart. */

import type { PoolPoint } from './poolModel';

/** Room a day label needs, in px, before neighbours are dropped. */
const DAY_LABEL_SPACE = 58;

/** Break a polyline at its vertical jumps, so a reference line reads as separate ramps. */
export function splitAtJumps(points: PoolPoint[]): PoolPoint[][] {
  const segments: PoolPoint[][] = [];
  let current: PoolPoint[] = [];
  points.forEach((point) => {
    const last = current[current.length - 1];
    if (last && last.atMs === point.atMs) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  });
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Which day columns get a label: every `step` days counted from today. */
export function dayLabelStep(pxPerDay: number): number {
  if (pxPerDay <= 0) return 1;
  return [1, 2, 3, 7, 14].find((step) => step * pxPerDay >= DAY_LABEL_SPACE) ?? 14;
}
