import { IsNumber, IsUUID } from 'class-validator';

export class AddResultDto {
  @IsUUID()
  testTypeId!: string;

  @IsNumber()
  measuredValue!: number;
}
