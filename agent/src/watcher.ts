/**
 * Watcher module — listens for inbound iMessages and dispatches them
 * through the rule-first pipeline.
 *
 * The watcher observes the user's own chat (self-text paradigm),
 * filtering for `isFromMe` messages, and delegates all processing
 * to the dispatcher.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IMessageSDK, Message } from '@photon-ai/imessage-kit';
import { dispatch, type DispatcherDeps } from './dispatcher.js';

/** Configuration for the watcher. */
export interface WatcherConfig {
  supabase: SupabaseClient;
  imessage: IMessageSDK;
  userId: string;
  userTimezone: string;
  chatId: string;
  /** Optional LLM fallback function. */
  llmParse?: (text: string) => Promise<string | null>;
}

/**
 * Prefix all outbound agent messages with [PT] and send to the chat.
 */
function agentSend(imessage: IMessageSDK, chatId: string) {
  return async (text: string): Promise<void> => {
    await imessage.send(chatId, `[PT] ${text}`);
  };
}

/**
 * Start watching for inbound messages and dispatching them.
 *
 * Each new message is sent through the dispatcher pipeline.
 * Returns a cleanup function to stop watching.
 */
export async function startWatcher(config: WatcherConfig): Promise<() => void> {
  const sendMessage = agentSend(config.imessage, config.chatId);

  const deps: DispatcherDeps = {
    supabase: config.supabase,
    sendMessage,
    userId: config.userId,
    userTimezone: config.userTimezone,
    chatKey: config.chatId,
    llmParse: config.llmParse,
  };

  const onNewMessage = async (message: Message) => {
    // Only process messages from the user (self-text paradigm)
    if (!message.isFromMe) return;
    if (!message.text) return;

    try {
      await dispatch(message.text, deps);
    } catch (err) {
      console.error('[Watcher] Dispatch error:', err);
    }
  };

  // Start the watcher with the iMessage SDK event system
  await config.imessage.startWatching({ onNewMessage });

  // Return cleanup function
  return () => {
    config.imessage.stopWatching();
  };
}
