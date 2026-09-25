import type { ReactNode } from "react";
import { Card } from "./Card";

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-10 text-center text-muted text-sm flex flex-col items-center gap-2.5">
      {icon ? <span className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">{icon}</span> : null}
      {children}
    </Card>
  );
}

export function ListSkeleton({ count = 3, height = "h-24" }: { count?: number; height?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${height} rounded-2xl bg-slate-200/60 animate-pulse`} />
      ))}
    </>
  );
}
