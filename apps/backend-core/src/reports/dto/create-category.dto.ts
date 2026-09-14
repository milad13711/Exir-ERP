import { IsString, MinLength } from 'class-validator';

export class CreateReportCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
