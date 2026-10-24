/**
 * The MCP connector on the packaged deployment (remit-mail/remit#1342).
 *
 * With the `mcp` profile off, which is how every deployment starts, nothing
 * answers MCP at the connector's host or at the instance's own. With it on, a
 * client registers, signs in with the remit password, gets a token, and reads
 * mail through a tool — and what the tool returns is what Dovecot holds.
 *
 * One serial file, because the profile is stack state: the off half runs first,
 * the on half turns the profile on, and the stack is put back when it is done.
 */
import { randomUUID } from "node:crypto";
import { waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	createServerMailbox,
	deleteServerMailbox,
	listServerMailboxes,
	listServerSubjects,
	waitForServerMailbox,
} from "../src/imap.js";
import {
	callTool,
	connectAsClient,
	connectWithDeviceCode,
	enableMcpProfile,
	mcpOrigin,
	mcpRequest,
} from "../src/mcp.js";
import { imageStackOnly } from "../src/stack.js";

test.describe.configure({ mode: "serial" });

/** Whether a response is the connector speaking, by any of its three surfaces. */
const isMcpAnswer = async (response: Response): Promise<boolean> => {
	if (
		/resource_metadata=/.test(response.headers.get("www-authenticate") ?? "")
	) {
		return true;
	}
	const text = await response.text();
	return /"authorization_servers"|"registration_endpoint"|"jsonrpc"/.test(text);
};

const probes = (origin: string): Promise<Response>[] => [
	fetch(`${origin}/.well-known/oauth-authorization-server`),
	fetch(`${origin}/.well-known/oauth-protected-resource/mcp`),
	mcpRequest(origin, "not-a-token", "tools/list"),
];

test.describe("the MCP connector with the profile off", () => {
	imageStackOnly("the mcp profile is a compose service of the packaged stack");

	test("nothing answers MCP at the connector's host", async () => {
		for (const response of await Promise.all(probes(mcpOrigin()))) {
			expect(await isMcpAnswer(response), response.url).toBe(false);
		}
	});

	test("nothing answers MCP at the instance's own origin", async () => {
		for (const response of await Promise.all(probes(baseUrl))) {
			expect(await isMcpAnswer(response), response.url).toBe(false);
		}
	});
});

