import { config } from "./config";
import { logger } from "./logger";

const MAX_HISTORY = 20;

export interface HistoryEntry {
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

type OnTimeoutCallback = () => void;

interface PendingClarification {
  kind: "clarification";
  task: string;
  attempt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingConfirmation {
  kind: "confirmation";
  task: string;
  sendAt: Date;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingDisambiguation {
  kind: "disambiguation";
  action: "update" | "cancel";
  candidates: { id: string; task: string; sendAt: string }[];
  newTimeExpr?: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

type PendingState = PendingClarification | PendingConfirmation | PendingDisambiguation;

export class ConversationState {
  private pending: PendingState | null = null;
  private onTimeoutCb: OnTimeoutCallback | null = null;
  private history: HistoryEntry[] = [];

  onTimeout(cb: OnTimeoutCallback): void {
    this.onTimeoutCb = cb;
  }

  getKind(): "clarification" | "confirmation" | "disambiguation" | null {
    return this.pending?.kind ?? null;
  }

  isAwaiting(): boolean {
    return this.pending !== null;
  }

  getTask(): string | null {
    if (!this.pending) return null;
    return "task" in this.pending ? this.pending.task : null;
  }

  getAttempt(): number {
    return this.pending?.kind === "clarification" ? this.pending.attempt : 0;
  }

  getSendAt(): Date | null {
    return this.pending?.kind === "confirmation" ? this.pending.sendAt : null;
  }

  enterClarification(task: string): void {
    this.clear();
    const timeoutId = this.startTimeout(task);
    this.pending = { kind: "clarification", task, attempt: 1, timeoutId };
    logger.info(`Awaiting clarification for: "${task}" (attempt 1)`);
  }

  enterConfirmation(task: string, sendAt: Date): void {
    this.clear();
    const timeoutId = this.startTimeout(task);
    this.pending = { kind: "confirmation", task, sendAt, timeoutId };
    logger.info(`Awaiting confirmation for: "${task}" at ${sendAt.toISOString()}`);
  }

  incrementAttempt(): void {
    if (this.pending?.kind !== "clarification") return;

    clearTimeout(this.pending.timeoutId);
    const task = this.pending.task;
    const attempt = this.pending.attempt + 1;
    const timeoutId = this.startTimeout(task);
    this.pending = { kind: "clarification", task, attempt, timeoutId };
    logger.info(`Clarification attempt ${attempt} for: "${task}"`);
  }

  clear(): void {
    if (this.pending) {
      clearTimeout(this.pending.timeoutId);
      this.pending = null;
    }
  }

  canRetry(): boolean {
    return this.pending?.kind === "clarification"
      && this.pending.attempt < config.maxClarificationAttempts;
  }

  enterDisambiguation(action: "update" | "cancel", candidates: { id: string; task: string; sendAt: string }[], newTimeExpr?: string): void {
    this.clear();
    const timeoutId = this.startTimeout("disambiguation");
    this.pending = { kind: "disambiguation", action, candidates, newTimeExpr, timeoutId };
    logger.info(`Awaiting disambiguation for ${action} (${candidates.length} candidates)`);
  }

  getCandidates(): { id: string; task: string; sendAt: string }[] {
    return this.pending?.kind === "disambiguation" ? this.pending.candidates : [];
  }

  getAction(): "update" | "cancel" | null {
    return this.pending?.kind === "disambiguation" ? this.pending.action : null;
  }

  getNewTimeExpr(): string | undefined {
    return this.pending?.kind === "disambiguation" ? this.pending.newTimeExpr : undefined;
  }

  addMessage(role: "user" | "agent", text: string): void {
    this.history.push({ role, text, timestamp: Date.now() });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  importHistory(json: string): void {
    try {
      const entries: HistoryEntry[] = JSON.parse(json);
      if (Array.isArray(entries)) {
        this.history = entries.slice(-MAX_HISTORY);
        logger.info(`Imported ${this.history.length} history entries.`);
      }
    } catch (err) {
      logger.error("Failed to import history:", err);
    }
  }

  private startTimeout(task: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      logger.info(`State timed out for: "${task}"`);
      this.pending = null;
      this.onTimeoutCb?.();
    }, config.clarificationTimeoutMs);
  }
}
