"use client";

import clsx from "clsx";
import type { ComponentType, SVGProps } from "react";
import { BellIcon, CalendarIcon, ChatIcon, ClipboardCheckIcon, MailIcon, MegaphoneIcon, ShareIcon, ShieldIcon, TasksIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { categoryOf, CATEGORY_LABEL, groupByDay, isImportant, relativeTimeFa, type NotifLike } from "@/lib/notification-logic";
import type { AppNotification } from "@/lib/api";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export const CATEGORY_ICON: Record<string, IconType> = {
  messenger: ChatIcon,
  tasks: TasksIcon,
  reminders: CalendarIcon,
  correspondence: MailIcon,
  approvals: ClipboardCheckIcon,
  referrals: ShareIcon,
  system: ShieldIcon,
  marketing: MegaphoneIcon,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? BellIcon;
  return <Icon className={className ?? "w-[18px] h-[18px]"} />;
}

function Row({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const unread = !n.readAt;
  const important = unread && isImportant(n);
  const cat = categoryOf(n);
  const rel = relativeTimeFa(n.createdAt);
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={clsx(
        "w-full text-start flex items-start gap-3 px-4 py-3 min-h-14 border-b border-border last:border-b-0 cursor-pointer transition-colors border-s-4",
        unread ? (important ? "border-s-danger bg-danger-soft/60 hover:bg-danger-soft" : "border-s-primary bg-primary-soft/50 hover:bg-primary-soft") : "border-s-transparent hover:bg-slate-50",
      )}
    >
      <span
        className={clsx(
          "mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center",
          unread ? (important ? "bg-danger text-white" : "bg-primary text-white") : "bg-slate-100 text-muted",
        )}
        aria-hidden="true"
      >
        <CategoryIcon category={cat} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={clsx("text-[13px] leading-6 truncate", unread ? "font-extrabold text-ink" : "font-medium text-ink-soft")}>{n.title}</span>
          {important ? <span className="shrink-0 rounded-full bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">نیازمند اقدام</span> : null}
        </span>
        {n.body ? <span className={clsx("block text-[12px] leading-5 mt-0.5 line-clamp-2", unread ? "text-ink-soft" : "text-muted")}>{n.body}</span> : null}
        <span className="block text-[11px] text-muted mt-1">
          {CATEGORY_LABEL[cat] ?? cat} · {rel ?? formatJalaliDateTime(n.createdAt)}
        </span>
      </span>
      {unread ? <span className="sr-only">خوانده‌نشده</span> : null}
    </button>
  );
}

/** فهرست گروه‌بندی‌شده‌ی «امروز / قبل‌تر» — مشترک بین زنگوله و صفحه‌ی اعلان‌ها. */
export function NotificationList({ items, onOpen, empty }: { items: AppNotification[]; onOpen: (n: AppNotification) => void; empty: string }) {
  const groups = groupByDay<NotifLike & AppNotification>(items as (NotifLike & AppNotification)[]);
  if (groups.length === 0) {
    return (
      <div className="py-12 px-6 text-center">
        <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-slate-100 text-muted flex items-center justify-center">
          <BellIcon className="w-6 h-6" />
        </span>
        <div className="text-[13.5px] font-bold text-ink-soft">{empty}</div>
        <div className="text-[12px] text-muted mt-1">اعلان‌های جدید همین‌جا و روی نشان زنگوله دیده می‌شوند.</div>
      </div>
    );
  }
  return (
    <div>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 className="px-4 py-1.5 bg-slate-50 border-b border-border text-[11px] font-bold text-muted sticky top-0 z-[1]">{g.label}</h3>
          {g.items.map((n) => (
            <Row key={n.id} n={n} onOpen={onOpen} />
          ))}
        </section>
      ))}
    </div>
  );
}
