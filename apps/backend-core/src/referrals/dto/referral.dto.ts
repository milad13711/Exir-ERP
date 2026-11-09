import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReferDocumentDto {
  @IsString()
  @MaxLength(60)
  entityType!: string;

  @IsString()
  @MaxLength(80)
  entityId!: string;

  @IsString()
  @MaxLength(80)
  toUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /** false (پیش‌فرض) = جایگزین مسئول فعلی؛ true = همکار اضافه (چند مسئول هم‌زمان). */
  @IsOptional()
  @IsBoolean()
  additional?: boolean;

  /** کلید تکرار امن؛ دو درخواست با یک کلید یک ارجاع می‌سازند. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}

export class ReassignReferralDto {
  @IsString()
  @MaxLength(80)
  toUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}

export class RespondReferralDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
