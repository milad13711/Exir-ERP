import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePartyTransactionDto {
  @IsIn(['RECEIPT', 'PAYMENT'])
  type!: 'RECEIPT' | 'PAYMENT';

  @IsInt()
  @Min(1)
  amount!: number;

  /** کد حساب نقد/بانکی که وجه از/به آن حرکت کرد — پیش‌فرض صندوق (1010). */
  @IsOptional()
  @IsString()
  accountCode?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
