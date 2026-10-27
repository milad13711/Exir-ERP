import { CreateTaskDto } from '../tasks/dto/create-task.dto.js';
import { CommentDto, ReassignDto } from '../tasks/dto/task-actions.dto.js';
import { parseTaskNumber } from '../tasks/task-number.js';
import type { McpDeps } from './mcp-deps.js';
import { AGENT_TAG, UUID_RE, clampLimit, clip, idProp, iso, isoProp, limitProp } from './mcp-tools.common.js';
import { parseDto } from './mcp-validate.js';
import type { McpTool } from './mcp-tool.types.js';

const TASK_STATUSES = ['NEW', 'SEEN', 'IN_PROGRESS', 'DONE', 'APPROVED', 'HAS_PROBLEM', 'RETURNED_FOR_FIX', 'EXPIRED', 'CANCELLED', 'ACTIVE', 'OVERDUE'];
const PRIORITIES = ['NORMAL', 'MEDIUM', 'URGENT'];

const brief = (t: any) => ({
  id: t.id,
  code: t.code,
  title: t.title,
  status: t.status,
  priority: t.priority,
  dueAt: iso(t.dueAt),
  isOverdue: !!t.isOverdue,
  assignees: (t.assignees ?? []).map((a: { name: string }) => a.name),
  createdBy: t.createdBy?.name ?? null,
  createdAt: iso(t.createdAt),
});

