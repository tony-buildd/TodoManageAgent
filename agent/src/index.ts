import 'dotenv/config';
import { IMessageSDK } from '@photon-ai/imessage-kit';
import { createClient } from '@supabase/supabase-js';
import { Ollama } from 'ollama';

import { startWatcher } from './watcher.js';
import { startScheduler } from './scheduler.js';
import { getOrCreateUser } from './db.js';

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const ollamaHost  = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const phoneNumber  = process.env.PHONE_NUMBER;
const userTimezone = process.env.DEFAULT_TIMEZONE ?? 'America/Los_Angeles';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}
if (!phoneNumber) {
  console.error('Missing PHONE_NUMBER in .env');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

const supabase = createClient(supabaseUrl, supabaseKey);
const ollama   = new Ollama({ host: ollamaHost });
const imessage = new IMessageSDK({ debug: false, watcher: { excludeOwnMessages: false } });

/* ------------------------------------------------------------------ */
/* Normalise phone to digits-only for chatId matching                  */
/* ------------------------------------------------------------------ */

const phoneDigits = phoneNumber.replace(/\D/g, '');
const chatId      = `+${phoneDigits}`;

/* ------------------------------------------------------------------ */
/* LLM fallback (only called when rule-based dispatcher can't classify)*/
/* ------------------------------------------------------------------ */

async function llmParse(text: string): Promise<string | null> {
  try {
    const response = await ollama.chat({
      model: ollamaModel,
      messages: [
        { role: 'system', content: 'You are a brief assistant. Respond concisely.' },
        { role: 'user', content: text },
      ],
      options: { temperature: 0.7 },
    });
    const reply = response.message?.content?.trim() ?? null;
    return reply;
  } catch (err) {
    console.error('[LLM] Error:', err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log('[PT] Starting Photon Todo Agent...');

  const user = await getOrCreateUser(supabase, phoneNumber);
  console.log(`[PT] User: ${user.phone} (${user.timezone})`);

  /* Helper: send a [PT]-prefixed message via iMessage */
  const sendMessage = async (text: string): Promise<void> => {
    const prefixed = text.startsWith('[PT]') ? text : `[PT] ${text}`;
    await imessage.send({ to: phoneNumber, text: prefixed });
  };

  /* Start the scheduler (30-second tick interval) */
  const stopScheduler = startScheduler({
    supabase,
    sendMessage,
    userId: user.id,
    userTimezone: user.timezone,
  });
  console.log('[PT] Scheduler started (30s interval)');

  /* Start the iMessage watcher */
  const stopWatcher = await startWatcher({
    supabase,
    imessage,
    userId: user.id,
    userTimezone: user.timezone,
    chatId,
    llmParse,
  });
  console.log('[PT] Watcher started — listening for self-text messages');

  /* Graceful shutdown */
  const shutdown = (): void => {
    console.log('\n[PT] Shutting down...');
    stopScheduler();
    stopWatcher();
    imessage.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[PT] Fatal error:', err);
  process.exit(1);
});
