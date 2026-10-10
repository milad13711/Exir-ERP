import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetProjectSmsNotifyDto {
  /** true/false = اختصاصی پروژه؛ null/حذف = پیروی از پیش‌فرض ماژول */
  @IsOptional() @IsBoolean() enabled?: boolean | null;
}

export class PreviewSmsTemplateDto {
  @IsString() @MaxLength(800) template!: string;
  @IsOptional() @IsBoolean() withLink?: boolean;
}

/** فقط متن نهایی؛ گیرنده هرگز از ورودی نمی‌آید (شماره‌ی مخاطب پروژه). */
export class ManualSmsDto {
  @IsString() @MinLength(1) @MaxLength(1000) message!: string;
}
