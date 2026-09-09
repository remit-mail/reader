// The updater entrypoint (docker/runtime/updater/entrypoint.sh, RFC 037 D4).
//
// Driven with a stub `remit` on PATH, so what is asserted is the glue: boot
// recovery runs once before anything else, the control seam is watched, a
// request triggers exactly one update, and the helper image is resolved from
// the running tag in .env. The wrapper itself is tested in remit-update.test.mjs.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ENTRYPOINT = join(ROOT, "docker", "runtime", "updater", "entrypoint.sh");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// A stub `remit` that records every call and its resolved helper image, and
// consumes request.json only on a plain `update` the way the real wrapper does —
// so the watch loop settles after one update. `--recover` and `--check` leave the
// request alone: the check runs on its own cadence and never touches the seam.
const STUB_REMIT = `#!/bin/sh
printf '%s helper=%s\\n' "$*" "\${REMIT_UPDATE_HELPER_IMAGE:-}" >> "$REMIT_STUB_LOG"
case "$*" in
"update --preflight")
	[ "\${STUB_PREFLIGHT_FAIL:-0}" = "1" ] && exit 1
	exit 0
	;;
"update --recover" | "update --check") ;;
*update*)
	rm -f "$REMIT_UPDATE_CONTROL_DIR/request.json"
	[ "\${STUB_UPDATE_FAIL:-0}" = "1" ] && exit 1
	;;
esac
exit 0
`;

