/**
 * pi-webtools-lite — body
 *
 * Provides `web_search` and `web_fetch` tools backed by a fallback chain of
 * providers (Firecrawl → Tavily → Jina), plus the `/web-tools` slash command
 * for per-provider key/URL configuration. The chain is source-fixed (decision A);
 * a circuit breaker (breaker.ts) trips a provider after 3 consecutive
 * in-scope failures and routes to the next. Per-prompt re-arm happens on
 * `before_agent_start` (index.ts).
 *
 * API key resolution precedence per provider (first wins):
 *   1. Per-provider environment variable (e.g. FIRECRAWL_API_KEY, TAVILY_API_KEY)
 *   2. apiKeys[provider] field in ~/.pi/agent/extensions/pi-webtools-lite/config.json
 * Firecrawl/Jina run keyless (no guard); Tavily throws `logical skip` if
 * reached without a key → routes onward to Jina, no strike. Only firecrawl
 * need setup (key optional + URL); fallbacks are opt-in.
 * keys are optional and only raise limits / enable cloud access.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	classifyProviderError,
	breakerState,
	isTripped,
	recordStrike,
	recordSuccess,
	resetAllBreakers,
	trippedProviders,
	withCallTimeout,
} from "./breaker.js";
import { validateGuidanceFields } from "./rpiv-config.js";
import { getConfigPath, readConfig, type WebToolsConfig, writeConfig } from "./providers/config.js";
import { createSearchProvider, FALLBACK_CHAIN } from "./providers/factory.js";
import { fetchViaGenericHtml } from "./providers/fetch-helpers.js";
import { PROVIDERS } from "./providers/index.js";
import { GITHUB_TOKEN_ENV_VAR, getActiveGitHubInterceptor, getInterceptors } from "./providers/interceptors/index.js";
import type { FetchResponse, FullProvider, ProviderMeta, SearchProvider, SearchResponse, SearchResult } from "./providers/types.js";

// ---------------------------------------------------------------------------
// Tunables and external surface
// ---------------------------------------------------------------------------

const MIN_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_SEARCH_RESULTS = 5;

const SEARCH_RESULT_PREVIEW_LIMIT = 5;
const FETCH_PREVIEW_LINE_LIMIT = 15;
const API_KEY_MASK_VISIBLE_CHARS = 4;

const FETCH_TEMP_DIR_PREFIX = "rpiv-fetch-";
const FETCH_TEMP_FILE_NAME = "content.txt";

const CONFIG_PATH = getConfigPath();

const SUPPORTED_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const WEB_TOOLS_COMMAND_NAME = "web-tools";
const SHOW_FLAG = "--show";
const UNSET_LABEL = "(not set)";

// Chain[0] is the primary (always tried first). The chain itself is
// source-fixed in providers/factory.ts; this default is only used for
// display/back-compat — `config.provider` is no longer read at runtime.
const DEFAULT_PROVIDER_NAME = FALLBACK_CHAIN[0];

// ---------------------------------------------------------------------------
// Config persistence — schema + reader/writer live in providers/config.ts.
// The two local aliases keep the call-site shape identical to pre-refactor
// (loadConfig / saveConfig) so the rest of this file reads unchanged.
// ---------------------------------------------------------------------------

const loadConfig = readConfig;
const saveConfig = writeConfig;

// ---------------------------------------------------------------------------
// Executor guidance — overrides + defaults
// ---------------------------------------------------------------------------

// validateGuidanceFields is vendored locally in ./rpiv-config.ts (standalone)

export const DEFAULT_WEB_SEARCH_SNIPPET = "Search the web for up-to-date information";
export const DEFAULT_WEB_SEARCH_GUIDELINES: string[] = [
	"Use web_search for information beyond your training data — recent events, current library versions, live API documentation.",
	'Use the current year from "Current date:" in your context when searching for recent information or documentation.',
	'After answering using search results, include a "Sources:" section listing relevant URLs as markdown hyperlinks: [Title](URL). Never skip this.',
	"Domain filtering is supported to include or block specific websites.",
	"If no API key is configured, ask the user to run /web-tools before proceeding.",
];

export const DEFAULT_WEB_FETCH_SNIPPET = "Fetch and read content from a specific URL";
export const DEFAULT_WEB_FETCH_GUIDELINES: string[] = [
	"Use web_fetch to read the full content of a specific URL — documentation pages, blog posts, API references found via web_search.",
	"web_fetch is complementary to web_search: search finds URLs, fetch reads them.",
	'After answering using fetched content, include a "Sources:" section with a markdown hyperlink to the fetched URL.',
	"Large responses are truncated and spilled to a temp file — the temp path is reported in the result details.",
];

// ---------------------------------------------------------------------------
// API key resolution + masking
// ---------------------------------------------------------------------------

function resolveProviderApiKey(providerName: string, config: WebToolsConfig): string | undefined {
	const meta = PROVIDERS.find((p) => p.name === providerName);
	if (!meta) return undefined;

	const envKey = meta.envVar ? process.env[meta.envVar]?.trim() : undefined;
	if (envKey) return envKey;

	const configKey = config.apiKeys?.[providerName]?.trim();
	if (configKey) return configKey;

	return undefined;
}

// Generic per-provider base-URL resolution: env → config.baseUrls[name] →
// meta.defaultBaseUrl → "". Providers without baseUrlEnvVar (hosted ones)
// short-circuit to "". The orchestrator only calls this for providers that
// declare baseUrlEnvVar, so the empty-string fallback is a safety net rather
// than a runtime path.
function resolveProviderBaseUrl(meta: ProviderMeta, config: WebToolsConfig): string {
	if (!meta.baseUrlEnvVar) return "";
	const envUrl = process.env[meta.baseUrlEnvVar]?.trim();
	if (envUrl) return envUrl;
	const configUrl = config.baseUrls?.[meta.name]?.trim();
	if (configUrl) return configUrl;
	return meta.defaultBaseUrl ?? "";
}

// Instantiate a single provider by name — the chain runner drives WHICH
// name; creds resolution is the same env → config → default pipeline as the
// original. Firecrawl's resolved baseUrl (env/config/default) is threaded
// through createSearchProvider so its instances hit the configured endpoint.
function instantiateProvider(name: string, config: WebToolsConfig): SearchProvider | FullProvider {
	const apiKey = resolveProviderApiKey(name, config);
	const meta = PROVIDERS.find((p) => p.name === name);
	const baseUrl = meta?.baseUrlEnvVar ? resolveProviderBaseUrl(meta, config) : undefined;
	return createSearchProvider(name, { apiKey: apiKey ?? "", baseUrl });
}

// ---------------------------------------------------------------------------
// Fallback chain runner (circuit breaker — see breaker.ts)
//   firecrawl → tavily → jina, tried in registration order. A provider with
//   3 consecutive in-scope strikes is tripped and skipped for the rest of
//   this QA turn; `before_agent_start` (index.ts) re-arms everyone per prompt.
//   Exhaustion → last error propagates (no infinite loop, no per-request
//   retry across providers).
// ---------------------------------------------------------------------------

interface ChainOutcome<T> {
	providerName: string;
	result: T;
}

export async function runSearch(
	query: string,
	maxResults: number,
	config: WebToolsConfig,
	signal?: AbortSignal,
	// Test seam: defaults to the real instantiation; tests inject stub providers.
	providerLookup: (name: string, config: WebToolsConfig) => SearchProvider | FullProvider = instantiateProvider,
): Promise<ChainOutcome<SearchResponse>> {
	let lastError: unknown;
	for (const name of FALLBACK_CHAIN) {
		if (isTripped(name)) continue;
		// Honour a pre-flight cancel before attempting — don't burn a strike.
		if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
		const provider = providerLookup(name, config);
		const { signal: callSignal, timeoutSignal } = withCallTimeout(signal);
		try {
			const result = await provider.search(query, maxResults, callSignal);
			recordSuccess(name);
			return { providerName: name, result };
		} catch (err) {
			const action = classifyProviderError(err, timeoutSignal);
			if (action === "propagate") throw err;
			if (action === "strike") recordStrike(name);
			lastError = err;
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("All search providers failed or were unavailable");
}

export async function runFetch(
	url: string,
	raw: boolean,
	config: WebToolsConfig,
	signal?: AbortSignal,
	providerLookup: (name: string, config: WebToolsConfig) => SearchProvider | FullProvider = instantiateProvider,
): Promise<ChainOutcome<FetchResponse>> {
	let lastError: unknown;
	for (const name of FALLBACK_CHAIN) {
		if (isTripped(name)) continue;
		if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
		const provider = providerLookup(name, config);
		// Role-aware: search-only providers can't fetch. (No-op today — all 3
		// chain members are FullProvider — but a future search-only fallback
		// is silently skipped here with no other change.)
		if (!("fetch" in provider)) continue;
		const { signal: callSignal, timeoutSignal } = withCallTimeout(signal);
		try {
			const result = await provider.fetch(url, raw, callSignal);
			recordSuccess(name);
			return { providerName: name, result };
		} catch (err) {
			const action = classifyProviderError(err, timeoutSignal);
			if (action === "propagate") throw err;
			if (action === "strike") recordStrike(name);
			lastError = err;
		}
	}
	throw lastError instanceof Error ? lastError : new Error("No provider available to fetch the URL");
}

function maskApiKey(key: string | undefined): string {
	if (!key) return UNSET_LABEL;
	const head = key.slice(0, API_KEY_MASK_VISIBLE_CHARS);
	const tail = key.slice(-API_KEY_MASK_VISIBLE_CHARS);
	return `${head}...${tail}`;
}

function clampSearchResultCount(requested: number | undefined): number {
	const value = requested ?? DEFAULT_SEARCH_RESULTS;
	return Math.min(Math.max(value, MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
}

// ---------------------------------------------------------------------------
// URL guard
// ---------------------------------------------------------------------------

function isPrivateOrLoopbackHostname(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	// IPv6 loopback / unspecified / link-local / unique-local
	if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
	// IPv4 literals
	const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!v4) return false;
	const [a, b] = [Number(v4[1]), Number(v4[2])];
	if (a === 0 || a === 127 || a === 10) return true; // 0.0.0.0/8, loopback, RFC1918
	if (a === 169 && b === 254) return true; // link-local (incl. AWS metadata 169.254.169.254)
	if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
	if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
	return false;
}

function parseAndAssertHttpUrl(raw: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`Invalid URL: ${raw}`);
	}
	if (!SUPPORTED_HTTP_PROTOCOLS.has(parsed.protocol)) {
		throw new Error(`Unsupported URL protocol: ${parsed.protocol}. Only http and https are supported.`);
	}
	if (isPrivateOrLoopbackHostname(parsed.hostname)) {
		throw new Error(`Refusing to fetch private/loopback address: ${parsed.hostname}`);
	}
	return parsed;
}

// ---------------------------------------------------------------------------
// web_fetch helpers
// ---------------------------------------------------------------------------

interface FetchDetails {
	url: string;
	title?: string;
	contentType?: string;
	contentLength?: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

async function spillFullContentToTempFile(content: string): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), FETCH_TEMP_DIR_PREFIX));
	const tempFile = join(tempDir, FETCH_TEMP_FILE_NAME);
	await writeFile(tempFile, content, "utf8");
	return tempFile;
}

function formatTruncationFooter(truncation: TruncationResult, tempFile: string): string {
	const truncatedLines = truncation.totalLines - truncation.outputLines;
	const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
	return (
		`\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
		` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
		` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.` +
		` Full content saved to: ${tempFile}]`
	);
}

function formatFetchHeader(url: string, title: string | undefined, contentType: string): string {
	const lines = [`**Fetched:** ${url}`];
	if (title) lines.push(`**Title:** ${title}`);
	if (contentType) lines.push(`**Content-Type:** ${contentType}`);
	return `${lines.join("\n")}\n\n`;
}

// ---------------------------------------------------------------------------
// web_search result rendering
// ---------------------------------------------------------------------------

function formatSearchResultsBody(response: { query: string; results: SearchResult[] }): string {
	let text = `**Search results for "${response.query}":**\n\n`;
	response.results.forEach((r, i) => {
		text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
	});
	return text.trimEnd();
}

function buildEmptyResultsEnvelope(query: string, providerName: string) {
	return {
		content: [{ type: "text" as const, text: `No results found for "${query}".` }],
		details: { query, backend: providerName, resultCount: 0 },
	};
}

// ---------------------------------------------------------------------------
// Tool registrars
// ---------------------------------------------------------------------------

export function registerWebSearchTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadConfig().guidance?.web_search);

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for information. Returns a list of results with titles, URLs, and snippets. Use when you need current information not in your training data.",
		promptSnippet: guidance.promptSnippet ?? DEFAULT_WEB_SEARCH_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_WEB_SEARCH_GUIDELINES,
		parameters: Type.Object({
			query: Type.String({
				description: "The search query. Be specific and use natural language.",
			}),
			max_results: Type.Optional(
				Type.Number({
					description: `Maximum number of results to return (${MIN_SEARCH_RESULTS}-${MAX_SEARCH_RESULTS}). Default: ${DEFAULT_SEARCH_RESULTS}.`,
					default: DEFAULT_SEARCH_RESULTS,
					minimum: MIN_SEARCH_RESULTS,
					maximum: MAX_SEARCH_RESULTS,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const maxResults = clampSearchResultCount(params.max_results);
			const config = loadConfig();

			onUpdate?.({
				content: [{ type: "text", text: `Searching the web for: "${params.query}"...` }],
				details: { query: params.query, backend: FALLBACK_CHAIN[0], resultCount: 0 },
			});

			const { providerName, result: response } = await runSearch(params.query, maxResults, config, signal);

			if (response.results.length === 0) {
				return buildEmptyResultsEnvelope(params.query, providerName);
			}

			return {
				content: [{ type: "text", text: formatSearchResultsBody(response) }],
				details: {
					query: params.query,
					backend: providerName,
					resultCount: response.results.length,
					results: response.results,
				},
			};
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebSearch "));
			text += theme.fg("accent", `"${args.query}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching..."), 0, 0);
			}
			const details = result.details as { resultCount?: number; results?: SearchResult[] };
			const count = details?.resultCount ?? 0;
			let text = theme.fg("success", `✓ ${count} result${count !== 1 ? "s" : ""}`);
			if (expanded && details?.results) {
				text += renderSearchResultsPreview(details.results, theme);
			}
			return new Text(text, 0, 0);
		},
	});
}

function renderSearchResultsPreview(results: SearchResult[], theme: Theme): string {
	let text = "";
	for (const r of results.slice(0, SEARCH_RESULT_PREVIEW_LIMIT)) {
		text += `\n  ${theme.fg("dim", `• ${r.title}`)}`;
	}
	if (results.length > SEARCH_RESULT_PREVIEW_LIMIT) {
		text += `\n  ${theme.fg("dim", `... and ${results.length - SEARCH_RESULT_PREVIEW_LIMIT} more`)}`;
	}
	return text;
}

export function registerWebFetchTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadConfig().guidance?.web_fetch);

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch the content of a specific URL. Returns text content for HTML pages (tags stripped), raw text for plain text or JSON. Supports http and https only. Content is truncated to avoid overwhelming the context window.",
		promptSnippet: guidance.promptSnippet ?? DEFAULT_WEB_FETCH_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_WEB_FETCH_GUIDELINES,
		parameters: Type.Object({
			url: Type.String({
				description: "The URL to fetch. Must be http or https.",
			}),
			raw: Type.Optional(
				Type.Boolean({
					description: "If true, return the raw HTML instead of extracted text. Default: false.",
					default: false,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { url, raw = false } = params;
			parseAndAssertHttpUrl(url);

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${url}...` }],
				details: { url } as FetchDetails,
			});

			const config = loadConfig();

			// Three-way dispatch:
			//   1. URL interceptors (currently just GitHub) — opt-in URL specialists
			//      that handle their own host pattern. Cheap-reject to null for
			//      unrelated URLs; empty chain (interceptor disabled) is a no-op.
			//   2. Provider native fetch via the fallback chain — firecrawl →
			//      tavily → jina, skipping tripped/unprovisioned/search-only.
			//   3. Generic HTML fallback — only if the chain threw (every provider
			//      exhausted); last-resort direct fetch so a dead vendor doesn't
			//      block a public URL.
			let fetchResponse: FetchResponse | undefined;
			for (const interceptor of getInterceptors()) {
				const r = await interceptor.intercept(url, { raw, signal });
				if (r) {
					fetchResponse = r;
					break;
				}
			}
			if (!fetchResponse) {
				try {
					fetchResponse = (await runFetch(url, raw, config, signal)).result;
				} catch {
					// chain exhausted — fall through to generic HTML
				}
			}
			if (!fetchResponse) {
				fetchResponse = await fetchViaGenericHtml(url, raw, signal);
			}
			const { text: bodyText, title, contentType, contentLength } = fetchResponse;

			const truncation = truncateHead(bodyText, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			const details: FetchDetails = {
				url,
				title,
				contentType,
				contentLength,
			};

			let output = truncation.content;
			if (truncation.truncated) {
				const tempFile = await spillFullContentToTempFile(bodyText);
				details.truncation = truncation;
				details.fullOutputPath = tempFile;
				output += formatTruncationFooter(truncation, tempFile);
			}

			return {
				content: [{ type: "text", text: formatFetchHeader(url, title, contentType ?? "") + output }],
				details,
			};
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebFetch "));
			text += theme.fg("accent", args.url);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}
			const details = result.details as FetchDetails | undefined;
			let text = theme.fg("success", "✓ Fetched");
			if (details?.title) text += theme.fg("muted", `: ${details.title}`);
			if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					text += renderFetchedContentPreview(content.text, theme);
				}
			}
			return new Text(text, 0, 0);
		},
	});
}

function renderFetchedContentPreview(content: string, theme: Theme): string {
	const lines = content.split("\n");
	const visible = lines.slice(0, FETCH_PREVIEW_LINE_LIMIT);
	let text = "";
	for (const line of visible) {
		text += `\n  ${theme.fg("dim", line)}`;
	}
	if (lines.length > FETCH_PREVIEW_LINE_LIMIT) {
		text += `\n  ${theme.fg("muted", "... (use read tool to see full content)")}`;
	}
	return text;
}

// ---------------------------------------------------------------------------
// /web-tools command
// ---------------------------------------------------------------------------

function formatShowConfigMessage(current: WebToolsConfig): string {
	const lines = ["Web search config:", `  config file: ${CONFIG_PATH}`];

	lines.push(`  chain (priority order): ${FALLBACK_CHAIN.join(" → ")}`);

	for (const meta of PROVIDERS) {
		const envKey = meta.envVar ? process.env[meta.envVar]?.trim() : undefined;
		const configKey = current.apiKeys?.[meta.name]?.trim();
		const resolved = envKey ?? configKey;
		lines.push(
			`  ${meta.name}: ${maskApiKey(resolved)} (env: ${maskApiKey(envKey)}, config: ${maskApiKey(configKey)})`,
		);
	}

	// One URL line per provider that declares baseUrlEnvVar (firecrawl today).
	for (const meta of PROVIDERS) {
		if (!meta.baseUrlEnvVar) continue;
		const envUrl = process.env[meta.baseUrlEnvVar]?.trim();
		const configUrl = current.baseUrls?.[meta.name]?.trim();
		const resolvedUrl = envUrl || configUrl || meta.defaultBaseUrl || "";
		const urlSource = envUrl ? "env" : configUrl ? "config" : "default";
		lines.push(`  ${meta.name} url: ${resolvedUrl} (source: ${urlSource})`);
	}

	lines.push("");
	lines.push("Circuit breaker:");
	for (const name of FALLBACK_CHAIN) {
		const st = breakerState(name);
		lines.push(`  ${name}: ${st.tripped ? `tripped (${st.strikes} strikes)` : `ok (${st.strikes} strikes)`}`);
	}
	const tripped = trippedProviders(FALLBACK_CHAIN as string[]);
	if (tripped.length > 0) lines.push(`  tripped this turn: ${tripped.join(", ")}`);
	lines.push("  breakers reset per prompt (on before_agent_start).");

	lines.push("");
	lines.push("URL interceptors:");
	const githubInterceptor = getActiveGitHubInterceptor();
	if (githubInterceptor) {
		const opts = githubInterceptor.resolvedOptions;
		const token = process.env[GITHUB_TOKEN_ENV_VAR]?.trim();
		lines.push(
			`  github: enabled (${GITHUB_TOKEN_ENV_VAR}: ${maskApiKey(token)}, maxRepoSizeMB: ${opts.maxRepoSizeMB}, clonePath: ${opts.clonePath})`,
		);
	} else {
		lines.push("  github: disabled");
		lines.push('  ↳ enable:  add  "interceptors": { "github": true }   to config.json');
		lines.push('  ↳ disable: set  "interceptors": { "github": false }  to override a consumer-enabled default');
	}

	return lines.join("\n");
}

export function registerWebSearchConfigCommand(pi: ExtensionAPI): void {
	pi.registerCommand(WEB_TOOLS_COMMAND_NAME, {
		description: "Configure the search provider and API key used by web_search",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui?.notify?.(`/${WEB_TOOLS_COMMAND_NAME} requires interactive mode`, "error");
				return;
			}

			const current = loadConfig();

			if (typeof args === "string" && args.includes(SHOW_FLAG)) {
				ctx.ui.notify(formatShowConfigMessage(current), "info");
				return;
			}

			// Firecrawl is the primary (configure it: URL + optional key).
			// Tavily/Jina are fallbacks — optional; throws if reached & unset,
			// but Firecrawl being healthy means they never run.
			const metaOf = PROVIDERS as readonly ProviderMeta[];
			const isPrimary = (name: string) => name === FALLBACK_CHAIN[0];
			const hasKey = (p: ProviderMeta) => resolveProviderApiKey(p.name, current) !== undefined;
			const hasCustomUrl = (p: ProviderMeta) =>
				Boolean(process.env[p.baseUrlEnvVar ?? ""]?.trim() || current.baseUrls?.[p.name]?.trim());
			const labelOf = (p: ProviderMeta) => {
				const markers: string[] = [];
				if (isPrimary(p.name)) markers.push("✓ primary (setup this)");
				else markers.push("fallback (optional)");
				if (hasKey(p)) markers.push("(key set)");
				if (p.baseUrlEnvVar && hasCustomUrl(p)) markers.push("(url set)");
				const st = breakerState(p.name);
				if (st.tripped) markers.push("[tripped]");
				return markers.length > 0 ? `${p.label} — ${markers.join(" ")}` : p.label;
			};

			const selectedLabel = await ctx.ui.select(
				"Configure which provider?",
				metaOf.map(labelOf),
				{},
			);
			if (selectedLabel === undefined || selectedLabel === null) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}
			const selectedMeta = metaOf.find((p) => selectedLabel === p.label || selectedLabel.startsWith(`${p.label} —`));
			if (!selectedMeta) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}
			const selected = selectedMeta.name;

			const toSave: WebToolsConfig = { ...current };

			// URL prompt for providers that declare one (firecrawl). Skipped for
			// pure key-only providers (tavily/jina).
			if (selectedMeta.baseUrlEnvVar) {
				const existingUrl = current.baseUrls?.[selected]?.trim() || selectedMeta.defaultBaseUrl || "";
				const urlInput = await ctx.ui.input(
					`${selectedMeta.label} URL`,
					existingUrl ? `Press Enter to keep (${existingUrl}), or type new URL` : selectedMeta.defaultBaseUrl ?? "...",
				);
				if (urlInput === undefined || urlInput === null) {
					ctx.ui.notify("Web search config unchanged", "info");
					return;
				}
				const urlTrim = urlInput.trim();
				if (urlTrim) toSave.baseUrls = { ...current.baseUrls, [selected]: urlTrim };
			}

			// Key prompt — optional for ALL providers. The primary (firecrawl)
			// self-hosted can run keyless; fallbacks (tavily/jina) are opt-in and
			// throw `logical skip` if reached & unset (routes onward, no strike).
			const existingKey = current.apiKeys?.[selected];
			const keyInput = await ctx.ui.input(
				`${selectedMeta.label} API key (optional)`,
				existingKey ? `Press Enter to keep current (${maskApiKey(existingKey)}), or type new key` : "...",
			);
			if (keyInput === undefined || keyInput === null) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}
			const keyTrim = keyInput.trim();
			if (keyTrim) toSave.apiKeys = { ...current.apiKeys, [selected]: keyTrim };
			else if (existingKey) toSave.apiKeys = { ...current.apiKeys, [selected]: existingKey };

			// `provider` is intentionally NOT written — it's a back-compat vestige
			// only (decision D4-α); the chain is source-fixed.
			delete (toSave as { apiKey?: string }).apiKey;
			if (!saveConfig(toSave)) {
				ctx.ui.notify(
					`Failed to save ${selectedMeta.label} config to ${CONFIG_PATH} — disk write failed`,
					"error",
				);
				return;
			}
			const bits: string[] = [];
			if (toSave.baseUrls?.[selected]) bits.push(`url: ${toSave.baseUrls[selected]}`);
			if (toSave.apiKeys?.[selected]) bits.push("key set");
			ctx.ui.notify(
				bits.length > 0
					? `Saved ${selectedMeta.label} config (${bits.join(", ")}) to ${CONFIG_PATH}`
					: `Saved ${selectedMeta.label} config to ${CONFIG_PATH}`,
				"info",
			);
		},
	});
}
