"use client";

import { useEffect, useState } from "react";
import { formatJalaliDateTime } from "@/lib/persian";
import type { DocumentRevision } from "@/lib/api";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-US") : String(v));

/** تاریخچه‌ی ویرایش/ابطال یک سند: چه کسی، کی، چرا، و چه چیزی تغییر کرد. بدون سابقه → چیزی نمایش داده نمی‌شود. */
export function RevisionHistory({ load, refreshKey }: { load: () => Promise<DocumentRevision[]>; refreshKey?: unknown }) {
  const [rows, setRows] = useState<DocumentRevision[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    load()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (rows.length === 0) return null;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-[12.5px] font-bold bg-slate-50 cursor-pointer"
      >
        <span>تاریخچه‌ی ویرایش و ابطال ({rows.length})</span>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="px-3.5 py-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold">
                  {r.action === "VOID" ? "ابطال" : `ویرایش ${r.revisionNo}`} · {r.userName ?? "سیستم"}
                </span>
                <span className="text-muted">{formatJalaliDateTime(r.createdAt)}</span>
              </div>
              <div className="text-ink-soft mt-1">دلیل: {r.reason}</div>
              {r.changes && r.changes.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
                  {r.changes.map((c, i) => (
                    <li key={i}>
                      {c.field}: <span className="line-through">{show(c.from)}</span> ← <span className="text-ink-soft font-semibold">{show(c.to)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
