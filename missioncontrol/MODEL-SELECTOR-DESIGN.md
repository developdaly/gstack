# Mission Control — Provider / Model Selector Design

## Verdict
**APPROVED FOR IMPLEMENTATION.**

This should feel like a calm runtime setting on the card’s durable thread, not a provider-management console and not a weird prompt hack.

The user-facing concept is:
- this card can optionally use a specific model
- blank means default
- changing it affects future runs only
- the durable thread stays intact

---

## Product Framing
Do **not** design this as separate "provider" and "model" controls.
Do **not** expose raw runtime plumbing as the primary UX.

Design it as a single **Model** selection surface backed by a canonical `provider/model` value.

That keeps the UI aligned with the real mental model:
> “Pick which brain this card should use.”

---

## What already exists
Current Mission Control UI already has:
- compact card tiles with title, tags, skill line, and session summary
- a dark utilitarian visual style
- a single card modal for editing content + runtime context
- an existing execution hierarchy: status, column, description, tags, skill, session

This feature should **reuse** that structure.

---

## Core Design Decisions

### 1) Card tile behavior
**Default cards show nothing.**

If a card is using the default model, do **not** add a badge just to say “Default.” That is noise on every tile.

If a card has an explicit model override, show **one compact model badge** on the tile.

Placement:
- below tags
- above the skill line
- same visual weight as metadata, not as important as the title

Example:

```text
┌─────────────────────────────────────┐
│ ● Provider / Model Selector         │
│ [missioncontrol] [ux]               │
│ [Model: GPT-4.1 · GitHub Copilot]   │
│ /plan-eng-review                    │
│ OpenClaw · 40298d9c                 │
└─────────────────────────────────────┘
```

### 2) Badge style
Use a **subtle indigo/blue-gray pill** distinct from tags.

- Tags remain neutral gray
- Model badge gets a dedicated runtime color family
- Do not make it glow, pulse, or compete with execution status

Suggested treatment:
- background: deep indigo tint
- text: lighter indigo/blue
- border: soft indigo outline
- radius: same family as tag badges, slightly stronger emphasis

### 3) Badge copy
Primary tile copy should be **human-readable first**.

Use the configured catalog’s display name as the primary label.
If the same display name exists under multiple providers, append a short provider suffix.

Examples:
- `Model: GPT-4.1 · GitHub Copilot`
- `Model: Claude Sonnet 4.6 · Anthropic`
- `Model: Gemini 3 Flash Preview · Google`

Do **not** use the raw canonical ref as the main tile label unless no better name exists.

### 4) Unavailable-model tile state
If a saved override is no longer present in the current configured catalog:
- do **not** silently hide the badge
- do **not** silently fall back to default in the UI

Show an amber warning pill instead:
- `Model unavailable`

Keep the full raw ref in the modal, not on the tile.

Example:

```text
[Model unavailable]
```

This keeps the board readable while still signaling that the runtime setting needs attention.

---

## Modal Design

### Placement
Add a new field group labeled **Model** in the card modal:
- below **Tags**
- above **Skill**

That keeps content editing separate from runtime controls, while still placing model selection near the execution-related parts of the modal.

### Control type
Use a **single searchable select / combobox**.

The first option is:
- `Use default model`

Then list configured models from the cached gateway catalog.

Do **not** use two dropdowns.
Do **not** require the user to understand provider before model.

### Helper copy
Under the control, show concise explanatory copy:

- default state: `Uses the agent default unless you choose a specific model.`
- explicit override state: `Applies to future stage runs on this card’s durable thread. History stays intact.`

If the card already has a linked session, add a second muted line:
- `Updates the bound session for future runs.`

### Canonical ref display
When a non-default model is selected, show the canonical ref in a muted mono secondary line under the control:

```text
Canonical ref: github-copilot/gpt-4.1
```

This keeps the UI friendly while still exposing the exact technical value when needed.

### Unavailable state in modal
If the stored `modelRef` is not in the current catalog:
- keep showing the stored raw ref
- mark the field with an inline warning state
- explain what happened and what to do next

Copy:
- `Saved model is no longer configured on this gateway.`
- `Choose another model or clear back to default.`

Visual treatment:
- amber border on the control area
- warning icon + short text block
- raw canonical ref shown below

Do **not** auto-clear the field for the user.

---

