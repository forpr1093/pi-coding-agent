---
name: explain-code-like-im-five
description: Explain code to the user at a beginner level — a change, a concept ("why does this exist"), or a mechanism ("how does this work step by step") — using concrete real-life analogies that map 1:1 to the code, plain-language internals, and ready-to-reuse examples. Use ONLY when the user explicitly asks to use this skill to explain.
disable-model-invocation: true
---

# Explain Code Like I'm Five

A **user-invoked** style skill for explaining code. The user summons it by
name — it does not fire on its own; a normal "what does this do?" gets a normal
answer.

## When this skill runs

The user wants a code explanation AND has explicitly asked to use this skill
(naming it, or saying "use the explain skill"). Apply the style to whatever
they pointed at — a diff, a function, a file, a concept, a pattern, an error,
a library API.

## The branch decision (make this FIRST)

Not every explanation is a before/after. Three distinct jobs, three scaffolds.
Pick the branch **before** drafting — the wrong scaffold produces theater (an
invented "before" for code that has no before, or a forced sequence for a
single static mechanism).

| Branch | The user's question sounds like… | Scaffold lives at |
|---|---|---|
| **change** | "what did you change", "why was it broken before", a recent diff, code A vs code B | [`reference/change.md`](reference/change.md) |
| **concept** | "why does X exist", "why is this needed here", "what's the point of this function", a single thing in stable code | [`reference/concept.md`](reference/concept.md) |
| **mechanism** | "how does this work", "walk me through what happens when…", "step by step", a multi-stage process | [`reference/mechanism.md`](reference/mechanism.md) |

**Picking, flexibly.** Prefer signals from what the user pointed at:
- A recent diff, "before/after", "what changed", or code that was clearly
  different earlier → **change**.
- One function/pattern/concept in otherwise-stable code, "why does this
  exist", "what's it for", "why is it needed" → **concept**.
- A flow with multiple stages, "step by step", "walk me through", "what
  happens when…" → **mechanism**.

If the signals conflict or are ambiguous, **state which branch you're taking
and why in one line**, then proceed. Don't stall asking the user; infer and
commit. (Override: if the user explicitly names a branch — "explain the
concept of X" — honor it.)

**Read the chosen reference file before drafting.** Its scaffold is load-
bearing; winging it from memory is how the structure drifts.

## The shared doctrine (every branch)

These rules apply to all three. The per-branch reference files layer their
own scaffolds on top — they do not override these.

### The level: honest beginner, not condescending

The reader knows the **basics** of the stack (e.g. "can create a route in
FastAPI", "can write a function") but not the **internals** (event loops,
thread pools, dispatchers, lifecycle hooks). So:
- Name the internal concept plainly, then explain it — never assume `async
  def`, `event loop`, `thread pool`, `middleware` are already understood.
- Do **not** over-simplify to the point of being wrong. "Runs in the
  background" is a lie about an event loop; "runs on the one thread that
  handles every request" is true and plain. **Correctness first, then
  simplicity.**
- No baby talk. "Imagine the app is one worker at a counter" is in; "the
  little worker does a big sleepy" is out.

### The analogy discipline

A concrete real-life analogy is the heart of this skill. A weak or mismatched
analogy is worse than none — a reader who builds a wrong mental model is harder
to reach than one with no model.

- Pick a physical, everyday scene: a worker at a counter, a single checkout
  lane, a receptionist, one cook in a kitchen. Humans doing work you can see.
- **Every part of the analogy maps to a real part of the system.** State the
  mapping explicitly. If you can't map a part, the analogy is broken — pick
  another or go without.
- Use it to make the **mechanism** obvious, not just the symptom. "A line
  piles up" is the symptom; "the worker stands at the counter doing the heavy
  task themselves instead of handing it to the back room" is the mechanism.
- Find the **single misunderstanding** that traps most people for this topic
  and name it explicitly in bold. (For async/await it's: `async def` does not
  make things non-blocking — it only permits `await`; calling blocking code
  inside it gives you the worst of both.) This is the sentence the reader
  keeps.

### Tone and craft

- **Show, then tell.** Quote real code in a fenced block first, prose second.
  Don't paraphrase what you can show.
- **Bold the one sentence** that is the whole takeaway — the thing to remember
  if they forget everything else.
- Keep it tight. No filler transitions ("Now let's look at…", "It's worth
  noting that…"). Each section starts when the previous is done.
- **One caveat** is welcome if it genuinely matters and would otherwise bite
  them. State it once, briefly, with the escape hatch. Don't pile caveats —
  they drown the lesson.
- **Calibrate to the stated level.** If the user said "I only know how to
  create a route," don't reach for `contextvars` or `anyio` without
  introducing them; do reach for `asyncio.to_thread` because it's stdlib and
  one line.

## Completion criterion

The explanation is done when the reader could, without re-reading, (a) re-tell
the analogy and describe the mechanism it illustrates, and (b) name the single
misunderstanding the topic traps people in. A branch may add to this (e.g. the
change branch: also say what differed before/after; the mechanism branch: also
recount the stages in order) — see each reference file for its additions. If
either shared criterion or the branch's additions aren't reachable from what
you wrote, the explanation isn't finished.
