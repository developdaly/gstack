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

## 2026-03-23 — Unread Activity + Needs Patrick Indicators

### What changed

Mission Control cards now expose a **human-attention layer** that is separate from execution status.

**Before:** Card tiles showed run lifecycle only (`idle`, `pending`, `running`, `complete`, `failed`). New agent output, unread human comments, and cards explicitly waiting on Patrick all looked effectively the same unless you opened the modal.

**After:** Each card now returns derived unread/attention state and renders a compact visual treatment on the tile:
- **blue unread-output pulse** when the log advanced since the card was last viewed
- **purple unread-comment count chip** for new human-visible conversation
- **orange `Needs Patrick` pill + border tint** when the card is explicitly waiting on Patrick

This keeps lifecycle and attention separate: the left-side status dot still represents machine state, while unread/action-needed state is layered on top.

### Files changed

| File | What |
|------|------|
| `src/state.ts` | Added persisted read/attention metadata (`lastViewedAt`, `attentionMode`, `attentionReason`, `attentionUpdatedAt`); added `actor` to activity entries; tightened normalization and allowlisted patchable card fields |
| `src/server.ts` | Derives `hasUnreadOutput`, `unreadCommentCount`, and `attentionLevel` server-side; added `POST /api/cards/:id/read`; tightened comment/activity handling so human comments are server-written and activity rendering stays allowlisted |
| `src/ui.ts` | Added title-row unread chips, `Needs Patrick` pill row, Patrick border styling, modal attention controls, and read-on-open / read-during-modal-sync behavior |
| `DESIGN.md` | Locked the approved attention-indicator architecture, precedence rules, copy, styling tokens, accessibility rules, and implementation guardrails |

### New card fields

```typescript
lastViewedAt: string | null;        // Single-user read marker for unread derivation
attentionMode: 'none' | 'waiting_on_patrick';
attentionReason: string | null;     // Optional Patrick-facing reason text (modal only)
attentionUpdatedAt: string | null;
```

### Activity model changes

```typescript
actor: 'system' | 'agent' | 'human';
```

Activity entries are now normalized onto an explicit actor/source model so the UI can distinguish system events from human/agent conversation safely.

### New API behavior

| Endpoint | Behavior |
|----------|----------|
| `GET /api/state` | Returns per-card `derived.logUpdatedAt`, `derived.hasUnreadOutput`, `derived.unreadCommentCount`, and `derived.attentionLevel` |
| `POST /api/cards/:id/read` | Marks a card as read/viewed by setting `lastViewedAt` |
| `PATCH /api/cards/:id` | Allows explicit updates to `attentionMode` / `attentionReason` via allowlisted patch handling |
| `POST /api/cards/:id/activity` | Persists human comments as human-authored entries instead of trusting arbitrary client-supplied activity types |

### New UI features

- **Unread output indicator** — small blue pulse chip on the card title row
- **Unread comment count** — purple count chip capped at `9+`
- **Needs Patrick state** — orange pill + stronger border treatment without overwriting run status
- **Attention controls in modal** — `Normal` vs `Waiting on Patrick`, with optional reason text
- **Read-on-open semantics** — opening the modal clears unread output/comment indicators, but does **not** clear `Needs Patrick`
- **Live-read behavior** — modal polling keeps unread state cleared while the card is open

### Security / integrity fixes included in the feature

- Closed the authenticated forged-activity / XSS sink where arbitrary client-controlled activity types could be persisted and then interpolated into CSS class names
- Removed raw client control over rendered activity presentation; UI now maps activity to allowlisted visual metadata

### Scope note

This feature shipped with **feature-level** ship signoff on `feat/missioncontrol`. The working branch still contained broader Mission Control work beyond this card, so this docs entry records the shipped attention-indicator slice specifically — not blanket branch-level merge signoff for every bundled change.

### How it was validated

- Code Review confirmed the missing attention-indicator implementation landed and the forged-activity/XSS hole was closed
- QA validated unread output clearing on modal open, unread comment counts, `Needs Patrick` precedence, read semantics, and state persistence across stage moves
- Ship approved for the feature scope with the branch-level caveat preserved

## 2026-03-23 — Card-Level Model Selector

### What changed

Mission Control cards can now carry an optional **card-level runtime model override** for future runs on the same durable OpenClaw session.

**Before:** All stage runs implicitly used the agent default model. There was no card-local way to say “use this other configured model for future work on this thread,” and no safe UI for unavailable or invalid saved overrides.

**After:** Each card may store a nullable canonical `modelRef` (`provider/model`). The modal exposes a single **Model** control sourced from the configured OpenClaw model catalog, and future stage runs apply that override to the bound durable session without resetting thread history.

### Files changed

| File | What |
|------|------|
| `src/state.ts` | Added nullable `modelRef` to card state and safe normalization for existing cards |
| `src/server.ts` | Added model-catalog loading, `GET /api/models`, model validation, unavailable-model decoration, and durable-session override application/clearing |
| `src/ui.ts` | Added modal model picker, default/unavailable helper states, card badge rendering for explicit overrides, and inline field-level save errors |
| `MODEL-SELECTOR-DESIGN.md` | Locked the approved modal/card design, warning states, copy, badge rules, and error-handling behavior |

### New card field

```typescript
modelRef: string | null;   // Canonical provider/model override; null = use agent default
```

### New API behavior

| Endpoint | Behavior |
|----------|----------|
| `GET /api/models` | Returns the configured Mission Control/OpenClaw model catalog plus the effective default model |
| `PATCH /api/cards/:id` | Accepts `modelRef`; rejects invalid/disallowed refs explicitly and normalizes default-model selection back to `null` |
| Session-store update path | Applies/clears `providerOverride` + `modelOverride` on the bound durable session so future runs reuse the same thread with the chosen model |

### New UI features

- **Single Model picker in the modal** — no split provider/model controls
- **`Use default model`** option at the top of the catalog
- **Card badge for explicit overrides only** — default cards remain visually quiet
- **`Model unavailable` warning state** when a saved canonical ref drops out of the configured catalog
- **Inline save errors** via `#modal-model-error` instead of browser `alert()`

### Behavior notes

- Invalid/disallowed/unavailable refs fail explicitly; there is **no silent fallback**
- Choosing a model affects **future runs on the same durable thread**; it does not reset session history
- Clearing back to default removes the session overrides and the tile badge
- Unavailable saved refs are preserved visibly so they can be fixed instead of disappearing silently

### Scope note

Like the attention-indicator card, this was shipped at the **feature** level on a broader working branch. The docs here capture the model-selector slice specifically and preserve the same caveat: not every other bundled Mission Control change on `feat/missioncontrol` was implicitly part of the ship decision.

### How it was validated

- Code Review caught the last functional gap (`saveCardEdits()` not including `modelRef`) before QA
- QA validated valid/invalid/clear PATCH behavior, unavailable saved refs, durable-session override persistence, and live served UI wiring
- Final implementation fix replaced alert-based save failures with inline field errors and was verified in served HTML after restarting Mission Control
- Ship approved for the feature scope with the branch-level caveat preserved
