import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchReceivables,
  fetchPayables,
  fetchAccountingPartyStatement,
  downloadExcelFile,
  type PartyBalance,
  type AccountingPartyStatement,
} from "@/lib/api";

const KIND_LABELS: Record<string, string> = {
  SALES_INVOICE: "فاکتور فروش",
  SALES_PAYMENT: "دریافت وجه فروش",
  SALES_RETURN: "مرجوعی فروش",
  PURCHASE_ORDER: "سفارش خرید",
  PURCHASE_PAYMENT: "پرداخت وجه خرید",
  PURCHASE_RETURN: "مرجوعی خرید",
  PARTY_RECEIPT: "دریافت وجه",
  PARTY_PAYMENT: "پرداخت وجه",
  CHECK_RECEIVED: "چک دریافتی",
  CHECK_ISSUED: "چک صادرشده",
};

function PartyStatementModal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [statement, setStatement] = useState<AccountingPartyStatement | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchAccountingPartyStatement(contactId).then(setStatement).catch(() => setStatement(null));
  }, [contactId]);

  async function handleExport() {
    if (!statement) return;
    setExporting(true);
    try {
      await downloadExcelFile(
        `/accounting/parties/${contactId}/statement/export`,
        `statement-${statement.contact.name}.xlsx`,
      );
    } finally {
      setExporting(false);
    }
  }

  let arRunning = 0;
  let apRunning = 0;

  return (
    <Modal title={statement ? `گردش حساب — ${statement.contact.name}` : "گردش حساب"} onClose={onClose} width="max-w-[640px]">
      {!statement ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
            <div>
              <div className="text-[11px] text-muted">مانده بدهکاری (طلب ما از او)</div>
              <div className={`text-[13px] font-bold mt-0.5 ${statement.arBalance > 0 ? "text-danger" : ""}`}>
                {formatToman(statement.arBalance)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">مانده بستانکاری (بدهی ما به او)</div>
              <div className={`text-[13px] font-bold mt-0.5 ${statement.apBalance > 0 ? "text-danger" : ""}`}>
                {formatToman(statement.apBalance)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            >
              خروجی اکسل
            </button>
          </div>

          <div className="flex flex-col max-h-[360px] overflow-y-auto">
            {statement.lines.length === 0 ? (
              <div className="py-8 text-center text-muted text-sm">هنوز تحرکی ثبت نشده است</div>
            ) : (
              statement.lines.map((l, i) => {
                arRunning += l.arDelta;
                apRunning += l.apDelta;
                const isAr = l.arDelta !== 0;
                const delta = isAr ? l.arDelta : l.apDelta;
                const runningBalance = isAr ? arRunning : apRunning;
                return (
                  <div
                    key={`${l.kind}-${l.refId}-${i}`}
                    className={`flex items-center justify-between gap-3 px-1 py-2.5 text-[12.5px] ${
                      i < statement.lines.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{KIND_LABELS[l.kind] ?? l.kind}</div>
                      <div className="text-[11px] text-muted mt-0.5">{formatJalaliDate(l.date)}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className={delta > 0 ? "text-danger font-bold" : delta < 0 ? "text-success font-bold" : "text-muted"}>
                        {delta !== 0 ? formatToman(delta) : "—"}
                        <span className="text-[10px] text-muted font-normal"> ({isAr ? "فروش" : "خرید"})</span>
                      </div>
                      <div className="text-[10.5px] text-muted mt-0.5">
                        مانده {isAr ? "بدهکاری" : "بستانکاری"}: {formatToman(runningBalance)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PartyBalanceList({
  title,
  rows,
  tone,
  exportPath,
  exportFilename,
  onOpenStatement,
}: {
  title: string;
  rows: PartyBalance[] | null;
  tone: "danger" | "success";
  exportPath: string;
  exportFilename: string;
  onOpenStatement: (id: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const total = (rows ?? []).reduce((s, r) => s + r.balance, 0);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadExcelFile(exportPath, exportFilename);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <div className="text-[13.5px] font-bold">{title}</div>
          <div className={`text-[12px] font-bold mt-0.5 ${tone === "danger" ? "text-danger" : "text-success"}`}>
            جمع: {formatToman(total)}
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || (rows ?? []).length === 0}
          className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          خروجی اکسل
        </button>
      </div>
      <Card className="p-2">
        {rows === null ? (
          <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">موردی یافت نشد</div>
        ) : (
          rows.map((r, i) => (
            <button
              key={r.id}
              onClick={() => onOpenStatement(r.id)}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                i < rows.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="text-[13px] font-bold truncate">{r.name}</div>
                {r.company ? <div className="text-[11px] text-muted mt-0.5 truncate">{r.company}</div> : null}
              </div>
              <div className={`text-[13px] font-extrabold shrink-0 ${tone === "danger" ? "text-danger" : "text-success"}`}>
                {formatToman(r.balance)}
              </div>
            </button>
          ))
        )}
      </Card>
    </div>
  );
}

export function PartiesLedgerTab() {
  const [receivables, setReceivables] = useState<PartyBalance[] | null>(null);
  const [payables, setPayables] = useState<PartyBalance[] | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  useEffect(() => {
    fetchReceivables().then(setReceivables).catch(() => setReceivables([]));
    fetchPayables().then(setPayables).catch(() => setPayables([]));
  }, []);

  return (
    <div className="mt-5 grid sm:grid-cols-2 gap-6">
      <PartyBalanceList
        title="بدهکاران (طلب ما از مشتریان)"
        rows={receivables}
        tone="danger"
        exportPath="/accounting/parties/receivables/export"
        exportFilename="receivables.xlsx"
        onOpenStatement={setOpenContactId}
      />
      <PartyBalanceList
        title="بستانکاران (طلب تأمین‌کنندگان از ما)"
        rows={payables}
        tone="success"
        exportPath="/accounting/parties/payables/export"
        exportFilename="payables.xlsx"
        onOpenStatement={setOpenContactId}
      />
      {openContactId ? <PartyStatementModal contactId={openContactId} onClose={() => setOpenContactId(null)} /> : null}
    </div>
  );
}
