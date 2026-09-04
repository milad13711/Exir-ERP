import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ApiKeysController } from './api-keys.controller.js';

@Module({ imports: [ModuleGuardModule], controllers: [ApiKeysController] })
export class ApiKeysModule {}
