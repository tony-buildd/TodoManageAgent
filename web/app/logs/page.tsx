'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { MessageLog } from '@/lib/types';
import { getSupabaseClient } from '@/lib/supabase';

/** Polling interval in milliseconds (10 seconds). */
const POLL_INTERVAL_MS = 10_000;

/**
 * Format a created_at timestamp for display.
 * Shows time in the user's local timezone.
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);

  if (isNaN(date.getTime())) {
    return isoString;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function LogsPage() {
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async (isInitial: boolean = false) => {
    try {
      if (isInitial) {
        setLoading(true);
      }
      setError(null);

      const supabase = getSupabaseClient();

      const { data, error: fetchError } = await supabase
        .from('message_logs')
        .select('*')
        .order('created_at', { ascending: true });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const typedMessages = (data ?? []) as MessageLog[];
      setMessages(typedMessages);
      setLastRefreshed(new Date());
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load messages. Please try again.';
      setError(errorMessage);
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchMessages(true);
  }, [fetchMessages]);

  // Polling: refetch every POLL_INTERVAL_MS while isPolling is true
  useEffect(() => {
    if (!isPolling) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      fetchMessages(false);
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPolling, fetchMessages]);

  const handleManualRefresh = () => {
    fetchMessages(false);
  };

  const togglePolling = () => {
    setIsPolling((prev) => !prev);
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Messages</h2>
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-400 text-sm">Loading messages...</div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error && messages.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Messages</h2>
        <div
          className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm"
          data-testid="error-message"
        >
          <p className="font-medium">Failed to load messages</p>
          <p className="mt-1">{error}</p>
          <button
            onClick={() => fetchMessages(true)}
            className="mt-3 inline-flex items-center rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <div>
      {/* Header with refresh controls */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Messages</h2>
        <div className="flex items-center gap-3">
          {/* Polling indicator + toggle */}
          <button
            onClick={togglePolling}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isPolling
                ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
            }`}
            title={isPolling ? 'Auto-refresh is on (every 10s)' : 'Auto-refresh is off'}
            data-testid="polling-toggle"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            {isPolling ? 'Live' : 'Paused'}
          </button>

          {/* Manual refresh button */}
          <button
            onClick={handleManualRefresh}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
            data-testid="refresh-button"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Inline error banner (when we have stale data but fetch failed) */}
      {error && messages.length > 0 && (
        <div
          className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm mb-4"
          data-testid="error-banner"
        >
          <p>
            <span className="font-medium">Refresh failed:</span> {error}
          </p>
        </div>
      )}

      {/* Last refreshed timestamp */}
      {lastRefreshed && (
        <p className="text-xs text-gray-400 mb-4" data-testid="last-refreshed">
          Last updated: {lastRefreshed.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })}
        </p>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div
          className="text-center py-12 rounded-lg border border-dashed border-gray-300 bg-white"
          data-testid="empty-state"
        >
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="mt-4 text-gray-500 text-lg">No messages yet</p>
          <p className="mt-1 text-gray-400 text-sm">
            Messages will appear here as the agent processes conversations
          </p>
        </div>
      )}

      {/* Message list */}
      {!isEmpty && (
        <div className="space-y-3" data-testid="message-list">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble component
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: MessageLog;
}

/**
 * Renders a single message with direction-based styling.
 *
 * Inbound (user) messages: blue, aligned left
 * Outbound (agent) messages: green, aligned right
 */
function MessageBubble({ message }: MessageBubbleProps) {
  const isInbound = message.direction === 'inbound';

  const alignmentClass = isInbound ? 'justify-start' : 'justify-end';

  const bubbleClass = isInbound
    ? 'bg-blue-50 border-blue-200 text-blue-900'
    : 'bg-green-50 border-green-200 text-green-900';

  const labelClass = isInbound ? 'text-blue-600' : 'text-green-600';

  const directionLabel = isInbound ? 'User' : 'Agent';

  return (
    <div
      className={`flex ${alignmentClass}`}
      data-testid="message-bubble"
      data-direction={message.direction}
    >
      <div className={`max-w-[75%] rounded-lg border p-3 ${bubbleClass}`}>
        {/* Direction label and timestamp */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold ${labelClass}`}>
            {directionLabel}
          </span>
          <span className="text-xs text-gray-400">
            {formatTimestamp(message.created_at)}
          </span>
        </div>

        {/* Message text */}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.raw_message}
        </p>
      </div>
    </div>
  );
}
