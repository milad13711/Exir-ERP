"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { PlusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { LetterheadDesigner } from "@/components/correspondence/LetterheadDesigner";
import {
  createLetterhead,
  deleteLetterhead,
  duplicateLetterhead,
  fetchLetterhead,
  fetchLetterheadMeta,
  fetchLetterheads,
  setDefaultLetterhead,
  type Letterhead,
  type LetterheadMeta,
} from "@/lib/correspondence-docs-api";

export default function LetterheadsPage() {
  const [items, setItems] = useState<Letterhead[] | null>(null);
  const [meta, setMeta] = useState<LetterheadMeta | null>(null);
  const [editing, setEditing] = useState<Letterhead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const reload = useCallback(() => {
    fetchLetterheads().then(setItems).catch((e: Error) => { setItems([]); setError(e.message); });
  }, []);
  useEffect(() => {
    reload();
    fetchLetterheadMeta().then(setMeta).catch((e: Error) => setError(e.message));
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "عملیات ناموفق بود");
    }
  }

  async function open(id: string) {
    setError(null);
    try {
      setEditing(await fetchLetterhead(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "بارگذاری سربرگ ناموفق بود");
    }
  }

  if (editing && meta) {
    return (
      <div className="p-4 lg:p-6 max-w-[1300px] mx-auto">
        <LetterheadDesigner
          key={editing.id}
          letterhead={editing}
          meta={meta}
          onSaved={(l) => setEditing(l)}
          onBack={() => { setEditing(null); reload(); }}
        />
      </div>
    );
  }

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <h1 className="text-xl font-extrabold">سربرگ‌های نامه</h1>
      <p className="text-[13.5px] text-muted mt-1">تصویر سربرگ را بارگذاری کنید و جایگاه شماره، تاریخ، پیوست، موضوع، متن، امضا و QR را روی برگه تنظیم کنید.</p>
      {error && <div className="mt-3 text-[12.5px] rounded-lg px-3 py-2 bg-red-50 text-red-700">{error}</div>}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim().length < 2) return;
          void run(async () => {
            const l = await createLetterhead({ name: newName.trim() });
            setNewName("");
            setEditing(await fetchLetterhead(l.id));
          });
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="نام سربرگ جدید (مثلاً: سربرگ رسمی شرکت)"
          className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary"
        />
        <button type="submit" className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
          <PlusIcon className="w-4 h-4" />
          سربرگ جدید
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-2.5">
        {items === null && <div className="text-muted text-[13px]">در حال بارگذاری…</div>}
        {items?.length === 0 && <div className="text-muted text-[13px]">هنوز سربرگی ساخته نشده است.</div>}
        {items?.map((l) => (
          <div key={l.id} className={clsx("bg-surface border border-border rounded-xl p-3.5 flex items-center gap-3 flex-wrap", !l.isActive && "opacity-60")}>
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-[14px]">{l.name}</b>
                {l.isDefault && <Badge tone="success">پیش‌فرض</Badge>}
                {!l.isActive && <Badge tone="neutral">غیرفعال</Badge>}
              </div>
              <div className="text-[12px] text-muted mt-0.5">
                {l.pageSize} — {l.orientation === "portrait" ? "عمودی" : "افقی"} — {l.hasImage ? "دارای تصویر" : "بدون تصویر"}
                {l.departmentId ? ` — واحد: ${l.departmentId}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => void open(l.id)} className="text-[12px] font-bold border border-border rounded-lg px-3 py-1.5 cursor-pointer">طراحی</button>
              {!l.isDefault && l.isActive && (
                <button type="button" onClick={() => void run(() => setDefaultLetterhead(l.id))} className="text-[12px] font-bold border border-border rounded-lg px-3 py-1.5 cursor-pointer">پیش‌فرض‌کردن</button>
              )}
              <button type="button" onClick={() => void run(() => duplicateLetterhead(l.id))} className="text-[12px] font-bold border border-border rounded-lg px-3 py-1.5 cursor-pointer">کپی</button>
              <button
                type="button"
                onClick={() => { if (window.confirm(`سربرگ «${l.name}» حذف شود؟`)) void run(() => deleteLetterhead(l.id)); }}
                className="text-[12px] font-bold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer"
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
