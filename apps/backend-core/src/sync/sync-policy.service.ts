import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { mergeStoredPolicy, POLICY_KEY, POLICY_MODULE_CODE, validatePolicyInput, type OfflinePolicy } from './sync-policy.js';

const TTL_MS = 30_000;

@Injectable()
export class SyncPolicyService {
  private readonly cache = new Map<string, { at: number; policy: OfflinePolicy }>();

  async get(ctx: Pick<TenantRequestContext, 'tenantId' | 'tenantDb'>, now = Date.now()): Promise<OfflinePolicy> {
    const hit = this.cache.get(ctx.tenantId);
    if (hit && now - hit.at < TTL_MS) return hit.policy;
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: POLICY_MODULE_CODE, key: POLICY_KEY } } });
    const policy = mergeStoredPolicy(row?.value);
    this.cache.set(ctx.tenantId, { at: now, policy });
    return policy;
  }

  async put(ctx: Pick<TenantRequestContext, 'tenantId' | 'tenantDb'>, input: unknown): Promise<OfflinePolicy> {
    const policy = validatePolicyInput(input);
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: POLICY_MODULE_CODE, key: POLICY_KEY } },
      create: { moduleCode: POLICY_MODULE_CODE, key: POLICY_KEY, value: policy as never },
      update: { value: policy as never },
    });
    this.cache.delete(ctx.tenantId);
    return policy;
  }
}
