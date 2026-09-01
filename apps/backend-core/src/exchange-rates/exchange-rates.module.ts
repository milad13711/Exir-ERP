import { Module } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service.js';

@Module({
  providers: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
