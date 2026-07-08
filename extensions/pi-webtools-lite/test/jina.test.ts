import { describe, expect, it } from "vitest";
import { JinaProvider } from "../providers/jina.js";
import { ProviderError } from "../providers/types.js";

describe("JinaProvider key-guard (s.jina.ai search needs a key; r.jina.ai fetch does not)", () => {
	it("search() throws ProviderError(logical) when no key — actionable, not a raw 401", async () => {
		const jina = new JinaProvider("");
		await expect(jina.search("x", 5)).rejects.toMatchObject({
			name: "ProviderError",
			kind: "logical",
			providerName: "jina",
		});
	});

	it("search() error message names the env var so the breaker classifies skip (no strike)", async () => {
		const jina = new JinaProvider("");
		await expect(jina.search("x", 5)).rejects.toThrow(/JINA_API_KEY is not set/);
	});

	it("search() still throws ProviderError(logical) — NOT a strike kind — so the chain routes onward", async () => {
		const jina = new JinaProvider("");
		try {
			await jina.search("x", 5);
		} catch (e) {
			expect(e).toBeInstanceOf(ProviderError);
			// STRIKE_KINDS excludes logical — confirms the chain treats this as skip.
			expect((e as ProviderError).kind).toBe("logical");
		}
	});

	// r.jina.ai (fetch) is genuinely keyless — NO guard. We assert the absence
	// of the guard in source so a future edit doesn't silently break keyless fetch.
	it("fetch() has no key-guard (r.jina.ai runs keyless) — source has no 'is not set' in fetch body", async () => {
		const fs = await import("node:fs");
		const src = fs.readFileSync(new URL("../providers/jina.ts", import.meta.url), "utf-8");
		const fetchBody = src.slice(src.indexOf("async fetch"));
		expect(fetchBody.includes("is not set")).toBe(false);
	});
});
