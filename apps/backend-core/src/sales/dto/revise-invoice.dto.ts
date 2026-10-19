import { IsString, MinLength } from 'class-validator';
import { CreateInvoiceDto } from './create-invoice.dto.js';

/** ویرایش فاکتور تأییدشده: همان فیلدهای فاکتور + دلیل الزامی (در تاریخچه‌ی ویرایش ثبت می‌شود). */
export class ReviseInvoiceDto extends CreateInvoiceDto {
  @IsString()
  @MinLength(3, { message: 'دلیل ویرایش را بنویسید' })
  reason!: string;
}
