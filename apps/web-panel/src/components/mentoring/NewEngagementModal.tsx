import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import {
  createMentoringEngagement,
  fetchCrmContacts,
  fetchUsers,
  fetchContracts,
  fetchProjects,
  type CrmContact,
  type TenantUser,
  type Contract,
  type Project,
  type MentoringPricingModel,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const PRICING_LABELS: Record<MentoringPricingModel, string> = {
  HOURLY: "ساعتی",
  PACKAGE: "بسته‌ای",
  PROJECT_BASED: "پروژه‌ای",
  SUBSCRIPTION: "اشتراک ماهانه",
};

export function NewEngagementModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [advisorUserId, setAdvisorUserId] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [pricingModel, setPricingModel] = useState<MentoringPricingModel>("HOURLY");
  const [hourlyRate, setHourlyRate] = useState("");
  const [packageSessionsCount, setPackageSessionsCount] = useState("");
  const [packagePrice, setPackagePrice] = useState("");
  const [subscriptionMonthlyPrice, setSubscriptionMonthlyPrice] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchContracts().then(setContracts).catch(() => setContracts([]));
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const pricingValid =
    pricingModel === "HOURLY"
      ? !!hourlyRate
      : pricingModel === "PACKAGE"
        ? !!packageSessionsCount && !!packagePrice
        : pricingModel === "SUBSCRIPTION"
          ? !!subscriptionMonthlyPrice
          : true;

  const formValid = !!title.trim() && !!contactId && !!advisorUserId && pricingValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSaving(true);
    setError(null);
    try {
      await createMentoringEngagement({
        title: title.trim(),
        contactId,
        advisorUserId,
        pricingModel,
        hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
        packageSessionsCount: packageSessionsCount ? Number(packageSessionsCount) : undefined,
        packagePrice: packagePrice ? Number(packagePrice) : undefined,
        subscriptionMonthlyPrice: subscriptionMonthlyPrice ? Number(subscriptionMonthlyPrice) : undefined,
        contractId: contractId || undefined,
        projectId: projectId || undefined,
        startDate: startDate || undefined,
        notes: notes.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت همکاری ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="همکاری جدید" onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان همکاری</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً کوچینگ کسب‌وکار — سه‌ماهه پاییز" className={inputClass} />
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>مشتری</label>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
              <option value="">انتخاب کنید</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.phone ? " — بدون شماره موبایل" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={labelClass}>مشاور/مربی</label>
            <select value={advisorUserId} onChange={(e) => setAdvisorUserId(e.target.value)} className={inputClass}>
              <option value="">انتخاب کنید</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>مدل همکاری</label>
          <div className="flex gap-2">
            {(Object.keys(PRICING_LABELS) as MentoringPricingModel[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPricingModel(m)}
                className={`flex-1 text-[11.5px] font-bold py-2 rounded-xl border cursor-pointer ${pricingModel === m ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                {PRICING_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {pricingModel === "HOURLY" && (
          <div>
            <label className={labelClass}>نرخ ساعتی (تومان)</label>
            <input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
          </div>
        )}
        {pricingModel === "PACKAGE" && (
          <div className="flex gap-2.5">
            <div className="flex-1">
              <label className={labelClass}>تعداد جلسه‌ی بسته</label>
              <input
                value={packageSessionsCount}
                onChange={(e) => setPackageSessionsCount(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className={labelClass}>قیمت کل بسته (تومان)</label>
              <input value={packagePrice} onChange={(e) => setPackagePrice(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
            </div>
          </div>
        )}
        {pricingModel === "SUBSCRIPTION" && (
          <div>
            <label className={labelClass}>مبلغ اشتراک ماهانه (تومان)</label>
            <input
              value={subscriptionMonthlyPrice}
              onChange={(e) => setSubscriptionMonthlyPrice(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className={inputClass}
            />
          </div>
        )}

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>قرارداد مرتبط (اختیاری)</label>
            <select value={contractId} onChange={(e) => setContractId(e.target.value)} className={inputClass}>
              <option value="">بدون قرارداد</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.contractNo} {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={labelClass}>پروژه‌ی مرتبط (اختیاری)</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
              <option value="">بدون پروژه</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.projectNo} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>تاریخ شروع (اختیاری — پیش‌فرض امروز)</label>
          <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>یادداشت (اختیاری)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !formValid} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ثبت..." : "ثبت همکاری"}
        </button>
      </form>
    </Modal>
  );
}
