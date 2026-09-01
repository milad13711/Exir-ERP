import type { Tone } from "@/components/ui/Badge";
import type { LeaveType, LeaveStatus, PayrollStatus, AttendanceStatus } from "@/lib/api";

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: "استحقاقی",
  SICK: "استعلاجی",
  UNPAID: "بدون حقوق",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "در انتظار بررسی",
  APPROVED: "تأیید شده",
  REJECTED: "رد شده",
};

export const LEAVE_STATUS_TONES: Record<LeaveStatus, Tone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "پیش‌نویس",
  ISSUED: "صادر شده",
  PAID: "پرداخت شده",
};

export const PAYROLL_STATUS_TONES: Record<PayrollStatus, Tone> = {
  DRAFT: "warning",
  ISSUED: "primary",
  PAID: "success",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "حاضر",
  ABSENT: "غایب",
  LEAVE: "مرخصی",
  HOLIDAY: "تعطیل",
};

export const ATTENDANCE_STATUS_TONES: Record<AttendanceStatus, Tone> = {
  PRESENT: "success",
  ABSENT: "danger",
  LEAVE: "warning",
  HOLIDAY: "neutral",
};

export const JALALI_MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];
