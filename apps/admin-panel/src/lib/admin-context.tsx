"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken, clearToken } from "./api";

type Admin = { id: string; name: string; team: string };

type AdminState = {
  admin: Admin | null;
  loading: boolean;
  logout: () => void;
};

const AdminContext = createContext<AdminState | null>(null);

const STORAGE_KEY = "exir_admin_info";

let cachedRaw: string | null | undefined;
let cachedAdmin: Admin | null = null;

function readCachedAdmin(): Admin | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedAdmin;
  cachedRaw = raw;
  try {
    cachedAdmin = raw ? JSON.parse(raw) : null;
  } catch {
    cachedAdmin = null;
  }
  return cachedAdmin;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function useCachedAdmin(): Admin | null {
  return useSyncExternalStore(subscribe, readCachedAdmin, () => null);
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const admin = useCachedAdmin();
  const [loading] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    clearToken();
    window.localStorage.removeItem(STORAGE_KEY);
    router.replace("/login");
  }

  return <AdminContext.Provider value={{ admin, loading, logout }}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

export function persistAdmin(admin: Admin) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
}
