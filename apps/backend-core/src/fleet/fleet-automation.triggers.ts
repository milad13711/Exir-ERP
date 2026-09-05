import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class FleetAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'fleet.shipment.offer_accepted',
      moduleCode: 'fleet',
      label: 'پذیرش پیشنهاد بار توسط راننده',
      description: 'وقتی یکی از راننده‌های پیشنهادی، بار را از طریق لینک عمومی می‌پذیرد.',
      payloadFields: [
        { key: 'shipmentNo', label: 'شماره بار', type: 'NUMBER' },
        { key: 'driverName', label: 'نام راننده', type: 'STRING' },
        { key: 'driverPhone', label: 'شماره راننده', type: 'STRING' },
      ],
    });

    this.registry.register({
      code: 'fleet.shipment.delivered',
      moduleCode: 'fleet',
      label: 'تحویل بار',
      description: 'وقتی یک بار به‌عنوان تحویل‌شده ثبت می‌شود.',
      payloadFields: [
        { key: 'shipmentNo', label: 'شماره بار', type: 'NUMBER' },
        { key: 'cargoType', label: 'نوع بار', type: 'STRING' },
      ],
    });
  }
}
