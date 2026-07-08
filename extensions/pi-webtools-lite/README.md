# pi-webtools-lite

<div align="center">
  <a href="https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-web-tools">
    <picture>
      <img src="https://raw.githubusercontent.com/juicesharp/rpiv-mono/main/packages/rpiv-web-tools/docs/cover.png" alt="rpiv-web-tools cover" width="50%">
    </picture>
  </a>
</div>

Let the model search the web and read pages. `pi-webtools-lite` adds `web_search` and `web_fetch` tools to [Pi Agent](https://github.com/badlogic/pi-mono) backed by a **fallback chain** of providers (Firecrawl → Tavily → Jina) with a circuit breaker, plus `/web-tools` for interactive key/URL setup.

> **Fork note:** This is a local, standalone copy at `~/.pi/agent/extensions/pi-webtools-lite/`
> (forked from `@juicesharp/rpiv-web-tools`). It has no `@juicesharp/*` runtime dependency —
> `rpiv-config` is vendored in `rpiv-config.ts`. Config lives co-located with the
> extension at `~/.pi/agent/extensions/pi-webtools-lite/config.json` (chmod 0600).
> See [§ Install](#install).

![Provider selection prompt](https://raw.githubusercontent.com/juicesharp/rpiv-mono/main/packages/rpiv-web-tools/docs/config.jpg)

## Providers

The chain is **source-fixed**: `firecrawl → tavily → jina`. Firecrawl is the primary (always tried first); Tavily and Jina are fallbacks. See [§ Fallback chain](#fallback-chain--circuit-breaker).

| # | Provider | Env var | Signup | Keyless? | Fetch mode |
|---|---|---|---|---|---|
| 1 (primary) | Firecrawl | `FIRECRAWL_API_KEY` + `FIRECRAWL_API_URL` | [firecrawl.dev](https://firecrawl.dev) | **yes** (self-hosted w/o auth) | native extraction (markdown) |
| 2 (fallback) | Tavily | `TAVILY_API_KEY` | [tavily.com](https://tavily.com) | no — 1k credits/mo free | native extraction (markdown) |
| 3 (fallback) | Jina | `JINA_API_KEY` | [jina.ai/reader](https://jina.ai/reader) | **yes** (~20 RPM anonymous) | native extraction (markdown) |

Firecrawl also supports a **custom/self-hosted URL** via `FIRECRAWL_API_URL` env or `baseUrls.firecrawl` in config (defaults to `https://api.firecrawl.dev/v1`).

## Fallback chain + circuit breaker

- **Chain order** is `firecrawl → tavily → jina`, tried in order on each call. Firecrawl (primary) is always tried first; if it fails, the next provider serves.
- **Circuit breaker**: 3 **consecutive** in-scope failures trips a provider; once tripped it's skipped for the rest of the current agent turn, then traffic routes to the next. Any success resets the counter.
- **What counts as a failure (strike)**: timeout (60s per call), transport/network errors, HTTP **401/403** (dead key), **429** (quota/rate-limit), **5xx**. A bad request (400/404) or a provider-level logical failure (empty body, `success:false`) does **not** strike — it advances the chain without counting.
- **Unconfigured ≠ failed**: a `requiresKey` provider (Tavily) with no key is skipped silently (no strike — a config gap, not a failure). Firecrawl and Jina run keyless.
- **Fetch role-aware**: `web_fetch` falls back only to providers that implement fetch (all three do today; a future search-only fallback would be silently skipped for fetch but still serve search).
- **Exhaustion**: if every provider is tripped (or none serves), the call fails and propagates the last error. No infinite loop, no per-request retry across providers.
- **Re-arm per prompt**: breakers reset at the start of each of your prompts (on `before_agent_start`), so a provider that recovered mid-session is retried first again on your next message. A dead primary burns only 3 fast failures per prompt before falling back.

Trade-off: the chain is source-fixed for simplicity. To change order or add a provider, edit `providers/factory.ts`'s `REGISTERED` (registration order IS priority — append one line to add a last-resort provider).

## Features

- **Read any URL** - fetch http/https pages with HTML-to-text extraction, or get the raw response with `raw: true` (honoured by Brave/Serper/Perplexity/SearXNG; extraction providers — Tavily/Exa/You.com/Jina/Firecrawl/Ollama — always return their parsed text).
- **GitHub URL interceptor (opt-in)** - github.com URLs route through `gh`/`git` for full repository content (file tree, README, individual file contents) instead of the rendered HTML page. Off by default; enable per-user via config or per-consumer at registration time. See [§GitHub URL interceptor](#github-url-interceptor).
- **Large-page spillover** - oversized responses truncate inline and spill the full body to a temp file the model can read on demand.
- **SSRF guard** - refuses loopback, RFC 1918, link-local, and cloud-metadata addresses (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`).
- **Interactive setup** - `/web-tools` lists providers (active one first, configured ones marked) and writes to `~/.pi/agent/extensions/pi-webtools-lite/config.json` (chmod 0600); per-provider env vars also work and take precedence over persisted keys.

## Install

This is a local standalone fork — there's no `pi install` step. The package lives at
`~/.pi/agent/extensions/pi-webtools-lite/` and Pi auto-discovers it (extensions placed at
`~/.pi/agent/extensions/<name>/index.ts` are loaded as global extensions). Activate edits
with `/reload` or by restarting your Pi session.

The `@juicesharp/rpiv-config` runtime dependency was removed and vendored locally as
`rpiv-config.ts` — byte-identical logic to upstream's `config.ts`, trimmed to just the
symbols this package uses (`configPath`, `loadJsonConfig`, `saveJsonConfig`,
`GuidanceFields` / `GuidanceFieldsSchema`, `validateGuidanceFields`). Config still reads
from and writes to `~/.pi/agent/extensions/pi-webtools-lite/config.json` exactly as before.

## Tools

- **`web_search`** - query the active provider's search API and return titled snippets.
  1–10 results per call.
- **`web_fetch`** - read an http/https URL. Lookup order: opt-in URL interceptors
  (see [§GitHub URL interceptor](#github-url-interceptor)), then the active provider's native
  fetch endpoint when it has one (Tavily/Exa/You.com/Jina/Firecrawl/Ollama → vendor extraction;
  Brave/Serper/Perplexity/SearXNG → shared raw HTTP + HTML-to-text fallback). Large responses truncate
  inline and spill the full body to a temp file the model can read on demand.

### Schema - `web_search`

```ts
web_search({
  query: string,                    // natural-language query
  max_results?: number,             // 1-10, default 5
})
```

Returns:

```ts
{
  content: [{ type: "text", text: string }], // markdown list of "**title**\n url\n snippet"
  details: {
    query: string,
    backend: "brave" | "tavily" | "serper" | "exa" | "youcom" | "jina" | "firecrawl" | "perplexity" | "searxng" | "ollama",
    resultCount: number,
    results?: Array<{ title: string, url: string, snippet: string }>,
  }
}
```

Throws when the active provider's API key is unset (e.g. `EXA_API_KEY is not set`) or the provider's API returns a non-2xx response.

### Schema - `web_fetch`

```ts
web_fetch({
  url: string,                      // http or https only
  raw?: boolean,                    // true → return raw HTML; default false → strip to text
})
```

Returns:

```ts
{
  content: [{ type: "text", text: string }], // header (URL/title/content-type) + body
  details: {
    url: string,
    title?: string,                 // <title> element, if present (HTML, non-raw)
    contentType?: string,
    contentLength?: number,         // from Content-Length header
    truncation?: TruncationResult,  // present when body exceeded inline limits
    fullOutputPath?: string,        // temp-file path containing the un-truncated body
  }
}
```

Throws on invalid URL, non-http(s) protocol, private/loopback hostnames (SSRF guard), non-2xx response, or `image/` / `video/` / `audio/` content types. Extraction providers (Tavily/Exa/You.com/Jina/Firecrawl) additionally throw when the API returns an empty body or a vendor-level failure (e.g. Firecrawl `success: false`, Tavily `failed_results`).

## Commands

- **`/web-tools`** - pick the active provider and set its API key interactively.
  Providers already configured show `(configured)`; the active one is listed first with a `✓`.
  Pressing Enter on an empty input keeps the existing key for the chosen provider while
  persisting the provider switch. Pass `--show` to see all per-provider keys (masked), env var status,
  and current URL interceptor states (see [§GitHub URL interceptor](#github-url-interceptor)).

## API key resolution (per provider)

First match wins (per provider, queried independently as the chain advances):

1. The provider's environment variable: `FIRECRAWL_API_KEY`, `TAVILY_API_KEY`, or `JINA_API_KEY`
2. `apiKeys.<provider>` field in `~/.pi/agent/extensions/pi-webtools-lite/config.json`

Firecrawl's URL resolves from `FIRECRAWL_API_URL` env → `baseUrls.firecrawl` config → default `https://api.firecrawl.dev/v1`.

Firecrawl and Jina run **keyless** (`requiresKey:false`) — a key is optional (raises limits / enables cloud). Tavily requires a key; if none is resolved, the chain runner skips it without striking.

> `config.provider` is a historical vestige — the field is kept in the schema so existing configs still load, but its value is **ignored** at runtime. The chain is source-fixed.

## GitHub URL interceptor

Routes github.com URLs through `gh` / `git` to return repository content (file tree, README, file content) instead of the rendered HTML. **Off by default.** Opt in two ways:

```json
// ~/.pi/agent/extensions/pi-webtools-lite/config.json — end-user opt-in
{ "interceptors": { "github": true } }
```

```ts
// or per-consumer at registration time (user config still wins)
registerWebTools(pi, { interceptors: { github: true } });
```

When enabled, github.com URLs are parsed into `owner/repo/ref/path`; non-code paths (`/issues`, `/pulls`, `/discussions`, `/releases`, …) fall through to the active provider. The interceptor probes for `gh`, falls back to plain `git clone` (with a stderr hint to install `gh`), and uses the `gh api` JSON view for SHA-pinned URLs and repos above `maxRepoSizeMB`. Shallow clones (`--depth 1 --single-branch`) land in `clonePath`; successful clones cache by `owner/repo@ref` for the session. Auth flows through `gh`'s normal `GH_TOKEN`/`GITHUB_TOKEN` precedence — export `GITHUB_TOKEN` to reach private repos.

Replace the boolean shorthand with an object to tune the defaults; object form implies opt-in.

```json
{
  "interceptors": {
    "github": {
      "maxRepoSizeMB": 1000,
      "cloneTimeoutSeconds": 90,
      "clonePath": "/Users/me/.cache/pi-github-repos"
    }
  }
}
```

| Field | Default | Purpose |
|---|---|---|
| `enabled` | `false` (top-level) / `true` (inside object form) | Master switch |
| `maxRepoSizeMB` | `350` | Repos above this threshold skip the clone and use the API view |
| `cloneTimeoutSeconds` | `30` | Kill the clone process after this many seconds |
| `clonePath` | `$TMPDIR/pi-github-repos` | Where shallow clones land; one subdir per `owner/repo@ref` |

`/web-tools --show` reports the current state at the bottom of its output (resolved token masked, `clonePath`, `maxRepoSizeMB`). The SSRF guard still runs first — a URL with a private/loopback host can't bypass it via a github.com path shape.

## Executor guidance overrides

Override the `promptSnippet` / `promptGuidelines` the model sees for each tool by editing `~/.pi/agent/extensions/pi-webtools-lite/config.json`. Note the per-tool nesting under `guidance.web_search` / `guidance.web_fetch` — this differs from the flat `guidance` shape used by single-tool siblings (`rpiv-advisor`, `rpiv-todo`, `rpiv-ask-user-question`):

```json
{
  "provider": "exa",
  "apiKeys": {
    "exa": "sk-...",
    "brave": "sk-..."
  },
  "interceptors": {
    "github": true
  },
  "guidance": {
    "web_search": {
      "promptSnippet": "Search the web for current docs and library versions",
      "promptGuidelines": [
        "Only call web_search when training-data answers may be stale.",
        "Always include a Sources: section with markdown hyperlinks."
      ]
    },
    "web_fetch": {
      "promptSnippet": "Fetch a specific URL and read its content"
    }
  }
}
```

Each field is independent: omit one and the built-in default is kept. Invalid values (empty string, wrong type, empty array) silently fall back to defaults. Changes take effect on the next Pi session start.

The `interceptors` key is the GitHub URL interceptor opt-in — see [§GitHub URL interceptor](#github-url-interceptor) for the full schema (boolean shorthand or per-field overrides).

## Security note: `web_fetch` host guard

`web_fetch` refuses URLs targeting loopback (`localhost`, `127.0.0.0/8`, `::1`), RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, including cloud-metadata at `169.254.169.254`), and IPv6 unique-local / link-local (`fc00::/7`, `fe80::/10`). Attempts surface as `Refusing to fetch private/loopback address: <host>`. This blocks the most common SSRF class — direct-literal targeting of internal services or cloud-metadata endpoints — without preventing legitimate public-web fetches.

The guard is host-literal only; it does NOT resolve DNS or validate redirects. A public hostname that resolves to a private IP, or a public URL that 302-redirects to one, will still reach the target. For untrusted automation environments, layer an egress proxy or firewall on top.

## License

[![npm version](https://img.shields.io/npm/v/@juicesharp/rpiv-web-tools.svg)](https://www.npmjs.com/package/@juicesharp/rpiv-web-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MIT