## Modal Mock

```text
Title
Status
Column
Description
Tags

Model
[ Use default model                ▾ ]
Uses the agent default unless you choose a specific model.

or

Model
[ GPT-4.1 · GitHub Copilot         ▾ ]
Applies to future stage runs on this card’s durable thread. History stays intact.
Canonical ref: github-copilot/gpt-4.1

Skill
OpenClaw Session
Save Changes
```

Unavailable variant:

```text
Model
[ Model unavailable                ▾ ]
⚠ Saved model is no longer configured on this gateway.
Choose another model or clear back to default.
Canonical ref: anthropic/claude-sonnet-4.6
```

---

## Information Hierarchy
The card/modal hierarchy should be:

### On the tile
1. title
2. execution state
3. tags
4. explicit model override badge (only if non-default or broken)
5. skill/session metadata

### In the modal
1. card identity and lifecycle (`title`, `status`, `column`)
2. card content (`description`, `tags`)
3. runtime choice (`Model`)
4. execution metadata (`Skill`, `OpenClaw Session`)
5. actions (`Save`, `View Log`)

The model control is important, but it should **not** outrank the card title or machine status.

---

## Interaction States

| Surface | Loading | Empty/default | Valid override | Unavailable override | Save error |
|---|---|---|---|---|---|
| Card tile | no special placeholder | no model badge | show model badge | show amber warning badge | unchanged until save succeeds |
| Modal control | skeleton/spinner inside control | `Use default model` selected | chosen label + helper + canonical ref | warning copy + stored raw ref | inline error under field |
| Save action | disabled or busy state while saving | allowed | allowed | allowed only if user changes/clears | show clear validation text |

### Default state
The empty/default state is not “None.”
It is:
- `Use default model`

That is warmer and more intentional.

### Catalog unavailable state
If the catalog cannot be loaded at all:
- disable the picker
- preserve the current visible value if one exists
- show muted inline copy:
  - `Model list unavailable right now. Try again in a moment.`

Do not erase or replace the existing saved state.

---

## AI Slop Risks to avoid
1. **Separate provider + model dropdowns**
   - feels like admin plumbing instead of product design
2. **Showing “Default” on every card**
   - creates board-wide noise for no information gain
3. **Raw `provider/model` as primary tile text**
   - technically correct, visually ugly
4. **Big hero-style selector block in modal**
   - overstates the feature and distorts hierarchy
5. **Color-only unavailable state**
   - ambiguous and inaccessible

EUREKA: The obvious implementation is “two dropdowns because there are two concepts.” That’s wrong. The user is not choosing infrastructure pieces; they are choosing one runtime brain. A single model control is both cleaner and more truthful.

---

## Responsive behavior
### Card tile
- Badge wraps under tags naturally
- Do not force the model badge and tags onto one crowded line
- Long model names truncate gracefully inside the badge

### Modal
- On mobile, the model field remains a full-width single control
- Helper text wraps under the control
- Canonical ref wraps safely and can break mid-token if needed

Do **not** introduce side-by-side provider/model layouts on larger screens.
This control stays one-dimensional at all viewports.

---

## Accessibility
- combobox/select must be keyboard reachable in normal tab order
- if searchable, arrow keys + Enter + Escape must work predictably
- helper text should be connected with `aria-describedby`
- unavailable/warning state must include text, not color alone
- touch targets must remain at least 44px high
- canonical ref text must preserve readability at zoomed sizes
- badge text on tiles must meet contrast requirements against its tint

---

## Exact copy guidance
### Label
- `Model`

### Default option
- `Use default model`

### Helper text
- `Uses the agent default unless you choose a specific model.`
- `Applies to future stage runs on this card’s durable thread. History stays intact.`
- `Updates the bound session for future runs.`

### Warning text
- `Saved model is no longer configured on this gateway.`
- `Choose another model or clear back to default.`
- `Model list unavailable right now. Try again in a moment.`

Avoid the words:
- `provider override`
- `session override`
- `runtime patch`

Those are implementation concepts, not UI copy.

---

## NOT in scope
- separate provider and model controls
- per-stage model selection
- thinking-level or profile selection
- editing model aliases from Mission Control
- cost estimates in the picker
- per-card fallback chains
- showing the default model badge on every card

---

## Visual Tokens

