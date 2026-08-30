/**
 * Walking the config import wizard against a mocked instance.
 *
 * Every state here is one the components could already render in Storybook; the
 * question this file answers is whether the app can ever reach them. Each of
 * these was unreachable at one point: the 409 came back with its code on the
 * thrown wrapper's body rather than on the error, an account whose password had
 * just been verified stayed red because `connectionState` is written later by a
 * worker, and "Check the file" was live before there was a document to send.
 *
 * Held with the real caches wired to `lib/query-error-handler.ts`, because
 * "does the fatal overlay swallow this" is a question about what those two
 * handlers pass, and nothing below them can see it. The overlay itself is not
 * mounted — `getCurrentFatalError` is the same signal without a second app's
 * worth of chrome in the tree.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { ApiError } from "../../lib/api";
import "../../lib/client";
import { shouldEscalate, softErrorStatuses } from "../../lib/error-classifier";
import { __resetFatalError, getCurrentFatalError } from "../../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../test-support/http";
import { StepWelcome } from "../onboarding/OnboardingWizard";
import { ConfigImportWizard } from "./ConfigImportWizard";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	__resetFatalError();
});

const ACCOUNT_ID = "acct-imported";

const escalatingClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

/** The flat body the API emits, at the status it emits it with. */
const refusal = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const report = (overrides: Record<string, unknown> = {}) => ({
	valid: true,
	schemaVersion: 1,
	applied: false,
	items: [{ section: "accounts", key: "a@example.test", verdict: "created" }],
	errors: [],
	warnings: [],
	accountsNeedingCredentials: [],
	...overrides,
});

const importedAccount = (): Record<string, unknown> => ({
	accountId: ACCOUNT_ID,
	accountConfigId: "cfg-1",
	username: "a@example.test",
	email: "a@example.test",
	authType: "password",
	imapHost: "imap.example.test",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	smtpEnabled: false,
	smtpHost: "",
	smtpPort: 587,
	smtpTls: false,
	smtpStartTls: false,
	smtpUsername: "",
	isActive: false,
	// The server keeps saying this: only the imap worker clears it, on a
	// connection that has not happened yet.
	connectionState: "credentials_missing",
	createdAt: 0,
	updatedAt: 0,
	folderAppointments: [],
});

interface Backend {
	onImport?: (call: HttpCall) => unknown;
	accounts?: Array<Record<string, unknown>>;
}

const done: string[] = [];

const start = (backend: Backend = {}): DomHarness => {
	done.length = 0;
	http = mockFetch((call) => {
		if (call.path === "/config/import") {
			return backend.onImport?.(call) ?? report();
		}
		if (call.path === "/config") {
			return { accounts: backend.accounts ?? [], mailboxes: [] };
		}
		if (call.path === "/accounts/test-connection") {
			return { imapSuccess: true, smtpSuccess: true };
		}
		return {};
	});
	harness = createDomHarness({ queryClient: escalatingClient() });
	harness.renderApp(
		createElement(ConfigImportWizard, {
			onDone: (outcome: string) => done.push(outcome),
		}),
	);
	return harness;
};

/**
 * Hand the picker a file. jsdom has no `DataTransfer`, so the drop path cannot
 * be driven from here; the input behind "Choose file" is the same entry point
 * and takes a `files` list that only needs `item`.
 */
const pickFile = async (dom: DomHarness, name: string, text: string) => {
	const input = dom.query<HTMLInputElement>('input[type="file"]');
	assert.ok(input, "expected the file input");
	const file = new File([text], name, { type: "application/json" });
	Object.defineProperty(input, "files", {
		configurable: true,
		value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
	});
	dom.dispatch(input, new dom.window.Event("change", { bubbles: true }));
	await dom.flush();
	await dom.wait(10);
	await dom.flush();
};

const CONFIG = JSON.stringify({ kind: "reader.config", schemaVersion: 1 });

const checkButton = (dom: DomHarness): HTMLButtonElement =>
	dom.byText("button", "Check the file") as HTMLButtonElement;

describe("ConfigImportWizard — a file that cannot be sent", () => {
	it("keeps the check disabled and says why, for a file that is not JSON", async () => {
		const dom = start();
		await pickFile(dom, "photos.zip", "PKnot json");

		assert.match(dom.text(), /That file is not JSON/);
		assert.equal(checkButton(dom).disabled, true);
		// Nothing left the browser: the refusal happened before the request.
		assert.equal(http?.to("/config/import").length, 0);
	});

	it("arms the check only once a document has parsed", async () => {
		const dom = start();
		assert.equal(checkButton(dom).disabled, true);

		await pickFile(dom, "config.json", CONFIG);
		assert.equal(checkButton(dom).disabled, false);
	});
});

