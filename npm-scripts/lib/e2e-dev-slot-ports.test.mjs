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
//
// Nothing about the allocation is written down twice. The port names are read
// back out of the shell by asking which variables the function set, and the hash
// is the shell's own, so adding a seventh listener without widening the stride
// fails here instead of being carried by a copy nobody updated.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const bash = (script, args = []) =>
	execFileSync("bash", ["-c", script, "bash", ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});

// Every variable the function defines that names a port. Taken as the difference
// between the shell's variable list before and after one call, so this file
// never carries its own idea of which ports a slot claims.
const portNames = bash(`
	source npm-scripts/e2e-dev-compose.sh
	declare __before="" __after=""
	__before="$(compgen -v | sort)"
	E2E_DEV_SLOT=probe
	e2e_dev_slot_ports >/dev/null
	__after="$(compgen -v | sort)"
	comm -13 <(printf '%s\\n' "$__before") <(printf '%s\\n' "$__after") |
		grep -E '_PORT$'
`)
	.trim()
	.split("\n");

const slotNames = Array.from({ length: 400 }, (_, index) => `runner-${index}`);

const allocate = (names) => {
	const output = bash(
		`
		source npm-scripts/e2e-dev-compose.sh
		for slot in "$@"; do
			unset ${portNames.join(" ")}
			E2E_DEV_SLOT="$slot"
			e2e_dev_slot_ports >/dev/null
			printf '%s ${portNames.map(() => "%s").join(" ")}\\n' "$slot" ${portNames.map((name) => `"\${${name}}"`).join(" ")}
		done
	`,
		names,
	);
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
		assert.ok(portNames.length > 1, `read back ${portNames.join(", ")}`);
		for (const { slot, ports } of allocations) {
			assert.equal(
				new Set(ports).size,
				portNames.length,
				`slot ${slot} allocated ${ports.join(", ")} for ${portNames.length} services`,
			);
		}
	});

	it("never lets one slot's block reach into the next slot's", () => {
		const bases = [
			...new Set(allocations.map(({ ports }) => Math.min(...ports))),
		].sort((a, b) => a - b);
		for (let index = 1; index < bases.length; index++) {
			assert.ok(
				bases[index] - bases[index - 1] >= portNames.length,
				`blocks at ${bases[index - 1]} and ${bases[index]} overlap: ${portNames.length} ports do not fit in a stride of ${bases[index] - bases[index - 1]}`,
			);
		}
	});

	it("keeps a slot's ports contiguous, so one block covers the whole stack", () => {
		for (const { slot, ports } of allocations) {
			const sorted = [...ports].sort((a, b) => a - b);
			assert.equal(
				sorted[sorted.length - 1] - sorted[0],
				portNames.length - 1,
				`slot ${slot} spans ${sorted[0]}-${sorted[sorted.length - 1]}`,
			);
		}
	});
});
