// Splits the e2e spec files across the CI shards by measured duration rather
// than by test count, so the shards finish close together. Every spec lands in
// exactly one shard; a spec with no measurement yet weighs the median, so a new
// spec still runs and the split corrects itself once its time is recorded.
export function assignShards(specs, durations, total) {
	const known = specs
		.map((spec) => durations[spec])
		.filter((seconds) => typeof seconds === "number")
		.sort((a, b) => a - b);
	const fallback = known.length > 0 ? known[Math.floor(known.length / 2)] : 1;
	const weighed = specs
		.map((spec) => ({ spec, seconds: durations[spec] ?? fallback }))
		.sort((a, b) => b.seconds - a.seconds || a.spec.localeCompare(b.spec));
	const shards = Array.from({ length: total }, () => ({
		seconds: 0,
		specs: [],
	}));
	for (const { spec, seconds } of weighed) {
		const lightest = shards.reduce((best, shard) =>
			shard.seconds < best.seconds ? shard : best,
		);
		lightest.seconds += seconds;
		lightest.specs.push(spec);
	}
	for (const shard of shards) shard.specs.sort();
	return shards;
}
