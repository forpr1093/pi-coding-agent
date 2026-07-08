import { type FetchResponse, type FullProvider, ProviderError, kindFromStatus, type SearchResponse, type SearchResult } from "./types.js";

const TAVILY_API_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_API_URL = "https://api.tavily.com/extract";
export const TAVILY_API_KEY_ENV_VAR = "TAVILY_API_KEY";
export const TAVILY_PROVIDER_META = {
	name: "tavily",
	label: "Tavily",
	envVar: TAVILY_API_KEY_ENV_VAR,
	roles: ["search", "fetch"] as const,
} as const;

interface TavilyRawResult {
	title?: string;
	url?: string;
	content?: string;
}

interface TavilyRawResponse {
	results?: TavilyRawResult[];
	detail?: string;
	error?: string;
}

interface TavilyExtractResult {
	url?: string;
	raw_content?: string;
}

interface TavilyExtractResponse {
	results?: TavilyExtractResult[];
	failed_results?: Array<{ url?: string; error?: string }>;
}

function normalizeTavilyResults(results: TavilyRawResult[]): SearchResult[] {
	return results.map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.content ?? "",
	}));
}

export class TavilyProvider implements FullProvider {
	readonly name = TAVILY_PROVIDER_META.name;
	readonly label = TAVILY_PROVIDER_META.label;
	readonly envVar = TAVILY_PROVIDER_META.envVar;

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) {
			// Un-configured fallback: throw `logical` so the chain classifies as
			// skip and routes onward (no strike). The error surfaces only if the
			// whole chain exhausts. Firecrawl is the only primary providers need
			// setup; this is a fallback the user opted not to configure.
			throw new ProviderError(`${this.envVar} is not set. Run /web-tools to configure, or export the env var.`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		const res = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				api_key: this.apiKey,
				query,
				max_results: maxResults,
			}),
			signal,
		});

		if (!res.ok) {
			const text = await res.text();
			throw new ProviderError(`${this.label} Search API error (${res.status}): ${text}`, {
				kind: kindFromStatus(res.status),
				providerName: this.name,
				status: res.status,
			});
		}

		const raw = (await res.json()) as TavilyRawResponse;
		return { query, results: normalizeTavilyResults(raw.results ?? []) };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		if (!this.apiKey) {
			throw new ProviderError(`${this.envVar} is not set. Run /web-tools to configure, or export the env var.`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		// Bearer header per current Tavily docs. Existing search() above still
		// sends `api_key` in body (legacy form Tavily continues to accept).
		const res = await fetch(TAVILY_EXTRACT_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				urls: [url],
			}),
			signal,
		});

		if (!res.ok) {
			const text = await res.text();
			throw new ProviderError(`${this.label} Fetch API error (${res.status}): ${text}`, {
				kind: kindFromStatus(res.status),
				providerName: this.name,
				status: res.status,
			});
		}

		const data = (await res.json()) as TavilyExtractResponse;

		if (data.failed_results && data.failed_results.length > 0) {
			const failed = data.failed_results[0];
			throw new ProviderError(
				`${this.label} Fetch API error: extraction failed for ${failed.url ?? url}: ${failed.error ?? "unknown error"}`,
				{ kind: "logical", providerName: this.name },
			);
		}

		const result = data.results?.[0];
		if (!result?.raw_content) {
			throw new ProviderError(`${this.label} Fetch API error: no content returned for ${url}`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		return {
			text: result.raw_content,
			contentType: "text/plain",
		};
	}
}
