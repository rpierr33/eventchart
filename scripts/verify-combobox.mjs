import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = "http://localhost:3002";
const DIR = resolve("screenshots/combobox-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(DIR, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "daisy@test.com");
  await page.fill('input[name="password"]', "testpass123");
  await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/dashboard/events/cmp0jt4zl0001ia9klwpeskvp?tab=layout`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=pick one to edit', { timeout: 15000 });
  await page.screenshot({ path: `${DIR}/01-default.png`, fullPage: true });

  // There should be NO <select> element on the page
  const nativeSelects = await page.locator('select').count();
  console.log("<select> elements on page:", nativeSelects, "(should be 0)");

  // Open the combobox by clicking the trigger button
  await page.click('button[aria-haspopup="listbox"]');
  await page.waitForSelector('input[placeholder="Search tables…"]', { timeout: 3000 });
  await page.screenshot({ path: `${DIR}/02-dropdown-open.png`, fullPage: true });

  // Type to filter
  await page.fill('input[placeholder="Search tables…"]', "Table 1");
  await page.waitForTimeout(150);
  const opts = await page.locator('[role="option"]').count();
  console.log("After filter 'Table 1':", opts, "options (should be 10: Table 1, 10-18)");
  await page.screenshot({ path: `${DIR}/03-filtered.png`, fullPage: true });

  // Click Table 15
  await page.click('[role="option"]:has-text("Table 15")');
  await page.waitForTimeout(200);
  const dir = await page.locator('textarea').first().inputValue();
  console.log("After selecting Table 15, directions:", dir.slice(0, 80));
  await page.screenshot({ path: `${DIR}/04-selected.png`, fullPage: true });

  console.log("\nScreenshots:", DIR);
} catch (e) {
  console.error("FAIL:", e.message);
  await page.screenshot({ path: `${DIR}/error.png`, fullPage: true });
} finally {
  await b.close();
}
