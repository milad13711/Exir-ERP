import type { HTMLAttributes } from "react";
import clsx from "clsx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("bg-surface border border-border rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_-8px_rgba(16,24,40,0.08)]", className)}
      {...props}
    />
  );
}
