"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { formatJalaliDate } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchReleases, markAllReleasesRead, fetchReleasePrefs, saveReleasePrefs, type ReleaseListItem, type ReleasePrefs } from "@/lib/module-releases-api";

const PREF_LABELS: Array<{ key: keyof ReleasePrefs; label: string }> = [
  { key: "notify", label: "اعلان درون‌برنامه و پوش" },
  { key: "ticket", label: "تیکت اطلاع‌رسانی" },
  { key: "sms", label: "پیامک به مدیران (پیش‌فرض خاموش؛ از اعتبار پیامک خودتان کسر می‌شود)" },
];

export function ReleasesList() {
  const [items, setItems] = useState<ReleaseListItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<ReleasePrefs | null>(null);
  const { me } = useWorkspace();
  const canManage = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const load = useCallback(() => {
    fetchReleases()
      .then((d) => {
        setItems(d.items);
        setUnread(d.unreadCount);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    fetchReleasePrefs()
      .then(setPrefs)
      .catch(() => {});
  }, [canManage]);

  async function readAll() {
    await markAllReleasesRead().catch(() => {});
    window.dispatchEvent(new Event("exir:releases-read"));
    load();
  }

  async function togglePref(key: keyof ReleasePrefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      setPrefs(await saveReleasePrefs({ [key]: next[key] }));
    } catch {
      setPrefs(prefs);
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[820px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-extrabold">تازه‌های سیستم</h1>
          <ModuleHelp code="releases" />
          {unread > 0 ? <Badge tone="danger">{unread.toLocaleString("fa-IR")} نخوانده</Badge> : null}
        </div>
        {unread > 0 ? (
          <button type="button" onClick={readAll} className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer">
            همه را خوانده‌شده کن
          </button>
        ) : null}
      </div>
      <p className="text-[13.5px] text-muted mb-5">به‌روزرسانی ماژول‌هایی که فعال دارید — هر تغییر را ببینید و همان‌جا امتحان کنید.</p>

      {items === null ? (
        <div className="text-sm text-muted py-10 text-center">در حال بارگذاری…</div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-[13.5px] text-muted">هنوز به‌روزرسانی‌ای برای ماژول‌های شما منتشر نشده است.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <Link key={r.id} href={`/releases/${r.shortCode}`} className="block">
              <Card className={clsx("p-4 hover:border-primary transition-colors", r.unread && "border-primary/50 bg-primary-soft/40")}>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Badge tone="primary">{r.moduleName}</Badge>
                  <span className="text-[12px] font-bold text-ink-soft" dir="ltr">
                    v{r.version}
                  </span>
                  {r.unread ? <span className="w-2 h-2 rounded-full bg-danger" aria-label="نخوانده" /> : null}
                  <span className="ms-auto text-[12px] text-muted">{r.publishedAt ? formatJalaliDate(r.publishedAt) : ""}</span>
                </div>
                <div className="text-[15px] font-extrabold leading-snug">{r.title}</div>
                {r.summary ? <p className="text-[13px] text-ink-soft mt-1 leading-relaxed line-clamp-2 whitespace-pre-line">{r.summary}</p> : null}
                <div className="text-[12px] text-muted mt-2">{r.changeCount.toLocaleString("fa-IR")} تغییر</div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canManage && prefs ? (
        <Card className="p-4 mt-6">
          <h2 className="text-[14px] font-extrabold mb-1">دریافت اطلاع‌رسانی به‌روزرسانی‌ها</h2>
          <p className="text-[12.5px] text-muted mb-3">می‌توانید هر کدام از کانال‌های اطلاع‌رسانی خودکار برای سازمانتان را خاموش کنید. این صفحه همیشه در دسترس است.</p>
          <div className="flex flex-col">
            {PREF_LABELS.map((p) => (
              <label key={p.key} className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input type="checkbox" className="w-5 h-5 cursor-pointer" checked={prefs[p.key]} onChange={() => togglePref(p.key)} />
                <span className="text-[13.5px] font-semibold">{p.label}</span>
              </label>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
