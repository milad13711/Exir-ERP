import { publicRef } from '../common/tenant-public-key.js';

function webPanelPublicUrl(): string {
  return (process.env.WEB_PANEL_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function certificateVerifyUrl(tenantSlug: string, code: string): string {
  return `${webPanelPublicUrl()}/certificate/${publicRef(tenantSlug)}/${code}`;
}
