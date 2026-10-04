import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SupportGateway } from './support.gateway.js';
import { PushNotificationsService } from '../notifications/push-notifications.service.js';

@Injectable()
export class SupportService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly gateway: SupportGateway,
    private readonly push: PushNotificationsService,
  ) {}

  /** Assigned admin gets pushed directly; an unassigned/newly-created ticket pushes the whole SUPPORT team so someone picks it up fast. */
  private async pushForTicket(
    ticket: { assignedAdminId: string | null; subject: string; tenantId: string },
    body: string,
  ) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ticket.tenantId }, select: { name: true } });
    const payload = { title: `پشتیبانی — ${tenant?.name ?? ''}`, body: `${ticket.subject}: ${body}`, url: '/support' };
    if (ticket.assignedAdminId) {
      await this.push.sendToAdmin(ticket.assignedAdminId, payload);
    } else {
      await Promise.all([this.push.sendToTeam('SUPPORT', payload), this.push.sendToTeam('SUPER_ADMIN', payload)]);
    }
  }

  async createTicket(tenantId: string, globalUserId: string, subject: string, message: string) {
    const ticket = await this.controlDb.supportTicket.create({
      data: {
        tenantId,
        createdByUserId: globalUserId,
        subject,
        messages: {
          create: [{ senderType: 'TENANT_USER', senderId: globalUserId, body: message }],
        },
      },
      include: { messages: true, tenant: { select: { name: true, slug: true } } },
    });
    this.gateway.notifyTicketCreated(ticket);
    void this.pushForTicket(ticket, message).catch(() => {});
    return ticket;
  }

  async listMyTickets(tenantId: string, globalUserId: string) {
    return this.controlDb.supportTicket.findMany({
      where: { tenantId, createdByUserId: globalUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        assignedAdmin: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  /** تیکت باید متعلق به همین مستأجر باشد؛ و اگر `actor` داده شود، کاربر عادی فقط تیکت‌های خودش را می‌بیند (مالک/مدیر همه‌ی تیکت‌های مستأجر). */
  private async findOwnedTicket(tenantId: string, ticketId: string, actor?: { sub: string; manager: boolean }) {
    const ticket = await this.controlDb.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.tenantId !== tenantId) {
      throw new NotFoundException('تیکت یافت نشد');
    }
    if (actor && !actor.manager && ticket.createdByUserId !== actor.sub) {
      throw new NotFoundException('تیکت یافت نشد');
    }
    return ticket;
  }

  async getMessages(tenantId: string, ticketId: string, actor?: { sub: string; manager: boolean }) {
    const ticket = await this.findOwnedTicket(tenantId, ticketId, actor);
    const messages = await this.controlDb.supportMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });
    return { ticket, messages };
  }

  async addTenantMessage(
    tenantId: string,
    ticketId: string,
    globalUserId: string,
    body: string,
    manager = false,
  ) {
    const ticket = await this.findOwnedTicket(tenantId, ticketId, { sub: globalUserId, manager });
    if (ticket.status === 'CLOSED') {
      throw new ForbiddenException('این تیکت بسته شده است');
    }
    const message = await this.controlDb.supportMessage.create({
      data: { ticketId: ticket.id, senderType: 'TENANT_USER', senderId: globalUserId, body },
    });
    this.gateway.notifyNewMessage(ticket, message);
    void this.pushForTicket(ticket, body).catch(() => {});
    return message;
  }
}
