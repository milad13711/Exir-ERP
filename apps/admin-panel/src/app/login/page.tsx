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
    <div className="flex-1 grid lg:grid-cols-2 min-h-dvh">
      <div className="hidden lg:flex relative flex-col items-center justify-center gap-6 bg-gradient-to-br from-[#0a1f6b] via-[#1a45c8] to-[#0284c7] text-white p-12 overflow-hidden">
        <div className="absolute -top-24 -start-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -end-16 w-96 h-96 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative w-40 h-40 rounded-[2rem] bg-white shadow-2xl flex items-center justify-center">
          <LogoMark className="w-28 h-auto" />
        </div>
        <div className="relative text-center">
          <div className="text-3xl font-extrabold tracking-tight">اکسیر ERP</div>
          <p className="text-white/75 text-[14px] mt-2 max-w-[320px] leading-7">کنسول مدیریت تننت‌ها، اشتراک‌ها، پشتیبانی و فروش</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-5 sm:p-8 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex flex-col items-center gap-3 mb-8">
            <div className="w-20 h-20 rounded-3xl bg-white border border-border shadow-lg flex items-center justify-center">
              <LogoMark className="w-14 h-auto" />
            </div>
            <div className="text-[19px] font-extrabold tracking-tight">پنل مدیریت اکسیر</div>
          </div>

          <div className="bg-surface border border-border rounded-3xl p-6 sm:p-7 shadow-[0_8px_40px_-12px_rgba(16,24,40,0.15)]">
            <div className="text-[17px] font-extrabold mb-1">ورود کارکنان</div>
            <p className="text-[12.5px] text-muted mb-6">فقط برای اعضای تیم مدیریت اکسیر ERP</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ایمیل</label>
                <input
                  type="email"
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@exir.co"
                  className="w-full text-[14px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary focus:bg-white transition-colors"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">رمز عبور</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-[14px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-4 py-3 focus:border-primary focus:bg-white transition-colors"
                  dir="ltr"
                />
              </div>
              {error ? <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl px-3.5 py-2.5">{error}</div> : null}
              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                className="mt-1 w-full py-3 rounded-xl bg-primary hover:bg-primary-dark transition-colors text-white text-[14px] font-bold cursor-pointer disabled:opacity-50 shadow-[0_6px_16px_-6px_rgba(26,69,200,0.6)]"
              >
                {submitting ? "در حال ورود..." : "ورود"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
