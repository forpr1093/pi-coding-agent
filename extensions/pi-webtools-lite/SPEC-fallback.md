# SPEC — pi-webtools-lite: simplification + fallback chain

Personal fork of `@juicesharp/rpiv-web-tools` at `~/.pi/agent/extensions/pi-webtools-lite/`.
Two intertwined goals: **simplify** (delete providers not used) + **add one new
behavior** (automatic fallback chain) — the only net-new feature; everything else
below is deletion or the minimal wiring to support it.

---

## 1. Behavior preserved (identical to original)

These do NOT change — the fork behaves the same as upstream except for §2:

- `web_search` / `web_fetch` tool schemas, params, return envelopes, render hooks.
- Config file: `~/.pi/agent/extensions/pi-webtools-lite/config.json` (schema, read/write, fail-soft).
- `web_fetch` three-way dispatch: URL interceptors → provider native fetch → generic HTML fallback. Only the middle prong changes (now chain-aware, §2.4).
- SSRF guard (loopback / RFC1918 / link-local / cloud-metadata).
- Large-response truncation + temp-file spillover.
- GitHub URL interceptor (off by default; opt-in via `interceptors.github`).
- Executor guidance overrides (`guidance.web_search` / `guidance.web_fetch`).
- Per-provider creds resolution (env var → `apiKeys.<name>` → legacy `apiKey` for brave — but brave is deleted, §4).
- Loaded as a global extension via auto-discovery (`extensions/pi-webtools-lite/index.ts`).

---

## 2. NEW behavior — fallback chain with circuit breaker

### 2.1 Chain (hardcoded, derived from registration order)

```
firecrawl → tavily → jina
```

- Firecrawl is **primary** (chain[0]). Always tried first.
- The chain is NOT configurable (no `fallbacks` array in config, no `/web-tools` reorder). Source-owned.
- Declared once via the unified `REGISTERED` list (§3); `FALLBACK_CHAIN = REGISTERED.map(r => r.meta.name)`. Registration order IS priority — a comment marks this.

### 2.2 Failure contract — what counts as a "strike"

A provider call that throws AND the cause is one of:

| Class | Detected as | Counts? |
|---|---|---|
| Timeout | `AbortError` (from our per-call timeout, §2.6) | **strike** |
| Transport / network | `TypeError` (fetch rejected: DNS, ECONNREFUSED, reset) | **strike** |
| Auth dead | HTTP **401 / 403** | **strike** |
| Quota / rate-limit | HTTP **429** | **strike** |
| Server error | HTTP **5xx** | **strike** |

NOT counted (route to next provider in chain, but no strike):

| Class | Why no strike |
|---|---|
| Provider unconfigured (no key) | Not "down" — not provisioned. (§2.7 for detection.) |
| Bad request / not found | HTTP 400 / 404 — query/URL problem; another provider gives the same bad result. |
| Provider logical failure | `success: false`, empty body, malformed-but-2xx — query/URL problem, not provider-down. |

Rationale: the breaker answers "is THIS provider unavailable?" — not "was THIS one query unlucky?". Burning quota retrying a bad request across providers is noise.

### 2.3 Threshold — 3 consecutive strikes trips

- Per-provider counter (`Map<providerName, number>` + `tripped: Set<providerName>`), module-scoped in `breaker.ts`.
- `+1` on a strike; **reset to 0 on any success** (consecutive, not sliding-window — no timestamps/clock).
- Trips when counter reaches 3. A tripped provider is skipped on subsequent calls in the same QA turn.
- Total new runtime state: 1 int + 1 bool per provider. No timers, no scheduler.

### 2.4 Execution — search vs fetch

```
runSearch(query, maxResults, signal):
  for name in FALLBACK_CHAIN:
    if tripped(name): continue
    provider = instantiate(name)
    try:
      resp = provider.search(...)            // success → reset(name); return resp
    catch e:
      if strike(e): recordStrike(name)       // +1, maybe trip; continue
      else: continue                          // unconfigured/logical → continue, no strike
  // chain exhausted:
  throw lastError                            // §2.5

runFetch(url, raw, signal):
  for name in FALLBACK_CHAIN:
    if tripped(name): continue
    provider = instantiate(name)
    if !("fetch" in provider): continue      // role-aware skip: search-only providers can't fetch
    try:
      resp = provider.fetch(...)
    catch e:
      if strike(e): recordStrike(name); continue
      else: continue
  throw lastError                             // also thrown when no chain member implements fetch
```

`instantiate(name)` reuses the existing `resolveProviderApiKey` + `resolveProviderBaseUrl` (already generic over `PROVIDERS`) + `createSearchProvider`. **Zero new creds code.**

