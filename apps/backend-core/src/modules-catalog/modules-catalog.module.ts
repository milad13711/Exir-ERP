import { Module } from '@nestjs/common';
import { ModulesCatalogController } from './modules-catalog.controller.js';

@Module({ controllers: [ModulesCatalogController] })
export class ModulesCatalogModule {}
