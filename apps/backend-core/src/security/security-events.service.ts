import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

export type SecurityEventType =
  | 'RATE_LIMITED'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGIN_SUCCESS'
  | 'OTP_LOCKED'
  | 'OTP_CAP_REACHED'
  | 'TOTP_FAILED'
  | 'TOTP_ENABLED'
  | 'TOTP_DISABLED'
  | 'TOTP_RESET'
  | 'PASSWORD_CHANGED'
  | 'PERMISSION_DENIED'
  | 'TOKEN_REVOKED'
  | 'API_KEY_REVOKED_ALL'
  | 'SESSIONS_INVALIDATED'
  | 'API_KEY_AUTH_FAILED'
  | 'SSRF_BLOCKED'
  | 'CONFIG_INSECURE';

export type SecurityEvent = {
  type: SecurityEventType;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'FATAL';
  message: string;
  ip?: string;
  tenantId?: string | null;
  actor?: string | null;
  context?: Record<string, unknown>;
  /** رویدادهای هم‌کلید در ۶۰ ثانیه فقط یک‌بار در DB نوشته می‌شوند (جلوگیری از سیل لاگ هنگام حمله). */
  dedupeKey?: string;
};

const DEDUPE_MS = 60_000;
const MAX_TRACKED = 5_000;

/**
 * ثبت رویدادهای امنیتی در ErrorLog کنترل‌پلین (service = "security") — همان جدولی که پنل ادمین می‌خواند.
 * هرگز رمز/توکن/کد OTP/شماره‌ی کامل نمی‌نویسد (فراخواننده‌ها ماسک می‌کنند). شکست نوشتن هیچ‌وقت درخواست را نمی‌شکند.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('Security');
  private readonly recent = new Map<string, { at: number; suppressed: number }>();

  constructor(private readonly controlDb: ControlPrismaService) {}

  record(ev: SecurityEvent): void {
    const now = Date.now();
    if (ev.dedupeKey) {
      const k = `${ev.type}:${ev.dedupeKey}`;
      const prev = this.recent.get(k);
      if (prev && now - prev.at < DEDUPE_MS) {
        prev.suppressed += 1;
        return;
      }
      if (this.recent.size > MAX_TRACKED) this.recent.clear();
      this.recent.set(k, { at: now, suppressed: 0 });
    }
    const line = `[SECURITY:${ev.type}] ${ev.message}${ev.ip ? ` ip=${ev.ip}` : ''}`;
    if (ev.severity === 'INFO') this.logger.log(line);
    else this.logger.warn(line);
    void this.controlDb.errorLog
      .create({
        data: {
          tenantId: ev.tenantId ?? undefined,
          service: 'security',
          level: ev.severity === 'WARNING' ? 'WARNING' : ev.severity,
          message: line,
          context: { eventType: ev.type, ip: ev.ip, actor: ev.actor ?? undefined, ...(ev.context ?? {}) } as never,
        },
      })
      .catch((err: unknown) => this.logger.warn(`security event persist failed: ${err instanceof Error ? err.message : err}`));
  }
}
