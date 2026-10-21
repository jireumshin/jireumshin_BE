import { Module } from '@nestjs/common';
import { OptionsController } from './options.controller';

@Module({
  controllers: [OptionsController],
})
export class OptionsModule {}
