import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { McpController } from './mcp.controller.js';

@Module({ imports: [ModuleGuardModule], controllers: [McpController] })
export class McpModule {}
