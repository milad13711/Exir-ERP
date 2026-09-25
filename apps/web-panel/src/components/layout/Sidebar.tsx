"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogoMark, DocsIcon, PencilIcon, DragHandleIcon, CheckIcon } from "@/components/icons";
import { canViewModule } from "@/lib/access";
import { primaryNav, secondaryNav, type NavItem } from "./nav";
import { useWorkspace } from "@/lib/workspace-context";
import { updateNavOrder } from "@/lib/api";

function NavLink({
  href,
  label,
  Icon,
  active,
  onNavigate,
  editing,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  href: string;
  label: string;
  Icon: (typeof primaryNav)[number]["icon"];
  active: boolean;
  onNavigate?: () => void;
  editing?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  const content = (
    <div
      className={clsx(
        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors",
        active
          ? "bg-primary-soft text-primary font-bold"
          : "text-ink-soft font-medium hover:bg-slate-50",
      )}
    >
      {editing ? <DragHandleIcon className="w-3.5 h-3.5 shrink-0 text-muted" /> : null}
      <Icon className="w-[18px] h-[18px] shrink-0" />
      {label}
    </div>
  );

  if (editing) {
    return (
      <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} className="cursor-move">
        {content}
      </div>
    );
  }
  return (
    <Link href={href} onClick={onNavigate}>
      {content}
    </Link>
  );
}

/** ترتیب دستی کاربر (navOrder) اول اعمال می‌شود؛ آیتم‌های جدید/نصب‌شده که هنوز در آن نیستند، به ترتیب پیش‌فرض دسته‌بندی‌شده‌ی nav.ts در انتها اضافه می‌شوند. */
function applyNavOrder(items: NavItem[], navOrder: string[]): NavItem[] {
  if (navOrder.length === 0) return items;
  const byHref = new Map(items.map((i) => [i.href, i] as const));
  const ordered: NavItem[] = [];
  for (const href of navOrder) {
    const item = byHref.get(href);
    if (item) {
      ordered.push(item);
      byHref.delete(href);
    }
  }
  for (const item of items) {
    if (byHref.has(item.href)) ordered.push(item);
  }
  return ordered;
}

function useVisibleNav(items: NavItem[], navOrder: string[]) {
  const { installedModules, me } = useWorkspace();
  const visible = items.filter((item) => canViewModule(me, installedModules, item.moduleCode));
  return useMemo(() => applyNavOrder(visible, navOrder), [visible, navOrder]);
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { me, refreshMe } = useWorkspace();
  const navOrder = me?.navOrder ?? [];
  const isCustomOrder = navOrder.length > 0;
  const visiblePrimaryNav = useVisibleNav(primaryNav, navOrder);

  const [editing, setEditing] = useState(false);
  const [draftOrder, setDraftOrder] = useState<NavItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const dragIndexRef = useState<{ current: number | null }>(() => ({ current: null }))[0];

  const items = draftOrder ?? visiblePrimaryNav;

  function startEditing() {
    setDraftOrder(visiblePrimaryNav);
    setEditing(true);
  }

  function handleDrop(dropIndex: number) {
    const from = dragIndexRef.current;
    if (from === null || from === dropIndex || !draftOrder) return;
    const next = [...draftOrder];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved);
    setDraftOrder(next);
    dragIndexRef.current = null;
  }

  async function handleSaveOrder() {
    if (!draftOrder) return;
    setSaving(true);
    try {
      await updateNavOrder(draftOrder.map((i) => i.href));
      refreshMe();
      setEditing(false);
      setDraftOrder(null);
    } finally {
      setSaving(false);
    }
  }

  // فقط وقتی چیدمان پیش‌فرض (دسته‌بندی‌شده) در حال نمایش است، لیبل‌های
  // جداکننده‌ی دسته معنا دارند — چیدمان دستی کاربر می‌تواند دسته‌ها را
  // با هم قاطی کند و نمایش لیبل وقت آن دیگر گمراه‌کننده می‌شود.
  const showCategoryLabels = !isCustomOrder && !editing;
  let lastCategory: string | null = null;

  return (
    <div className="flex flex-col h-full p-3.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-5">
        <div className="flex items-center gap-2.5">
          <LogoMark className="w-8.5 h-8.5" />
          <span className="text-[17px] font-extrabold">اکسیر ERP</span>
        </div>
        {editing ? (
          <button
            onClick={handleSaveOrder}
            disabled={saving}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-success hover:bg-success-soft disabled:opacity-50"
            aria-label="ذخیره‌ی چیدمان"
            title="ذخیره‌ی چیدمان"
          >
            <CheckIcon className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={startEditing}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-slate-50"
            aria-label="ویرایش چیدمان منو"
            title="ویرایش چیدمان منو"
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto">
        {items.map((item, i) => {
          const showLabel = showCategoryLabels && item.category !== lastCategory;
          lastCategory = item.category;
          return (
            <div key={item.href}>
              {showLabel ? (
                <div className="px-3.5 pt-3 pb-1 text-[10.5px] font-bold text-muted uppercase tracking-wide first:pt-0">
                  {item.category}
                </div>
              ) : null}
              <NavLink
                href={item.href}
                label={item.label}
                Icon={item.icon}
                active={pathname === item.href}
                onNavigate={onNavigate}
                editing={editing}
                onDragStart={() => {
                  dragIndexRef.current = i;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(i)}
              />
            </div>
          );
        })}
        {!editing && (
          <>
            <div className="h-px bg-border my-3 mx-1.5" />
            {secondaryNav.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                Icon={item.icon}
                active={pathname.startsWith(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </nav>

      {!editing && (
        <div className="shrink-0 mt-3 p-3.5 rounded-2xl bg-accent-soft border border-teal-100">
          <div className="text-[12.5px] text-teal-800 font-semibold leading-relaxed flex items-center gap-1.5">
            <DocsIcon className="w-4 h-4 shrink-0" />
            به مستندات API، وب‌هوک و MCP نیاز دارید؟
          </div>
          <Link href="/settings/api" className="text-[12.5px] font-bold text-teal-800 mt-1 inline-block">
            مشاهده مستندات ←
          </Link>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-[232px] shrink-0 bg-surface border-e border-border">
      <SidebarContent />
    </aside>
  );
}
