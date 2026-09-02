import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

const DEFAULT_THEME_COLOR = '#4338ca';

/**
 * Per-tenant PWA manifest so each business's installed web app carries its
 * own name/icon/theme instead of the generic Exir branding. Unauthenticated
 * on purpose — browsers fetch manifest links without auth headers — so it
 * exposes only public branding, resolved by tenant slug like the other
 * `public/tenants/:slug/...` routes (see PublicQuotationsController).
 */
@Controller('public/tenants/:slug')
export class PublicManifestController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json')
  async manifest(@Param('slug') slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('تننت یافت نشد');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    const logoSetting = await tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: 'general', key: 'logoUrl' } },
    });
    const logoUrl = logoSetting?.value as string | undefined;
    const themeColor = tenant.themeColor ?? DEFAULT_THEME_COLOR;

    return {
      name: tenant.name,
      short_name: tenant.name,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: themeColor,
      icons: logoUrl
        ? [
            { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ]
        : [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
    };
  }
}
