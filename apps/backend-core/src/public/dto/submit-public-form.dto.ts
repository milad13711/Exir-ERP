import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

class PublicFormAnswerDto {
  @IsString()
  fieldId!: string;

  @IsOptional()
  @IsString()
  valueText?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  valueOptions?: string[];
}

export class SubmitPublicFormDto {
  @IsOptional()
  @IsString()
  respondentName?: string;

  @IsOptional()
  @IsString()
  respondentPhone?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublicFormAnswerDto)
  answers!: PublicFormAnswerDto[];
}