describe("ConfigImportWizard — an instance that is not empty", () => {
	const conflicted = () =>
		refusal(409, {
			code: "config_not_empty",
			message: "already holds configuration",
			details: { accounts: "2", filters: "14" },
		});

	it("offers abort or merge on the 409 rather than a connection error", async () => {
		const dom = start({ onImport: conflicted });
		await pickFile(dom, "config.json", CONFIG);
		dom.click(checkButton(dom));
		await dom.flush();

		assert.match(dom.text(), /This instance already has configuration/);
		assert.match(dom.text(), /2 accounts, 14 rules are set up here already/);
	});

	/**
	 * The other half of reaching that screen: the refusal must not also take the
	 * app to the fatal page over it. That decision is `shouldEscalate` reading
	 * the mutation's meta, and it is pinned here rather than through the wizard
	 * because under this loader `lib/client.ts` and the generated SDK resolve
	 * `client.gen` through two specifiers (`…/client.gen.ts` and `./client.gen.js`)
	 * and so hold two client instances — the error interceptor registers on one
	 * and the request goes through the other, which never happens under Vite,
	 * where both specifiers resolve to the same module.
	 */
	it("keeps the 409 off the fatal page, and still escalates a 401", () => {
		const meta = softErrorStatuses(409);
		assert.equal(
			shouldEscalate(new ApiError("not empty", 409, {}), meta, "user"),
			false,
		);
		assert.equal(
			shouldEscalate(new ApiError("signed out", 401, {}), meta, "user"),
			true,
		);
		assert.equal(
			shouldEscalate(new ApiError("broken", 500, {}), meta, "user"),
			true,
		);
	});

	it("does not record an import when the reader aborts the 409", async () => {
		const dom = start({ onImport: conflicted });
		await pickFile(dom, "config.json", CONFIG);
		dom.click(checkButton(dom));
		await dom.flush();

		dom.click(dom.byText("button", "Stop, keep this instance"));
		await dom.flush();
		dom.click(dom.byText("button", "Continue"));
		await dom.flush();

		assert.deepEqual(done, ["abandoned"]);
	});
});

describe("ConfigImportWizard — a session that has lapsed", () => {
	it("escalates a 401 rather than keeping it in the wizard", async () => {
		const dom = start({
			onImport: () => refusal(401, { message: "signed out" }),
		});
		await pickFile(dom, "config.json", CONFIG);
		dom.click(checkButton(dom));
		await dom.flush();

		assert.ok(
			getCurrentFatalError(),
			"expected the 401 to escalate rather than stay in the wizard",
		);
	});
});

describe("ConfigImportWizard — the credentials the file does not carry", () => {
	const applied = () => {
		let call = 0;
		return () => {
			call += 1;
			return call === 1
				? report({ accountsNeedingCredentials: [ACCOUNT_ID] })
				: report({
						applied: true,
						accountsNeedingCredentials: [ACCOUNT_ID],
						importId: "imp-1",
					});
		};
	};

	it("marks the account ready once its password is verified and stored", async () => {
		const dom = start({
			onImport: applied(),
			accounts: [importedAccount()],
		});
		await pickFile(dom, "config.json", CONFIG);
		dom.click(checkButton(dom));
		await dom.flush();
		dom.click(dom.byText("button", "Import 1 changes"));
		await dom.flush();
		await dom.wait(20);
		await dom.flush();

		assert.match(dom.text(), /These accounts need credentials/);
		assert.match(dom.text(), /credentials needed/);

		dom.click(dom.byText("button", "Enter password"));
		await dom.flush();
		const password = dom.query<HTMLInputElement>("#credentials-password");
		assert.ok(password, "expected the password field");
		dom.type(password, "mailbox-password");
		dom.click(dom.byText("button", "Test and continue"));
		await dom.flush();
		// The test step stages IMAP then SMTP before it settles, then hands over.
		await dom.wait(500);
		await dom.flush();
		await dom.wait(900);
		await dom.flush();

		const [stored] = http?.to(`/accounts/${ACCOUNT_ID}`) ?? [];
		assert.ok(stored, "expected the password to be stored on the account");
		assert.equal(stored.body?.password, "mailbox-password");

		// GET /config still says `credentials_missing`, and the row is green
		// anyway: this wizard verified the credential itself.
		assert.match(dom.text(), /These accounts need credentials/);
		assert.match(dom.text(), /ready/);
		assert.doesNotMatch(dom.text(), /credentials needed/);
	});
});

describe("The onboarding welcome step", () => {
	it("offers the import beside adding an account, where /onboarding mounts it", () => {
		harness = createDomHarness();
		const imported: string[] = [];
		harness.renderApp(
			createElement(StepWelcome, {
				onStart: () => undefined,
				onImportConfig: () => imported.push("import"),
			}),
		);

		assert.match(harness.text(), /Add your first account/);
		harness.click(harness.byText("button", "Import a config file"));
		assert.deepEqual(imported, ["import"]);
	});

	it("offers no import where the wizard is embedded to add an account", () => {
		harness = createDomHarness();
		harness.renderApp(createElement(StepWelcome, { onStart: () => undefined }));

		assert.match(harness.text(), /Add your first account/);
		assert.equal(
			harness
				.queryAll("button")
				.some((button) => button.textContent === "Import a config file"),
			false,
		);
	});
});
