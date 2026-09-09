#!/usr/bin/env node
// Clean-install acceptance for the publish surface: a directory outside the
// repo, holding one declared dependency — @remit/backend — must install and
// resolve backend's full transitive @remit closure. Each manifest declares its
// @remit imports, so one package drags in the rest; a name that fails to
// resolve is a manifest that would ship broken.
//
// The closure resolves to tarballs packed from this tree, not to the registry.
// Installing the published packages instead would assert registry state: every
// branch gets the same verdict, and a branch that fixes a broken publish can
// never pass. Only @remit/backend is declared; the rest arrive because backend
// declares them, and `overrides` redirects each @remit name to its local
// tarball whatever range the manifest asked for. Third-party dependencies still
// resolve off the public registry, so a bad range in a manifest — an
// unsatisfiable pin, an unbounded `*` that drifts onto a new major — fails here.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertCodegenRan,
	packClosure,
	remitClosure,
} from "./lib/remit-closure.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const INSTALLED = "@remit/backend";

// The names a consumer of @remit/backend must be able to resolve after
// installing it alone.
const RESOLVES = [
	"@remit/backend",
	"@remit/data-ports",
	"@remit/drizzle-service",
	"@remit/domain-enums",
	"@remit/api-openapi-types",
	"@remit/mailbox-service",
	"@remit/search-service",
	"@remit/storage-service",
	"@remit/auth-service",
	"@remit/secrets-service",
	"@remit/sqs-client",
	"@remit/mail-oauth-service",
	"@remit/logger-lambda",
	"@remit/api-zod-schemas",
	"@remit/drizzle-sqlite-schema",
];

const { workspace, generated } = remitClosure(repoRoot, INSTALLED);
assertCodegenRan(repoRoot, generated);

const tmp = mkdtempSync(join(tmpdir(), "remit-clean-install-"));
try {
	const packDir = join(tmp, "tarballs");
	mkdirSync(packDir);
	const tarballs = packClosure(repoRoot, [...workspace, ...generated], packDir);

	const consumer = join(tmp, "consumer");
	mkdirSync(consumer);
	writeFileSync(
		join(consumer, "package.json"),
		`${JSON.stringify(
			{
				name: "clean-install-consumer",
				version: "0.0.0",
				private: true,
				dependencies: { [INSTALLED]: `file:${tarballs.get(INSTALLED)}` },
				overrides: Object.fromEntries(
					[...tarballs].map(([name, path]) => [name, `file:${path}`]),
				),
			},
			null,
			2,
		)}\n`,
	);

	execFileSync(
		"npm",
		["install", "--loglevel=error", "--no-audit", "--no-fund"],
		{ cwd: consumer, stdio: "inherit" },
	);

	execFileSync(
		"node",
		["-e", `for (const p of ${JSON.stringify(RESOLVES)}) require.resolve(p)`],
		{ cwd: consumer, stdio: "inherit" },
	);

	console.log(
		`Clean-install acceptance OK: installing ${INSTALLED} from this tree resolves ` +
			`${RESOLVES.length} @remit packages.`,
	);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
