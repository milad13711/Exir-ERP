import { Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SupportGateway } from '../support/support.gateway.js';
import type { TicketStatus } from '../../generated/control-client/index.js';

@Injectable()
export class AdminSupportService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly gateway: SupportGateway,
  ) {}

  async listTickets(status?: TicketStatus) {
    return this.controlDb.supportTicket.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { name: true, slug: true } },
        createdByUser: { select: { name: true, phone: true } },
        assignedAdmin: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  private async getTicketOrThrow(id: string) {
    const ticket = await this.controlDb.supportTicket.findUnique({
      where: { id },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    return ticket;
  }

  async getTicket(id: string) {
    const ticket = await this.controlDb.supportTicket.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true, slug: true } },
        createdByUser: { select: { name: true, phone: true } },
        assignedAdmin: { select: { name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    return ticket;
  }

  /** This is the "convert to task and hand off to a specialist" step. */
  async assign(ticketId: string, assignedAdminId: string, actingAdminId: string) {
    await this.getTicketOrThrow(ticketId);
    const assignee = await this.controlDb.adminUser.findUnique({
      where: { id: assignedAdminId },
    });
    if (!assignee) throw new NotFoundException('کارشناس یافت نشد');

    const ticket = await this.controlDb.supportTicket.update({
      where: { id: ticketId },
      data: { assignedAdminId, status: 'IN_PROGRESS' },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    await this.controlDb.supportMessage.create({
      data: {
        ticketId,
        senderType: 'SYSTEM',
        body: `تیکت به ${assignee.name} ارجاع داده شد`,
      },
    });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actingAdminId,
        tenantId: ticket.tenantId,
        action: 'support_ticket.assigned',
        entityType: 'SupportTicket',
        entityId: ticketId,
        metadata: { assignedAdminId },
      },
    });
    this.gateway.notifyTicketUpdated(ticket);
    return ticket;
  }

  async reply(ticketId: string, adminId: string, body: string) {
    const ticket = await this.getTicketOrThrow(ticketId);
    const message = await this.controlDb.supportMessage.create({
      data: { ticketId, senderType: 'ADMIN', senderId: adminId, body },
    });
    this.gateway.notifyNewMessage(ticket, message);
    return message;
  }

  async resolve(ticketId: string, resolutionNote: string, actingAdminId: string) {
    const ticket = await this.controlDb.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    await this.controlDb.supportMessage.create({
      data: { ticketId, senderType: 'SYSTEM', body: `تیکت رفع شد: ${resolutionNote}` },
    });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actingAdminId,
        tenantId: ticket.tenantId,
        action: 'support_ticket.resolved',
        entityType: 'SupportTicket',
        entityId: ticketId,
        metadata: { resolutionNote },
      },
    });
    this.gateway.notifyTicketUpdated(ticket);
    return ticket;
  }
}
