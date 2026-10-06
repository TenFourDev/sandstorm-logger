import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { ConfigService } from '../config/config.service.js';
import type { ServerConfig } from '../config/config.types.js';
import {
  SandstormLogReader,
  SandstormProjectileSpawnedEvent,
  type SandstormMessageEvent,
  type SandstormPlayerConnectedEvent,
  type SandstormPlayerDisconnectedEvent,
  type SandstormRoundStartedEvent,
} from '../libs/sandstorm-log-reader.js';

type SandstormMapChangedEvent = { index: number; map: string; scenario: string };
type SandstormStateChangedEvent = { index: number; oldState: string; newState: string };

type SandstormWatcherEvents = {
  playerConnected: (server: ServerConfig, eventData: SandstormPlayerConnectedEvent) => void;
  playerDisconnected: (server: ServerConfig, eventData: SandstormPlayerDisconnectedEvent) => void;
  projectileSpawned: (server: ServerConfig, eventData: SandstormProjectileSpawnedEvent) => void;
  message: (server: ServerConfig, eventData: SandstormMessageEvent) => void;
  mapChange: (server: ServerConfig, eventData: SandstormMapChangedEvent) => void;
  mapRestart: (server: ServerConfig, eventData: SandstormMapChangedEvent) => void;
  stateChange: (server: ServerConfig, eventData: SandstormStateChangedEvent) => void;
  roundStart: (server: ServerConfig, eventData: SandstormRoundStartedEvent) => void;
  error: (server: ServerConfig, eventData: unknown) => void;
};

export type SandstormWatcherEventName = keyof SandstormWatcherEvents;
export type SandstormWatcherListener<E extends SandstormWatcherEventName> =
  SandstormWatcherEvents[E];

const TypedEventEmitter =
  EventEmitter as unknown as new () => import('typed-emitter').default<SandstormWatcherEvents>;

@Injectable()
export class SandstormWatcherService extends TypedEventEmitter implements OnModuleInit {
  private readonly logger = new Logger(SandstormWatcherService.name);
  private readonly readers = new Map<string, SandstormLogReader>();

  constructor(private readonly configService: ConfigService) {
    super();
  }

  onModuleInit(): void {
    this.startWatchingServers();
  }

  read<E extends SandstormWatcherEventName>(
    eventName: E,
    listener: SandstormWatcherListener<E>,
  ): void {
    this.on(eventName, listener);
  }

  private startWatchingServers(): void {
    for (const [index, server] of this.configService.servers.entries()) {
      if (this.readers.has(server.name)) {
        continue;
      }

      this.logger.log(
        `Starting Sandstorm watcher for "${server.name}" on ${server.logFilePath} (channel: ${server.discordChannelId})`,
      );

      const reader = new SandstormLogReader(server.logFilePath, index);
      this.readers.set(server.name, reader);

      reader.on('playerConnected', (eventData) => {
        this.emit('playerConnected', server, eventData);
      });
      reader.on('playerDisconnected', (eventData) => {
        this.emit('playerDisconnected', server, eventData);
      });
      reader.on('projectileSpawned', (eventData) => {
        this.emit('projectileSpawned', server, eventData);
      });
      reader.on('message', (eventData) => {
        this.emit('message', server, eventData);
      });
      reader.on('mapChange', (eventData) => {
        this.emit('mapChange', server, eventData);
      });
      reader.on('mapRestart', (eventData) => {
        this.emit('mapRestart', server, eventData);
      });
      reader.on('stateChange', (eventData) => {
        this.emit('stateChange', server, eventData);
      });
      reader.on('roundStart', (eventData) => {
        this.emit('roundStart', server, eventData);
      });
      reader.on('error', (error) => {
        this.logger.error(
          `Watcher error for "${server.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
        this.emit('error', server, error);
      });
    }
  }
}
