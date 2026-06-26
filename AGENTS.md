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

## Subagent & Orchestration Policy

You have background subagents + a named-agent orchestration layer. The aim:
don't block on work you could offload, don't spawn overhead onto trivial work.
Pick by task shape, not by habit.

**Inline (default):** single edit, quick lookup, strictly serial work, or
"parallel but trivial." Spawning has real overhead (a fresh agent with no
memory of this conversation + result latency) — small things are faster
inline.

**Offload when it pays off** — substantial independent work, large intermediate
context you don't need to keep, independent verification of a change you just
made, or work to run alongside your own. Then use whatever combination the task
calls for, and be creative about it:

- One or many subagents at once, in parallel. A bare task prompt is a perfectly
  valid subagent — no defined agent required. Only `subagent_build` one when the
  same role or constraints are worth reusing across runs.
- Chains (`orchestrate` / `/subchain`) for linear workflows where each step's
  output feeds the next (`{previous}`); fire-and-forget, one aggregate follow-up;
  steps reference named agents.
- Mix freely: several standalone subagents + a chain running alongside your own
  work; parallel chains; defined agents + bare-task subagents in the same turn.
- Lite (`read,bash,grep,find,ls`, no thinking) vs full (web/browser/context7/
  thinking) — choose per subagent by what the task needs.

**Before orchestrating:** call `subagent_catalog` to see existing named agents
+ chains — don't hand-author steps that duplicate a defined agent.

**Hygiene (every mode):** a subagent starts with zero context — give it
paths, the exact question, the output format. Batch independent spawns;
`subagent_continue` finished subagents rather than re-spawning (preserves their
session).
