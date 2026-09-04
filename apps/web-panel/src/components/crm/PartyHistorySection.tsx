import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { DocsIcon, BuildingIcon, CalendarIcon } from "@/components/icons";
import { formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import { fetchContracts, fetchProjects, fetchAppointments, type Contract, type Project, type Appointment } from "@/lib/api";

/**
 * A cross-module "این طرف‌حساب قبلاً چه کرده" history — contracts, projects
 * and appointments linked to this CRM contact, each from its own module's
 * existing ?contactId= filter (no new backend surface). A module a tenant
 * hasn't installed simply 403s and renders as an empty section rather than
 * an error, since not every tenant has every one of these modules.
 */
export function PartyHistorySection({ contactId }: { contactId: string }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    Promise.allSettled([
      fetchContracts({ contactId }),
      fetchProjects({ contactId }),
      fetchAppointments({ contactId }),
    ]).then(([c, p, a]) => {
      setContracts(c.status === "fulfilled" ? c.value : []);
      setProjects(p.status === "fulfilled" ? p.value : []);
      setAppointments(a.status === "fulfilled" ? a.value : []);
      setLoaded(true);
    });
  }, [contactId]);

  const hasAny = contracts.length > 0 || projects.length > 0 || appointments.length > 0;
  if (loaded && !hasAny) return null;

  return (
    <div>
      <div className="text-[12px] font-semibold text-ink-soft mb-2">تاریخچه</div>
      {!loaded ? (
        <div className="text-[12px] text-muted text-center py-3">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {projects.map((p) => (
            <div key={`project-${p.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <BuildingIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">پروژه: {p.name}</span>
              <Badge tone="neutral">#{p.projectNo}</Badge>
            </div>
          ))}
          {contracts.map((c) => (
            <div key={`contract-${c.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <DocsIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">قرارداد: {c.title}</span>
              <span className="text-[11px] text-muted">تا {formatJalaliDate(c.endDate)}</span>
            </div>
          ))}
          {appointments.map((a) => (
            <div key={`appointment-${a.id}`} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <CalendarIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold flex-1 truncate">نوبت: {a.serviceType.name}</span>
              <span className="text-[11px] text-muted">{formatJalaliDateTime(a.startAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
