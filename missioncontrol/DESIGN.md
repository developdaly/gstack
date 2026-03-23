# Mission Control Attention Indicators — Design + Engineering Plan

## Goal
Cards should answer two questions at a glance:
1. **Did something new happen?**
2. **Does Patrick need to act?**

The board already has execution status (`idle`, `pending`, `running`, `complete`, `failed`). This feature should **not** replace that lifecycle. It should add a second, orthogonal layer for **unread activity** and **human attention**.

## Product Requirement
Show clear visual indicators when a card has:
- new agent output
- unread comments
- a pending human decision

And make the indicator **stronger when the card is specifically waiting on Patrick**.

---

## Eng Review Verdict
**Recommendation: keep execution state and attention state separate.**

Do **not** overload `card.status` with values like `awaiting_human` or `needs_review` in this iteration. That blurs process lifecycle with UX attention, complicates existing auto-transitions, and makes server-side run handling more fragile.

Instead:
- keep `status` as the machine/run lifecycle
- add small persisted metadata for read state + human-attention intent
- derive unread indicators server-side from timestamps and activity

This is the smallest change that cleanly satisfies the card.

---

## Current Architecture Snapshot
Mission Control already has:
- durable per-card OpenClaw sessions
- per-card activity trail
- per-card log file
- polling UI with modal sync
- card tile status dot for execution state

What is missing:
- no notion of **last read / last viewed**
- no distinction between **machine status** and **human attention**
- no safe derived model for **new log output**
- no explicit way to mark a card as **waiting on Patrick**

---

## Proposed State Model

### Persisted card fields
Add these to `Card` in `src/state.ts`:

```ts
type AttentionMode = 'none' | 'waiting_on_patrick';

interface Card {
  // existing fields...
  lastViewedAt: string | null;
  attentionMode: AttentionMode;
  attentionReason: string | null;
  attentionUpdatedAt: string | null;
}
```

### Activity entry metadata
Add an actor/source field so comments and system events can be rendered safely and filtered correctly:

```ts
type ActivityActor = 'system' | 'agent' | 'human';

interface ActivityEntry {
  id: string;
  type: 'created' | 'moved' | 'skill_start' | 'skill_complete' | 'skill_failed' | 'comment';
  actor: ActivityActor;
  timestamp: string;
  text: string;
  column?: string;
  skill?: string;
}
```

Default normalization for old records:
- `comment` => `human`
- everything else => `system`

### Derived card view fields
Do **not** persist unread booleans/counters. Return them from `GET /api/state` as derived fields:

```ts
interface CardView extends Card {
  derived: {
    logUpdatedAt: string | null;
    hasUnreadOutput: boolean;
    unreadCommentCount: number;
    attentionLevel: 'none' | 'output' | 'comment' | 'patrick';
  };
}
```

---

## Derivation Rules

### 1) New agent output
Use the log file mtime instead of writing board state on every stdout chunk.

```ts
logUpdatedAt = card.logFile ? fs.statSync(card.logFile).mtime.toISOString() : null;
hasUnreadOutput = !!logUpdatedAt && (!card.lastViewedAt || logUpdatedAt > card.lastViewedAt);
```

**Why this is better:**
- avoids rewriting `missioncontrol.json` for every token/log append
- cheap enough for current board scale
- reflects real new output, not just lifecycle changes

### 2) Unread comments
Count activity entries newer than `lastViewedAt` where `type === 'comment'`.

```ts
unreadCommentCount = activity.filter(entry =>
  entry.type === 'comment' &&
  (!card.lastViewedAt || entry.timestamp > card.lastViewedAt)
).length;
```

### 3) Waiting on Patrick
This should be explicit, not inferred.

```ts
isWaitingOnPatrick = card.attentionMode === 'waiting_on_patrick';
```

### 4) Visual precedence
If multiple signals are present, use this hierarchy:

1. `patrick` — waiting on Patrick
2. `comment` — unread comments
3. `output` — new agent output
4. `none`

This satisfies the requirement that Patrick-specific waits feel stronger than generic unread work.

---

## API Changes

### `GET /api/state`
Return derived fields for each card.

### `PATCH /api/cards/:id`
Allow updating:
- `attentionMode`
- `attentionReason`
- `attentionUpdatedAt`

