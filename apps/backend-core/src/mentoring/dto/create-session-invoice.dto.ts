import { IsInt, Min } from 'class-validator';

export class CreateSessionInvoiceDto {
  @IsInt()
  @Min(0)
  amount!: number;
}