**Non-strike errors still advance the chain** (try the next provider) but record no strike — a scrape/parse failure may be provider-specific, so the next provider is worth trying. Bounded cost: ≤2 extra attempts for a genuinely-bad URL; if all return logical failures the call fails honestly (§2.5).

### 2.5 Exhaustion = honest failure (C2)

If every provider in the chain is tripped (or none implemented the needed role), the call **fails** — propagate the last thrown error verbatim. No infinite loop, no cross-provider retry of the same call. The tool surfaces the error to the agent as upstream does today.

### 2.6 Per-call timeout (NEW — see §5 open decision D1)

Today: `signal` is pi's user-cancel signal only; no deadline. Add a per-call timeout so "hung provider" is a strike class:

```ts
const CALL_TIMEOUT_MS = 60_000;
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)].filter(Boolean));
}
```

Passed to `provider.search`/`provider.fetch`. A timeout fires → `AbortError` → strike (§2.2). 60s per call chosen so a slow-but-working Firecrawl scrape doesn't trip; worst-case full failover ≈ 3×60 = 180s — conscious trade for not false-tripping slow scrapes.

### 2.7 Keyless-capable providers + `requiresKey` (D2 — confirmed)

`requiresKey?: boolean` on `ProviderMeta` (default `true`). Confirmed values:
- **firecrawl → `requiresKey: false`** — self-hosted/localhosted firecrawl can run **keyless**; cloud (api.firecrawl.dev) without a key returns 401 → auth strike → routes onward.
- **jina → `requiresKey: false`** — r.jina.ai / s.jina.ai run keyless at 20 RPM (genuine last-resort floor); a key only raises limits.
- **tavily → `requiresKey: true`** — needs a key; if none resolved, the chain runner **skips without attempting** (no strike, no thrown error).

Chain-runner entry logic:
```
for name in FALLBACK_CHAIN:
  meta = PROVIDERS[name]
  if isTripped(name): continue
  if meta.requiresKey && !keyResolved(name): continue   // skip, no strike
  provider = instantiate(name); attempt(...)
```

Verified in source — **jina.ts:47,82 AND firecrawl.ts:67,102 both carry the `if (!this.apiKey) throw "…is not set"` guard**, which blocks their keyless mode. With `requiresKey:false`, both guards are **removed** and the `Authorization` header made conditional (`...(apiKey ? { Authorization: \`Bearer ${apiKey}\` } : {})`). Net: localhosted-firecrawl-keyless works; cloud w/o key → 401 strike → routes; jina keyless 20 RPM works. Tavily's guard becomes unreachable (runner pre-skips unkeyed) — removed for consistency since D5 touches its throw sites anyway.

### 2.8 Recovery — reset per "QA session" (per user prompt)

- Hook: `pi.on("before_agent_start", ...)` — fires **once per user prompt** (payload includes raw prompt), BEFORE the agent loop begins. This is the user's "QA session" boundary.
- NOT `turn_start` (fires per model iteration *within* a loop — would re-arm mid-loop, violating "stay tripped until end of the loop").
- On `before_agent_start`: clear all counters + tripped set → every provider re-armed, tried first again next prompt.
- Within a loop: once tripped, stays tripped until that loop ends.
- Cost (conscious): a truly-dead firecrawl burns 3 fast failures each new prompt before falling back. For 429 (instant) that's ~free; acceptable trade for per-prompt recovery of a transiently-failed provider.

---

## 3. Simplification — unified registration (extensible)

Replaces the original's *two* parallel lists (factory `switch` + `PROVIDERS` literal) with **one**:

```ts
// providers/factory.ts
export interface Registration {
  meta: ProviderMeta;
  create: (creds: ProviderCredentials) => SearchProvider | FullProvider;
}

export const REGISTERED: Registration[] = [
  { meta: FIRECRAWL_PROVIDER_META, create: (c) => new FirecrawlProvider(c.apiKey ?? "", c.baseUrl ?? FIRECRAWL_DEFAULT_URL) },
  { meta: TAVILY_PROVIDER_META,    create: (c) => new TavilyProvider(c.apiKey ?? "") },
  { meta: JINA_PROVIDER_META,      create: (c) => new JinaProvider(c.apiKey ?? "") },
];

export const PROVIDERS: readonly ProviderMeta[] = REGISTERED.map(r => r.meta);
export const FALLBACK_CHAIN: readonly string[]  = REGISTERED.map(r => r.meta.name);

export function createSearchProvider(name, creds) {
  const r = REGISTERED.find(r => r.meta.name === name);
  if (!r) throw new Error(`Unknown search provider: "${name}"`);
  return r.create(creds);
}
```