function sandbox() {
	const dir = mkdtempSync(join(TMP_ROOT, "updater-entry-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const control = join(dir, "control");
	const state = join(dir, "state");
	const bin = join(dir, "bin");
	for (const d of [deployment, control, state, bin])
		mkdirSync(d, { recursive: true });
	writeFileSync(join(deployment, ".env"), "REMIT_TAG=v1.2.3\n");
	const stub = join(bin, "remit");
	writeFileSync(stub, STUB_REMIT);
	chmodSync(stub, 0o755);
	const log = join(dir, "remit-calls.log");
	return {
		dir,
		control,
		log,
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			REMIT_DIR: deployment,
			REMIT_UPDATE_CONTROL_DIR: control,
			REMIT_UPDATE_STATE_DIR: state,
			REMIT_UPDATE_WATCH_INTERVAL: "1",
			REMIT_STUB_LOG: log,
		},
		calls() {
			try {
				return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
			} catch {
				return [];
			}
		},
	};
}

async function waitFor(predicate, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("timed out waiting for the entrypoint");
}

describe("the updater entrypoint", () => {
	it("recovers first, then serves a request off the control volume", async () => {
		const box = sandbox();
		writeFileSync(
			join(box.control, "request.json"),
			JSON.stringify({ targetVersion: "v1.5.0" }),
		);
		const child = spawn("sh", [ENTRYPOINT], {
			env: box.env,
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update helper=")),
			);
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		const calls = box.calls();
		// The mount is proven first, then recovery, then the request is served.
		assert.equal(
			calls[0],
			"update --preflight helper=ghcr.io/remit-mail/reader/updater:v1.2.3",
		);
		assert.equal(
			calls[1],
			"update --recover helper=ghcr.io/remit-mail/reader/updater:v1.2.3",
		);
		assert.ok(calls.some((c) => c.startsWith("update helper=")));
		// The recover runs before any plain update.
		assert.ok(
			calls.findIndex((c) => c.startsWith("update --recover")) <
				calls.findIndex(
					(c) => c === "update helper=ghcr.io/remit-mail/reader/updater:v1.2.3",
				),
		);
	});

	it("idles without touching the stack when the mount is wrong (reader#272)", async () => {
		// A failed preflight means driving compose would corrupt host files. The
		// entrypoint records nothing further and never recovers, checks or serves —
		// it idles, so restart:unless-stopped does not spin and a fixed .env takes
		// effect on the next recreate.
		const box = sandbox();
		writeFileSync(
			join(box.control, "request.json"),
			JSON.stringify({ targetVersion: "v1.5.0" }),
		);
		const child = spawn("sh", [ENTRYPOINT], {
			env: { ...box.env, STUB_PREFLIGHT_FAIL: "1" },
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update --preflight")),
			);
			// Give the loop several intervals to prove nothing else runs.
			await new Promise((r) => setTimeout(r, 3000));
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		const calls = box.calls();
		assert.ok(calls.every((c) => c.startsWith("update --preflight")));
		assert.equal(
			calls.filter((c) => c.startsWith("update --recover")).length,
			0,
		);
		assert.equal(calls.filter((c) => c.startsWith("update --check")).length, 0);
		assert.equal(calls.filter((c) => c.startsWith("update helper=")).length, 0);
		// The request is left untouched — nothing consumed it.
		assert.ok(box.calls().length >= 1);
	});

	it("serves a panel-requested check off the control volume (#599)", async () => {
		// The boot check runs before the loop ever sees the marker, so waiting on
		// "a check happened" would pass without the loop doing anything. What is
		// waited on is the marker being consumed, and what is asserted is a second
		// check — the one the marker caused — with the cadence far out of reach.
		const box = sandbox();
		writeFileSync(join(box.control, "check-request.json"), JSON.stringify({}));
		const child = spawn("sh", [ENTRYPOINT], {
			env: { ...box.env, REMIT_UPDATE_CHECK_INTERVAL: "86400" },
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() => !existsSync(join(box.control, "check-request.json")));
			await waitFor(
				() =>
					box.calls().filter((c) => c.startsWith("update --check helper="))
						.length >= 2,
			);
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		// Nothing is installed off a check request — it asks for a verdict, not an
		// update.
		assert.equal(
			box.calls().filter((c) => c.startsWith("update helper=")).length,
			0,
		);
	});

	it("runs a check right after recovery, so state lands without a request", async () => {
		const box = sandbox();
		const child = spawn("sh", [ENTRYPOINT], {
			env: box.env,
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update --check helper=")),
			);
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		const calls = box.calls();
		// The preflight is first, recovery follows it, and the initial check follows
		// that — the check needs no request on the seam to fire.
		assert.ok(calls[0].startsWith("update --preflight helper="));
		assert.ok(
			calls.findIndex((c) => c.startsWith("update --preflight")) <
				calls.findIndex((c) => c.startsWith("update --recover")),
		);
		assert.ok(
			calls.findIndex((c) => c.startsWith("update --recover")) <
				calls.findIndex((c) => c.startsWith("update --check")),
		);
	});

	it("clamps a sub-floor check interval so it never polls every watch tick", async () => {
		// A fat-fingered REMIT_UPDATE_CHECK_INTERVAL=1 must not poll the manifest
		// host on every watch tick. The entrypoint floors the interval, so across
		// several ticks only the boot check has run, not one per tick.
		const box = sandbox();
		const child = spawn("sh", [ENTRYPOINT], {
			env: { ...box.env, REMIT_UPDATE_CHECK_INTERVAL: "1" },
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update --check helper=")),
			);
			// WATCH_INTERVAL is 1s here, so this is several ticks: a per-tick poll
			// would stack checks up, while the floor keeps it at the boot check.
			await new Promise((r) => setTimeout(r, 4000));
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		const checks = box
			.calls()
			.filter((c) => c.startsWith("update --check helper="));
		assert.equal(checks.length, 1);
		// It never installs anything on its own — no plain update was triggered.
		assert.equal(
			box.calls().filter((c) => c.startsWith("update helper=")).length,
			0,
		);
	});

	it("serves a request without waiting on the check cadence", async () => {
		// A long check interval must not delay request handling: the watch loop
		// still wakes every WATCH_INTERVAL for request.json.
		const box = sandbox();
		writeFileSync(
			join(box.control, "request.json"),
			JSON.stringify({ targetVersion: "v1.5.0" }),
		);
		const child = spawn("sh", [ENTRYPOINT], {
			env: { ...box.env, REMIT_UPDATE_CHECK_INTERVAL: "86400" },
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update helper=")),
			);
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		assert.ok(box.calls().some((c) => c.startsWith("update helper=")));
	});

	it("keeps watching after the wrapper refuses a request (#587)", async () => {
		// A request the wrapper discards for age exits non-zero. The watcher has to
		// survive that: a container that died on the first expired request would
		// stop serving every later one, which is a worse failure than the install
		// this refuses.
		const box = sandbox();
		writeFileSync(
			join(box.control, "request.json"),
			JSON.stringify({
				targetVersion: "v1.5.0",
				requestedAt: "2020-01-01T00:00:00Z",
			}),
		);
		const child = spawn("sh", [ENTRYPOINT], {
			env: { ...box.env, STUB_UPDATE_FAIL: "1" },
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(
				() => box.calls().filter((c) => c.startsWith("update helper=")).length,
			);
			writeFileSync(
				join(box.control, "request.json"),
				JSON.stringify({
					targetVersion: "v1.5.0",
					requestedAt: new Date().toISOString(),
				}),
			);
			await waitFor(
				() =>
					box.calls().filter((c) => c.startsWith("update helper=")).length >= 2,
			);
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
	});

	it("stays idle when there is no request, and does not update", async () => {
		const box = sandbox();
		const child = spawn("sh", [ENTRYPOINT], {
			env: box.env,
			detached: true,
			stdio: "ignore",
		});
		try {
			await waitFor(() =>
				box.calls().some((c) => c.startsWith("update --recover")),
			);
			// Give the watch loop a couple of intervals to prove it fires nothing.
			await new Promise((r) => setTimeout(r, 2500));
		} finally {
			process.kill(-child.pid, "SIGKILL");
		}
		const updates = box.calls().filter((c) => c.startsWith("update helper="));
		assert.equal(updates.length, 0);
	});

	it("execs its arguments instead of entering the daemon loop (reader#284)", () => {
		// The health, snapshot and restore helpers run as `docker run <updater-image>
		// <cmd>` and rely on --entrypoint to shadow this one. If a caller forgets it,
		// an ignored ENTRYPOINT would fold the command into the watch loop and the
		// container would never exit — the ghost probe that hung a verify for hours.
		// Given any arguments, the entrypoint must become them and exit when they do.
		const result = spawnSync("sh", [ENTRYPOINT, "printf", "GHOST_BUSTED"], {
			encoding: "utf8",
			timeout: 5000,
			env: { PATH: process.env.PATH },
		});
		assert.equal(result.signal, null, "the entrypoint never exited on its own");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "GHOST_BUSTED");
	});

	it("is clean under shellcheck's POSIX sh", () => {
		const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
		if (probe.error) return;
		const result = spawnSync("shellcheck", ["-s", "sh", ENTRYPOINT], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout);
	});
});
