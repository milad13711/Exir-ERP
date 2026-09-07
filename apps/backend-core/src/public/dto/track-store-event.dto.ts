import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const EVENT_TYPES = ['PAGE_VIEW', 'PRODUCT_VIEW', 'PRODUCT_DWELL', 'ADD_TO_CART', 'ORDER_PLACED'] as const;

export class TrackStoreEventDto {
  @IsString()
  sessionToken!: string;

  @IsIn(EVENT_TYPES)
  type!: (typeof EVENT_TYPES)[number];

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
