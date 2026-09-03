import { Injectable, Logger } from '@nestjs/common';
import type { TriggerDefinition } from './types.js';

/**
 * In-memory catalog of every trigger any installed module has registered.
 * Built once at boot from each feature module's own `onModuleInit` (see
 * e.g. production/production-automation.triggers.ts) — this service itself
 * has zero knowledge of what "production" or "sales" are. A new module
 * plugs in by registering here; this file never changes for it.
 */
@Injectable()
export class TriggerRegistryService {
  private readonly logger = new Logger('TriggerRegistryService');
  private readonly definitions = new Map<string, TriggerDefinition>();

  register(definition: TriggerDefinition): void {
    if (this.definitions.has(definition.code)) {
      this.logger.warn(`Trigger "${definition.code}" registered more than once — keeping the first registration`);
      return;
    }
    this.definitions.set(definition.code, definition);
  }

  get(code: string): TriggerDefinition | undefined {
    return this.definitions.get(code);
  }

  getAll(): TriggerDefinition[] {
    return [...this.definitions.values()];
  }
}
