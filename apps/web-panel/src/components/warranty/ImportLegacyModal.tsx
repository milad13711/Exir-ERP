"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { importLegacyWarranties } from "@/lib/api";

const EXPECTED_COLUMNS = [
  "code",
  "itemDescription",
  "invoiceNumber",
  "serialNumber",
  "durationDays",
  "status",
  "issuedAt",
  "activatedAt",
  "expiresAt",
  "clientName",
  "clientPhone",
  "clientEmail",
];

/** پارسر سبک CSV — از کاما به‌عنوان جداکننده و «"..."» برای فیلدهای شامل کاما پشتیبانی می‌کند؛ کتابخانه‌ی جداگانه‌ای برای این کار لازم نیست. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out;
  }

  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

export function ImportLegacyModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0 || !parsed[0].code) {
      setError('فایل نامعتبر است — ستون "code" یافت نشد. یک فایل CSV با سطر عنوان مطابق راهنما آپلود کنید.');
      setRows([]);
      return;
    }
    setRows(parsed);
  }

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await importLegacyWarranties(rows);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "وارد کردن با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title="نتیجه‌ی وارد کردن" onClose={onClose}>
        <div className="text-center py-3">
          <div className="text-2xl font-extrabold text-success">{result.imported} گارانتی وارد شد</div>
          {result.skipped > 0 && <div className="text-[12.5px] text-muted mt-2">{result.skipped} ردیف رد شد (کد تکراری یا خالی)</div>}
        </div>
        <button onClick={onClose} className="w-full mt-3 text-[12.5px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white cursor-pointer">
          بستن
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="وارد کردن گارانتی‌های قدیمی" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-3.5">
        <div className="text-[12.5px] text-ink-soft bg-slate-50 border border-border rounded-xl p-3 leading-6">
          فایل CSV با سطر عنوان (ستون‌ها به این ترتیب، فقط <b dir="ltr">code</b> الزامی است):
          <div className="mt-1.5 font-mono text-[11px] text-muted" dir="ltr">
            {EXPECTED_COLUMNS.join(", ")}
          </div>
        </div>

        <label className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary transition-colors">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <span className="text-[12.5px] text-ink-soft">{fileName ?? "برای انتخاب فایل CSV کلیک کنید"}</span>
        </label>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        {rows.length > 0 && <div className="text-[12.5px] text-success">{rows.length} ردیف شناسایی شد</div>}

        <button
          onClick={handleImport}
          disabled={rows.length === 0 || busy}
          className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? "در حال وارد کردن..." : `وارد کردن ${rows.length ? rows.length + " ردیف" : ""}`}
        </button>
      </div>
    </Modal>
  );
}
