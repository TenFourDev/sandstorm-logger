import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import Joi from 'joi';
import { parse, YAMLParseError } from 'yaml';
import type { AppConfig, ServerConfig } from './config.types.js';

const serverSchema = Joi.object({
  name: Joi.string().min(1).required(),
  channelId: Joi.string().min(1).required(),
  logFilePath: Joi.string().min(1).required(),
  playerJoinFormat: Joi.string().min(1).default('{name} joined the server'),
  playerLeaveFormat: Joi.string().min(1).default('{name} left the server'),
});

const configSchema = Joi.object({
  servers: Joi.array().items(serverSchema).min(1).required(),
});

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  readonly config: AppConfig;

  constructor() {
    const filePath = this.resolveConfigPath();
    const raw = this.load(filePath);
    this.config = this.validate(raw);
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
    return value as AppConfig;
  }
}
