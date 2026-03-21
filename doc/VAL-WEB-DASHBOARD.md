# Web Dashboard Validation Assertions

> Exhaustive behavioral contract for the Photon Todo web dashboard.
> Each assertion has a stable ID, title, behavioral description with pass/fail condition, and evidence requirements.

---

## 1. Home Page (`VAL-HOME-*`)

### VAL-HOME-001 — Not Confirmed tasks shown first

**Behavior:** When the home page loads and there exist tasks with status `not_confirmed`, those tasks MUST appear in a visually distinct priority section above all other task groups. The section must be rendered before overdue-active and today's tasks in DOM order.

**Pass condition:** Given ≥1 `not_confirmed` task and ≥1 `pending` task due today, the `not_confirmed` task appears above the pending task in the rendered list.

**Fail condition:** `not_confirmed` tasks are interleaved with or appear below other statuses without priority grouping.

**Evidence:** Screenshot of home page with at least one `not_confirmed` task and one `pending` task present; DOM snapshot confirming render order.

---

### VAL-HOME-002 — Overdue active tasks shown second

**Behavior:** Tasks that are `in_progress` (reminder sent) with `due_at` in the past but within the 15-minute grace window MUST appear in a second priority group, after `not_confirmed` but before today's normal tasks.

**Pass condition:** An `in_progress` task whose `due_at` is 5 minutes in the past and grace window has not elapsed appears after `not_confirmed` but before non-overdue tasks.

**Fail condition:** Overdue active tasks are mixed into the general today list without priority elevation.

**Evidence:** Screenshot with at least one overdue-active task and one non-overdue task; console log or network response showing the `due_at` and `status` values used.

---

### VAL-HOME-003 — Today's tasks sorted by due time ascending

**Behavior:** After priority groups (not_confirmed, overdue-active), the remaining today's tasks MUST be sorted by `due_at` ascending (earliest due first). Tasks without a `due_at` appear at the end.

**Pass condition:** Given three tasks due today at 9:00 AM, 12:00 PM, and 5:00 PM, they render in that exact order.

**Fail condition:** Tasks appear in creation order, reverse chronological, or any order other than ascending `due_at`.

**Evidence:** Screenshot showing ≥3 today tasks with visible due times in ascending order; network response payload confirming `due_at` values.

---

### VAL-HOME-004 — Stat cards reflect real data counts

**Behavior:** The home page MUST display stat cards for at least: Pending count, In Progress count, Done Today count, and Total Tasks count. Each count MUST match the actual count of todos in the database with the corresponding status. "Done Today" counts only tasks with `completed_at` on the current calendar day.

**Pass condition:** With known database state (e.g., 3 pending, 2 in_progress, 1 done today, 10 total), all four stat cards display those exact numbers.

**Fail condition:** Any stat card shows a count that differs from the actual database state by ≥1, or a stat card references a legacy status name (e.g., "Reminded" instead of "In Progress").

**Evidence:** Screenshot of stat cards; Supabase query result (or network response) showing actual counts for comparison.

---

### VAL-HOME-005 — Stat card labels match spec status model

**Behavior:** Stat card labels MUST use the spec status terminology: "Pending", "In Progress", "Done Today", "Total Tasks" (or "Not Confirmed" if surfaced). Legacy labels such as "Reminded" or "Archived" MUST NOT appear.

**Pass condition:** All rendered stat card labels match the spec status model vocabulary.

**Fail condition:** Any card uses the word "Reminded" or "Archived".

**Evidence:** Screenshot of stat card area; DOM text content extraction.

---

### VAL-HOME-006 — Empty state when no tasks exist

**Behavior:** When the database contains zero todos, the home page MUST display all stat cards with value `0` and a friendly empty-state message in the task list area (e.g., "No upcoming tasks").

**Pass condition:** Stat cards all show `0`; an empty-state placeholder message is visible; no error, no blank white space, no spinner that never resolves.

**Fail condition:** Page shows an error, crashes, or renders an empty container with no user guidance.

**Evidence:** Screenshot with zero tasks; console output confirming no errors.

---

### VAL-HOME-007 — Loading state renders gracefully

**Behavior:** While the initial data fetch is in progress, the home page MUST either show skeleton placeholders or a non-intrusive loading indicator. It MUST NOT flash stale data then replace it, and MUST NOT show raw error text during normal loading.

**Pass condition:** On first load (cold cache), a loading/skeleton state is visible before data appears.

