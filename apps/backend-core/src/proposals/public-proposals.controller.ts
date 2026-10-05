import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { PublicProposalsService, type PublicTenantCtx } from './public-proposals.service.js';
import { PublicAcceptProposalDto, PublicCommentProposalDto, PublicRejectProposalDto } from './dto/proposal-actions.dto.js';
import { extractClientIp } from './proposal.util.js';

/**
 * صفحه‌ی عمومی پروپوزال برای مشتری — بدون ورود؛ امنیت فقط توکن غیرقابل‌حدس (Proposal.publicToken) است و
 * slug/publicKey فقط پایگاه‌داده‌ی تننت را انتخاب می‌کند. الگو: PublicQuotationsController.
 */
@Controller('public/tenants/:slug/proposals')
export class PublicProposalsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly publicProposals: PublicProposalsService,
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

  private meta(req: Request) {
    const ua = req.headers['user-agent'];
    return { ip: extractClientIp(req.headers, req.socket?.remoteAddress), userAgent: typeof ua === 'string' ? ua : undefined };
  }

  @Get(':token')
  async view(@Param('slug') slug: string, @Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.publicProposals.view(await this.resolveTenant(slug), token, this.meta(req));
  }

  @Get(':token/files/:attachmentId')
  async file(@Param('slug') slug: string, @Param('token') token: string, @Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const f = await this.publicProposals.getFile(await this.resolveTenant(slug), token, attachmentId);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.title)}`);
    res.send(f.buffer);
  }

  @Post(':token/accept')
  async accept(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: PublicAcceptProposalDto, @Req() req: Request) {
    return this.publicProposals.accept(await this.resolveTenant(slug), token, dto, this.meta(req));
  }

  @Post(':token/reject')
  async reject(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: PublicRejectProposalDto, @Req() req: Request) {
    return this.publicProposals.reject(await this.resolveTenant(slug), token, dto, this.meta(req));
  }

  @Post(':token/comments')
  async comment(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: PublicCommentProposalDto, @Req() req: Request) {
    return this.publicProposals.comment(await this.resolveTenant(slug), token, dto, this.meta(req));
  }
}
