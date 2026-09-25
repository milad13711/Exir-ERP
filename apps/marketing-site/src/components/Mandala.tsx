import { useId } from "react";

/**
 * مندالای طلایی — الهام‌گرفته از تصویر مرجع برند. ترکیب حلقه‌های گلبرگ با خط طلایی گرادیانی؛
 * صرفاً تزئینی است (aria-hidden) و با transform/opacity قابل‌کنترل است.
 */
export function Mandala({ className, petals = 12 }: { className?: string; petals?: number }) {
  const gid = useId().replace(/:/g, "");
  const step = 360 / petals;
  return (
    <svg viewBox="-110 -110 220 220" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e7ac" />
          <stop offset="0.55" stopColor="#cfa84d" />
          <stop offset="1" stopColor="#a58230" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#g${gid})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {Array.from({ length: petals }).map((_, i) => (
          <g key={`o${i}`} transform={`rotate(${i * step})`}>
            <path d="M0 -104 C 17 -84, 17 -52, 0 -34 C -17 -52, -17 -84, 0 -104 Z" />
            <path d="M0 -92 C 8 -80, 8 -64, 0 -54 C -8 -64, -8 -80, 0 -92 Z" />
            <circle cx="0" cy="-76" r="2.4" />
          </g>
        ))}
        {Array.from({ length: petals }).map((_, i) => (
          <g key={`m${i}`} transform={`rotate(${i * step + step / 2})`}>
            <path d="M0 -70 C 9 -58, 9 -44, 0 -34 C -9 -44, -9 -58, 0 -70 Z" />
          </g>
        ))}
        <circle r="30" />
        <circle r="24" strokeDasharray="2 4" />
        <circle r="14" />
        {Array.from({ length: petals }).map((_, i) => (
          <path key={`c${i}`} transform={`rotate(${i * step})`} d="M0 -14 C 6 -20, 6 -26, 0 -30 C -6 -26, -6 -20, 0 -14 Z" />
        ))}
      </g>
    </svg>
  );
}

/** جداکننده‌ی تزئینی زیر عنوان بخش‌ها: خط طلایی + لوزی مرکزی. */
export function OrnamentDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-16 bg-gradient-to-l from-gold-dark to-transparent" />
      <span className="w-2 h-2 rotate-45 bg-gold" />
      <span className="h-px w-16 bg-gradient-to-r from-gold-dark to-transparent" />
    </div>
  );
}

/** باند بالای صفحه‌های داخلی — زمینه‌ی سبز عمیق، مندالای طلایی در گوشه‌ها و خط طلایی پایین. */
export function HeroBand({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`hero-band ${className}`}>
      <div className="absolute inset-0 pattern-gold" aria-hidden />
      <Mandala className="absolute -top-24 -start-24 w-[300px] h-[300px] opacity-25 rotate-12 pointer-events-none" />
      <Mandala className="absolute -bottom-28 -end-20 w-[340px] h-[340px] opacity-20 -rotate-6 pointer-events-none" petals={16} />
      <div className="relative">{children}</div>
    </section>
  );
}
