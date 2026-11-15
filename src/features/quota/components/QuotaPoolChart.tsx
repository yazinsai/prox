/**
 * Pool chart: what was used (solid), what the current pace leads to (dashed),
 * the even pace that would spend each window exactly by its reset (dotted), and
 * the stretches where the pool is dry (shaded). Layout only; the numbers come
 * from pool/poolModel.ts.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { HOUR_MS, valueAt } from '../pool/poolModel';
import type { DrySpell, PoolPoint } from '../pool/poolModel';
import { dayLabelStep, splitAtJumps } from '../pool/chartGeometry';
import styles from './QuotaPoolChart.module.scss';

const DEFAULT_WIDTH = 1062;
/** Below this width the chart gets shorter and labels thin out. */
const COMPACT_WIDTH = 560;
const PLOT_TOP = 26;
const AXIS_HEIGHT = 30;
const PLOT_RIGHT_PAD = 6;
/** Rough glyph width at the axis font size, for edge clamping. */
const AXIS_CHAR_PX = 6.4;
/** Estimated tooltip width; it flips to the cursor's left when the right lacks room. */
const TOOLTIP_WIDTH = 150;
const TOOLTIP_GAP = 10;

export type ChartPointKind = 'recorded' | 'projected' | 'dry';

export interface QuotaPoolChartProps {
  span: { startMs: number; endMs: number };
  days: number[];
  now: number;
  /** Top of the value axis: the pool's capacity. */
  yMax: number;
  accent: string;
  recorded: PoolPoint[];
  projected: PoolPoint[];
  evenPace?: PoolPoint[];
  dry?: DrySpell[];
  formatAxis: (value: number) => string;
  formatDay: (ms: number) => string;
  /** Tooltip for an instant on the line. */
  describe: (
    atMs: number,
    value: number,
    kind: ChartPointKind
  ) => { title: string; detail: string };
  nowLabel: string;
  ariaLabel: string;
}

