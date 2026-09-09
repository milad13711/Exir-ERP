"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocsIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { fetchForms, type FormItem, type FormStatus, type FormType } from "@/lib/api";
import { NewFormModal } from "@/components/forms/NewFormModal";
import { FormDetailModal } from "@/components/forms/FormDetailModal";
import { ModuleHelp } from "@/components/ui/ModuleHelp";

const STATUS_LABELS: Record<FormStatus, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CLOSED: "بسته‌شده" };
const STATUS_TONES: Record<FormStatus, "neutral" | "success" | "danger"> = { DRAFT: "neutral", PUBLISHED: "success", CLOSED: "danger" };
const TYPE_LABELS: Record<FormType, string> = { SURVEY: "نظرسنجی", QUIZ: "آزمون آنلاین", QUESTIONNAIRE: "پرسش‌نامه", REGISTRATION: "فرم ثبت‌نام" };

type StatusFilter = "همه" | FormStatus;

export default function FormsPage() {
  const [forms, setForms] = useState<FormItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [openFormId, setOpenFormId] = useState<string | null>(null);

  function reload() {
    fetchForms().then(setForms).catch(() => setForms([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!forms) return [];
    return forms.filter((f) => {
      const matchesStatus = statusFilter === "همه" || f.status === statusFilter;
      const matchesSearch = !search.trim() || f.title.includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [forms, search, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">فرم‌ساز</h1>
            <ModuleHelp code="forms" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">نظرسنجی، آزمون آنلاین، پرسش‌نامه یا فرم ثبت‌نام با لینک عمومی و قابل embed</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
          <PlusIcon className="w-4 h-4" />
          فرم جدید
        </button>
      </div>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی عنوان فرم..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "DRAFT", "PUBLISHED", "CLOSED"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-2">
        {forms === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">فرمی یافت نشد</div>
        ) : (
          filtered.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setOpenFormId(f.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < filtered.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <DocsIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">{f.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {TYPE_LABELS[f.type]} · {toPersianDigits(f._count?.submissions ?? 0)} پاسخ
                </div>
              </div>
              <Badge tone={STATUS_TONES[f.status]}>{STATUS_LABELS[f.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {newOpen && <NewFormModal onClose={() => setNewOpen(false)} onCreated={reload} />}
      {openFormId && <FormDetailModal formId={openFormId} onClose={() => setOpenFormId(null)} onChanged={reload} />}
    </div>
  );
}
