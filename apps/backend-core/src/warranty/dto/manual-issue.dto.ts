import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ManualIssueDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  manualInvoiceNumber?: string;
}
