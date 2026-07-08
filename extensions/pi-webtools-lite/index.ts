/**
 * pi-webtools-lite — Pi extension
 *
 * Registers the `web_search` and `web_fetch` tools, plus the
 * `/web-tools` slash command. Body lives in `web-tools.ts`.
 *
 * Config persists at ~/.pi/agent/extensions/pi-webtools-lite/config.json (path kept from the
 * upstream so existing keys survive the rename). Per-provider env
 * vars (e.g. FIRECRAWL_API_KEY, TAVILY_API_KEY, JINA_API_KEY) win over the
 * config file. Firecrawl/Jina also run keyless (no guard); Tavily throws
 * `logical skip` if reached without a key — routes onward, no strike.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resetAllBreakers } from "./breaker.js";
import { buildInterceptors } from "./providers/interceptors/index.js";
import { registerWebFetchTool, registerWebSearchConfigCommand, registerWebSearchTool } from "./web-tools.js";

export { createSearchProvider } from "./providers/factory.js";
export {
	GITHUB_TOKEN_ENV_VAR,
	GitHubInterceptor,
	type GitHubInterceptorOptions,
	type GitHubUrlInfo,
	parseGitHubUrl,
	resolveGitHubOptions,
	type UrlInterceptor,
} from "./providers/interceptors/index.js";

export type {
	FetchProvider,
	FetchResponse,
	FullProvider,
	SearchProvider,
	SearchResponse,
	SearchResult,
} from "./providers/types.js";
export {
	DEFAULT_WEB_FETCH_GUIDELINES,
	DEFAULT_WEB_FETCH_SNIPPET,
	DEFAULT_WEB_SEARCH_GUIDELINES,
	DEFAULT_WEB_SEARCH_SNIPPET,
	registerWebFetchTool,
	registerWebSearchConfigCommand,
	registerWebSearchTool,
	runFetch,
	runSearch,
} from "./web-tools.js";

// Programmatic consumer-side opt-in for URL interceptors. Tier 2 in the
// resolution model: end-user config (Tier 1) still wins. Default OFF —
// existing pi-webtools-lite users see zero behavior change.
export interface RegisterOptions {
	interceptors?: {
		github?: boolean;
	};
}

export default function registerWebTools(pi: ExtensionAPI, opts?: RegisterOptions): void {
	buildInterceptors(opts?.interceptors);
	registerWebSearchTool(pi);
	registerWebFetchTool(pi);
	registerWebSearchConfigCommand(pi);

	// Re-arm every provider's circuit breaker at the start of each user
	// prompt (one QA turn = one `before_agent_start`). A provider that
	// tripped in the previous turn gets retried first again this turn — so a
	// transiently-failed provider is picked back up without a pi restart.
	// NOT `turn_start`, which fires per model iteration within a loop and
	// would re-arm mid-loop.
	pi.on("before_agent_start", () => resetAllBreakers());
}
