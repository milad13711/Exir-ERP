import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { TaskModal } from "@/components/tasks/TaskModal";
import { fetchTasks, toggleTask, type ApiTask } from "@/lib/api";

export function TasksSection({ relatedModule, relatedEntityId }: { relatedModule: string; relatedEntityId: string }) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [modalTask, setModalTask] = useState<ApiTask | null | undefined>(undefined);

  function reload() {
    fetchTasks({ relatedModule, relatedEntityId }).then(setTasks).catch(() => setTasks([]));
  }
  useEffect(reload, [relatedModule, relatedEntityId]);
  async function handleToggle(id: string) {
    await toggleTask(id);
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-muted">وظایف مرتبط</span>
        <button onClick={() => setModalTask(null)} className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer">
          <PlusIcon className="w-3.5 h-3.5" />
          افزودن وظیفه
        </button>
      </div>

      {tasks === null ? (
        <div className="text-[12px] text-muted">در حال بارگذاری...</div>
      ) : tasks.length === 0 ? (
        <div className="text-[12px] text-muted">هنوز وظیفه‌ای ثبت نشده است</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <button
                onClick={() => handleToggle(t.id)}
                className={
                  "w-4.5 h-4.5 rounded-md shrink-0 flex items-center justify-center cursor-pointer " +
                  (t.status === "DONE" ? "bg-success" : "border-2 border-border")
                }
              >
                {t.status === "DONE" ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
              </button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setModalTask(t)}>
                <div className={"text-[12px] font-bold truncate" + (t.status === "DONE" ? " text-muted line-through" : "")}>{t.title}</div>
                <div className="text-[10.5px] text-muted mt-0.5">
                  {t.dueAt ? formatJalaliDateTime(t.dueAt) : formatJalaliDateTime(t.createdAt)}
                  {t.assignee ? ` · ${t.assignee.name}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalTask !== undefined ? (
        <TaskModal
          key={modalTask?.id ?? "new"}
          task={modalTask}
          relatedModule={relatedModule}
          relatedEntityId={relatedEntityId}
          onClose={() => setModalTask(undefined)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}
