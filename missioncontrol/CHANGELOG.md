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

## 2026-03-23 — Typed Card Timeline

### What changed

Mission Control card activity is now a **typed narrative timeline** instead of a loose mix of generic comments and lifecycle text.

**Before:** The activity feed stored ad hoc event strings and coarse event types, so stage moves, status changes, run lifecycle, and human/agent conversation blurred together. You could inspect raw history, but it was not strong enough to serve as the card’s primary audit trail.

**After:** The card modal renders a unified typed timeline with explicit system, stage, status, agent, and human row families. Stage/status transitions now render as structured deltas, run/session lifecycle is typed, and legacy entries are normalized into the new schema. The board poll payload stays lean by omitting full activity arrays until the modal asks for them.

### Files changed

| File | What |
|------|------|
| `src/state.ts` | Added typed activity schema, actor/source attribution, legacy normalization, stage/status delta fields, run/session metadata, and `unknown_event` fallback handling |
| `src/server.ts` | Emits typed timeline entries for moves, status changes, run lifecycle, and session linking; keeps `/api/state` summary-sized; returns full activity only on the card-detail activity endpoint |
| `src/ui.ts` | Renders the timeline-first modal view with allowlisted row metadata, day separators, stage/status delta chips, comment emphasis, and demoted session/thread details below the timeline |
| `TIMELINE-DESIGN.md` | Captures the feature-specific design contract for the timeline as the card’s canonical audit trail |

### New / normalized activity model

Mission Control now treats the card timeline as a typed allowlisted stream instead of trusting arbitrary presentation data.

```typescript
ActivityType =
  | 'card_created'
  | 'session_linked'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'stage_changed'
  | 'status_changed'
  | 'agent_comment'
  | 'human_comment'
  | 'agent_question'
  | 'human_reply'
  | 'unknown_event'
```

Legacy persisted entries are normalized forward, including old `created`, `moved`, `skill_*`, `question`, `reply`, and generic `comment` rows.

### New UI behavior

- **Unified timeline-first modal** — the timeline becomes the primary card narrative instead of secondary metadata
- **Newest-first chronology with day separators** — recent operational changes stay easy to scan
- **Stage/status delta chips** — transitions render as before → after state changes instead of prose blobs
- **Clear row-family separation** — system/run rows, stage changes, status changes, agent comments/questions, and human comments/replies each render distinctly
- **Demoted thread/session metadata** — durable session identifiers stay available, but no longer compete with the timeline for attention

### Performance / integrity improvements included

- **Allowlisted rendering path** — the UI maps typed events through internal metadata instead of trusting raw client-controlled row presentation
- **Slim board polling** — `GET /api/state` returns summary cards without full `activity[]`, avoiding timeline bloat on every board refresh
- **On-demand detail fetch** — full activity loads only when the card modal opens

### Scope note

This was shipped with **feature-level** signoff on `feat/missioncontrol`. The working branch still contains broader Mission Control work, so this entry documents the typed-timeline slice specifically rather than serving as blanket branch-level merge approval.

### How it was validated

- Implementation/runtime smoke checks confirmed the server starts, `/` loads, `/api/state` returns summary-sized cards, and API flows produce typed entries like `card_created`, `stage_changed`, `status_changed`, and `human_comment`
- Forged client activity `type` posts were rejected instead of being rendered blindly
- Isolated QA against a disposable temp-state Mission Control server verified legacy normalization, typed activity fetches, and compatibility with the newer attention/unread layer
- Final ship validation confirmed the remaining issue was **operational**, not product logic: a stale live board card remained `running` after a timed-out durable QA session, but the current typed-timeline code itself passed verification

## 2026-03-23 — Agent Questions in Card Comments + Reply-to-Resume

### What changed

Mission Control cards can now pause for **human input inside the card itself** and then resume the **same durable OpenClaw session** once Patrick replies.

**Before:** An agent could continue a durable card session across stage moves, but there was no built-in human-in-the-loop pause. If the agent needed input, there was no first-class way to surface the question on the card, collect the answer in the board UI, and continue the exact same thread.

**After:** An agent can POST a question back to Mission Control, which moves the card into an explicit `awaiting_human` state, renders the question visibly on the card/modal, and exposes a **Reply & Resume Agent** action. Patrick’s reply is sent back into the same durable session so the run continues with full thread context intact.

### Files changed

| File | What |
|------|------|
| `src/state.ts` | Added `awaiting_human` status support, expanded typed activity events for question/reply + run lifecycle, tightened normalization/allowlisting, and added explicit status-transition helpers |
| `src/server.ts` | Added `POST /api/cards/:id/question` and `POST /api/cards/:id/reply`, injected `MC_CARD_API_URL` + `MC_AUTH_TOKEN` into spawned agent runs, preserved `awaiting_human` across process exit, and resumed the same durable session after a human reply |
| `src/ui.ts` | Added visible question state on the card tile, modal question block, dedicated **Reply & Resume Agent** CTA, awaiting-human styling, and locked generic Attention controls while a reply-to-resume block is active |

### New API behavior

| Endpoint | Behavior |
|----------|----------|
| `POST /api/cards/:id/question` | Records an agent-authored question, sets `attentionReason`, and transitions the card into `awaiting_human` |
| `POST /api/cards/:id/reply` | Records the human reply, clears the blocked state, and resumes the same durable OpenClaw session/thread |
| `POST /api/cards/:id/activity` | Now rejects client-supplied `type` / `actor` and only accepts plain human comments, closing the forged-activity / XSS path |
| `GET /api/state` | Continues returning card summaries without full activity payloads, while the modal fetches detailed typed activity on demand |

### New UI behavior

- **Awaiting Human** card status and visual treatment
- **Visible agent question preview** on blocked cards
- **Dedicated reply box in the modal** instead of overloading generic comments
- **Reply & Resume Agent** CTA that resumes the same durable thread
- **Attention-control lockout** while a reply-to-resume question is active, so the blocked state cannot be hidden accidentally

### Internal env / runtime behavior

No new deployer-managed environment variables are required for this feature.

Mission Control now injects these **internal** env vars into spawned agent runs so they can call back into the board safely:

| Variable | Set by | Purpose |
|----------|--------|---------|
| `MC_CARD_API_URL` | Mission Control server | Fully resolved callback URL for the current card |
| `MC_AUTH_TOKEN` | Mission Control server | Bearer token for authenticated card callback requests |

### Security / integrity fixes included in the feature

- Closed the authenticated forged-activity / CSS-class injection path by allowlisting activity types and refusing client-supplied activity presentation metadata
- Prevented reply-flow state corruption by validating/applying saved model overrides **before** clearing `awaiting_human`
- Locked manual Attention controls while a card is actively waiting on a human reply so the reply UI cannot be hidden without resolving the block

### Scope note

This was shipped at the **feature** level on the broader Mission Control working branch. The release notes here cover the human-in-the-loop reply-to-resume slice specifically, not blanket branch-level signoff for every other Mission Control change that happened to coexist on the branch.

### How it was validated

- Final Code Review confirmed the reply-to-resume implementation and enum/UI coverage were complete with no remaining blocking issues
- QA passed with an isolated end-to-end smoke harness using a temp Mission Control state dir and a fake `openclaw` binary
- The smoke flow verified: stage move → durable run → agent `POST /question` → card enters `awaiting_human` → Patrick reply in UI/API → same session resumes → card reaches `complete`
- Ship approved for the feature scope after the final blocked-state and model-override edge cases were fixed
