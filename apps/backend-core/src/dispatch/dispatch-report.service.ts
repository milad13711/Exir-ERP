import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';
import { faDate, faTime } from '../common/persian.js';
import { resolveActor } from './dispatch-common.js';
import { DispatchService } from './dispatch.service.js';
import { STATUS_LABELS_FA, TERMINAL_STATUSES } from './dispatch-state.js';

export type ReportFilters = {
  status?: string;
  driverId?: string;
  region?: string;
  cargoType?: string;
  contactId?: string;
  minNetKg?: number;
  maxNetKg?: number;
  from?: string;
  to?: string;
  q?: string;
  /** فقط بارهای دارای گردش dispatch (پیش‌فرض بله) */
  onlyDispatch?: boolean;
  limit?: number;
};

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
}

const CSV_HEADER = ['شماره بار', 'وضعیت', 'مشتری', 'نوع بار', 'منطقه', 'راننده', 'پلاک', 'وزن خالی (kg)', 'وزن پر (kg)', 'وزن خالص (kg)', 'ثبت', 'آماده حرکت', 'تحویل'];

export type ReportRow = {
  id: string;
  shipmentNo: number;
  status: string;
  statusLabel: string;
  customerName: string | null;
  cargoType: string;
  region: string | null;
  driverName: string | null;
  plateNumber: string | null;
  tareKg: number | null;
  grossKg: number | null;
  netKg: number | null;
  createdAt: Date;
  readyAt: Date | null;
  deliveredAt: Date | null;
  docsRequired: number;
  needsWeighing: boolean;
};

@Injectable()
export class DispatchReportService {
  constructor(private readonly dispatch: DispatchService) {}

  /**
   * شمارنده‌ی ارزان برای ویجت داشبورد: تعداد بارهای فعال (غیر تحویل‌شده/لغو) به تفکیک وضعیت، در دامنه‌ی دید کاربر.
   * فقط یک groupBy؛ بدون خواندن ردیف. دامنه همان scopeWhere فهرست است (بدون دسترسی ۴۰۳).
   */
  async activeCounts(ctx: TenantRequestContext): Promise<{
    active: number;
    awaitingDriver: number;
    awaitingDocs: number;
    readyToDepart: number;
    inTransit: number;
    suspended: number;
    byStatus: Record<string, number>;
  }> {
    const actor = await resolveActor(ctx);
    const scope = await this.dispatch.scopeWhere(ctx, actor);
    const groups = await ctx.tenantDb.shipment.groupBy({
      by: ['status'],
      where: { AND: [scope, { loading: { isNot: null } }, { status: { notIn: [...TERMINAL_STATUSES] } }] } as never,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    let active = 0;
    for (const g of groups as Array<{ status: string; _count: { _all: number } }>) {
      byStatus[g.status] = g._count._all;
      active += g._count._all;
    }
    const c = (s: string) => byStatus[s] ?? 0;
    return {
      active,
      awaitingDriver: c('AWAITING_DRIVER') + c('OFFERED'),
      awaitingDocs: c('AWAITING_DOCS'),
      readyToDepart: c('READY_TO_DEPART'),
      inTransit: c('IN_TRANSIT'),
      suspended: c('SUSPENDED'),
      byStatus,
    };
  }

  async query(ctx: TenantRequestContext, f: ReportFilters): Promise<{ rows: ReportRow[]; summary: { count: number; totalNetKg: number; withWeight: number; byStatus: Record<string, number> } }> {
    const actor = await resolveActor(ctx);
    const scope = await this.dispatch.scopeWhere(ctx, actor);
    const and: Record<string, unknown>[] = [scope];
    if (f.onlyDispatch !== false) and.push({ loading: { isNot: null } });
    if (f.status) and.push({ status: f.status });
    if (f.driverId) and.push({ driverId: f.driverId });
    if (f.contactId) and.push({ contactId: f.contactId });
    if (f.region?.trim()) and.push({ region: { contains: f.region.trim(), mode: 'insensitive' } });
    if (f.cargoType?.trim()) and.push({ cargoType: { contains: f.cargoType.trim(), mode: 'insensitive' } });
    if (f.minNetKg != null || f.maxNetKg != null) {
      and.push({ loading: { is: { netKg: { ...(f.minNetKg != null ? { gte: f.minNetKg } : {}), ...(f.maxNetKg != null ? { lte: f.maxNetKg } : {}) } } } });
    }
    if (f.from) and.push({ createdAt: { gte: new Date(f.from) } });
    if (f.to) {
      const to = new Date(f.to);
      if (!f.to.includes('T')) to.setHours(23, 59, 59, 999);
      and.push({ createdAt: { lte: to } });
    }
    const term = normalizeSearchTerm(f.q);
    if (term) {
      const no = searchTermAsInt(term);
      and.push({
        OR: [
          ...(no !== undefined ? [{ shipmentNo: no }] : []),
          { cargoType: { contains: term, mode: 'insensitive' } },
          { contact: { name: { contains: term, mode: 'insensitive' } } },
          { driver: { name: { contains: term, mode: 'insensitive' } } },
          { driver: { plateNumber: { contains: term, mode: 'insensitive' } } },
          { loading: { is: { customerName: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }
    const where = { AND: and };
    const shipments = await ctx.tenantDb.shipment.findMany({
      where,
      include: { loading: true, contact: { select: { name: true } }, driver: { select: { name: true, plateNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(f.limit ?? 500, 1), 2000),
    });
    const rows: ReportRow[] = shipments.map((s) => ({
      id: s.id,
      shipmentNo: s.shipmentNo,
      status: s.status,
      statusLabel: STATUS_LABELS_FA[s.status as keyof typeof STATUS_LABELS_FA] ?? s.status,
      customerName: s.loading?.customerName ?? s.contact?.name ?? null,
      cargoType: s.cargoType,
      region: s.region,
      driverName: s.driver?.name ?? null,
      plateNumber: s.driver?.plateNumber ?? null,
      tareKg: s.loading?.tareKg ?? null,
      grossKg: s.loading?.grossKg ?? null,
      netKg: s.loading?.netKg ?? null,
      createdAt: s.createdAt,
      readyAt: s.loading?.readyGrantedAt ?? null,
      deliveredAt: s.deliveredAt,
      docsRequired: s.loading?.requiredDocTypes.length ?? 0,
      needsWeighing: s.loading?.needsWeighing ?? false,
    }));
    const byStatus: Record<string, number> = {};
    let totalNetKg = 0;
    let withWeight = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.netKg != null) {
        totalNetKg += r.netKg;
        withWeight++;
      }
    }
    return { rows, summary: { count: rows.length, totalNetKg: Math.round(totalNetKg * 1000) / 1000, withWeight, byStatus } };
  }

  async csv(ctx: TenantRequestContext, f: ReportFilters): Promise<string> {
    const { rows, summary } = await this.query(ctx, { ...f, limit: 2000 });
    const dt = (d: Date | null) => (d ? `${faDate(d)} ${faTime(d)}` : '');
    const lines = [CSV_HEADER.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [r.shipmentNo, r.statusLabel, r.customerName, r.cargoType, r.region, r.driverName, r.plateNumber, r.tareKg, r.grossKg, r.netKg, dt(r.createdAt), dt(r.readyAt), dt(r.deliveredAt)]
          .map(csvCell)
          .join(','),
      );
    }
    lines.push(['جمع', `${summary.count} بار`, '', '', '', '', '', '', '', summary.totalNetKg, '', '', ''].map(csvCell).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
}
