/**
 * Vendored from @juicesharp/rpiv-config (config.ts) — inlined so this
 * extension is standalone (no @juicesharp/* runtime dependency).
 *
 * Only the symbols this package actually uses are vendored:
 *   configPath, loadJsonConfig, saveJsonConfig,
 *   GuidanceFields (type) + GuidanceFieldsSchema, validateGuidanceFields.
 *
 * Byte-identical logic to the upstream source. Removed here (unused by
 * rpiv-web-tools runtime): modelKey, parseModelKey, readEnvVar, validateConfig.
 *
 * Source: https://github.com/juicesharp/rpiv-mono (packages/rpiv-config), MIT.
 *
 * Stateful-less than it looks: no module-level singletons, no globalThis
 * caches. Fail-soft contract preserved — malformed JSON / EISDIR / non-object
 * parsed values all degrade to `{}`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a config file path under `~/.config/<name>/`.
 *
 * @param name — package directory name (e.g. "rpiv-web-tools")
 * @param file — config filename (defaults to "config.json")
 * @returns absolute path to the config file
 */
export function configPath(name: string, file: string = "config.json"): string {
	return join(homedir(), ".config", name, file);
}

// ---------------------------------------------------------------------------
// JSON config load
// ---------------------------------------------------------------------------

/**
 * Load and parse a JSON config file.
 *
 * Returns `{}` for missing files, malformed JSON, or non-plain-object values.
 * The typeof guard fixes a latent bug where valid non-object JSON
 * (e.g. `"hello"`, `42`, `null`) passes through the cast. Arrays are also
 * rejected — `typeof [] === "object"` in JavaScript, but config files are
 * always plain objects.
 */
export function loadJsonConfig<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch (err) {
		// Diagnostic for malformed-JSON path. Warning is owner-only since the
		// file lives in the user's HOME.
		console.warn(`rpiv-config: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
		return {} as T;
	}
}

// ---------------------------------------------------------------------------
// JSON config save — best-effort boolean
// ---------------------------------------------------------------------------

/** File mode for config files (user read/write only). */
const CONFIG_FILE_MODE = 0o600;

/**
 * Persist a config object as formatted JSON. Returns `true` on successful
 * mkdir+write, `false` on filesystem failure (disk full, EACCES, EROFS, …).
 * Callers MUST guard success notifications on the boolean return.
 *
 * The chmod step is best-effort and never affects the return value: some
 * filesystems silently ignore chmod and there is no portable way to enforce
 * 0600 across platforms.
 */
export function saveJsonConfig(path: string, data: unknown): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
	} catch {
		return false;
	}
	try {
		chmodSync(path, CONFIG_FILE_MODE);
	} catch {
		// chmod may fail on some filesystems — best effort only, never gates success
	}
	return true;
}

// ---------------------------------------------------------------------------
// GuidanceFields
// ---------------------------------------------------------------------------

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

// TypeBox form of GuidanceFields. Mirrors the interface 1:1 — same fields,
// same optionality. `additionalProperties: true` lets consumers compose
// wrappers that may carry sibling-specific keys without leaking back here.
export const GuidanceFieldsSchema = Type.Object(
	{
		promptSnippet: Type.Optional(Type.String()),
		promptGuidelines: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: true },
);

/**
 * Validate and extract guidance fields from an unknown value.
 *
 * Returns a clean `GuidanceFields` object with only valid entries.
 */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	return result;
}
