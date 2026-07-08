# Branch: concept

Use when the user asks "why does X exist", "why is this needed here", "what's
the point of this function", pointing at **one thing in stable code**. There
is no before/after, no diff. The job is to make a single mechanism make sense —
why someone reached for it and what it earns.

The tell you're in the wrong branch: you find yourself inventing a "before"
that was never there, or forcing a sequential walk-through of one static thing.
If the code is one function/pattern/token, not a flow across stages, you're
here.

## Scaffold (four parts, in order)

### 1. The tension (why this exists at all)

Name the problem the code is resolving — the thing that would go wrong, or go
awkwardly, without it. One paragraph, plain language. This is the
**motivation**, not a before-state. (e.g. for `asyncio.to_thread`: "you have a
slow sync function and an async app; calling it inline freezes the app, but
you have no async version of the library to `await`.")

Don't quote code here — this section is about the world, not the lines.

### 2. The mental model (the analogy, one static scene)

Per the shared analogy discipline, as a **static scene** — one counter, one
kitchen, one receptionist — that captures how the mechanism resolves the
tension. State the mapping of every part.

This is static, not a story across time. If the thing you're explaining is
fundamentally a *sequence of stages*, you're in `mechanism.md`, not here.

Call out the single misunderstanding that traps most people for this topic,
in bold.

### 3. What the code does (the load-bearing lines)

Quote the real code in a fenced block. Then walk the two-four lines that
matter, mapping each back to a part of the analogy from part 2. Resist
annotating ceremony (imports, error handling the user didn't ask about); name
the load-bearing detail and stay on it.

For each load-bearing line: one sentence on what it does, one sentence tying
it to the model. Don't paraphrase the whole function line-by-line — only the
lines that earn their place by carrying the mechanism.

### 4. When you'd reach for it (and when you wouldn't)

The payoff for a concept explanation is **judgement**, not a fix-to-apply. Give:
- **Reach for it when** — 2-3 situations where this is the right tool.
- **Don't reach for it when** — 1-2 situations where it's the wrong tool and
  what to use instead. (e.g. for `asyncio.to_thread`: reach when wrapping a
  blocking sync library; don't when an async version exists — `await` that
  directly.)

End with a one-line rule of thumb the reader keeps.

## Branch-specific completion

Beyond the shared criterion, the reader should be able to say **what tension
this resolves** and **when it's the wrong tool** — judgement, not a patch.