Do **not** accept arbitrary fields blindly. Validate/allowlist patchable keys.

### `POST /api/cards/:id/read`
New endpoint:
- sets `lastViewedAt = now`
- returns updated card or `{ ok: true }`

This keeps read semantics explicit and avoids smuggling view-state writes through generic patch.

---

## UI Plan

## Keep existing execution status
The existing left-side status dot continues to represent machine state:
- gray idle
- amber pending
- blue running
- green complete
- red failed

That dot should remain stable and separate from attention.

## Add attention overlay
Add a small top-right attention cluster on each card.

### Level 1 — unread output
**Visual:** small blue pulse badge
**Meaning:** the agent said something new / log advanced

### Level 2 — unread comments
**Visual:** comment badge with count
**Meaning:** there are comments you have not read yet

### Level 3 — waiting on Patrick
**Visual:** orange pill/banner + stronger border treatment
**Meaning:** this card is blocked on Patrick making a decision or replying

### Recommended tile behavior
- show **one primary attention treatment** based on precedence
- allow a small secondary count chip when useful
- do not replace the execution status dot

Example:
- card is `running` + new log output → blue output badge
- card is `complete` + 2 unread comments → comment badge `2`
- card is `complete` + waiting on Patrick + 2 unread comments → orange `Needs Patrick` pill plus small comment count chip

---

## Modal Changes
Add a compact “Attention” control in the card modal:

- **Attention mode**
  - Normal
  - Waiting on Patrick
- **Reason** (optional free text)
  - e.g. `Need approval on scope`
  - e.g. `Choose A vs B`

When the modal opens:
- call `POST /api/cards/:id/read`
- keep marking the card read while the modal remains open via existing polling refresh behavior

For v1, opening the modal counts as reading the card. That is good enough for a single-user internal tool.

---

## Important Engineering Constraints

### 1) Single-user assumption is acceptable
Mission Control is currently Patrick-facing. A single `lastViewedAt` per card is acceptable.

If this becomes multi-user later, read-state must move out of the card into per-user board state.

### 2) Do not rewrite board state on every log append
This is the main trap. Use log-file mtime for unread output.

### 3) Do not overload `status`
`status` is lifecycle. `attentionMode` is human-facing UX state.

### 4) Validate activity metadata and patch fields
Current API shape is too permissive. Tighten it while touching this area.

Specifically:
- allowlist activity `type`
- allowlist `actor`
- allowlist patchable card fields
- never interpolate raw untrusted strings into CSS classes

---

## Implementation Sequence

### Step 1 — State model
Update `src/state.ts`:
- add `lastViewedAt`
- add `attentionMode`
- add `attentionReason`
- add `attentionUpdatedAt`
- add `actor` to `ActivityEntry`
- normalize old board files safely

### Step 2 — Server derivation
Update `src/server.ts`:
- compute `derived.logUpdatedAt`
- compute `derived.hasUnreadOutput`
- compute `derived.unreadCommentCount`
- compute `derived.attentionLevel`
- add `POST /api/cards/:id/read`
- validate `PATCH /api/cards/:id`

### Step 3 — Tile rendering
Update `src/ui.ts`:
- render attention cluster/banner
- preserve existing run-status dot
- add accessible text labels / tooltips

### Step 4 — Modal controls
Update `src/ui.ts`:
- add attention controls
- mark card read on open
- keep modal visually synced during polling

### Step 5 — Tests
Cover normalization, derivation, precedence, and read semantics.

---

## Test Plan

### State tests
- old card JSON loads with new fields defaulted safely
- old activity entries default actor correctly
- patch validation rejects unknown fields

### Server tests
- unread output is derived from log mtime
- unread comments count respects `lastViewedAt`
- `waiting_on_patrick` overrides lower-priority attention states
- `POST /read` updates `lastViewedAt`

### UI tests
- running card still shows run-status dot
- unread output renders blue badge
- unread comments render count badge
- waiting on Patrick renders strong pill/banner
- combined states respect precedence

### Manual QA scenarios
1. Start a skill-backed card, let logs stream, confirm unread output appears.
2. Open modal, confirm unread output clears.
3. Add comment, close modal, confirm unread comment badge appears.
4. Set `Waiting on Patrick`, confirm stronger indicator overrides others.
5. Move card across stages, confirm attention metadata survives.

