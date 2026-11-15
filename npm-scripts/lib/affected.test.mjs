import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { affected, describeWorkspace } from "./affected.mjs";

const workspaces = [
	describeWorkspace("packages/data-ports", { name: "data-ports" }),
	describeWorkspace("packages/backend", {
		name: "backend",
		dependencies: { "data-ports": "*" },
		scripts: { "test:run": "vitest" },
	}),
	describeWorkspace("packages/web", {
		name: "web",
		dependencies: { "react-dom": "*" },
	}),
	describeWorkspace("packages/admin", {
		name: "admin",
		dependencies: { "react-dom": "*", "data-ports": "*" },
	}),
	describeWorkspace("packages/mcp", {
		name: "mcp",
		dependencies: { "react-dom": "*" },
		scripts: { "test:run": "vitest" },
	}),
];

const sides = (changed) => {
	const { frontend, backend } = affected(workspaces, changed);
	return { frontend, backend };
};

describe("affected", () => {
	it("keeps a frontend-only change off the backend suites", () => {
		assert.deepEqual(sides(["packages/web/src/app.tsx"]), {
			frontend: true,
			backend: false,
		});
	});

	it("keeps a backend-only change off the frontend suites", () => {
		assert.deepEqual(sides(["packages/backend/src/index.ts"]), {
			frontend: false,
			backend: true,
		});
	});

	it("reaches both sides through a package each depends on", () => {
		assert.deepEqual(sides(["packages/data-ports/src/index.ts"]), {
			frontend: true,
			backend: true,
		});
	});

	it("counts a frontend package with a backend suite as both", () => {
		assert.deepEqual(sides(["packages/mcp/src/app.tsx"]), {
			frontend: true,
			backend: true,
		});
	});

	it("treats a path outside every workspace as shared", () => {
		for (const path of [
			"package-lock.json",
			"typespec/main.tsp",
			".github/workflows/ci.yml",
		]) {
			assert.deepEqual(sides(["packages/web/src/app.tsx", path]), {
				frontend: true,
				backend: true,
			});
		}
	});

	it("treats a deleted workspace as shared", () => {
		assert.deepEqual(sides(["packages/gone/src/index.ts"]), {
			frontend: true,
			backend: true,
		});
	});

	it("runs everything for an empty range", () => {
		assert.deepEqual(sides([]), { frontend: true, backend: true });
	});
});
