import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ListSkeleton } from "@/components/ui/EmptyState";
import { BTN_GHOST, SELECT } from "@/components/ui/styles";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchLicenseEvents, type LicenseEventRow } from "@/lib/licenses-api";

const KIND_LABEL = { ADMIN: "ادمین", PUBLIC: "API عمومی", CHECKIN: "check-in", SYSTEM: "سیستم" } as const;
const KIND_TONE = { ADMIN: "primary", PUBLIC: "neutral", CHECKIN: "accent", SYSTEM: "neutral" } as const;

/** ردپای فقط‌افزودنی: هر عملیات ادمین + هر پاسخ ناموفق API عمومی (و نمونه‌ای از موفق‌ها). */
export function LicenseEventsPanel() {
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: LicenseEventRow[] } | null>(null);
  useEffect(() => { fetchLicenseEvents({ kind: kind || undefined, page, pageSize: 50 }).then(setData).catch(() => setData({ total: 0, items: [] })); }, [kind, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  return (
    <div className="flex flex-col gap-3 mt-5">
      <div className="flex items-center gap-2">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className={SELECT}>
          <option value="">همه‌ی رویدادها</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-[12px] text-muted">{data ? toPersianDigits(data.total) : "…"} رویداد</span>
      </div>
      {data === null ? <ListSkeleton count={4} height="h-14" /> : data.items.length === 0 ? <EmptyState>رویدادی ثبت نشده است</EmptyState> : (
        <Card className="divide-y divide-border">
          {data.items.map((e) => (
            <div key={e.id} className="px-4 py-3 flex items-start gap-3 flex-wrap text-[12.5px]">
              <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
              <span className="font-bold" dir="ltr">{e.action}</span>
              {e.code ? <span className="font-mono text-muted" dir="ltr">{e.code}</span> : null}
              {e.licenseKeyHint ? <span className="font-mono text-muted" dir="ltr">…{e.licenseKeyHint}</span> : null}
              {e.actorLabel ? <span className="text-ink-soft">{e.actorLabel}</span> : null}
              {e.ip ? <span className="text-muted" dir="ltr">{e.ip}</span> : null}
              {e.detail && Object.keys(e.detail).length ? <span className="text-muted break-all" dir="ltr">{JSON.stringify(e.detail)}</span> : null}
              <span className="ms-auto text-muted">{formatJalaliDateTime(e.createdAt)}</span>
            </div>
          ))}
        </Card>
      )}
      <div className="flex items-center gap-2 justify-center">
        <button className={BTN_GHOST} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
        <span className="text-[12px] text-muted">{toPersianDigits(page)} / {toPersianDigits(pages)}</span>
        <button className={BTN_GHOST} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
      </div>
    </div>
  );
}
