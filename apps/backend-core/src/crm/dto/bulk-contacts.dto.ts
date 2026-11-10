import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** بدنه‌ی عملیات دسته‌جمعی روی مخاطبین — حداکثر ۲۰۰ مورد در هر درخواست. */
export class BulkContactIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  ids!: string[];
}

/** تغییر دسته‌جمعی مرحله‌ی قیف — همان مراحل دستیِ تکی (رجوع به UpdateFunnelStageDto). */
export class BulkContactStageDto extends BulkContactIdsDto {
  @IsIn(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'])
  stage!: 'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';

  /** دلیل رد صلاحیت — برای DISQUALIFIED الزامی است. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
