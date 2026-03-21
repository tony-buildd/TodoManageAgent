import { describe, it, expect, vi } from 'vitest';
import { createMockSupabaseClient } from './helpers.js';
import {
  respondTaskCreated,
  respondTaskUpdated,
  type ResponderDeps,
} from '../responder.js';

function makeResponderDeps(overrides?: Partial<ResponderDeps>) {
  const { client } = createMockSupabaseClient();
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const deps: ResponderDeps = {
    supabase: client,
    sendMessage,
    userId: 'user-1',
    userTimezone: 'America/Los_Angeles',
    ...overrides,
  };
  return { ...deps, sendMessage };
}

describe('responder - timezone formatting in messages', () => {
  it('respondTaskCreated formats time in user timezone (America/Los_Angeles)', async () => {
    const deps = makeResponderDeps({ userTimezone: 'America/Los_Angeles' });
    // 2025-03-21T03:50:00.000Z = 8:50 PM PDT, 3:50 AM UTC
    await respondTaskCreated(deps, 'get food', '2025-03-21T03:50:00.000Z');

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('8:50 PM');
    expect(msg).not.toContain('3:50 AM');
  });

  it('respondTaskCreated formats time in a different timezone (America/New_York)', async () => {
    const deps = makeResponderDeps({ userTimezone: 'America/New_York' });
    // 2025-03-21T03:50:00.000Z = 11:50 PM EDT
    await respondTaskCreated(deps, 'get food', '2025-03-21T03:50:00.000Z');

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('11:50 PM');
    expect(msg).not.toContain('3:50 AM');
  });

  it('respondTaskUpdated formats time and date in user timezone', async () => {
    const deps = makeResponderDeps({ userTimezone: 'America/Los_Angeles' });
    // 2025-03-21T03:50:00.000Z = 8:50 PM PDT, Thu Mar 20 (PDT date)
    await respondTaskUpdated(deps, 'get food', '2025-03-21T03:50:00.000Z');

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('8:50 PM');
    expect(msg).not.toContain('3:50 AM');
    // Date should be in PDT timezone (March 20, not March 21)
    expect(msg).toContain('Mar 20');
  });

  it('respondTaskUpdated formats date correctly in America/New_York', async () => {
    const deps = makeResponderDeps({ userTimezone: 'America/New_York' });
    // 2025-03-21T03:50:00.000Z = 11:50 PM EDT on March 20
    await respondTaskUpdated(deps, 'buy milk', '2025-03-21T03:50:00.000Z');

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('11:50 PM');
    // In EDT, March 21 03:50 UTC = March 20 11:50 PM
    expect(msg).toContain('Mar 20');
  });

  it('respondTaskCreated without dueAt asks for time without timezone issues', async () => {
    const deps = makeResponderDeps({ userTimezone: 'America/Los_Angeles' });
    await respondTaskCreated(deps, 'get food', null);

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('get food');
    expect(msg).toContain('When should I remind you');
  });

  it('respondTaskUpdated uses Europe/London timezone correctly', async () => {
    const deps = makeResponderDeps({ userTimezone: 'Europe/London' });
    // 2025-03-21T03:50:00.000Z = 3:50 AM GMT (no DST in March 21 UTC)
    // Actually March 30 2025 is when DST starts in UK. So March 21 is still GMT = UTC
    await respondTaskUpdated(deps, 'morning jog', '2025-03-21T03:50:00.000Z');

    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const msg = deps.sendMessage.mock.calls[0][0] as string;
    // In Europe/London (GMT), 03:50 UTC = 3:50 AM
    expect(msg).toContain('3:50 AM');
    expect(msg).toContain('Mar 21');
  });
});
