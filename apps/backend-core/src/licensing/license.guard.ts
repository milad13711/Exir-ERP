import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LicenseRuntimeService } from './license-runtime.service.js';

// Always reachable even while blocked, so the UI can show *why* it's blocked,
// and so the management team's own control-plane endpoints (which this same
// codebase also serves in cloud mode) are never gated by a tenant's license.
const EXEMPT_PREFIXES = ['/api/license/status', '/api/licenses/check-in', '/api/admin', '/api/auth'];

/**
 * Applied globally (see AppModule). A no-op in cloud mode. On an on-premise
 * deployment, blocks every other route once the license is invalid or past
 * its grace period — see LicenseRuntimeService for how that state is reached.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly runtime: LicenseRuntimeService) {}

  canActivate(context: ExecutionContext): boolean {
    // Registered globally (APP_GUARD), so it also runs for the /support
    // WebSocket gateway's @SubscribeMessage handlers — those have no HTTP
    // request to inspect, and licensing doesn't apply to a live socket
    // that was only let in because its handshake JWT already checked out.
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return true;

    if (this.runtime.isBlocked()) {
      const status = this.runtime.getStatus();
      const reason =
        status.mode === 'on_premise' && (status.state === 'invalid' || status.state === 'expired')
          ? status.reason
          : 'دسترسی به دلیل وضعیت لایسنس مسدود شده است';
      throw new ForbiddenException(`دسترسی به سامانه مسدود است: ${reason}. لطفاً با پشتیبانی اکسیر تماس بگیرید.`);
    }
    return true;
  }
}
