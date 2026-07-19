/**
 * What global setup produced, handed to the specs. Written to disk rather than
 * passed in memory because Playwright runs setup in its own process.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stateDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".state");

export const storageStatePath = join(stateDir, "storage-state.json");
const runStatePath = join(stateDir, "run.json");

/**
 * A two-turn conversation seeded across two IMAP folders: the correspondent's
 * message in INBOX and the user's own reply in Sent, chained by References.
 * A thread that spans folders is the only way to catch a reader that assembles
 * conversations from one folder at a time (#46).
 */
export interface SeededConversation {
	/** In INBOX, from the correspondent. */
	receivedSubject: string;
	receivedFromName: string;
	/** In Sent, from the user, References-chained to the received message. */
	sentSubject: string;
	sentFromName: string;
}

export interface RunState {
	email: string;
	password: string;
	name: string;
	token: string;
	accountId: string;
	inboxId: string;
	/** The IMAP mailbox this run owns. No other run has ever written to it. */
	imapUser: string;
	seededSubjects: string[];
	conversation: SeededConversation;
	/** Subject → the category the classifier must assign it (issue #45). */
	classificationExpectations: Array<{
		subject: string;
		expectedCategory: string;
	}>;
}

export const writeRunState = (state: RunState): void => {
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(runStatePath, JSON.stringify(state, null, 2));
};

export const readRunState = (): RunState =>
	JSON.parse(readFileSync(runStatePath, "utf8")) as RunState;

export const ensureStateDir = (): void => {
	mkdirSync(stateDir, { recursive: true });
};
