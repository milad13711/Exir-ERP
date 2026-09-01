import { IsString } from 'class-validator';

export class AssignLeadDto {
  @IsString()
  ownerAdminId!: string;
}
