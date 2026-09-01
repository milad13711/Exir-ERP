import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { PhoneIcon, MailIcon, ReceiptIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchCrmDeal,
  updateCrmDealStage,
  updateCrmDeal,
  deleteCrmDeal,
  addCrmDealActivity,
  type CrmDealDetail,
  type CrmDealStage,
} from "@/lib/api";
import { STAGE_ORDER, STAGE_META, ActivityTimeline, AddActivityForm } from "./crm-shared";

export function DealModal({
  dealId,
  onClose,
  onChanged,
  onDeleted,
}: {
  dealId: string;
  onClose: () => void;
  onChanged: (deal: CrmDealDetail) => void;
  onDeleted: (id: string) => void;
}) {
  const [deal, setDeal] = useState<CrmDealDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editCloseAt, setEditCloseAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchCrmDeal(dealId).then(setDeal);
  }, [dealId]);

  async function handleStage(stage: CrmDealStage) {
    setBusy(true);
    try {
      await updateCrmDealStage(dealId, stage);
      const fresh = await fetchCrmDeal(dealId);
      setDeal(fresh);
      onChanged(fresh);
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    if (!deal) return;
    setEditTitle(deal.title);
    setEditValue(String(deal.value));
    setEditCloseAt(deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await updateCrmDeal(dealId, {
        title: editTitle.trim(),
        value: Number(editValue) || 0,
        expectedCloseAt: editCloseAt || null,
      });
      const fresh = await fetchCrmDeal(dealId);
      setDeal(fresh);
      onChanged(fresh);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("این فرصت فروش حذف شود؟ این عملیات قابل بازگشت نیست.")) return;
    setDeleting(true);
    try {
      await deleteCrmDeal(dealId);
      onDeleted(dealId);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="فرصت فروش" onClose={onClose} width="max-w-[540px]">
      {!deal ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-5">
          {editing ? (
            <div className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="عنوان فرصت فروش"
                className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
              />
              <div className="flex gap-2.5">
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="ارزش (تومان)"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
                <div className="flex-1">
                  <JalaliDateInput value={editCloseAt} onChange={setEditCloseAt} placeholder="تاریخ تخمینی بستن" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {deleting ? "در حال حذف..." : "حذف فرصت فروش"}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={savingEdit || !editTitle.trim()}
                    className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {savingEdit ? "در حال ذخیره..." : "ذخیره"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-extrabold">{deal.title}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={STAGE_META[deal.stage].tone}>{STAGE_META[deal.stage].label}</Badge>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer"
                  >
                    ویرایش
                  </button>
                </div>
              </div>
              <div className="text-xl font-extrabold text-primary mt-2">{formatToman(deal.value)}</div>
              {deal.expectedCloseAt ? (
                <div className="text-[12px] text-muted mt-1">
                  تاریخ تخمینی بستن: {formatJalaliDate(deal.expectedCloseAt)}
                </div>
              ) : null}
            </div>
          )}

          <div className="bg-slate-50 border border-border rounded-xl p-3.5">
            <div className="text-[12px] text-muted mb-1">مخاطب</div>
            <div className="text-[13.5px] font-bold">{deal.contact.name}</div>
            {deal.contact.company ? (
              <div className="text-[12px] text-ink-soft">{deal.contact.company}</div>
            ) : null}
            <div className="flex items-center gap-4 mt-2">
              {deal.contact.phone ? (
                <span className="text-[12px] text-ink-soft flex items-center gap-1.5">
                  <PhoneIcon className="w-3.5 h-3.5" />
                  {deal.contact.phone}
                </span>
              ) : null}
              {deal.contact.email ? (
                <span className="text-[12px] text-ink-soft flex items-center gap-1.5">
                  <MailIcon className="w-3.5 h-3.5" />
                  {deal.contact.email}
                </span>
              ) : null}
            </div>
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">تغییر مرحله</div>
            <div className="flex flex-wrap gap-2">
              {STAGE_ORDER.map((stage) => (
                <button
                  key={stage}
                  disabled={busy || stage === deal.stage}
                  onClick={() => handleStage(stage)}
                  className={clsx(
                    "text-[11.5px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer disabled:cursor-default transition-colors",
                    stage === deal.stage
                      ? "bg-primary text-white border-primary"
                      : "bg-surface border-border text-ink-soft hover:border-primary hover:text-primary disabled:opacity-50",
                  )}
                >
                  {STAGE_META[stage].label}
                </button>
              ))}
            </div>
          </div>

          {deal.stage === "WON" ? (
            <button
              onClick={() =>
                router.push(
                  `/sales?dealId=${deal.id}&contactId=${deal.contact.id}&title=${encodeURIComponent(deal.title)}&value=${deal.value}`,
                )
              }
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-success text-white text-[13px] font-bold cursor-pointer"
            >
              <ReceiptIcon className="w-4 h-4" />
              ایجاد فاکتور فروش از این فرصت
            </button>
          ) : null}

          <div>
            <div className="text-[12px] text-muted mb-2">تاریخچه فعالیت</div>
            <ActivityTimeline activities={deal.activities} />
            <AddActivityForm
              onSubmit={async (type, body) => {
                await addCrmDealActivity(dealId, type, body);
                const fresh = await fetchCrmDeal(dealId);
                setDeal(fresh);
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
