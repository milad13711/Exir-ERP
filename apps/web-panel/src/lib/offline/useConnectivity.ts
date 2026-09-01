"use client";

import { useEffect, useState } from "react";
import { subscribePendingCount, flushQueue } from "./queue";
import { getToken } from "../api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/** Online/offline state plus how many mutations are queued waiting to sync. */
export function useConnectivity() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      flushQueue(getToken, API_URL);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsubscribe = subscribePendingCount(setPendingCount);

    if (navigator.onLine) flushQueue(getToken, API_URL);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, []);

  return { online, pendingCount };
}
