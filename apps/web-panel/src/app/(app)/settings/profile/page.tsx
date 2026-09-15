"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { useWorkspace } from "@/lib/workspace-context";
import { getInitials } from "@/lib/persian";
import { updateMyProfile, ApiError } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProfileSettingsPage() {
  const { me, loading, refreshMe } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!me) return;
    setName(me.user.name ?? "");
    setEmail(me.user.email ?? "");
    setAvatarUrl(me.user.avatarUrl);
  }, [me]);

  function handlePickAvatar() {
    fileInputRef.current?.click();
  }

  async function handleAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setAvatarUrl(dataUrl);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateMyProfile({ name: name.trim(), email: email.trim() || null, avatarUrl });
      refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold">پروفایل من</h1>
      <p className="text-[13.5px] text-muted mt-1">نام، تصویر و ایمیل شخصی شما — این تصویر و نام در همه‌ی محیط‌های کاری شما یکسان است.</p>

      <Card className="mt-6 p-6 max-w-[480px]">
        {loading ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center overflow-hidden shrink-0 text-white font-bold text-lg">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="تصویر پروفایل" className="w-full h-full object-cover" />
                ) : (
                  getInitials(name || me?.user.phone)
                )}
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelected} />
                <button
                  type="button"
                  onClick={handlePickAvatar}
                  className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  {avatarUrl ? "تغییر تصویر" : "بارگذاری تصویر"}
                </button>
                {avatarUrl ? (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    حذف تصویر
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              <label className={labelClass}>نام و نام خانوادگی</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>شماره موبایل</label>
              <input value={me?.user.phone ?? ""} disabled className={inputClass} dir="ltr" />
            </div>

            <div>
              <label className={labelClass}>ایمیل</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@domain.com"
                className={inputClass}
                dir="ltr"
              />
            </div>

            {error ? <div className="text-[12px] text-danger">{error}</div> : null}

            <div className="flex items-center gap-3 mt-1.5">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
              </button>
              {saved ? <span className="text-[12.5px] text-success font-semibold">ذخیره شد ✓</span> : null}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
