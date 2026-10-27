import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import type { JsonSchema, McpTool } from './mcp-tool.types.js';

export class McpValidationError extends Error {}

type S = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * اعتبارسنج سبک JSON Schema برای ورودی ابزارها: type/enum/required/properties/items/min/max/pattern/format.
 * ویژگی ناشناخته در سطح ریشه رد می‌شود (additionalProperties=false) تا ایجنت فیلد تصادفی نفرستد.
 * خروجی: فهرست خطاهای فارسی (خالی = معتبر).
 */
export function validateAgainstSchema(schema: JsonSchema, value: unknown, path = 'ورودی', strictRoot = true): string[] {
  const errs: string[] = [];
  const sc = schema as S;
  const t = sc.type as string | undefined;

  if (sc.enum && !(sc.enum as unknown[]).includes(value)) {
    errs.push(`«${path}» باید یکی از این مقادیر باشد: ${(sc.enum as unknown[]).join('، ')}`);
    return errs;
  }
  switch (t) {
    case 'string': {
      if (typeof value !== 'string') return [`«${path}» باید متن باشد`];
      if (typeof sc.minLength === 'number' && value.trim().length < sc.minLength) errs.push(`«${path}» کوتاه‌تر از حد مجاز است`);
      if (typeof sc.maxLength === 'number' && value.length > sc.maxLength) errs.push(`«${path}» بلندتر از حد مجاز است`);
      if (typeof sc.pattern === 'string' && !new RegExp(sc.pattern).test(value)) errs.push(`«${path}» قالب درستی ندارد`);
      if (sc.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errs.push(`«${path}» باید تاریخ YYYY-MM-DD باشد`);
      if (sc.format === 'date-time' && (Number.isNaN(Date.parse(value)) || value.length < 10)) errs.push(`«${path}» باید زمان معتبر ISO باشد`);
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`«${path}» باید عدد باشد`];
      if (t === 'integer' && !Number.isInteger(value)) errs.push(`«${path}» باید عدد صحیح باشد`);
      if (typeof sc.minimum === 'number' && value < sc.minimum) errs.push(`«${path}» نباید کمتر از ${sc.minimum} باشد`);
      if (typeof sc.maximum === 'number' && value > sc.maximum) errs.push(`«${path}» نباید بیشتر از ${sc.maximum} باشد`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return [`«${path}» باید درست/نادرست باشد`];
      break;
    case 'array': {
      if (!Array.isArray(value)) return [`«${path}» باید فهرست باشد`];
      if (typeof sc.minItems === 'number' && value.length < sc.minItems) errs.push(`«${path}» حداقل ${sc.minItems} مورد لازم دارد`);
      const maxItems = typeof sc.maxItems === 'number' ? sc.maxItems : 500;
      if (value.length > maxItems) errs.push(`«${path}» بیش از ${maxItems} مورد دارد`);
      if (isObj(sc.items)) value.slice(0, maxItems).forEach((v, i) => errs.push(...validateAgainstSchema(sc.items as JsonSchema, v, `${path}[${i}]`, true)));
      break;
    }
    case 'object': {
      if (!isObj(value)) return [`«${path}» باید شیء باشد`];
      const props = isObj(sc.properties) ? (sc.properties as Record<string, JsonSchema>) : {};
      for (const r of (sc.required as string[] | undefined) ?? []) {
        if (value[r] === undefined || value[r] === null) errs.push(`فیلد «${path === 'ورودی' ? r : `${path}.${r}`}» الزامی است`);
      }
      for (const [k, v] of Object.entries(value)) {
        const p = path === 'ورودی' ? k : `${path}.${k}`;
        if (!(k in props)) {
          if (strictRoot) errs.push(`فیلد ناشناخته: «${p}»`);
          continue;
        }
        if (v === undefined || v === null) continue;
        errs.push(...validateAgainstSchema(props[k], v, p, true));
      }
      break;
    }
    default:
      break;
  }
  return errs;
}

const flatten = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = e.constraints ? [`«${path}»: ${Object.values(e.constraints).join('، ')}`] : [];
    return [...own, ...flatten(e.children ?? [], path)];
  });

/** اعتبارسنجی قاعده‌ای با DTO های class-validator خود دامنه (همان قوانین REST)؛ ورودی اضافه رد می‌شود. */
export function parseDto<T extends object>(Cls: new () => T, args: unknown): T {
  const inst = plainToInstance(Cls, args ?? {}, { enableImplicitConversion: false });
  const errors = validateSync(inst as object, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  if (errors.length) throw new McpValidationError(`ورودی نامعتبر است — ${flatten(errors).join(' | ')}`);
  return inst;
}

/** اعتبارسنجی کامل ورودی یک ابزار: JSON Schema + validate سفارشی ابزار. */
export function validateToolArgs(tool: Pick<McpTool, 'inputSchema' | 'validate' | 'name'>, args: unknown): Record<string, unknown> {
  if (!isObj(args)) throw new McpValidationError('آرگومان‌ها باید یک شیء باشند');
  const errs = validateAgainstSchema(tool.inputSchema, args, 'ورودی', true);
  if (errs.length) throw new McpValidationError(`ورودی نامعتبر است — ${errs.slice(0, 6).join(' | ')}`);
  tool.validate?.(args);
  return args;
}
