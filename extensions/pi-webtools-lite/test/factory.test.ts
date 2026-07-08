import { describe, expect, it } from "vitest";
import { createSearchProvider, FALLBACK_CHAIN, PROVIDERS, REGISTERED } from "../providers/factory.js";
import { FirecrawlProvider } from "../providers/firecrawl.js";
import { JinaProvider } from "../providers/jina.js";
import { TavilyProvider } from "../providers/tavily.js";

describe("REGISTERED / PROVIDERS / FALLBACK_CHAIN derivation", () => {
	it("chain is source-fixed: firecrawl → tavily → jina", () => {
		expect(FALLBACK_CHAIN).toEqual(["firecrawl", "tavily", "jina"]);
	});

	it("PROVIDERS mirrors REGISTERED meta, in order", () => {
		expect(PROVIDERS.map((p) => p.name)).toEqual(["firecrawl", "tavily", "jina"]);
		expect(PROVIDERS).toEqual(REGISTERED.map((r) => r.meta));
	});

	it("FALLBACK_CHAIN[0] is the primary (firecrawl)", () => {
		expect(FALLBACK_CHAIN[0]).toBe("firecrawl");
	});

	it("no requiresKey field — every provider is attempted by the chain", () => {
		for (const p of PROVIDERS) {
			expect("requiresKey" in p).toBe(false);
		}
	});

	it("firecrawl declares baseUrlEnvVar + defaultBaseUrl; tavily/jina do not", () => {
		const fc = PROVIDERS.find((p) => p.name === "firecrawl");
		expect(fc?.baseUrlEnvVar).toBe("FIRECRAWL_API_URL");
		expect(fc?.defaultBaseUrl).toBe("https://api.firecrawl.dev/v1");
		expect(PROVIDERS.find((p) => p.name === "tavily")?.baseUrlEnvVar).toBeUndefined();
		expect(PROVIDERS.find((p) => p.name === "jina")?.baseUrlEnvVar).toBeUndefined();
	});
});

describe("createSearchProvider", () => {
	it("constructs the right class per name", () => {
		expect(createSearchProvider("firecrawl", {})).toBeInstanceOf(FirecrawlProvider);
		expect(createSearchProvider("tavily", { apiKey: "k" })).toBeInstanceOf(TavilyProvider);
		expect(createSearchProvider("jina", {})).toBeInstanceOf(JinaProvider);
	});

	it("threads baseUrl into firecrawl (custom URL support)", () => {
		const fc = createSearchProvider("firecrawl", { baseUrl: "http://localhost:9999/v1" }) as FirecrawlProvider;
		// No public getter; assert via behavior — a request would target baseUrl.
		// Constructor stores it; we trust the field via a cast peek.
		expect((fc as unknown as { baseUrl: string }).baseUrl).toBe("http://localhost:9999/v1");
	});

	it("defaults firecrawl baseUrl to the official API", () => {
		const fc = createSearchProvider("firecrawl", {}) as unknown as { baseUrl: string };
		expect(fc.baseUrl).toBe("https://api.firecrawl.dev/v1");
	});

	it("throws on an unknown (deleted) provider name", () => {
		for (const deleted of ["brave", "serper", "exa", "youcom", "perplexity", "searxng", "ollama"]) {
			expect(() => createSearchProvider(deleted, {})).toThrow(/Unknown search provider/);
		}
	});
});
