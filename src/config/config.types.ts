/** A single Sandstorm log watcher that forwards chat activity to a Discord channel. */
export interface ServerConfig {
  /** Server name. */
  name: string;
  /** Discord channel that should receive chat messages. */
  channelId: string;
  /** Path to the Sandstorm server log file. */
  logFilePath: string;
  /** Message template used when a player joins the server. */
  playerJoinFormat?: string;
  /** Message template used when a player leaves the server. */
  playerLeaveFormat?: string;
}

export interface AppConfig {
  servers: ServerConfig[];
}