### Tile model badge
Use a dedicated runtime badge family, distinct from neutral tags.

| Token | Value | Usage |
|---|---:|---|
| background | `rgba(79, 70, 229, 0.14)` | normal model badge fill |
| border | `rgba(129, 140, 248, 0.38)` | normal model badge outline |
| text | `#C7D2FE` | normal model badge text |
| unavailable background | `rgba(245, 158, 11, 0.14)` | unavailable badge fill |
| unavailable border | `rgba(251, 191, 36, 0.38)` | unavailable badge outline |
| unavailable text | `#FCD34D` | unavailable badge text |

### Modal field tokens
- control min height: `44px`
- warning container radius: `8px`
- helper text size: `12px`
- canonical ref text size: `11px`
- canonical ref font: existing mono stack used for skill/session metadata

---

## Canonical Tile States

### 1) Default card
```text
┌─────────────────────────────────────┐
│ ● Provider / Model Selector         │
│ [missioncontrol] [ux]               │
│ /plan-eng-review                    │
│ OpenClaw · 40298d9c                 │
└─────────────────────────────────────┘
```
No runtime badge.

### 2) Explicit model override
```text
┌─────────────────────────────────────┐
│ ● Provider / Model Selector         │
│ [missioncontrol] [ux]               │
│ [Model: GPT-4.1 · GitHub Copilot]   │
│ /plan-eng-review                    │
│ OpenClaw · 40298d9c                 │
└─────────────────────────────────────┘
```

### 3) Saved ref unavailable
```text
┌─────────────────────────────────────┐
│ ● Provider / Model Selector         │
│ [missioncontrol] [ux]               │
│ [Model unavailable]                 │
│ /plan-eng-review                    │
│ OpenClaw · 40298d9c                 │
└─────────────────────────────────────┘
```

---

## Modal Layout Blueprint
```text
Title
Status
Column
Description
Tags
Model
Skill
OpenClaw Session
Save / View Log
Activity
```

### Model block anatomy
```text
Label: Model
Control: searchable combobox / select
Helper line
Optional session-impact line
Optional warning block
Optional canonical ref line
```

### Vertical rhythm
- label → control: `6px`
- control → helper: `8px`
- helper → canonical ref: `6px`
- field group bottom gap: reuse current `16px`

---

## DOM / Class Guidance
These are implementation hints, not a mandate to introduce a new subsystem.

### Card tile
- render badge only when `card.modelRef` is non-null **or** broken/unavailable
- recommended class hooks:
  - `.model-badge`
  - `.model-badge.unavailable`

### Modal
- recommended ids/hooks:
  - `#modal-model-select`
  - `#modal-model-helper`
  - `#modal-model-warning`
  - `#modal-model-ref`

### State classes
- `.is-default`
- `.is-selected`
- `.is-unavailable`
- `.is-loading`
- `.is-disabled`

Keep the styling local and minimal. Do not build a new component framework for one control.

---

## Motion
This feature should move like settings UI, not like a celebratory interaction.

- picker open/close: native or near-native behavior
- helper/warning text transitions: optional `120–160ms` fade
- tile badge appearance after save: no bounce, no pulse, just appear on refresh/state sync
- unavailable badge: static, not animated

If animation draws attention to itself, it is already too much.

---

## Implementation Guardrails
1. **Do not let the model badge outrank the title.**
2. **Do not show a default badge on every card.**
3. **Do not surface raw `provider/model` as the main tile label.**
4. **Do not auto-clear unavailable saved refs.**
5. **Do not let the modal warning state block the user from returning to default.**
6. **Do not grow the card height unpredictably with multiline runtime copy.** Badge text should truncate.

---

## Artifacts
- Design source of truth: `/data/.openclaw/skills/gstack/missioncontrol/MODEL-SELECTOR-DESIGN.md`
- Static preview: `/data/workspace/missioncontrol-model-selector-preview.html`

## Implementation handoff
Implementation should keep the visual diff tight:
- add one modal field group for **Model**
- add one optional compact tile badge when an explicit override exists
- add one amber warning presentation for unavailable saved refs
- keep default cards visually unchanged
- treat this file as the feature-specific visual source of truth
- use the preview HTML to match badge weight, warning tone, and modal hierarchy

If this ships and feels like a small, intentional runtime setting rather than a mini control panel, it’s right.
