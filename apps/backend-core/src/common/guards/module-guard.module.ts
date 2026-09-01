import { Module } from '@nestjs/common';
import { ModuleGuard } from './module.guard.js';

@Module({ providers: [ModuleGuard], exports: [ModuleGuard] })
export class ModuleGuardModule {}
