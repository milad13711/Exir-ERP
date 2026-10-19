import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * وضعیت پایدار نصب (installationId، توکن فعال‌سازی، آخرین زمان دیده‌شده، CRL، آخرین حکم سرور).
 * فایل با HMAC (کلید مشتق از installationId) مهر می‌شود تا ویرایش ساده/ناشیانه (مثلاً برگرداندن lastSeen) تشخیص داده شود.
 * هشدار صادقانه: کلید HMAC روی همان ماشین است، پس این «ضد خطا و دستکاری ساده» است نه ضد مهاجم مصمم. مرجع واقعی اعتماد، امضای Ed25519
 * توکن (و serverTime امضاشده‌ی داخل آن) است — lastSeen هیچ‌وقت از serverTime امضاشده عقب‌تر نمی‌رود.
 */
export type InstallState = {
  v: 1;
  installationId: string;
  createdAt: string;
  /** مؤلفه‌های اثرانگشت هنگام فعال‌سازی */
  activationFp: string[] | null;
  token: string | null;
  tokenSavedAt: string | null;
  lastSeen: string | null;
  crl: string | null;
  /** آخرین حکم قطعی (امضاشده‌ی سرور) که لایسنس را قفل کرده؛ با check-in موفق بعدی پاک می‌شود */
  verdict: { code: string; at: string } | null;
};

type Stored = InstallState & { mac: string };

export function newInstallState(): InstallState {
  return {
    v: 1,
    installationId: `i-${randomBytes(16).toString('hex')}`,
    createdAt: new Date().toISOString(),
    activationFp: null,
    token: null,
    tokenSavedAt: null,
    lastSeen: null,
    crl: null,
    verdict: null,
  };
}

function macOf(state: InstallState): string {
  const key = createHash('sha256').update(`exir-lic-state|${state.installationId}`).digest();
  return createHmac('sha256', key).update(JSON.stringify(state)).digest('hex');
}

export class InstallStateStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'license-state.json');
  }

  /** null = فایل نیست. throws 'tampered' اگر مهر نخورد (فراخواننده تصمیم می‌گیرد: نصب جدید + گزارش). */
  load(): { state: InstallState } | { tampered: true } | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Stored;
      const { mac, ...state } = raw;
      const expect = Buffer.from(macOf(state as InstallState), 'hex');
      const got = Buffer.from(String(mac ?? ''), 'hex');
      if (expect.length !== got.length || !timingSafeEqual(expect, got)) return { tampered: true };
      return { state: state as InstallState };
    } catch {
      return { tampered: true };
    }
  }

  /** نوشتن اتمیک (tmp + rename). false = دیسک قابل‌نوشتن نیست. */
  save(state: InstallState): boolean {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...state, mac: macOf(state) }), { mode: 0o600 });
      renameSync(tmp, this.file);
      try {
        chmodSync(this.file, 0o600);
      } catch {
        /* ignore */
      }
      return true;
    } catch {
      return false;
    }
  }
}
