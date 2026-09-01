import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SupportGateway } from './support.gateway.js';

@Injectable()
export class SupportService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly gateway: SupportGateway,
  ) {}

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

  private async findOwnedTicket(tenantId: string, ticketId: string) {
    const ticket = await this.controlDb.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.tenantId !== tenantId) {
      throw new NotFoundException('تیکت یافت نشد');
    }
    return ticket;
  }

  async getMessages(tenantId: string, ticketId: string) {
    const ticket = await this.findOwnedTicket(tenantId, ticketId);
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
  ) {
    const ticket = await this.findOwnedTicket(tenantId, ticketId);
    if (ticket.status === 'CLOSED') {
      throw new ForbiddenException('این تیکت بسته شده است');
    }
    const message = await this.controlDb.supportMessage.create({
      data: { ticketId: ticket.id, senderType: 'TENANT_USER', senderId: globalUserId, body },
    });
    this.gateway.notifyNewMessage(ticket, message);
    return message;
  }
}
