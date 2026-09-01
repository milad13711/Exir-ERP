import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchAccountLedger, type Account, type LedgerRow } from "@/lib/api";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_TONES } from "./accounting-shared";

export function LedgerModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    fetchAccountLedger(accountId).then((data) => {
      setAccount(data.account);
      setRows(data.rows);
    });
  }, [accountId]);

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
    </Modal>
  );
}
