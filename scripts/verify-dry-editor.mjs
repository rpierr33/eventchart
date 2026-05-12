// Verify the new one-row editor: dropdown + single editable form.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = "http://localhost:3002";
const DIR = resolve("screenshots/dry-editor-" + new Date().toISOString().replace(/[:.]/g, "-"));
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

  // Count rendered <tr> with the editable inputs — should be 0 since we don't render N rows anymore
  const tableRowCount = await page.locator('table tbody tr').count();
  console.log("rows rendered:", tableRowCount, "(should be 0)");

  // Drop the selector and check it lists all 18 tables in natural order
  const options = await page.locator('select').nth(0).locator('option').allInnerTexts();
  console.log("dropdown options (" + options.length + "):");
  for (const o of options.slice(0, 5)) console.log(" ", o);
  console.log("  ...");
  for (const o of options.slice(-2)) console.log(" ", o);

  // Click Next a few times to verify the form updates
  for (let i = 0; i < 3; i++) {
    await page.click('button[title="Next (→)"]');
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: `${DIR}/02-after-3-next.png`, fullPage: true });
  const counterText = await page.locator('text=/\\d+ \\/ \\d+/').first().innerText();
  console.log("Counter after 3 Next clicks:", counterText);

  // Check the directions textarea is visible and editable
  const dirVal = await page.locator('textarea').first().inputValue();
  console.log("Directions for current selection (first 60 chars):", dirVal.slice(0, 60));

  // Check capacity summary at the bottom
  const summary = await page.locator('text=/At a glance/').first().innerText();
  console.log("Summary:", summary.replace(/\\s+/g, " "));
} catch (e) {
  console.error("FAIL:", e.message);
  await page.screenshot({ path: `${DIR}/error.png`, fullPage: true });
} finally {
  await b.close();
  console.log("\nScreenshots:", DIR);
}
