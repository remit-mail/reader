import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Person } from "@remit/api-openapi-types";
import {
	createAuth,
	createPeopleDirectory,
	openIdentityStore,
	type PeopleAdmin,
	type PeopleDirectory,
} from "@remit/auth-service";
import type {
	ClassificationDefaultStore,
	RemitClient,
} from "@remit/backend/create-remit-client";
import { handlers, publicHandlers } from "@remit/backend/handlers";
import type { ApiConfig, UserIdentity } from "@remit/backend/serve";
import { serveApi } from "@remit/backend/serve";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	createSqliteRepositories,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
} from "@remit/drizzle-service";
import { migrateSqlite, openSqlite } from "@remit/drizzle-service/sqlite";
import {
	createShippedSqliteDb,
	sharedDatabases,
} from "@remit/drizzle-service/test-sqlite";
import { createSecretsService } from "@remit/secrets-service";
import { createClient } from "../../../build/remit-client/client/index.js";
import { MCP_OPERATOR_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler } from "./server.js";

const ORIGIN = "https://operator.remit.test";
const PASSWORD = "correct horse battery staple";
const MIGRATIONS = fileURLToPath(
	new URL("../../../deploy/vps/migrations-sqlite/", import.meta.url),
);

const config: ApiConfig = {
	auth: { mode: "GatewayAuthorizer" },
	corsAllowedOrigins: [],
	publicOrigin: ORIGIN,
	contentDeliveryDomain: ORIGIN,
	msOAuth: { mode: "Disabled" },
	selfUpdate: "Disabled",
	updateControlDir: "/tmp/unused",
	commit: "test",
	responseValidation: "Skip",
};

type ToolResult = { isError?: boolean; content: { text: string }[] };

let directory: PeopleAdmin;
let dir: string;
let caller: UserIdentity;
let target: Person;
let handler: ReturnType<typeof createMcpHandler>;

