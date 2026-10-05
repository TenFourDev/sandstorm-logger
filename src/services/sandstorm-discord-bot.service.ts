import { Injectable, Logger } from '@nestjs/common';
import { Client, TextChannel } from 'discord.js';
import { SandstormWatcherService } from './sandstorm-watcher.service.js';

@Injectable()
export class SandstormDiscordBotService {
  private readonly logger = new Logger(SandstormDiscordBotService.name);

  constructor(
    private readonly client: Client,
    private readonly sandstormWatcherService: SandstormWatcherService,
  ) {
    this.client.on('ready', () => {
      this.logger.log(`[Discord] Bot ready as ${this.client.user?.tag ?? 'unknown user'}`);
    });

    this.client.on('error', (error) => {
      this.logger.error(`[Discord] Client error`, error.stack);
    });

    this.sandstormWatcherService.read('playerConnected', (server, data) => {
      if (!server.discordChannelId) return;
      const template = server.discordPlayerJoinFormat ?? '{name} joined the server';
      const message = template.replace('{name}', data.playerName);
      void this.sendDiscordMessage(server.discordChannelId, message);
    });

    this.sandstormWatcherService.read('playerDisconnected', (server, data) => {
      if (!server.discordChannelId) return;
      const template = server.discordPlayerLeaveFormat ?? '{name} left the server';
      const message = template.replace('{name}', data.playerName);
      void this.sendDiscordMessage(server.discordChannelId, message);
    });
  }

  private async sendDiscordMessage(channelId: string, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        this.logger.warn(
          `[Discord] Channel ${channelId} is not a text channel or could not be fetched.`,
        );
        return;
      }

      await (channel as TextChannel).send(content);
    } catch (error) {
      this.logger.error(
        `[Discord] Failed to send message to channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
