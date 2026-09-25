import type { HTMLAttributes } from "react";
import clsx from "clsx";

const toneClasses = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
  neutral: "bg-slate-100 text-ink-soft",
};

const dotClasses = {
  primary: "bg-primary",
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
  neutral: "bg-slate-400",
};

export type Tone = keyof typeof toneClasses;

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap", toneClasses[tone], className)}
      {...props}
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", dotClasses[tone])} />
      {children}
    </span>
  );
}
