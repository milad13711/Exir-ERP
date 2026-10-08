"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken, clearToken, MUST_CHANGE_KEY } from "./api";

type Admin = { id: string; name: string; team: string };

type AdminState = {
  admin: Admin | null;
  /** نشست محدود: تا تغییر رمز فقط صفحه‌ی «حساب من» در دسترس است */
  mustChangePassword: boolean;
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

function useMustChange(): boolean {
  return useSyncExternalStore(subscribe, () => window.localStorage.getItem(MUST_CHANGE_KEY) === "1", () => false);
}

function useCachedAdmin(): Admin | null {
  return useSyncExternalStore(subscribe, readCachedAdmin, () => null);
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const admin = useCachedAdmin();
  const mustChangePassword = useMustChange();
  const [loading] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mustChangePassword && !pathname.startsWith("/account")) router.replace("/account");
  }, [mustChangePassword, pathname, router]);

  function logout() {
    clearToken();
    window.localStorage.removeItem(STORAGE_KEY);
    router.replace("/login");
  }

  return <AdminContext.Provider value={{ admin, mustChangePassword, loading, logout }}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

export function persistAdmin(admin: Admin, mustChangePassword = false) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
  if (mustChangePassword) window.localStorage.setItem(MUST_CHANGE_KEY, "1");
  else window.localStorage.removeItem(MUST_CHANGE_KEY);
  // storage event فقط در تب‌های دیگر ارسال می‌شود؛ این تب را هم خبر کن
  window.dispatchEvent(new Event("storage"));
}
