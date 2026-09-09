"use client";

import { useState } from "react";
import { TrashIcon, PlusIcon } from "@/components/icons";
import type { FormFieldInput, FormFieldType, FormType } from "@/lib/api";

const inputClass =
  "w-full text-[12.5px] outline-none placeholder:text-muted bg-white border border-border rounded-lg px-3 py-2 focus:border-primary transition-colors";

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  SHORT_TEXT: "متن کوتاه",
  LONG_TEXT: "متن بلند",
  NUMBER: "عدد",
  SINGLE_CHOICE: "تک‌گزینه‌ای",
  MULTI_CHOICE: "چندگزینه‌ای",
  RATING: "امتیاز (۱ تا ۵)",
  DATE: "تاریخ",
  PHONE: "شماره موبایل",
  EMAIL: "ایمیل",
};

function emptyField(): FormFieldInput {
  return { type: "SHORT_TEXT", label: "", required: false, options: [] };
}

export function FormFieldEditor({ formType, fields, onChange }: { formType: FormType; fields: FormFieldInput[]; onChange: (f: FormFieldInput[]) => void }) {
  function updateField(index: number, patch: Partial<FormFieldInput>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }
  function addField() {
    onChange([...fields, emptyField()]);
  }
  function move(index: number, dir: -1 | 1) {
    const next = [...fields];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, i) => (
        <FieldRow key={i} field={field} index={i} total={fields.length} formType={formType} onChange={(p) => updateField(i, p)} onRemove={() => removeField(i)} onMove={(d) => move(i, d)} />
      ))}
      <button type="button" onClick={addField} className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-primary border border-dashed border-primary/40 rounded-xl py-2.5 cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" /> افزودن سؤال/فیلد
      </button>
    </div>
  );
}

function FieldRow({
  field,
  index,
  total,
  formType,
  onChange,
  onRemove,
  onMove,
}: {
  field: FormFieldInput;
  index: number;
  total: number;
  formType: FormType;
  onChange: (patch: Partial<FormFieldInput>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [newOption, setNewOption] = useState("");
  const hasOptions = field.type === "SINGLE_CHOICE" || field.type === "MULTI_CHOICE";
  const isQuizChoice = formType === "QUIZ" && field.type === "SINGLE_CHOICE";

  function addOption() {
    if (!newOption.trim()) return;
    onChange({ options: [...(field.options ?? []), newOption.trim()] });
    setNewOption("");
  }
  function removeOption(opt: string) {
    onChange({ options: (field.options ?? []).filter((o) => o !== opt), correctOption: field.correctOption === opt ? undefined : field.correctOption });
  }

  return (
    <div className="border border-border rounded-xl p-3 flex flex-col gap-2.5 bg-slate-50">
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-bold text-muted shrink-0">{index + 1}.</span>
        <input value={field.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="متن سؤال یا عنوان فیلد" className={`${inputClass} flex-1`} />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="text-muted disabled:opacity-30 cursor-pointer shrink-0">
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="text-muted disabled:opacity-30 cursor-pointer shrink-0">
          ↓
        </button>
        <button type="button" onClick={onRemove} className="text-danger cursor-pointer shrink-0">
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <select value={field.type} onChange={(e) => onChange({ type: e.target.value as FormFieldType, options: [], correctOption: undefined })} className={`${inputClass} flex-1`}>
          {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft shrink-0 px-2">
          <input type="checkbox" checked={field.required ?? false} onChange={(e) => onChange({ required: e.target.checked })} />
          الزامی
        </label>
      </div>

      {hasOptions && (
        <div className="flex flex-col gap-1.5">
          {(field.options ?? []).map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              {isQuizChoice && (
                <input
                  type="radio"
                  name={`correct-${index}`}
                  checked={field.correctOption === opt}
                  onChange={() => onChange({ correctOption: opt })}
                  title="گزینه‌ی درست"
                />
              )}
              <span className="flex-1 text-[12px] bg-white border border-border rounded-lg px-2.5 py-1.5">{opt}</span>
              <button type="button" onClick={() => removeOption(opt)} className="text-danger text-[11px] cursor-pointer">
                حذف
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
              placeholder="افزودن گزینه..."
              className={`${inputClass} flex-1`}
            />
            <button type="button" onClick={addOption} className="text-[12px] font-bold px-3 rounded-lg bg-primary-soft text-primary cursor-pointer">
              افزودن
            </button>
          </div>
          {isQuizChoice && field.correctOption && (
            <input
              value={String(field.points ?? "")}
              onChange={(e) => onChange({ points: e.target.value.replace(/[^0-9]/g, "") ? Number(e.target.value.replace(/[^0-9]/g, "")) : undefined })}
              inputMode="numeric"
              placeholder="امتیاز این سؤال"
              className={inputClass}
            />
          )}
        </div>
      )}
    </div>
  );
}
