import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { SessionVerifierService } from '../security/session-verifier.service.js';

/**
 * Live delivery for "the AI agent wants to do X — approve?" — same per-user
 * room pattern as voip/voip.gateway.ts. A pending request has no single
 * natural approver (MCP calls authenticate with a tenant API key, not a
 * specific logged-in user), so this broadcasts to every currently-connected
 * OWNER/ADMIN room rather than picking one.
 */
@WebSocketGateway({
  namespace: '/ai-approvals',
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  },
})
export class AiApprovalGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(AiApprovalGateway.name);

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

      await socket.join(`ai-approvals:user:${user.id}`);
    } catch (err) {
      this.logger.warn(`اتصال تأیید دستیار هوشمند رد شد: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  notifyPending(userIds: string[], payload: { id: string; toolName: string; operationType: string; summary: string }): void {
    for (const userId of userIds) {
      this.server.to(`ai-approvals:user:${userId}`).emit('action.pending', payload);
    }
  }

  notifyResolved(userIds: string[], payload: { id: string; status: string }): void {
    for (const userId of userIds) {
      this.server.to(`ai-approvals:user:${userId}`).emit('action.resolved', payload);
    }
  }
}
