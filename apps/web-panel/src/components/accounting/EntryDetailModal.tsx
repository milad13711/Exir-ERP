import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchJournalEntry, postJournalEntry, type JournalEntry } from "@/lib/api";
import { ENTRY_STATUS_LABELS, ENTRY_STATUS_TONES } from "./accounting-shared";

export function EntryDetailModal({
  entryId,
  onClose,
  onChanged,
}: {
  entryId: string;
  onClose: () => void;
  onChanged: (entry: JournalEntry) => void;
}) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchJournalEntry(entryId).then(setEntry);
  }, [entryId]);

  async function handlePost() {
    setPosting(true);
    try {
      const posted = await postJournalEntry(entryId);
      setEntry(posted);
      onChanged(posted);
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal title="سند حسابداری" onClose={onClose} width="max-w-[560px]">
      {!entry ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold">سند شماره {toPersianDigits(entry.number)}</div>
              <div className="text-[12px] text-muted mt-1">
                {formatJalaliDate(entry.date)} · {entry.createdBy?.name ?? "—"}
              </div>
            </div>
            <Badge tone={ENTRY_STATUS_TONES[entry.status]}>{ENTRY_STATUS_LABELS[entry.status]}</Badge>
          </div>

          {entry.description ? <p className="text-[13px] text-ink-soft leading-6">{entry.description}</p> : null}

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[12px] min-w-[440px]">
              <thead>
                <tr className="text-muted border-b border-border">
                  <th className="text-right font-semibold py-2 px-1">حساب</th>
                  <th className="text-right font-semibold py-2 px-1">شرح</th>
                  <th className="text-left font-semibold py-2 px-1">بدهکار</th>
                  <th className="text-left font-semibold py-2 px-1">بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 px-1 font-semibold">
                      {toPersianDigits(l.account.code)} {l.account.name}
                    </td>
                    <td className="py-2.5 px-1 text-muted">{l.description ?? "—"}</td>
                    <td className="py-2.5 px-1 text-left">{l.debit ? formatToman(l.debit) : "—"}</td>
                    <td className="py-2.5 px-1 text-left">{l.credit ? formatToman(l.credit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {entry.status === "DRAFT" ? (
            <button
              onClick={handlePost}
              disabled={posting}
              className="w-full py-2.5 rounded-xl bg-success text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              {posting ? "در حال ثبت..." : "ثبت قطعی سند"}
            </button>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
