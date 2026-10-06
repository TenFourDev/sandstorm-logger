import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import Joi from 'joi';
import { parse, YAMLParseError } from 'yaml';
import type { AppConfig, ServerConfig } from './config.types.js';

const serverSchema = Joi.object({
  name: Joi.string().min(1).required(),
  logFilePath: Joi.string().min(1).required(),
  discordChannelId: Joi.string().min(1).allow(null).optional(),
  discordPlayerJoinFormat: Joi.string().min(1).allow(null).optional(),
  discordPlayerLeaveFormat: Joi.string().min(1).allow(null).optional(),
  rconHost: Joi.string().min(1).allow(null).optional(),
  rconPort: Joi.number().integer().min(1).max(65535).allow(null).optional(),
  rconPassword: Joi.string().min(1).allow(null).optional(),
  inGamePlayerJoinFormat: Joi.string().min(1).allow(null).optional(),
  inGamePlayerLeaveFormat: Joi.string().min(1).allow(null).optional(),
  smokeLimitPerRound: Joi.number().integer().min(0).allow(null).optional(),
  smokeAnnounceThreshold: Joi.number().integer().min(1).allow(null).optional(),
});

const configSchema = Joi.object({
  discordToken: Joi.string().min(1).allow('').optional(),
  servers: Joi.array().items(serverSchema).min(1).required(),
});

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  readonly config: AppConfig;
  readonly discordToken?: string;

  constructor() {
    const filePath = this.resolveConfigPath();
    const raw = this.load(filePath);
    const validated = this.validate(raw);
    this.config = validated;
    this.discordToken = validated.discordToken;
    this.logger.log(`Loaded ${this.config.servers.length} server config(s) from ${filePath}`);
  }

  get servers(): ServerConfig[] {
    return this.config.servers;
  }

  private resolveConfigPath(): string {
    const configured = process.env.CONFIG_FILE?.trim();
    if (configured) {
      return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
    }
    return resolve(process.cwd(), 'config.yaml');
  }

  private load(filePath: string): unknown {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(
        `Could not read config file "${filePath}". ` +
          'Create a config.yaml (see config.example.yaml) or point the CONFIG_FILE environment variable at one.',
      );
    }

    try {
      return parse(raw);
    } catch (error) {
      if (error instanceof YAMLParseError) {
        throw new Error(`Invalid YAML in "${filePath}": ${error.message}`);
      }
      throw error;
    }
  }

  private validate(config: unknown): AppConfig {
    const { error, value } = configSchema.validate(config, {
      abortEarly: false,
      allowUnknown: false,
    });
    if (error) {
      const details = error.details
        .map((detail) => `  - ${detail.path.join('.') || '(root)'}: ${detail.message}`)
        .join('\n');
      throw new Error(`Invalid config:\n${details}`);
    }

    const validated = value as AppConfig;
    this.assertRconConfig(validated);
    return validated;
  }

  private assertRconConfig(config: AppConfig): void {
    const rconFields = ['rconHost', 'rconPort', 'rconPassword'] as const;
    const problems: string[] = [];

    for (const server of config.servers) {
      const usesInGameMessaging = Boolean(
        server.inGamePlayerJoinFormat || server.inGamePlayerLeaveFormat,
      );
      if (!usesInGameMessaging) {
        continue;
      }

      const missing = rconFields.filter(
        (field) => server[field] === undefined || server[field] === null,
      );
      if (missing.length > 0) {
        problems.push(
          `  - servers.${server.name}: ${missing.join(', ')} required when inGamePlayerJoinFormat/inGamePlayerLeaveFormat is set`,
        );
      }
    }

    if (problems.length > 0) {
      throw new Error(`Invalid config:\n${problems.join('\n')}`);
    }
  }

  private assertDiscordChannelId(config: AppConfig): void {
    const problems: string[] = [];

    for (const server of config.servers) {
      if (!server.discordChannelId) {
        problems.push(`  - servers.${server.name}: discordChannelId is required`);
      }
    }

    if (problems.length > 0) {
      throw new Error(`Invalid config:\n${problems.join('\n')}`);
    }
  }
}
