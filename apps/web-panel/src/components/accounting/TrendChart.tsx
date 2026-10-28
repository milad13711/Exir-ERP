"use client";

import { formatNumber, toPersianDigits } from "@/lib/persian";

export type TrendPoint = { label: string; revenue: number; expense: number; net: number };

function compact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000_000) return `${sign}${toPersianDigits((a / 1_000_000_000).toFixed(1).replace(/\.0$/, ""))} میلیارد`;
  if (a >= 1_000_000) return `${sign}${toPersianDigits((a / 1_000_000).toFixed(1).replace(/\.0$/, ""))} میلیون`;
  if (a >= 1_000) return `${sign}${toPersianDigits(Math.round(a / 1_000))} هزار`;
  return `${sign}${toPersianDigits(a)}`;
}

/** نمودار روند ماهانه بدون وابستگی: ستون درآمد/هزینه + خط سود خالص (SVG). */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640;
  const H = 240;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 44;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const all = points.flatMap((p) => [p.revenue, p.expense, p.net, 0]);
  const max = Math.max(...all);
  const min = Math.min(...all);
  const span = max - min || 1;
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;
  const zeroY = y(0);
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(18, slot / 3);
  const cx = (i: number) => padL + slot * (i + 0.5);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${cx(i)},${y(p.net)}`).join(" ");
  const desc = points.map((p) => `${p.label}: درآمد ${formatNumber(p.revenue)}، هزینه ${formatNumber(p.expense)}، سود خالص ${formatNumber(p.net)}`).join("؛ ");

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`نمودار روند ماهانه. ${desc}`} direction="ltr">
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="var(--color-border)" strokeWidth="1" />
        <text x={W - padR} y={padT - 3} textAnchor="end" fontSize="10" fill="var(--color-muted)">
          {compact(max)}
        </text>
        {min < 0 ? (
          <text x={W - padR} y={H - padB + 12} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {compact(min)}
          </text>
        ) : null}
        {points.map((p, i) => (
          <g key={p.label + i}>
            <rect x={cx(i) - barW - 1} y={Math.min(y(p.revenue), zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - y(p.revenue)))} rx="2" fill="var(--color-success)" opacity="0.85">
              <title>{`${p.label} — درآمد: ${formatNumber(p.revenue)}`}</title>
            </rect>
            <rect x={cx(i) + 1} y={Math.min(y(p.expense), zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - y(p.expense)))} rx="2" fill="var(--color-danger)" opacity="0.8">
              <title>{`${p.label} — هزینه: ${formatNumber(p.expense)}`}</title>
            </rect>
            <text x={cx(i)} y={H - padB + 26} textAnchor="middle" fontSize="10.5" fill="var(--color-ink-soft)">
              {p.label}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2.2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={cx(i)} cy={y(p.net)} r="3.5" fill="var(--color-primary)">
            <title>{`${p.label} — سود خالص: ${formatNumber(p.net)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex items-center justify-center gap-4 text-[11.5px] text-ink-soft mt-1.5 flex-wrap">
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm bg-success" />درآمد</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm bg-danger" />هزینه</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-0.5 bg-primary" />سود (زیان) خالص</span>
      </figcaption>
    </figure>
  );
}
