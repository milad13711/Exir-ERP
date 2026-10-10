/* ابزار تست: یک «پایگاه‌داده‌ی درون‌حافظه» بسیار کوچک با سطح Prisma delegate که فقط عملگرهای لازم برای
 * تست‌های پروژه را پشتیبانی می‌کند (برابری، in، not، notIn، gt، lt، OR/AND). برای بررسی اینکه فیلتر
 * «نمایش به مشتری» واقعاً در کوئری اعمال می‌شود، نه اینکه mock همه‌چیز را برگرداند. */
type Row = Record<string, unknown>;

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c && !(c.in as unknown[]).includes(actual)) return false;
    if ('notIn' in c && (c.notIn as unknown[]).includes(actual)) return false;
    if ('not' in c && matchValue(actual, c.not)) return false;
    if ('gt' in c && !((actual as Date | number) > (c.gt as Date | number))) return false;
    if ('lt' in c && !(actual != null && (actual as Date | number) < (c.lt as Date | number))) return false;
    return true;
  }
  return actual === cond;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(v as Row[]).every((w) => matches(row, w))) return false;
    } else if (k === 'OR') {
      if (!(v as Row[]).some((w) => matches(row, w))) return false;
    } else if (!matchValue(row[k], v)) return false;
  }
  return true;
}

export function makeDelegate(rows: Row[], opts: { idPrefix?: string } = {}) {
  let seq = 0;
  const withInclude = (row: Row, args?: { include?: Record<string, unknown> }) => {
    if (!args?.include) return row;
    const out: Row = { ...row };
    for (const [rel, cfg] of Object.entries(args.include)) {
      const list = (row[rel] as Row[] | undefined) ?? [];
      const w = (cfg as { where?: Row } | true) === true ? undefined : (cfg as { where?: Row }).where;
      out[rel] = list.filter((r) => matches(r, w));
    }
    return out;
  };
  return {
    rows,
    findMany: async (args: { where?: Row; include?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, args.where)).map((r) => withInclude(r, args)),
    findFirst: async (args: { where?: Row; include?: Record<string, unknown> } = {}) => {
      const r = rows.find((x) => matches(x, args.where));
      return r ? withInclude(r, args) : null;
    },
    findUnique: async (args: { where: Row; include?: Record<string, unknown> }) => {
      const r = rows.find((x) => matches(x, args.where));
      return r ? withInclude(r, args) : null;
    },
    count: async (args: { where?: Row } = {}) => rows.filter((r) => matches(r, args.where)).length,
    create: async (args: { data: Row }) => {
      seq += 1;
      const row: Row = { id: `${opts.idPrefix ?? 'row'}-${seq}`, createdAt: new Date(), ...args.data };
      rows.push(row);
      return row;
    },
    update: async (args: { where: Row; data: Row }) => {
      const r = rows.find((x) => matches(x, args.where));
      if (!r) throw new Error('not found');
      Object.assign(r, args.data);
      return r;
    },
    updateMany: async (args: { where?: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, args.data);
      return { count: hit.length };
    },
    deleteMany: async (args: { where?: Row }) => {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    },
  };
}
