import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { SessionVerifierService } from '../security/session-verifier.service.js';

/**
 * Live transport for the incoming-call popup — same shape as
 * support/support.gateway.ts, but rooms are per-user (`voip:user:<tenant
 * User.id>`) rather than per-tenant, since a call popup should only reach
 * the one person whose extension actually rang.
 */
@WebSocketGateway({
  namespace: '/voip',
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  },
})
export class VoipGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(VoipGateway.name);

  constructor(
    private readonly sessions: SessionVerifierService,
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const { payload } = await this.sessions.verifyTenantToken(token);

      const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: payload.tenantId } });
      const tenantDb = this.tenantPrisma.forTenant(tenant);
      const user = await tenantDb.user.findUnique({ where: { globalUserId: payload.sub } });
      if (!user) throw new Error('کاربر یافت نشد');

      await socket.join(`voip:user:${user.id}`);
    } catch (err) {
      this.logger.warn(`اتصال VoIP رد شد: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // socket.io drops room membership automatically on disconnect — nothing to clean up.
  }

  notifyIncomingCall(userId: string, payload: { fromNumber: string; contactId: string | null; contactName: string | null; callId: string }): void {
    this.server.to(`voip:user:${userId}`).emit('call.incoming', payload);
  }

  /** به ویجت تلفن هدر می‌گوید یک تماس (ورودی یا خروجی) پایان یافت — تا از حالت «در حال تماس» خارج شود و تاریخچه را دوباره بارگذاری کند. */
  notifyCallEnded(userId: string, payload: { callId: string; status: string; durationSeconds: number | null }): void {
    this.server.to(`voip:user:${userId}`).emit('call.ended', payload);
  }
}
