import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsISO8601()
  dueAt!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;
}
