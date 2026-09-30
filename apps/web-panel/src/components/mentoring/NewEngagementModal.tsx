import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import {
  createMentoringEngagement,
  updateMentoringEngagement,
  fetchCrmContacts,
  fetchUsers,
  fetchContracts,
  fetchProjects,
  type CrmContact,
  type TenantUser,
  type Contract,
  type Project,
  type MentoringEngagement,
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

/** برای ساخت همکاری جدید `engagement` را ندهید؛ برای ویرایش همکاری موجود، `engagement` را بدهید. */
export function NewEngagementModal({
  engagement,
  onClose,
  onCreated,
}: {
  engagement?: MentoringEngagement;
  onClose: () => void;
  onCreated: () => void;
}) {
  const editing = !!engagement;
  const [title, setTitle] = useState(engagement?.title ?? "");
  const [contactId, setContactId] = useState(engagement?.contactId ?? "");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [advisorUserId, setAdvisorUserId] = useState(engagement?.advisorUserId ?? "");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [pricingModel, setPricingModel] = useState<MentoringPricingModel>(engagement?.pricingModel ?? "HOURLY");
  const [hourlyRate, setHourlyRate] = useState(engagement?.hourlyRate != null ? String(engagement.hourlyRate) : "");
  const [packageSessionsCount, setPackageSessionsCount] = useState(
    engagement?.packageSessionsCount != null ? String(engagement.packageSessionsCount) : "",
  );
  const [packagePrice, setPackagePrice] = useState(engagement?.packagePrice != null ? String(engagement.packagePrice) : "");
  const [subscriptionMonthlyPrice, setSubscriptionMonthlyPrice] = useState(
    engagement?.subscriptionMonthlyPrice != null ? String(engagement.subscriptionMonthlyPrice) : "",
  );
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState(engagement?.contractId ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(engagement?.projectId ?? "");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState(engagement?.notes ?? "");
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
      const payload = {
        title: title.trim(),
        advisorUserId,
        pricingModel,
        hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
        packageSessionsCount: packageSessionsCount ? Number(packageSessionsCount) : undefined,
        packagePrice: packagePrice ? Number(packagePrice) : undefined,
        subscriptionMonthlyPrice: subscriptionMonthlyPrice ? Number(subscriptionMonthlyPrice) : undefined,
        contractId: contractId || undefined,
        projectId: projectId || undefined,
        notes: notes.trim() || undefined,
      };
      if (editing) {
        await updateMentoringEngagement(engagement.id, payload);
      } else {
        await createMentoringEngagement({ ...payload, contactId, startDate: startDate || undefined });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : editing ? "ویرایش همکاری ناموفق بود" : "ثبت همکاری ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "ویرایش همکاری" : "همکاری جدید"} onClose={onClose} width="max-w-[520px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان همکاری</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً کوچینگ کسب‌وکار — سه‌ماهه پاییز" className={inputClass} />
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>مشتری</label>
            {editing ? (
              <input value={engagement.contact.name} disabled className={`${inputClass} opacity-60`} />
            ) : (
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
                <option value="">انتخاب کنید</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.phone ? " — بدون شماره موبایل" : ""}
                  </option>
                ))}
              </select>
            )}
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

        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-primary font-bold">جزئیات بیشتر</summary>
          <div className="flex flex-col gap-3.5 mt-3">
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

            {!editing && (
              <div>
                <label className={labelClass}>تاریخ شروع (اختیاری — پیش‌فرض امروز)</label>
                <JalaliDateInput value={startDate} onChange={setStartDate} className={inputClass} />
              </div>
            )}

            <div>
              <label className={labelClass}>یادداشت (اختیاری)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
            </div>
          </div>
        </details>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !formValid} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : "ثبت همکاری"}
        </button>
      </form>
    </Modal>
  );
}
