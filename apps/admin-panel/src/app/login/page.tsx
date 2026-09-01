"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { adminLogin, setToken, ApiError } from "@/lib/api";
import { persistAdmin } from "@/lib/admin-context";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { accessToken, admin } = await adminLogin(email.trim(), password);
      setToken(accessToken);
      persistAdmin(admin);
      router.replace("/tenants");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white">
            <LogoMark className="w-5 h-5" />
          </div>
          <div className="text-[17px] font-extrabold">پنل مدیریت اکسیر</div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="text-[14px] font-bold mb-1">ورود کارکنان</div>
          <p className="text-[12.5px] text-muted mb-5">فقط برای اعضای تیم مدیریت اکسیر ERP</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ایمیل</label>
              <input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@exir.co"
                className="w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">رمز عبور</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
                dir="ltr"
              />
            </div>
            {error ? <div className="text-[12px] text-danger">{error}</div> : null}
            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? "در حال ورود..." : "ورود"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
