import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AddActivityDto {
  @IsIn(['NOTE', 'CALL', 'MEETING', 'EMAIL'])
  type!: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL';

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;
}
