/**
 * شواهد حقوقی امضای الکترونیک — سمت مرورگر.
 * هر نقطه‌ی ثبت امضا باید `evidence: await collectSignatureEvidence()` را همراه درخواست بفرستد.
 * IP، زمان سرور، هش‌ها و هش یکپارچگی را فقط سرور تعیین می‌کند؛ این‌جا فقط اطلاعات دستگاه/زمان/موقعیت کلاینت است.
 */
export type GeoStatus = "granted" | "denied" | "unavailable";

export type ClientSignatureEvidence = {
  clientTime?: string;
  timezone?: string;
  language?: string;
  platform?: string;
  screen?: { w: number; h: number };
  touch?: boolean;
  geo?: { status: GeoStatus; lat?: number; lng?: number; accuracy?: number };
};

export const GEO_TIMEOUT_MS = 8000;

/** کد خطای Geolocation → وضعیت: 1 = PERMISSION_DENIED → denied؛ بقیه (نبود سیگنال/تایم‌اوت) → unavailable. */
export function geoStatusFromError(code: number | undefined): GeoStatus {
  return code === 1 ? "denied" : "unavailable";
}

function getPosition(timeoutMs: number): Promise<NonNullable<ClientSignatureEvidence["geo"]>> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ status: "unavailable" });
      return;
    }
    // تایمر سخت: مرورگرها گاهی (مثلاً اگر کاربر پنجره‌ی اجازه را باز بگذارد) هرگز پاسخ نمی‌دهند.
    const hard = setTimeout(() => resolve({ status: "unavailable" }), timeoutMs + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(hard);
          resolve({ status: "granted", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        },
        (err) => {
          clearTimeout(hard);
          resolve({ status: geoStatusFromError(err?.code) });
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      clearTimeout(hard);
      resolve({ status: "unavailable" });
    }
  });
}

/**
 * جمع‌آوری شواهد دستگاه/زمان/موقعیت. هرگز throw نمی‌کند و هرگز امضا را بلاک نمی‌کند
 * (رد اجازه‌ی موقعیت = status «denied»). `askLocation: false` درخواست موقعیت را حذف می‌کند.
 */
export async function collectSignatureEvidence(opts: { askLocation?: boolean } = {}): Promise<ClientSignatureEvidence> {
  const out: ClientSignatureEvidence = {};
  try {
    out.clientTime = new Date().toISOString();
    try {
      out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* ignore */
    }
    if (typeof navigator !== "undefined") {
      out.language = navigator.language;
      out.platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || undefined;
      out.touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
    }
    if (typeof screen !== "undefined") out.screen = { w: Math.round(screen.width), h: Math.round(screen.height) };
  } catch {
    /* ignore — شواهد ناقص بهتر از شکست امضاست */
  }
  try {
    out.geo = opts.askLocation === false ? { status: "unavailable" } : await getPosition(GEO_TIMEOUT_MS);
  } catch {
    out.geo = { status: "unavailable" };
  }
  return out;
}

/** رکورد مدرک امضا که از GET /signature-evidence برمی‌گردد. */
export type SignatureEvidenceRecord = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  signerName: string | null;
  signerPhone: string | null;
  signerUserId: string | null;
  signerRole: string | null;
  ip: string | null;
  userAgent: string | null;
  device: {
    platform?: string | null;
    os?: string | null;
    browser?: string | null;
    browserVersion?: string | null;
    deviceType?: string | null;
    language?: string | null;
    timezone?: string | null;
    screen?: { w: number; h: number } | null;
    touch?: boolean | null;
    serverTimeUtc?: string;
    serverTimeTehran?: string;
  } | null;
  geoStatus: GeoStatus;
  lat: number | null;
  lng: number | null;
  geoAccuracy: number | null;
  clientTime: string | null;
  serverTime: string;
  contentHash: string | null;
  signatureHash: string | null;
  integrityHash: string;
  integrityOk: boolean;
};

export const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
