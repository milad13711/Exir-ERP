/**
 * کلاینت Prisma درون‌حافظه‌ای فقط برای تست‌های خروج کاربر: هر delegate یک جدول عمومی است، where با برابری/null/in/notIn/gte
 * و چند رابطه‌ی تو در تو، و $transaction با snapshot واقعاً rollback می‌کند.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
export type FakeSeed = Record<string, unknown[]>;

const ONE: Record<string, { table: string; fk: string }> = {
  task: { table: 'task', fk: 'taskId' },
  project: { table: 'project', fk: 'projectId' },
  conversation: { table: 'messengerConversation', fk: 'conversationId' },
  role: { table: 'role', fk: 'roleId' },
};
const MANY: Record<string, { table: string; parentKey: string; childFk: string }> = {
  roles: { table: 'userRole', parentKey: 'id', childFk: 'userId' },
  users: { table: 'userRole', parentKey: 'id', childFk: 'roleId' },
};

let idSeq = 1;

export function makeFakeTenantDb(seed: FakeSeed = {}, hooks: { failOn?: (op: string, table: string) => boolean } = {}) {
  let tables: Tables = structuredClone(seed) as Tables;
  const get = (t: string) => (tables[t] ??= []);

  function matches(table: string, row: Row, where: Row = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        if (k in ONE && !('in' in v) && !('notIn' in v) && !('gte' in v) && !('not' in v)) {
          const parent = get(ONE[k].table).find((r) => r.id === row[ONE[k].fk]);
          if (!parent || !matches(ONE[k].table, parent, v)) return false;
          continue;
        }
        if (k in MANY && 'some' in v) {
          const m = MANY[k];
          if (!get(m.table).some((c) => c[m.childFk] === row[m.parentKey] && matches(m.table, c, v.some))) return false;
          continue;
        }
        if ('in' in v) {
          if (!v.in.includes(row[k])) return false;
          continue;
        }
        if ('notIn' in v) {
          if (v.notIn.includes(row[k])) return false;
          continue;
        }
        if ('gte' in v) {
          if (!(row[k] != null && row[k] >= v.gte)) return false;
          continue;
        }
        if ('not' in v) {
          if (row[k] === v.not) return false;
          continue;
        }
        // رابطه‌ی ناشناخته → فیلتر بی‌اثر نمی‌شود
        throw new Error(`fake-db: unsupported where ${table}.${k}`);
      } else if (v === null) {
        if (row[k] != null) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  function delegate(table: string) {
    const guard = (op: string) => {
      if (hooks.failOn?.(op, table)) throw new Error(`injected failure ${table}.${op}`);
    };
    return {
      findMany: async (a: Row = {}) => {
        const rows = get(table).filter((r) => matches(table, r, a.where));
        return (a.take ? rows.slice(0, a.take) : rows).map((r) => ({ ...r }));
      },
      findFirst: async (a: Row = {}) => {
        const r = get(table).find((x) => matches(table, x, a.where));
        return r ? { ...r } : null;
      },
      findUnique: async (a: Row) => {
        const w = a.where ?? {};
        const flat: Row = {};
        for (const [k, v] of Object.entries(w)) {
          if (v && typeof v === 'object') Object.assign(flat, v);
          else flat[k] = v;
        }
        const r = get(table).find((x) => matches(table, x, flat));
        return r ? { ...r } : null;
      },
      count: async (a: Row = {}) => get(table).filter((r) => matches(table, r, a.where)).length,
      updateMany: async (a: Row) => {
        guard('updateMany');
        const rows = get(table).filter((r) => matches(table, r, a.where));
        for (const r of rows) Object.assign(r, a.data);
        return { count: rows.length };
      },
      deleteMany: async (a: Row = {}) => {
        guard('deleteMany');
        const before = get(table).length;
        tables[table] = get(table).filter((r) => !matches(table, r, a.where));
        return { count: before - tables[table].length };
      },
      update: async (a: Row) => {
        guard('update');
        const r = get(table).find((x) => x.id === a.where.id);
        if (!r) throw new Error(`fake-db: ${table} not found`);
        Object.assign(r, a.data);
        return { ...r };
      },
      delete: async (a: Row) => {
        guard('delete');
        tables[table] = get(table).filter((x) => x.id !== a.where.id);
        return {};
      },
      create: async (a: Row) => {
        guard('create');
        const r = { id: `gen-${idSeq++}`, createdAt: new Date(), ...a.data };
        get(table).push(r);
        return { ...r };
      },
    };
  }

  const special: Row = {
    $queryRaw: async () => [],
    $queryRawUnsafe: async () => [],
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(tables);
      try {
        return await fn(proxy);
      } catch (e) {
        tables = snapshot;
        throw e;
      }
    },
  };
  const proxy: Row = new Proxy(special, {
    get: (t, prop: string) => (prop in t ? t[prop] : delegate(prop)),
  });
  return { db: proxy, tables: () => tables };
}
