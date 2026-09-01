import { ArrayMinSize, IsArray, IsIn, IsUrl } from 'class-validator';
import { WEBHOOK_EVENTS } from '../webhook-events.js';

export class CreateWebhookDto {
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  url!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'حداقل یک رویداد باید انتخاب شود' })
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: string[];
}
