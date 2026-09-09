import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

const METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'POS', 'ONLINE_GATEWAY'] as const;

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  note?: string;

  // الزامی وقتی method === 'CHECK' — اعتبارسنجی در سرویس انجام می‌شود
  @IsOptional()
  @IsString()
  @MinLength(1)
  checkSayadId?: string;

  @IsOptional()
  @IsISO8601()
  checkDueDate?: string;

  @IsOptional()
  @IsString()
  checkBankName?: string;
}
