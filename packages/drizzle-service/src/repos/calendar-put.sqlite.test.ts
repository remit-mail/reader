import { openCalendarSqliteTestStores } from "../test-stores.js";
import { calendarPutSuite } from "./calendar-put.suite.js";

calendarPutSuite(openCalendarSqliteTestStores);
