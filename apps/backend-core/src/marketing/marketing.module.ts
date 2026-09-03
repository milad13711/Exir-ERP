import { Module } from '@nestjs/common';
import { PublicCatalogController } from './public-catalog.controller.js';

@Module({ controllers: [PublicCatalogController] })
export class MarketingModule {}