export function QuotaPoolChart(props: QuotaPoolChartProps) {
  const {
    span,
    days,
    now,
    yMax,
    accent,
    recorded,
    projected,
    evenPace = [],
    dry = [],
    formatAxis,
    formatDay,
    describe,
    nowLabel,
    ariaLabel,
  } = props;
  const gradientId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [cursorMs, setCursorMs] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const compact = width < COMPACT_WIDTH;
  const height = compact ? 196 : 244;
  const plotBottom = height - AXIS_HEIGHT;
  const plotLeft = 0;
  const plotRight = width - PLOT_RIGHT_PAD;
  const spanMs = span.endMs - span.startMs;
  const x = (ms: number) => plotLeft + ((ms - span.startMs) / spanMs) * (plotRight - plotLeft);
  const y = (value: number) =>
    plotBottom - (Math.min(yMax, Math.max(0, value)) / yMax) * (plotBottom - PLOT_TOP);
  const toPoints = (points: PoolPoint[]) =>
    points.map((p) => `${x(p.atMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const nowVisible = now >= span.startMs && now <= span.endMs;
  const evenRamps = useMemo(() => splitAtJumps(evenPace), [evenPace]);
  const hasLine = recorded.length > 0 || projected.length > 0;
  const areaOf = (points: PoolPoint[]) =>
    points.length > 1
      ? `M${x(points[0].atMs).toFixed(1)},${plotBottom} L${toPoints(points)} L${x(
          points[points.length - 1].atMs
        ).toFixed(1)},${plotBottom} Z`
      : null;
  const recordedArea = areaOf(recorded);
  const projectedArea = areaOf(projected);

  const spells = dry
    .map((spell) => ({
      startMs: Math.max(spell.startMs, span.startMs),
      endMs: Math.min(spell.endMs, span.endMs),
      origin: spell.startMs,
    }))
    .filter((spell) => spell.endMs > spell.startMs);

  /* ---------- day labels: every `step` days from today, kept inside the plot ---------- */

  const dayLabels = useMemo(() => {
    const pxPerDay = days.length > 0 ? (plotRight - plotLeft) / days.length : 0;
    const step = dayLabelStep(pxPerDay);
    const todayIndex = days.reduce((found, day, index) => (day <= now ? index : found), 0);
    return days.flatMap((day, index) => {
      if ((((index - todayIndex) % step) + step) % step !== 0) return [];
      const next = days[index + 1] ?? span.endMs;
      const center =
        plotLeft + ((day + next) / 2 - span.startMs) * ((plotRight - plotLeft) / spanMs);
      const text = formatDay(day);
      const half = (text.length * AXIS_CHAR_PX) / 2;
      if (center - half < plotLeft - 2 || center + half > width) return [];
      return [{ day, center, text, today: day <= now && now < next }];
    });
  }, [days, formatDay, now, plotLeft, plotRight, span.endMs, span.startMs, spanMs, width]);

  /* ---------- cursor ---------- */

  const pointAt = (ms: number): { value: number; kind: ChartPointKind } | null => {
    const inRecorded =
      recorded.length > 0 && ms >= recorded[0].atMs && ms <= recorded[recorded.length - 1].atMs;
    if (inRecorded && (projected.length === 0 || ms < projected[0].atMs)) {
      return { value: valueAt(recorded, ms), kind: 'recorded' };
    }
    if (
      projected.length > 0 &&
      ms >= projected[0].atMs &&
      ms <= projected[projected.length - 1].atMs
    ) {
      const isDry = spells.some((spell) => ms >= spell.startMs && ms < spell.endMs);
      return { value: valueAt(projected, ms), kind: isDry ? 'dry' : 'projected' };
    }
    return null;
  };

  const cursorFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    if (px < plotLeft || px > plotRight) return null;
    return span.startMs + ((px - plotLeft) / (plotRight - plotLeft)) * spanMs;
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setCursorMs(cursorFromEvent(event));
  };

  // Touch has no hover: a tap places the cursor and it stays until focus leaves.
  const onPointerLeave = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'touch') setCursorMs(null);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = 3 * HOUR_MS;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const base = cursorMs ?? (nowVisible ? now : span.startMs);
      const next = base + (event.key === 'ArrowRight' ? step : -step);
      setCursorMs(Math.min(span.endMs, Math.max(span.startMs, next)));
    } else if (event.key === 'Escape') {
      setCursorMs(null);
    }
  };

  const hover = cursorMs !== null ? pointAt(cursorMs) : null;
  const tip = hover && cursorMs !== null ? describe(cursorMs, hover.value, hover.kind) : null;
  const cursorX = cursorMs !== null ? x(cursorMs) : 0;
  const tipOnLeft = cursorX + TOOLTIP_GAP + TOOLTIP_WIDTH > width;

  const capLabel = formatAxis(yMax);
  const capLabelWidth = capLabel.length * AXIS_CHAR_PX;
  const nowX = x(now);
  const showCapLabel = !nowVisible || nowX < plotRight - capLabelWidth - 28;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <svg
        className={styles.chart}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerDown={onPointerMove}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onBlur={() => setCursorMs(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: accent, stopOpacity: 0.22 }} />
            <stop offset="1" style={{ stopColor: accent, stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {spells.map((spell) => (
          <rect
            key={`dry-${spell.origin}`}
            x={x(spell.startMs)}
            y={PLOT_TOP}
            width={Math.max(1, x(spell.endMs) - x(spell.startMs))}
            height={plotBottom - PLOT_TOP}
            className={styles.dryBand}
          />
        ))}

        <line x1={plotLeft} x2={plotRight} y1={PLOT_TOP} y2={PLOT_TOP} className={styles.capLine} />
        {showCapLabel && (
          <text x={plotRight} y={PLOT_TOP - 8} textAnchor="end" className={styles.axisText}>
            {capLabel}
          </text>
        )}

        {recordedArea && (
          <path d={recordedArea} fill={`url(#${gradientId})`} className={styles.area} />
        )}
        {projectedArea && (
          <path
            d={projectedArea}
            fill={`url(#${gradientId})`}
            className={`${styles.area} ${styles.areaForecast}`}
          />
        )}

        {evenRamps.map((ramp) => (
          <polyline key={ramp[0].atMs} points={toPoints(ramp)} className={styles.evenLine} />
        ))}

        {nowVisible && (
          <g>
            <line
              x1={nowX}
              x2={nowX}
              y1={PLOT_TOP - 4}
              y2={plotBottom}
              className={styles.nowLine}
            />
            <text x={nowX} y={PLOT_TOP - 8} textAnchor="middle" className={styles.nowText}>
              {nowLabel}
            </text>
          </g>
        )}

        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          className={styles.baseLine}
        />

        {spells.map((spell) => (
          <line
            key={`dry-base-${spell.origin}`}
            x1={x(spell.startMs)}
            x2={x(spell.endMs)}
            y1={plotBottom}
            y2={plotBottom}
            className={styles.dryBase}
          />
        ))}

        {recorded.length > 1 && (
          <polyline
            points={toPoints(recorded)}
            className={styles.recordedLine}
            style={{ stroke: accent }}
          />
        )}
        {projected.length > 1 && (
          <polyline
            points={toPoints(projected)}
            className={styles.projectedLine}
            style={{ stroke: accent }}
          />
        )}

        {spells
          .filter((spell) => spell.origin >= span.startMs && spell.origin > now)
          .map((spell) => (
            <circle
              key={`dry-dot-${spell.origin}`}
              cx={x(spell.startMs)}
              cy={plotBottom}
              r={4}
              className={styles.dryDot}
            />
          ))}

        {nowVisible && hasLine && (
          <circle
            cx={nowX}
            cy={y(valueAt(projected.length > 0 ? projected : recorded, now))}
            r={4.5}
            className={styles.nowDot}
            style={{ fill: accent }}
          />
        )}

        {dayLabels.map((label) => (
          <text
            key={label.day}
            x={label.center}
            y={plotBottom + 20}
            textAnchor="middle"
            className={label.today ? `${styles.dayText} ${styles.dayToday}` : styles.dayText}
          >
            {label.text}
          </text>
        ))}

        {hover && cursorMs !== null && (
          <g pointerEvents="none">
            <line
              x1={x(cursorMs)}
              x2={x(cursorMs)}
              y1={PLOT_TOP}
              y2={plotBottom}
              className={styles.cursorLine}
            />
            <circle
              cx={x(cursorMs)}
              cy={y(hover.value)}
              r={4.5}
              className={styles.cursorDot}
              style={{ fill: accent }}
            />
          </g>
        )}
      </svg>

      {tip && (
        <div
          className={styles.tooltip}
          style={{
            top: PLOT_TOP + 6,
            left: tipOnLeft ? cursorX - TOOLTIP_GAP : cursorX + TOOLTIP_GAP,
          }}
          data-side={tipOnLeft ? 'left' : 'right'}
          data-kind={hover?.kind}
          aria-hidden="true"
        >
          <span className={styles.tooltipTitle}>{tip.title}</span>
          <span className={styles.tooltipDetail}>{tip.detail}</span>
        </div>
      )}
      <p className={styles.srOnly} aria-live="polite">
        {tip ? `${tip.title}, ${tip.detail}` : ''}
      </p>
    </div>
  );
}
