import { logger } from "./logger";

const MAX_HISTORY = 20;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export class MessageHistory {
  private messages: HistoryMessage[] = [];

  add(role: "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
    if (this.messages.length > MAX_HISTORY) {
      this.messages = this.messages.slice(-MAX_HISTORY);
    }
  }

  getMessages(): HistoryMessage[] {
    return [...this.messages];
  }

  export(): string {
    return JSON.stringify(this.messages, null, 2);
  }

  import(json: string): void {
    try {
      const entries = JSON.parse(json);
      if (Array.isArray(entries)) {
        // Handle old format migration (role: "agent" → "assistant", text → content)
        this.messages = entries.slice(-MAX_HISTORY).map((e: Record<string, unknown>) => ({
          role: (e.role === "agent" ? "assistant" : e.role) as "user" | "assistant",
          content: (e.content ?? e.text ?? "") as string,
        }));
        logger.info(`Imported ${this.messages.length} history entries.`);
      }
    } catch (err) {
      logger.error("Failed to import history:", err);
    }
  }
}
