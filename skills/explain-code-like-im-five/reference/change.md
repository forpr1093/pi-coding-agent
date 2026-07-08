# Branch: change

Use when the explanation has a **before/after** — a diff, "what did you
change", "why was it broken before", code that was different earlier. This is
the contrastive scaffold: same scene shown in two states, with the difference
felt before it's parsed.

If there's no genuine before/after (the code is stable, the user is asking why
it exists or how it works), you're in the wrong branch — use `concept.md` or
`mechanism.md`.

## Scaffold (four parts, in order)

### 1. What was there before (the setup)

Quote the actual old code in a fenced block, then name the load-bearing detail
in it. Restrain annotation to the two-three lines that matter; ignore
surrounding ceremony. Then, in plain language, name the one or two facts that
set up the problem, drawing the reader's eye to the exact word doing the
damage (e.g. the `async def` + the sync call underneath it).

### 2. The mental model (the analogy, before state)

Per the shared analogy discipline, but told in its **broken** state (the
symptom). Make the **mechanism** obvious, not just the symptom — "a line
piles up" is the symptom; "the worker stands at the counter doing the heavy
task themselves" is the mechanism.

Call out the single misunderstanding that traps most people for this topic,
in bold.

### 3. The fix (the change)

Quote the new code. Then **re-tell the same analogy** with the fix applied —
same characters, same counter, but now the heavy task goes to the back room
and the counter worker stays free. The reader should feel the difference in
the analogy before they parse the code.

"Two small changes, one big effect": name each one-line change and what it
does, then state the combined effect. Fixes are usually small — present them
that way.

### 4. Use cases + how to apply it yourself

The payoff: where this bites in the reader's own code, with copy-pasteable
shapes. At least two distinct real cases (different libraries, different
shapes — HTTP call, subprocess, CPU work), each with the **bad** shape and the
**fixed** shape side by side.

End with a decision table the reader can keep: a row per common situation
mapping inputs → what to do. This is the artefact they reuse.

## Branch-specific completion

Beyond the shared criterion, the reader should be able to say **what differed
between before and after** in one sentence — the delta is the whole point of
this branch.
