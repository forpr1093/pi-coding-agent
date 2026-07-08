export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	query: string;
	results: SearchResult[];
}

export interface FetchResponse {
	text: string;
	title?: string;
	contentType?: string;
	contentLength?: number;
}

// Role-split contracts. SearchProvider implementations expose `search()` only;
// FetchProvider implementations expose `fetch()` only; FullProvider is the
// intersection — both methods, for providers (Tavily, Exa, Jina, Firecrawl,
// Ollama) whose vendors have native fetch endpoints worth using directly.
// The orchestrator narrows on `"fetch" in provider` to dispatch.
export interface SearchProvider {
	readonly name: string;
	readonly label: string;
	readonly envVar: string;
	search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface FetchProvider {
	readonly name: string;
	readonly label: string;
	readonly envVar: string;
	fetch(url: string, raw: boolean, signal?: AbortSignal): Promise<FetchResponse>;
}

export type FullProvider = SearchProvider & FetchProvider;

export type ProviderRole = "search" | "fetch";

// ---------------------------------------------------------------------------
// PROVIDER_META + per-provider configure() contract
// ---------------------------------------------------------------------------

// User input from a ProviderConfigUi prompt. Both `null` and `undefined`
// indicate the user cancelled (different UI implementations may return
// either); use isCancellation() to test instead of comparing manually.
export type UserInput = string | null | undefined;

export function isCancellation(input: UserInput): input is null | undefined {
	return input == null;
}

// Minimal UI surface a provider's configure() helper is allowed to depend on.
// Intentionally narrow so providers/ stays free of web-tools internals (no
// circular import) and so the contract can grow deliberately if a future
// provider needs more.
export interface ProviderConfigUi {
	input(label: string, placeholder: string): Promise<UserInput>;
}

// What the orchestrator hands to configure(): the provider's currently
// persisted state (if any).
export interface ProviderConfigCurrent {
	baseUrl?: string;
	apiKey?: string;
}

// What configure() returns for the orchestrator to merge into WebToolsConfig.
// `null` apiKey = "leave unset"; absent baseUrl = "this provider has no URL
// knob"; whole-result `null` = "user cancelled, do not persist".
export interface ProviderConfigChange {
	baseUrl?: string;
	apiKey?: string | null;
}

// Per-provider metadata declared alongside each provider's class. Drives
// generic dispatch in web-tools.ts so adding a new provider doesn't require
// touching the orchestrator.
//
//   envVar          — the API-key env var (omit if the provider has no key)
//   baseUrlEnvVar   — the URL env var (set for self-hosted providers)
//   defaultBaseUrl  — fallback URL when neither env nor config supplies one
//   configure       — interactive setup; if present, /web-tools
//                     dispatches here instead of the default single-key prompt
export interface ProviderMeta {
	name: string;
	label: string;
	envVar?: string;
	baseUrlEnvVar?: string;
	defaultBaseUrl?: string;
	// Which role(s) the provider plays. Search-only providers (Brave, Serper,
	// SearXNG) carry ["search"]; full providers (Tavily, Exa, Jina, Firecrawl,
	// Ollama) carry ["search", "fetch"]. The orchestrator does not consult
	// `roles` at runtime — capability is checked structurally via
	// `"fetch" in provider` — but `roles` keeps the META honest and unblocks
	// future UX (e.g. a fetch-role picker).
	roles: ReadonlyArray<ProviderRole>;
	configure?(ui: ProviderConfigUi, current: ProviderConfigCurrent): Promise<ProviderConfigChange | null>;
}

// ---------------------------------------------------------------------------
// Typed provider errors (D5) — each provider maps its failure outcomes to a
// kind; the circuit breaker classifies via `instanceof ProviderError` +
// kind, with no message parsing. Kinds split into STRIKE (provider-down:
// trip the breaker) and SKIP (request/URL problem: advance the chain but
// record no strike).
// ---------------------------------------------------------------------------
export type ProviderErrorKind =
	| "timeout" // per-call deadline (AbortSignal.timeout) fired
	| "transport" // fetch rejected: DNS, ECONNREFUSED, reset, etc.
	| "auth" // 401 / 403 — dead or invalid key
	| "quota" // 429 — rate-limit / exhausted quota
	| "server" // 5xx — provider-side outage
	| "logical"; // 4xx-other, success:false, empty body — request/URL problem

// Kinds that count as a breaker strike. `logical` is deliberately excluded:
// a bad request / unscrapable URL is not evidence the provider is down, so
// trying it again on the next call is correct (no premature trip).
export const STRIKE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
	"timeout",
	"transport",
	"auth",
	"quota",
	"server",
]);

export class ProviderError extends Error {
	readonly kind: ProviderErrorKind;
	readonly providerName: string;
	readonly status?: number;
	constructor(
		message: string,
		opts: { kind: ProviderErrorKind; providerName: string; status?: number },
	) {
		super(message);
		this.name = "ProviderError";
		this.kind = opts.kind;
		this.providerName = opts.providerName;
		this.status = opts.status;
	}
}

// Map an HTTP status to a strike/skip kind. 4xx (excl. quota/auth) are
// `logical` → skip; 401/403 → auth; 429 → quota; 5xx → server.
export function kindFromStatus(status: number): ProviderErrorKind {
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "quota";
	if (status >= 500) return "server";
	return "logical";
}
