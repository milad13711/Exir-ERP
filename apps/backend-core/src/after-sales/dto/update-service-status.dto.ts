import { IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['NEW', 'REVIEWING', 'AWAITING_PRODUCT', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export class UpdateServiceStatusDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  staffNotes?: string;
}