- Net code **down** (deletes the 10-arm switch + the parallel `PROVIDERS` literal).
- Adding a future provider = write `providers/foo.ts` + append **one** line to `REGISTERED`. Automatically: selectable in `/web-tools`, instantiable, last in the fallback chain. Three behaviors, one registration point. Zero edits to breaker/chain code.

---

## 4. Firecrawl custom-URL (change to `providers/firecrawl.ts`)

Today: `const FIRECRAWL_API_URL = "http://localhost:3002/v1"` hardcoded (with `https://api.firecrawl.dev/v1` commented out). Constructor `(apiKey)`.

Change (mirror the searxng/ollama pattern):

- Constructor: `constructor(apiKey, baseUrl)` — `baseUrl` overrides the default.
- `FIRECRAWL_DEFAULT_URL = "https://api.firecrawl.dev/v1"`.
- `FIRECRAWL_PROVIDER_META`: add `baseUrlEnvVar: "FIRECRAWL_API_URL"`, `defaultBaseUrl: FIRECRAWL_DEFAULT_URL`, `requiresKey: false` (self-hosted can run keyless, §2.7).
- **Remove** the `if (!this.apiKey) throw "…is not set"` guards (search L67 / fetch L102) and make the `Authorization` header conditional so localhosted-firecrawl-keyless works; cloud w/o key → 401 strike.
  - (env var `FIRECRAWL_API_URL` matches the existing const; `baseUrls.firecrawl` in config; resolution via existing `resolveProviderBaseUrl`.)
- All `${FIRECRAWL_API_URL}/search` and `/scrape` → use `this.baseUrl`.

Behavior: official API (`api.firecrawl.dev`) by default; self-hosted/custom via `FIRECRAWL_API_URL` env or `baseUrls.firecrawl` config.

---

## 5. Decisions (confirmed — see interpretation notes on D4/D5)

**D1 — Call timeout value.** ✅ Confirmed: **60s** (`CALL_TIMEOUT_MS = 60_000`). Worst-case full failover ≈ 3×60 = 180s; trade-off accepted to avoid false-tripping on slow Firecrawl scrapes.

**D2 — Unconfigured detection.** ✅ Confirmed: `requiresKey` meta flag. firecrawl=**false** (self-hosted keyless), jina=**false** (keyless 20 RPM), tavily=**true** (skip-if-unkeyed). Verified jina+firecrawl both carry the key-guard → both removed (§2.7).

**D3 — `/web-tools` interactive flow.** ✅ Confirmed. Chain is fixed (no "pick active provider"). Prompt lists the fixed chain (1. Firecrawl 2. Tavily 3. Jina) → pick which to **configure** → set its key/URL (Firecrawl gets a URL prompt; Tavily/Jina key only). `--show` additionally prints per-provider **breaker state** (`ok` / `tripped (3 strikes)`).

**D4 — `config.provider` field.** ✅ Confirmed: **(α) vestige.** Field stays in the `WebToolsConfigSchema` (TypeBox) so existing user configs carrying `"provider": …` load without `Value.Check` failing. Its value is **never read at runtime** — the chain is always source-fixed from `REGISTERED` order (§3). No primary-override, no chain rotation. Verified the config is **extension-owned** (`~/.pi/agent/extensions/pi-webtools-lite/config.json` via vendored `configPath("rpiv-web-tools")`), not a global pi setting — so the field is purely the extension's own legacy data on disk.

**D5 — Error classification mechanism.** ✅ Interpreting "classify better" as: typed `ProviderError`. Define `class ProviderError extends Error { readonly kind: "timeout"|"transport"|"auth"|"quota"|"server"|"logical"; readonly status?: number }` in `providers/types.ts`. Each provider maps its outcomes: AbortError→`timeout`; fetch-reject (TypeError)→`transport`; 401/403→`auth`; 429→`quota`; 5xx→`server`; 4xx-other + `success:false` + empty body→`logical`. `classifyProviderError(err): "strike"|"skip"` (in `breaker.ts`) = `instanceof ProviderError && kind ∈ {timeout,transport,auth,quota,server} ? "strike" : "skip"`. Unknown non-ProviderError → `skip` (fail-soft, no false trips). Since throw sites are touched anyway, the `requiresKey:false` key-guard removals (§2.7) ride along at no extra cost. *If "classify better" meant only "refine the regex helper," veto and I'll drop to message-match.*