---

## Open Questions for Design Review
1. Copy choice: **“Needs Patrick”** vs **“Waiting on Patrick”**
   - Recommendation: **Needs Patrick** — shorter, stronger, clearer at card scale.
2. Comment badge color
   - Recommendation: purple or slate-blue, not orange; orange should remain reserved for Patrick-specific attention.
3. Whether comment count should cap at `9+`
   - Recommendation: yes.

---

## Decisions Locked In During Eng Review
- Keep execution status and attention state separate.
- Use `lastViewedAt` for read tracking.
- Use log-file mtime for unread output.
- Make Patrick-specific waiting explicit via `attentionMode`.
- Derive unread/attention server-side.
- Prefer a banner/pill only for Patrick-specific attention.

---

## Recommended Next Stage
**Design Review next.**

Why:
- the architecture is straightforward now
- the remaining meaningful decisions are visual hierarchy, wording, and badge/banner treatment
- after Design Review, implementation can be done in one pass without reopening the data model

---

## Design Review — 2026-03-23

### System Audit
- **UI scope:** existing board card tile + existing card modal; no new screen or route required
- **Existing patterns to preserve:** left-side execution status dot, compact dark card tile, tag badges, small monospace skill/session metadata, modal as the place for detail
- **Design system context:** Mission Control already uses a utilitarian dark theme with low-chroma surfaces (`#111827`, `#1F2937`, `#374151`) and compact density. New attention affordances should feel native to that system, not like app-store notification stickers.

### Initial Design Rating
**6.5/10.** The plan had the right information model, but the visual behavior was still underspecified. It said "badge/banner" without fully deciding placement, strength, combined-state behavior, read semantics, or responsive behavior.

**A 10/10 for this card** means Patrick can scan the board in two seconds and reliably distinguish:
1. ambient machine state,
2. new unread activity,
3. unread human conversation,
4. a card explicitly waiting on him.

### What Already Exists
Reuse these instead of inventing a parallel visual language:
- existing **status dot** = machine lifecycle only
- existing **tag badges** = small, secondary metadata
- existing **card border + surface hover** = baseline emphasis
- existing **modal** = place for reason text, controls, and detail

That means the new attention system should layer onto the tile, not replace the tile.

---

## Design Review Decisions (locked)

### 1) Primary copy
Use **Needs Patrick** on-card.

Why:
- shorter than "Waiting on Patrick"
- reads instantly at card scale
- makes the card's ask explicit without sounding like a queue status

Use **Waiting on Patrick** inside the modal control/help text if we want the more descriptive phrase there.

### 2) Visual hierarchy
Use a **three-level attention hierarchy**:

#### Level A — Ambient unread output
- visual: tiny blue pulse dot/chip in the card header
- meaning: the agent produced something new
- weight: light

#### Level B — Unread comments
- visual: compact count pill in purple (`1`, `2`, `9+`)
- meaning: there is human-readable conversation to catch up on
- weight: medium

#### Level C — Needs Patrick
- visual: orange pill plus orange-accent border treatment
- meaning: Patrick specifically needs to decide/reply
- weight: strongest

This keeps the board legible: only Patrick-blocked cards get the loud treatment.

### 3) Placement on the card
Do **not** scatter badges across corners.

Use this tile structure:

```text
┌──────────────────────────────┐
│ Title text            [chip] │
│ [Needs Patrick]             │
│ #tags                        │
│ /skill                       │
│ OpenClaw · a1b2c3d4          │
└──────────────────────────────┘
```

Rules:
- unread output dot / unread comment count lives in the **title row, right-aligned**
- `Needs Patrick` lives on its **own row below the title** so it reads as a state, not a decoration
- keep session/skill metadata where it already lives; do not promote it visually

### 4) Combined-state precedence
Render with this precedence:

1. `Needs Patrick`
2. unread comment count
3. unread output dot

Combined behavior:
- **Needs Patrick + unread comments** → show orange `Needs Patrick` pill + small purple count chip
- **Needs Patrick + unread output only** → show orange `Needs Patrick` pill; no extra blue pulse needed
- **Unread comments + unread output** → show purple count chip only
- **Unread output only** → show blue pulse dot/chip only

This prevents badge spam.

