"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchMyResellerProfile, updateMyResellerProfile, ApiError, type Reseller } from "@/lib/api";

const FIELD = "w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary";

/** عکس را قبل از ارسال به ۴۰۰×۴۰۰ (مربع، برش مرکزی) کوچک و JPEG می‌کند تا داخل data URI جا شود. */
async function resizeToSquareDataUrl(file: File, size = 400): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** پروفایل عمومی نماینده: عکس، معرفی و شهر — همین اطلاعات روی نقشه‌ی همکاران eta.co.ir پین می‌شود. */
export function MyProfileCard() {
  const [profile, setProfile] = useState<Reseller | null>(null);
  const [photo, setPhoto] = useState<string | undefined>();
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [company, setCompany] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchMyResellerProfile().then((p) => {
      setProfile(p);
      setBio(p.bio ?? "");
      setCity(p.city ?? "");
      setCompany(p.contact.company ?? "");
      setWebsiteUrl(p.websiteUrl ?? "");
      setAddress(p.contact.address ?? "");
    });
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await updateMyResellerProfile({ logoUrl: photo, bio, city, company, websiteUrl, address });
      setProfile(updated);
      setPhoto(undefined);
      setMsg("ذخیره شد؛ اطلاعات شما روی نقشه‌ی همکاران به‌روز شد ✓");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;
  const shown = photo ?? profile.logoUrl;

  return (
    <Card className="p-5">
      <div className="text-[13.5px] font-extrabold mb-1">پروفایل من روی نقشه‌ی همکاران</div>
      <p className="text-[12px] text-muted mb-4 leading-relaxed">
        {profile.isVerified ? "شما تأیید شده‌اید و با شهر ثبت‌شده روی نقشه‌ی eta.co.ir پین هستید." : "بعد از تأیید مدیریت روی نقشه نمایش داده می‌شوید."} عکس و معرفی خود را کامل کنید.
      </p>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex flex-col items-center gap-2">
          <div className="w-24 h-24 rounded-2xl bg-slate-100 border border-border overflow-hidden flex items-center justify-center text-muted text-[11px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shown ? <img src={shown} alt="عکس من" className="w-full h-full object-cover" /> : "بدون عکس"}
          </div>
          <label className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer">
            {shown ? "تغییر عکس" : "بارگذاری عکس"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await resizeToSquareDataUrl(f));
              }}
            />
          </label>
        </div>
        <div className="flex-1 min-w-[260px] grid sm:grid-cols-2 gap-2.5">
          <input className={FIELD} placeholder="نام شرکت/دفتر" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className={FIELD} placeholder="شهر (محل پین روی نقشه)" value={city} onChange={(e) => setCity(e.target.value)} />
          <input className={FIELD} placeholder="وب‌سایت" dir="ltr" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          <input className={FIELD} placeholder="آدرس دفتر" value={address} onChange={(e) => setAddress(e.target.value)} />
          <textarea className={`${FIELD} sm:col-span-2`} rows={3} maxLength={600} placeholder="معرفی کوتاه شما و خدماتی که ارائه می‌دهید" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
      </div>
      {msg && <div className="text-[12.5px] font-semibold text-ink-soft mt-3">{msg}</div>}
      <button onClick={save} disabled={busy} className="mt-3 text-[13px] font-bold px-5 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer">
        {busy ? "در حال ذخیره..." : "ذخیره پروفایل"}
      </button>
    </Card>
  );
}
