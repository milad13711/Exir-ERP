import { IsInt, IsOptional, Min } from 'class-validator';

export class CompleteOrderDto {
  /** Actual yield — defaults to the order's quantityPlanned when omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantityProduced?: number;
}
