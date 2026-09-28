import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInvoiceFollowUpDto {
  @IsString()
  @MinLength(1)
  note!: string;

  @IsOptional()
  @IsString()
  outcome?: string;
}
