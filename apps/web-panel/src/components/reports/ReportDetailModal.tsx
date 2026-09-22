"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { toPersianDigits, formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import {
  fetchReport,
  updateReport,
  deleteReport,
  archiveReport,
  unarchiveReport,
  convertReportToKnowledge,
  unconvertReportKnowledge,
  referReport,
  paraphReportReferral,
  fetchReportCategories,
  fetchUsers,
  ApiError,
  type Report,
  type ReportCategory,
  type TenantUser,
} from "@/lib/api";

export function ReportDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editExecutionAt, setEditExecutionAt] = useState("");

  const [referOpen, setReferOpen] = useState(false);
  const [referTo, setReferTo] = useState<string[]>([]);
  const [referNote, setReferNote] = useState("");
  const [referCc, setReferCc] = useState("");

  function reload() {
    fetchReport(id).then(setReport);
  }
  useEffect(reload, [id]);
  useEffect(() => {
    fetchReportCategories().then(setCategories);
    fetchUsers().then(setUsers);
  }, []);

  function startEdit() {
    if (!report) return;
    setEditTitle(report.title);
    setEditBody(report.body);
    setEditCategoryId(report.categoryId ?? "");
    setEditExecutionAt(report.executionAt ? report.executionAt.slice(0, 10) : "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!editTitle.trim() || !editBody.trim()) return;
    setBusy(true);
    try {
      await updateReport(id, {
        title: editTitle.trim(),
        body: editBody.trim(),
        categoryId: editCategoryId || undefined,
        executionAt: editExecutionAt || undefined,
      });
      setEditing(false);
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("این گزارش حذف شود؟")) return;
    await deleteReport(id);
    onChanged();
    onClose();
  }

  async function toggleArchive() {
    if (!report) return;
    setBusy(true);
    try {
      await (report.isArchived ? unarchiveReport(id) : archiveReport(id));
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleKnowledge() {
    if (!report) return;
    setBusy(true);
    try {
      await (report.isKnowledge ? unconvertReportKnowledge(id) : convertReportToKnowledge(id));
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleRefer(e: React.FormEvent) {
    e.preventDefault();
    if (referTo.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await referReport(id, {
        toUserIds: referTo,
        note: referNote.trim() || undefined,
        emailCc: referCc
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setReferOpen(false);
      setReferTo([]);
      setReferNote("");
      setReferCc("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارجاع ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleParaph(referralId: string) {
    await paraphReportReferral(id, referralId);
    reload();
  }

  if (!report) {
    return (
      <Modal title="جزئیات گزارش" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={`گزارش شماره ${toPersianDigits(report.reportNo)}`} onClose={onClose} width="max-w-[620px]">
      <div className="flex flex-col gap-4">
        {editing ? (
          <div className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="عنوان گزارش"
              className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
            />
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={5}
              className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2 resize-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(e.target.value)}
                className="text-[12.5px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none"
              >
                <option value="">بدون دسته‌بندی</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                dir="ltr"
                value={editExecutionAt}
                onChange={(e) => setEditExecutionAt(e.target.value)}
                className="text-[12.5px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
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
                disabled={busy || !editTitle.trim() || !editBody.trim()}
                className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {busy ? "در حال ذخیره..." : "ذخیره"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold break-words">{report.title}</div>
                <div className="text-[12px] text-muted mt-1 flex items-center gap-2 flex-wrap">
                  <span>{report.category?.name ?? "بدون دسته‌بندی"}</span>
                  {report.executionAt && <span>· زمان اجرا: {formatJalaliDate(report.executionAt)}</span>}
                  {report.createdBy && <span>· ثبت‌کننده: {report.createdBy.name}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {report.isKnowledge && <Badge tone="primary">دانش سازمانی</Badge>}
                {report.isArchived && <Badge tone="neutral">آرشیو</Badge>}
              </div>
            </div>
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap bg-slate-50 border border-border rounded-xl p-3.5 mt-3">
              {report.body}
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button
                type="button"
                onClick={startEdit}
                className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
              >
                ویرایش
              </button>
              <button
                type="button"
                onClick={() => setReferOpen((v) => !v)}
                className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
              >
                {report.referrals.length > 0 ? "ارجاع مجدد" : "ارجاع"}
              </button>
              <button
                type="button"
                onClick={toggleArchive}
                disabled={busy}
                className="text-[11px] font-bold text-ink-soft bg-slate-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {report.isArchived ? "خروج از آرشیو" : "آرشیو"}
              </button>
              <button
                type="button"
                onClick={toggleKnowledge}
                disabled={busy}
                className="text-[11px] font-bold text-ink-soft bg-slate-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {report.isKnowledge ? "خروج از دانش سازمانی" : "تبدیل به دانش سازمانی"}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
              >
                حذف
              </button>
            </div>
          </div>
        )}

        {referOpen && (
          <form onSubmit={handleRefer} className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
            <div className="text-[12px] font-semibold text-ink-soft">ارجاع به:</div>
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => {
                const checked = referTo.includes(u.id);
                return (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => setReferTo((prev) => (checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]))}
                    className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border ${
                      checked ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"
                    }`}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
            <input
              value={referNote}
              onChange={(e) => setReferNote(e.target.value)}
              placeholder="یادداشت ارجاع (اختیاری)"
              className="text-[12.5px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none"
            />
            <input
              value={referCc}
              onChange={(e) => setReferCc(e.target.value)}
              placeholder="رونوشت ایمیل، با کاما جدا کنید (اختیاری)"
              dir="ltr"
              className="text-[12.5px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none"
            />
            {error && <div className="text-[12px] text-danger">{error}</div>}
            <button
              type="submit"
              disabled={busy || referTo.length === 0}
              className="self-end text-[12px] font-bold text-white bg-primary px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
            >
              ارسال ارجاع
            </button>
          </form>
        )}

        <AttachmentsSection entityType="Report" entityId={report.id} />

        <div>
          <div className="text-[12px] text-muted mb-2">تاریخچه‌ی ارجاع‌ها ({toPersianDigits(report.referrals.length)})</div>
          {report.referrals.length === 0 ? (
            <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
              هنوز ارجاع نشده است
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {report.referrals.map((ref) => (
                <div key={ref.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold break-words">
                      {ref.fromUser?.name ?? "—"} ← {ref.toUser.name}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 break-words">
                      {formatJalaliDateTime(ref.createdAt)}
                      {ref.note ? ` · ${ref.note}` : ""}
                    </div>
                  </div>
                  {ref.paraphed ? (
                    <Badge tone="success">پاراف‌شده</Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleParaph(ref.id)}
                      className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer shrink-0"
                    >
                      پاراف
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
