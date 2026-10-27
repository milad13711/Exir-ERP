"use client";

import { useEffect, useState } from "react";
import { getInstallState, getPlatform, initInstallCapture, isStandalone, subscribeInstallState } from "@/lib/push-client";

export type InstallInfo = {
  mounted: boolean;
  /** مرورگر دکمه‌ی نصب بومی (beforeinstallprompt) داده است */
  canPrompt: boolean;
  installed: boolean;
  /** iOS Safari، نصب نشده — فقط راهنمای دستی ممکن است */
  iosManual: boolean;
  /** iOS ولی نه Safari (Chrome/Firefox iOS)؛ باید در Safari باز شود */
  iosWrongBrowser: boolean;
};

export function useInstall(): InstallInfo {
  const [info, setInfo] = useState<InstallInfo>({ mounted: false, canPrompt: false, installed: false, iosManual: false, iosWrongBrowser: false });
  useEffect(() => {
    initInstallCapture();
    const read = () => {
      const s = getInstallState();
      const p = getPlatform();
      const ios = p.os === "ios" && !isStandalone();
      setInfo({
        mounted: true,
        canPrompt: s.canPrompt,
        installed: s.installed,
        iosManual: ios && p.browser === "safari" && !p.inApp,
        iosWrongBrowser: ios && p.browser !== "safari" && !p.inApp,
      });
    };
    read();
    return subscribeInstallState(read);
  }, []);
  return info;
}
