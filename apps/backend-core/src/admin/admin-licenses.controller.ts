import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { LicenseIssuerService } from '../licensing/license-issuer.service.js';
import { CreateLicenseDto } from './dto/create-license.dto.js';
import { RevokeLicenseDto } from './dto/revoke-license.dto.js';

/**
 * On-premise license issuance for the management team. Issuing here signs
 * an offline-verifiable token with the Control Plane's private key — the
 * signed key returned in the response is what gets handed to the tenant to
 * paste into their on-premise deployment's .env (LICENSE_KEY).
 */
@Controller('admin/licenses')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminLicensesController {
  constructor(private readonly licenses: LicenseIssuerService) {}

  @Get()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  list() {
    return this.licenses.list();
  }

  @Post()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  issue(@Body() dto: CreateLicenseDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.licenses.issue(dto, ctx.auth.sub);
  }

  @Post(':id/revoke')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  revoke(@Param('id') id: string, @Body() dto: RevokeLicenseDto) {
    return this.licenses.revoke(id, dto.reason);
  }
}
