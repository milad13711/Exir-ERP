import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons";
import {
  fetchStageTemplates,
  createStageTemplate,
  updateStageTemplate,
  deleteStageTemplate,
  type StageTemplate,
} from "@/lib/api";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

function TemplateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: StageTemplate;
  onSave: (name: string, items: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [items, setItems] = useState<string[]>(initial?.items.map((i) => i.title) ?? [""]);
  const [saving, setSaving] = useState(false);

  function updateItem(i: number, value: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? value : it)));
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!name.trim() || clean.length === 0) return;
    setSaving(true);
    try {
      await onSave(name.trim(), clean);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام الگو" className={inputClass} />
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted w-4 text-center shrink-0">{i + 1}</span>
            <input
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
              placeholder="عنوان مرحله"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
            >
              <TrashIcon className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, ""])}
          className="self-start text-[11px] font-bold text-primary mt-0.5"
        >
          + افزودن مرحله
        </button>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
          انصراف
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || items.every((i) => !i.trim())}
          className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        >
          ذخیره
        </button>
      </div>
    </form>
  );
}

export function StageTemplatesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [templates, setTemplates] = useState<StageTemplate[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    fetchStageTemplates().then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(reload, []);

  async function handleCreate(name: string, items: string[]) {
    await createStageTemplate({ name, items: items.map((title) => ({ title })) });
    setAddOpen(false);
    reload();
    onChanged();
  }

  async function handleUpdate(id: string, name: string, items: string[]) {
    await updateStageTemplate(id, { name, items: items.map((title) => ({ title })) });
    setEditingId(null);
    reload();
    onChanged();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این الگو حذف شود؟ پروژه‌های قبلاً ساخته‌شده از این الگو تغییری نمی‌کنند.")) return;
    setBusyId(id);
    try {
      await deleteStageTemplate(id);
      reload();
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="قالب‌های مراحل پروژه" onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          الگوی جدید
        </button>

        {addOpen ? <TemplateForm onSave={handleCreate} onCancel={() => setAddOpen(false)} /> : null}

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {templates === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">الگویی ثبت نشده</div>
          ) : (
            templates.map((t) =>
              editingId === t.id ? (
                <TemplateForm
                  key={t.id}
                  initial={t}
                  onSave={(name, items) => handleUpdate(t.id, name, items)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div key={t.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{t.name}</div>
                    <div className="text-[11.5px] text-muted mt-0.5 truncate">
                      {t.items.map((i) => i.title).join(" ← ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingId(t.id)}
                      className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      disabled={busyId === t.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-50"
                      aria-label="حذف الگو"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
