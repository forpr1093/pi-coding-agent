import type { ProviderMeta } from "./types.js";

export { createSearchProvider, FALLBACK_CHAIN, type ProviderCredentials, PROVIDERS, type Registration, REGISTERED } from "./factory.js";
export { FIRECRAWL_API_KEY_ENV_VAR, FIRECRAWL_BASE_URL_ENV_VAR, FIRECRAWL_DEFAULT_URL, FIRECRAWL_PROVIDER_META, FirecrawlProvider } from "./firecrawl.js";
// URL interceptors live in providers/interceptors/. The github primitives
// (parseGitHubUrl, GitHubUrlInfo, etc.) are re-exported from there.
export {
	clearCloneCache,
	GITHUB_TOKEN_ENV_VAR,
	GitHubInterceptor,
	type GitHubInterceptorOptions,
	type GitHubUrlInfo,
	parseGitHubUrl,
	type UrlInterceptor,
} from "./interceptors/index.js";
export { JINA_API_KEY_ENV_VAR, JINA_PROVIDER_META, JinaProvider } from "./jina.js";
export { TAVILY_API_KEY_ENV_VAR, TAVILY_PROVIDER_META, TavilyProvider } from "./tavily.js";
export type {
	FetchProvider,
	FetchResponse,
	FullProvider,
	ProviderConfigChange,
	ProviderConfigCurrent,
	ProviderConfigUi,
	ProviderMeta,
	ProviderRole,
	SearchProvider,
	SearchResponse,
	SearchResult,
	UserInput,
} from "./types.js";
export { STRIKE_KINDS, kindFromStatus, ProviderError } from "./types.js";
export type { ProviderErrorKind } from "./types.js";
