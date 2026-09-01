import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class CreateLicenseDto {
  @IsString()
  @MinLength(2)
  orgName!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک ماژول باید انتخاب شود' })
  @IsString({ each: true })
  modules!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  seats?: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  validityDays!: number;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
