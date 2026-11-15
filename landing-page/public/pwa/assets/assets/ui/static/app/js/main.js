import { initShell } from "./shell.js";
import { initHome } from "./home.js";
import { initTasks } from "./tasks.js";
import { initReminders } from "./reminders.js";
import { initPomodoro } from "./pomodoro-timer.js";
import { initPlanShare } from "./plan-share.js";
import { initFeedback } from "./feedback.js";
import { initSetup } from "./setup.js";
import { initGoogleSync } from "./google-sync.js";
import { initProfile } from "./profile-sheet.js";
import { data } from "./core.js";

initShell();
initProfile();
initHome();
initTasks();
initReminders();
initPomodoro();
initPlanShare();
initFeedback();
initSetup();
initGoogleSync();

if (data?.accountService) {
  import("./account.js").then((account) => account.startAccount()).catch(() => {});
  import("./account-ui.js").then((ui) => ui.initAccountUi()).catch(() => {});
}

const pageModule = document.querySelector("[data-page-module]")?.dataset.pageModule;
if (pageModule) (await import(`./pages/${pageModule}.js`)).init?.();
