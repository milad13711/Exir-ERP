"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  CONF_LABELS, PRIORITY_LABELS, STATUS_LABELS, bulkArchive, downloadRegisterCsv, fetchCategories, fetchFolders, fetchLetters,
  type ArchiveFolder, type Category, type LetterFilters, type LetterListItem,
} from "@/lib/correspondence-api";
import { formatJalaliDate } from "@/lib/persian";
import { BTN_PRIMARY, BTN_SOFT, Empty, ErrorBox, INPUT, LABEL, LetterRow, Loading, Sheet, errText } from "./corr-ui";

const STATUS_QUICK: Record<string, string[]> = {
  INCOMING: ["REGISTERED", "REFERRED", "IN_PROGRESS", "ANSWERED", "CLOSED", "VOID"],
  OUTGOING: ["DRAFT", "PENDING_SIGNATURE", "RETURNED_FOR_EDIT", "ISSUED", "SENT", "DELIVERED", "REJECTED", "VOID"],
  INTERNAL: ["DRAFT", "PENDING_SIGNATURE", "RETURNED_FOR_EDIT", "ISSUED", "DELIVERED", "REJECTED", "VOID"],
  ALL: ["DRAFT", "PENDING_SIGNATURE", "ISSUED", "REGISTERED", "REFERRED", "IN_PROGRESS", "ANSWERED", "CLOSED", "VOID"],
};

type Chip = { key: keyof LetterFilters; label: string };

