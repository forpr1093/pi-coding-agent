import { type FetchResponse, type FullProvider, ProviderError, kindFromStatus, type SearchResponse, type SearchResult } from "./types.js";

const JINA_SEARCH_API_URL = "https://s.jina.ai/";
const JINA_READER_API_URL = "https://r.jina.ai/";
export const JINA_API_KEY_ENV_VAR = "JINA_API_KEY";
export const JINA_PROVIDER_META = {
	name: "jina",
	label: "Jina",
	envVar: JINA_API_KEY_ENV_VAR,
	roles: ["search", "fetch"] as const,
} as const;

interface JinaSearchResult {
	title?: string;
	url?: string;
	description?: string;
}

interface JinaSearchResponse {
	code?: number;
	status?: number;
	data?:
		| JinaSearchResult[]
		| {
				query?: string;
				total?: number;
				results?: JinaSearchResult[];
		  };
}

function normalizeJinaResults(results: JinaSearchResult[]): SearchResult[] {
	return results.map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.description ?? "",
	}));
}

export class JinaProvider implements FullProvider {
	readonly name = JINA_PROVIDER_META.name;
	readonly label = JINA_PROVIDER_META.label;
	readonly envVar = JINA_PROVIDER_META.envVar;

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		// s.jina.ai (search) requires a key — unlike r.jina.ai (fetch), it is NOT
		// keyless. Throw `logical` (→ skip, no strike) if reached & unset so the
		// chain routes onward / exhausts with an actionable message instead of
		// a raw 401 from the network.
		if (!this.apiKey) {
			throw new ProviderError(`${this.envVar} is not set. Run /web-tools to configure, or export the env var.`, {
				kind: "logical",
				providerName: this.name,
			});
		}

		// Jina s.jina.ai uses the URL path for the query. The `num` query param
		// is not documented as supported — pass it for forward-compat, then
		// slice client-side so we always honor maxResults regardless of vendor
		// behavior.
		const url = new URL(`${JINA_SEARCH_API_URL}${encodeURIComponent(query)}`);
		url.searchParams.set("num", String(maxResults));

		const res = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
				...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
			},
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

		const raw = (await res.json()) as JinaSearchResponse;
		const results = normalizeJinaResults(Array.isArray(raw.data) ? raw.data : (raw.data?.results ?? [])).slice(
			0,
			maxResults,
		);
		return { query, results };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		// No Accept header = Reader returns markdown by default. Setting
		// Accept: text/plain would strip formatting and contradict the
		// contentType: "text/markdown" we report below.
		const res = await fetch(`${JINA_READER_API_URL}${url}`, {
			method: "GET",
			headers: {
				...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
			},
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

		const text = await res.text();
		if (!text.trim()) {
			throw new ProviderError(`${this.label} Fetch API error: no content returned for ${url}`, {
				kind: "logical",
				providerName: this.name,
			});
		}
		return {
			text,
			contentType: "text/markdown",
		};
	}
}
