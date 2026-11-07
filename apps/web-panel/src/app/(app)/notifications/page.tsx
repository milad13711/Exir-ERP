"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import Link from "next/link";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { NotificationList } from "@/components/notifications/NotificationList";
import { fetchNotificationsPage, type AppNotification } from "@/lib/api";
import { markAllRead, markRead, useNotificationState } from "@/lib/notification-store";
import { badgeLabel, safeHref } from "@/lib/notification-logic";

type Filter = "all" | "unread" | "important";
const FILTERS: [Filter, string][] = [
  ["all", "همه"],
  ["unread", "نخوانده"],
  ["important", "نیازمند اقدام"],
];

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("filter") as Filter) || "all";
  const [filter, setFilter] = useState<Filter>(FILTERS.some(([k]) => k === initial) ? initial : "all");
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const { unreadCount, importantUnread } = useNotificationState();

  const load = useCallback(
    async (more: AppNotification[] | null) => {
      try {
        const r = await fetchNotificationsPage({ limit: 30, unread: filter === "unread", important: filter === "important", before: more?.length ? more[more.length - 1].createdAt : undefined });
        // «نیازمند اقدام» فقط نخوانده‌ها را نشان می‌دهد
        const list = filter === "important" ? r.items.filter((n) => !n.readAt) : r.items;
        setItems(more ? [...more, ...list] : list);
        setHasMore(r.hasMore);
      } catch {
        setItems((cur) => cur ?? []);
      } finally {
        setBusy(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load, unreadCount]);

  function open(n: AppNotification) {
    if (!n.readAt) void markRead(n.id);
    router.push(safeHref(n.link));
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[820px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-extrabold">اعلان‌ها</h1>
          <ModuleHelp code="notifications" />
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 ? (
            <button type="button" onClick={() => void markAllRead()} className="min-h-10 text-[12.5px] font-bold text-primary cursor-pointer">
              علامت‌گذاری همه به‌عنوان خوانده‌شده
            </button>
          ) : null}
          <Link href="/settings/notifications" className="min-h-10 flex items-center text-[12.5px] font-bold text-ink-soft">
            تنظیمات اعلان
          </Link>
        </div>
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto" role="tablist" aria-label="فیلتر اعلان‌ها">
        {FILTERS.map(([k, t]) => {
          const count = k === "unread" ? unreadCount : k === "important" ? importantUnread : 0;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={clsx("shrink-0 min-h-10 px-4 rounded-xl text-[12.5px] font-bold cursor-pointer", filter === k ? "bg-primary text-white" : "bg-surface border border-border text-ink-soft hover:bg-slate-50")}
            >
              {t}
              {count > 0 ? <span className={clsx("ms-1.5 rounded-full px-1.5 text-[11px]", filter === k ? "bg-white/25" : "bg-danger text-white")}>{badgeLabel(count)}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {items === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <NotificationList items={items} onOpen={open} empty={filter === "all" ? "هنوز اعلانی ندارید" : "موردی برای نمایش نیست؛ همه‌چیز خوانده شده است"} />
        )}
      </div>

      {hasMore && items ? (
        <div className="mt-4 text-center">
          <button type="button" disabled={busy} onClick={() => {
              setBusy(true);
              void load(items);
            }} className="min-h-10 px-6 rounded-xl border border-border bg-surface text-[13px] font-bold disabled:opacity-50 cursor-pointer">
            {busy ? "در حال بارگذاری..." : "نمایش بیشتر"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
