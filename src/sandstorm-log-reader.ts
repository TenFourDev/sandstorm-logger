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

interface PlayerRecord {
  name: string;
  steamId: string;
  platform: string;
}

export class SandstormLogReader extends EventEmitter {
  private readonly totalLines: number;
  private readonly logFilePath: string;
  private readonly index: number;
  private tempLastLineChat: string[] = [];
  private players: PlayerRecord[] = [];
  private currentMap?: { map: string; scenario: string };

  constructor(logFilePath: string, index = 0, totalLines = 200) {
    super();
    this.logFilePath = logFilePath;
    this.index = index;
    this.totalLines = totalLines;

    this.startWatching();
  }

  private startWatching(): void {
    if (!existsSync(this.logFilePath)) {
      this.emit('error', new Error(`Log file does not exist: ${this.logFilePath}`));
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

          const playerName = playerData[1];
          const steamId = playerData[2];
          const platform = playerData[3];

          const existingPlayer = this.players.find((player) => player.steamId === steamId);
          if (!existingPlayer) {
            this.players.push({ name: playerName, steamId, platform });
            this.emit('player_connected', {
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
            this.emit('player_disconnected', {
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
              this.emit('map_restart', {
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
              this.emit('map_change', { index: this.index, map, scenario });
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
            this.emit('state_change', {
              index: this.index,
              oldState: stateData[1],
              newState: stateData[2],
            });
          }
        }

        this.tempLastLineChat.push(line);
      }

      this.tempLastLineChat = [...new Set(lines)];
    } catch (error) {
      this.emit('error', error);
    }
  }

  private getLastLines(content: string, numberOfLines: number): string[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.slice(-numberOfLines);
  }
}
