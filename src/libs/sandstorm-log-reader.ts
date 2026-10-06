/**
 * Credit to:
 * https://github.com/zDestinate/INS_Sandstorm_DiscordChat/blob/master/server/lib/SandstormLogReader.js
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, watch } from 'node:fs';

export interface SandstormPlayerConnectedEvent {
  index: number;
  playerName: string;
  steamId: string;
  platform: string;
}

export interface SandstormPlayerDisconnectedEvent {
  index: number;
  playerName: string;
  steamId: string;
  platform: string;
}

export interface SandstormMessageEvent {
  index: number;
  playerName: string;
  steamId: string;
  chatType: string;
  message: string;
}

export interface SandstormProjectileSpawnedEvent {
  index: number;
  projectileName: string;
  steamId: string;
}

export interface SandstormRoundStartedEvent {
  index: number;
}

interface PlayerRecord {
  name: string;
  steamId: string;
  platform: string;
}

type SandstormLogReaderEvents = {
  projectileSpawned: (event: SandstormProjectileSpawnedEvent) => void;
  playerConnected: (event: SandstormPlayerConnectedEvent) => void;
  playerDisconnected: (event: SandstormPlayerDisconnectedEvent) => void;
  message: (event: SandstormMessageEvent) => void;
  mapChange: (event: { index: number; map: string; scenario: string }) => void;
  mapRestart: (event: { index: number; map: string; scenario: string }) => void;
  stateChange: (event: { index: number; oldState: string; newState: string }) => void;
  roundStart: (event: SandstormRoundStartedEvent) => void;
  error: (error: unknown) => void;
};

const TypedEventEmitter =
  EventEmitter as unknown as new () => import('typed-emitter').default<SandstormLogReaderEvents>;

export class SandstormLogReader extends TypedEventEmitter {
  private readonly totalLines: number;
  private readonly logFilePath: string;
  private readonly index: number;
  private tempLastLineChat: string[] = [];
  private players: PlayerRecord[] = [];
  private currentMap?: { map: string; scenario: string };
  private seenProjectiles: Set<string> = new Set();
  private pendingProjectiles = new Map<
    string,
    { pawnName: string; timestamp: number; timer: ReturnType<typeof setTimeout> }
  >();
  private controllerSteamIds = new Map<string, string>();
  private pawnControllers = new Map<string, string>();

  constructor(logFilePath: string, index = 0, totalLines = 200) {
    super();
    this.logFilePath = logFilePath;
    this.index = index;
    this.totalLines = totalLines;

    this.startWatching();
  }

  private startWatching(): void {
    if (!existsSync(this.logFilePath)) {
      setTimeout(() => this.startWatching(), 1000);
      return;
    }

    watch(this.logFilePath, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        void this.readRecentLines();
      }
    });

    void this.readRecentLines();
  }

  private async readRecentLines(): Promise<void> {
    try {
      const content = readFileSync(this.logFilePath, 'utf8');
      const lines = this.getLastLines(content, this.totalLines);

      for (const line of lines) {
        if (this.tempLastLineChat.includes(line)) {
          continue;
        }

        this.trackControllerSteamId(line);
        this.trackPossessedPawn(line);

        if (line.includes(']LogNet: Login request: ')) {
          const requestMatch = line.match(/\]LogNet: Login request: (.*)/i);
          if (!requestMatch || requestMatch.length < 2) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const playerData = requestMatch[1].match(
            /\?Name=(.*) userId: SteamNWI:(.*) platform: (.*)/i,
          );
          if (!playerData || playerData.length < 4) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const playerName = playerData[1].replace(/\?\?.*$/, '');
          const steamId = playerData[2];
          const platform = playerData[3];

          const existingPlayer = this.players.find((player) => player.steamId === steamId);
          if (!existingPlayer) {
            this.players.push({ name: playerName, steamId, platform });
            this.emit('playerConnected', {
              index: this.index,
              playerName,
              steamId,
              platform,
            } satisfies SandstormPlayerConnectedEvent);
          }
        } else if (line.includes(']LogNet: UChannel::CleanUp:')) {
          const steamIdMatch = line.match(/UniqueId: SteamNWI:(.*)/i);
          if (!steamIdMatch || steamIdMatch.length < 2) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const steamId = steamIdMatch[1];
          const disconnectedPlayer = this.players.find((player) => player.steamId === steamId);
          if (disconnectedPlayer) {
            this.emit('playerDisconnected', {
              index: this.index,
              playerName: disconnectedPlayer.name,
              steamId,
              platform: disconnectedPlayer.platform,
            } satisfies SandstormPlayerDisconnectedEvent);

            this.players = this.players.filter((player) => player.steamId !== steamId);
          }
        } else if (line.includes(']LogChat: Display: ')) {
          const chatLineMatch = line.match(/\]LogChat: Display: (.*)/i);
          if (!chatLineMatch || chatLineMatch.length < 2) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const chatLine = chatLineMatch[1];
          const playerMatch = chatLine.match(/^(.*)\(([^)]+)\)\s+([^\s]+)\s+Chat:\s*(.*)$/i);
          if (!playerMatch || playerMatch.length < 5) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const playerName = playerMatch[1].trim();
          const steamId = playerMatch[2];
          const chatType = playerMatch[3];
          const message = playerMatch[4];

          this.emit('message', {
            index: this.index,
            playerName,
            steamId,
            chatType,
            message,
          } satisfies SandstormMessageEvent);
        } else if (line.includes(']LogGameMode: ProcessServerTravel')) {
          const travelMatch = line.match(/\]LogGameMode: ProcessServerTravel: (.*)/i);
          if (!travelMatch || travelMatch.length < 2) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const travelTarget = travelMatch[1];
          if (travelTarget.includes('?restart')) {
            if (this.currentMap) {
              this.emit('mapRestart', {
                index: this.index,
                map: this.currentMap.map,
                scenario: this.currentMap.scenario,
              });
            }
          } else {
            const mapMatch = travelTarget.match(/^(.*)\?Scenario=([^?]*)/i);
            if (mapMatch && mapMatch.length >= 3) {
              const map = mapMatch[1];
              const scenario = mapMatch[2];
              this.currentMap = { map, scenario };
              this.emit('mapChange', { index: this.index, map, scenario });
            }
          }
        } else if (line.includes(']LogGameMode: Display: State: ')) {
          const stateMatch = line.match(/\]LogGameMode: Display: State: (.*)/i);
          if (!stateMatch || stateMatch.length < 2) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const stateData = stateMatch[1].match(/(.*) -> (.*)/i);
          if (stateData && stateData.length >= 3) {
            const oldState = stateData[1];
            const newState = stateData[2];

            this.emit('stateChange', {
              index: this.index,
              oldState,
              newState,
            });

            if (oldState === 'PreRound' && newState === 'RoundActive') {
              this.emit('roundStart', { index: this.index });
            }
          }
        } else if (line.includes(']LogSoldier: ') && line.includes(' is inside BP_Projectile_')) {
          const projectileMatch = line.match(/(BP_Character_Player_C_\d+) is inside (BP_Projectile_\S+)_(\d+)/);
          if (!projectileMatch || projectileMatch.length < 4) {
            this.tempLastLineChat.push(line);
            continue;
          }

          const pawnName = projectileMatch[1];
          const projectileName = projectileMatch[2];
          const projectileId = `${projectileName}_${projectileMatch[3]}`;

          if (!this.seenProjectiles.has(projectileId)) {
            const pending = this.pendingProjectiles.get(projectileId);
            const timestamp = this.parseLogTimestamp(line);

            if (!pending) {
              const timer = setTimeout(() => {
                if (!this.pendingProjectiles.delete(projectileId)) return;
                this.markProjectileSeen(projectileId);

                const steamId = this.resolveSteamIdByPawn(pawnName);
                if (steamId) {
                  this.emit('projectileSpawned', {
                    index: this.index,
                    projectileName,
                    steamId,
                  });
                }
              }, 250);

              this.pendingProjectiles.set(projectileId, { pawnName, timestamp, timer });
            } else if (
              pawnName !== pending.pawnName &&
              Math.abs(timestamp - pending.timestamp) === 0
            ) {
              clearTimeout(pending.timer);
              this.pendingProjectiles.delete(projectileId);
              this.markProjectileSeen(projectileId);
            }
          }
        }

        this.tempLastLineChat.push(line);
      }

      this.tempLastLineChat = [...new Set(lines)];
    } catch (error) {
      this.emit('error', error);
    }
  }

  private trackControllerSteamId(line: string): void {
    if (line.includes(' got player ')) {
      const spawnMatch = line.match(/INSPlayerController_(\d+) got player \S+ \[(\d+)\]/);
      if (spawnMatch) this.controllerSteamIds.set(`INSPlayerController_${spawnMatch[1]}`, spawnMatch[2]);
      return;
    }

    if (!line.includes('PC: INSPlayerController_') || !line.includes('UniqueId: SteamNWI:')) {
      return;
    }

    const connectionMatch = line.match(/PC: (INSPlayerController_\d+),.*UniqueId: (SteamNWI:\d+)/);
    if (!connectionMatch) return;

    this.controllerSteamIds.set(
      connectionMatch[1],
      connectionMatch[2].replace(/^SteamNWI:/i, ''),
    );
  }

  private trackPossessedPawn(line: string): void {
    if (!line.includes('PAWNREUSE: ')) return;
    
    const reuseMatch = line.match(
      /PAWNREUSE: '(INSPlayerController_\d+)' (?:possessing [^']*|cached new pawn) '(BP_Character_Player_C_\d+)'/,
    );

    if (!reuseMatch) return;
    this.pawnControllers.set(reuseMatch[2], reuseMatch[1]);
  }

  private resolveSteamIdByPawn(pawnName: string): string | undefined {
    const controllerName = this.pawnControllers.get(pawnName);
    if (!controllerName) return undefined;

    return this.controllerSteamIds.get(controllerName);
  }

  private parseLogTimestamp(line: string): number {
    const match = line.match(/-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]/);
    if (!match) return 0;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
  }

  private markProjectileSeen(projectileId: string): void {
    if (this.seenProjectiles.size >= 1000) {
      const oldestProjectile = this.seenProjectiles.values().next().value;
      if (oldestProjectile) this.seenProjectiles.delete(oldestProjectile);
    }
    this.seenProjectiles.add(projectileId);
  }

  private getLastLines(content: string, numberOfLines: number): string[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.slice(-numberOfLines);
  }
}
