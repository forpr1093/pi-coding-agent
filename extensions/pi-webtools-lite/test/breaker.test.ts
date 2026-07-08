import { describe, expect, it } from "vitest";
import {
	breakerState,
	classifyProviderError,
	isTripped,
	recordStrike,
	recordSuccess,
	resetAllBreakers,
	TRIP_THRESHOLD,
	withCallTimeout,
} from "../breaker.js";
import { ProviderError, type ProviderErrorKind, STRIKE_KINDS, kindFromStatus } from "../providers/types.js";

const T_NOT_ABORTED = { aborted: false } as AbortSignal;
const T_ABORTED = { aborted: true } as AbortSignal;

function pe(kind: ProviderErrorKind) {
	return new ProviderError("m", { kind, providerName: "x", status: 401 });
}

describe("STRIKE_KINDS / kindFromStatus", () => {
	it("maps HTTP statuses to strike/skip kinds", () => {
		expect(kindFromStatus(401)).toBe("auth");
		expect(kindFromStatus(403)).toBe("auth");
		expect(kindFromStatus(429)).toBe("quota");
		expect(kindFromStatus(500)).toBe("server");
		expect(kindFromStatus(503)).toBe("server");
		expect(kindFromStatus(400)).toBe("logical");
		expect(kindFromStatus(404)).toBe("logical");
	});

	it("strikes on timeout/transport/auth/quota/server; skips logical", () => {
		expect(STRIKE_KINDS.has("timeout")).toBe(true);
		expect(STRIKE_KINDS.has("transport")).toBe(true);
		expect(STRIKE_KINDS.has("auth")).toBe(true);
		expect(STRIKE_KINDS.has("quota")).toBe(true);
		expect(STRIKE_KINDS.has("server")).toBe(true);
		expect(STRIKE_KINDS.has("logical")).toBe(false);
	});
});

describe("classifyProviderError", () => {
	it("strikes on timeout (timeoutSignal aborted)", () => {
		expect(classifyProviderError(new Error("x"), T_ABORTED)).toBe("strike");
	});
	it("propagates user-cancel AbortError (no timeout)", () => {
		const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
		expect(classifyProviderError(abort, T_NOT_ABORTED)).toBe("propagate");
	});
	it("strikes on transport TypeError", () => {
		expect(classifyProviderError(new TypeError("fetch failed"), T_NOT_ABORTED)).toBe("strike");
	});
	it("strikes on provider-down kinds", () => {
		for (const k of ["auth", "quota", "server", "timeout", "transport"] as const) {
			expect(classifyProviderError(pe(k), T_NOT_ABORTED)).toBe("strike");
		}
	});
	it("skips on logical provider error", () => {
		expect(classifyProviderError(pe("logical"), T_NOT_ABORTED)).toBe("skip");
	});
	it("fails soft (skip) on unknown errors — no false trips", () => {
		expect(classifyProviderError(new Error("?"), T_NOT_ABORTED)).toBe("skip");
		expect(classifyProviderError("string error", T_NOT_ABORTED)).toBe("skip");
		expect(classifyProviderError(null, T_NOT_ABORTED)).toBe("skip");
	});
});

describe("breaker state machine", () => {
	const name = "firecrawl";

	it("trips after TRIP_THRESHOLD consecutive strikes", () => {
		resetAllBreakers();
		expect(recordStrike(name)).toBe(false);
		expect(breakerState(name)).toEqual({ strikes: 1, tripped: false });
		expect(recordStrike(name)).toBe(false);
		expect(recordStrike(name)).toBe(true); // 3rd strike trips
		expect(isTripped(name)).toBe(true);
		expect(breakerState(name)).toEqual({ strikes: TRIP_THRESHOLD, tripped: true });
	});

	it("a success resets the counter AND clears the trip", () => {
		resetAllBreakers();
		recordStrike(name);
		recordStrike(name);
		recordStrike(name);
		expect(isTripped(name)).toBe(true);
		recordSuccess(name);
		expect(breakerState(name)).toEqual({ strikes: 0, tripped: false });
		expect(isTripped(name)).toBe(false);
	});

	it("a mid-streak success fully re-arms (consecutive, not cumulative)", () => {
		resetAllBreakers();
		recordStrike(name);
		recordStrike(name);
		recordSuccess(name); // reset
		recordStrike(name); // back to 1
		expect(breakerState(name)).toEqual({ strikes: 1, tripped: false });
		expect(isTripped(name)).toBe(false);
	});

	it("resetAllBreakers clears every provider", () => {
		resetAllBreakers();
		recordStrike("firecrawl");
		recordStrike("firecrawl");
		recordStrike("firecrawl");
		recordStrike("tavily");
		expect(isTripped("firecrawl")).toBe(true);
		resetAllBreakers();
		expect(isTripped("firecrawl")).toBe(false);
		expect(isTripped("tavily")).toBe(false);
		expect(breakerState("jina")).toEqual({ strikes: 0, tripped: false });
	});
});

describe("withCallTimeout", () => {
	it("returns a combined signal + timeout signal", () => {
		const { signal, timeoutSignal } = withCallTimeout(undefined);
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(timeoutSignal).toBeInstanceOf(AbortSignal);
		expect(signal.aborted).toBe(false);
	});
	it("includes the caller's signal when provided", () => {
		const ctrl = new AbortController();
		const { signal } = withCallTimeout(ctrl.signal);
		ctrl.abort();
		expect(signal.aborted).toBe(true); // combined reflects user cancel
	});
});
