"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ListSkeleton } from "@/components/ui/EmptyState";
import { BTN_GHOST, BTN_PRIMARY } from "@/components/ui/styles";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchBackupStatus, runBackupNow, runRestoreTestNow, type BackupStatusResponse } from "@/lib/api";

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${toPersianDigits(v.toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

function ageHours(iso?: string): number | null {
  return iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null;
}

/** وضعیت بکاپ و بازیابی — فقط مدیر ارشد. بکاپ‌ها داده‌ی همه‌ی تننت‌ها را دارند. */
export default function BackupsPage() {
  const [data, setData] = useState<BackupStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"run" | "test" | null>(null);

  const load = useCallback(() => {
    fetchBackupStatus()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function trigger(kind: "run" | "test") {
    setBusy(kind);
    try {
      await (kind === "run" ? runBackupNow() : runRestoreTestNow());
      setTimeout(load, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
        <PageHeader title="بکاپ و بازیابی" />
        <p className="text-[13px] text-danger mt-6">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
        <PageHeader title="بکاپ و بازیابی" />
        <div className="mt-6">
          <ListSkeleton />
        </div>
      </div>
    );
  }

  const disk = data.disk;
  const t = data.lastRestoreTest;
  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
      <PageHeader title="بکاپ و بازیابی" subtitle="وضعیت بکاپ روزانه، رمزنگاری، کپی خارج از سرور و آخرین آزمون بازیابی" />

      <div className="flex gap-2 flex-wrap mt-5">
        <button className={BTN_PRIMARY} disabled={!!data.running || busy !== null} onClick={() => trigger("run")}>
          {data.running === "backup" ? "در حال بکاپ…" : "اجرای بکاپ همین حالا"}
        </button>
        <button className={BTN_GHOST} disabled={!!data.running || busy !== null} onClick={() => trigger("test")}>
          {data.running === "restore-test" ? "در حال آزمون…" : "اجرای آزمون بازیابی"}
        </button>
      </div>
      {error && <p className="text-[12.5px] text-danger mt-3">{error}</p>}

      {data.warnings.length > 0 ? (
        <Card className="p-4 mt-5 border-warning">
          <div className="text-[13px] font-extrabold text-warning mb-2">هشدارها</div>
          <ul className="list-disc ps-5 space-y-1 text-[12.5px] text-ink-soft leading-relaxed">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="p-4 mt-5">
          <Badge tone="success">همه‌چیز سالم است</Badge>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <Card className="p-4">
          <div className="text-[12px] text-muted mb-1.5">رمزنگاری</div>
          <Badge tone={data.encryption.keyConfigured ? "success" : "danger"}>{data.encryption.keyConfigured ? "فعال (AES-256-GCM)" : "غیرفعال"}</Badge>
          <div className="text-[11.5px] text-muted mt-2">{data.encryption.required ? "الزامی (بدون کلید بکاپ نوشته نمی‌شود)" : "غیرالزامی"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] text-muted mb-1.5">کپی خارج از سرور</div>
          <Badge tone={data.offsite.configured ? (data.offsite.lastError ? "danger" : "success") : "danger"}>
            {data.offsite.configured ? (data.offsite.lastError ? "خطا" : "فعال") : "تنظیم نشده"}
          </Badge>
          <div className="text-[11.5px] text-muted mt-2 break-all" dir="ltr">
            {data.offsite.destination ?? "—"}
          </div>
          <div className="text-[11.5px] text-muted mt-1">آخرین موفق: {data.offsite.lastOkAt ? formatJalaliDateTime(data.offsite.lastOkAt) : "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] text-muted mb-1.5">فضای اشغال‌شده</div>
          <div className="text-[18px] font-extrabold">{formatBytes(disk.backupBytes)}</div>
          <div className="text-[11.5px] text-muted mt-2">آزاد روی دیسک: {formatBytes(disk.freeBytes)}</div>
          <div className="text-[11.5px] text-muted mt-1">
            نگهداری: {toPersianDigits(data.retention.daily)} روزانه، {toPersianDigits(data.retention.weekly)} هفتگی، {toPersianDigits(data.retention.monthly)} ماهانه
          </div>
        </Card>
      </div>

      <Card className="p-4 mt-5">
        <div className="text-[13px] font-extrabold mb-2">آخرین آزمون بازیابی کامل</div>
        {t ? (
          <div className="flex items-center gap-3 flex-wrap text-[12.5px]">
            <Badge tone={t.ok ? "success" : "danger"}>{t.ok ? "موفق" : "ناموفق"}</Badge>
            <span>{t.target === "_control" ? "دیتابیس کنترل" : t.target}</span>
            <span className="text-muted">{formatJalaliDateTime(t.at)}</span>
            <span className="text-muted" dir="ltr">
              {t.detail}
            </span>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">هنوز آزمونی انجام نشده (هر یکشنبه ساعت ۰۴:۰۰ خودکار اجرا می‌شود).</p>
        )}
      </Card>

      <div className="text-[13px] font-extrabold mt-6 mb-2">دیتابیس‌ها</div>
      <div className="flex flex-col gap-2">
        {data.targets.map((x) => {
          const age = ageHours(x.lastSuccessAt);
          const inactive = x.active === false;
          const stale = !inactive && (age === null || age > 26);
          return (
            <Card key={x.name} className={`p-3.5 ${inactive ? "opacity-70" : ""}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[13px] font-bold">{x.kind === "control" ? "دیتابیس کنترل (پلتفرم)" : x.name}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {inactive ? (
                    <Badge tone="neutral">تننت غیرفعال — بکاپ نمی‌شود</Badge>
                  ) : (
                    <>
                      <Badge tone={stale ? "danger" : "success"}>{x.lastSuccessAt ? formatJalaliDateTime(x.lastSuccessAt) : "بدون بکاپ موفق"}</Badge>
                      <Badge tone={x.encrypted ? "success" : "danger"}>{x.encrypted ? "رمزنگاری‌شده" : "بدون رمزنگاری"}</Badge>
                      <Badge tone={x.offsite ? "success" : "warning"}>{x.offsite ? "خارج از سرور ✓" : "فقط محلی"}</Badge>
                    </>
                  )}
                </div>
              </div>
              <div className="text-[11.5px] text-muted mt-1.5">
                {toPersianDigits(x.fileCount)} فایل · {formatBytes(x.bytes)} · آخرین حجم {formatBytes(x.lastSize)}
              </div>
              {x.lastError && x.lastErrorAt && (!x.lastSuccessAt || x.lastErrorAt > x.lastSuccessAt) && (
                <div className="text-[11.5px] text-danger mt-1.5 break-words">آخرین خطا: {x.lastError}</div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
