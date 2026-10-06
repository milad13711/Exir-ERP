import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon } from "@/components/icons";
import { formatToman } from "@/lib/persian";
import {
  fetchServiceTypes,
  createServiceType,
  updateServiceType,
  deactivateServiceType,
  type ServiceType,
} from "@/lib/api";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

const inputClass =
  "text-[12.5px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

export function ServiceTypesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<ServiceType[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("0");
  const [requiresDeposit, setRequiresDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("0");
  const [requiresCoordination, setRequiresCoordination] = useState(false);
  const [requiresFullPayment, setRequiresFullPayment] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationMode, setLocationMode] = useState<"OFFICE" | "CUSTOMER_SITE" | "ONLINE">("OFFICE");
  const [linkToMentoring, setLinkToMentoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    fetchServiceTypes(true).then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  function resetForm() {
    setName("");
    setDuration("30");
    setPrice("0");
    setRequiresDeposit(false);
    setDepositAmount("0");
    setRequiresCoordination(false);
    setRequiresFullPayment(false);
    setDescription("");
    setLocation("");
    setLocationMode("OFFICE");
    setLinkToMentoring(false);
  }

  function startEdit(s: ServiceType) {
    setEditingId(s.id);
    setName(s.name);
    setDuration(String(s.durationMinutes));
    setPrice(String(s.price));
    setRequiresDeposit(s.requiresDeposit);
    setDepositAmount(String(s.depositAmount ?? 0));
    setRequiresCoordination(s.requiresCoordination);
    setRequiresFullPayment(!!s.requiresFullPayment);
    setDescription(s.description ?? "");
    setLocation(s.location ?? "");
    setLocationMode(s.locationMode ?? "OFFICE");
    setLinkToMentoring(!!s.linkToMentoring);
    setAddOpen(true);
  }

  function cancelForm() {
    setEditingId(null);
    resetForm();
    setAddOpen(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !duration) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        durationMinutes: Number(duration),
        price: Number(price) || 0,
        requiresDeposit,
        depositAmount: requiresDeposit ? Number(depositAmount) || 0 : undefined,
        requiresCoordination,
        requiresFullPayment,
        description: description.trim() || undefined,
        location: locationMode === "OFFICE" ? location.trim() || undefined : undefined,
        locationMode,
        linkToMentoring,
      };
      if (editingId) {
        await updateServiceType(editingId, payload);
      } else {
        await createServiceType(payload);
      }
      setEditingId(null);
      resetForm();
      setAddOpen(false);
      reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: ServiceType) {
    setBusyId(s.id);
    try {
      if (s.isActive) {
        await deactivateServiceType(s.id);
      } else {
        await updateServiceType(s.id, { isActive: true });
      }
      reload();
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "تغییر وضعیت ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="انواع خدمت" onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => {
            if (addOpen) {
              cancelForm();
            } else {
              resetForm();
              setAddOpen(true);
            }
          }}
          className="self-start flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          نوع خدمت جدید
        </button>

        {addOpen ? (
          <form onSubmit={handleAdd} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام خدمت" className={inputClass} />
            <div className="flex gap-2.5">
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-ink-soft mb-1 block">مدت‌زمان (دقیقه)</label>
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  type="number"
                  min={5}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-ink-soft mb-1 block">قیمت (تومان)</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="number"
                  min={0}
                  className={`${inputClass} w-full`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={requiresCoordination} onChange={(e) => setRequiresCoordination(e.target.checked)} />
              نیاز به هماهنگی اولیه با ارائه‌دهنده قبل از نهایی‌شدن رزرو
            </label>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={requiresFullPayment} onChange={(e) => { setRequiresFullPayment(e.target.checked); if (e.target.checked) setRequiresDeposit(false); }} />
              پرداخت کامل مبلغ خدمت هنگام رزرو (لینک پرداخت در پیامک)
            </label>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={requiresDeposit} disabled={requiresFullPayment} onChange={(e) => setRequiresDeposit(e.target.checked)} />
              نیاز به پرداخت بیعانه/پیش‌پرداخت
            </label>
            {requiresDeposit && (
              <div>
                <label className="text-[11px] font-semibold text-ink-soft mb-1 block">مبلغ بیعانه (تومان)</label>
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  type="number"
                  min={0}
                  className={`${inputClass} w-full`}
                />
              </div>
            )}
            <div>
              <label className="text-[11px] font-semibold text-ink-soft mb-1 block">محل برگزاری</label>
              <select value={locationMode} onChange={(e) => setLocationMode(e.target.value as typeof locationMode)} className={`${inputClass} w-full`}>
                <option value="OFFICE">دفتر / آدرس ثابت</option>
                <option value="CUSTOMER_SITE">محل مشتری (آدرس دفتر در پیام نمی‌آید)</option>
                <option value="ONLINE">آنلاین / تلفنی (بدون آدرس)</option>
              </select>
              {locationMode === "CUSTOMER_SITE" ? (
                <p className="text-[11px] text-muted mt-1.5">در پیام، آدرس مشتری (از پروفایل CRM یا «آدرس اختصاصی» همان نوبت) درج می‌شود.</p>
              ) : null}
            </div>
            {locationMode === "OFFICE" ? (
              <div>
                <label className="text-[11px] font-semibold text-ink-soft mb-1 block">آدرس دفتر برای این خدمت (خالی = آدرس شرکت در تنظیمات عمومی)</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${inputClass} w-full`} />
              </div>
            ) : null}
            <div>
              <label className="text-[11px] font-semibold text-ink-soft mb-1 block">توضیحات جلسه (در لینک عمومی نوبت به مشتری نمایش داده می‌شود)</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} w-full`} />
            </div>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft cursor-pointer">
              <input type="checkbox" checked={linkToMentoring} onChange={(e) => setLinkToMentoring(e.target.checked)} />
              اتصال به ماژول مشاوره و منتورینگ (هر نوبت یک جلسه‌ی مشاوره می‌سازد؛ صورتجلسه و اقدامات بعدی آنجا ثبت می‌شود)
            </label>
            <div className="flex items-center gap-2 self-end">
              {editingId ? (
                <button
                  type="button"
                  onClick={cancelForm}
                  className="text-[12px] font-bold text-ink-soft bg-white border border-border px-3.5 py-1.5 rounded-lg cursor-pointer"
                >
                  انصراف
                </button>
              ) : null}
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {saving ? "در حال ثبت..." : editingId ? "ذخیره تغییرات" : "ثبت"}
              </button>
            </div>
          </form>
        ) : null}

        <ExcelImportExportBar
          exportPath="/booking/service-types/export"
          exportFilename="service-types.xlsx"
          importPath="/booking/service-types/import"
          templatePath="/booking/service-types/template"
          templateFilename="service-types-template.xlsx"
          onImported={() => {
            reload();
            onChanged();
          }}
        />

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {items === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">نوع خدمتی ثبت نشده</div>
          ) : (
            items.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold truncate">{s.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {s.durationMinutes} دقیقه · {formatToman(s.price)}
                    {s.requiresCoordination ? " · نیاز به هماهنگی" : ""}
                    {s.requiresDeposit ? ` · بیعانه ${formatToman(s.depositAmount ?? 0)}` : ""}
                    {s.requiresFullPayment ? " · پرداخت کامل" : ""}
                    {s.linkToMentoring ? " · متصل به مشاوره" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer text-primary bg-primary-soft"
                  >
                    ویرایش
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(s)}
                    disabled={busyId === s.id}
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 ${
                      s.isActive ? "text-danger bg-danger-soft" : "text-success bg-success-soft"
                    }`}
                  >
                    {s.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
