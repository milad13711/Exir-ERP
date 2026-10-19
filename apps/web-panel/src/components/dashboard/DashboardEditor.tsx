"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import clsx from "clsx";
import { ChevronDownIcon, CloseIcon, DragHandleIcon } from "@/components/icons";
import {
  ApiError,
  fetchCompanyDashboardLayout,
  resetCompanyDashboardLayout,
  resetMyDashboardLayout,
  saveCompanyDashboardLayout,
  saveMyDashboardLayout,
  type DashboardCompanyItem,
  type DashboardMyLayout,
  type DashboardWidgetSize,
} from "@/lib/api";

const SIZE_LABEL: Record<DashboardWidgetSize, string> = { S: "کوچک", M: "متوسط", L: "بزرگ", FULL: "تمام‌عرض" };
const VARIANT_LABEL: Record<string, string> = { card: "کارت", compact: "فشرده", list: "فهرست", chart: "نمودار", default: "پیش‌فرض" };

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * جابه‌جایی با کشیدن (ماوس، لمس و قلم) فقط از روی دستگیره: pointer events + touch-action:none روی دستگیره،
 * پس اسکرول صفحه با لمس بقیه‌ی ردیف مختل نمی‌شود. هنگام کشیدن نزدیک لبه‌ی لیست، اسکرول خودکار.
 */
function useDragReorder(listRef: RefObject<HTMLUListElement | null>, count: number, onMove: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const onPointerDown = (index: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(index);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const from = dragIndex;
    const list = listRef.current;
    if (from === null || !list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    if (rows.length !== count) return;
    const y = e.clientY;
    let target = from;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        target = i;
        break;
      }
    }
    if (target !== from) {
      onMove(from, target);
      setDragIndex(target);
    }
    // اسکرول خودکار کادر لیست
    const scroller = list.closest("[data-scroll]") as HTMLElement | null;
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      if (y < sr.top + 36) scroller.scrollBy({ top: -14 });
      else if (y > sr.bottom - 36) scroller.scrollBy({ top: 14 });
    }
  };

  const end = () => {
    setDragIndex(null);
  };

  return { dragIndex, onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
}

type Row = { key: string; title: string; enabled: boolean; size?: DashboardWidgetSize; variant?: string; sizes?: DashboardWidgetSize[]; variants?: string[] };

