import { IsIn } from 'class-validator';

export class UpdateDealStageDto {
  @IsIn(['NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'])
  stage!: 'NEW' | 'CONTACTED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
}
