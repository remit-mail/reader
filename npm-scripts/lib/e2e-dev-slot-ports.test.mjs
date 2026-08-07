// A slot's port block is derived from a hash of its name, and the block's width
// is written down separately from the ports that fill it. Widen the stack by one
// listener without widening the stride and two slots overlap: the second run
// binds a port the first already holds, or — worse, because it is silent — the
// app on one lane addresses a service on the other.
//
// The property asserted here is the one that matters and the one no reader can
// check by eye: over many slot names, two slots either land on the same block —
// a hash collision, which `e2e_dev_require_free_ports` fails the run on — or on
// blocks that do not touch. Nothing in between.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PORT_NAMES = [
	"E2E_HTTP_PORT",
	"SERVER_PORT",
	"QUEUE_SIDECAR_PORT",
	"E2E_IMAP_PORT",
	"E2E_SMTP_PORT",
	"E2E_SMTP_HTTP_PORT",
];

const slotNames = Array.from({ length: 400 }, (_, index) => `runner-${index}`);

// Sourced and called, not reimplemented: a JS copy of the hash would agree with
// the shell for the same reason a bug would survive in both.
const allocate = (names) => {
	const script = `
		source npm-scripts/e2e-dev-compose.sh
		for slot in "$@"; do
			unset ${PORT_NAMES.join(" ")}
			E2E_DEV_SLOT="$slot"
			e2e_dev_slot_ports >/dev/null
			printf '%s ${PORT_NAMES.map(() => "%s").join(" ")}\\n' "$slot" ${PORT_NAMES.map((name) => `"\${${name}}"`).join(" ")}
		done
	`;
	const output = execFileSync("bash", ["-c", script, "bash", ...names], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return output
		.trim()
		.split("\n")
		.map((line) => {
			const [slot, ...ports] = line.split(" ");
			return { slot, ports: ports.map(Number) };
		});
};

describe("the port block a dev-lane slot claims", () => {
	const allocations = allocate(slotNames);

	it("gives every service its own port", () => {
		for (const { slot, ports } of allocations) {
			assert.equal(
				new Set(ports).size,
				PORT_NAMES.length,
				`slot ${slot} allocated ${ports.join(", ")} for ${PORT_NAMES.length} services`,
			);
		}
	});

	it("never lets one slot's block reach into the next slot's", () => {
		const bases = [
			...new Set(allocations.map(({ ports }) => Math.min(...ports))),
		].sort((a, b) => a - b);
		for (let index = 1; index < bases.length; index++) {
			assert.ok(
				bases[index] - bases[index - 1] >= PORT_NAMES.length,
				`blocks at ${bases[index - 1]} and ${bases[index]} overlap: ${PORT_NAMES.length} ports do not fit in a stride of ${bases[index] - bases[index - 1]}`,
			);
		}
	});

	it("keeps a slot's ports contiguous, so one block covers the whole stack", () => {
		for (const { slot, ports } of allocations) {
			const sorted = [...ports].sort((a, b) => a - b);
			assert.equal(
				sorted[sorted.length - 1] - sorted[0],
				PORT_NAMES.length - 1,
				`slot ${slot} spans ${sorted[0]}-${sorted[sorted.length - 1]}`,
			);
		}
	});
});
