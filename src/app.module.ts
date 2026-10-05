import { Module } from '@nestjs/common';
import { GatewayIntentBits } from 'discord.js';
import { NecordModule } from 'necord';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { SandstormDiscordBotService } from './services/sandstorm-discord-bot.service.js';
import { SandstormInGameService } from './services/sandstorm-in-game.service.js';
import { SandstormWatcherService } from './services/sandstorm-watcher.service.js';

const configService = new ConfigService();
const hasDiscordToken = Boolean(
  configService.discordToken && configService.discordToken.trim().length > 0,
);

@Module({
  imports: [
    ConfigModule,
    ...(hasDiscordToken
      ? [
          NecordModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              token: config.discordToken ?? '',
              intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
              skipRegistration: true,
            }),
          }),
        ]
      : []),
  ],
  controllers: [],
  providers: [
    SandstormWatcherService,
    SandstormInGameService,
    ...(hasDiscordToken ? [SandstormDiscordBotService] : []),
  ],
})
export class AppModule {}
