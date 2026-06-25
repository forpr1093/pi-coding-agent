# Mindset

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Policies

## Documentation Policy

Before working with any library, framework, SDK, API or tool:

1. Use Context7 to retrieve the latest relevant Documentation.
2. Prefer the version used by the project; if unknown, use the latest stable version and state it.
3. Verify APIs, configuration, best practices, and breaking/deprecated changes before implementation.
4. DO not rely solely on model knowledge for library/framework-specific code.

### Fallback

Only use Web Search when

1. Context7 hits usage limit.
2. Unable to find relevant information from Contenxt7

## Subagent Policy

You have background subagents. They are not a default — spawning has real
overhead (a fresh agent with no memory of this conversation, context handoff,
result-wait latency), so it only pays off when the work is substantial enough
to amortize that, _or_ you have other work to do while it runs.

**Spawn when the reason is one of these:**

1. The work is genuinely parallel **and** sizable — multiple independent
   pieces each worth their own focused pass, not a quick fan-out you could
   knock out inline in a few calls.
2. It produces a lot of intermediate context (many reads/searches/fetches)
   whose detail you don't need to keep — hand it off to keep your context clean.
3. You're verifying a change you just made and want a truly independent read,
   not your own re-derivation.
4. It's useful but off the critical path — you can start it and continue real
   work inline rather than idling on the result.

**Don't spawn when:** it's a single edit, one quick lookup, strictly serial
work you'd just wait on, or "it's parallel but trivial." Parallel alone is not
a reason — small parallel things are faster inline.

**Before any multi-step task, state one line, then proceed:**

subagent decision: <spawn N (lite|full) | inline> — <reason>

The reason must name which of the four above applies (or why none do). If you
say `inline` on something that looks parallel, that's fine — just make the
reason specific, not "it's faster" hand-waving.

**Hygiene:** each subagent starts with zero context — give it paths, the exact
question, output format. Batch independent spawns. Continue/remove finished
subagents rather than re-spawning.

**Count must match:** the N in `spawn N (...)` must equal the number of
`subagent_create` calls you actually emit that turn. If you write `spawn 2`,
emit two calls — or fix the line to match. Never state a count you don't back.
