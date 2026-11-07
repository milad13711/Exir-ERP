"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { CategoryIcon } from "./NotificationList";
import { markRead, useNotificationState } from "@/lib/notification-store";
import { badgeLabel, categoryOf, relativeTimeFa, safeHref, summarizeAttention, toFa } from "@/lib/notification-logic";
import type { AppNotification } from "@/lib/api";

/** بنر «نیاز به توجه شما» بالای داشبورد: اعلان‌های مهمِ نخوانده (ارجاع/تأیید/وظیفه…) با شمارش و لینک مستقیم. اگر چیزی نیست، نمایش داده نمی‌شود. */
export function AttentionCard() {
  const { attention, importantUnread } = useNotificationState();
  const router = useRouter();
  const items = useMemo(() => attention?.items ?? [], [attention]);
  const groups = useMemo(() => summarizeAttention(items), [items]);
  const total = attention?.importantTotal ?? importantUnread;
  if (items.length === 0 || total === 0) return null;

  function open(n: AppNotification) {
    void markRead(n.id);
    router.push(safeHref(n.link));
  }

  return (
    <section aria-label="نیاز به توجه شما" className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft/70 border-s-4 border-s-danger overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
        <h2 className="text-[14.5px] font-extrabold text-ink flex items-center gap-2">
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-danger text-white text-[12px] font-extrabold flex items-center justify-center">{badgeLabel(total)}</span>
          نیاز به توجه شما
        </h2>
        <Link href="/notifications?filter=important" className="min-h-10 flex items-center text-[12px] font-bold text-primary">
          مشاهده‌ی همه ←
        </Link>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pt-2">
        {groups.map((g) => (
          <span key={g.category} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-danger/20 text-[11.5px] font-bold text-ink-soft px-2.5 py-1">
            <CategoryIcon category={g.category} className="w-3.5 h-3.5" />
            {g.label}
            <span className="text-danger">{toFa(g.count)}</span>
          </span>
        ))}
      </div>
      <ul className="mt-2 divide-y divide-danger/10">
        {items.slice(0, 5).map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)} className="w-full text-start flex items-center gap-3 px-4 py-2.5 min-h-12 hover:bg-white/70 cursor-pointer">
              <span className="w-8 h-8 shrink-0 rounded-full bg-danger text-white flex items-center justify-center" aria-hidden="true">
                <CategoryIcon category={categoryOf(n)} className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink truncate">{n.title}</span>
                {n.body ? <span className="block text-[11.5px] text-ink-soft truncate">{n.body}</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-muted">{relativeTimeFa(n.createdAt) ?? ""}</span>
              <span className="shrink-0 rounded-lg bg-primary text-white text-[12px] font-bold px-3 min-h-9 flex items-center">مشاهده</span>
            </button>
          </li>
        ))}
      </ul>
      {total > 5 ? <div className="px-4 py-2 text-[11.5px] text-muted border-t border-danger/10">و {toFa(total - 5)} مورد دیگر…</div> : null}
    </section>
  );
}