### 5) Border treatment
When `attentionMode === waiting_on_patrick`:
- border shifts from neutral gray to muted orange
- hover state can intensify slightly
- do **not** add full-card orange backgrounds; too loud for board density

Recommended styling direction:
- pill text: `#FDBA74`
- pill background: `rgba(249, 115, 22, 0.14)`
- pill border: `rgba(249, 115, 22, 0.35)`
- card border: subtle orange tint, not full saturation

### 6) Comment badge styling
Use **purple** for unread comments.

Recommended direction:
- text: `#C4B5FD`
- background: `rgba(139, 92, 246, 0.16)`
- border: `rgba(139, 92, 246, 0.32)`
- size: 18-20px high, min-width 18-20px, rounded-full
- cap count at **`9+`**

Purple clearly differentiates human conversation from system activity and does not steal orange's "your turn" meaning.

### 7) Unread output indicator styling
Use the lightest treatment here.

Recommended direction:
- 8-10px blue dot or 16px compact chip
- color family: `#60A5FA` / `#3B82F6`
- pulse only while unread is true
- stop animation once read

If a pulse is used, keep it restrained; one low-amplitude halo is enough. No aggressive notification bounce nonsense.

### 8) Read semantics
For v1, **opening the modal marks the card read** for unread output and unread comment indicators.

Important exception:
- `Needs Patrick` does **not** clear on read
- it clears only when the attention control is changed back to `Normal`

That distinction matters: "I looked at it" is not the same as "I handled it."

### 9) Reason text behavior
Do **not** print `attentionReason` on the card tile by default.

Why:
- reason text is volatile and often long
- the tile already contains title, tags, skill, and session continuity metadata
- adding reason copy to the tile will push it toward clutter immediately

Instead:
- show the reason in the modal
- optionally expose it as a `title` tooltip on the orange pill

### 10) Empty / edge cases
Explicitly define these so implementation doesn't improvise:

| Condition | Card treatment |
|---|---|
| `unreadCommentCount > 9` | show `9+` |
| missing log file | unread output = false |
| modal open and polling updates arrive | indicators remain cleared after read mark |
| `Needs Patrick` with no reason | show pill only |
| card moved columns while unread | unread state persists until read |
| complete/failed cards with unread activity | still show unread indicators |

### 11) Responsive behavior
Mobile should not just "stack everything." Use these rules:
- keep attention chip in the title row on mobile
- `Needs Patrick` pill remains on its own line below title
- never place more than two attention elements on a tile
- if the title wraps, right-side chip stays top-aligned
- metadata rows may truncate before attention affordances do

### 12) Accessibility
Lock these in:
- unread indicators must include text equivalents via `aria-label`
- `Needs Patrick` provides non-color text meaning on the tile
- comment badge label example: `aria-label="2 unread comments"`
- output dot label example: `aria-label="New unread output"`
- orange pill label example: `aria-label="Needs Patrick"`
- modal attention controls remain keyboard reachable
- tap/click targets for controls in modal: **44px minimum**

---

## Interaction State Coverage

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| unread output indicator | hidden until state arrives | hidden | hidden on stat/read failure | blue unread marker | n/a |
| unread comment badge | hidden until state arrives | hidden when 0 | hidden if activity unavailable | purple count badge | `9+` cap |
| Needs Patrick state | neutral while card data loads | n/a | fall back to neutral | orange pill + border tint | pill without reason |
| modal attention control | disabled while save in flight | default `Normal` | inline save failure, state unchanged | reflects saved state | reason empty but mode set |

---

## AI Slop Avoidance
These are the traps to avoid:
- generic red notification badges for everything
- full-card warning backgrounds for all unread states
- showing three indicators at once because "more information"
- stuffing reason text into the tile because it feels "informative"

Mission Control is a dense operator board. The right move is **measured escalation**, not visual confetti.

---

## NOT in Scope
- push/browser notifications
- auto-infer "Needs Patrick" from free-form agent output
- per-user read state
- board-level notification center or aggregate unread counter
- reason text preview on the tile
- replacing the existing execution status model

---

## Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | existing board + modal; clear UI scope      |
| Step 0               | 6.5/10 initial; main gaps were specificity  |
| Pass 1  (Info Arch)  | 7/10 → 9/10                                 |
| Pass 2  (States)     | 6/10 → 9/10                                 |
| Pass 3  (Journey)    | 6/10 → 8.5/10                               |
| Pass 4  (AI Slop)    | 5.5/10 → 9/10                               |
| Pass 5  (Design Sys) | 8/10 → 9/10                                 |
| Pass 6  (Responsive) | 5/10 → 8.5/10                               |
| Pass 7  (Decisions)  | 12 resolved, 0 deferred                     |
+--------------------------------------------------------------------+
| NOT in scope         | written (6 items)                           |
| What already exists  | written                                     |
| Decisions made       | 12 added to plan                            |
| Decisions deferred   | 0                                           |
| Overall design score | 6.5/10 → 9/10                               |
+====================================================================+
```

**Verdict:** design-complete enough to implement. Run visual QA after implementation, but the plan no longer has the important UX ambiguities.

---

## Design Review Verdict
**APPROVED FOR IMPLEMENTATION.**

No fresh CEO review needed.
No fresh Eng Review required **for the current concept** because this design review did not change the underlying architecture approved in Eng Review; it clarified presentation, precedence, and read behavior.

## Recommended Next Stage
**Implementation.**

Implementation should now be a straightforward pass across:
- `src/state.ts` for persisted fields + normalization
- `src/server.ts` for derived attention/read state + `POST /read`
- `src/ui.ts` for tile chips/pill/border treatment + modal attention control
- tests for precedence, read semantics, and accessibility labels

---

## Design Stage — Final UI Blueprint

This section is the handoff for implementation. The design decisions above are approved; this is the concrete rendering spec.

### Component Inventory

#### Card tile additions
1. **Execution status dot** — existing element; unchanged meaning
2. **Attention chip slot** — right side of title row
3. **Needs Patrick pill row** — optional row beneath title
4. **Patrick border tint** — optional card-level emphasis when blocked on Patrick

#### Modal additions
1. **Attention mode select**
2. **Attention reason input**
3. **Help text explaining read vs handled semantics**

---

## Final Card Anatomy

```text
┌─────────────────────────────────────────┐
│ ● Card title                    [chip]  │
│ [Needs Patrick]                         │
│ #missioncontrol  #attention  #ux        │
│ /plan-eng-review                        │
│ OpenClaw · a1b2c3d4                     │
└─────────────────────────────────────────┘
```

### Anatomy rules
- left edge always starts with the **execution status dot**
- title remains the highest-priority text element
- right side of title row is reserved for **at most one compact attention chip**
- the orange **Needs Patrick** pill gets its own row so it reads as a state, not a badge
- metadata rows remain visually secondary and may truncate before title or state affordances

---

## Canonical Tile States

### A) No attention
```text
│ ● Card title                           │
```
- no chip
- neutral border

### B) New unread output only
```text
│ ● Card title                      [●]  │
```
- small blue pulse dot/chip on title row
- no extra pill row

### C) Unread comments only
```text
│ ● Card title                      [2]  │
```
- purple count chip on title row
- no pill row

### D) Waiting on Patrick only
```text
│ ● Card title                           │
│ [Needs Patrick]                        │
```
- orange pill row
- muted orange border tint

### E) Waiting on Patrick + unread comments
```text
│ ● Card title                      [2]  │
│ [Needs Patrick]                        │
```
- orange pill row + purple count chip
- no unread-output dot

### F) Waiting on Patrick + unread output only
```text
│ ● Card title                           │
│ [Needs Patrick]                        │
```
- orange pill row only
- no extra blue dot

### G) Complete/failed with unread activity
Same treatments as above. Attention is orthogonal to lifecycle status.

---

## Token + Styling Spec

### Surfaces
| Element | Value |
|---|---|
| Card bg | `#1F2937` |
| Card border default | `#374151` |
| Card hover border | `#4B5563` |
| Title text | `#F3F4F6` |
| Secondary metadata | `#6B7280` to `#9CA3AF` |

### Needs Patrick pill
| Property | Value |
|---|---|
| Text | `#FDBA74` |
| Background | `rgba(249, 115, 22, 0.14)` |
| Border | `rgba(249, 115, 22, 0.35)` |
| Height | `20px` |
| Radius | `999px` |
| Font | `11px`, semibold, slight tracking |
| Padding | `0 8px` |