function RowControls({ rows, setRows, personal }: { rows: Row[]; setRows: (r: Row[]) => void; personal: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useDragReorder(listRef, rows.length, (from, to) => setRows(move(rows, from, to)));
  const patch = (i: number, p: Partial<Row>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const selectCls = "min-w-0 flex-1 min-h-10 rounded-lg border border-border bg-surface px-2 text-[12px] font-bold text-ink-soft";

  return (
    <ul ref={listRef} className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li
          key={r.key}
          className={clsx(
            "rounded-xl border bg-surface p-2.5 min-w-0 transition-shadow",
            drag.dragIndex === i ? "border-primary shadow-lg" : "border-border",
            !r.enabled && "opacity-70",
          )}
        >
          <div className="flex items-center gap-1.5">
            <span
              role="button"
              tabIndex={-1}
              aria-label={`جابه‌جایی «${r.title}» با کشیدن`}
              onPointerDown={drag.onPointerDown(i)}
              onPointerMove={drag.onPointerMove}
              onPointerUp={drag.onPointerUp}
              onPointerCancel={drag.onPointerCancel}
              style={{ touchAction: "none" }}
              className="w-10 h-10 shrink-0 flex items-center justify-center text-muted cursor-grab active:cursor-grabbing select-none"
            >
              <DragHandleIcon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0 text-[13px] font-bold break-words">{r.title}</span>
            <button
              type="button"
              onClick={() => setRows(move(rows, i, i - 1))}
              disabled={i === 0}
              aria-label={`بالا بردن «${r.title}»`}
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-ink-soft disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <ChevronDownIcon className="w-4 h-4 rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => setRows(move(rows, i, i + 1))}
              disabled={i === rows.length - 1}
              aria-label={`پایین بردن «${r.title}»`}
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-ink-soft disabled:opacity-30 cursor-pointer disabled:cursor-default"
            >
              <ChevronDownIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={r.enabled}
              aria-label={`${personal ? "نمایش" : "فعال بودن"} «${r.title}»`}
              onClick={() => patch(i, { enabled: !r.enabled })}
              className="w-11 h-10 shrink-0 flex items-center justify-center cursor-pointer"
            >
              <span className={clsx("w-9 h-5 rounded-full relative transition-colors", r.enabled ? "bg-primary" : "bg-slate-300")}>
                <span className={clsx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", r.enabled ? "right-0.5" : "right-[18px]")} />
              </span>
            </button>
          </div>
          {!personal && r.enabled && r.sizes && r.variants ? (
            <div className="flex items-center gap-2 mt-2 ps-1">
              {r.sizes.length > 1 ? (
                <select aria-label={`اندازه‌ی «${r.title}»`} value={r.size} onChange={(e) => patch(i, { size: e.target.value as DashboardWidgetSize })} className={selectCls}>
                  {r.sizes.map((s) => (
                    <option key={s} value={s}>
                      اندازه: {SIZE_LABEL[s]}
                    </option>
                  ))}
                </select>
              ) : null}
              {r.variants.length > 1 ? (
                <select aria-label={`حالت نمایش «${r.title}»`} value={r.variant} onChange={(e) => patch(i, { variant: e.target.value })} className={selectCls}>
                  {r.variants.map((v) => (
                    <option key={v} value={v}>
                      حالت: {VARIANT_LABEL[v] ?? v}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DashboardEditor({ layout, onClose, onSaved }: { layout: DashboardMyLayout; onClose: () => void; onSaved: () => void }) {
  const canCompany = layout.canConfigureCompany;
  const [tab, setTab] = useState<"me" | "company">("me");
  const [myRows, setMyRows] = useState<Row[]>(() => layout.personal.map((p) => ({ key: p.key, title: p.title, enabled: !p.hidden })));
  const [companyRows, setCompanyRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapCompany = useCallback(
    (items: DashboardCompanyItem[]): Row[] =>
      items.map((i) => ({ key: i.key, title: i.def.title, enabled: i.enabled, size: i.size, variant: i.variant, sizes: i.def.sizes, variants: i.def.variants })),
    [],
  );

  useEffect(() => {
    if (tab !== "company" || companyRows) return;
    fetchCompanyDashboardLayout()
      .then((c) => setCompanyRows(mapCompany(c.items)))
      .catch((e) => setError(e instanceof ApiError ? e.message : "بارگذاری تنظیمات شرکت ناموفق بود"));
  }, [tab, companyRows, mapCompany]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره ناموفق بود");
      setBusy(false);
    }
  }

  const save = () =>
    run(() =>
      tab === "me"
        ? saveMyDashboardLayout(myRows.map((r) => ({ key: r.key, hidden: !r.enabled })))
        : saveCompanyDashboardLayout((companyRows ?? []).map((r) => ({ key: r.key, enabled: r.enabled, size: r.size!, variant: r.variant! }))),
    );
  const reset = () => {
    if (!window.confirm(tab === "me" ? "چیدمان شخصی شما به حالت پیش‌فرض شرکت برگردد؟" : "چیدمان شرکت به پیش‌فرض سیستم برگردد؟ (شخصی‌سازی کاربران هم تابع آن می‌شود)")) return;
    return run(() => (tab === "me" ? resetMyDashboardLayout() : resetCompanyDashboardLayout()));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ویرایش داشبورد"
        className="bg-surface w-full sm:max-w-[600px] max-h-[92dvh] sm:max-h-[86dvh] rounded-t-2xl sm:rounded-2xl border border-border shadow-xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-[15px] font-extrabold">ویرایش داشبورد</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="w-10 h-10 rounded-lg flex items-center justify-center text-muted hover:bg-primary-soft hover:text-primary cursor-pointer">
            <CloseIcon className="w-4.5 h-4.5" />
          </button>
        </div>

        {canCompany ? (
          <div className="grid grid-cols-2 gap-1 p-1 mx-4 mt-3 rounded-xl bg-slate-100 shrink-0" role="tablist">
            {(["me", "company"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={clsx("min-h-10 rounded-lg text-[12.5px] font-bold cursor-pointer", tab === t ? "bg-surface text-primary shadow-sm" : "text-ink-soft")}
              >
                {t === "me" ? "چیدمان من" : "کل شرکت"}
              </button>
            ))}
          </div>
        ) : null}

        <div data-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
          <p className="text-[12px] text-muted mb-3 leading-6">
            {tab === "me"
              ? "ویجت‌ها را پنهان کنید یا ترتیبشان را عوض کنید (با کشیدن دستگیره یا دکمه‌های بالا/پایین). فقط ویجت‌هایی که مدیر فعال کرده و به آن‌ها دسترسی دارید دیده می‌شوند."
              : "این چیدمان پیش‌فرض همه‌ی اعضای شرکت است. هر عضو فقط ویجت‌هایی را می‌بیند که ماژولش نصب است و به آن دسترسی دارد."}
          </p>
          {tab === "me" ? (
            myRows.length === 0 ? (
              <div className="text-center text-sm text-muted py-6">ویجتی برای شما فعال نیست.</div>
            ) : (
              <RowControls rows={myRows} setRows={setMyRows} personal />
            )
          ) : companyRows ? (
            <RowControls rows={companyRows} setRows={setCompanyRows} personal={false} />
          ) : (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[62px] rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error ? <div className="text-[12px] text-danger font-semibold mb-2">{error}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || (tab === "company" && !companyRows)}
              className="flex-1 min-w-[120px] min-h-11 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? "در حال ذخیره..." : "ذخیره"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="flex-1 min-w-[120px] min-h-11 rounded-xl border border-border text-[12.5px] font-bold text-ink-soft cursor-pointer disabled:opacity-50"
            >
              بازنشانی به پیش‌فرض
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
