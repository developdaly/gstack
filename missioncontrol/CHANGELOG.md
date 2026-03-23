# Mission Control — Changelog

## 2026-03-22 — Durable OpenClaw Sessions

### What changed

Mission Control cards now bind to **durable OpenClaw sessions** instead of firing opaque one-off webhook executions.

**Before:** Dragging a card into a skill-backed stage sent a webhook to the OpenClaw gateway. Each stage move was independent — no shared context, no resumability, no visibility into whether runs finished or what happened.

**After:** Each card gets a persistent OpenClaw session the first time it enters a skill-backed stage. Every subsequent stage move **resumes that same session** via `openclaw agent --session-id <id>`, preserving conversation history, tool state, and context across the entire workflow.

### Files changed

| File | What |
|------|------|
| `src/server.ts` | Replaced webhook-based `fireWebhook()` with `startCardSessionRun()` that spawns `openclaw agent --session-id ...`, manages active runs via `ACTIVE_RUNS` map, pipes stdout/stderr to card logs, and handles completion/failure lifecycle |
| `src/state.ts` | Added `sessionId`, `sessionKey`, `sessionFile` fields to `Card`; added `ActivityEntry` type and `addActivity()` for structured card timeline; added `normalizeCard()` for safe schema migration of existing cards |
| `src/ui.ts` | Card tiles now show session continuity indicator; modal exposes durable session metadata, "Copy Resume Command" button, and inline activity trail with comment input; modal fields live-refresh during polling |
| `DEPLOY.md` | Replaced `OPENCLAW_WEBHOOK_URL` with `MC_OPENCLAW_AGENT_ID`; updated troubleshooting for session-backed execution |

### New card fields

```typescript
sessionId: string | null;    // UUID of the bound OpenClaw session
sessionKey: string | null;   // Full session key (agent:main:missioncontrol:card:<cardId>)
sessionFile: string | null;  // Path to the JSONL session transcript
activity: ActivityEntry[];   // Structured timeline (created, moved, skill_start, skill_complete, skill_failed, comment)
```

### New environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_OPENCLAW_AGENT_ID` | `main` | Agent whose session store cards bind to |
| `MC_AGENT_TIMEOUT_SECONDS` | `1800` | Timeout for each `openclaw agent` invocation |

### Removed

- `OPENCLAW_WEBHOOK_URL` environment variable
- `fireWebhook()` function
- Duplicate `Card` interface in server.ts (now imported from state.ts)

### New UI features

- **Session indicator on card tiles** — short session ID shown when a card has a bound session
- **Session metadata in modal** — shows sessionId, sessionKey, transcript path
- **Copy Resume Command** — one-click copy of `openclaw agent --session-id <id> --message "Continue where you left off."`
- **Activity trail** — structured timeline with icons for created/moved/skill_start/skill_complete/skill_failed/comment
- **Inline comments** — add comments directly from the card modal
- **Live modal refresh** — read-only fields (status, skill, session, activity) update during polling without reopening the modal

### Bug fixes applied during development

- Fixed UI syntax error caused by single-escaped `\n` inside template literals rendered as JS (must double-escape: `\\n`)
- Fixed stale modal state: status/activity now sync on every poll refresh, not just on open

### Known follow-up

- When a card leaves a skill-backed stage before the run finishes, the cancellation is logged but no matching `skill_cancelled` activity entry is added to the card trail. Track as a post-ship improvement.

### How it was validated

- Smoke-tested with a fake `openclaw` binary to verify session binding and `openclaw agent --session-id ...` invocation without burning model turns
- Eng Review verified implementation correctness and confirmed live `openclaw-agent` child processes
- Design Review approved UX direction with non-blocking polish items
- QA verified the same session persists across 6+ stage hops; isolated and reproduced the cancellation audit gap
- Ship approved with the cancellation gap explicitly marked as non-blocking
