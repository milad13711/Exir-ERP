"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TaskModal } from "@/components/tasks/TaskModal";
import { CheckIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchTasks, toggleTask, deleteTask, type ApiTask } from "@/lib/api";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [modalTask, setModalTask] = useState<ApiTask | null | undefined>(undefined); // undefined = بسته، null = وظیفه‌ی جدید

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  async function handleToggle(id: string) {
    const updated = await toggleTask(id);
    setTasks((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? prev);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این وظیفه حذف شود؟")) return;
    await deleteTask(id);
    setTasks((prev) => prev?.filter((t) => t.id !== id) ?? prev);
  }

  function handleSaved(saved: ApiTask) {
    setTasks((prev) => {
      const list = prev ?? [];
      return list.some((t) => t.id === saved.id) ? list.map((t) => (t.id === saved.id ? saved : t)) : [saved, ...list];
    });
  }

  return (
    <div className="p-5 lg:p-7 max-w-[860px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">وظایف و یادآوری</h1>
            <ModuleHelp code="tasks" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">همه‌ی وظایف شما در یک‌جا، مستقل از ماژول مرتبط</p>
        </div>
        <button
          onClick={() => setModalTask(null)}
          className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          ثبت وظیفه
        </button>
      </div>

      <Card className="mt-6 p-2">
        <div className="flex flex-col">
          {tasks === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">هنوز وظیفه‌ای ثبت نشده است</div>
          ) : (
            tasks.map((task, i) => {
              const done = task.status === "DONE";
              const items = task.checklist ?? [];
              const doneItems = items.filter((c) => c.done).length;
              return (
                <div key={task.id} className={clsx("flex items-center gap-3 px-4 py-3.5", i < tasks.length - 1 && "border-b border-border")}>
                  <button
                    onClick={() => handleToggle(task.id)}
                    className={clsx("w-5 h-5 rounded-md shrink-0 flex items-center justify-center cursor-pointer", done ? "bg-success" : "border-2 border-border")}
                    aria-label={done ? "علامت‌گذاری به‌عنوان انجام‌نشده" : "علامت‌گذاری به‌عنوان انجام‌شده"}
                  >
                    {done ? <CheckIcon className="w-3 h-3 text-white" strokeWidth={3} /> : null}
                  </button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setModalTask(task)}>
                    <div className={clsx("text-[13.5px] font-semibold", done && "text-muted line-through")}>{task.title}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {task.dueAt ? `سررسید: ${formatJalaliDateTime(task.dueAt)}` : `ایجاد شده: ${formatJalaliDateTime(task.createdAt)}`}
                      {task.assignee ? ` · ارجاع به: ${task.assignee.name}` : ""}
                      {items.length > 0 ? ` · چک‌لیست ${doneItems}/${items.length}` : ""}
                    </div>
                  </div>
                  {task.priority !== "NORMAL" ? (
                    <Badge tone={task.priority === "URGENT" ? "danger" : "warning"}>{task.priority === "URGENT" ? "فوری" : "متوسط"}</Badge>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
                    aria-label="حذف وظیفه"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {modalTask !== undefined ? (
        <TaskModal key={modalTask?.id ?? "new"} task={modalTask} onClose={() => setModalTask(undefined)} onSaved={handleSaved} />
      ) : null}
    </div>
  );
}
