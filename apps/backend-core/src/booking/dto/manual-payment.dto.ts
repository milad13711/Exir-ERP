import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class ManualPaymentDto {
  @IsIn(['CASH', 'CARD', 'TRANSFER'])
  method!: 'CASH' | 'CARD' | 'TRANSFER';

  /** خالی یعنی همان مبلغ بیعانه/پرداخت تعیین‌شده برای نوبت */
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;
}
