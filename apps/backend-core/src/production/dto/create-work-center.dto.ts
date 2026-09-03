import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWorkCenterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;
}
