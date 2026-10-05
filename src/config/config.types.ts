export interface ServerConfig {
  name: string;
  logFilePath: string;
  discordChannelId?: string | null;
  discordPlayerJoinFormat?: string | null;
  discordPlayerLeaveFormat?: string | null;
  rconHost?: string | null;
  rconPort?: number | null;
  rconPassword?: string | null;
  inGamePlayerJoinFormat?: string | null;
  inGamePlayerLeaveFormat?: string | null;
}

export interface AppConfig {
  discordToken?: string;
  servers: ServerConfig[];
}
