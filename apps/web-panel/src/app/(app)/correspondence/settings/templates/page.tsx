"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { PlusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { TemplateEditor } from "@/components/correspondence/TemplateEditor";
import {
  LETTER_TYPE_LABELS,
  deleteCorrTemplate,
  fetchCorrTemplates,
  fetchLetterheads,
  fetchTemplatePlaceholders,
  type CorrLetterType,
  type CorrTemplate,
  type Letterhead,
  type TemplatePlaceholder,
} from "@/lib/correspondence-docs-api";

export default function TemplatesPage() {
  const [items, setItems] = useState<CorrTemplate[] | null>(null);
  const [letterheads, setLetterheads] = useState<Letterhead[]>([]);
  const [placeholders, setPlaceholders] = useState<TemplatePlaceholder[]>([]);
  const [filter, setFilter] = useState<"ALL" | CorrLetterType>("ALL");
  const [editing, setEditing] = useState<CorrTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchCorrTemplates().then(setItems).catch((e: Error) => { setItems([]); setError(e.message); });
  }, []);
  useEffect(() => {
    reload();
    fetchLetterheads().then(setLetterheads).catch(() => setLetterheads([]));
    fetchTemplatePlaceholders().then(setPlaceholders).catch(() => setPlaceholders([]));
  }, [reload]);

  const shown = (items ?? []).filter((t) => filter === "ALL" || t.letterType === filter);

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">قالب‌های متن نامه</h1>
          <p className="text-[13.5px] text-muted mt-1">متن‌های آماده برای انواع نامه (صادره، دعوت‌نامه، درخواست، ابلاغ و …) با جانشین‌هایی مثل {"{{recipientName}}"}.</p>
        </div>
        <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
          <PlusIcon className="w-4 h-4" />
          قالب جدید
        </button>
      </div>
      {error && <div className="mt-3 text-[12.5px] rounded-lg px-3 py-2 bg-red-50 text-red-700">{error}</div>}

      <div className="mt-4 flex gap-1.5 flex-wrap">
        {(["ALL", "OUTGOING", "INCOMING", "INTERNAL", "ANY"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={clsx("text-[12px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer", filter === k ? "bg-primary text-white border-primary" : "border-border text-ink-soft")}
          >
            {k === "ALL" ? "همه" : LETTER_TYPE_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {items === null && <div className="text-muted text-[13px]">در حال بارگذاری…</div>}
        {items && shown.length === 0 && <div className="text-muted text-[13px]">قالبی یافت نشد.</div>}
        {shown.map((t) => (
          <div key={t.id} className={clsx("bg-surface border border-border rounded-xl p-3.5 flex items-center gap-3 flex-wrap", !t.isActive && "opacity-60")}>
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-[14px]">{t.name}</b>
                <Badge tone="primary">{LETTER_TYPE_LABELS[t.letterType]}</Badge>
                {!t.isActive && <Badge tone="neutral">غیرفعال</Badge>}
              </div>
              {t.subject && <div className="text-[12px] text-muted mt-0.5">موضوع: {t.subject}</div>}
            </div>
            <button type="button" onClick={() => setEditing(t)} className="text-[12px] font-bold border border-border rounded-lg px-3 py-1.5 cursor-pointer">ویرایش</button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`قالب «${t.name}» حذف شود؟`)) return;
                deleteCorrTemplate(t.id).then(reload).catch((e: Error) => setError(e.message));
              }}
              className="text-[12px] font-bold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer"
            >
              حذف
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title={editing === "new" ? "قالب جدید" : "ویرایش قالب"} onClose={() => setEditing(null)} width="max-w-[820px]">
          <TemplateEditor
            template={editing === "new" ? null : editing}
            letterheads={letterheads}
            placeholders={placeholders}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); reload(); }}
          />
        </Modal>
      )}
    </div>
  );
}