**Fail condition:** Page shows `undefined`, `NaN`, or an error while data is loading.

**Evidence:** Screenshot captured during loading phase (throttled network); console errors during load.

---

### VAL-HOME-008 — Supabase fetch failure shows error state

**Behavior:** If the Supabase fetch for home page data fails (network error, auth error), the page MUST display a user-friendly error message rather than silently swallowing the failure or showing broken UI.

**Pass condition:** With Supabase intentionally unreachable, an error message is displayed to the user.

**Fail condition:** Page silently shows `0` for all stats and empty task list with no error indication, OR page crashes with an unhandled exception.

**Evidence:** Screenshot with Supabase unreachable; console error logs captured; network tab showing failed request.

---

### VAL-HOME-009 — Not Confirmed section uses attention-grabbing visual treatment

**Behavior:** The priority section for `not_confirmed` tasks MUST have a visually distinct treatment (e.g., colored border, background highlight, or alert icon) that differentiates it from the normal task list.

**Pass condition:** A user unfamiliar with the app can identify the `not_confirmed` section as urgent/different within 2 seconds of looking at the page.

**Fail condition:** `not_confirmed` tasks look identical to regular tasks with no visual emphasis.

**Evidence:** Screenshot; CSS computed styles on the not_confirmed section container.

---

### VAL-HOME-010 — Home page limits displayed tasks reasonably

**Behavior:** The home page SHOULD limit the number of displayed tasks (e.g., top 5–10) and provide a link or navigation to the full Todos page for overflow.

**Pass condition:** With 20+ active tasks, the home page displays a bounded subset and offers a way to see all.

**Fail condition:** Home page renders all 20+ tasks creating an excessively long page with no truncation or navigation hint.

**Evidence:** Screenshot with >10 active tasks; DOM count of rendered task cards.

---

## 2. Todos Page (`VAL-TODO-*`)

### VAL-TODO-001 — Status filtering: pending

**Behavior:** Clicking the "Pending" filter tab MUST show only tasks with status `pending`. All other statuses MUST be hidden.

**Pass condition:** With tasks in multiple statuses, activating the Pending filter shows only pending tasks. Count badge matches the visible count.

**Fail condition:** Tasks of other statuses remain visible, or the count badge is wrong.

**Evidence:** Screenshot before and after filter activation; DOM content of rendered cards.

---

### VAL-TODO-002 — Status filtering: in_progress

**Behavior:** A filter tab for "In Progress" MUST exist and show only tasks with status `in_progress` when activated.

**Pass condition:** Filter tab labeled "In Progress" is present and functional.

**Fail condition:** No "In Progress" tab exists, or the tab is labeled "Reminded" (legacy term).

**Evidence:** Screenshot of filter tabs; screenshot after activating In Progress filter.

---

### VAL-TODO-003 — Status filtering: done

**Behavior:** Clicking the "Done" filter tab MUST show only tasks with status `done`.

**Pass condition:** Only done tasks visible; count matches.

**Fail condition:** Non-done tasks leak through, or count is wrong.

**Evidence:** Screenshot with Done filter active.

---

### VAL-TODO-004 — Status filtering: not_confirmed

**Behavior:** A filter tab for "Not Confirmed" MUST exist and show only tasks with status `not_confirmed`.

**Pass condition:** Tab is present, functional, and correctly filters.

**Fail condition:** No "Not Confirmed" tab exists, or filtering is broken.

**Evidence:** Screenshot of filter tabs; screenshot after activating Not Confirmed filter.

---

### VAL-TODO-005 — Status filtering: canceled

**Behavior:** A filter tab for "Canceled" MUST exist and show only tasks with status `canceled`. Canceled tasks MUST be visible in history per spec ("Canceled tasks stay visible in history").

**Pass condition:** Tab is present; canceled tasks appear when filter is active.

**Fail condition:** No Canceled tab, or canceled tasks are hidden/deleted from the UI entirely.

**Evidence:** Screenshot with Canceled filter active showing ≥1 canceled task.

---

### VAL-TODO-006 — "All" filter shows all statuses

**Behavior:** The "All" filter tab MUST show tasks of every status including `canceled` and `not_confirmed`.

**Pass condition:** With tasks in all 5 statuses, All tab shows all of them.

**Fail condition:** Any status is excluded from the All view.

**Evidence:** Screenshot with All filter; count badge equals total DB count.

