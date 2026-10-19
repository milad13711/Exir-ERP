import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** ویرایش رسید/حواله‌ی دستی: کالا و انبار قابل تغییر نیستند (برای آن‌ها ابطال و ثبت تازه). دلیل الزامی است. */
export class EditMovementDto {
  /** RECEIPT/ISSUE: عدد مثبت. ADJUSTMENT: تغییر علامت‌دار. */
  @IsOptional()
  @IsInt()
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsString()
  @MinLength(3, { message: 'دلیل ویرایش را بنویسید' })
  reason!: string;
}

export class VoidMovementDto {
  @IsString()
  @MinLength(3, { message: 'دلیل ابطال را بنویسید' })
  reason!: string;
}
