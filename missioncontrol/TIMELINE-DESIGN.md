# Mission Control — Typed Activity Timeline Design

## Goal
Turn the current activity feed into the **card's canonical narrative audit trail**.

When Patrick opens a card, he should be able to answer these questions without reading raw logs or searching chat history:
1. **What happened?**
2. **Who did it?**
3. **What changed?**
4. **Do I need to do anything?**

This is **not** transcript replay and **not** a prettier log viewer. It is a structured, readable timeline for operator use.

---

## Product Call
Use **one unified chronological timeline** inside the card modal.

Do **not** split this into separate panes for:
- comments
- system events
- stage history
- status history

That would make the user reconstruct the story manually.

The timeline should feel like:
- an **audit trail** for workflow truth
- a **conversation record** for human/agent collaboration
- a **control-room timeline** for recency and state changes

---

## Existing UI Baseline
Mission Control already has the right shell:
- dark utilitarian visual system
- compact modal layout
- durable session metadata
- activity feed container
- log viewer as secondary drill-down

The current problem is not missing chrome. The problem is that every row currently looks like the same generic event list item.

Current issues:
- system rows and comments have nearly identical weight
- stage/status changes are prose blobs instead of structured deltas
- technical session metadata visually competes with the timeline
- event type styling is too coarse and too dependent on raw `type` strings
- there is no day grouping or narrative hierarchy

---

## Design Principles
1. **Narrative first.** The timeline should read like a story of the card, not a database dump.
2. **System rows are quiet.** They provide truth, not drama.
3. **Comments are readable.** Human and agent commentary must feel easier to scan than machine events.
4. **Structured deltas beat prose.** For stage/status changes, render before → after visually.
5. **Color is supportive, not semantic-only.** Every row family gets a text label, not just a color.
6. **Newest first.** Mission Control is an operator tool; recency wins.
7. **Graceful fallback.** Unknown/legacy event types must render safely and neutrally.

---

## Timeline Information Hierarchy
Within the modal, the order of attention should be:

```text
1. Timeline
2. Card title / editable fields
3. Current workflow controls
4. Durable thread metadata
5. Raw execution log
```

That means the durable OpenClaw session block should be visually demoted.
It remains useful, but it is not the star of the modal.

---

## Event Families
The timeline should distinguish these five families:

| Family | Purpose | Visual Weight | Primary Content |
|---|---|---:|---|
| System / Run Lifecycle | session linked, run started, completed, failed, cancelled | Low | concise generated copy |
| Stage Transition | workflow column changed | Medium | before → after chips |
| Status Transition | status changed | Medium | before → after chips |
| Agent Comment | durable-thread commentary from the agent | High | readable body text |
| Human Comment | human-entered notes/replies | High | readable body text |

Recommended v1 type map:

```text
card_created
session_linked
run_started
run_completed
run_failed
run_cancelled
stage_changed
status_changed
agent_comment
human_comment
```

Unknown or legacy rows should map to:

```text
unknown_event
```

with a neutral fallback style.

---

## Row Anatomy
Every row should use the same structural skeleton so the feed feels coherent:

```text
┌──────────────────────────────────────────────────────────────┐
│ [icon] [LABEL]                                  [timestamp] │
│ primary line / delta chips / comment body                   │
│ optional secondary line                                     │
└──────────────────────────────────────────────────────────────┘
```

### Shared row rules
- timestamp lives top-right, muted, always present
- label is small uppercase semibold text
- icon chip is allowlisted and semantic
- body wraps cleanly; no truncation in the modal timeline
- row padding: comfortable enough for reading, dense enough for operator workflows

Recommended spacing:
- row padding: `10px 12px`
- inter-row border: `1px solid #1F2937`
- icon column width: `20px`
- label/body gap: `8px`

---

## Family-Specific Rendering

### 1) System / Run Lifecycle
Examples:
- Durable thread linked
- CEO Review started
- Eng Review completed
- QA failed
- Run cancelled

Visual treatment:
- lowest emphasis of the five families
- compact icon chip
- small label such as `SYSTEM` or `RUN`
- concise generated copy from metadata
- muted foreground color

Example:

```text
[✓] RUN                                  Mar 23 14:20
Eng Review completed
```

Use this family for facts, not paragraphs.

### 2) Stage Transition
Do not render as sentence-first prose like:
- "Moved from backlog to CEO Review"

Render as a compact workflow delta:

```text
[→] STAGE                                Mar 23 14:03
[Backlog] → [CEO Review]
```

Rules:
- both stage chips visible
- arrow centered and quiet
- stage names in small rounded chips
- optional secondary line only if skill launch is relevant

### 3) Status Transition
Same treatment as stage transitions, but visually distinct label:

```text
[●] STATUS                               Mar 23 14:22
[Running] → [Complete]
```

Rules:
- do not rely only on chip color
- use text labels with status chips
- skip noisy duplicate entries when old/new are identical

### 4) Agent Comment
This is the most important non-human text in the timeline.
It should feel more readable than system rows and less decorative than chat bubbles.

