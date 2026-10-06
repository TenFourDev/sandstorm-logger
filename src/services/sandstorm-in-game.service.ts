import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { ServerConfig } from '../config/config.types.js';
import { SandstormWatcherService } from './sandstorm-watcher.service.js';
import { Rcon } from 'rcon-client';

interface PlayerFormatData {
  playerName: string;
  steamId: string;
}

@Injectable()
export class SandstormInGameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SandstormInGameService.name);
  private readonly connections = new Map<string, Rcon>();
  private readonly smokeProjectileCounts = new Map<string, Map<string, number>>();
  private readonly playerNames = new Map<string, string>();

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
      this.playerNames.set(this.steamIdKey(data.steamId), data.playerName);
      this.logger.log(`[${server.name}] Player connected: ${data.playerName} (${data.steamId})`);

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

    this.sandstormWatcherService.read('projectileSpawned', (server, data) => {
      const smokeLimit = server.smokeLimitPerRound;
      if (smokeLimit == null) return;

      const projectileName = data.projectileName.toLowerCase();
      if (
        (!projectileName.includes('smoke') && !projectileName.includes('m18')) ||
        projectileName.includes('mortar')
      ) {
        return;
      }

      const count = this.incrementSmokeProjectileCount(server, data.steamId);
      const playerName = this.playerNames.get(this.steamIdKey(data.steamId)) ?? data.steamId;
      const announceThreshold = server.smokeAnnounceThreshold ?? 1;

      this.logger.debug(`[${server.name}] ${playerName} Smoke deployed: ${count} / ${smokeLimit}`);
      if (count >= announceThreshold) {
        void this.say(server, `[${playerName}] Smoke deployed: ${count} / ${smokeLimit}`);
      }

      if (count > smokeLimit) {
        this.logger.warn(
          `[${server.name}] ${playerName} (${data.steamId}) exceeded the smoke limit (${count}/${smokeLimit}); kicking`,
        );
        void this.kick(server, data.steamId, 'Excessive Smoke');
      }
    });

    this.sandstormWatcherService.read('mapChange', (server) => {
      if (server.smokeLimitPerRound == null) return;
      this.logger.log(`[${server.name}] Map changed, resetting smoke projectile counts.`);
      this.resetSmokeProjectileCounts(server);
    });

    this.sandstormWatcherService.read('mapRestart', (server) => {
      if (server.smokeLimitPerRound == null) return;
      this.logger.log(`[${server.name}] Map restarted, resetting smoke projectile counts.`);
      this.resetSmokeProjectileCounts(server);
    });

    this.sandstormWatcherService.read('roundStart', (server) => {
      if (server.smokeLimitPerRound == null) return;
      this.logger.log(`[${server.name}] Round started, resetting smoke projectile counts.`);
      this.resetSmokeProjectileCounts(server);
    });
  }

  private incrementSmokeProjectileCount(server: ServerConfig, steamId: string): number {
    let counts = this.smokeProjectileCounts.get(server.name);
    if (!counts) {
      counts = new Map<string, number>();
      this.smokeProjectileCounts.set(server.name, counts);
    }

    const count = (counts.get(steamId) ?? 0) + 1;
    counts.set(steamId, count);
    return count;
  }

  private resetSmokeProjectileCounts(server: ServerConfig): void {
    if (this.smokeProjectileCounts.delete(server.name)) {
      this.logger.log(`[${server.name}] Reset smoke projectile counts for the new match`);
    }
  }

  private steamIdKey(steamId: string): string {
    return steamId.replace(/^SteamNWI:/i, '');
  }

  private formatMessage(template: string, data: PlayerFormatData): string {
    return template.replaceAll('{name}', data.playerName);
  }

  private async say(server: ServerConfig, content: string): Promise<void> {
    await this.run(server, `say ${content}`);
  }

  private async kick(server: ServerConfig, steamId: string, reason: string): Promise<void> {
    await this.run(server, `kick ${this.steamIdKey(steamId)} "${reason}"`);
  }

  private async run(server: ServerConfig, command: string): Promise<void> {
    const client = await this.ensureConnection(server);
    if (!client) {
      this.logger.warn(
        `[${server.name}] Failed to run "${command}" because RCON client is not available.`,
      );
      return;
    }

    try {
      await client.send(this.sanitize(command));
      this.logger.log(`[${server.name}] Ran "${command}"`);
    } catch (error) {
      this.connections.delete(server.name);
      this.logger.error(
        `[${server.name}] Failed to run "${command}": ${this.describeError(error)}`,
      );
    }
  }

  private async ensureConnection(server: ServerConfig): Promise<Rcon | null> {
    const existing = this.connections.get(server.name);
    if (existing && existing.authenticated && existing.socket) {
      return existing;
    }

    if (existing) {
      this.connections.delete(server.name);
    }

    return this.connect(server);
  }

  private async connect(server: ServerConfig): Promise<Rcon | null> {
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