### Patrick card emphasis
| Property | Value |
|---|---|
| Card border | `rgba(249, 115, 22, 0.38)` |
| Hover border | `rgba(249, 115, 22, 0.55)` |
| Background change | none |
| Shadow change | none beyond existing hover |

### Comment count chip
| Property | Value |
|---|---|
| Text | `#DDD6FE` or `#C4B5FD` |
| Background | `rgba(139, 92, 246, 0.16)` |
| Border | `rgba(139, 92, 246, 0.32)` |
| Height | `18px` |
| Min width | `18px` |
| Radius | `999px` |
| Font | `11px`, semibold |
| Padding | `0 6px` |
| Max display | `9+` |

### Unread output dot/chip
| Property | Value |
|---|---|
| Color | `#60A5FA` / `#3B82F6` |
| Size | `8px` dot or `16px` chip |
| Animation | low-amplitude pulse |
| Animation state | only while unread |

### Spacing
| Element | Value |
|---|---|
| Title row gap | `8px` |
| Pill row top margin | `8px` |
| Tag row top margin | `8px` |
| Metadata row top margin | `8px` |

---

## Suggested DOM Shape

```html
<div class="card [attention-waiting-on-patrick?]">
  <div class="card-title-row">
    <span class="status-dot"></span>
    <span class="card-title">Add unread and attention indicators…</span>
    <span class="attention-chip attention-chip--comments">2</span>
  </div>

  <div class="attention-pill-row">
    <span class="attention-pill attention-pill--patrick">Needs Patrick</span>
  </div>

  <div class="card-tags">…</div>
  <div class="card-skill">…</div>
  <div class="card-session">…</div>
</div>
```

### Class guidance
Use explicit semantic classes. Do not derive CSS classes from arbitrary API strings.

Recommended class family:
- `.attention-chip--output`
- `.attention-chip--comments`
- `.attention-pill--patrick`
- `.card--needs-patrick`

---

## Motion Spec

### Unread output pulse
- duration: ~1.6s to 2s
- style: subtle opacity/scale halo
- amplitude: restrained
- disabled when card is read
- disabled for `prefers-reduced-motion`

### Everything else
- no bouncing
- no shake
- no animated border sweep
- hover transitions may reuse existing `0.15s` timing

---

## Modal Spec

### Attention section layout
Place below description/tags or alongside the status/column controls if space allows.

```text
Attention
[ Normal v ]
[ Optional reason text input                     ]
Patrick-specific attention stays active until you clear it.
Opening the modal marks unread output/comments as read.
```

### Control behavior
- `Normal`
  - hides orange pill on card
  - clears `attentionReason`
- `Waiting on Patrick`
  - enables optional reason text
  - reason shown in modal, not on tile
  - pill may expose reason as tooltip/title only

### Save behavior
- on save success: modal state stays in sync, card updates on next refresh
- on save error: inline error/toast; do not silently discard

---

## Accessibility / Semantics

### Required labels
- unread output: `aria-label="New unread output"`
- unread comments: `aria-label="2 unread comments"`
- needs Patrick pill: `aria-label="Needs Patrick"`
- modal select: visible label `Attention mode`
- reason input: visible label `Reason (optional)`

### Reduced motion
If `prefers-reduced-motion: reduce`, show a static blue unread indicator instead of a pulse.

### Color independence
The orange pill must always contain text.
The comment chip must always contain a number.
The unread output dot must have an accessible label/tooltip.

---

## Implementation Guardrails

Do not:
- use red for generic unread states
- render all three indicators simultaneously
- show `attentionReason` inline on the tile
- let unread activity modify or replace lifecycle status
- make read/unread depend on hovering or viewport visibility

Do:
- keep the tile calm by default
- escalate only when Patrick is specifically needed
- keep precedence deterministic
- ensure board polling cannot reintroduce cleared unread state while modal-open read marking is active

---

## Resumable Handoff for Implementation

Implementation should treat this as the source of truth:
1. keep execution and attention separate
2. build one right-aligned compact chip slot in the title row
3. build one dedicated orange pill row for Patrick-blocked cards
4. derive unread state server-side
5. clear unread on modal open/read endpoint
6. do **not** clear Patrick-blocked state on read

If implementation needs to cut scope, the only acceptable cut is **skip tooltip display of `attentionReason` on the pill**. Everything else is core to the design.
