import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchAccounts, fetchJournalEntry, postJournalEntry, deleteJournalEntry, voidJournalEntry, type Account, type JournalEntry } from "@/lib/api";
import { NewEntryModal } from "./NewEntryModal";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
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
  const [editing, setEditing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchJournalEntry(entryId).then(setEntry);
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
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

          {entry.voidedAt ? (
            <div className="text-[12.5px] text-danger bg-danger-soft rounded-lg p-3">این سند باطل شده است{entry.voidReason ? ` — ${entry.voidReason}` : ""}؛ سند معکوس آن ثبت شده است.</div>
          ) : null}
          {entry.reversalOfId ? <div className="text-[12.5px] text-muted">این سند، سند معکوسِ ابطال یک سند دیگر است.</div> : null}
          {msg ? <div className="text-[12.5px] font-semibold text-ink-soft">{msg}</div> : null}

          {entry.status === "DRAFT" ? (
            <>
              <button
                onClick={handlePost}
                disabled={posting}
                className="w-full py-2.5 rounded-xl bg-success text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {posting ? "در حال ثبت..." : "ثبت قطعی سند"}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(true)} className="text-[12px] font-bold text-primary bg-primary-soft px-3.5 py-2 rounded-lg cursor-pointer">
                  ویرایش پیش‌نویس
                </button>
                <div className="mr-auto">
                  <DeleteRecordButton
                    confirmText="این سند پیش‌نویس حذف شود؟"
                    onDelete={() => deleteJournalEntry(entry.id)}
                    onDeleted={() => {
                      onChanged(entry);
                      onClose();
                    }}
                  />
                </div>
              </div>
            </>
          ) : !entry.voidedAt && !entry.reversalOfId ? (
            <button
              onClick={async () => {
                const reason = window.prompt("دلیل ابطال سند (یک سند معکوس ثبت می‌شود):");
                if (!reason || reason.trim().length < 3) return;
                try {
                  const res = await voidJournalEntry(entry.id, reason.trim());
                  setMsg(res.pendingApproval ? "درخواست ابطال در کارتابل مدیر ثبت شد." : "سند باطل و سند معکوس ثبت شد.");
                  if (!res.pendingApproval) {
                    const fresh = await fetchJournalEntry(entryId);
                    setEntry(fresh);
                    onChanged(fresh);
                  }
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : "ابطال ناموفق بود");
                }
              }}
              className="text-[12px] font-bold text-danger bg-danger-soft px-3.5 py-2 rounded-lg cursor-pointer self-start"
            >
              ابطال سند
            </button>
          ) : null}
          {editing ? (
            <NewEntryModal
              accounts={accounts}
              entry={entry}
              onClose={() => setEditing(false)}
              onCreated={(e) => {
                setEntry(e);
                onChanged(e);
              }}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
