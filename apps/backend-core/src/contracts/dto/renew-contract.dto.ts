import { IsDateString } from 'class-validator';

export class RenewContractDto {
  @IsDateString()
  newEndDate!: string;
}
