import { initShell } from "./shell.js";
import { initHome } from "./home.js";
import { initTasks } from "./tasks.js";
import { initReminders } from "./reminders.js";
import { initPomodoro } from "./pomodoro-timer.js";
import { initGoogleSync } from "./google-sync.js";

initShell();
initHome();
initTasks();
initReminders();
initPomodoro();
initGoogleSync();

const pageModule = document.querySelector("[data-page-module]")?.dataset.pageModule;
if (pageModule) (await import(`./pages/${pageModule}.js`)).init?.();