---

### VAL-TODO-007 — Today / This Week / All time grouping

**Behavior:** The Todos page MUST support grouping tasks by time period: "Today", "This Week", and "All" (or equivalent). Current week tasks should be visually prominent per spec.

**Pass condition:** Three grouping options are available. Selecting "Today" shows only tasks due today. "This Week" shows tasks due within the current calendar week. "All" shows all tasks.

**Fail condition:** No time-based grouping exists; all tasks are in a flat list with no temporal organization.

**Evidence:** Screenshot of grouping controls; screenshot of each grouping with appropriate tasks.

---

### VAL-TODO-008 — Current week visually prominent

**Behavior:** Per spec: "Keep the current week prominent in the UI." The current week's tasks MUST have a visually emphasized presentation (e.g., default view, larger section, or highlighted header) compared to older tasks.

**Pass condition:** On initial page load, the current week's tasks are the most prominent section.

**Fail condition:** Current week tasks have no visual distinction from tasks from 3 weeks ago.

**Evidence:** Screenshot showing current-week and older tasks side by side.

---

### VAL-TODO-009 — Older tasks searchable

**Behavior:** Per spec: "keep older items searchable." Tasks older than the current week MUST be accessible via search or an "All" time group.

**Pass condition:** A task from 2 weeks ago can be found by typing its name in the search field or by selecting the "All" time group.

**Fail condition:** Old tasks are permanently hidden or inaccessible from the Todos page.

**Evidence:** Screenshot showing search results including an old task.

---

### VAL-TODO-010 — Todo card displays task text

**Behavior:** Each todo card MUST display the task description text prominently.

**Pass condition:** The `task` field content is visible as the primary text on the card.

**Fail condition:** Task text is missing, truncated to illegibility, or replaced by `raw_message`.

**Evidence:** Screenshot of a todo card; DOM text content.

---

### VAL-TODO-011 — Todo card displays due time

**Behavior:** Each todo card MUST display the `due_at` timestamp formatted in a human-readable way (e.g., "Mar 21, 8:50 PM"). If `due_at` is null, a placeholder like "--" is acceptable.

**Pass condition:** Due time is visible on the card in a readable format.

**Fail condition:** Due time is missing, shows raw ISO string, or shows "Invalid Date".

**Evidence:** Screenshot of a todo card with due time visible.

---

### VAL-TODO-012 — Todo card displays status badge

**Behavior:** Each todo card MUST include a status badge component that shows the current status (Pending, In Progress, Done, Not Confirmed, Canceled).

**Pass condition:** Status badge is rendered with correct label matching the task's status.

**Fail condition:** No badge shown, or badge shows wrong status.

**Evidence:** Screenshot of todo cards with different statuses; cross-reference with database status values.

---

### VAL-TODO-013 — Todo card displays created time

**Behavior:** Each todo card SHOULD display when the task was created (`created_at`), either inline or accessible on hover/expand.

**Pass condition:** Created timestamp is visible or accessible on the card.

**Fail condition:** No created time information is available anywhere on the card.

**Evidence:** Screenshot of todo card showing created time.

---

### VAL-TODO-014 — Overdue derived state visually distinct

**Behavior:** Tasks that are `in_progress` with `due_at` in the past (but within the 15-min grace window) MUST be visually distinguished from normal in-progress tasks. This is a derived presentation state, not a stored status.

**Pass condition:** An overdue-active task has a different visual treatment (e.g., red/orange badge variant, warning icon, colored border) compared to a normal in-progress task that is not yet due.

**Fail condition:** Overdue-active task looks identical to a non-overdue in-progress task.

**Evidence:** Side-by-side screenshot of an overdue in-progress task and a non-overdue in-progress task.

---

### VAL-TODO-015 — Canceled tasks visible in history

**Behavior:** Per spec: "Canceled tasks remain visible in history." Canceled tasks MUST appear in the Todos page when the Canceled filter or All filter is active. They MUST NOT be permanently deleted from the UI.

**Pass condition:** A task that was canceled via the web UI or chat is visible on the Todos page.

**Fail condition:** Canceled tasks are removed from the UI entirely.

**Evidence:** Screenshot with canceled task visible under Canceled or All filter.

---

### VAL-TODO-016 — Search filters tasks by text

**Behavior:** The search field MUST filter the visible task list by matching against the `task` field (case-insensitive substring match).

