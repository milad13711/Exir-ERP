import { useEffect, useRef, useState } from "react";
import { PlaceholderPalette, CONTRACT_PLACEHOLDERS, RECRUITMENT_PLACEHOLDERS } from "@/components/contracts/PlaceholderPalette";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons";
import {
  fetchContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  type ContractTemplate,
  type ContractPartyMode,
  type ContractType,
} from "@/lib/api";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

const PARTY_MODE_LABELS: Record<ContractPartyMode, string> = {
  INTERNAL: "داخلی",
  EXTERNAL: "خارجی",
  THIRD_PARTY: "بین دو طرف دیگر",
};

function TemplateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ContractTemplate;
  onSave: (name: string, partyMode: ContractPartyMode, type: ContractType | undefined, body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [partyMode, setPartyMode] = useState<ContractPartyMode>(initial?.partyMode ?? "EXTERNAL");
  const [type, setType] = useState<ContractType | "">(initial?.type ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), partyMode, type || undefined, body.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام قالب" className={inputClass} />
      <div className="flex gap-2">
        {(["EXTERNAL", "INTERNAL", "THIRD_PARTY"] as ContractPartyMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setPartyMode(m)}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg border cursor-pointer ${partyMode === m ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
          >
            {PARTY_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {partyMode === "EXTERNAL" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType("SALES")}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg border cursor-pointer ${type === "SALES" ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
          >
            فروش
          </button>
          <button
            type="button"
            onClick={() => setType("PURCHASE")}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg border cursor-pointer ${type === "PURCHASE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
          >
            خرید
          </button>
        </div>
      )}
      <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={7} placeholder="متن بندها و شرایط قرارداد..." className={inputClass} />
      <PlaceholderPalette fields={CONTRACT_PLACEHOLDERS} targetRef={bodyRef} value={body} onChange={setBody} />
      <PlaceholderPalette fields={RECRUITMENT_PLACEHOLDERS} targetRef={bodyRef} value={body} onChange={setBody} label="مخصوص قالب استخدام:" />
      <div className="text-[11px] text-muted bg-slate-50 rounded-lg p-2.5">
        <div className="font-semibold text-ink-soft mb-1">فیلدهای قابل استفاده — با تایپ این‌ها داخل متن، هنگام ثبت هر قرارداد به‌طور خودکار پر می‌شوند:</div>
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {[
            "شرکت", "نام_طرف_اول", "نام_طرف_دوم",
            "شماره_تماس_طرف_اول", "شماره_تماس_طرف_دوم",
            "شماره_ملی_طرف_اول", "شماره_ملی_طرف_دوم",
            "شماره_ثبت_طرف_اول", "شماره_ثبت_طرف_دوم",
            "آدرس_طرف_اول", "آدرس_طرف_دوم",
            "تاریخ_شروع", "تاریخ_پایان", "مبلغ_قرارداد",
          ].map((p) => (
            <span key={p} className="bg-white border border-border rounded px-1.5 py-0.5 font-mono text-[10.5px]">
              {`{{${p}}}`}
            </span>
          ))}
        </div>
        <div className="mt-1.5">
          فیلد دلخواه دیگری هم می‌توانید بسازید — کافی است در متن {"{{نام_دلخواه}}"} بنویسید و هنگام ثبت هر قرارداد مقدارش را وارد کنید.
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
          انصراف
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !body.trim()}
          className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        >
          ذخیره
        </button>
      </div>
    </form>
  );
}

export function ContractTemplatesModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<ContractTemplate[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    fetchContractTemplates().then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(reload, []);

  async function handleCreate(name: string, partyMode: ContractPartyMode, type: ContractType | undefined, body: string) {
    await createContractTemplate({ name, partyMode, type, body });
    setAddOpen(false);
    reload();
  }

  async function handleUpdate(id: string, name: string, partyMode: ContractPartyMode, type: ContractType | undefined, body: string) {
    await updateContractTemplate(id, { name, partyMode, type, body });
    setEditingId(null);
    reload();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این قالب حذف شود؟ قراردادهای قبلاً ساخته‌شده از این قالب تغییری نمی‌کنند.")) return;
    setBusyId(id);
    try {
      await deleteContractTemplate(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="قالب‌های پیش‌فرض قرارداد" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          قالب جدید
        </button>

        {addOpen ? <TemplateForm onSave={handleCreate} onCancel={() => setAddOpen(false)} /> : null}

        <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
          {templates === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">قالبی ثبت نشده</div>
          ) : (
            templates.map((t) =>
              editingId === t.id ? (
                <TemplateForm
                  key={t.id}
                  initial={t}
                  onSave={(name, partyMode, type, body) => handleUpdate(t.id, name, partyMode, type, body)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div key={t.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{t.name}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">{PARTY_MODE_LABELS[t.partyMode]}</div>
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
                      aria-label="حذف قالب"
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
