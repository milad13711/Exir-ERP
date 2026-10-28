"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { osmLink, type SignatureEvidenceRecord } from "@/lib/signature-evidence";

const GEO_LABEL = { granted: "ثبت شد", denied: "کاربر اجازه نداد", unavailable: "در دسترس نبود" } as const;
const ACTION_LABEL: Record<string, string> = {
  company_sign: "امضای شرکت",
  public_sign: "امضا از لینک عمومی",
  public_accept: "پذیرش از لینک عمومی",
  invoice_sign: "امضای فاکتور",
  invoice_sign_signature: "امضای فاکتور از کارتابل (امضا)",
  invoice_sign_stamp_and_signature: "امضای فاکتور از کارتابل (مهر و امضای شرکت)",
  delivery_confirm_signature: "تأیید تحویل با امضا",
  delivery_confirm_code: "تأیید تحویل با کد",
  consent_sign: "امضای رضایت‌نامه",
  lab_confirm_receipt: "تأیید دریافت نمونه",
  approve_with_stamp: "تأیید همراه مهر و امضا",
};

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-[12px]">
      <span className="text-ink-soft">{k}:</span>
      <span className="break-all text-ink">{children}</span>
    </div>
  );
}

/** نمای فقط‌خواندنی مدرک حقوقی امضاها (برای مدیر) — IP، دستگاه، زمان، موقعیت، هش‌ها و سلامت هش یکپارچگی. */
export function SignatureEvidencePanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [rows, setRows] = useState<SignatureEvidenceRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<SignatureEvidenceRecord[]>(`/signature-evidence?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  // کاربر بدون دسترسی/خطا: بخش ساکت پنهان می‌ماند (مدرک اختیاری و مخصوص مدیر است)
  if (failed || !rows || rows.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="مدرک حقوقی امضا">
      <h3 className="text-sm font-bold text-ink">مدرک حقوقی امضا</h3>
      {rows.map((r) => (
        <div key={r.id} className="space-y-1 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold">{r.signerName ?? "—"}</span>
            <Badge tone="primary">{ACTION_LABEL[r.action] ?? r.action}</Badge>
            {r.device?.verification === "link_only" && <Badge tone="warning">تأیید هویت نشده (فقط دارنده‌ی لینک)</Badge>}
            <Badge tone={r.integrityOk ? "success" : "danger"}>{r.integrityOk ? "یکپارچگی تأیید شد" : "هشدار: دستکاری یا نبود کلید"}</Badge>
          </div>
          <Row k="زمان سرور (تهران)">{r.device?.serverTimeTehran ?? formatJalaliDateTime(r.serverTime)}</Row>
          <Row k="زمان سرور (UTC)">{r.device?.serverTimeUtc ?? r.serverTime}</Row>
          {r.clientTime && <Row k="زمان دستگاه">{formatJalaliDateTime(r.clientTime)}</Row>}
          {r.signerPhone && <Row k="تلفن">{toPersianDigits(r.signerPhone)}</Row>}
          <Row k="آی‌پی"><span dir="ltr">{r.ip ?? "—"}</span></Row>
          <Row k="دستگاه">
            {[r.device?.deviceType, r.device?.os, r.device?.browser && `${r.device.browser} ${r.device.browserVersion ?? ""}`, r.device?.language, r.device?.timezone, r.device?.screen && `${r.device.screen.w}×${r.device.screen.h}`, r.device?.touch ? "لمسی" : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Row>
          <Row k="موقعیت مکانی">
            {GEO_LABEL[r.geoStatus]}
            {r.geoStatus === "granted" && r.lat != null && r.lng != null && (
              <>
                {" — "}
                <a className="text-primary underline" href={osmLink(r.lat, r.lng)} target="_blank" rel="noopener noreferrer" dir="ltr">
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                </a>
                {r.geoAccuracy != null && <span> (±{toPersianDigits(Math.round(r.geoAccuracy))} متر)</span>}
              </>
            )}
          </Row>
          {r.contentHash && <Row k="هش محتوا"><span dir="ltr" className="font-mono text-[11px]">{r.contentHash}</span></Row>}
          {r.signatureHash && <Row k="هش امضا"><span dir="ltr" className="font-mono text-[11px]">{r.signatureHash}</span></Row>}
          <Row k="هش یکپارچگی"><span dir="ltr" className="font-mono text-[11px]">{r.integrityHash}</span></Row>
          {r.userAgent && <Row k="User-Agent"><span dir="ltr" className="text-[11px]">{r.userAgent}</span></Row>}
        </div>
      ))}
    </section>
  );
}