**Pass condition:** Typing "milk" shows only tasks containing "milk" in their task text.

**Fail condition:** Search does not filter, or filters incorrectly.

**Evidence:** Screenshot of search results with a specific query.

---

### VAL-TODO-017 — Empty state for filtered results

**Behavior:** When a filter combination (status + search) yields zero results, a helpful empty-state message MUST be displayed.

**Pass condition:** Filtering to a status with no tasks shows a message like "No tasks match" rather than a blank area.

**Fail condition:** Blank white space with no message when filters return empty.

**Evidence:** Screenshot of empty filtered state.

---

### VAL-TODO-018 — Filter counts reflect current data

**Behavior:** Each filter tab's count badge MUST reflect the actual number of tasks with that status in the current dataset.

**Pass condition:** If there are 3 pending tasks, the Pending tab shows count "3".

**Fail condition:** Counts are stale, always zero, or do not update after mutations.

**Evidence:** Screenshot of filter tabs with visible counts; database query confirming counts.

---

### VAL-TODO-019 — Done tasks show line-through styling

**Behavior:** Tasks with status `done` SHOULD have a visual de-emphasis such as line-through text or reduced opacity to indicate completion.

**Pass condition:** Done tasks are visually distinguishable from active tasks via text decoration or opacity.

**Fail condition:** Done tasks look identical to pending tasks.

**Evidence:** Screenshot showing a done task alongside a pending task.

---

## 3. Manual Controls (`VAL-CTRL-*`)

### VAL-CTRL-001 — Edit task text from web

**Behavior:** The web UI MUST provide a control to edit a task's `task` field text. The user can modify the text and save it.

**Pass condition:** User can click an edit button/icon, modify the task text in an input field, save, and see the updated text reflected on the card.

**Fail condition:** No edit capability exists, or the edit silently fails.

**Evidence:** Screenshot of edit interaction (before, during, after); network request showing the Supabase update call with new task text.

---

### VAL-CTRL-002 — Reschedule due time from web

**Behavior:** The web UI MUST provide a control to change a task's `due_at` timestamp. A date/time picker or input field allows selecting a new due time.

**Pass condition:** User can open a reschedule control, select a new date/time, save, and see the updated due time reflected on the card.

**Fail condition:** No reschedule capability exists, or the picker does not persist the change.

**Evidence:** Screenshot of reschedule interaction; network request showing the Supabase update call with new `due_at`; subsequent page showing updated time.

---

### VAL-CTRL-003 — Cancel task from web

**Behavior:** The web UI MUST provide a control to cancel a task, setting its status to `canceled`. The canceled task remains visible in history per spec.

**Pass condition:** User can click a cancel button, the task status changes to `canceled`, and the task remains visible with a Canceled badge.

**Fail condition:** No cancel button exists, or cancel deletes the task from the database, or cancel sets status to `archived` instead of `canceled`.

**Evidence:** Screenshot before and after cancel; network request showing status update to `canceled`; task visible with Canceled badge afterward.

---

### VAL-CTRL-004 — Mark task done from web

**Behavior:** The web UI MUST provide a control to mark a task as `done`. This sets `status` to `done` and `completed_at` to the current timestamp.

**Pass condition:** User clicks "Mark done", task status changes to `done`, `completed_at` is set, and the card updates to show the Done badge with de-emphasis styling.

**Fail condition:** No mark-done control, or `completed_at` is not set, or status doesn't change.

**Evidence:** Screenshot before and after marking done; network request showing both `status: "done"` and `completed_at` in the payload; database row confirming the update.

---

### VAL-CTRL-005 — Controls update UI immediately

**Behavior:** After a user performs any manual control action (edit, reschedule, cancel, mark done), the UI MUST update to reflect the change without requiring a manual hard refresh (F5). This may be optimistic or via `router.refresh()`.

**Pass condition:** After clicking "Mark done", the task's badge changes to Done within 2 seconds without the user refreshing the browser.

**Fail condition:** The UI remains unchanged until the user manually refreshes the page.

**Evidence:** Screen recording or sequential screenshots showing UI update after action without page refresh; network waterfall showing the mutation request and any subsequent data refetch.

---

### VAL-CTRL-006 — Controls persist to Supabase

**Behavior:** Every manual control action MUST persist the change to the Supabase database. The change MUST survive a full page reload.

**Pass condition:** After marking a task done, refreshing the page still shows the task as done. A direct Supabase query confirms `status = 'done'`.

