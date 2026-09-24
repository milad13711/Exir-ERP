"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { ChevronDownIcon, TrashIcon, PlusIcon, TasksIcon, ClipboardCheckIcon, CheckIcon } from "@/components/icons";
import { formatJalaliFull, toPersianDigits } from "@/lib/persian";
import {
  fetchDailyChecklist,
  fetchDailyChecklistSubordinates,
  createDailyChecklistItem,
  updateDailyChecklistItem,
  deleteDailyChecklistItem,
  createDailyChecklistTask,
  generateDailyChecklistReport,
  ApiError,
  type DailyChecklistItem,
  type DailyChecklistSubordinate,
} from "@/lib/api";

/** تاریخ محلی (نه UTC) به شکل «YYYY-MM-DD» — همان قرارداد ورودی‌های تاریخ در این پروژه. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ویجت داشبورد «لیست کارهای روزانه» — ظاهر یادداشت چسبان. هر پرسنل چک‌لیست امروزِ
 * خودش را می‌بیند؛ مدیر می‌تواند با سوییچ بالا، چک‌لیست هر یک از زیردستانش را هم
 * ببیند و برایش آیتم اضافه کند. کاملاً موبایل‌محور — کارت تمام‌عرض، دکمه‌های بزرگ.
 */
export function DailyChecklistWidget() {
  const date = useMemo(() => todayIso(), []);
  const [subordinates, setSubordinates] = useState<DailyChecklistSubordinate[]>([]);
  const [viewUserId, setViewUserId] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<DailyChecklistItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchDailyChecklistSubordinates().then(setSubordinates).catch(() => setSubordinates([]));
  }, []);

  function reload() {
    fetchDailyChecklist(date, viewUserId).then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, [date, viewUserId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await createDailyChecklistItem({ title: newTitle.trim(), date, forUserId: viewUserId });
      setNewTitle("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن ناموفق بود");
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(item: DailyChecklistItem) {
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) ?? prev);
    try {
      await updateDailyChecklistItem(item.id, { done: !item.done });
    } catch {
      reload();
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این مورد حذف شود؟")) return;
    await deleteDailyChecklistItem(id);
    reload();
  }

  async function handleGenerateReport() {
    setGenerating(true);
    setReportMsg(null);
    setError(null);
    try {
      await generateDailyChecklistReport(date, viewUserId);
      setReportMsg("گزارش امروز با موفقیت در ماژول گزارش‌ها ثبت شد ✓");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت گزارش ناموفق بود");
    } finally {
      setGenerating(false);
    }
  }

  const doneCount = items?.filter((i) => i.done).length ?? 0;
  const currentName = viewUserId ? subordinates.find((s) => s.userId === viewUserId)?.name : "خودم";

  return (
    <div
      className="relative rounded-2xl p-4 sm:p-5 mb-5 shadow-[0_10px_28px_-14px_rgba(120,98,10,0.45)] border border-[#f0dfa0]"
      style={{ background: "linear-gradient(180deg, #fff9dd 0%, #fef2b8 100%)" }}
    >
      {/* سنجاق تزئینی بالای یادداشت */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-4.5 h-4.5 rounded-full bg-danger shadow-[0_2px_4px_rgba(0,0,0,0.25)] border-2 border-white z-10" />

      <div className="flex items-start justify-between gap-3 flex-wrap mb-3 pt-2">
        <div>
          <div className="text-[14.5px] font-extrabold text-[#5c4a10]">لیست کارهای امروز</div>
          <div className="text-[11.5px] text-[#8a7530] mt-0.5">{formatJalaliFull()}</div>
        </div>
        {subordinates.length > 0 && (
          <select
            value={viewUserId ?? ""}
            onChange={(e) => setViewUserId(e.target.value || undefined)}
            className="text-[12px] font-bold bg-white/70 border border-[#e6d18a] rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value="">چک‌لیست خودم</option>
            {subordinates.map((s) => (
              <option key={s.userId} value={s.userId}>
                چک‌لیست {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {items === null ? (
        <div className="text-center text-[#8a7530] text-[12.5px] py-6">در حال بارگذاری...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-[#8a7530] text-[12.5px] py-4">
          {viewUserId ? `${currentName} امروز کاری ثبت نکرده` : "هنوز کاری برای امروز ثبت نکرده‌اید"}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mb-3">
          <div className="text-[11px] text-[#8a7530] mb-1">
            {toPersianDigits(doneCount)} از {toPersianDigits(items.length)} انجام شد
          </div>
          {items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div key={item.id} className="bg-white/60 rounded-xl border border-[#eddca0] overflow-hidden">
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <button
                    onClick={() => toggleDone(item)}
                    aria-label="تیک انجام‌شده"
                    className={clsx(
                      "w-5 h-5 rounded-md shrink-0 flex items-center justify-center border-2 cursor-pointer transition-colors",
                      item.done ? "bg-success border-success" : "border-[#d8c374] bg-white",
                    )}
                  >
                    {item.done ? <CheckIcon className="w-3 h-3 text-white" strokeWidth={3} /> : null}
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className={clsx(
                      "flex-1 min-w-0 text-right text-[13px] font-semibold cursor-pointer truncate",
                      item.done ? "text-[#a89757] line-through" : "text-[#4a3c0d]",
                    )}
                  >
                    {item.title}
                  </button>
                  {item.taskId && <TasksIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                  <button
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[#8a7530] shrink-0 cursor-pointer"
                    aria-label="جزئیات"
                  >
                    <ChevronDownIcon className={clsx("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
                  </button>
                </div>

                {expanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-[#eddca0] bg-white/50 flex flex-col gap-2.5">
                    <input
                      key={`t-${item.id}-${item.title}`}
                      defaultValue={item.title}
                      aria-label="عنوان آیتم"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (!v) {
                          e.target.value = item.title;
                        } else if (v !== item.title) {
                          updateDailyChecklistItem(item.id, { title: v }).then(reload);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="text-[13px] font-semibold outline-none bg-white border border-[#e6d18a] rounded-lg px-2.5 py-2"
                    />
                    <textarea
                      defaultValue={item.description ?? ""}
                      placeholder="توضیح بیشتر (اختیاری)..."
                      rows={2}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (item.description ?? "")) {
                          updateDailyChecklistItem(item.id, { description: e.target.value.trim() }).then(reload);
                        }
                      }}
                      className="text-[12.5px] outline-none bg-white border border-[#e6d18a] rounded-lg px-2.5 py-2 resize-none"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {!item.taskId ? (
                        <button
                          onClick={() => createDailyChecklistTask(item.id).then(reload)}
                          className="flex items-center gap-1 text-[11.5px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                        >
                          <ClipboardCheckIcon className="w-3.5 h-3.5" />
                          ایجاد وظیفه
                        </button>
                      ) : (
                        <span className="text-[11.5px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg">
                          وظیفه ساخته شد
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="flex items-center gap-1 text-[11.5px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer mr-auto"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                        حذف
                      </button>
                    </div>
                    <AttachmentsSection entityType="DailyChecklistItem" entityId={item.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2 mb-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={viewUserId ? `افزودن کار برای ${currentName}...` : "افزودن کار جدید..."}
          className="flex-1 text-[12.5px] outline-none bg-white/70 border border-[#e6d18a] rounded-xl px-3.5 py-2.5"
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="w-9 h-9 rounded-xl bg-[#c9a227] text-white flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
          aria-label="افزودن"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </form>

      {error && <div className="text-[12px] text-danger font-semibold mb-2">{error}</div>}
      {reportMsg && <div className="text-[12px] text-success font-semibold mb-2">{reportMsg}</div>}

      {items && items.length > 0 && (
        <button
          onClick={handleGenerateReport}
          disabled={generating}
          className="w-full py-2.5 rounded-xl border-[1.5px] border-dashed border-[#c9a227] text-[12.5px] font-bold text-[#5c4a10] cursor-pointer disabled:opacity-50"
        >
          {generating ? "در حال ثبت..." : "ثبت گزارش روزانه از روی همین چک‌لیست"}
        </button>
      )}
    </div>
  );
}
