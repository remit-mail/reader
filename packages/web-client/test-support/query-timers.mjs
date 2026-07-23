/**
 * react-query's cache housekeeping — garbage collection, staleness, refetch
 * intervals — runs on timers it schedules in the background. With a DOM
 * present its default gcTime is five minutes, so a test process that built a
 * QueryClient sits idle for five minutes after the last assertion instead of
 * exiting.
 *
 * Nothing ever awaits those timers, so they run unref'd here: they still fire
 * for as long as the tests are running, and they stop holding the process open
 * once the tests are done.
 */

import { timeoutManager } from "@tanstack/react-query";

const unref = (timer) => {
	timer.unref?.();
	return timer;
};

timeoutManager.setTimeoutProvider({
	setTimeout: (callback, delay) => unref(setTimeout(callback, delay)),
	clearTimeout: (id) => clearTimeout(id),
	setInterval: (callback, delay) => unref(setInterval(callback, delay)),
	clearInterval: (id) => clearInterval(id),
});
