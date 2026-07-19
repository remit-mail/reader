import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
	closureViolations,
	importSpecifiers,
	loadWorkspace,
	typesPackageOf,
} from "./publish-closure.mjs";

const specs = (source) => importSpecifiers(source).map((s) => `${s.typeOnly ? "type " : ""}${s.spec}`);

describe("importSpecifiers", () => {
	it("reads value and type-only imports", () => {
		assert.deepEqual(specs(`import { a } from "pkg";`), ["pkg"]);
		assert.deepEqual(specs(`import type { A } from "pkg";`), ["type pkg"]);
		assert.deepEqual(specs(`export type { A } from "pkg";`), ["type pkg"]);
		assert.deepEqual(specs(`export { a } from "pkg";`), ["pkg"]);
		assert.deepEqual(specs(`import "side-effect";`), ["side-effect"]);
	});

	it("reads dynamic import() and require()", () => {
		assert.deepEqual(specs(`const x = await import("pkg");`), ["pkg"]);
		assert.deepEqual(specs(`const y = require("pkg");`), ["pkg"]);
	});

	it("does not treat a bare from/require token as an import", () => {
		assert.deepEqual(specs(`const e = Buffer.from("FAKE:");`), []);
		assert.deepEqual(specs("sql`select x from \"thread_message_fts\" where y`"), []);
		assert.deepEqual(specs(`const s = "select a from b";`), []);
	});

	it("ignores imports inside comments", () => {
		assert.deepEqual(specs(`// import x from "commented";\nimport { a } from "real";`), ["real"]);
		assert.deepEqual(specs(`/* from "block" */\nimport type { A } from "real";`), ["type real"]);
	});

	it("treats a mixed inline-type import as a value import", () => {
		assert.deepEqual(specs(`import { type A, b } from "pkg";`), ["pkg"]);
	});
});

describe("typesPackageOf", () => {
	it("maps plain and scoped names", () => {
		assert.equal(typesPackageOf("better-sqlite3"), "@types/better-sqlite3");
		assert.equal(typesPackageOf("@aws-sdk/client-kms"), "@types/aws-sdk__client-kms");
	});
});

const makeRepo = () => {
	const root = mkdtempSync(join(tmpdir(), "closure-fixture-"));
	const write = (name, manifest, files) => {
		const dir = join(root, "packages", name);
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
		for (const [rel, content] of Object.entries(files ?? {})) {
			const path = join(dir, "src", rel);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
		}
	};
	return { root, write };
};

const violationsFor = (root, name) => {
	const { workspaceNames, manifests } = loadWorkspace(root);
	const manifest = manifests.get(name);
	return closureViolations({
		manifest,
		pkgDir: join(root, workspaceNames.get(name)),
		workspaceNames,
		manifests,
		repoRoot: root,
	});
};

describe("closureViolations", () => {
	const repos = [];
	const build = () => {
		const repo = makeRepo();
		repos.push(repo);
		return repo;
	};
	after(() => {
		for (const repo of repos) rmSync(repo.root, { recursive: true, force: true });
	});

	it("passes when every imported module is declared", () => {
		const { root, write } = build();
		write(
			"clean",
			{
				name: "@remit/clean",
				dependencies: { "p-map": "^7", "@remit/leaf": "*" },
				peerDependencies: { react: "^19" },
			},
			{ "index.ts": `import pMap from "p-map";\nimport "react";\nimport { x } from "@remit/leaf";` },
		);
		write("leaf", { name: "@remit/leaf" });
		assert.deepEqual(violationsFor(root, "@remit/clean"), {
			undeclared: [],
			missingTypes: [],
			closed: [],
		});
	});

	it("flags a runtime value import left in devDependencies", () => {
		const { root, write } = build();
		write(
			"svc",
			{ name: "@remit/svc", devDependencies: { "openapi-backend": "*" } },
			{ "index.ts": `import { OpenAPIBackend } from "openapi-backend";` },
		);
		assert.deepEqual(violationsFor(root, "@remit/svc").undeclared, ["openapi-backend"]);
	});

	it("flags an @types package that a runtime import needs but sits in dev", () => {
		const { root, write } = build();
		write(
			"native",
			{
				name: "@remit/native",
				dependencies: { "better-sqlite3": "^12" },
				devDependencies: { "@types/better-sqlite3": "^7" },
			},
			{ "index.ts": `import Database from "better-sqlite3";` },
		);
		const v = violationsFor(root, "@remit/native");
		assert.deepEqual(v.undeclared, []);
		assert.deepEqual(v.missingTypes, ["@types/better-sqlite3"]);
	});

	it("requires @types, not the runtime module, for a type-only DefinitelyTyped import", () => {
		const { root, write } = build();
		write(
			"lambda",
			{ name: "@remit/lambda", devDependencies: { "@types/aws-lambda": "*" } },
			{ "index.ts": `import type { SQSEvent } from "aws-lambda";\nexport type E = SQSEvent;` },
		);
		const v = violationsFor(root, "@remit/lambda");
		assert.deepEqual(v.undeclared, []);
		assert.deepEqual(v.missingTypes, ["@types/aws-lambda"]);
	});

	it("requires a self-typed type-only module to be declared", () => {
		const { root, write } = build();
		write(
			"smithy",
			{ name: "@remit/smithy" },
			{ "index.ts": `import type { DocumentType } from "@smithy/types";\nexport type D = DocumentType;` },
		);
		assert.deepEqual(violationsFor(root, "@remit/smithy").undeclared, ["@smithy/types"]);
	});

	it("ignores test, spec and test-* harness files", () => {
		const { root, write } = build();
		write(
			"tested",
			{ name: "@remit/tested" },
			{
				"index.ts": `export const x = 1;`,
				"thing.test.ts": `import EmbeddedPostgres from "embedded-postgres";`,
				"test-db.ts": `import { pushSchema } from "drizzle-kit/api";`,
				"repos/test-helpers.ts": `import EmbeddedPostgres from "embedded-postgres";`,
			},
		);
		assert.deepEqual(violationsFor(root, "@remit/tested").undeclared, []);
	});

	it("flags an import of a private workspace package", () => {
		const { root, write } = build();
		write("consumer", { name: "@remit/consumer" }, { "index.ts": `import { x } from "@remit/secret";` });
		write("secret", { name: "@remit/secret", private: true });
		assert.deepEqual(violationsFor(root, "@remit/consumer").closed, ["@remit/secret"]);
	});

	it("counts a module value-imported anywhere as a value import", () => {
		const { root, write } = build();
		// Type-only in one file, dynamic value import in another -> runtime required.
		write(
			"mixed",
			{ name: "@remit/mixed", devDependencies: { "drizzle-orm": "^0.45" } },
			{
				"types.ts": `import type { NodePgDatabase } from "drizzle-orm";\nexport type T = NodePgDatabase;`,
				"run.ts": `export const load = () => import("drizzle-orm");`,
			},
		);
		assert.deepEqual(violationsFor(root, "@remit/mixed").undeclared, ["drizzle-orm"]);
	});
});
