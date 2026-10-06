import { describe, expect, it } from 'vitest';
import { allocate, mapSalesInvoiceToMoodian, toRial, type MapperInput } from './invoice-mapper.js';
import { TOMAN_TO_RIAL, vatRateToWire } from './moodian-field-map.js';
import { mapMoodianError } from './moodian-errors.js';
import { checkManualTaxId, NotVerifiedError, UnverifiedTaxIdBuilder } from '../taxid/taxid.js';

const TAXID = 'AA56CD0E0620002F2B4E78';

function input(over: Partial<Omit<MapperInput, 'invoice'>> & { invoice?: Partial<MapperInput['invoice']> } = {}): MapperInput {
  const base: MapperInput = {
    settings: { economicCode: '12345678911234', fiscalId: 'AA56CD', branchCode: null, defaultVatRate: 9, defaultSstid: '2153265989636', defaultUnitCode: 1627 },
    invoice: {
      invoiceNo: 12, officialInvoiceNo: 5, isOfficial: true, status: 'CONFIRMED', issuedAt: new Date('2026-09-01T10:00:00Z'), subtotal: 1000, discount: 0, taxRate: 9, taxAmount: 90,
      total: 1090, paidAmount: 0, signedAt: new Date(),
      lines: [{ productId: 'p1', description: 'کالا', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
      contact: { type: 'INDIVIDUAL', name: 'علی', economicCode: null, nationalId: '0012345678', legalId: null },
      ...over.invoice,
    },
    taxInvoice: { subject: 'ORIGINAL', pattern: 1, taxid: TAXID, irtaxid: null, createdAt: new Date('2026-09-01T10:05:00Z'), overrides: { buyerPostalCode: '1234567890' } },
    mappings: new Map(),
  };
  return { ...base, ...over, invoice: base.invoice };
}

const codes = (r: ReturnType<typeof mapSalesInvoiceToMoodian>, sev?: string) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);

describe('unit conversion (Toman → Rial)', () => {
  it('uses one explicit constant', () => {
    expect(TOMAN_TO_RIAL).toBe(10);
    expect(toRial(1000)).toBe(10000);
  });

  it('every money field of the payload is in Rial', () => {
    const r = mapSalesInvoiceToMoodian(input());
    const h = r.payload.header;
    expect(r.payload.body[0]!.fee).toBe(10_000);
    expect(h.tprdis).toBe(10_000);
    expect(h.tvam).toBe(900);
    expect(h.tbill).toBe(10_900); // = 1090 تومان × ۱۰
  });
});

describe('mapSalesInvoiceToMoodian — totals and VAT', () => {
  it('computes line vat, totals and header consistency (tbill = tadis + tvam)', () => {
    const r = mapSalesInvoiceToMoodian(
      input({ invoice: { subtotal: 3000, taxAmount: 270, total: 3270, lines: [
        { productId: null, description: 'a', quantity: 2, unitPrice: 500, lineTotal: 1000 },
        { productId: null, description: 'b', quantity: 1, unitPrice: 2000, lineTotal: 2000 },
      ] } }),
    );
    const h = r.payload.header;
    expect(h.tprdis).toBe(30_000);
    expect(h.tdis).toBe(0);
    expect(h.tadis).toBe(30_000);
    expect(h.tvam).toBe(2_700);
    expect(h.tbill).toBe(32_700);
    expect(r.payload.body.map((b) => b.vam)).toEqual([900, 1800]);
    expect(r.payload.body.map((b) => b.tsstam)).toEqual([10_900, 21_800]);
    expect(h.ins).toBe(1);
    expect(h.inp).toBe(1);
    expect(r.blocking).toBe(false);
  });

  it('distributes the invoice-level discount over lines; the sum is exact', () => {
    const r = mapSalesInvoiceToMoodian(
      input({ invoice: { subtotal: 1000, discount: 100, taxAmount: 81, total: 981, lines: [
        { productId: null, description: 'a', quantity: 1, unitPrice: 333, lineTotal: 333 },
        { productId: null, description: 'b', quantity: 1, unitPrice: 667, lineTotal: 667 },
      ] } }),
    );
    const dis = r.payload.body.map((b) => Number(b.dis));
    expect(dis.reduce((a, b) => a + b, 0)).toBe(1000); // 100 تومان = 1000 ریال
    expect(r.payload.header.tdis).toBe(1000);
    expect(r.payload.header.tadis).toBe(9000);
    expect(r.payload.header.tvam).toBe(810);
  });

  it('uses the product mapping (sstid, unit, vat override) before invoice/default', () => {
    const i = input();
    i.mappings.set('p1', { sstid: '1111111111111', unitCode: 99, vatRate: 0 });
    const r = mapSalesInvoiceToMoodian({ ...i, invoice: { ...i.invoice, total: 1000, taxAmount: 0 } });
    expect(r.payload.body[0]!.sstid).toBe('1111111111111');
    expect(r.payload.body[0]!.mu).toBe(99);
    expect(r.payload.body[0]!.vam).toBe(0);
    expect(r.payload.body[0]!.vra).toBe(0);
  });

  it('settlement and cash share follow paidAmount (credit / cash / mixed)', () => {
    const credit = mapSalesInvoiceToMoodian(input({ invoice: { paidAmount: 0 } })).payload.header;
    expect([credit.setm, credit.cap, credit.insp]).toEqual([2, 0, 10_900]);
    const cash = mapSalesInvoiceToMoodian(input({ invoice: { paidAmount: 1090 } })).payload.header;
    expect([cash.setm, cash.cap, cash.insp, cash.tvop]).toEqual([1, 10_900, 0, 900]);
    const mixed = mapSalesInvoiceToMoodian(input({ invoice: { paidAmount: 545 } })).payload.header;
    expect(mixed.setm).toBe(3);
    expect(Number(mixed.cap) + Number(mixed.insp)).toBe(10_900);
  });

  it('every header/body key is present (null when empty) so the signed string never depends on omitted keys', () => {
    const r = mapSalesInvoiceToMoodian(input());
    expect(Object.keys(r.payload.header)).toHaveLength(33);
    expect(Object.keys(r.payload.body[0]!)).toHaveLength(27);
    expect(r.payload.header.irtaxid).toBeNull();
  });

  it('vat rate is written through ONE switch (fraction vs percent)', () => {
    expect(vatRateToWire(9)).toBe(0.09);
    expect(vatRateToWire(0)).toBe(0);
  });

  it('allocate keeps the exact total', () => {
    expect(allocate(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('validation report (blocking issues with Persian messages)', () => {
  it('flags every missing piece for an empty setup', () => {
    const r = mapSalesInvoiceToMoodian(
      input({
        settings: { economicCode: null, fiscalId: null, branchCode: null, defaultVatRate: null, defaultSstid: null, defaultUnitCode: null },
        invoice: { isOfficial: false, officialInvoiceNo: null, taxRate: null, status: 'DRAFT' },
        taxInvoice: { subject: 'ORIGINAL', pattern: 1, taxid: null, irtaxid: null, createdAt: new Date(), overrides: null },
      }),
    );
    expect(r.blocking).toBe(true);
    for (const c of ['SELLER_ECONOMIC_CODE', 'FISCAL_ID', 'TAXID_MISSING', 'INVOICE_NOT_OFFICIAL', 'INVOICE_STATUS', 'SSTID_MISSING', 'UNIT_MISSING', 'VAT_RATE_MISSING']) {
      expect(codes(r, 'BLOCKING')).toContain(c);
    }
    expect(r.issues.every((i) => /[؀-ۿ]/.test(i.message))).toBe(true);
  });

  it('company buyer needs economic code and legal id; individual without national id is a final consumer (warning)', () => {
    const company = mapSalesInvoiceToMoodian(input({ invoice: { contact: { type: 'COMPANY', name: 'ش', economicCode: null, nationalId: null, legalId: null } } }));
    expect(codes(company, 'BLOCKING')).toEqual(expect.arrayContaining(['BUYER_ECONOMIC_CODE', 'BUYER_ID']));
    const indiv = mapSalesInvoiceToMoodian(input({ invoice: { contact: { type: 'INDIVIDUAL', name: 'ع', economicCode: null, nationalId: null, legalId: null } } }));
    expect(indiv.blocking).toBe(false);
    expect(indiv.payload.header.tob).toBe(5);
    expect(codes(indiv, 'WARNING')).toContain('BUYER_NO_ID');
  });

  it('chooses invoice type 1 when the buyer has an economic code, otherwise type 2', () => {
    const t1 = mapSalesInvoiceToMoodian(input({ invoice: { contact: { type: 'COMPANY', name: 'ش', economicCode: '12345678911234', nationalId: null, legalId: '10101010101' } } }));
    expect(t1.resolved.invoiceType).toBe(1);
    expect(t1.payload.header.tob).toBe(2);
    expect(mapSalesInvoiceToMoodian(input()).resolved.invoiceType).toBe(2);
  });

  it('correction/cancellation need irtaxid; subject codes map 2/3', () => {
    const base = input();
    const noRef = mapSalesInvoiceToMoodian({ ...base, taxInvoice: { ...base.taxInvoice, subject: 'CANCELLATION' } });
    expect(codes(noRef, 'BLOCKING')).toContain('IRTAXID_MISSING');
    const ok = mapSalesInvoiceToMoodian({ ...base, taxInvoice: { ...base.taxInvoice, subject: 'CORRECTION', irtaxid: 'BB56CD0E0620002F2B4E79' } });
    expect(ok.payload.header.ins).toBe(2);
    expect(ok.payload.header.irtaxid).toBe('BB56CD0E0620002F2B4E79');
  });

  it('blocks a total that does not reconcile with the sales invoice, tolerates ≤1 Toman rounding per line', () => {
    const bad = mapSalesInvoiceToMoodian(input({ invoice: { total: 2000 } }));
    expect(codes(bad, 'BLOCKING')).toContain('TOTAL_MISMATCH');
    const rounding = mapSalesInvoiceToMoodian(input({ invoice: { total: 1091 } }));
    expect(rounding.blocking).toBe(false);
    expect(codes(rounding, 'WARNING')).toContain('TOTAL_ROUNDING');
  });

  it('rejects malformed identifiers', () => {
    const r = mapSalesInvoiceToMoodian(input({ settings: { economicCode: '123', fiscalId: 'AA', branchCode: null, defaultVatRate: 9, defaultSstid: '12', defaultUnitCode: 1 } }));
    expect(codes(r, 'BLOCKING')).toEqual(expect.arrayContaining(['SELLER_ECONOMIC_CODE_FORMAT', 'FISCAL_ID_FORMAT', 'SSTID_FORMAT']));
  });

  it('taxid must match the fiscal id prefix', () => {
    const base = input();
    const r = mapSalesInvoiceToMoodian({ ...base, taxInvoice: { ...base.taxInvoice, taxid: 'ZZ56CD0E0620002F2B4E78' } });
    expect(codes(r, 'BLOCKING')).toContain('TAXID_FORMAT');
  });
});

describe('taxid handling (check digit is NOT invented)', () => {
  it('the automatic builder throws NotVerifiedError', () => {
    expect(() => new UnverifiedTaxIdBuilder().build()).toThrow(NotVerifiedError);
  });

  it('manual taxid is only structurally checked; the serial (inno) is cut from chars 12..21', () => {
    expect(checkManualTaxId(TAXID.toLowerCase(), 'aa56cd')).toEqual({ ok: true, taxid: TAXID, inno: '0002F2B4E7' });
    expect(checkManualTaxId('short').ok).toBe(false);
    expect(checkManualTaxId(TAXID, 'XX56CD').ok).toBe(false);
  });
});

describe('error code mapping', () => {
  it('maps transport codes, content-error text and rows to Persian', () => {
    expect(mapMoodianError('5013').fa).toContain('امضا');
    expect(mapMoodianError('5000').transient).toBe(true);
    expect(mapMoodianError(null, 'Invalid Service-stuff-id').fa).toContain('شناسه کالا/خدمت');
    expect(mapMoodianError('13').fa).toContain('نرخ مالیات');
    expect(mapMoodianError(null, 'memory-id.is.null').fa).toContain('memory-id.is.null');
  });
});
