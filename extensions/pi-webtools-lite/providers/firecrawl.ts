import { type FetchResponse, type FullProvider, ProviderError, kindFromStatus, type SearchResponse, type SearchResult } from "./types.js";

export const FIRECRAWL_DEFAULT_URL = "https://api.firecrawl.dev/v1";
export const FIRECRAWL_API_KEY_ENV_VAR = "FIRECRAWL_API_KEY";
export const FIRECRAWL_BASE_URL_ENV_VAR = "FIRECRAWL_API_URL";
export const FIRECRAWL_PROVIDER_META = {
	name: "firecrawl",
	label: "Firecrawl",
	envVar: FIRECRAWL_API_KEY_ENV_VAR,
	baseUrlEnvVar: FIRECRAWL_BASE_URL_ENV_VAR,
	defaultBaseUrl: FIRECRAWL_DEFAULT_URL,
	roles: ["search", "fetch"] as const,
} as const;

interface FirecrawlSearchResult {
	title?: string;
	url?: string;
	description?: string;
}

interface FirecrawlSearchResponse {
	success?: boolean;
	data?: FirecrawlSearchResult[];
	error?: string;
}

interface FirecrawlScrapeResponse {
	success?: boolean;
	data?: {
		markdown?: string;
		html?: string;
		metadata?: {
			title?: string;
			description?: string;
			language?: string;
			statusCode?: number;
		};
	};
	error?: string;
}

function normalizeFirecrawlResults(results: FirecrawlSearchResult[]): SearchResult[] {
	return results.map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.description ?? "",
	}));
}

export class FirecrawlProvider implements FullProvider {
	readonly name = FIRECRAWL_PROVIDER_META.name;
	readonly label = FIRECRAWL_PROVIDER_META.label;
	readonly envVar = FIRECRAWL_PROVIDER_META.envVar;

	/**
	 * @param apiKey optional Bearer token; required by cloud (api.firecrawl.dev),
	 *   optional for a self-hosted instance with auth disabled.
	 * @param baseUrl overrides FIRECRAWL_DEFAULT_URL (resolved from env/config in
	 *   web-tools before construction). Supports custom/self-hosted firecrawl.
	 */
	constructor(
		private readonly apiKey: string,
		private readonly baseUrl: string = FIRECRAWL_DEFAULT_URL,
	) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		const res = await fetch(`${this.baseUrl}/search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
			},
			body: JSON.stringify({
				query,
				limit: maxResults,
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

		const raw = (await res.json()) as FirecrawlSearchResponse;
		if (!raw.success) {
			throw new ProviderError(`${this.label} Search API error: ${raw.error ?? "search failed"}`, {
				kind: "logical",
				providerName: this.name,
			});
		}
		return { query, results: normalizeFirecrawlResults(raw.data ?? []) };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		const res = await fetch(`${this.baseUrl}/scrape`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
			},
			body: JSON.stringify({
				url,
				formats: ["markdown"],
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

		const raw = (await res.json()) as FirecrawlScrapeResponse;

		if (!raw.success) {
			throw new ProviderError(`${this.label} Fetch API error: ${raw.error ?? "scrape failed"}`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		if (!raw.data?.markdown) {
			throw new ProviderError(`${this.label} Fetch API error: no content returned for ${url}`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		return {
			text: raw.data.markdown,
			title: raw.data.metadata?.title || undefined,
			contentType: "text/markdown",
		};
	}
}