**Fail condition:** The UI shows the change but a page refresh reverts it (client-only state), or the Supabase update call returns an error that is silently swallowed.

**Evidence:** Network request log showing successful Supabase update (HTTP 200/204); page refresh showing persisted state; optional: direct Supabase query result.

---

### VAL-CTRL-007 — Controls only available for applicable statuses

**Behavior:** Manual controls MUST be contextually appropriate. For example:
- "Mark done" should only appear for `pending`, `in_progress`, or `not_confirmed` tasks (not for already-done or canceled tasks).
- "Cancel" should only appear for non-terminal statuses (`pending`, `in_progress`, `not_confirmed`).
- "Edit" and "Reschedule" should only appear for non-terminal statuses.

**Pass condition:** A `done` task does not show "Mark done" or "Cancel" buttons. A `canceled` task does not show action buttons.

**Fail condition:** All action buttons appear on all tasks regardless of status, including illogical actions like canceling an already-done task.

**Evidence:** Screenshot of a done task card (no action buttons visible); screenshot of a pending task card (all applicable action buttons visible).

---

### VAL-CTRL-008 — Cancel action requires confirmation

**Behavior:** The cancel action SHOULD require a confirmation step (e.g., confirmation dialog or undo toast) to prevent accidental cancellations, since canceled is a terminal state.

**Pass condition:** Clicking "Cancel" shows a confirmation prompt before executing, OR shows an undo toast within a few seconds.

**Fail condition:** Cancel executes immediately on single click with no confirmation or undo mechanism.

**Evidence:** Screenshot of confirmation dialog or undo toast after cancel click.

---

### VAL-CTRL-009 — Edit task handles empty input gracefully

**Behavior:** If a user edits a task and submits empty text, the system MUST either reject the save (with a validation message) or prevent submission.

**Pass condition:** Submitting an empty task name shows a validation error or the save button is disabled.

**Fail condition:** An empty string is saved as the task name, resulting in a blank card.

**Evidence:** Screenshot of validation error on empty submit attempt; network tab confirming no update was sent.

---

### VAL-CTRL-010 — Reschedule validates date input

**Behavior:** The reschedule control MUST validate that the entered date/time is valid and reasonable (e.g., not a date in the far past unless intentional).

**Pass condition:** A clearly invalid date (e.g., empty, "abc") is rejected with a validation message.

**Fail condition:** Invalid date is saved, resulting in "Invalid Date" displayed on the card.

**Evidence:** Screenshot of validation error on invalid date input.

---

### VAL-CTRL-011 — Error feedback on failed mutation

**Behavior:** If a Supabase update call fails (network error, permission error), the UI MUST show an error notification to the user rather than silently failing.

**Pass condition:** With Supabase intentionally returning an error, a user-visible error message appears.

**Fail condition:** The action silently fails; the user sees the UI revert (or not update) with no explanation.

**Evidence:** Screenshot of error notification; console errors; network response showing failure.

---

## 4. Logs Page (`VAL-LOG-*`)

### VAL-LOG-001 — Persisted messages displayed on page load

**Behavior:** The Logs page MUST display all persisted message logs from the database when the page loads, even if the agent ran and produced messages before the user opened the page.

**Pass condition:** After the agent sends/receives messages, opening the Logs page shows those messages immediately (no need to "start" a live connection first).

**Fail condition:** The page shows "No messages" despite messages existing in the `message_logs` table.

**Evidence:** Screenshot of Logs page with messages; Supabase `message_logs` query showing matching rows; network request log showing the fetch call and response data.

---

### VAL-LOG-002 — Inbound messages visually distinguished

**Behavior:** Messages with `direction = 'inbound'` (from user) MUST be visually distinct from outbound messages. This MAY be achieved via directional icons, color coding, alignment, or label (e.g., "User" vs "Agent").

**Pass condition:** A user can immediately tell which messages are from the user and which are from the agent without reading the content.

**Fail condition:** All messages look identical regardless of direction.

**Evidence:** Screenshot showing ≥1 inbound and ≥1 outbound message with visible visual difference.

---

### VAL-LOG-003 — Outbound messages visually distinguished

**Behavior:** Messages with `direction = 'outbound'` (from agent) MUST be visually distinct from inbound messages with a different icon, color, or label (e.g., "Agent").

**Pass condition:** Outbound messages have a clearly different appearance from inbound messages.

