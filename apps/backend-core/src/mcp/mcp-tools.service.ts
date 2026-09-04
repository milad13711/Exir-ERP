import { Injectable } from '@nestjs/common';
import { InvoicesService } from '../sales/invoices.service.js';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { buildMcpTools, type McpTool } from './mcp-tools.js';

/** Builds the tool list once, with the real services some tools reuse — see mcp-tools.ts. */
@Injectable()
export class McpToolsService {
  readonly tools: McpTool[];

  constructor(invoices: InvoicesService, purchaseOrders: PurchaseOrdersService, controlDb: ControlPrismaService) {
    this.tools = buildMcpTools(invoices, purchaseOrders, controlDb);
  }
}
