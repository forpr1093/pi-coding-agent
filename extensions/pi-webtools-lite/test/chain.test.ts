import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAllBreakers, breakerState, isTripped } from "../breaker.js";
import { ProviderError, type FullProvider, type SearchProvider, type SearchResponse, type FetchResponse } from "../providers/types.js";
import { runSearch, runFetch } from "../web-tools.js";

// runSearch/runFetch call isProvisioned(name, config), which resolves keys
// from env then config. keep a tavily key in config so it's "provisioned"
// unless a test overrides it; clear env so the host env can't leak in.
const TAVILY_KEY = "test-tavily-key";
const EMPTY_CONFIG = { apiKeys: { tavily: TAVILY_KEY } } as Parameters<typeof runSearch>[2];

beforeEach(() => {
	resetAllBreakers();
	// Clear any host env vars the creds resolver would read.
	for (const k of ["FIRECRAWL_API_KEY", "TAVILY_API_KEY", "JINA_API_KEY"]) delete process.env[k];
});

function authError(name: string): ProviderError {
	return new ProviderError(`${name} down`, { kind: "auth", providerName: name, status: 401 });
}
function logicalError(name: string): ProviderError {
	return new ProviderError(`${name} bad`, { kind: "logical", providerName: name, status: 400 });
}

// A stub provider. search/fetch throw or return fixed payloads; hasFetch
// controls whether `"fetch" in provider` is true (role-aware skip test).
function stub(name: string, opts: {
	searchThrows?: ProviderError;
	searchResult?: SearchResponse;
	fetchThrows?: ProviderError;
	fetchResult?: FetchResponse;
	hasFetch?: boolean;
} = {}): SearchProvider | FullProvider {
	const p: Record<string, unknown> = {
		name,
		label: name,
		envVar: "X",
		search: vi.fn(async () => {
			if (opts.searchThrows) throw opts.searchThrows;
			return opts.searchResult ?? { query: "q", results: [] };
		}),
	};
	if (opts.hasFetch !== false) {
		p.fetch = vi.fn(async () => {
			if (opts.fetchThrows) throw opts.fetchThrows;
			return opts.fetchResult ?? { text: "body" };
		});
	}
	return p as unknown as SearchProvider | FullProvider;
}

const okResult: SearchResponse = { query: "q", results: [{ title: "t", url: "u", snippet: "s" }] };

describe("runSearch — primary success", () => {
	it("uses firecrawl and never touches the fallbacks", async () => {
		const fc = stub("firecrawl", { searchResult: okResult });
		const tv = stub("tavily", { searchResult: okResult });
		const jn = stub("jina", { searchResult: okResult });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: jn })[n]!;
		const { providerName, result } = await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		expect(providerName).toBe("firecrawl");
		expect(result.results).toHaveLength(1);
		expect((fc.search as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
		expect((tv.search as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
		expect((jn.search as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
	});
});

describe("runSearch — trip + route to the next healthy provider", () => {
	it("trips firecrawl after 3 consecutive auth strikes, then skips it; tavily serves", async () => {
		const fc = stub("firecrawl", { searchThrows: authError("firecrawl") });
		const tv = stub("tavily", { searchResult: okResult });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: stub("jina") })[n]!;

		// Calls 1–2: firecrawl strikes (1, 2), tavily serves each time.
		await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		expect(breakerState("firecrawl")).toEqual({ strikes: 2, tripped: false });

		// Call 3: firecrawl's 3rd strike TRIPS it; tavily serves.
		await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		expect(isTripped("firecrawl")).toBe(true);

		// Call 4: firecrawl now SKIPPED (not even attempted) — tavily served
		// directly. tavily had successes so its own counter stayed at 0.
		await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		expect((fc.search as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3); // not 4
		expect(breakerState("tavily")).toEqual({ strikes: 0, tripped: false });
	});
});

describe("runSearch — exhaustion propagates the last error (C2)", () => {
	it("throws when every provider fails (no infinite loop)", async () => {
		const fc = stub("firecrawl", { searchThrows: authError("firecrawl") });
		const tv = stub("tavily", { searchThrows: authError("tavily") });
		const jn = stub("jina", { searchThrows: authError("jina") });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: jn })[n]!;
		await expect(runSearch("q", 5, EMPTY_CONFIG, undefined, lookup)).rejects.toThrow(/jina down/);
	});
});

describe("runSearch — logical errors advance the chain without striking", () => {
	it("firecrawl 400s (logical) → tavily serves; firecrawl NOT tripped", async () => {
		const fc = stub("firecrawl", { searchThrows: logicalError("firecrawl") });
		const tv = stub("tavily", { searchResult: okResult });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: stub("jina") })[n]!;
		const { providerName } = await runSearch("q", 5, EMPTY_CONFIG, undefined, lookup);
		expect(providerName).toBe("tavily"); // routed past firecrawl
		expect(breakerState("firecrawl")).toEqual({ strikes: 0, tripped: false }); // no strike
	});
});

