import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { RolePermissionsModal } from "@/components/settings/RolePermissionsModal";
import {
  createEmployee,
  fetchDepartments,
  createDepartment,
  fetchRolesWithPermissions,
  createRole,
  ApiError,
  type Employee,
  type Department,
  type TenantRoleWithPermissions,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
const NEW_ROLE_VALUE = "__new_role__";

export function NewEmployeeModal({
  employees,
  onClose,
  onCreated,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: (employee: Employee) => void;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [phone, setPhone] = useState("");
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [baseSalary, setBaseSalary] = useState("");
  const [managerId, setManagerId] = useState("");

  const [grantSystemAccess, setGrantSystemAccess] = useState(false);
  const [roles, setRoles] = useState<TenantRoleWithPermissions[]>([]);
  const [roleId, setRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [justCreatedRole, setJustCreatedRole] = useState<TenantRoleWithPermissions | null>(null);
  const [createdEmployee, setCreatedEmployee] = useState<Employee | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
    fetchRolesWithPermissions().then(setRoles).catch(() => setRoles([]));
  }, []);

  async function handleAddDepartment() {
    if (!newDepartmentName.trim()) return;
    setAddingDepartment(true);
    try {
      const dept = await createDepartment({ name: newDepartmentName.trim() });
      setDepartments((prev) => [...prev, dept]);
      setDepartmentId(dept.id);
      setNewDepartmentName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن واحد سازمانی با خطا مواجه شد");
    } finally {
      setAddingDepartment(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeCode.trim() || !fullName.trim() || !position.trim()) return;
    if (grantSystemAccess && !phone.trim()) return setError("برای دسترسی سیستمی، شماره تماس لازم است");
    if (grantSystemAccess && roleId === NEW_ROLE_VALUE && !newRoleName.trim()) return setError("نام نقش جدید را وارد کنید");

    setSubmitting(true);
    setError(null);
    try {
      let finalRoleId = roleId;
      let createdRole: TenantRoleWithPermissions | null = null;
      if (grantSystemAccess && roleId === NEW_ROLE_VALUE) {
        createdRole = await createRole(newRoleName.trim());
        finalRoleId = createdRole.id;
      }

      const employee = await createEmployee({
        employeeCode: employeeCode.trim(),
        fullName: fullName.trim(),
        position: position.trim(),
        departmentId: departmentId || undefined,
        phone: phone.trim() || undefined,
        hireDate,
        baseSalary: baseSalary ? Number(baseSalary) : undefined,
        managerId: managerId || undefined,
        grantSystemAccess: grantSystemAccess || undefined,
        roleId: grantSystemAccess ? finalRoleId : undefined,
      });

      if (createdRole) {
        // نقش تازه ساخته شد اما هنوز هیچ دسترسی‌ای ندارد — بلافاصله ماتریس دسترسی‌اش را باز می‌کنیم؛
        // onCreated/onClose تا بسته‌شدن آن مودال به تعویق می‌افتد.
        setCreatedEmployee(employee);
        setJustCreatedRole(createdRole);
        return;
      }

      onCreated(employee);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  if (justCreatedRole && createdEmployee) {
    return (
      <RolePermissionsModal
        role={justCreatedRole}
        onClose={() => {
          onCreated(createdEmployee);
          onClose();
        }}
        onSaved={() => {}}
      />
    );
  }

  return (
    <Modal title="کارمند جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد پرسنلی</label>
            <input
              autoFocus
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="E-100"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className={labelClass}>نام و نام خانوادگی</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>سمت شغلی</label>
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="مثلاً کارشناس فروش"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>واحد سازمانی</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={`${inputClass} bg-slate-50`}>
              <option value="">بدون واحد سازمانی</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            placeholder="نام واحد سازمانی جدید"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={handleAddDepartment}
            disabled={addingDepartment || !newDepartmentName.trim()}
            className="px-4 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold whitespace-nowrap disabled:opacity-50"
          >
            + واحد جدید
          </button>
        </div>
        <div>
          <label className={labelClass}>مدیر بالادستی</label>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={`${inputClass} bg-slate-50`}>
            <option value="">بدون مدیر بالادستی</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} — {emp.position}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>شماره تماس</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className={labelClass}>تاریخ استخدام</label>
            <JalaliDateInput value={hireDate} onChange={setHireDate} />
          </div>
          <div>
            <label className={labelClass}>حقوق پایه</label>
            <input
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
              placeholder="۰"
            />
          </div>
        </div>

        <div className="border border-border rounded-xl p-3.5">
          <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
            <input type="checkbox" checked={grantSystemAccess} onChange={(e) => setGrantSystemAccess(e.target.checked)} />
            دسترسی به سیستم برای این کارمند ایجاد شود
          </label>
          {grantSystemAccess ? (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <p className="col-span-2 text-[11.5px] text-muted">
                برای ورود به سیستم از همان «شماره تماس» بالا استفاده می‌شود.
              </p>
              <div className="col-span-2">
                <label className={labelClass}>نقش</label>
                <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={`${inputClass} bg-slate-50`}>
                  <option value="">انتخاب کنید</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                  <option value={NEW_ROLE_VALUE}>+ نقش جدید</option>
                </select>
              </div>
              {roleId === NEW_ROLE_VALUE ? (
                <div className="col-span-2">
                  <label className={labelClass}>نام نقش جدید</label>
                  <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} className={inputClass} placeholder="مثلاً سرپرست انبار" />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !employeeCode.trim() || !fullName.trim() || !position.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن کارمند"}
        </button>
      </form>
    </Modal>
  );
}
