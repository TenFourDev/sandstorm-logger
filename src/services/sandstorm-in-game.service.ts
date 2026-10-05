import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { ServerConfig } from '../config/config.types.js';
import { SandstormWatcherService } from './sandstorm-watcher.service.js';
import { Rcon } from 'rcon-client';

type RconConnection = import('rcon-client').Rcon;

interface PlayerFormatData {
  playerName: string;
  steamId: string;
}

@Injectable()
export class SandstormInGameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SandstormInGameService.name);
  private readonly connections = new Map<string, RconConnection>();

  constructor(
    private readonly configService: ConfigService,
    private readonly sandstormWatcherService: SandstormWatcherService,
  ) {
    this.registerListeners();
  }

  async onModuleInit(): Promise<void> {
    await Promise.all(
      this.configService.servers
        .filter((server) => server.inGamePlayerJoinFormat || server.inGamePlayerLeaveFormat)
        .map((server) => this.connect(server)),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(async (client) => {
        try {
          await client.end();
        } catch {}
      }),
    );
    this.connections.clear();
  }

  private registerListeners(): void {
    this.sandstormWatcherService.read('playerConnected', (server, data) => {
      const template = server.inGamePlayerJoinFormat;
      if (!template) return;

      this.logger.log(`[${server.name}] In-game join message for ${data.playerName}`);
      void this.say(server, this.formatMessage(template, data));
    });

    this.sandstormWatcherService.read('playerDisconnected', (server, data) => {
      const template = server.inGamePlayerLeaveFormat;
      if (!template) return;

      this.logger.log(`[${server.name}] In-game leave message for ${data.playerName}`);
      void this.say(server, this.formatMessage(template, data));
    });
  }

  private formatMessage(template: string, data: PlayerFormatData): string {
    return template.replaceAll('{name}', data.playerName);
  }

  private async say(server: ServerConfig, content: string): Promise<void> {
    const client = await this.ensureConnection(server);
    if (!client) {
      this.logger.warn(
        `[${server.name}] Failed to run "say" because RCON client is not available.`,
      );
      return;
    }

    try {
      await client.send(`say ${this.sanitize(content)}`);
      this.logger.log(`[${server.name}] Ran "say": ${content}`);
    } catch (error) {
      this.connections.delete(server.name);
      this.logger.error(`[${server.name}] Failed to run "say": ${this.describeError(error)}`);
    }
  }

  private async ensureConnection(server: ServerConfig): Promise<RconConnection | null> {
    const existing = this.connections.get(server.name);
    if (existing && existing.authenticated && existing.socket) {
      return existing;
    }

    if (existing) {
      this.connections.delete(server.name);
    }

    return this.connect(server);
  }

  private async connect(server: ServerConfig): Promise<RconConnection | null> {
    if (!server.rconHost || !server.rconPort || !server.rconPassword) {
      this.logger.warn(`[${server.name}] Rcon configuration is missing.`);
      return null;
    }

    const client = new Rcon({
      host: server.rconHost,
      port: server.rconPort,
      password: server.rconPassword,
      timeout: 5000,
    });

    try {
      await client.connect();
      this.connections.set(server.name, client);
      this.logger.log(`[${server.name}] RCON connected at ${server.rconHost}:${server.rconPort}`);
      return client;
    } catch (error) {
      this.logger.error(
        `[${server.name}] Failed to connect to RCON at ${server.rconHost}:${server.rconPort}: ${this.describeError(error)}`,
      );
      return null;
    }
  }

  private sanitize(content: string): string {
    return content
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
