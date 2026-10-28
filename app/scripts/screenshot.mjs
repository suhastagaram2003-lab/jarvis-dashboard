// Browser check — starts the app on a throwaway ~/.jarvis (tests/app-fixture.js) with the fake claude
// (tests/fixtures/fake-claude.js), drives it with Playwright and saves screenshots in app/scripts/out/.
// Run: node app/scripts/screenshot.mjs. Exits non-zero when a step does not reach its expected state.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try { return require("playwright"); } catch { /* fall through to the global module path */ }
  const { execSync } = require("node:child_process");
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  return createRequire(path.join(globalRoot, "x.js"))("playwright");
}

const fs = require("node:fs");
const { chromium } = loadPlaywright();
const { createServer } = require(path.join(root, "app", "server", "http.js"));
const { createRunManager } = require(path.join(root, "app", "server", "runs.js"));
const { startProcess } = require(path.join(root, "app", "server", "claude-process.js"));
const { makeToken } = require(path.join(root, "app", "server", "policy.js"));
const { makeHome } = require(path.join(root, "tests", "app-fixture.js"));

const FAKE = path.join(root, "tests", "fixtures", "fake-claude.js");
const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

const { home } = makeHome();
const runs = createRunManager({ jarvisHome: home, fs, startProcess, claude: { file: process.execPath, prefixArgs: [FAKE] } });
const token = makeToken();
const server = createServer({ jarvisHome: home, fs, token, runs });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });
const check = (ok, what) => { if (!ok) throw new Error(`check failed: ${what}`); console.log(`ok  ${what}`); };

const browser = await chromium.launch();
let failed = null;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // Tasks: the link sets the cookie; the ranked queue renders.
  await page.goto(`${base}/?t=${token}`);
  await page.waitForSelector(".task-row");
  const firstTitle = await page.locator(".task-row .row-title").first().textContent();
  check(/October results/.test(firstTitle), `the high-urgency item is first (${firstTitle})`);
  check((await page.locator(".task-row .btn:disabled").count()) === 1, "the non-Claude command's button is disabled");

  // Execute the first task, approve its ask, wait for done.
  await page.locator(".task-row .btn").first().click();
  await page.waitForSelector(".panel .ask .approve");
  check(/#run\//.test(page.url()), "the hash routes to the run");
  await page.locator(".panel .ask .approve").click();
  await page.waitForSelector(".panel .line-end .badge-done", { timeout: 15000 });
  check((await page.locator(".panel .line-claude").allTextContents()).join("\n").includes("allowed"), "the approved tool ran");
  await shot(page, "run.png");

  // Back closes the panel; the row shows Done.
  await page.goBack();
  await page.waitForSelector(".task-row .badge-done", { timeout: 15000 });
  check(!(await page.locator(".panel").isVisible()), "back closes the run panel");
  await shot(page, "tasks.png");

  // Project tab: the eight sections and Quick Capture.
  await page.locator('a.tab-link[href="#project/marketbrain"]').click();
  await page.waitForSelector(".card-title");
  const titles = await page.locator(".card-title").allTextContents();
  check(titles.length === 9 && titles[0].startsWith("Health") && titles[8] === "Quick capture", `project sections (${titles.length})`);
  await shot(page, "project.png");

  // Chat: one message to the fake claude; the echo and its permission ask show in the panel.
  await page.locator('a.tab-link[href="#chat"]').click();
  await page.waitForSelector(".chat-input");
  await page.fill(".chat-input", "/ask what changed this week?");
  await page.locator(".chat-send").click();
  await page.waitForSelector(".panel .ask .approve", { timeout: 15000 });
  const echo = (await page.locator(".panel .line-claude").allTextContents()).join("\n");
  check(echo.includes("echo: /ask what changed this week?"), "the chat prompt reached claude unchanged");
  await shot(page, "chat.png");

  // Runs: both runs are listed, the chat one live.
  await page.locator('a.tab-link[href="#runs"]').click();
  await page.waitForSelector(".runs-table .run-row");
  check((await page.locator(".runs-table .run-row").count()) === 2, "two runs in the history");
  check((await page.locator(".runs-table .badge-waiting").count()) === 1, "the chat run shows Needs you");
  await shot(page, "runs.png");

  // Phone: Tasks at 390 px, no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('a.tab-link[href="#tasks"]').click();
  await page.waitForSelector(".task-row");
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    tab: document.getElementById("tab").scrollWidth, tabClient: document.getElementById("tab").clientWidth,
  }));
  check(widths.doc <= 390 && widths.body <= 390 && widths.tab <= widths.tabClient, `no sideways scroll at 390px (${JSON.stringify(widths)})`);
  await shot(page, "phone.png");

  check(errors.length === 0, `no page errors (${errors.join(" | ")})`);
} catch (e) {
  failed = e;
} finally {
  await browser.close();
  runs.close();
  server.close();
}
if (failed) { console.error(failed.stack || failed.message); process.exit(1); }
console.log(`screenshots in ${OUT}`);
