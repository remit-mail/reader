import { openCalendarSqliteTestStores } from "../test-stores.js";
import { calendarDefaultSuite } from "./calendar-default.suite.js";

calendarDefaultSuite(openCalendarSqliteTestStores);
