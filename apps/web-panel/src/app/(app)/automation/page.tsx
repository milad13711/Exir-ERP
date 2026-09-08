"use client";

import { useEffect, useState, type ComponentType } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon, BoltIcon, TrashIcon, BellIcon, SendIcon, TasksIcon, ChevronDownIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchAutomationRules,
  fetchTriggers,
  updateAutomationRule,
  deleteAutomationRule,
  fireTrigger,
  ApiError,
  type AutomationRule,
  type TriggerDefinition,
} from "@/lib/api";
import { NewAutomationRuleModal } from "@/components/automation/NewAutomationRuleModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const ACTION_TYPE_LABELS: Record<string, string> = {
  NOTIFY_IN_APP: "اعلان",
  SEND_SMS: "پیامک",
  CREATE_TASK: "وظیفه",
};

const ACTION_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  NOTIFY_IN_APP: BellIcon,
  SEND_SMS: SendIcon,
  CREATE_TASK: TasksIcon,
};

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [triggers, setTriggers] = useState<TriggerDefinition[]>([]);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fireInputs, setFireInputs] = useState<Record<string, string>>({});

  function reload() {
    fetchAutomationRules().then(setRules).catch(() => setRules([]));
  }
  useEffect(() => {
    reload();
    fetchTriggers().then(setTriggers).catch(() => setTriggers([]));
  }, []);

  const triggerByCode = new Map(triggers.map((t) => [t.code, t]));

  async function toggleActive(rule: AutomationRule) {
    setBusyId(rule.id);
    setError(null);
    try {
      await updateAutomationRule(rule.id, { isActive: !rule.isActive });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(rule: AutomationRule) {
    setBusyId(rule.id);
    setError(null);
    try {
      await deleteAutomationRule(rule.id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusyId(null);
    }
  }

  async function fireManual(rule: AutomationRule) {
    const entityId = fireInputs[rule.id]?.trim();
    if (!entityId) return;
    setBusyId(rule.id);
    setError(null);
    try {
      await fireTrigger(rule.triggerCode, entityId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">اتوماسیون</h1>
            <ModuleHelp code="automation" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">برای رویدادهای ماژول‌های نصب‌شده، اقدام خودکار (اعلان، پیامک، وظیفه) تعریف کنید</p>
        </div>
        <button
          onClick={() => setNewRuleOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          قانون جدید
        </button>
      </div>

      {error ? <div className="text-[12px] text-danger mt-4">{error}</div> : null}

      <div className="flex flex-col gap-3 mt-5">
        {rules === null ? (
          <Card className="p-8 text-center text-muted text-sm">در حال بارگذاری...</Card>
        ) : rules.length === 0 ? (
          <Card className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <BoltIcon className="w-6 h-6" />
            هنوز قانون اتوماسیونی تعریف نشده است
          </Card>
        ) : (
          rules.map((rule) => {
            const trigger = triggerByCode.get(rule.triggerCode);
            return (
              <Card key={rule.id} className={clsx("p-4", !rule.isActive && "opacity-60")}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-[13.5px] font-bold">{rule.name}</div>
                  <div className="flex items-center gap-2">
                    <Badge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? "فعال" : "غیرفعال"}</Badge>
                    <button
                      disabled={busyId === rule.id}
                      onClick={() => toggleActive(rule)}
                      className="text-[11.5px] font-bold text-primary cursor-pointer disabled:opacity-50"
                    >
                      {rule.isActive ? "غیرفعال کردن" : "فعال کردن"}
                    </button>
                    <button
                      disabled={busyId === rule.id}
                      onClick={() => remove(rule)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-50"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 mt-3 flex-wrap">
                  <div className="flex items-center gap-1.5 bg-warning-soft text-warning rounded-xl px-3 py-2 text-[12px] font-bold">
                    <BoltIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[10px] font-semibold opacity-70">وقتی</span>
                    {trigger?.label ?? rule.triggerCode}
                  </div>
                  <ChevronDownIcon className="w-3.5 h-3.5 text-muted -rotate-90 shrink-0" />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {rule.actions.map((a, i) => {
                      const ActionIcon = ACTION_TYPE_ICONS[a.type];
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 bg-primary-soft text-primary rounded-xl px-3 py-2 text-[12px] font-bold"
                        >
                          {ActionIcon ? <ActionIcon className="w-3.5 h-3.5 shrink-0" /> : null}
                          {ACTION_TYPE_LABELS[a.type] ?? a.type}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {trigger?.supportsManualTrigger ? (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    <input
                      value={fireInputs[rule.id] ?? ""}
                      onChange={(e) => setFireInputs((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                      placeholder="شناسه‌ی رکورد برای اجرای آزمایشی"
                      dir="ltr"
                      className="flex-1 text-[11.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                    />
                    <button
                      disabled={busyId === rule.id || !fireInputs[rule.id]?.trim()}
                      onClick={() => fireManual(rule)}
                      className="text-[11.5px] font-bold text-primary cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      اجرای دستی
                    </button>
                  </div>
                ) : null}

                {rule.runLogs && rule.runLogs.length > 0 ? (
                  <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1">
                    {rule.runLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="flex items-center justify-between text-[11px] text-muted">
                        <span>
                          {ACTION_TYPE_LABELS[log.actionType] ?? log.actionType} — {formatJalaliDateTime(log.ranAt)}
                        </span>
                        <Badge tone={log.status === "SUCCESS" ? "success" : "danger"}>{log.status === "SUCCESS" ? "موفق" : "ناموفق"}</Badge>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            );
          })
        )}
      </div>

      {newRuleOpen ? <NewAutomationRuleModal onClose={() => setNewRuleOpen(false)} onCreated={reload} /> : null}
    </div>
  );
}
