# Branch: mechanism

Use when the user asks "how does this work", "walk me through what happens
when…", "step by step", pointing at a **multi-stage process** — a request
flowing through middleware, a function that does several things in sequence, a
lifecycle going startup→serve→shutdown.

The tell you're in the wrong branch: the code is one static mechanism (one
function doing one thing), not a sequence. If there are no stages to trace,
use `concept.md` — a forced step-by-step of a single static thing reads as
padding.

## The distinguishing feature: a through-line analogy

Unlike `concept.md` (one static scene) or `change.md` (one scene in two
states), here the analogy is a **through-line**: the same characters **progress
through the stages in time**. The counter worker doesn't just stand there — he
receives the request, hands it off, waits, gets the result back, sends the
response. Each stage is a beat the reader can feel, and the beats correspond
to the code stages you're tracing.

If the analogy can't carry the characters across all stages, pick another.
A through-line that resets each stage is no through-line.

## Scaffold (four parts, in order)

### 1. The shape of the flow (the stages)

Before any code, name the stages the process moves through, in order. A
numbered list, one short phrase per stage (e.g. "1. FastAPI receives the
request, 2. the dispatcher looks up the handler, 3. the handler runs on a
worker thread, 4. the result comes back to the loop, 5. the response is
sent"). This is the **map** the rest of the explanation walks.

### 2. The mental model (the through-line, introduced)

Introduce the analogy here, with its characters, as a **tour that will visit
the stages**. Don't play out all the beats yet — just set up the scene and the
cast, and state the mapping of each character/prop to a system part. Call out
the single misunderstanding that traps most people for this flow, in bold.

### 3. Tracing the stages (the walk-through)

This is the body. For each stage from part 1, in order:
- One **beat of the analogy** — what the characters do at this stage.
- The **code** for that stage, quoted in a fenced block.
- One or two sentences mapping the code to this beat: which line does what the
  characters just did in the analogy.

The stages and the analogy beats advance together, in lock-step. The reader
should never see code whose analogy-beat hasn't happened, or an analogy-beat
with no code behind it.

### 4. The whole flow in one sentence

The payoff for a mechanism explanation is a **recap that compresses** — after
the walk-through, restate the entire flow in a single sentence the reader
keeps. (e.g. "a request comes in on the loop, gets handed to a worker thread
that runs the handler, and the result flows back through the loop to the
response.")

One caveat is welcome if the flow has a sharp edge the reader will trip on
(e.g. the default thread pool filling under load). State it once with the
escape hatch.

## Branch-specific completion

Beyond the shared criterion, the reader should be able to **recount the
stages in order** — not perfectly, but the shape of the flow (which thing
leads to which). If they can't sequence it, the walk-through didn't land.
