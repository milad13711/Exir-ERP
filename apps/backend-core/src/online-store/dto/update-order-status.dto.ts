import { IsIn, IsOptional, IsString } from 'class-validator';

const NEXT_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

export class UpdateOrderStatusDto {
  @IsIn(NEXT_STATUSES)
  status!: (typeof NEXT_STATUSES)[number];

  @IsOptional()
  @IsString()
  trackingCode?: string;
}
