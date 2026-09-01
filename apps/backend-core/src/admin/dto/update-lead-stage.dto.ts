import { IsIn } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST'] as const;

export class UpdateLeadStageDto {
  @IsIn(STAGES)
  stage!: (typeof STAGES)[number];
}
