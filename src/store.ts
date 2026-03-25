import { existsSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { config } from "./config";
import { logger } from "./logger";

const STORE_PATH = config.persistencePath;
const TMP_PATH = `${STORE_PATH}.tmp`;

const HISTORY_PATH = config.historyPath;
const HISTORY_TMP_PATH = `${HISTORY_PATH}.tmp`;

export function saveReminders(data: string): void {
  try {
    writeFileSync(TMP_PATH, data, "utf-8");
    renameSync(TMP_PATH, STORE_PATH);
    logger.info("Reminders persisted to disk.");
  } catch (err) {
    logger.error("Failed to persist reminders:", err);
    try {
      if (existsSync(TMP_PATH)) unlinkSync(TMP_PATH);
    } catch {}
  }
}

export function loadReminders(): string | null {
  try {
    if (!existsSync(STORE_PATH)) return null;
    const data = readFileSync(STORE_PATH, "utf-8");
    logger.info("Loaded reminders from disk.");
    return data;
  } catch (err) {
    logger.error("Failed to load reminders:", err);
    return null;
  }
}

export function saveHistory(data: string): void {
  try {
    writeFileSync(HISTORY_TMP_PATH, data, "utf-8");
    renameSync(HISTORY_TMP_PATH, HISTORY_PATH);
    logger.info("History persisted to disk.");
  } catch (err) {
    logger.error("Failed to persist history:", err);
    try {
      if (existsSync(HISTORY_TMP_PATH)) unlinkSync(HISTORY_TMP_PATH);
    } catch {}
  }
}

export function loadHistory(): string | null {
  try {
    if (!existsSync(HISTORY_PATH)) return null;
    const data = readFileSync(HISTORY_PATH, "utf-8");
    logger.info("Loaded history from disk.");
    return data;
  } catch (err) {
    logger.error("Failed to load history:", err);
    return null;
  }
}
