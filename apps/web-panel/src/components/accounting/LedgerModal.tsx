import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchAccountLedger, deleteAccount, ApiError, type Account, type LedgerRow } from "@/lib/api";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_TONES } from "./accounting-shared";
import { NewAccountModal } from "./NewAccountModal";
import { PencilIcon, TrashIcon } from "@/components/icons";

export function LedgerModal({
  accountId,
  onClose,
  onUpdated,
  onDeleted,
}: {
  accountId: string;
  onClose: () => void;
  onUpdated?: (account: Account) => void;
  onDeleted?: (accountId: string) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccountLedger(accountId).then((data) => {
      setAccount(data.account);
      setRows(data.rows);
    });
  }, [accountId]);

  async function handleDelete() {
    if (!account) return;
    if (!window.confirm(`حساب «${account.name}» حذف شود؟`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(account.id);
      onDeleted?.(account.id);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "حذف ناموفق بود");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="دفتر حساب" onClose={onClose} width="max-w-[620px]">
      {!account || rows === null ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold">
                {toPersianDigits(account.code)} — {account.name}
              </div>
              <Badge tone={ACCOUNT_TYPE_TONES[account.type]} className="mt-1.5">
                {ACCOUNT_TYPE_LABELS[account.type]}
              </Badge>
            </div>
            <div className="text-left">
              <div className="text-[11px] text-muted">مانده فعلی</div>
              <div className="text-lg font-extrabold text-primary">{formatToman(account.balance)}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
            >
              <PencilIcon className="w-3.5 h-3.5" />
              ویرایش
            </button>
            {!account.isSystem ? (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-[12px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                {deleting ? "در حال حذف..." : "حذف"}
              </button>
            ) : null}
            {deleteError ? <span className="text-[11.5px] text-danger font-semibold">{deleteError}</span> : null}
          </div>

          {rows.length === 0 ? (
            <div className="text-[12.5px] text-muted text-center py-10 bg-slate-50 rounded-xl border border-border">
              هنوز سند ثبت‌شده‌ای برای این حساب وجود ندارد
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[12px] min-w-[520px]">
                <thead>
                  <tr className="text-muted border-b border-border">
                    <th className="text-right font-semibold py-2 px-1">سند</th>
                    <th className="text-right font-semibold py-2 px-1">تاریخ</th>
                    <th className="text-right font-semibold py-2 px-1">شرح</th>
                    <th className="text-left font-semibold py-2 px-1">بدهکار</th>
                    <th className="text-left font-semibold py-2 px-1">بستانکار</th>
                    <th className="text-left font-semibold py-2 px-1">مانده</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 px-1 text-muted">{toPersianDigits(r.entryNumber)}</td>
                      <td className="py-2.5 px-1 text-muted whitespace-nowrap">{formatJalaliDate(r.date)}</td>
                      <td className="py-2.5 px-1">{r.description}</td>
                      <td className="py-2.5 px-1 text-left">{r.debit ? formatToman(r.debit) : "—"}</td>
                      <td className="py-2.5 px-1 text-left">{r.credit ? formatToman(r.credit) : "—"}</td>
                      <td className="py-2.5 px-1 text-left font-bold">{formatToman(r.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {editing && account ? (
        <NewAccountModal
          account={account}
          hasMovements={(rows?.length ?? 0) > 0}
          onClose={() => setEditing(false)}
          onUpdated={(updated) => {
            setAccount(updated);
            onUpdated?.(updated);
          }}
        />
      ) : null}
    </Modal>
  );
}
