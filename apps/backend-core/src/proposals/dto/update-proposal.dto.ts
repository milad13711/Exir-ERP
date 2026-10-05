import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ProposalFieldsDto } from './proposal-fields.dto.js';

export class UpdateProposalDto extends ProposalFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsUUID() contactId?: string;
}