**D6 — Tests.** ✅ Confirmed: **remove** all existing `.test.ts` (`providers/config.test.ts`, `providers/interceptors/chain.test.ts`, `providers/interceptors/github.test.ts`) and **write fresh** vitest tests: (1) breaker state machine — 3-strike trip, success-resets, tripped-skip, `resetAll`; (2) `classifyProviderError` — each kind → strike/skip; (3) chain runner — routing on trip, exhaustion→last-error, role-aware fetch skip, `requiresKey` skip (no network, providers stubbed); (4) factory — `REGISTERED`/`PROVIDERS`/`FALLBACK_CHAIN` derivation + `createSearchProvider` lookup; (5) firecrawl baseUrl resolution. Note: `package.json` lacks `vitest` in devDependencies — add it so `npm test` runs (`scripts.test` already = `vitest run`).

---

## 6. Deletion list (what gets removed)

**Provider files (7 of 10):**
`providers/brave.ts`, `serper.ts`, `exa.ts`, `youcom.ts`, `perplexity.ts`, `searxng.ts`, `ollama.ts`

In `providers/factory.ts`: the 10-arm `switch` (replaced by `REGISTERED`, §3).
In `providers/index.ts`: every re-export + `PROVIDERS` entry for deleted providers; collapse to firecrawl/tavily/jina + the shared re-exports. Delete `configureSearxng`/`configureOllama` re-exports.
In `web-tools.ts`:
- `DEFAULT_PROVIDER_NAME` const → repoint to `FALLBACK_CHAIN[0]` ("firecrawl"); `instantiateActiveProvider` replaced by the chain runner.
- `instantiateActiveProvider` → replaced by chain runner (`breaker.ts` + `runSearch`/`runFetch`).
- The searxng/ollama branches in `/web-tools` flow + `formatShowConfigMessage`.
- `LEGACY_TOP_LEVEL_KEY_PROVIDER = "brave"` constant + the brave legacy-migration branch (brave deleted; the `apiKey` field stays schema-permitted but unused).

**README sections removed:** SearXNG (whole § incl. Docker guide), Ollama (whole §). Providers table trimmed to 3 rows (+ note firecrawl supports custom URL). New §: Fallback chain + breaker (the §2 contract, user-facing). Update Install § to note the fork already covers this.

---

## 7. Implementation order + verification

1. `breaker.ts` — `classifyProviderError`, state (Map/Set), `recordStrike`/`reset`/`isTripped`, `resetAll` (called by `before_agent_start` hook), `withTimeout`. → verify: unit-test the state machine (strike×3 trips; success resets; tripped skips; resetAll clears).
2. `providers/factory.ts` — `REGISTERED` + derived `PROVIDERS`/`FALLBACK_CHAIN`/`createSearchProvider`. → verify: `createSearchProvider("firecrawl"/"tavily"/"jina", …)` returns instances; unknown name throws.
3. `providers/firecrawl.ts` — constructor + baseUrl + meta. → verify: reads `FIRECRAWL_API_URL` env / `baseUrls.firecrawl` / default `api.firecrawl.dev`.
4. `providers/index.ts` — collapse re-exports to 3 providers + shared types.
5. Delete the 7 provider files + dead branches in `web-tools.ts`.
6. `web-tools.ts` — wire `runSearch`/`runFetch` (chain-aware) into the two tool `execute` handlers; rework `/web-tools` (D3) + `--show` breaker state; add `before_agent_start` hook to reset breaker.
7. Wire the reset hook in `index.ts` (`pi.on("before_agent_start", () => resetAllBreakers())`).
8. README rewrite (§6).
9. End-to-end: `/reload` → `web_search` with firecrawl keyed → returns results; unset firecrawl key → routes to tavily/jina without 3 strikes; force a 429 mock (or point firecrawl at a dead URL) → 3 strikes → routes to tavily; exhaust all → propagates last error.

**Success criteria:** `web_search`/`web_fetch` succeed as long as ANY chain provider is healthy; a single dead provider never fails a call; breaker resets each new user prompt; deleted providers leave no dangling imports/refs.

---

## 8. Explicitly out of scope (not built)

- Cross-provider retry of a *single* failed call (no per-request retry — only the 3-strike breaker + chain advance).
- Dynamic/reconfigurable chain order at runtime (chain is source-fixed; D3/D4).
- Sliding-window or time-based breaker recovery (consecutive + per-prompt reset only).
- Probe/half-open circuit state (no auto-recovery mid-loop beyond the per-prompt reset).
- Any change to fetch three-way dispatch beyond the middle prong becoming chain-aware.
- Vendoring/fixing `rpiv-test-utils` (pre-existing breakage; D6).
