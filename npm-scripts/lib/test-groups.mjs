// How CI splits the workspace suites across runners. Each solo suite takes about
// five minutes and gets a runner to itself; every other suite shares the
// `shared` group. Shared by the runner (npm-scripts/test-parallel.mjs), which
// runs one group, and the guard (npm-scripts/check-ci-coverage.mjs), which reads
// the groups the workflow names and proves each suite runs exactly once.
export const SOLO_SUITES = [
	"mailbox-service",
	"imap-worker",
	"drizzle-service",
];
export const SHARED_GROUP = "shared";
export const GROUPS = [SHARED_GROUP, ...SOLO_SUITES];

// No group is every suite, which is what a developer's `npm run test:ci` runs.
export function selectGroup(suites, group) {
	if (group === undefined) return { suites };
	if (group === SHARED_GROUP) {
		return {
			suites: suites.filter((suite) => !SOLO_SUITES.includes(suite.name)),
		};
	}
	if (!SOLO_SUITES.includes(group)) {
		return {
			error: `unknown test group "${group}": expected one of ${GROUPS.join(", ")}`,
		};
	}
	const selected = suites.filter((suite) => suite.name === group);
	if (selected.length === 0) {
		return { error: `test group "${group}" names no workspace suite` };
	}
	return { suites: selected };
}

const TEST_CI_RUN = /\bnpm run test:ci(?![\w:.-])([^\n]*)/g;
const GROUP_ARG = /\s--group[\s=]+["']?([\w-]+)/;

// One entry per `npm run test:ci` in the source: the group it names, or
// undefined when it runs them all.
export function testCiGroups(source) {
	return [...source.matchAll(TEST_CI_RUN)].map(
		([, rest]) => rest.match(GROUP_ARG)?.[1],
	);
}
