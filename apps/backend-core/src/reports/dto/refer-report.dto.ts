import { ArrayMinSize, IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

export class ReferReportDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  toUserIds!: string[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emailCc?: string[];
}
