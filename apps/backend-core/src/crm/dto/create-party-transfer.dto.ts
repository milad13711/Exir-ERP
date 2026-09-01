import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePartyTransferDto {
  /** طرف‌حسابی که به ما بدهکار بود و حالا طلبش تسویه می‌شود (پرداخت‌کننده‌ی واقعی وجه). */
  @IsUUID()
  fromContactId!: string;

  /** طرف‌حسابی که ما به او بدهکار بودیم و حالا بدهی‌مان تسویه می‌شود (گیرنده‌ی واقعی وجه). */
  @IsUUID()
  toContactId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
