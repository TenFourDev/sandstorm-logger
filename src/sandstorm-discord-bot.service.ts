import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, TextChannel } from 'discord.js';
import { ConfigService } from './config/config.service.js';
import { SandstormLogReader } from './sandstorm-log-reader.js';

@Injectable()
export class SandstormDiscordBotService implements OnModuleInit {
  private readonly logger = new Logger(SandstormDiscordBotService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly client: Client,
  ) {
    this.client.on('ready', () => {
      this.logger.log(`Discord bot ready as ${this.client.user?.tag ?? 'unknown user'}`);
      for (const [index, server] of this.configService.servers.entries()) {
        this.startWatchingServer(index, server);
      }
    });

    this.client.on('error', (error) => {
      this.logger.error('Discord client error', error.stack);
    });
  }

  onModuleInit(): void {
    if (this.client.isReady()) {
      for (const [index, server] of this.configService.servers.entries()) {
        this.startWatchingServer(index, server);
      }
    }
  }

  private startWatchingServer(
    index: number,
    server: {
      name: string;
      channelId: string;
      logFilePath: string;
      playerJoinFormat?: string;
      playerLeaveFormat?: string;
    },
  ): void {
    this.logger.log(
      `Starting Sandstorm log watcher for server "${server.name}" (index ${index}) on channel ${server.channelId}: ${server.logFilePath}`,
    );

    const reader = new SandstormLogReader(server.logFilePath, index);

    reader.on('player_connected', (event) => {
      this.logger.log(
        `Player connected event received for ${event.playerName} (${event.steamId}) on server ${index}`,
      );
      const template = server.playerJoinFormat ?? '{name} joined the server';
      const message = template
        .replace('{name}', event.playerName)
        .replace('{steamid}', event.steamId);
      this.sendDiscordMessage(server.channelId, message);
    });

    reader.on('player_disconnected', (event) => {
      this.logger.log(
        `Player disconnected event received for ${event.playerName} (${event.steamId}) on server ${index}`,
      );
      const template = server.playerLeaveFormat ?? '{name} left the server';
      const message = template
        .replace('{name}', event.playerName)
        .replace('{steamid}', event.steamId);
      this.sendDiscordMessage(server.channelId, message);
    });

    reader.on('message', (event) => {
      this.logger.log(
        `Chat message event received from ${event.playerName} on server ${index}: ${event.message}`,
      );
      const message = `[${event.playerName}] ${event.message}`;
      this.sendDiscordMessage(server.channelId, message);
    });

    reader.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Log reader error for ${server.logFilePath}: ${message}`);
    });
  }

  private async sendDiscordMessage(channelId: string, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        this.logger.warn(`Channel ${channelId} is not a text channel or could not be fetched.`);
        return;
      }

      await (channel as TextChannel).send(content);
    } catch (error) {
      this.logger.error(
        `Failed to send message to channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
