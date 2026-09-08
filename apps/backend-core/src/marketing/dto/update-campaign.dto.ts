import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { AudienceFilterDto } from './audience-filter.dto.js';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsIn(['post-square', 'story'])
  templateCode?: string;

  @IsOptional()
  @IsString()
  templateTitle?: string;

  @IsOptional()
  @IsString()
  templateCta?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audienceFilter?: AudienceFilterDto;
}
