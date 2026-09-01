import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PhoneIcon, MailIcon, BuildingIcon, PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import {
  fetchCrmContact,
  addCrmContactActivity,
  updateCrmContact,
  fetchContactCredit,
  fetchSupplierRisk,
  updateContactCreditInputs,
  ApiError,
  type CrmContactDetail,
  type CreditAssessment,
  type SupplierRiskAssessment,
} from "@/lib/api";
import { STAGE_META, ActivityTimeline, AddActivityForm } from "./crm-shared";
import { PartyStatementSection } from "./PartyStatementSection";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { useWorkspace } from "@/lib/workspace-context";

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

export function ContactModal({
  contactId,
  onClose,
  onNewDeal,
}: {
  contactId: string;
  onClose: () => void;
  onNewDeal: (contactId: string) => void;
}) {
  const { installedModules } = useWorkspace();
  const supplierRiskEnabled = installedModules.has("supplier-risk");
  const [contact, setContact] = useState<CrmContactDetail | null>(null);
  const [credit, setCredit] = useState<CreditAssessment | null>(null);
  const [supplierRisk, setSupplierRisk] = useState<SupplierRiskAssessment | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [form, setForm] = useState({
    address: "",
    nationalId: "",
    economicCode: "",
    legalId: "",
    registrationNumber: "",
    hasBouncedChecks: false,
    bankAvgMonthlyTurnover: "",
    creditLimitOverride: "",
  });

  function reload() {
    fetchCrmContact(contactId).then((c) => {
      setContact(c);
      setForm({
        address: c.address ?? "",
        nationalId: c.nationalId ?? "",
        economicCode: c.economicCode ?? "",
        legalId: c.legalId ?? "",
        registrationNumber: c.registrationNumber ?? "",
        hasBouncedChecks: c.hasBouncedChecks,
        bankAvgMonthlyTurnover: c.bankAvgMonthlyTurnover ? String(c.bankAvgMonthlyTurnover) : "",
        creditLimitOverride: c.creditLimitOverride ? String(c.creditLimitOverride) : "",
      });
    });
    fetchContactCredit(contactId).then(setCredit).catch(() => {});
    if (supplierRiskEnabled) fetchSupplierRisk(contactId).then(setSupplierRisk).catch(() => {});
  }
  useEffect(reload, [contactId]);

  async function handleSaveInfo() {
    setSavingInfo(true);
    setInfoError(null);
    try {
      const updated = await updateCrmContact(contactId, {
        address: form.address || undefined,
        nationalId: form.nationalId || undefined,
        economicCode: form.economicCode || undefined,
        legalId: form.legalId || undefined,
        registrationNumber: form.registrationNumber || undefined,
      });
      const newCredit = await updateContactCreditInputs(contactId, {
        hasBouncedChecks: form.hasBouncedChecks,
        bankAvgMonthlyTurnover: form.bankAvgMonthlyTurnover ? Number(form.bankAvgMonthlyTurnover) : null,
        creditLimitOverride: form.creditLimitOverride ? Number(form.creditLimitOverride) : null,
      });
      setContact((prev) => (prev ? { ...prev, ...updated } : prev));
      setCredit(newCredit);
      setEditingInfo(false);
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSavingInfo(false);
    }
  }

  return (
    <Modal title="اطلاعات مخاطب" onClose={onClose} width="max-w-[540px]">
      {!contact ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-extrabold">{contact.name}</h3>
              <Badge tone={contact.type === "COMPANY" ? "accent" : "neutral"}>
                {contact.type === "COMPANY" ? "شرکت" : "شخص حقیقی"}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {contact.company ? (
                <span className="text-[12px] text-ink-soft flex items-center gap-1.5">
                  <BuildingIcon className="w-3.5 h-3.5" />
                  {contact.company}
                </span>
              ) : null}
              {contact.phone ? (
                <span className="text-[12px] text-ink-soft flex items-center gap-1.5">
                  <PhoneIcon className="w-3.5 h-3.5" />
                  {contact.phone}
                </span>
              ) : null}
              {contact.email ? (
                <span className="text-[12px] text-ink-soft flex items-center gap-1.5">
                  <MailIcon className="w-3.5 h-3.5" />
                  {contact.email}
                </span>
              ) : null}
            </div>
            {contact.tags.length > 0 ? (
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {contact.tags.map((t) => (
                  <Badge key={t} tone="primary">
                    {t}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-ink-soft">اعتبارسنجی و اطلاعات هویتی</span>
              {!editingInfo ? (
                <button
                  onClick={() => setEditingInfo(true)}
                  className="text-[11.5px] font-bold text-primary cursor-pointer"
                >
                  ویرایش
                </button>
              ) : null}
            </div>

            {credit ? (
              <div className="flex items-center gap-3 mb-3">
                <Badge tone={scoreTone(credit.score)}>امتیاز اعتباری: {credit.score}</Badge>
                <span className="text-[12px] text-ink-soft">
                  سقف اعتبار: <b>{formatToman(credit.creditLimit)}</b>
                </span>
              </div>
            ) : null}
            {credit && credit.reasons.length > 0 ? (
              <ul className="text-[11.5px] text-muted list-disc pr-4 mb-3 flex flex-col gap-0.5">
                {credit.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}

            {supplierRiskEnabled && contact.isSupplier && supplierRisk ? (
              <div className="mb-3 pt-3 border-t border-border">
                <div className="flex items-center gap-3 mb-2">
                  <Badge tone={scoreTone(supplierRisk.score)}>سلامت رابطه‌ی خرید: {supplierRisk.score}</Badge>
                  {supplierRisk.totalOutstanding > 0 ? (
                    <span className="text-[12px] text-ink-soft">
                      بدهی ما به این تأمین‌کننده: <b>{formatToman(supplierRisk.totalOutstanding)}</b>
                    </span>
                  ) : null}
                </div>
                {supplierRisk.reasons.length > 0 ? (
                  <ul className="text-[11.5px] text-muted list-disc pr-4 flex flex-col gap-0.5">
                    {supplierRisk.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {!editingInfo ? (
              <div className="flex flex-col gap-1 text-[12px] text-ink-soft">
                {contact.address ? <div>آدرس: {contact.address}</div> : null}
                {contact.type === "COMPANY" ? (
                  <>
                    {contact.economicCode ? <div>کد اقتصادی: {contact.economicCode}</div> : null}
                    {contact.legalId ? <div>شناسه ملی: {contact.legalId}</div> : null}
                    {contact.registrationNumber ? <div>شماره ثبت: {contact.registrationNumber}</div> : null}
                  </>
                ) : contact.nationalId ? (
                  <div>کد ملی: {contact.nationalId}</div>
                ) : null}
                {contact.hasBouncedChecks ? <div className="text-danger">دارای سابقه‌ی چک برگشتی</div> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="آدرس"
                  className="w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                />
                {contact.type === "COMPANY" ? (
                  <div className="flex gap-2">
                    <input
                      value={form.economicCode}
                      onChange={(e) => setForm((p) => ({ ...p, economicCode: e.target.value }))}
                      placeholder="کد اقتصادی"
                      dir="ltr"
                      className="flex-1 text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                    />
                    <input
                      value={form.legalId}
                      onChange={(e) => setForm((p) => ({ ...p, legalId: e.target.value }))}
                      placeholder="شناسه ملی"
                      dir="ltr"
                      className="flex-1 text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                    />
                    <input
                      value={form.registrationNumber}
                      onChange={(e) => setForm((p) => ({ ...p, registrationNumber: e.target.value }))}
                      placeholder="شماره ثبت"
                      dir="ltr"
                      className="flex-1 text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                    />
                  </div>
                ) : (
                  <input
                    value={form.nationalId}
                    onChange={(e) => setForm((p) => ({ ...p, nationalId: e.target.value }))}
                    placeholder="کد ملی"
                    dir="ltr"
                    className="w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                  />
                )}

                <label className="flex items-center gap-2 text-[12px] font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.hasBouncedChecks}
                    onChange={(e) => setForm((p) => ({ ...p, hasBouncedChecks: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  سابقه‌ی چک برگشتی دارد
                </label>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-muted mb-1 block">میانگین گردش حساب ماهانه (تومان)</label>
                    <input
                      value={form.bankAvgMonthlyTurnover}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, bankAvgMonthlyTurnover: e.target.value.replace(/[^0-9]/g, "") }))
                      }
                      dir="ltr"
                      placeholder="طبق پرینت بانکی"
                      className="w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-muted mb-1 block">سقف اعتبار دستی (تومان)</label>
                    <input
                      value={form.creditLimitOverride}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, creditLimitOverride: e.target.value.replace(/[^0-9]/g, "") }))
                      }
                      dir="ltr"
                      placeholder="در صورت خالی بودن، خودکار محاسبه می‌شود"
                      className="w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-3 py-2"
                    />
                  </div>
                </div>

                {infoError ? <div className="text-[11.5px] text-danger">{infoError}</div> : null}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingInfo(false)}
                    className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12px] font-bold cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveInfo}
                    disabled={savingInfo}
                    className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {savingInfo ? "در حال ذخیره..." : "ذخیره"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <PartyStatementSection contact={contact} onChanged={reload} />

          <AttachmentsSection entityType="CrmContact" entityId={contact.id} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-muted">فرصت‌های فروش ({contact.deals.length})</span>
              <button
                onClick={() => onNewDeal(contact.id)}
                className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                فرصت جدید
              </button>
            </div>
            {contact.deals.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
                فرصت فروشی برای این مخاطب ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {contact.deals.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div>
                      <div className="text-[12.5px] font-bold">{d.title}</div>
                      <div className="text-[11.5px] text-muted mt-0.5">{formatToman(d.value)}</div>
                    </div>
                    <Badge tone={STAGE_META[d.stage].tone}>{STAGE_META[d.stage].label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">تاریخچه فعالیت</div>
            <ActivityTimeline activities={contact.activities} />
            <AddActivityForm
              onSubmit={async (type, body) => {
                await addCrmContactActivity(contactId, type, body);
                const fresh = await fetchCrmContact(contactId);
                setContact(fresh);
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
