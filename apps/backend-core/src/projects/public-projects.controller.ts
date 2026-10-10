import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PublicTenantCtx } from '../proposals/public-proposals.service.js';
import { PublicProjectsService } from './public-projects.service.js';
import { PublicProjectCommentDto } from './dto/project-collab.dto.js';

/** صفحه‌ی عمومی پیگیری پروژه — بدون ورود؛ امنیت فقط توکن غیرقابل‌حدس + روشن‌بودن لینک (الگو: PublicProposalsController). */
@Controller('public/tenants/:slug/projects')
export class PublicProjectsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly publicProjects: PublicProjectsService,
  ) {}

  private async resolveTenant(slug: string): Promise<PublicTenantCtx> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantDb: this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName }),
    };
  }

  @Get(':token')
  async view(@Param('slug') slug: string, @Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.publicProjects.view(await this.resolveTenant(slug), token);
  }

  @Get(':token/files/:attachmentId')
  async file(@Param('slug') slug: string, @Param('token') token: string, @Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const f = await this.publicProjects.getFile(await this.resolveTenant(slug), token, attachmentId);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.title)}`);
    res.send(f.buffer);
  }

  @Post(':token/comments')
  async comment(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: PublicProjectCommentDto) {
    return this.publicProjects.comment(await this.resolveTenant(slug), token, dto);
  }
}