Visual treatment:
- subtle blue-tinted or steel-tinted surface
- label `AGENT`
- comment body set as true reading text block
- preserve plain text line breaks
- no avatar required

Example:

```text
[💬] AGENT                               Mar 23 14:25
The current feed is too lossy. I recommend typed rows so stage/status changes
render as deltas and comments stay readable.
```

### 5) Human Comment
Human comments should read at least as clearly as agent comments.
This is where Patrick's notes or replies live.

Visual treatment:
- neutral or slightly warmer surface than agent comment rows
- label `HUMAN` in v1 (safe for future multi-user support)
- if viewer-local identity exists later, it may become `YOU`
- preserve plain text line breaks

Example:

```text
[💬] HUMAN                               Mar 23 14:28
Let's keep the tiles minimal and make the modal do the heavy lifting.
```

---

## Day Separators
Add a date separator when the day changes in newest-first order.

Example:

```text
────────────────  Today, Mar 23  ────────────────
[row]
[row]

───────────────  Yesterday, Mar 22  ─────────────
[row]
[row]
```

Rules:
- `Today` / `Yesterday` when applicable
- otherwise `Mon, Mar 23`
- separator is muted and non-interactive
- separator should not look like a row

This materially improves legibility once a card has multi-day history.

---

## Modal Layout Changes
The modal should prioritize the timeline more aggressively.

### Recommended order
```text
Title / core editable fields
Timeline
Lightweight comment composer
Thread details (demoted)
Execution log (secondary drill-down)
```

### Specific changes
1. **Move timeline above thread/session metadata**
   - timeline is the primary reading surface
   - thread details become a quieter support block

2. **Demote session metadata**
   - keep `sessionId`, `sessionKey`, transcript path, and resume command
   - render under a quieter heading such as `Thread details`
   - reduce text contrast and visual density

3. **Keep log viewer secondary**
   - still accessible via button
   - never visually outrank the timeline

---

## Card Tile Scope
The board tile should remain minimal.

Do not add:
- mini timeline previews
- per-type event badges on the tile
- long event snippets
- visible delta history on the tile

At most, a future tile may show a single summary signal such as "new activity" or unread state, but the timeline itself belongs in the modal.

---

## Tokens and Styling Direction
Reuse Mission Control's current industrial dark palette.

### Base surfaces
- Modal / card surface: `#111827` / `#1F2937`
- Row divider: `#1F2937`
- Primary text: `#E5E7EB`
- Secondary text: `#9CA3AF`
- Quiet text: `#6B7280`

### Row family accents
- System / Run: slate-blue / slate-green, low saturation
- Stage transition: blue family
- Status transition: neutral-to-indigo family
- Agent comment: desaturated blue surface accent
- Human comment: neutral/slate surface accent

### Label styling
- 11px uppercase
- semibold
- subtle letter spacing
- must remain readable without color context

### Delta chips
Use small rounded chips for stage/status values.

Example:
```text
[Backlog] → [CEO Review]
[Running] → [Complete]
```

Chips should be:
- text-first, not color-first
- compact
- consistent across stage and status rows

---

## Accessibility
Required:
- every icon chip has adjacent text label
- no row family depends only on color
- timestamp remains visible text, not tooltip-only
- comment bodies preserve readable contrast
- divider lines must not be the only separator between comment blocks
- unknown rows must still have readable `SYSTEM`-style fallback labeling

If agent/human comment rows use tinted surfaces, contrast must still clear dark-mode readability standards.

---

## Empty / Edge States

### Empty timeline
Do not use a dead message like "No activity yet" alone.
Use:

```text
No timeline yet.
This card hasn't recorded any workflow activity or comments.
Move it into a stage or add a note to start the trail.
```

### Long comments
- wrap naturally
- preserve line breaks
- avoid single-line truncation

### Legacy events
If an old row cannot be perfectly mapped:
- render with neutral fallback icon/label
- preserve original readable text
- do not guess aggressively

### Unknown event types
- safe fallback label: `SYSTEM`
- safe fallback icon: neutral dot
- safe fallback row class: fixed allowlisted fallback, never raw type string

---

## Implementation Guardrails
1. **Allowlisted row rendering only.** No raw event types turned into CSS classes.
2. **System copy generated from metadata.** Do not persist prose blobs as the source of truth for stage/status/run rows.
3. **Comments preserve author text.** Human/agent comment bodies remain literal text.
4. **Timeline remains unified.** No separate comments tab.
5. **Session block is demoted, not removed.** Resume tooling still matters.

---

## Not in Scope
- full transcript replay
- event filtering / search
- avatars
- emoji reactions
- rich text / markdown comments
- per-row context menus
- tile-level timeline previews

---

## Handoff for Implementation
If implementation follows only six rules, they should be these:

1. **One unified feed in the modal**
2. **Five row families, each visually distinct**
3. **Newest first, with day separators**
4. **Stage/status shown as before → after chips**
5. **Comments emphasized more than system rows**
6. **Thread details visually demoted below the timeline**

That is the minimum viable version that will feel intentionally designed instead of merely styled.
