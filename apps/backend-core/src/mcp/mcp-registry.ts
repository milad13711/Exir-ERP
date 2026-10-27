import type { McpDeps } from './mcp-deps.js';
import { buildCoreMcpTools } from './mcp-tools.js';
import { buildTaskTools } from './mcp-tools.tasks.js';
import { buildCorrespondenceTools } from './mcp-tools.correspondence.js';
import { buildDispatchTools } from './mcp-tools.dispatch.js';
import { buildBookingTools } from './mcp-tools.booking.js';
import { buildMiscTools } from './mcp-tools.misc.js';
import type { McpTool } from './mcp-tool.types.js';

export function buildAllMcpTools(d: McpDeps): McpTool[] {
  return [
    ...buildCoreMcpTools(d.invoices, d.purchaseOrders, d.controlDb),
    ...buildTaskTools(d),
    ...buildCorrespondenceTools(d),
    ...buildDispatchTools(d),
    ...buildBookingTools(d),
    ...buildMiscTools(d),
  ];
}
