import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ProposalFieldsDto } from './proposal-fields.dto.js';

export class CreateProposalDto extends ProposalFieldsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsUUID()
  contactId!: string;
}
