import { FirecrawlProvider, FIRECRAWL_DEFAULT_URL, FIRECRAWL_PROVIDER_META } from "./firecrawl.js";
import { JinaProvider, JINA_PROVIDER_META } from "./jina.js";
import { TavilyProvider, TAVILY_PROVIDER_META } from "./tavily.js";
import type { FullProvider, SearchProvider } from "./types.js";

export interface ProviderCredentials {
	apiKey?: string;
	baseUrl?: string;
}

/**
 * A provider registration — the single source of truth. Drives PROVIDERS
 * (the `/web-tools` list), createSearchProvider (instantiation), AND
 * FALLBACK_CHAIN (priority order). Registration order IS fallback priority:
 * chain[0] is the primary, always tried first; subsequent entries are
 * tried in order when a prior provider trips the breaker.
 *
 * To add a provider later: write `providers/foo.ts`, export its META, then
 * append ONE line below. It's automatically selectable, instantiable, and
 * last in the fallback chain — zero edits elsewhere.
 */
export interface Registration {
	meta: (typeof FIRECRAWL_PROVIDER_META | typeof TAVILY_PROVIDER_META | typeof JINA_PROVIDER_META);
	create: (creds: ProviderCredentials) => SearchProvider | FullProvider;
}

export const REGISTERED: Registration[] = [
	{ meta: FIRECRAWL_PROVIDER_META, create: (c) => new FirecrawlProvider(c.apiKey ?? "", c.baseUrl ?? FIRECRAWL_DEFAULT_URL) },
	{ meta: TAVILY_PROVIDER_META, create: (c) => new TavilyProvider(c.apiKey ?? "") },
	{ meta: JINA_PROVIDER_META, create: (c) => new JinaProvider(c.apiKey ?? "") },
];

// Derived views — kept in sync with REGISTERED automatically.
export const PROVIDERS: readonly (typeof REGISTERED)[number]["meta"][] = REGISTERED.map((r) => r.meta);

/** Fallback priority order (chain[0] = primary). Source-fixed (decision A). */
export const FALLBACK_CHAIN: readonly string[] = REGISTERED.map((r) => r.meta.name);

export function createSearchProvider(name: string, creds: ProviderCredentials): SearchProvider | FullProvider {
	const r = REGISTERED.find((reg) => reg.meta.name === name);
	if (!r) throw new Error(`Unknown search provider: "${name}"`);
	return r.create(creds);
}
