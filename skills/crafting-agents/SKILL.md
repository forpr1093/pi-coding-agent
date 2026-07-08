---
name: crafting-agents
description: Author a named agent definition (.md in ~/.pi/agent/agents/) that fits the subagent-widget extension's spawn contract. Use when the user wants to create/make/build a new agent or subagent, a named agent, an agent for a chain step, or asks "make an agent that does X".
disable-model-invocation: false
---

A named agent is a `.md` file at `~/.pi/agent/agents/<name>.md` consumed by
the subagent-widget extension's `spawnAgent`. The extension reads a strict
frontmatter schema and maps each field to a spawn flag. A "perfect" agent fits
that schema exactly and survives the extension's runtime rules — chiefly the
**leaf** rule below.

## The leaf rule (do not violate)

Every agent this extension spawns is a **leaf** — it has no children. The
extension always excludes its own widget (`subagent-widget`) from the spawned
child's extensions in full mode, and never lists it in `liteAllowedExt` for
lite mode. So none of `subagent_create`, `subagent_continue`, `subagent_remove`,
`orchestrate`, `/sub*`, or `/subchain` exist inside the spawned agent. An agent
whose systemPrompt or task instructs it to spawn further subagents is broken by
construction — write it to do its own work, end to end, with the tools granted.
If the user's requirement is "an agent that orchestrates other agents", that is
a **chain template** (`~/.pi/agent/chains/*.yaml`), not a leaf agent — say so and
stop.

## How to author one

1. **Interview for the role.** Before writing anything, confirm with the user:
   the agent's single purpose (one verb), the tools it genuinely needs, and
   whether it will run standalone, as a chain step, or both. Do not guess — a
   leaf agent with the wrong tool allowlist is the most common failure.
   Completion criterion: you can state the agent's purpose in one sentence and
   list its tools, before writing.

2. **Map requirements to schema fields** using the reference below. Deny-first
   (`disallowedTools`) when excluding a couple of tools from a broad set; allowlist
   (`tools`) when the agent needs only a few. Pick `model` only if a specific
   model is required for cost/speed — otherwise omit (default model).

3. **Write via the `subagent_build` tool**, not by hand. It validates the name
   regex, writes exactly the schema the extension parses, and verifies the file
   is discoverable. Hand-writing is acceptable only if `subagent_build` is
   unavailable; match the field names and comma-list format exactly.

4. **Verify.** Reload catalog (`subagent_catalog`) — the agent appears with its
   description. Smoke-test with a trivial task: `/sub <name> "say hi"` (standalone)
   or as a one-step chain. Completion criterion: the agent spawns, produces a
   result, and its follow-up message names the agent correctly.

## Schema reference

The extension parses frontmatter via `parseFrontmatter`; list fields are
comma-separated and trimmed. The body (after the closing `---`) is the
`systemPrompt`, written to a temp file and passed via `--append-system-prompt`.

- **`name`** (required) — the filename. Regex `^[a-z0-9][a-z0-9-]*$`: lowercase,
  alphanumerics, hyphens. Becomes `<name>.md`. Must be unique across user +
  project agent dirs.
- **`description`** (required) — one line, shown in the catalog and the chain
  picker. Front-load the agent's leading purpose word. Not a trigger list;
  it describes what the agent _is_.
- **systemPrompt** (required, the body) — the agent's identity, role, and
  constraints. Chain-position context ("you are step 2 of 3") is _merged into
  this file at spawn_ (the extension appends chain context before writing the
  temp file, because pi keeps only the first `--append-system-prompt`). So bake
  the agent's permanent identity here; never put step position or per-run input
  in the systemPrompt — input arrives via the task (chain `{previous}` / `{input}`
  are substituted into the _task_, not the system prompt).
- **`tools`** (optional, comma-list) — allowlist → `--tools`. In lite mode, if
  omitted, defaults to `read,bash,grep,find,ls`. In full mode, omitted = full
  toolset.
- **`disallowedTools`** (optional, comma-list) — denylist → `--exclude-tools`,
  applied _after_ the `tools` allowlist. Deny-first when pruning a few tools
  from a broad set.
- **`model`** (optional) — `provider/id` or `provider/id:thinking`. Omit for
  the default model. In lite mode the provider must be in `config.json`
  `liteAllowedExt` to load; `npm:pi-neuralwatt-provider` is present by default.
- **`extensions`** (optional, comma-list) — additive `-e` over the mode base.
  Never drops the provider. Filtered against the disallow list, so listing
  `subagent-widget` is a silent no-op (the leaf rule enforces this). Prefer
  leaving empty unless the agent needs a specific provider/extension.
- **`skills`** (optional, comma-list) — `--skill` additive. In lite mode,
  `--no-skills` is the default _unless_ the agent lists skills here. Skills are
  prompts, not code — not a recursion vector, never filtered.
- **`worktree`** (optional, `true`/`false`) — force git-worktree isolation for
  this named agent (chain step or `/sub <name>`) even when `config.json`
  `worktree` is `"off"`. No effect in a non-git cwd, and anonymous spawns
  (`subagent_create` without a named agent) ignore it. Set only if the agent
  mutates files and must not touch the shared tree.

## Mode matrix (what actually loads)

- **Lite** (`/sublite`, lite chain, or `lite:true`): `--no-extensions`,
  `--thinking off`, restricted toolset. Only `config.json` `liteAllowedExt`
  extensions load (default `npm:pi-neuralwatt-provider`), plus the agent's own
  `extensions`. A lite agent needing a non-default model must ensure that
  provider is in `liteAllowedExt`.
- **Full** (`/sub`, `<name>` as a chain step, `subagent_create` without lite):
  pi discovers all extensions; if the disallow list matches, the spawn is
  sandboxed to survivors + neuralwatt injected unless the user disallowed it.
  The agent's `extensions` add via `-e`. The widget is always excluded (leaf
  rule).

## Field-level checklist (run before finishing)

- `name` matches `^[a-z0-9][a-z0-9-]*$` and is not already taken.
- `description` is one line, leading word front-loaded.
- systemPrompt states a single purpose and never instructs spawning subagents.
- `tools` or `disallowedTools` contains only tool names that exist in the child's
  mode (don't list `subagent_create` etc. — they don't exist in a leaf and the
  entry is a no-op that signals a misunderstanding).
- If the agent is a chain step, its identity is in systemPrompt and its input
  arrives via the task — not the other way around.
- `extensions` does not include `subagent-widget`.

## Anti-patterns

- An agent whose systemPrompt says "spawn a subagent to handle X" — violates the
  leaf rule; refactor to do X itself.
- A broad `tools` allowlist when the agent only reads — use `tools: read, grep,
find, ls, bash` (the scout pattern), deny `edit, write`.
- Baking step position ("you are step 1") into systemPrompt — it belongs in the
  chain template's `task`, which the extension merges at spawn.
- Omitting `model`/`extensions` for a lite agent that needs a non-default
  provider — the provider must be in `liteAllowedExt`, or the agent fails to
  load a model.
