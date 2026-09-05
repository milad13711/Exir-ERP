import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import {
  createContract,
  fetchCrmContacts,
  fetchEmployees,
  fetchContractTemplates,
  fetchContractCategories,
  fetchUsers,
  type ContractType,
  type ContractPartyMode,
  type ContractLegalCategory,
  type ContractTemplate,
  type CrmContact,
  type Employee,
  type TenantUser,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const PARTY_MODE_LABELS: Record<ContractPartyMode, string> = {
  INTERNAL: "داخلی (شرکت و پرسنل)",
  EXTERNAL: "خارجی (شرکت و مشتری/تأمین‌کننده)",
  THIRD_PARTY: "بین دو طرف دیگر",
};
const LEGAL_CATEGORY_LABELS: Record<ContractLegalCategory, string> = {
  NOTARIZED: "دفترخانه اسناد رسمی",
  LAWYER_SUPERVISED: "تحت نظارت وکیل",
  GENERAL: "عمومی",
};

export function NewContractModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [partyMode, setPartyMode] = useState<ContractPartyMode>("EXTERNAL");
  const [type, setType] = useState<ContractType>("SALES");
  const [legalCategory, setLegalCategory] = useState<ContractLegalCategory>("GENERAL");

  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [secondPartyContactId, setSecondPartyContactId] = useState("");
  const [secondPartyMode, setSecondPartyMode] = useState<"existing" | "new">("existing");
  const [secondPartyName, setSecondPartyName] = useState("");
  const [secondPartyPhone, setSecondPartyPhone] = useState("");

  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [referredSignerUserId, setReferredSignerUserId] = useState("");
  const [guaranteeTerms, setGuaranteeTerms] = useState("");

  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalReminderDays, setRenewalReminderDays] = useState("30");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchEmployees().then(setEmployees).catch(() => setEmployees([]));
    fetchContractTemplates().then(setTemplates).catch(() => setTemplates([]));
    fetchContractCategories().then(setCategories).catch(() => setCategories([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const relevantTemplates = templates.filter((t) => t.partyMode === partyMode);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    // متن قالب اینجا در state ذخیره نمی‌شود — پیش‌نمایش خام آن نمایش داده می‌شود
    // و جایگزینی فیلدها ({{شرکت}}، {{طرف_دوم}}، ...) سمت سرور در لحظه‌ی ثبت انجام می‌شود.
    if (tpl?.type) setType(tpl.type);
  }

  const partyValid =
    partyMode === "INTERNAL"
      ? !!employeeId
      : partyMode === "EXTERNAL"
        ? !!contactId
        : !!contactId && (secondPartyMode === "existing" ? !!secondPartyContactId : !!secondPartyName.trim() && !!secondPartyPhone.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !partyValid || !value || !startDate || !endDate) return;
    setSaving(true);
    setError(null);
    try {
      await createContract({
        title: title.trim(),
        partyMode,
        type: partyMode === "EXTERNAL" ? type : undefined,
        legalCategory,
        category: category.trim() || undefined,
        guaranteeTerms: guaranteeTerms.trim() || undefined,
        referredSignerUserId: referredSignerUserId || undefined,
        templateId: templateId || undefined,
        contactId: partyMode === "INTERNAL" ? undefined : contactId || undefined,
        employeeId: partyMode === "INTERNAL" ? employeeId : undefined,
        secondPartyContactId: partyMode === "THIRD_PARTY" && secondPartyMode === "existing" ? secondPartyContactId : undefined,
        secondPartyName: partyMode === "THIRD_PARTY" && secondPartyMode === "new" ? secondPartyName.trim() : undefined,
        secondPartyPhone: partyMode === "THIRD_PARTY" && secondPartyMode === "new" ? secondPartyPhone.trim() : undefined,
        value: Number(value),
        startDate,
        endDate,
        autoRenew,
        renewalReminderDays: Number(renewalReminderDays) || 30,
        terms: terms.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت قرارداد ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="قرارداد جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان قرارداد</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>نوع طرفین</label>
          <div className="flex gap-2">
            {(["EXTERNAL", "INTERNAL", "THIRD_PARTY"] as ContractPartyMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPartyMode(m)}
                className={`flex-1 text-[11.5px] font-bold py-2 rounded-xl border cursor-pointer ${partyMode === m ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                {PARTY_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {partyMode === "EXTERNAL" && (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setType("SALES")}
              className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "SALES" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              فروش (با مشتری)
            </button>
            <button
              type="button"
              onClick={() => setType("PURCHASE")}
              className={`flex-1 text-[12.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === "PURCHASE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              خرید (با تأمین‌کننده)
            </button>
          </div>
        )}

        {partyMode === "INTERNAL" && (
          <div>
            <label className={labelClass}>پرسنل</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              <option value="">انتخاب کنید</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName}
                  {!emp.phone ? " (بدون شماره موبایل — امضای دیجیتال ممکن نیست)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {(partyMode === "EXTERNAL" || partyMode === "THIRD_PARTY") && (
          <div>
            <label className={labelClass}>{partyMode === "THIRD_PARTY" ? "طرف اول" : "طرف قرارداد"}</label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
              <option value="">انتخاب کنید</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` (${c.company})` : ""}
                  {!c.phone ? " — بدون شماره موبایل" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {partyMode === "THIRD_PARTY" && (
          <div>
            <label className={labelClass}>طرف دوم</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setSecondPartyMode("existing")}
                className={`flex-1 text-[12px] font-bold py-1.5 rounded-lg border cursor-pointer ${secondPartyMode === "existing" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                از مخاطبین CRM
              </button>
              <button
                type="button"
                onClick={() => setSecondPartyMode("new")}
                className={`flex-1 text-[12px] font-bold py-1.5 rounded-lg border cursor-pointer ${secondPartyMode === "new" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                وارد کردن دستی
              </button>
            </div>
            {secondPartyMode === "existing" ? (
              <select value={secondPartyContactId} onChange={(e) => setSecondPartyContactId(e.target.value)} className={inputClass}>
                <option value="">انتخاب کنید</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.phone ? " — بدون شماره موبایل" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex gap-2">
                <input placeholder="نام طرف دوم" value={secondPartyName} onChange={(e) => setSecondPartyName(e.target.value)} className={inputClass} />
                <input
                  placeholder="09xxxxxxxxx"
                  dir="ltr"
                  value={secondPartyPhone}
                  onChange={(e) => setSecondPartyPhone(e.target.value.replace(/[^0-9]/g, ""))}
                  className={inputClass}
                />
              </div>
            )}
          </div>
        )}

        {relevantTemplates.length > 0 && (
          <div>
            <label className={labelClass}>قالب پیش‌فرض (اختیاری)</label>
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className={inputClass}>
              <option value="">بدون قالب</option>
              {relevantTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <div className="text-[11.5px] text-muted leading-relaxed bg-slate-50 rounded-lg p-2.5 mt-1.5 whitespace-pre-wrap">
                {selectedTemplate.body}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>دسته‌بندی حقوقی</label>
            <select value={legalCategory} onChange={(e) => setLegalCategory(e.target.value as ContractLegalCategory)} className={inputClass}>
              {(Object.keys(LEGAL_CATEGORY_LABELS) as ContractLegalCategory[]).map((c) => (
                <option key={c} value={c}>
                  {LEGAL_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={labelClass}>دسته‌بندی کسب‌وکاری (اختیاری)</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="contract-categories"
              placeholder="مثلاً اجاره، پیمانکاری..."
              className={inputClass}
            />
            <datalist id="contract-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className={labelClass}>ارجاع امضای شرکت به (اختیاری)</label>
          <select value={referredSignerUserId} onChange={(e) => setReferredSignerUserId(e.target.value)} className={inputClass}>
            <option value="">فقط مالک/مدیر</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>ارزش قرارداد (تومان)</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>تاریخ شروع</label>
            <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>تاریخ پایان</label>
            <JalaliDateInput value={endDate} onChange={setEndDate} className={inputClass} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-lg px-3 py-2.5">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft cursor-pointer">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            تمدید خودکار
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-muted">یادآوری (روز قبل از پایان)</span>
            <input
              value={renewalReminderDays}
              onChange={(e) => setRenewalReminderDays(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="w-14 text-center text-[12.5px] outline-none bg-white border border-border rounded-lg px-2 py-1.5"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>شرح بندها و شرایط {selectedTemplate ? "(اختیاری — اگر خالی بماند، از قالب پر می‌شود)" : "(اختیاری)"}</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>ضمانت اجرا (اختیاری)</label>
          <textarea
            value={guaranteeTerms}
            onChange={(e) => setGuaranteeTerms(e.target.value)}
            rows={2}
            placeholder="جریمه، وثیقه یا تعهدات در صورت نقض قرارداد..."
            className={inputClass}
          />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button
          type="submit"
          disabled={saving || !title.trim() || !partyValid || !value || !startDate || !endDate}
          className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? "در حال ثبت..." : "ثبت قرارداد"}
        </button>
      </form>
    </Modal>
  );
}