**Fail condition:** No visual distinction between inbound and outbound.

**Evidence:** Screenshot showing outbound message with distinct styling.

---

### VAL-LOG-004 — Error states shown, not swallowed

**Behavior:** Per spec: "Do not silently swallow fetch failures." If the Logs page fails to fetch message logs (network error, Supabase down), a visible error message MUST be displayed.

**Pass condition:** With Supabase unreachable, the page shows an error message like "Failed to load messages" rather than an empty state.

**Fail condition:** The page shows "No messages" (indistinguishable from truly empty) or crashes with an unhandled exception when fetch fails.

**Evidence:** Screenshot with fetch failure showing error message; console output; network tab showing failed request.

---

### VAL-LOG-005 — Lightweight auto-refresh for new logs

**Behavior:** Per spec: "Add lightweight refresh behavior so new logs become visible without a hard refresh." The Logs page MUST update to show new messages that arrive after initial page load, without requiring the user to manually refresh (F5). This may be implemented via polling, Supabase realtime subscription, or a manual "Refresh" button.

**Pass condition:** After the page loads, a new message is inserted into `message_logs`. Within a reasonable time (≤30 seconds for polling, near-instant for realtime), the new message appears on the page.

**Fail condition:** New messages only appear after a hard page refresh.

**Evidence:** Sequential screenshots showing: (1) page loaded with N messages, (2) new message inserted into DB, (3) page now shows N+1 messages without manual refresh; network tab showing polling/subscription activity.

---

### VAL-LOG-006 — Message timestamp displayed

**Behavior:** Each message log entry MUST display its `created_at` timestamp in a human-readable format.

**Pass condition:** Timestamps are visible and formatted (e.g., "Mar 21, 8:50 PM"), not raw ISO strings.

**Fail condition:** No timestamp shown, or timestamp shows "Invalid Date" or raw ISO.

**Evidence:** Screenshot of log entries with visible timestamps.

---

### VAL-LOG-007 — Message content displayed in full

**Behavior:** Each message log entry MUST display the full `content` field. Long messages may be truncated with an expand control, but the full content MUST be accessible.

**Pass condition:** A message with 200 characters is fully readable (inline or via expand).

**Fail condition:** Message content is cut off at a short limit with no way to see the rest.

**Evidence:** Screenshot of a long message fully visible or with expand control.

---

### VAL-LOG-008 — Messages ordered reverse-chronologically

**Behavior:** Messages MUST be displayed in reverse chronological order (newest first) or chronological order (oldest first) — but the ordering must be consistent and intentional.

**Pass condition:** Messages are in a consistent, logical time order.

**Fail condition:** Messages appear in random or inconsistent order.

**Evidence:** Screenshot showing ≥3 messages with timestamps in consistent order.

---

### VAL-LOG-009 — Empty state when no logs exist

**Behavior:** When the `message_logs` table is empty, the Logs page MUST display a friendly empty-state message.

**Pass condition:** With zero message logs, a message like "No messages yet" is displayed.

**Fail condition:** Blank page with no guidance, or an error.

**Evidence:** Screenshot of empty Logs page.

---

### VAL-LOG-010 — Sender identification on inbound messages

**Behavior:** Inbound messages SHOULD display the sender's identifier (phone number or name from the `users` table) so the user knows who the message is from.

**Pass condition:** Inbound messages show a user identifier (e.g., "User" or phone number).

**Fail condition:** Inbound messages show no sender info or show "undefined".

**Evidence:** Screenshot of inbound message with sender label visible.

---

### VAL-LOG-011 — Large log volume handled gracefully

**Behavior:** With a large number of logs (200+), the page MUST remain performant and not freeze. Pagination or virtual scrolling is acceptable.

**Pass condition:** With 200 logs loaded (current limit), the page scrolls smoothly and is responsive.

**Fail condition:** Page becomes unresponsive or takes >5 seconds to render.

**Evidence:** Performance measurement (e.g., Lighthouse or manual timing); screenshot showing all logs rendered.

---

## 5. Status Badges (`VAL-BADGE-*`)

### VAL-BADGE-001 — Pending badge with correct color

**Behavior:** The `pending` status badge MUST render with the label "Pending" and an amber/yellow color scheme.

**Pass condition:** Badge text is "Pending"; background and text colors are in the amber spectrum (e.g., `bg-amber-50 text-amber-700`).

