"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getToken,
  fetchMe,
  fetchSubscription,
  fetchLicenseStatus,
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
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSubscription = useCallback(() => {
    fetchSubscription().then(setSubscription).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([fetchMe(), fetchSubscription(), fetchLicenseStatus()])
      .then(([meData, subData, licenseData]) => {
        setMe(meData);
        setSubscription(subData);
        setLicense(licenseData);
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WorkspaceContext.Provider value={{ me, subscription, license, loading, refreshSubscription }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
