import { defineConfig } from "vitest/config";
import { createRequire } from "module";
import path from "node:path";

// This fork is a local, auto-discovered extension (no bundled node_modules).
// Its peer deps (typebox, @earendil-works/*) live in the pi npm workspace.
// Resolve them the same way pi does at runtime — keeps `npm test` working
// without a local `npm install`.
const NPM_DIR = path.resolve(process.env.HOME ?? "", ".pi/agent/npm/node_modules");
const require = createRequire(NPM_DIR + "/");

export default defineConfig({
	resolve: {
		alias: {
			// Subpaths MUST precede the bare `typebox` entry — vite alias matches
			// first-defined-wins, so the bare entry would otherwise prefix-capture
			// `typebox/value` and `typebox/compile` into invalid paths.
			"typebox/value": require.resolve("typebox/value"),
			"typebox/compile": require.resolve("typebox/compile"),
			typebox: require.resolve("typebox"),
			// pi-coding-agent is ESM-only under a restrictive exports map (no
			// `.` default condition), so require.resolve() can't see it — point
			// at the literal entry file instead.
			"@earendil-works/pi-coding-agent": path.join(
				NPM_DIR,
				"@earendil-works/pi-coding-agent/dist/index.js",
			),
			"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
		},
	},
	test: {
		include: ["**/*.test.ts"],
	},
});