/** فهرست نامه با فیلتر، صفحه‌بندی مکان‌نما، انتخاب دسته‌جمعی برای بایگانی و خروجی دفتر ثبت. */
export function LetterList({ fixed, advanced = false, bulk = false, emptyText = "نامه‌ای یافت نشد" }: { fixed: LetterFilters; advanced?: boolean; bulk?: boolean; emptyText?: string }) {
  const [f, setF] = useState<LetterFilters>({});
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 350);
  const [items, setItems] = useState<LetterListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchCategories().then(setCats).catch(() => {});
  }, []);

  const merged: LetterFilters = { ...f, ...fixed, q: dq.trim() || undefined };
  const key = JSON.stringify(merged);

  useEffect(() => {
    const my = ++seq.current;
    // بازنشانی هنگام تغییر فیلتر: وضعیت بارگذاری پیش از درخواست
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    setError(null);
    setSel(new Set());
    fetchLetters(JSON.parse(key) as LetterFilters)
      .then((r) => {
        if (seq.current !== my) return;
        setItems(r.items);
        setCursor(r.nextCursor);
      })
      .catch((e) => seq.current === my && setError(errText(e, "بارگذاری ناموفق بود")));
  }, [key, tick]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await fetchLetters(JSON.parse(key) as LetterFilters, cursor);
      setItems((p) => [...(p ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, key]);

  const set = (patch: Partial<LetterFilters>) => setF((p) => ({ ...p, ...patch }));
  const quick = STATUS_QUICK[fixed.type ?? "ALL"] ?? STATUS_QUICK.ALL;
  const chips: Chip[] = [];
  const add = (k: keyof LetterFilters, label: string | undefined) => label && chips.push({ key: k, label });
  add("number", f.number && `شماره: ${f.number}`);
  add("status", f.status && `وضعیت: ${f.status.split(",").map((s) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s).join("، ")}`);
  add("categoryId", f.categoryId && `دسته: ${cats.find((c) => c.id === f.categoryId)?.name ?? ""}`);
  add("priority", f.priority && `فوریت: ${PRIORITY_LABELS[f.priority as keyof typeof PRIORITY_LABELS]}`);
  add("confidentiality", f.confidentiality && `محرمانگی: ${CONF_LABELS[f.confidentiality as keyof typeof CONF_LABELS]}`);
  add("dateFrom", f.dateFrom && `از ${formatJalaliDate(f.dateFrom)}`);
  add("dateTo", f.dateTo && `تا ${formatJalaliDate(f.dateTo)}`);
  add("sender", f.sender && `فرستنده: ${f.sender}`);
  add("recipient", f.recipient && `گیرنده: ${f.recipient}`);
  add("mine", f.mine ? "مرتبط با من" : undefined);
  add("awaitingReply", f.awaitingReply ? "بدون پاسخ" : undefined);
  add("responseOverdue", f.responseOverdue ? "مهلت پاسخ گذشته" : undefined);

  return (
    <div className="flex flex-col gap-3">
      <SearchInput className="max-w-[420px]" value={q} onChange={setQ} placeholder="جست‌وجوی موضوع، متن، شماره (دبیرخانه یا اصلی)، فرستنده…" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => set({ status: undefined })} className={clsx("shrink-0 text-[12px] font-semibold px-3.5 py-2 min-h-[40px] rounded-[10px] border cursor-pointer", !f.status ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}>همه</button>
        {quick.map((s) => (
          <button key={s} onClick={() => set({ status: f.status === s ? undefined : s })} className={clsx("shrink-0 text-[12px] font-semibold px-3.5 py-2 min-h-[40px] rounded-[10px] border cursor-pointer", f.status === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}>
            {STATUS_LABELS[s as keyof typeof STATUS_LABELS]}
          </button>
        ))}
      </div>

      {advanced ? (
        <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><label className={LABEL}>شماره (دبیرخانه یا نامه‌ی اصلی)</label><input value={f.number ?? ""} onChange={(e) => set({ number: e.target.value || undefined })} className={INPUT} dir="ltr" /></div>
          <div>
            <label className={LABEL}>نوع</label>
            <select value={f.type ?? ""} onChange={(e) => set({ type: e.target.value || undefined })} className={INPUT}>
              <option value="">همه</option><option value="INCOMING">وارده</option><option value="OUTGOING">صادره</option><option value="INTERNAL">داخلی</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>دسته</label>
            <select value={f.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || undefined })} className={INPUT}>
              <option value="">همه</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>فوریت</label>
            <select value={f.priority ?? ""} onChange={(e) => set({ priority: e.target.value || undefined })} className={INPUT}>
              <option value="">همه</option>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>محرمانگی</label>
            <select value={f.confidentiality ?? ""} onChange={(e) => set({ confidentiality: e.target.value || undefined })} className={INPUT}>
              <option value="">همه</option>{Object.entries(CONF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>تاریخ بر اساس</label>
            <select value={f.dateField ?? "letterDate"} onChange={(e) => set({ dateField: e.target.value })} className={INPUT}>
              <option value="letterDate">تاریخ نامه</option><option value="externalDate">تاریخ نامه‌ی اصلی (وارده)</option><option value="receivedAt">تاریخ دریافت</option><option value="createdAt">تاریخ ثبت در سامانه</option>
            </select>
          </div>
          <div><label className={LABEL}>از تاریخ</label><JalaliDateInput value={f.dateFrom ?? ""} onChange={(v) => set({ dateFrom: v || undefined })} /></div>
          <div><label className={LABEL}>تا تاریخ</label><JalaliDateInput value={f.dateTo ?? ""} onChange={(v) => set({ dateTo: v || undefined })} /></div>
          <div><label className={LABEL}>فرستنده</label><input value={f.sender ?? ""} onChange={(e) => set({ sender: e.target.value || undefined })} className={INPUT} /></div>
          <div><label className={LABEL}>گیرنده</label><input value={f.recipient ?? ""} onChange={(e) => set({ recipient: e.target.value || undefined })} className={INPUT} /></div>
          <label className="flex items-center gap-2 text-[13px] min-h-[40px] cursor-pointer"><input type="checkbox" className="w-5 h-5" checked={!!f.mine} onChange={(e) => set({ mine: e.target.checked || undefined })} />مرتبط با من</label>
          <label className="flex items-center gap-2 text-[13px] min-h-[40px] cursor-pointer"><input type="checkbox" className="w-5 h-5" checked={!!f.awaitingReply} onChange={(e) => set({ awaitingReply: e.target.checked || undefined })} />وارده‌ی بدون پاسخ</label>
          <label className="flex items-center gap-2 text-[13px] min-h-[40px] cursor-pointer"><input type="checkbox" className="w-5 h-5" checked={!!f.responseOverdue} onChange={(e) => set({ responseOverdue: e.target.checked || undefined })} />مهلت پاسخ گذشته</label>
          <div>
            <label className={LABEL}>بایگانی</label>
            <select value={f.archived ?? "exclude"} onChange={(e) => set({ archived: e.target.value as LetterFilters["archived"] })} className={INPUT}>
              <option value="exclude">بدون بایگانی</option><option value="all">همه</option><option value="only">فقط بایگانی</option>
            </select>
          </div>
        </Card>
      ) : null}

      {chips.length ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button key={c.key} onClick={() => set({ [c.key]: undefined } as Partial<LetterFilters>)} className="text-[12px] bg-primary-soft text-primary rounded-lg px-2.5 py-1.5 min-h-[36px] cursor-pointer">{c.label} ×</button>
          ))}
          <button onClick={() => setF({})} className="text-[12px] text-muted underline min-h-[36px] cursor-pointer">پاک‌کردن همه</button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        {bulk && sel.size ? <button className={BTN_PRIMARY} onClick={() => setArchiveOpen(true)}>بایگانی {sel.size} نامه</button> : null}
        <button
          className={`${BTN_SOFT} ms-auto`}
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try { await downloadRegisterCsv(merged); } catch (e) { setError(errText(e)); } finally { setExporting(false); }
          }}
        >
          {exporting ? "در حال تهیه…" : "خروجی دفتر ثبت (CSV)"}
        </button>
      </div>

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <Card className="overflow-hidden">
        {items === null && !error ? <Loading /> : items && items.length === 0 ? <Empty>{emptyText}</Empty> : (
          items?.map((l) => (
            <LetterRow key={l.id} l={l} selected={sel.has(l.id)} onSelect={bulk ? (on) => setSel((p) => { const n = new Set(p); if (on) n.add(l.id); else n.delete(l.id); return n; }) : undefined} />
          ))
        )}
      </Card>
      {cursor ? <button className={`${BTN_SOFT} self-center`} onClick={more} disabled={loadingMore}>{loadingMore ? "در حال بارگذاری…" : "نمایش بیشتر"}</button> : null}
      {archiveOpen ? <BulkArchive ids={[...sel]} onClose={() => setArchiveOpen(false)} onDone={() => { setArchiveOpen(false); setTick((t) => t + 1); }} /> : null}
    </div>
  );
}

function BulkArchive({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    fetchFolders().then(setFolders).catch(() => {});
  }, []);
  return (
    <Sheet title={`بایگانی ${ids.length} نامه`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={LABEL}>پوشه‌ی بایگانی</label>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={INPUT}>
            <option value="">بدون پوشه</option>
            {folders.map((x) => <option key={x.id} value={x.id}>{x.name}{x.retentionDays ? ` (نگهداری ${x.retentionDays} روز)` : ""}</option>)}
          </select>
        </div>
        {msg ? <ErrorBox>{msg}</ErrorBox> : null}
        <div className="flex justify-end gap-2">
          <button className={BTN_SOFT} onClick={onClose}>انصراف</button>
          <button
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await bulkArchive(ids, { folderId: folderId || undefined });
                const failed = r.results.filter((x) => !x.ok);
                if (failed.length) { setMsg(`${failed.length} مورد بایگانی نشد: ${failed[0].error ?? ""}`); if (r.archived) setTimeout(onDone, 1800); } else onDone();
              } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
            }}
          >
            {busy ? "…" : "بایگانی"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
