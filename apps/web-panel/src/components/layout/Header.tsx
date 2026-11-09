"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarIcon, ChatIcon, MenuIcon, ChevronDownIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { formatJalaliFull, getInitials } from "@/lib/persian";
import { clearToken, fetchMyTenants, switchTenant, setToken, type MyTenant } from "@/lib/api";
import { OfflineIndicator } from "./OfflineIndicator";
import { OfflineLogoutDialog } from "@/components/offline/OfflineLogoutDialog";
import { getManager } from "@/lib/offline/client";
import { NotificationBell } from "./NotificationBell";
import { ReminderAlarm } from "./ReminderAlarm";
import { PhoneWidget } from "@/components/voip/PhoneWidget";
import { SmsCreditChip } from "@/components/sms/SmsCreditChip";
import { useInstall } from "@/hooks/useInstall";
import { IosInstallSheet } from "@/components/pwa/IosInstallSheet";
import { SubscriptionHeaderChip } from "@/components/billing/SubscriptionHeaderChip";
import { AgentProductSwitcher } from "@/components/agents/AgentProductSwitcher";
import { isAgentRestricted } from "@/lib/access";
import { promptInstall, unsubscribeForLogout } from "@/lib/push-client";

export function Header({
  onOpenSupport,
  onOpenMobileNav,
  supportUnread = false,
}: {
  onOpenSupport: () => void;
  onOpenMobileNav: () => void;
  supportUnread?: boolean;
}) {
  const [today] = useState(() => formatJalaliFull());
  const [menuOpen, setMenuOpen] = useState(false);
  const [otherTenants, setOtherTenants] = useState<MyTenant[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const { me } = useWorkspace();
  const agentOnly = isAgentRestricted(me);
  const router = useRouter();
  const install = useInstall();
  const [iosSheet, setIosSheet] = useState(false);

  useEffect(() => {
    if (!menuOpen || otherTenants !== null) return;
    fetchMyTenants()
      .then((tenants) => setOtherTenants(tenants.filter((t) => t.slug !== me?.tenant.slug)))
      .catch(() => setOtherTenants([]));
  }, [menuOpen, otherTenants, me?.tenant.slug]);

  const [logoutAsk, setLogoutAsk] = useState<number | null>(null);

  async function finishLogout(choice: "keep" | "discard" | "sync") {
    const mgr = getManager();
    if (mgr) {
      if (choice === "sync") await mgr.syncNow().catch(() => undefined);
      // سیاست مدیر «پاک‌سازی هنگام خروج»: کش همیشه پاک می‌شود؛ صف فقط با انتخاب صریح دور ریخته می‌شود
      await mgr.refreshCounts();
      const c = mgr.getSnapshot().counts;
      const nothingLeft = c.pending + c.syncing + c.failed + c.conflict === 0;
      await mgr.wipeOfflineData({ discardQueue: choice === "discard" || (nothingLeft && mgr.policy.wipeOnLogout) }).catch(() => undefined);
    }
    // اشتراک پوش همین دستگاه را (تا ۳ ثانیه) از حساب جدا کن؛ نیازمند توکن است پس قبل از clearToken
    await unsubscribeForLogout();
    clearToken();
    router.replace("/login");
  }

  async function handleLogout() {
    const mgr = getManager();
    if (mgr) {
      await mgr.refreshCounts();
      const c = mgr.getSnapshot().counts;
      const unsynced = c.pending + c.syncing + c.failed + c.conflict;
      if (unsynced > 0) {
        setLogoutAsk(unsynced);
        return;
      }
    }
    await finishLogout("keep");
  }

  async function handleSwitchTenant(slug: string) {
    setSwitching(true);
    try {
      const res = await switchTenant(slug);
      setToken(res.accessToken);
      window.location.href = "/dashboard";
    } catch {
      setSwitching(false);
    }
  }

  return (
    <header className="h-[calc(4.25rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] bg-surface border-b border-border flex items-center justify-between px-3 sm:px-4 lg:px-7 shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="lg:hidden w-9 h-9 -ms-1 flex items-center justify-center rounded-lg text-ink-soft"
          aria-label="باز کردن منو"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        <div className="hidden lg:flex items-center gap-2 text-ink-soft text-[13.5px]">
          <CalendarIcon className="w-4 h-4" />
          {today}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-2.5 min-w-0">
        <OfflineIndicator />

        {agentOnly ? <AgentProductSwitcher /> : null}
        {!agentOnly ? <SubscriptionHeaderChip onOpenSupport={onOpenSupport} /> : null}

        {!agentOnly ? <button
          type="button"
          onClick={onOpenSupport}
          className="relative w-10 h-10 rounded-xl border border-border bg-white flex items-center justify-center text-accent"
          aria-label="پشتیبانی زنده"
        >
          <ChatIcon className="w-[19px] h-[19px]" />
          {supportUnread ? (
            <span className="absolute top-1.5 end-1.5 w-2.5 h-2.5 rounded-full bg-danger border-2 border-white" />
          ) : null}
        </button> : null}

        {!agentOnly ? <SmsCreditChip /> : null}
        {!agentOnly ? <PhoneWidget /> : null}
        <NotificationBell />
        <ReminderAlarm />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 sm:ps-3 sm:border-s border-border"
            aria-label="منوی حساب کاربری"
          >
            <div className="text-right hidden sm:block">
              <div className="text-[13px] font-bold">{me?.user.name ?? me?.user.phone}</div>
              <div className="text-[11.5px] text-muted">{me?.user.roleTitle ?? ""}</div>
            </div>
            <div className="w-9.5 h-9.5 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-[13px] overflow-hidden">
              {me?.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.user.avatarUrl} alt={me.user.name ?? ""} className="w-full h-full object-cover" />
              ) : (
                getInitials(me?.user.name)
              )}
            </div>
            <ChevronDownIcon className="w-3.5 h-3.5 text-muted hidden sm:block" />
          </button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full mt-2 end-0 w-64 max-w-[calc(100vw-1.5rem)] max-h-[70dvh] overflow-y-auto bg-surface border border-border rounded-xl shadow-lg py-1.5 z-20">
                <div className="sm:hidden px-3.5 pt-1.5 pb-2 border-b border-border mb-1">
                  <div className="text-[13px] font-bold">{me?.user.name ?? me?.user.phone}</div>
                  <div className="text-[11.5px] text-muted">{me?.user.roleTitle ?? ""}</div>
                </div>
                <Link
                  href="/settings/profile"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full text-start px-3.5 py-2.5 text-[13px] font-semibold hover:bg-primary-soft"
                >
                  پروفایل من
                </Link>
                {install.mounted && !install.installed && (install.canPrompt || install.iosManual) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (install.canPrompt) void promptInstall();
                      else setIosSheet(true);
                    }}
                    className="block w-full text-start px-3.5 py-2.5 text-[13px] font-semibold hover:bg-primary-soft"
                  >
                    نصب اپ روی این دستگاه
                  </button>
                ) : null}
                <Link
                  href="/settings/notifications"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full text-start px-3.5 py-2.5 text-[13px] font-semibold hover:bg-primary-soft"
                >
                  اعلان‌ها و دستگاه‌ها
                </Link>
                <div className="h-px bg-border my-1.5" />
                <div className="px-3.5 pt-1 pb-2 text-[11px] font-bold text-muted">
                  محیط کاری فعلی: {me?.tenant.name}
                </div>
                {otherTenants && otherTenants.length > 0 ? (
                  <>
                    <div className="px-3.5 pb-1 text-[11px] font-bold text-muted">سایر کسب‌وکارهای شما</div>
                    {otherTenants.map((t) => (
                      <button
                        key={t.slug}
                        type="button"
                        disabled={switching}
                        onClick={() => handleSwitchTenant(t.slug)}
                        className="w-full text-start px-3.5 py-2.5 text-[13px] font-semibold hover:bg-primary-soft disabled:opacity-50"
                      >
                        {t.name}
                      </button>
                    ))}
                    <div className="h-px bg-border my-1.5" />
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-start px-3.5 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                >
                  خروج از حساب کاربری
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <IosInstallSheet open={iosSheet} onClose={() => setIosSheet(false)} />
      {logoutAsk !== null ? (
        <OfflineLogoutDialog
          pending={logoutAsk}
          online={typeof navigator === "undefined" ? true : navigator.onLine}
          wipeDefault={getManager()?.policy.wipeOnLogout ?? true}
          onChoose={(c) => {
            setLogoutAsk(null);
            if (c !== "cancel") void finishLogout(c);
          }}
        />
      ) : null}
    </header>
  );
}
