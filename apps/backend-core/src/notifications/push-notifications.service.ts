import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

type PushPayload = { title: string; body: string; url?: string };

/**
 * Web Push for admin-panel staff (support tickets need a fast reply — see
 * PWA install + SupportService's hooks into new-message/new-ticket). Each
 * browser/device an admin enables notifications on gets its own
 * AdminPushSubscription row; sending is fire-and-forget per subscription,
 * with a dead (410/404) endpoint pruned on the spot rather than left to
 * fail forever.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger('PushNotificationsService');
  private readonly configured: boolean;

  constructor(private readonly controlDb: ControlPrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails('mailto:support@exir.co', publicKey!, privateKey!);
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  async sendToAdmin(adminUserId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subs = await this.controlDb.adminPushSubscription.findMany({ where: { adminUserId } });
    await Promise.all(subs.map((sub) => this.sendOne(sub, payload)));
  }

  async sendToTeam(team: 'SUPPORT' | 'SUPER_ADMIN' | 'BILLING' | 'ENGINEERING', payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const admins = await this.controlDb.adminUser.findMany({ where: { team, isActive: true }, select: { id: true } });
    await Promise.all(admins.map((a) => this.sendToAdmin(a.id, payload)));
  }

  private async sendOne(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await this.controlDb.adminPushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        this.logger.warn(`Push send failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
