"use client";

import type { ApiTask } from "@/lib/api";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";

/**
 * نقطه‌ی ورود مشترک: بدون `task` فرم کوتاه ثبت وظیفه‌ی جدید؛ با `task` پنجره‌ی جزئیات/گردش‌کار (وضعیت، نتیجه، مشکل، تمدید، تاریخچه).
 * قرارداد قدیمی حفظ شده: onSaved هر بار که وظیفه تغییر کند (ایجاد یا هر اقدام) با نسخه‌ی تازه صدا زده می‌شود.
 */
export function TaskModal({
  task,
  relatedModule,
  relatedEntityId,
  onClose,
  onSaved,
}: {
  task?: ApiTask | null;
  relatedModule?: string;
  relatedEntityId?: string;
  onClose: () => void;
  onSaved: (task: ApiTask) => void;
}) {
  if (task) return <TaskDetailModal task={task} onClose={onClose} onChanged={onSaved} />;
  return <TaskFormModal relatedModule={relatedModule} relatedEntityId={relatedEntityId} onClose={onClose} onSaved={onSaved} />;
}
