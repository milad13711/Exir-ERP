import { IsOptional, IsString } from 'class-validator';

export class RejectPurchaseOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
