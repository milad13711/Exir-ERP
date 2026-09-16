import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class RequestLabOtpDto {
  @IsString()
  phone!: string;
}

export class VerifyLabOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  code!: string;
}

export class SearchSampleDto {
  @IsString()
  labToken!: string;

  @IsString()
  sampleCode!: string;
}

export class ProposedLineDto {
  @IsString()
  ingredientName!: string;

  @IsNumber()
  quantityPerAnimalKg!: number;

  @IsInt()
  @Min(0)
  unitCostSnapshot!: number;
}

export class SubmitLabReportDto {
  @IsString()
  labToken!: string;

  @IsOptional()
  @IsString()
  reviewedByName?: string;

  @IsString()
  currentRationIssues!: string;

  @IsString()
  riskIfUnchanged!: string;

  @IsString()
  newRecommendations!: string;

  @IsString()
  expectedResult!: string;

  @IsString()
  urgentWarningSigns!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedLineDto)
  proposedLines!: ProposedLineDto[];

  /** لینک مستندات ضمیمه (نتیجه‌ی آزمایشگاهی اسکن‌شده و…) — به‌صورت رکوردهای Attachment عمومی ذخیره می‌شود. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentUrls?: string[];

  @IsOptional()
  @IsBoolean()
  addToKnowledge?: boolean;
}
