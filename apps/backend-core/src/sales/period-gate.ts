// تنها نقطه‌ی اتصال ثبت دسته‌ای اسناد فروش به قفل دوره‌های مالی (ماژول حسابداری). اگر API قفل دوره عوض شد، فقط این فایل اصلاح می‌شود.
export { assertPeriodOpen, lockedKeys, periodKeyOfDate } from '../accounting/periods/period-lock.js';
