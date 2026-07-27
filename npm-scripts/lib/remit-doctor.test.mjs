// `remit doctor` (docs/design/standalone-observability.md D4).
//
// The verdict is the checker's; the wrapper's whole job is the failure paths
// around it. A check that could not look reports `degraded`, never healthy and
// never a stack trace — so what this suite is mostly about is what happens
// when the exec does not come back with a verdict: the container is not there,
// docker refuses, the checker dies before it produces one. Those are the cases
// where a wrapper that trusts the exit code alone prints nothing and a wrapper
// that trusts stdout alone prints a healthy stack that was never examined.
//
// Driven against the same docker stand-in the update and profile suites use.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
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
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const FAKES = join(HERE, "remit-test");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const HEALTHY_LINES = [
	"verdict healthy",
	"checked-at 2026-07-27T08:50:01.029Z",
	"summary remit is healthy",
	"",
].join("\n");

const DEGRADED_LINES = [
	"verdict degraded",
	"checked-at 2026-07-27T08:50:01.029Z",
	"summary remit is degraded",
	"reason dead_letter_queue_not_empty 2 messages are quarantined on 1 dead-letter queue (remit-body-dlq)",
	"reason account_sync_stalled 1 of 3 accounts has not completed a sync in over 3h",
	"detail account_sync_stalled 0f8a…: 40122s",
	"",
].join("\n");

const DEGRADED_JSON = `${JSON.stringify(
	{
		verdict: "degraded",
		checkedAt: "2026-07-27T08:50:01.029Z",
		summary: "remit is degraded",
		reasons: [
			{
				code: "dead_letter_queue_not_empty",
				summary: "2 messages are quarantined on 1 dead-letter queue",
				detail: null,
			},
		],
	},
	null,
	2,
)}\n`;

/**
 * @param {{ checkerRunning?: boolean, lines?: string, json?: string,
 *   stderr?: string, exitCode?: number, hang?: boolean, timeout?: number,
 *   hangSeconds?: number }} options
 */
