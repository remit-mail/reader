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

export interface RunState {
	email: string;
	password: string;
	name: string;
	token: string;
	accountId: string;
	inboxId: string;
	seededSubjects: string[];
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
