import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { ServerConfig } from '../config/config.types.js';
import { ServerRcon } from '../libs/rcon.js';
import { SandstormWatcherService } from './sandstorm-watcher.service.js';

interface PlayerFormatData {
  playerName: string;
  steamId: string;
}

@Injectable()
export class SandstormInGameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SandstormInGameService.name);
  private readonly rcon = new Map<string, ServerRcon>();
  private readonly smokeProjectileCounts = new Map<string, Map<string, number>>();
  private readonly playerNames = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly sandstormWatcherService: SandstormWatcherService,
  ) {
    this.registerListeners();
  }

  async onModuleInit(): Promise<void> {
    for (const server of this.configService.servers) {
      if (this.rcon.has(server.name)) continue;
      this.rcon.set(server.name, new ServerRcon(server));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.rcon.values()].map((client) => client.end()));
    this.rcon.clear();
  }

  private registerListeners(): void {
    this.sandstormWatcherService.read('playerConnected', (server, data) => {
      this.playerNames.set(this.steamIdKey(data.steamId), data.playerName);
      this.logger.log(`[${server.name}] Player connected: ${data.playerName} (${data.steamId})`);

      const template = server.inGamePlayerJoinFormat;
      if (!template) return;

      this.logger.log(`[${server.name}] In-game join message for ${data.playerName}`);
      void this.rcon.get(server.name)?.say(this.formatMessage(template, data));
    });

    this.sandstormWatcherService.read('playerDisconnected', (server, data) => {
      const template = server.inGamePlayerLeaveFormat;
      if (!template) return;

      this.logger.log(`[${server.name}] In-game leave message for ${data.playerName}`);
      void this.rcon.get(server.name)?.say(this.formatMessage(template, data));
    });

    this.sandstormWatcherService.read('projectileSpawned', (server, data) => {
      const smokeLimit = server.smokeLimitPerRound;
      if (smokeLimit == null) return;

      const projectileName = data.projectileName.toLowerCase();
      if (
        projectileName.includes('mortar') || 
        projectileName.includes('artillery') ||
        (!projectileName.includes('smoke') && !projectileName.includes('m18')) 
      ) return;
      

      const count = this.incrementSmokeProjectileCount(server, data.steamId);
      const playerName = this.playerNames.get(this.steamIdKey(data.steamId)) ?? data.steamId;
      const announceThreshold = server.smokeAnnounceThreshold ?? 1;

      this.logger.debug(`[${server.name}] ${playerName} Smoke deployed: ${count} / ${smokeLimit}`);
      if (count >= announceThreshold) {
        void this.rcon
          .get(server.name)
          ?.say(`[${playerName}] Smoke deployed: ${count} / ${smokeLimit}`);
      }

      if (count > smokeLimit) {
        this.logger.warn(
          `[${server.name}] ${playerName} (${data.steamId}) exceeded the smoke limit (${count}/${smokeLimit}); kicking`,
        );
        void this.rcon.get(server.name)?.kick(data.steamId, 'Excessive Smoke');
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

    this.sandstormWatcherService.read('preRoundStart', (server) => {
      void this.runCommands(server, 'preRoundCommand', 'pre-round');
    });

    this.sandstormWatcherService.read('roundStart', (server) => {
      if (server.smokeLimitPerRound != null) {
        this.logger.log(`[${server.name}] Round started, resetting smoke projectile counts.`);
        this.resetSmokeProjectileCounts(server);
      }

      void this.runCommands(server, 'roundCommand', 'round');
    });
  }

  private async runCommands(
    server: ServerConfig,
    key: 'roundCommand' | 'preRoundCommand',
    label: string,
  ): Promise<void> {
    const commands = server[key];
    if (!commands || commands.length === 0) return;

    this.logger.log(
      `[${server.name}] ${label} started, running ${commands.length} ${label} command(s)`,
    );

    const rcon = this.rcon.get(server.name);
    if (!rcon) return;

    for (const command of commands) {
      await rcon.run(command);
    }
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
}
