import { IsInt, Min } from 'class-validator';

export class CreateSmsPackageDto {
  @IsInt()
  @Min(1)
  credits!: number;

  @IsInt()
  @Min(0)
  priceToman!: number;
}
