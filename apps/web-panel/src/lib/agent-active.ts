"use client";

import { useCallback, useSyncExternalStore } from "react";

/** محصول فعالِ نماینده (تعویض‌کننده‌ی هدر) — شناسه‌ی عضویت؛ فقط راحتی نمایشی، دسترسی واقعی سمت سرور است. */
const KEY = "agent.activeMembership";
const EVT = "agent-active-membership";

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useActiveMembershipId(): [string | null, (id: string) => void] {
  const id = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((next: string) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* حالت خصوصی مرورگر */
    }
    window.dispatchEvent(new Event(EVT));
  }, []);
  return [id, set];
}
