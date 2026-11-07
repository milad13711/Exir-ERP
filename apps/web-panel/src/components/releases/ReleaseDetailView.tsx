"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate } from "@/lib/persian";
import { ApiError } from "@/lib/api";
import { fetchReleaseDetail, markReleaseRead, safeInternalPath, RELEASE_TYPE_META, type ReleaseDetail } from "@/lib/module-releases-api";

function GoButton({ href }: { href: string | null }) {
  const router = useRouter();
  const safe = safeInternalPath(href);
  if (!safe) return null;
  return (
    <button
      type="button"
      onClick={() => router.push(safe)}
      className="min-h-[40px] inline-flex items-center justify-center px-4 rounded-xl bg-primary hover:bg-primary-dark text-white text-[13px] font-bold cursor-pointer transition-colors"
    >
      رفتن به ماژول و تست
    </button>
  );
}

export function ReleaseDetailView({ code }: { code: string }) {
  const [data, setData] = useState<ReleaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReleaseDetail(code)
      .then(async (d) => {
        if (!alive) return;
        setData(d);
        if (d.unread && !d.isDraftPreview) {
          await markReleaseRead(d.id).catch(() => {});
          window.dispatchEvent(new Event("exir:releases-read"));
        }
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "بارگذاری نشد"));
    return () => {
      alive = false;
    };
  }, [code]);

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[820px] mx-auto">
      <Link href="/releases" className="text-[12.5px] text-primary underline min-h-[40px] inline-flex items-center mb-2">
        بازگشت به تازه‌های سیستم
      </Link>
      {error ? (
        <Card className="p-8 text-center text-[13.5px] text-muted">{error}</Card>
      ) : !data ? (
        <div className="text-sm text-muted py-10 text-center">در حال بارگذاری…</div>
      ) : (
        <>
          {data.isDraftPreview ? <div className="mb-3 rounded-xl bg-warning-soft text-warning text-[12.5px] font-bold px-3.5 py-2.5">پیش‌نمایش آزمایشی — این انتشار هنوز برای عموم منتشر نشده است.</div> : null}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge tone="primary">{data.moduleName}</Badge>
            <span className="text-[12.5px] font-bold text-ink-soft" dir="ltr">
              v{data.version}
            </span>
            <span className="ms-auto text-[12.5px] text-muted">{data.publishedAt ? formatJalaliDate(data.publishedAt) : "منتشر نشده"}</span>
          </div>
          <h1 className="text-xl font-extrabold leading-snug">{data.title}</h1>
          {data.summary ? <p className="text-[13.5px] text-ink-soft mt-2 leading-relaxed whitespace-pre-line">{data.summary}</p> : null}
          <div className="mt-4">
            <GoButton href={data.route} />
          </div>

          <h2 className="text-[15px] font-extrabold mt-7 mb-3">تغییرات این نسخه ({data.changes.length.toLocaleString("fa-IR")})</h2>
          <div className="flex flex-col gap-3">
            {data.changes.map((c) => {
              const meta = RELEASE_TYPE_META[c.type] ?? RELEASE_TYPE_META.NEW;
              return (
                <Card key={c.id} className="p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <h3 className="text-[14.5px] font-extrabold leading-snug">{c.title}</h3>
                  </div>
                  {c.description ? <p className="text-[13px] text-ink-soft leading-relaxed whitespace-pre-line">{c.description}</p> : null}
                  {c.valueText ? (
                    <div className="mt-3 rounded-xl bg-accent-soft border border-accent/20 px-3.5 py-3">
                      <div className="text-[11.5px] font-extrabold text-accent mb-1">ارزش جدید برای شما</div>
                      <p className="text-[13px] leading-relaxed whitespace-pre-line">{c.valueText}</p>
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <GoButton href={c.deepLink} />
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
