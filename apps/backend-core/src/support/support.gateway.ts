import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { AdminJwtPayload, TenantJwtPayload } from '../auth/jwt-payload.type.js';
import type { SupportMessage, SupportTicket } from '../../generated/control-client/index.js';

type SocketAuth =
  | { kind: 'tenant'; tenantId: string; globalUserId: string }
  | { kind: 'admin'; adminId: string };

/**
 * Live transport for the support chat. Auth is verified once at connection
 * time (handshake.auth.token) — the same tenant/admin JWTs the REST API
 * accepts — then the socket is dropped straight into rooms so the
 * REST-writing services (SupportService / AdminSupportService) can fan out
 * an event without knowing who's listening.
 */
@WebSocketGateway({
  namespace: '/support',
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  },
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SupportGateway.name);
  private readonly authBySocket = new Map<string, SocketAuth>();

  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const auth = await this.resolveAuth(token);
      this.authBySocket.set(socket.id, auth);
      if (auth.kind === 'tenant') {
        await socket.join(`tenant:${auth.tenantId}`);
      } else {
        await socket.join('admin');
      }
    } catch (err) {
      this.logger.warn(`اتصال چت رد شد: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    this.authBySocket.delete(socket.id);
  }

  @SubscribeMessage('ticket:join')
  async onJoinTicket(@ConnectedSocket() socket: Socket, @MessageBody() ticketId: string) {
    const auth = this.authBySocket.get(socket.id);
    if (!auth || typeof ticketId !== 'string') return;
    const ticket = await this.controlDb.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return;
    if (auth.kind === 'tenant' && ticket.tenantId !== auth.tenantId) return;
    await socket.join(`ticket:${ticketId}`);
  }

  @SubscribeMessage('ticket:leave')
  async onLeaveTicket(@ConnectedSocket() socket: Socket, @MessageBody() ticketId: string) {
    if (typeof ticketId !== 'string') return;
    await socket.leave(`ticket:${ticketId}`);
  }

  private async resolveAuth(token: string): Promise<SocketAuth> {
    // Try tenant token first, then admin token — same two payload shapes
    // JwtAuthGuard/AdminJwtAuthGuard verify, without re-implementing their
    // full request-context resolution (this gateway only needs identity).
    try {
      const payload = await this.jwt.verifyAsync<TenantJwtPayload>(token);
      if (payload.type === 'tenant_user' && payload.tenantId) {
        return { kind: 'tenant', tenantId: payload.tenantId, globalUserId: payload.sub };
      }
    } catch {
      // fall through to admin verification
    }
    const adminPayload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
    if (!adminPayload.isAdmin) throw new Error('توکن نامعتبر است');
    const admin = await this.controlDb.adminUser.findUnique({ where: { id: adminPayload.sub } });
    if (!admin || !admin.isActive) throw new Error('حساب کارشناسی غیرفعال است');
    return { kind: 'admin', adminId: adminPayload.sub };
  }

  /** Fan-out after a message is persisted — ticket room (whoever has it open) + admin (global popup) + the tenant's other tabs. */
  notifyNewMessage(ticket: SupportTicket, message: SupportMessage) {
    this.server.to(`ticket:${ticket.id}`).to('admin').to(`tenant:${ticket.tenantId}`).emit('message:new', {
      ticketId: ticket.id,
      message,
    });
  }

  notifyTicketCreated(ticket: SupportTicket & { messages?: SupportMessage[] }) {
    this.server.to('admin').emit('ticket:new', { ticket });
  }

  notifyTicketUpdated(ticket: SupportTicket) {
    this.server.to(`ticket:${ticket.id}`).to('admin').to(`tenant:${ticket.tenantId}`).emit('ticket:updated', {
      ticket,
    });
  }
}