**Fail condition:** Wrong label, wrong color, or badge not rendered.

**Evidence:** Screenshot of a pending task's badge; computed CSS color values.

---

### VAL-BADGE-002 — In Progress badge

**Behavior:** The `in_progress` status badge MUST render with the label "In Progress" and a blue color scheme. The legacy label "Reminded" MUST NOT be used.

**Pass condition:** Badge text is "In Progress" with blue styling.

**Fail condition:** Badge says "Reminded", or no badge exists for `in_progress` status, or the component throws an error for this status value.

**Evidence:** Screenshot of an in-progress task's badge; DOM text content; StatusBadge component source confirming `in_progress` key.

---

### VAL-BADGE-003 — Done badge

**Behavior:** The `done` status badge MUST render with the label "Done" and a green/emerald color scheme.

**Pass condition:** Badge text is "Done" with emerald/green styling.

**Fail condition:** Wrong label or color.

**Evidence:** Screenshot of a done task's badge; computed CSS values.

---

### VAL-BADGE-004 — Not Confirmed badge (distinct and attention-grabbing)

**Behavior:** The `not_confirmed` status badge MUST render with the label "Not Confirmed" and a visually attention-grabbing color scheme (e.g., red, orange, or high-contrast). Per spec, this is an urgent state that should be visually prioritized.

**Pass condition:** Badge text is "Not Confirmed" with a color that conveys urgency (warm/alert tones, not muted or neutral).

**Fail condition:** No badge exists for `not_confirmed` (component crashes or returns null), or badge uses a muted/neutral color indistinguishable from other badges.

**Evidence:** Screenshot of a not_confirmed task's badge; computed CSS showing alert-level color values; comparison with other badge colors.

---

### VAL-BADGE-005 — Canceled badge

**Behavior:** The `canceled` status badge MUST render with the label "Canceled" and a muted/neutral color scheme (e.g., gray/stone).

**Pass condition:** Badge text is "Canceled" with muted styling.

**Fail condition:** No badge for `canceled` status, or badge uses the legacy "Archived" label.

**Evidence:** Screenshot of a canceled task's badge.

---

### VAL-BADGE-006 — Overdue active derived badge

**Behavior:** When a task is `in_progress` and `due_at` is in the past (but within the 15-minute grace period), a derived "Overdue" indicator MUST be shown. This may be a separate badge, an additional label, or a color modification of the In Progress badge (e.g., turning it red/orange).

**Pass condition:** An overdue in-progress task displays a visual indicator that is different from a non-overdue in-progress task.

**Fail condition:** Overdue in-progress tasks show the exact same badge as non-overdue in-progress tasks with no additional indicator.

**Evidence:** Side-by-side screenshots of overdue vs non-overdue in-progress tasks; DOM/CSS differences.

---

### VAL-BADGE-007 — Unknown status handled gracefully

**Behavior:** If the `StatusBadge` component receives an unrecognized status value (e.g., a legacy status or future status), it MUST NOT crash. It should render a fallback badge or display the raw status string.

**Pass condition:** Passing an unknown status string to `StatusBadge` renders something (even "Unknown") without a React error boundary or blank space.

**Fail condition:** Component throws an error, crashes the page, or renders nothing.

**Evidence:** Manual test or unit test passing an unknown status; screenshot or console output.

---

### VAL-BADGE-008 — Badge color accessibility

**Behavior:** All status badge color combinations MUST meet WCAG 2.1 AA contrast requirements (minimum 4.5:1 for normal text) to ensure readability.

**Pass condition:** All badge text/background color pairs have a contrast ratio ≥ 4.5:1.

**Fail condition:** Any badge has a contrast ratio below 4.5:1.

**Evidence:** Computed contrast ratios for each badge color pair (tools: axe-core, Lighthouse, or manual calculation).

---

### VAL-BADGE-009 — All five spec statuses have badge configurations

**Behavior:** The `StatusBadge` component's configuration MUST include entries for all five spec statuses: `pending`, `in_progress`, `done`, `not_confirmed`, `canceled`. No legacy-only statuses (`reminded`, `archived`) should be the sole entries.

**Pass condition:** Source code or runtime inspection confirms all five status keys are mapped.

**Fail condition:** Any of the five spec statuses is missing from the configuration, causing a crash or blank badge.

**Evidence:** Source code of `status-badge.tsx` showing all five keys in `statusConfig`; runtime test rendering each status.

---
