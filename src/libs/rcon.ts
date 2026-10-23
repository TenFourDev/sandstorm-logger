import { Logger } from '@nestjs/common';
import { Rcon } from 'rcon-client';
import type { ServerConfig } from '../config/config.types.js';

export interface RconPlayer {
  id: number;
  name: string;
  netId: string;
  ip: string;
  score: number;
}

export class ServerRcon {
  private readonly logger = new Logger(ServerRcon.name);
  private client?: Rcon;

  constructor(private readonly server: ServerConfig) {}

  get name(): string {
    return this.server.name;
  }

  get isConfigured(): boolean {
    return Boolean(this.server.rconHost && this.server.rconPort && this.server.rconPassword);
  }

  async connect(): Promise<Rcon | null> {
    if (!this.server.rconHost || !this.server.rconPort || !this.server.rconPassword) {
      this.logger.warn(`[${this.name}] Rcon configuration is missing.`);
      return null;
    }

    const client = new Rcon({
      host: this.server.rconHost,
      port: this.server.rconPort,
      password: this.server.rconPassword,
      timeout: 5000,
    });

    try {
      await client.connect();
      this.client = client;
      this.logger.log(
        `[${this.name}] RCON connected at ${this.server.rconHost}:${this.server.rconPort}`,
      );
      return client;
    } catch (error) {
      this.logger.error(
        `[${this.name}] Failed to connect to RCON at ${this.server.rconHost}:${this.server.rconPort}: ${error})}`,
      );
      return null;
    }
  }

  async ensureConnection(): Promise<Rcon | null> {
    const existing = this.client;
    if (existing && existing.authenticated && existing.socket) {
      return existing;
    }

    this.client = undefined;
    return this.connect();
  }

  async end(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;

    try {
      await client.end();
    } catch {}
  }

  async run(command: string): Promise<string | null> {
    const client = await this.ensureConnection();
    if (!client) {
      this.logger.warn(
        `[${this.name}] Failed to run "${command}" because RCON client is not available.`,
      );
      return null;
    }

    try {
      const result = await client.send(this.sanitize(command));
      this.logger.log(`[${this.name}] Ran "${command}"`);
      return result;
    } catch (error) {
      this.client = undefined;
      this.logger.error(
        `[${this.name}] Failed to run "${command}": ${error})}`,
      );
    }

    return null;
  }

  async say(content: string): Promise<void> {
    await this.run(`say ${content}`);
  }

  async kick(steamId: string, reason: string): Promise<void> {
    await this.run(`kick ${this.steamIdKey(steamId)} "${reason}"`);
  }

  async listPlayers(): Promise<RconPlayer[]> {
    const raw = await this.run('listPlayers');
    if (!raw) return [];

    const body = raw
      .replace(/\u0000/g, '')
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length)
      .filter((l) => !l.trim().startsWith('='))
      .filter((l) => !/^ID\b/.test(l.trim()))
      .join('');

    const cells = body.split('|').map((c) => c.replace(/[ \t]+/g, ' ').trim());
    if (cells.at(-1) === '') cells.pop();

    const out: RconPlayer[] = [];
    for (let i = 0; i + 4 < cells.length; i += 5) {
      const [id, name, netId, ip, score] = cells.slice(i, i + 5);
      out.push({ id: +id, name, netId, ip, score: +score });
    }

    return out.filter((entry) => entry.id);
  }

  private steamIdKey(steamId: string): string {
    return steamId.replace(/^SteamNWI:/i, '');
  }

  private sanitize(content: string): string {
    return content
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
  }
}
