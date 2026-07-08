/**
 * Circuit breaker — per-provider consecutive-strike counter + trip state.
 *
 * State machine (resolves decisions D1/D2/D3):
 *   - 3 CONSECUTIVE in-scope strikes (D<threshold>) → trip; a tripped
 *     provider is skipped for the rest of the current QA turn.
 *   - Any success resets the counter AND clears the trip (D = consecutive,
 *     not sliding-window — no timestamps/clock).
 *   - Reset hook fires on `before_agent_start` (one user prompt = one QA
 *     turn): `resetAllBreakers()` re-arms every provider for the new turn,
 *     so a provider that recovered mid-session is retried first again.
 *
 * Classification (D5, typed errors): a `ProviderError` with a STRIKE kind
 * trips; `logical` kinds advance the chain without striking. Timeouts
 * (our per-call deadline) strike; user-cancel aborts PROPAGATE (no strike,
 * bail the whole call). Unknown errors fail-soft → skip (no false trips).
 *
 * Pure + stateless except the two module-scoped Maps: no timers, no
 * scheduler, no clock. That's the whole recovery mechanism.
 */

import { ProviderError, STRIKE_KINDS } from "./providers/types.js";

/** Strikes before a provider trips (consecutive). */
export const TRIP_THRESHOLD = 3;

/** Per-call deadline. 60s chosen so slow but healthy Firecrawl scrapes
 * don't false-trip; worst-case full failover ≈ 3 × 60 = 180s. */
export const CALL_TIMEOUT_MS = 60_000;

type ProviderName = string;

const counters = new Map<ProviderName, number>();
const tripped = new Set<ProviderName>();

export type Classification = "strike" | "skip" | "propagate";

/**
 * Classify a thrown provider error into breaker action.
 *
 * Order matters: the timeout-signal check comes first because a timeout
 * surfaces as an AbortError — but it's OUR deadline, not a user cancel.
 */
export function classifyProviderError(err: unknown, timeoutSignal: AbortSignal): Classification {
	// 1. Our per-call deadline fired → strike (hung provider).
	if (timeoutSignal.aborted) return "strike";
	// 2. AbortError without our timeout → user cancelled the tool call.
	//    Propagate immediately; don't burn strikes on every provider in the
	//    chain (the signal stays aborted, so they'd all fail identically).
	if (err instanceof Error && err.name === "AbortError") return "propagate";
	// 3. Transport / network failure (fetch rejected: DNS, ECONNREFUSED, reset).
	// Node's fetch wraps these in a TypeError.
	if (err instanceof TypeError) return "strike";
	// 4. Typed provider error — strike only for provider-down kinds.
	if (err instanceof ProviderError) {
		return STRIKE_KINDS.has(err.kind) ? "strike" : "skip";
	}
	// 5. Unknown (non-ProviderError, non-abort) → fail-soft, no false trip.
	return "skip";
}

/** Record a strike; returns true if this strike TRIPPED the provider. */
export function recordStrike(providerName: string): boolean {
	const n = (counters.get(providerName) ?? 0) + 1;
	counters.set(providerName, n);
	if (n >= TRIP_THRESHOLD) {
		tripped.add(providerName);
		return true;
	}
	return false;
}

/** Record a success — resets the counter AND clears any trip. */
export function recordSuccess(providerName: string): void {
	counters.set(providerName, 0);
	tripped.delete(providerName);
}

export function isTripped(providerName: string): boolean {
	return tripped.has(providerName);
}

export interface BreakerState {
	strikes: number;
	tripped: boolean;
}

export function breakerState(providerName: string): BreakerState {
	return { strikes: counters.get(providerName) ?? 0, tripped: tripped.has(providerName) };
}

/** Tripped providers, in registration order — for `/web-tools --show`. */
export function trippedProviders(registered: readonly string[]): readonly string[] {
	return registered.filter((n) => tripped.has(n));
}

/** Reset the whole breaker map — called on `before_agent_start` (new QA turn). */
export function resetAllBreakers(): void {
	counters.clear();
	tripped.clear();
}

/** Per-call timeout: our deadline combined with pi's user-cancel signal. */
export function withCallTimeout(signal?: AbortSignal): {
	signal: AbortSignal;
	timeoutSignal: AbortSignal;
} {
	const timeoutSignal = AbortSignal.timeout(CALL_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	return { signal: combined, timeoutSignal };
}
