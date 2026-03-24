type LogLevel = "info" | "error" | "warn";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(prefix, message, ...args);
  } else if (level === "warn") {
    console.warn(prefix, message, ...args);
  } else {
    console.log(prefix, message, ...args);
  }
}

export const logger = {
  info: (message: string, ...args: unknown[]) => log("info", message, ...args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
  error: (message: string, ...args: unknown[]) => log("error", message, ...args),
};
