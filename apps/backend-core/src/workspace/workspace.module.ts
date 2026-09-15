import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceController } from './workspace.controller.js';
import { PublicManifestController } from './public-manifest.controller.js';

@Module({ imports: [AuthModule], controllers: [WorkspaceController, PublicManifestController] })
export class WorkspaceModule {}
