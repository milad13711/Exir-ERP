import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { WorkspaceController } from './workspace.controller.js';
import { PublicManifestController } from './public-manifest.controller.js';

@Module({ imports: [AuthModule, SettingsModule, PermissionsModule], controllers: [WorkspaceController, PublicManifestController] })
export class WorkspaceModule {}