export function buildTaskTools(d: McpDeps): McpTool[] {
  return [
    {
      name: 'search_tasks',
      module: 'tasks',
      kind: 'read',
      description:
        'جست‌وجو و فهرست وظایف با فیلتر: متن عنوان/توضیح، شماره‌ی وظیفه (مثل TASK-000123 یا فقط 123)، وضعیت، اولویت، مسئول، بازه‌ی موعد یا فقط معوق‌ها. شناسه‌ی (id) هر ردیف را برای get_task و ابزارهای نوشتنی استفاده کنید.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200, description: 'متن جست‌وجو یا شماره‌ی وظیفه (TASK-000123)' },
          status: { type: 'array', items: { type: 'string', enum: TASK_STATUSES }, maxItems: 10, description: 'وضعیت‌ها؛ ACTIVE = همه‌ی باز، OVERDUE = معوق' },
          priority: { type: 'string', enum: PRIORITIES },
          assigneeId: idProp('شناسه‌ی کاربر مسئول'),
          dueFrom: isoProp('موعد از'),
          dueTo: isoProp('موعد تا'),
          limit: limitProp(50),
        },
      },
      handler: async (a, ctx) => {
        const rows = await d.tasks.list(ctx, {
          q: a.q as string | undefined,
          status: Array.isArray(a.status) ? (a.status as string[]).join(',') : undefined,
          priority: a.priority as string | undefined,
          assigneeId: a.assigneeId as string | undefined,
          from: a.dueFrom as string | undefined,
          to: a.dueTo as string | undefined,
          dateField: 'dueAt',
          limit: clampLimit(a.limit),
        });
        return rows.map(brief);
      },
    },
    {
      name: 'get_task',
      module: 'tasks',
      kind: 'read',
      description: 'جزئیات کامل یک وظیفه همراه با خط زمان (تغییر وضعیت‌ها)، نظرها، نتیجه‌ها و درخواست‌های تمدید. ورودی: شناسه (id) یا شماره‌ی وظیفه مثل TASK-000123.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: { task: { type: 'string', minLength: 1, maxLength: 64, description: 'شناسه یا شماره‌ی وظیفه (TASK-000123)' } },
        required: ['task'],
      },
      handler: async (a, ctx) => {
        const ref = String(a.task).trim();
        let id = ref;
        if (!UUID_RE.test(ref)) {
          const num = parseTaskNumber(ref);
          if (num === null) throw new Error('شناسه یا شماره‌ی وظیفه نامعتبر است');
          const found = await d.tasks.list(ctx, { q: ref, limit: 50 });
          const hit = found.find((t) => t.number === num);
          if (!hit) throw new Error('وظیفه یافت نشد');
          id = hit.id;
        }
        const t: any = await d.tasks.detail(ctx, id);
        return {
          ...brief(t),
          description: clip(t.description, 4000),
          notes: clip(t.notes, 2000),
          tags: t.tags,
          startAt: iso(t.startAt),
          completedAt: iso(t.completedAt),
          relatedModule: t.relatedModule ?? null,
          relatedEntityId: t.relatedEntityId ?? null,
          timeline: t.events.map((e: any) => ({ type: e.type, at: iso(e.createdAt), by: e.actorName, from: e.fromStatus, to: e.toStatus, note: clip(e.note, 300) })),
          comments: t.comments.map((c: any) => ({ by: c.authorName, at: iso(c.createdAt), body: clip(c.body, 600) })),
          results: t.results.map((r: any) => ({ by: r.authorName, at: iso(r.createdAt), text: clip(r.text, 600), reviewedBy: r.reviewedByName })),
          extensionRequests: t.extensionRequests.map((x: any) => ({ by: x.requestedByName, status: x.status, requestedDueAt: iso(x.requestedDueAt), reason: clip(x.reason, 300) })),
        };
      },
    },
    {
      name: 'create_task',
      module: 'tasks',
      kind: 'write',
      description:
        'ثبت یک وظیفه‌ی جدید (نیازمند تأیید کاربر). فقط عنوان لازم است؛ در صورت نیاز مسئول‌ها (assigneeIds، شناسه‌ی کاربران)، اولویت، موعد، توضیح و فیلدهای «جزئیات بیشتر» مثل زمان شروع، یادآوری‌ها، برچسب‌ها و تکرار. شماره‌ی وظیفه را خود سامانه می‌دهد.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 300 },
          description: { type: 'string', maxLength: 5000 },
          priority: { type: 'string', enum: PRIORITIES },
          dueAt: isoProp('موعد انجام'),
          assigneeIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 50, description: 'شناسه‌ی کاربران مسئول؛ خالی = برای تأییدکننده' },
          checklist: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, maxItems: 50 },
          startAt: isoProp('زمان شروع'),
          sendAt: isoProp('ارسال زمان‌بندی‌شده'),
          reminderOffsetsMin: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 129600 }, maxItems: 6, description: 'یادآوری چند دقیقه پیش از موعد' },
          relatedModule: { type: 'string', maxLength: 60 },
          relatedEntityId: idProp('شناسه‌ی رکورد مرتبط'),
          recurrence: { type: 'string', enum: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] },
          recurrenceInterval: { type: 'integer', minimum: 1, maximum: 365 },
          recurrenceEndAt: isoProp('پایان تکرار'),
          tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 10 },
          notes: { type: 'string', maxLength: 5000 },
        },
        required: ['title'],
      },
      summarize: (a) => `ثبت وظیفه‌ی جدید «${String(a.title)}»${Array.isArray(a.assigneeIds) && a.assigneeIds.length ? ` برای ${a.assigneeIds.length} نفر` : ''}${a.dueAt ? ` با موعد ${String(a.dueAt)}` : ''}`,
      validate: (a) => void parseDto(CreateTaskDto, a),
      handler: async (a, ctx) => {
        const dto = parseDto(CreateTaskDto, a);
        const t: any = await d.tasks.create(ctx, dto);
        return { id: t.id, code: t.code, title: t.title };
      },
    },
    {
      name: 'add_task_comment',
      module: 'tasks',
      kind: 'write',
      description: 'افزودن یک نظر/یادداشت به یک وظیفه‌ی موجود (نیازمند تأیید کاربر). نظر با برچسب «ثبت‌شده با دستیار هوشمند» ذخیره می‌شود.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: { taskId: idProp('شناسه‌ی وظیفه'), body: { type: 'string', minLength: 1, maxLength: 2800 }, parentId: idProp('شناسه‌ی نظر والد (پاسخ)') },
        required: ['taskId', 'body'],
      },
      summarize: (a) => `افزودن نظر به وظیفه (${String(a.taskId)}): «${String(a.body).slice(0, 80)}»`,
      validate: (a) => void parseDto(CommentDto, { body: a.body, parentId: a.parentId }),
      handler: async (a, ctx) => {
        const dto = parseDto(CommentDto, { body: `${AGENT_TAG} ${String(a.body)}`.slice(0, 3000), parentId: a.parentId });
        const c = await d.tasks.addComment(ctx, String(a.taskId), dto);
        return { id: c.id, taskId: c.taskId };
      },
    },
    {
      name: 'reassign_task',
      module: 'tasks',
      kind: 'write',
      description: 'تغییر مسئول(های) یک وظیفه (نیازمند تأیید کاربر). فهرست جدید جایگزین فهرست قبلی می‌شود؛ فقط سازنده/مدیر مجاز است و قواعد وضعیت وظیفه اعمال می‌شود.',
      operation: 'UPDATE',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: idProp('شناسه‌ی وظیفه'),
          assigneeIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, minItems: 1, maxItems: 50 },
          note: { type: 'string', maxLength: 2000 },
        },
        required: ['taskId', 'assigneeIds'],
      },
      summarize: (a) => `ارجاع مجدد وظیفه (${String(a.taskId)}) به ${(a.assigneeIds as unknown[]).length} نفر`,
      validate: (a) => void parseDto(ReassignDto, { assigneeIds: a.assigneeIds, note: a.note }),
      handler: async (a, ctx) => {
        const dto = parseDto(ReassignDto, { assigneeIds: a.assigneeIds, note: a.note });
        const t: any = await d.tasks.reassign(ctx, String(a.taskId), dto);
        return { id: t.id, code: t.code, assignees: (t.assignees ?? []).map((x: { name: string }) => x.name) };
      },
    },
  ];
}
