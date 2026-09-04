import { Injectable, Logger } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { TriggerRegistryService } from './trigger-registry.service.js';
import { renderTemplate } from './template.js';
import { resolveFixedOrFieldTarget, type AutomationActionConfig } from './action-config.js';
import type { TriggerPayload } from './types.js';

/**
 * The one place that actually runs a tenant's configured automations. Never
 * imports a feature module — everything it needs (what the trigger means,
 * what the action targets) arrives already resolved in `payload` or
 * declared generically in `config`. See TriggerRegistryService for the
 * registration half of this contract.
 */
@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger('AutomationEngineService');

  constructor(
    private readonly registry: TriggerRegistryService,
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
    private readonly sms: ExirSmsService,
  ) {}

  /** Fired by a module's own code, right where the real event happens (or via the manual /automation/fire endpoint). A no-op if automation isn't installed or nothing is configured for this trigger — safe to call unconditionally. */
  async emit(ctx: TenantRequestContext, triggerCode: string, payload: TriggerPayload): Promise<void> {
    const definition = this.registry.get(triggerCode);
    if (!definition) {
      this.logger.warn(`emit() called for unregistered trigger "${triggerCode}"`);
      return;
    }

    const automationInstalled = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: ctx.tenantId, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'automation' } },
    });
    if (!automationInstalled) return;

    const rules = await ctx.tenantDb.automationRule.findMany({
      where: { triggerCode, isActive: true },
      include: { actions: { orderBy: { sequenceOrder: 'asc' } } },
    });
    if (rules.length === 0) return;

    for (const rule of rules) {
      for (const action of rule.actions) {
        try {
          const config = { ...(action.config as object), type: action.type } as unknown as AutomationActionConfig;
          await this.runAction(ctx, config, payload);
          await ctx.tenantDb.automationRunLog.create({
            data: { ruleId: rule.id, actionType: action.type, status: 'SUCCESS' },
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.logger.error(`Automation rule "${rule.name}" action ${action.type} failed: ${error}`);
          await ctx.tenantDb.automationRunLog.create({
            data: { ruleId: rule.id, actionType: action.type, status: 'FAILED', error },
          });
        }
      }
    }
  }

  private async runAction(ctx: TenantRequestContext, config: AutomationActionConfig, payload: TriggerPayload): Promise<void> {
    if (config.type === 'NOTIFY_IN_APP') {
      const userId = resolveFixedOrFieldTarget(config.targetMode, config.fixedUserId, config.payloadField, payload);
      if (!userId) throw new Error('کاربر مقصد اعلان قابل تشخیص نبود');
      await this.notifications.notify(ctx.tenantDb, {
        userId,
        type: 'automation',
        title: renderTemplate(config.title, payload),
        body: renderTemplate(config.body, payload),
        link: config.link,
      });
      return;
    }

    if (config.type === 'SEND_SMS') {
      const phone = resolveFixedOrFieldTarget(config.phoneMode, config.fixedPhone, config.payloadField, payload);
      if (!phone) throw new Error('شماره تلفن مقصد پیامک قابل تشخیص نبود');
      const result = await this.sms.sendSms(phone, renderTemplate(config.message, payload));
      if (!result.success) throw new Error(result.error);
      return;
    }

    if (config.type === 'CREATE_TASK') {
      const assignedUserId =
        config.assigneeMode === 'NONE'
          ? undefined
          : (resolveFixedOrFieldTarget(config.assigneeMode, config.fixedUserId, config.payloadField, payload) ?? undefined);
      await ctx.tenantDb.task.create({
        data: {
          title: renderTemplate(config.title, payload),
          assignedUserId,
          priority: config.priority ?? 'NORMAL',
        },
      });
      return;
    }
  }
}
