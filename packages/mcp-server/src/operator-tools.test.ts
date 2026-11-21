import assert from "node:assert/strict";
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
} from "@remit/auth-service";
import type { RemitClient } from "@remit/backend/create-remit-client";
import type { ApiConfig } from "@remit/backend/serve";
import { ClassificationPresetId } from "@remit/domain-enums";
import { migrateSqlite, openSqlite } from "@remit/drizzle-service/sqlite";
import { createClient } from "../../../build/remit-client/client/index.js";
import { MCP_OPERATOR_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createOperatorClient } from "./operator-client.js";
import { createMcpHandler } from "./server.js";

const ORIGIN = "https://operator.remit.test";
const PASSWORD = "correct horse battery staple";
const MIGRATIONS = fileURLToPath(
	new URL("../../../deploy/vps/migrations-sqlite/", import.meta.url),
);

const config: ApiConfig = {
	auth: {
		mode: "BetterAuthJwt",
		contentSigningSecret: "operator-tool-content-secret",
		signIn: "Enabled",
		selfSignUp: "Disabled",
	},
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
let callerId: string;
let target: Person;
let handler: ReturnType<typeof createMcpHandler>;

const rpcWith = async (
	mcpHandler: ReturnType<typeof createMcpHandler>,
	name: string,
	args: Record<string, unknown> = {},
): Promise<unknown> => {
	const response = await mcpHandler(
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

const rpc = (name: string, args: Record<string, unknown> = {}) =>
	rpcWith(handler, name, args);

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
	callerId = callerPerson.userId;
	const operatorClient = createOperatorClient(
		ORIGIN,
		{
			config,
			client: async () => ({}) as RemitClient,
			peopleDirectory: async () => directory,
		},
		callerId,
	);
	handler = createMcpHandler(
		{ userId: callerId, scopes: [MCP_OPERATOR_SCOPE] },
		{ operatorClient: () => operatorClient } as unknown as McpDeps,
		true,
	);
});

after(() => {
	directory.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("the operator tools over sqlite dependencies", () => {
	it("grants People operations without step-up", async () => {
		const people = (await rpc("list_people")) as { people: Person[] };
		assert.equal(
			people.people.find((person) => person.userId === callerId)?.isCaller,
			true,
		);
		await rpc("disable_person", { userId: target.userId });
		await rpc("enable_person", { userId: target.userId });
		await rpc("sign_out_person", { userId: target.userId });
		await rpc("list_audit");
	});

	it("maps every tool to its generated API request", async () => {
		const requests: { method: string; path: string; body: unknown }[] = [];
		const client = createClient({
			baseUrl: ORIGIN,
			fetch: async (request, init) => {
				const sent =
					request instanceof Request ? request : new Request(request, init);
				requests.push({
					method: sent.method,
					path: new URL(sent.url).pathname,
					body: sent.body ? await sent.clone().json() : undefined,
				});
				return Response.json({});
			},
		});
		const mapped = createMcpHandler(
			{ userId: callerId, scopes: [MCP_OPERATOR_SCOPE] },
			{ operatorClient: () => client } as unknown as McpDeps,
			true,
		);
		const call = (name: string, args: Record<string, unknown> = {}) =>
			rpcWith(mapped, name, args);
		const userId = target.userId;
		await call("get_classification_default");
		await call("set_classification_default", {
			presetId: ClassificationPresetId.Local,
			model: "model",
			baseUrl: "http://localhost:11434/v1",
			apiKey: "key",
			enabled: true,
			dailyLimit: 1,
		});
		await call("clear_classification_default");
		await call("get_tenant_settings", { userId });
		await call("update_tenant_settings", { userId });
		await call("clear_tenant_classification", { userId });
		await call("list_people");
		await call("invite_person", { email: "invitee@example.test" });
		await call("revoke_invite", { email: "invitee@example.test" });
		await call("disable_person", { userId });
		await call("enable_person", { userId });
		await call("sign_out_person", { userId });
		await call("reset_person_factors", { userId });
		await call("list_audit");

		assert.deepEqual(
			requests.map(({ method, path }) => `${method} ${path}`),
			[
				"GET /system/classification-default",
				"PUT /system/classification-default",
				"DELETE /system/classification-default",
				`GET /people/${userId}/settings`,
				`PATCH /people/${userId}/settings`,
				`DELETE /people/${userId}/settings/classification-provider`,
				"GET /people",
				"POST /people/invites",
				"DELETE /people/invites/invitee%40example.test",
				`PATCH /people/${userId}`,
				`PATCH /people/${userId}`,
				`POST /people/${userId}/sign-out`,
				`POST /people/${userId}/factors/reset`,
				"GET /people/audit",
			],
		);
		assert.deepEqual(requests[9]?.body, { status: "Disabled" });
		assert.deepEqual(requests[10]?.body, { status: "Active" });
	});
});
