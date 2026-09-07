import { Module } from '@nestjs/common';
import { GatewayIntentBits } from 'discord.js';
import { NecordModule } from 'necord';
import { ConfigModule } from './config/config.module.js';
import { SandstormDiscordBotService } from './sandstorm-discord-bot.service.js';

@Module({
  imports: [
    ConfigModule,
    NecordModule.forRootAsync({
      useFactory: () => {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
          throw new Error('DISCORD_TOKEN environment variable is not set.');
        }
        return {
          token,
          intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
          skipRegistration: true,
        };
      },
    }),
  ],
  controllers: [],
  providers: [SandstormDiscordBotService],
})
export class AppModule {}