const rpc = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<unknown> => {
	const response = await handler(
		new Request("https://mcp.remit.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name, arguments: args },
			}),
		}),
	);
	const body = (await response.json()) as {
		result?: ToolResult;
		error?: { code: number; message: string };
	};
	assert.ok(body.result, body.error?.message ?? "tool call failed");
	assert.notEqual(body.result.isError, true, body.result.content[0]?.text);
	return JSON.parse(body.result.content[0]?.text ?? "null");
};

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "mcp-operator-tools-"));
	const identityFile = join(dir, "identity.db");
	const sqlite = openSqlite({ filename: identityFile, mode: "create" });
	for (const set of ["app", "mcp"]) {
		migrateSqlite(sqlite, {
			migrationsFolder: join(MIGRATIONS, set),
			migrationsTable: `__drizzle_migrations_${set}`,
		});
	}
	sqlite.close();
	const identityStore = await openIdentityStore(identityFile);
	const auth = await createAuth(
		{
			connectionString: identityFile,
			secret: "operator-tool-test-secret-value-32chars",
			baseURL: ORIGIN,
			selfSignUpEnabled: true,
			signInEnabled: true,
		},
		identityStore,
	);
	directory = await createPeopleDirectory({
		auth,
		store: identityStore,
		baseURL: ORIGIN,
	});
	const signUp = async (email: string): Promise<Person> => {
		const response = await auth.api.signUpEmail({
			body: { email, password: PASSWORD, name: email },
			asResponse: true,
		});
		assert.equal(response.status, 200);
		const userId = ((await response.json()) as { user: { id: string } }).user
			.id;
		const listed = await directory.listPeople({
			callerId: userId,
			clientIp: "127.0.0.1",
		});
		assert.equal(listed.ok, true);
		return listed.ok
			? (listed.value.find((person) => person.userId === userId) as Person)
			: (undefined as never);
	};
	const callerPerson = await signUp("operator@example.test");
	target = await signUp("person@example.test");
	directory.applySignInSwitch(false);
	caller = {
		kind: "user",
		accountConfigId: deriveAccountConfigId(callerPerson.userId),
		sub: callerPerson.userId,
		email: callerPerson.email,
	};

	const database = createShippedSqliteDb();
	const repositories = createSqliteRepositories(
		sharedDatabases(database),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);
	await repositories.accountConfig.create({
		accountConfigId: deriveAccountConfigId(target.userId),
		userId: target.userId,
	});
	let savedDefault:
		| Awaited<ReturnType<ClassificationDefaultStore["get"]>>["value"]
		| null = null;
	const classificationDefault: ClassificationDefaultStore = {
		get: async () => ({
			value: savedDefault ?? { state: "None" },
			source: savedDefault === null ? "Config" : "Operator",
		}),
		put: async (value) => {
			savedDefault = value;
		},
		delete: async () => {
			savedDefault = null;
		},
	};
	const dataKey = randomBytes(32);
	const client = {
		...repositories,
		classificationDefault,
		getClassificationDefault: async () =>
			(await classificationDefault.get()).value,
		secrets: createSecretsService({
			generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
			decryptDataKey: async () => dataKey,
		}),
		spam: {
			spamPipeline: [{ name: "Inline", thresholds: { state: "Unset" } }],
		},
	} as unknown as RemitClient;
	const hostedDirectory: PeopleDirectory = {
		...directory,
		invitePerson: async ({ email }) => ({ ok: true, value: { email } }),
		revokeInvite: async ({ email }) => ({ ok: true, value: { email } }),
		resetPersonFactors: async () => ({ ok: true, value: target }),
		signOutPerson: async () => ({ ok: true, value: target }),
		updatePerson: async ({ status }) => ({
			ok: true,
			value: { ...target, status },
		}),
	};
	const api = serveApi({ handlers, publicHandlers });
	const operatorClient = createClient({
		baseUrl: ORIGIN,
		fetch: (request, init) =>
			api.handleFetch(
				request instanceof Request ? request : new Request(request, init),
				{
					config,
					client: async () => client,
					identity: async () => caller,
					operator: async () => true,
					peopleDirectory: async () => hostedDirectory,
				},
				"operator-tools-test",
			),
	});
	handler = createMcpHandler(
		{ userId: caller.sub, scopes: [MCP_OPERATOR_SCOPE] },
		{ operatorClient: () => operatorClient } as unknown as McpDeps,
		true,
	);
});

after(() => {
	directory.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("the operator tools over sqlite dependencies", () => {
	it("runs the classification, tenant, and People operations without exposing a key", async () => {
		await rpc("get_classification_default");
		const classification = await rpc("set_classification_default", {
			presetId: ClassificationPresetId.Local,
			model: "local-model",
			baseUrl: "http://localhost:11434/v1",
			apiKey: "test-only-key",
			enabled: true,
			dailyLimit: 10,
		});
		assert.doesNotMatch(
			JSON.stringify(classification),
			/"apiKey"|test-only-key/,
		);
		await rpc("clear_classification_default");

		await rpc("get_tenant_settings", { userId: target.userId });
		const settings = await rpc("update_tenant_settings", {
			userId: target.userId,
			classificationPresetId: ClassificationPresetId.Local,
			classificationApiKey: "test-only-tenant-key",
		});
		assert.doesNotMatch(
			JSON.stringify(settings),
			/classificationApiKey|test-only-tenant-key/,
		);
		await rpc("clear_tenant_classification", { userId: target.userId });

		await rpc("list_people");
		await rpc("invite_person", { email: "invitee@example.test" });
		await rpc("revoke_invite", { email: "invitee@example.test" });
		await rpc("disable_person", { userId: target.userId });
		await rpc("enable_person", { userId: target.userId });
		await rpc("sign_out_person", { userId: target.userId });
		await rpc("reset_person_factors", { userId: target.userId });
		await rpc("list_audit");
	});
});
