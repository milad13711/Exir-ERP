"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  fetchMe,
  fetchSubscription,
  fetchLicenseStatus,
  fetchModules,
  type Me,
  type Subscription,
  type LicenseStatus,
} from "./api";

type WorkspaceState = {
  me: Me | null;
  subscription: Subscription;
  license: LicenseStatus | null;
  loading: boolean;
  refreshSubscription: () => void;
  /** Module codes currently usable by this tenant (installed/trial, or core with no override) — see /modules for the same logic. */
  installedModules: Set<string>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installedModules, setInstalledModules] = useState<Set<string>>(new Set());

  const refreshSubscription = useCallback(() => {
    fetchSubscription().then(setSubscription).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([fetchMe(), fetchSubscription(), fetchLicenseStatus(), fetchModules().catch(() => [])])
      .then(([meData, subData, licenseData, modules]) => {
        setMe(meData);
        setSubscription(subData);
        setLicense(licenseData);
        setInstalledModules(
          new Set(
            modules
              .filter((m) => m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore))
              .map((m) => m.code),
          ),
        );
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WorkspaceContext.Provider value={{ me, subscription, license, loading, refreshSubscription, installedModules }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
