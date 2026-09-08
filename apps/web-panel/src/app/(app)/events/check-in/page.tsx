"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CheckIcon, WarningIcon } from "@/components/icons";
import { checkInEventTicket, ApiError, type EventTicket } from "@/lib/api";

type Result = { ok: boolean; message: string; ticket?: EventTicket & { alreadyCheckedIn: boolean; event: { title: string }; ticketType: { name: string } } };

export default function EventCheckInPage() {
  const scannerElRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: import("html5-qrcode").Html5QrcodeScanner | null = null;
    let cancelled = false;

    import("html5-qrcode").then(({ Html5QrcodeScanner }) => {
      if (cancelled || !scannerElRef.current) return;
      scanner = new Html5QrcodeScanner(
        scannerElRef.current.id,
        { fps: 10, qrbox: { width: 240, height: 240 } },
        false,
      );
      scanner.render(
        async (decodedText) => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          try {
            const ticket = await checkInEventTicket(decodedText);
            setResult({
              ok: true,
              message: ticket.alreadyCheckedIn ? "این بلیط قبلاً ثبت حضور شده بود" : "حضور با موفقیت ثبت شد",
              ticket,
            });
          } catch (err) {
            setResult({ ok: false, message: err instanceof ApiError ? err.message : "این بلیط معتبر نیست" });
          } finally {
            setTimeout(() => {
              busyRef.current = false;
              setBusy(false);
            }, 1500);
          }
        },
        () => {
          // خطای رمزگشایی فریم به فریم — نویز عادی دوربین است، نیازی به نمایش نیست
        },
      );
    }).catch(() => setCameraError("بارگذاری اسکنر ناموفق بود"));

    return () => {
      cancelled = true;
      scanner?.clear().catch(() => {});
    };
  }, []);

  return (
    <div className="p-5 lg:p-7 max-w-[520px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold">ثبت حضور با اسکن بلیط</h1>
        <Link href="/events" className="text-[12.5px] font-bold text-primary">
          بازگشت
        </Link>
      </div>
      <p className="text-[13px] text-muted mb-4">دوربین گوشی/لپ‌تاپ را روی QR بلیط بگیرید — به دسترسی دوربین نیاز دارید.</p>

      <Card className="p-3 overflow-hidden">
        <div id="event-qr-reader" ref={scannerElRef} />
        {cameraError && <div className="p-4 text-center text-danger text-[12.5px]">{cameraError}</div>}
      </Card>

      {result && (
        <div className={`mt-4 rounded-2xl p-4 flex items-start gap-3 ${result.ok ? "bg-success-soft" : "bg-danger-soft"}`}>
          {result.ok ? <CheckIcon className="w-5 h-5 text-success shrink-0 mt-0.5" /> : <WarningIcon className="w-5 h-5 text-danger shrink-0 mt-0.5" />}
          <div>
            <div className={`text-[13px] font-bold ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</div>
            {result.ticket && (
              <div className="text-[12px] text-ink-soft mt-1">
                {result.ticket.attendeeName} · {result.ticket.event.title} · {result.ticket.ticketType.name}
              </div>
            )}
          </div>
        </div>
      )}
      {busy && <div className="text-center text-[12px] text-muted mt-2">در حال بررسی...</div>}
    </div>
  );
}