describe("runSearch — unconfigured fallback throws `logical` → routes onward, no strike", () => {
	it("tavily has no key → throws logical (skip) → jina serves; tavily NOT tripped", async () => {
		const cfg = { apiKeys: {} } as Parameters<typeof runSearch>[2]; // no tavily key
		const fc = stub("firecrawl", { searchThrows: authError("firecrawl") }); // strike
		// Mirrors the real restored Tavily guard: throws logical when reached & unset.
		const tv = stub("tavily", { searchThrows: logicalError("tavily") });
		const jn = stub("jina", { searchResult: okResult });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: jn })[n]!;
		const { providerName } = await runSearch("q", 5, cfg, undefined, lookup);
		expect(providerName).toBe("jina"); // tavily threw-and-continued → jina
		expect((tv.search as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce(); // was attempted
		expect(breakerState("tavily")).toEqual({ strikes: 0, tripped: false }); // logical = no strike
		expect(breakerState("firecrawl")).toEqual({ strikes: 1, tripped: false }); // firecrawl did strike (auth)
	});
});

describe("runFetch — role-aware skip of search-only providers", () => {
	it("firecrawl fails → tavily (search-only, no fetch) skipped → jina fetch serves", async () => {
		const fc = stub("firecrawl", { fetchThrows: authError("firecrawl") });
		const tv = stub("tavily", { hasFetch: false }); // search-only
		const jn = stub("jina", { fetchResult: { text: "jina body" } });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: jn })[n]!;
		const { providerName, result } = await runFetch("http://x", false, EMPTY_CONFIG, undefined, lookup);
		expect(providerName).toBe("jina");
		expect(result.text).toBe("jina body");
		expect((tv.fetch as ReturnType<typeof vi.fn>)).toBeUndefined(); // never added
	});
});

describe("runFetch — exhaustion throws last error", () => {
	it("all fetches fail → rejects with last provider's error", async () => {
		const fc = stub("firecrawl", { fetchThrows: authError("firecrawl") });
		const tv = stub("tavily", { fetchThrows: authError("tavily") });
		const jn = stub("jina", { fetchThrows: authError("jina") });
		const lookup = (n: string) => ({ firecrawl: fc, tavily: tv, jina: jn })[n]!;
		await expect(runFetch("http://x", false, EMPTY_CONFIG, undefined, lookup)).rejects.toThrow(/jina down/);
	});
});

describe("user-cancel propagation", () => {
	it("a pre-aborted signal bails before any provider is attempted (no strike)", async () => {
		const fc = stub("firecrawl", { searchResult: okResult });
		const lookup = () => fc;
		const ctrl = new AbortController();
		ctrl.abort();
		await expect(runSearch("q", 5, EMPTY_CONFIG, ctrl.signal, lookup)).rejects.toMatchObject({ name: "AbortError" });
		expect((fc.search as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
		expect(breakerState("firecrawl")).toEqual({ strikes: 0, tripped: false });
	});
});
