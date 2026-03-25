const PHONE_NUMBER = process.env.PHONE_NUMBER;
if (!PHONE_NUMBER) {
  console.error("PHONE_NUMBER environment variable is required (e.g. +1234567890)");
  process.exit(1);
}

export const config = {
  phoneNumber: PHONE_NUMBER,
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2:3b",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  agentMarker: "[todo-agent]",
  clarificationTimeoutMs: 5 * 60 * 1000,
  maxClarificationAttempts: 2,
  watcherPollInterval: 2000,
  persistencePath: "reminders.json",
  historyPath: "history.json",
} as const;
