"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  API_URL,
  getToken,
  fetchMe,
  fetchSubscription,
  fetchLicenseStatus,
  fetchModules,
  fetchPlatformMe,
  setOfflineModuleInstalled,
  type Me,
  type Subscription,
  type LicenseStatus,
} from "./api";

/**
 * Points the installed-web-app manifest and theme-color at this tenant's own
 * branding instead of the generic Exir defaults. Browsers fetch the manifest
 * without auth headers, so it has to be the public slug-based endpoint (see
 * PublicManifestController), not an authenticated one.
 */
function applyTenantBranding(tenant: Me["tenant"]) {
  if (typeof document === "undefined") return;
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    manifestLink.setAttribute("href", `${API_URL}/public/tenants/${tenant.slug}/manifest.webmanifest`);
  }
  if (tenant.themeColor) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute("content", tenant.themeColor!));
  }
}

type WorkspaceState = {
  me: Me | null;
  subscription: Subscription;
  license: LicenseStatus | null;
  loading: boolean;
  refreshSubscription: () => void;
  /** بعد از تغییر پروفایل شخصی (نام/تصویر/ایمیل) — تا هدر و بقیه‌ی صفحه بدون رفرش کامل به‌روز شوند. */
  refreshMe: () => void;
  /** Module codes currently usable by this tenant (installed/trial, or core with no override) — see /modules for the same logic. */
  installedModules: Set<string>;
  /** بعد از فعال/غیرفعال‌سازی هر ماژول — تا سایدبار و بقیه‌ی صفحه بدون رفرش کامل مرورگر خودشان را با وضعیت تازه‌ی ماژول‌ها به‌روز کنند. */
  refreshInstalledModules: () => void;
  /** کاربر ادمین/مالک تننت مادر پلتفرم است (برای نمایش «مدیریت پلتفرم»). */
  isPlatformOwner: boolean;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [installedModules, setInstalledModules] = useState<Set<string>>(new Set());

  const refreshSubscription = useCallback(() => {
    fetchSubscription().then(setSubscription).catch(() => {});
  }, []);

  const refreshMe = useCallback(() => {
    fetchMe()
      .then((meData) => {
        setMe(meData);
        applyTenantBranding(meData.tenant);
      })
      .catch(() => {});
  }, []);

  const refreshInstalledModules = useCallback(() => {
    fetchModules()
      .then((modules) => {
        const installed = new Set(
          modules
            .filter((m) => m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore))
            .map((m) => m.code),
        );
        setInstalledModules(installed);
        setOfflineModuleInstalled(installed.has("offline-sync"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    fetchPlatformMe().then((r) => setIsPlatformOwner(r.isPlatformOwner)).catch(() => setIsPlatformOwner(false));
    Promise.all([fetchMe(), fetchSubscription(), fetchLicenseStatus(), fetchModules().catch(() => [])])
      .then(([meData, subData, licenseData, modules]) => {
        setMe(meData);
        setSubscription(subData);
        setLicense(licenseData);
        const installed = new Set(
          modules
            .filter((m) => m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore))
            .map((m) => m.code),
        );
        setInstalledModules(installed);
        setOfflineModuleInstalled(installed.has("offline-sync"));
        applyTenantBranding(meData.tenant);
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{ me, subscription, license, loading, refreshSubscription, refreshMe, installedModules, refreshInstalledModules, isPlatformOwner }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
