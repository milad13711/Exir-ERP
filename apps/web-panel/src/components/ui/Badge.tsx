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

export type Tone = keyof typeof toneClasses;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