function sandbox({
	checkerRunning = true,
	lines = HEALTHY_LINES,
	json = "",
	stderr = "",
	exitCode = 0,
	hang = false,
	timeout = 0,
	hangSeconds = 0,
} = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-doctor-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	for (const d of [deployment, fake, bin]) mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(join(deployment, ".env"), "REMIT_TAG=v1.0.0\n");

	const services = ["queue", "backend", "caddy", "doctor"];
	writeFileSync(
		join(fake, "scenario"),
		[
			`services=${services.join(" ")}`,
			`exec_exit=${exitCode}`,
			`exec_mode=${hang ? "hang" : "run"}`,
			"",
		].join("\n"),
	);
	for (const [index, svc] of services.entries()) {
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${index}`);
		writeFileSync(join(fake, `svc-c${svc}${index}`), svc);
		if (svc !== "doctor" || checkerRunning) {
			writeFileSync(join(fake, `up-${svc}`), "");
		}
	}
	writeFileSync(join(fake, "exec-out"), lines);
	writeFileSync(join(fake, "exec-out-json"), json);
	if (stderr) writeFileSync(join(fake, "exec-err"), stderr);

	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);

	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
		...(timeout ? { REMIT_DOCTOR_TIMEOUT: String(timeout) } : {}),
		...(hangSeconds ? { FAKE_EXEC_HANG: String(hangSeconds) } : {}),
	};

	return {
		env,
		run(args) {
			return spawnSync("sh", [REMIT, ...args], { env, encoding: "utf8" });
		},
		log() {
			try {
				return readFileSync(join(fake, "log"), "utf8");
			} catch {
				return "";
			}
		},
	};
}

describe("remit doctor prints the checker's verdict", () => {
	const box = sandbox();
	const result = box.run(["doctor"]);

	it("exits 0 on a healthy verdict", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("prints the line records verbatim, and nothing of its own", () => {
		assert.equal(result.stdout, HEALTHY_LINES);
	});

	it("runs one fresh check through the exec seam", () => {
		assert.match(box.log(), /^compose exec -T doctor node check\.mjs$/m);
	});
});

describe("remit doctor carries a degraded verdict out", () => {
	const box = sandbox({ lines: DEGRADED_LINES, exitCode: 1 });
	const result = box.run(["doctor"]);

	it("exits 1, so cron and an external monitor see the failure", () => {
		assert.equal(result.status, 1);
	});

	it("prints every reason", () => {
		assert.match(result.stdout, /^reason dead_letter_queue_not_empty /m);
		assert.match(result.stdout, /^reason account_sync_stalled /m);
	});

	it("prints the account ids the payload never carries", () => {
		assert.match(result.stdout, /^detail account_sync_stalled 0f8a…: 40122s$/m);
	});
});

describe("remit doctor --json passes the object through", () => {
	const box = sandbox({ json: DEGRADED_JSON, exitCode: 1 });
	const result = box.run(["doctor", "--json"]);

	it("exits 1", () => {
		assert.equal(result.status, 1);
	});

	it("emits the checker's object unchanged", () => {
		assert.equal(result.stdout, DEGRADED_JSON);
	});

	it("asks the checker for JSON rather than reformatting the lines", () => {
		assert.match(box.log(), /^compose exec -T doctor node check\.mjs --json$/m);
	});
});

describe("the checker's logs never reach stdout", () => {
	const box = sandbox({
		lines: HEALTHY_LINES,
		stderr: '{"level":"info","msg":"doctor: scraped 6 endpoints"}\n',
	});
	const result = box.run(["doctor"]);

	it("leaves stdout parseable", () => {
		assert.equal(result.stdout, HEALTHY_LINES);
	});

	it("puts the log line in front of the operator anyway", () => {
		assert.match(result.stderr, /scraped 6 endpoints/);
	});
});

describe("the checker container is not running", () => {
	const box = sandbox({ checkerRunning: false });
	const result = box.run(["doctor"]);

	it("exits 2: no verdict was produced", () => {
		assert.equal(result.status, 2);
	});

	it("reports degraded rather than a healthy stack nobody looked at", () => {
		assert.match(result.stdout, /^verdict degraded$/m);
	});

	it("names the finding in the checker's own vocabulary", () => {
		assert.match(result.stdout, /^reason checker_unreachable /m);
		assert.match(result.stdout, /^checked-at \d{4}-\d\d-\d\dT/m);
		assert.match(result.stdout, /^summary /m);
	});

	it("carries what docker said as the detail, on one line", () => {
		const detail = result.stdout
			.split("\n")
			.filter((line) => line.startsWith("detail "));
		assert.equal(detail.length, 1);
		assert.match(detail[0], /service "doctor" is not running/);
	});

	it("says how to get it back, without polluting stdout", () => {
		assert.match(result.stderr, /remit restart/);
		assert.doesNotMatch(result.stdout, /remit restart/);
	});

	it("prints no stack trace and no shell diagnostic", () => {
		assert.doesNotMatch(result.stderr, /remit: line \d+/);
	});
});

describe("the checker container is not running, --json", () => {
	const box = sandbox({ checkerRunning: false });
	const result = box.run(["doctor", "--json"]);

	it("exits 2", () => {
		assert.equal(result.status, 2);
	});

	it("emits the same object shape a caller already parses", () => {
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.verdict, "degraded");
		assert.equal(parsed.reasons.length, 1);
		assert.equal(parsed.reasons[0].code, "checker_unreachable");
		assert.match(parsed.reasons[0].detail, /is not running/);
		assert.match(parsed.checkedAt, /^\d{4}-\d\d-\d\dT/);
	});
});

describe("docker's complaint contains JSON metacharacters", () => {
	// A daemon error carrying a quote, a backslash and a newline is what turns a
	// hand-built JSON document into something a caller cannot parse — and the
	// caller reading --json is the monitoring check that most needs this answer.
	const box = sandbox({
		checkerRunning: false,
		stderr: 'Error: cannot exec in "doctor\\1"\nsecond line\n',
	});

	it("still emits a document that parses", () => {
		const result = box.run(["doctor", "--json"]);
		assert.equal(result.status, 2);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.reasons[0].code, "checker_unreachable");
	});

	it("keeps the line format to one record per line", () => {
		const result = box.run(["doctor"]);
		for (const line of result.stdout.split("\n").filter(Boolean)) {
			assert.match(
				line,
				/^(verdict|checked-at|summary|reason|detail) /,
				`stray line: ${line}`,
			);
		}
	});
});

describe("the checker dies before producing a verdict", () => {
	// Its own exit code for the case, and nothing on stdout. The wrapper cannot
	// pass through what it was not given, and 2 is already what that means.
	const box = sandbox({
		lines: "",
		exitCode: 2,
		stderr: "doctor: ECONNRESET\n",
	});
	const result = box.run(["doctor"]);

	it("exits 2", () => {
		assert.equal(result.status, 2);
	});

	it("reports degraded with a reason of its own", () => {
		assert.match(result.stdout, /^verdict degraded$/m);
		assert.match(result.stdout, /^reason checker_unreachable /m);
	});

	it("keeps the checker's own error where the operator can read it", () => {
		assert.match(result.stderr, /ECONNRESET/);
	});
});

describe("the verdict on stdout and the exit code disagree", () => {
	// The one that matters. An exec that prints `degraded` and exits 0 makes
	// `remit doctor || alert` a line that never fires while the operator's
	// screen says the stack is broken. Neither answer can be trusted over the
	// other, so both are discarded and the disagreement is the finding.
	const box = sandbox({ lines: DEGRADED_LINES, exitCode: 0 });
	const result = box.run(["doctor"]);

	it("never exits 0 while printing degraded", () => {
		assert.equal(result.status, 2);
	});

	it("discards the output it will not stand behind", () => {
		assert.doesNotMatch(result.stdout, /dead_letter_queue_not_empty/);
		assert.match(result.stdout, /^reason checker_unreachable /m);
	});

	it("names the disagreement", () => {
		assert.match(
			result.stdout,
			/^detail checker_unreachable the checker printed the verdict 'degraded' and exited 0$/m,
		);
	});
});

describe("the exec is killed after the verdict is printed", () => {
	// 137 is not a verdict code either, and a verdict from a process that did
	// not finish normally is not one to hand a monitor.
	const box = sandbox({ lines: DEGRADED_LINES, exitCode: 137 });
	const result = box.run(["doctor"]);

	it("reports no verdict", () => {
		assert.equal(result.status, 2);
		assert.match(result.stdout, /exited 137/);
	});
});

describe("a healthy verdict from an exec that exited non-zero", () => {
	const box = sandbox({ lines: HEALTHY_LINES, exitCode: 1 });
	const result = box.run(["doctor"]);

	it("is never reported as healthy", () => {
		assert.equal(result.status, 2);
		assert.match(result.stdout, /^verdict degraded$/m);
		assert.match(
			result.stdout,
			/^detail checker_unreachable the checker printed the verdict 'healthy' and exited 1$/m,
		);
	});
});

describe("the verdict value is outside the vocabulary", () => {
	for (const [label, value] of [
		["empty", ""],
		["unknown", "is not a thing"],
	]) {
		describe(label, () => {
			const box = sandbox({
				lines: `verdict ${value}\nchecked-at 2026-07-27T08:50:01.029Z\nsummary x\n`,
				exitCode: 0,
			});
			const result = box.run(["doctor"]);

			it("exits 2 rather than reading the record's presence as healthy", () => {
				assert.equal(result.status, 2);
				assert.match(result.stdout, /^reason checker_unreachable /m);
			});
		});
	}
});

describe("the JSON document arrives truncated", () => {
	// The checker writes stdout and then exits, which drops a pending write on
	// a pipe — and `compose exec -T` makes stdout a pipe. The verdict long
	// enough to hit that is a degraded one with several reasons on it, so a
	// half-object must not read as the healthy verdict it happens to start with.
	const box = sandbox({
		json: '{\n  "verdict": "healthy",\n  "reas',
		exitCode: 0,
	});
	const result = box.run(["doctor", "--json"]);

	it("exits 2", () => {
		assert.equal(result.status, 2);
	});

	it("emits a document that parses, instead of the fragment", () => {
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.verdict, "degraded");
		assert.equal(parsed.reasons[0].code, "checker_unreachable");
		assert.match(parsed.reasons[0].detail, /did not close/);
	});
});

describe("the exec succeeds and says nothing", () => {
	// Exit 0 on purpose: the only other empty-stdout case here carries the
	// checker's own 2, so without this the wrapper could start trusting the
	// exit code and nothing would notice.
	it("reports no verdict rather than a healthy stack", () => {
		const result = sandbox({ lines: "", exitCode: 0 }).run(["doctor"]);
		assert.equal(result.status, 2);
		assert.match(result.stdout, /^reason checker_unreachable /m);
	});

	it("reports no verdict when only the log came back", () => {
		const result = sandbox({
			lines: "",
			exitCode: 0,
			stderr: '{"level":"info","msg":"doctor: starting"}\n',
		}).run(["doctor"]);
		assert.equal(result.status, 2);
		assert.match(result.stdout, /^verdict degraded$/m);
	});

	it("reports no verdict on an empty JSON stream", () => {
		const result = sandbox({ json: "", exitCode: 0 }).run(["doctor", "--json"]);
		assert.equal(result.status, 2);
		assert.equal(JSON.parse(result.stdout).verdict, "degraded");
	});
});

describe("docker accepts the exec and never comes back", () => {
	// A command that never answers defeats D4 as thoroughly as one that answers
	// healthy, and behind the README's `*/5` cron line it stacks a process
	// every five minutes. The checker bounds its own scrapes; nothing bounds
	// the docker CLI in front of it.
	const box = sandbox({ hang: true, timeout: 1, hangSeconds: 30 });
	const started = Date.now();
	const result = box.run(["doctor"]);
	const elapsed = Date.now() - started;

	it("answers, well inside the hang", () => {
		assert.ok(elapsed < 15000, `took ${elapsed}ms`);
	});

	it("exits 2 and says the deadline was the cause", () => {
		assert.equal(result.status, 2);
		assert.match(result.stdout, /^verdict degraded$/m);
		assert.match(result.stdout, /did not answer within 1s/);
	});
});

describe("the harness models compose's own flag grammar", () => {
	// The service is the first operand. A fake that read "the first argument
	// without a dash" would take a value-taking flag's value for the service
	// name and silently stop refusing an absent container.
	it("still refuses an absent service behind a value-taking flag", () => {
		const box = sandbox({ checkerRunning: false });
		const result = spawnSync(
			"sh",
			[
				join(FAKES, "fake-docker.sh"),
				"compose",
				"exec",
				"-T",
				"-u",
				"node",
				"doctor",
				"node",
				"check.mjs",
			],
			{ env: box.env, encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /service "doctor" is not running/);
		assert.equal(result.stdout, "");
	});
});

describe("remit doctor rejects what it does not understand", () => {
	const box = sandbox();

	it("refuses an unknown option instead of passing it to the checker", () => {
		const result = box.run(["doctor", "--verbose"]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /unknown option '--verbose'/);
		assert.equal(box.log(), "");
	});

	it("is listed in the usage", () => {
		const result = box.run(["help"]);
		assert.match(result.stdout, /^ {2}doctor \[--json\]/m);
	});
});
