import { Injectable, Logger } from '@nestjs/common';
import type { VoipProviderAdapter } from './types.js';

/** Same self-registration pattern as automation/trigger-registry.service.ts — this file never learns a new provider's name. */
@Injectable()
export class VoipProviderRegistryService {
  private readonly logger = new Logger('VoipProviderRegistryService');
  private readonly adapters = new Map<string, VoipProviderAdapter>();

  register(adapter: VoipProviderAdapter): void {
    if (this.adapters.has(adapter.code)) {
      this.logger.warn(`VoIP provider "${adapter.code}" registered more than once — keeping the first registration`);
      return;
    }
    this.adapters.set(adapter.code, adapter);
  }

  get(code: string): VoipProviderAdapter | undefined {
    return this.adapters.get(code);
  }

  getAll(): VoipProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