test.describe("the MCP connector with the profile on", () => {
	imageStackOnly("the mcp profile is a compose service of the packaged stack");

	let restore: (() => void) | undefined;

	test.beforeAll(() => {
		test.setTimeout(300_000);
		restore = enableMcpProfile(mcpOrigin());
	});

	test.afterAll(() => {
		test.setTimeout(300_000);
		restore?.();
	});

	test("refuses /mcp without a token, naming its resource metadata", async () => {
		const response = await fetch(`${mcpOrigin()}/mcp`, { method: "POST" });
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain(
			`resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/mcp"`,
		);
	});

	test("is still not served at the instance's own origin", async () => {
		for (const response of await Promise.all(probes(baseUrl))) {
			expect(await isMcpAnswer(response), response.url).toBe(false);
		}
	});

	// In a folder of its own, removed afterwards: later specs count INBOX exactly.
	test("reads the mail Dovecot holds, after the OAuth flow", async ({
		api,
		run,
	}) => {
		test.setTimeout(180_000);
		const folder = `MCP-${randomUUID().slice(0, 8)}`;
		const subject = `Read over MCP ${randomUUID()}`;
		const marker = `mcp-body-${randomUUID()}`;
		await createServerMailbox(run.imapUser, folder);
		try {
			await appendMessages(
				run.imapUser,
				[{ subject, body: `The marker is ${marker}.` }],
				folder,
			);
			expect(await listServerSubjects(run.imapUser, folder)).toEqual([subject]);
			await api.triggerSync(run.accountId);

			const token = await connectAsClient(mcpOrigin(), run);

			type Listed = {
				accounts: {
					accountId: string;
					mailboxes: { mailboxId: string; fullPath: string }[];
				}[];
			};
			const mailboxesOf = (listed: Listed) =>
				listed.accounts.find((account) => account.accountId === run.accountId)
					?.mailboxes ?? [];
			const listed = await waitFor(
				() =>
					callTool(mcpOrigin(), token, "list_mailboxes", {}) as Promise<Listed>,
				(value) =>
					mailboxesOf(value).some((mailbox) => mailbox.fullPath === folder),
				{ timeoutMs: 60_000, what: `"${folder}" in list_mailboxes` },
			);
			const mailboxes = mailboxesOf(listed);
			expect(
				mailboxes.find((mailbox) => mailbox.fullPath === "INBOX")?.mailboxId,
			).toBe(run.inboxId);
			const mailboxId = mailboxes.find(
				(mailbox) => mailbox.fullPath === folder,
			)?.mailboxId;
			if (!mailboxId)
				throw new Error("unreachable: the folder was matched but not found");

			type Row = { messageId: string; subject: string };
			const page = await waitFor(
				() =>
					callTool(mcpOrigin(), token, "list_threads", {
						mailboxId,
					}) as Promise<{
						items: Row[];
					}>,
				({ items }) => items.length > 0,
				{
					timeoutMs: 60_000,
					what: `the message in "${folder}" through list_threads`,
				},
			);
			expect(page.items.map((row) => row.subject)).toEqual(
				await listServerSubjects(run.imapUser, folder),
			);

			const message = await waitFor(
				() =>
					callTool(mcpOrigin(), token, "get_message", {
						messageId: page.items[0].messageId,
					}) as Promise<{ subject: string; bodyAvailable: boolean }>,
				(read) => read.bodyAvailable,
				{ timeoutMs: 60_000, what: `the body of "${subject}"` },
			);
			expect(message.subject).toBe(subject);
			expect(JSON.stringify(message)).toContain(marker);
		} finally {
			await deleteServerMailbox(run.imapUser, folder);
			await api.triggerSync(run.accountId);
		}
	});

	type Folder = { mailboxId: string; fullPath: string; syncStatus: string };

	const settledFolder = (
		token: string,
		tool: "create_folder" | "rename_folder",
		args: Record<string, unknown>,
	): Promise<Folder> =>
		waitFor(
			() => callTool(mcpOrigin(), token, tool, args) as Promise<Folder>,
			(folder) => folder.syncStatus === "synced",
			{ timeoutMs: 90_000, what: `${tool} to settle` },
		);

	const dropServerFolders = async (
		user: string,
		paths: string[],
	): Promise<void> => {
		const present = await listServerMailboxes(user);
		for (const path of paths) {
			if (present.includes(path)) await deleteServerMailbox(user, path);
		}
	};

	test("creates and renames a folder, and Dovecot lists the result", async ({
		api,
		run,
	}) => {
		test.setTimeout(240_000);
		const created = `MCP-${randomUUID().slice(0, 8)}`;
		const renamed = `${created}-renamed`;
		try {
			const token = await connectAsClient(
				mcpOrigin(),
				run,
				"mail:read mail:rules",
			);
			const folder = await settledFolder(token, "create_folder", {
				accountId: run.accountId,
				fullPath: created,
			});
			expect(folder.fullPath).toBe(created);
			expect(await listServerMailboxes(run.imapUser)).toContain(created);

			const moved = await settledFolder(token, "rename_folder", {
				accountId: run.accountId,
				mailboxId: folder.mailboxId,
				fullPath: renamed,
			});
			expect(moved.fullPath).toBe(renamed);
			const serverFolders = await listServerMailboxes(run.imapUser);
			expect(serverFolders).toContain(renamed);
			expect(serverFolders).not.toContain(created);
		} finally {
			await dropServerFolders(run.imapUser, [created, renamed]);
			await api.triggerSync(run.accountId);
		}
	});

	test("a filter created over MCP moves the existing mail on Dovecot", async ({
		api,
		run,
	}) => {
		test.setTimeout(240_000);
		const target = `MCP-filter-${randomUUID().slice(0, 8)}`;
		const marker = `mcp-filter-${randomUUID()}`;
		const subject = `Sorted over MCP ${marker}`;
		await createServerMailbox(run.imapUser, target);
		try {
			await appendMessages(run.imapUser, [{ subject, body: "To be sorted." }]);
			await api.triggerSync(run.accountId);
			const token = await connectAsClient(
				mcpOrigin(),
				run,
				"mail:read mail:rules",
			);

			type Listed = {
				accounts: {
					accountId: string;
					mailboxes: { mailboxId: string; fullPath: string }[];
				}[];
			};
			const listed = await waitFor(
				() =>
					callTool(mcpOrigin(), token, "list_mailboxes", {}) as Promise<Listed>,
				(value) =>
					value.accounts.some((account) =>
						account.mailboxes.some((mailbox) => mailbox.fullPath === target),
					),
				{ timeoutMs: 60_000, what: `"${target}" in list_mailboxes` },
			);
			const targetId = listed.accounts
				.flatMap((account) => account.mailboxes)
				.find((mailbox) => mailbox.fullPath === target)?.mailboxId;
			if (!targetId) throw new Error("unreachable: the target was matched");
			await waitFor(
				() =>
					callTool(mcpOrigin(), token, "search_threads", {
						query: marker,
					}) as Promise<{ items: unknown[] }>,
				({ items }) => items.length === 1,
				{ timeoutMs: 60_000, what: `"${subject}" synced into remit` },
			);

			const created = (await callTool(mcpOrigin(), token, "create_filter", {
				accountId: run.accountId,
				name: `Sort ${marker}`,
				literalClauses: [{ field: "Subject", value: marker }],
				actionMailboxId: targetId,
			})) as { organizeJobId: string };
			expect(created.organizeJobId).toBeTruthy();

			await waitForServerMailbox(
				run.imapUser,
				target,
				(subjects) => subjects.includes(subject),
				{ timeoutMs: 120_000, what: `"${subject}" moved into "${target}"` },
			);
			expect(await listServerSubjects(run.imapUser, "INBOX")).not.toContain(
				subject,
			);
		} finally {
			await deleteServerMailbox(run.imapUser, target);
			await api.triggerSync(run.accountId);
		}
	});

	test("a device code approved on the device page reads mail through a tool", async ({
		run,
	}) => {
		test.setTimeout(180_000);
		const token = await connectWithDeviceCode(mcpOrigin(), run);
		const listed = (await callTool(
			mcpOrigin(),
			token,
			"list_mailboxes",
			{},
		)) as { accounts: { accountId: string }[] };
		expect(listed.accounts.map((account) => account.accountId)).toContain(
			run.accountId,
		);
	});
});
