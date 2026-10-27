"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { apiFetch } from "@/lib/api";
import { getManager } from "@/lib/offline/client";
import { OFFLINE_OPS } from "@/lib/offline/registry";
import type { OutboxItem } from "@/lib/offline/types";

/** حل تعارض ویرایش: نسخه‌ی من / نسخه‌ی سرور / ادغام فیلد‌به‌فیلد (برای رکوردهای ساده). */
export function ConflictDialog({ item, onClose, onDone }: { item: OutboxItem; onClose: () => void; onDone: () => void }) {
  const op = OFFLINE_OPS.find((o) => o.key === item.opKey);
  const fields = op?.mergeFields ?? [];
  const currentPath = op?.currentPath?.(item.path) ?? null;
  const [server, setServer] = useState<Record<string, unknown> | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [pick, setPick] = useState<Record<string, "mine" | "server">>({});
  const [busy, setBusy] = useState(false);
  const mine = (item.body && typeof item.body === "object" ? item.body : {}) as Record<string, unknown>;

  useEffect(() => {
    if (!currentPath) return;
    apiFetch<Record<string, unknown>>(currentPath).then(setServer).catch(() => setLoadErr(true));
  }, [currentPath]);

  const changed = fields.filter((f) => f.field in mine && server && JSON.stringify(mine[f.field] ?? null) !== JSON.stringify(server[f.field] ?? null));

  async function resolve(kind: "mine" | "server" | "merged") {
    const m = getManager();
    if (!m) return;
    setBusy(true);
    try {
      // نسخه‌ی پایه با updatedAt تازه‌ی سرور (اگر دریافت شده) هم‌تراز می‌شود
      if (server && typeof server.updatedAt === "string") await m.store.outboxUpdate({ ...item, serverUpdatedAt: server.updatedAt });
      if (kind === "merged") {
        const body = { ...mine };
        for (const f of changed) if ((pick[f.field] ?? "mine") === "server") body[f.field] = server?.[f.field] ?? null;
        await m.engine.resolveConflict(item.id, { kind: "merged", body });
      } else await m.engine.resolveConflict(item.id, { kind });
      void m.syncNow();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

  return (
    <Modal title="حل تعارض" onClose={onClose} width="max-w-[560px]">
      <p className="text-[13px] text-ink-soft mb-3">{item.lastError ?? "این رکورد بعد از آخرین دریافت شما روی سرور تغییر کرده است."}</p>
      {currentPath && !server && !loadErr ? <div className="text-[12.5px] text-muted py-3">در حال دریافت نسخه‌ی سرور…</div> : null}
      {loadErr ? <div className="text-[12.5px] text-danger py-2">دریافت نسخه‌ی سرور ممکن نشد (آفلاین یا بدون دسترسی).</div> : null}
      {changed.length > 0 ? (
        <div className="flex flex-col gap-2 mb-3">
          {changed.map((f) => (
            <div key={f.field} className="border border-border rounded-xl p-3">
              <div className="text-[12px] font-bold mb-2">{f.label}</div>
              {(["mine", "server"] as const).map((side) => (
                <label key={side} className="flex items-start gap-2 min-h-[40px] text-[13px] cursor-pointer">
                  <input type="radio" name={f.field} checked={(pick[f.field] ?? "mine") === side} onChange={() => setPick({ ...pick, [f.field]: side })} className="mt-1.5" />
                  <span>
                    <span className="text-muted text-[11px] block">{side === "mine" ? "نسخه‌ی من" : "نسخه‌ی سرور"}</span>
                    {show(side === "mine" ? mine[f.field] : server?.[f.field])}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" disabled={busy} onClick={onClose} className="min-h-[40px] px-3 text-[13px] rounded-lg border border-border">بعداً</button>
        <button type="button" disabled={busy} onClick={() => resolve("server")} className="min-h-[40px] px-3 text-[13px] rounded-lg border border-border">نسخه‌ی سرور (دور انداختن تغییر من)</button>
        {changed.length > 0 ? (
          <button type="button" disabled={busy} onClick={() => resolve("merged")} className="min-h-[40px] px-3 text-[13px] rounded-lg bg-primary text-white font-bold">ادغام انتخاب‌ها</button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => resolve("mine")} className="min-h-[40px] px-3 text-[13px] rounded-lg bg-primary text-white font-bold">نسخه‌ی من</button>
      </div>
    </Modal>
  );
}
