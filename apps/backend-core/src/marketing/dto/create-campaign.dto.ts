import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { AudienceFilterDto } from './audience-filter.dto.js';

export class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(['SMS', 'BALE', 'WHATSAPP', 'INSTAGRAM_TEMPLATE'])
  channel!: 'SMS' | 'BALE' | 'WHATSAPP' | 'INSTAGRAM_TEMPLATE';

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
