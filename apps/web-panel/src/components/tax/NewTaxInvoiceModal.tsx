"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { formatJalaliDate, formatToman, toPersianDigits } from "@/lib/persian";
import { ApiError, createTaxInvoice, fetchSalesInvoices, type SalesInvoice } from "@/lib/api";

/** انتخاب یک فاکتور رسمی تأییدشده با جستجوی سمت سرور؛ ساخت پیش‌نویس صورتحساب مالیاتی. */
export function NewTaxInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SalesInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounced = useDebouncedValue(q, 300);
  const begin = useRequestGuard();

  useEffect(() => {
    const isCurrent = begin();
    fetchSalesInvoices(undefined, debounced.trim() || undefined)
      .then((r) => isCurrent() && setRows(r.filter((i) => i.isOfficial && i.status !== "DRAFT" && i.status !== "CANCELLED")))
      .catch(() => isCurrent() && setRows((p) => p ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  async function pick(inv: SalesInvoice) {
    setBusyId(inv.id);
    setError(null);
    try {
      const t = await createTaxInvoice(inv.id);
      onCreated(t.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ساخت ناموفق بود");
      setBusyId(null);
    }
  }

  return (
    <Modal title="صورتحساب مالیاتی جدید از فاکتور رسمی" onClose={onClose} width="max-w-[620px]">
      <SearchInput value={q} onChange={setQ} placeholder="شماره فاکتور یا نام مشتری..." loading={rows === null} />
      {error ? <div className="text-[12.5px] text-danger mt-2">{error}</div> : null}
      <div className="mt-3 space-y-2 max-h-[420px] overflow-auto">
        {rows === null ? (
          <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-muted text-sm py-4">فاکتور رسمی تأییدشده‌ای یافت نشد</div>
        ) : (
          rows.map((i) => (
            <button
              key={i.id}
              disabled={busyId !== null}
              onClick={() => pick(i)}
              className="w-full text-right flex items-center justify-between gap-3 bg-surface border border-border rounded-xl px-3.5 py-2.5 cursor-pointer hover:border-primary disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">
                  فاکتور {toPersianDigits(i.invoiceNo)}
                  {i.officialInvoiceNo ? ` — رسمی ${toPersianDigits(i.officialInvoiceNo)}` : ""}
                </span>
                <span className="block text-[12px] text-ink-soft truncate">{i.contact.company || i.contact.name}</span>
              </span>
              <span className="text-left shrink-0">
                <span className="block text-[12.5px] font-bold">{formatToman(i.total)}</span>
                <span className="block text-[11px] text-muted">{formatJalaliDate(i.issuedAt)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
