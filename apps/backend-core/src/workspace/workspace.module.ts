import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller.js';
import { PublicManifestController } from './public-manifest.controller.js';

@Module({ controllers: [WorkspaceController, PublicManifestController] })
export class WorkspaceModule {}
