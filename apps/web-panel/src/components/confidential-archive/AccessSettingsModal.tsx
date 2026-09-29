"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  fetchArchiveAccessList,
  setArchiveAccess,
  revokeArchiveAccess,
  fetchUsers,
  ApiError,
  type ConfidentialArchiveAccessRow,
  type TenantUser,
} from "@/lib/api";

/** فقط مالک/مدیر — لیست/اعطا/لغو دسترسی مشاهده یا ویرایشِ آرشیو، بدون نیاز به OTP (این یک اقدام تنظیماتی است، نه مشاهده‌ی محتوا). */
export function AccessSettingsModal({ onClose }: { onClose: () => void }) {
  const [access, setAccess] = useState<ConfidentialArchiveAccessRow[] | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedCanEdit, setSelectedCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  function reload() {
    fetchArchiveAccessList().then(setAccess).catch(() => setAccess([]));
  }

  useEffect(() => {
    reload();
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const grantedIds = new Set((access ?? []).map((a) => a.userId));
  const grantableUsers = users.filter((u) => !grantedIds.has(u.id));

  async function grant() {
    if (!selectedUserId) return;
    setBusyUserId(selectedUserId);
    setError(null);
    try {
      await setArchiveAccess(selectedUserId, selectedCanEdit);
      setSelectedUserId("");
      setSelectedCanEdit(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "اعطای دسترسی ناموفق بود");
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleEdit(row: ConfidentialArchiveAccessRow) {
    setBusyUserId(row.userId);
    try {
      await setArchiveAccess(row.userId, !row.canEdit);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "به‌روزرسانی ناموفق بود");
    } finally {
      setBusyUserId(null);
    }
  }

  async function revoke(userId: string) {
    setBusyUserId(userId);
    try {
      await revokeArchiveAccess(userId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "لغو دسترسی ناموفق بود");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <Modal title="مدیریت دسترسی آرشیو" onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-6">
          فقط کاربرانی که اینجا اضافه می‌کنید (به‌علاوه‌ی مالک و مدیران که همیشه دسترسی کامل دارند) می‌توانند بعد از تأیید کد پیامکی وارد آرشیو شوند.
        </p>
        {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

        <div className="flex items-center gap-2">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
          >
            <option value="">انتخاب کاربر…</option>
            {grantableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] font-bold text-ink-soft whitespace-nowrap">
            <input type="checkbox" checked={selectedCanEdit} onChange={(e) => setSelectedCanEdit(e.target.checked)} />
            ویرایش
          </label>
          <button
            onClick={grant}
            disabled={!selectedUserId || busyUserId === selectedUserId}
            className="text-[12.5px] font-bold text-white bg-primary px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            افزودن
          </button>
        </div>

        <div className="border border-border rounded-xl overflow-hidden">
          {(access ?? []).length === 0 ? (
            <div className="text-[12.5px] text-muted text-center py-6">هنوز دسترسی‌ای اعطا نشده</div>
          ) : (
            access!.map((row, i) => (
              <div
                key={row.id}
                className={`flex items-center gap-3 px-4 py-3 ${i < access!.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="flex-1 text-[13px] font-bold">{row.user.name}</div>
                <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={row.canEdit}
                    disabled={busyUserId === row.userId}
                    onChange={() => toggleEdit(row)}
                  />
                  ویرایش
                </label>
                <button
                  onClick={() => revoke(row.userId)}
                  disabled={busyUserId === row.userId}
                  className="text-[12px] font-bold text-danger cursor-pointer disabled:opacity-60"
                >
                  لغو دسترسی
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
