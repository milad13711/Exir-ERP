import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitSurveyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  driverRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  productRating?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
