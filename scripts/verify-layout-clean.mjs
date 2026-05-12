// Smoke-test: Layout tab should now have NO Draw-sections UI and NO Section column.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = "http://localhost:3002";
const DIR = resolve("screenshots/layout-clean-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(DIR, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "daisy@test.com");
  await page.fill('input[name="password"]', "testpass123");
  await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/dashboard/events/cmp0jt4zl0001ia9klwpeskvp?tab=layout`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=Tables — review & edit', { timeout: 15000 });
  await page.screenshot({ path: `${DIR}/layout.png`, fullPage: true });

  const hasDraw = await page.locator('text=Draw sections').count();
  const hasSectionCol = (await page.locator('th').allInnerTexts()).some(t => /^section$/i.test(t.trim()));
  const headers = (await page.locator('th').allInnerTexts()).map(h => h.trim());
  console.log("Draw-sections button found?", hasDraw > 0, "(should be 0)");
  console.log("Section column?", hasSectionCol, "(should be false)");
  console.log("Headers:", headers);
  console.log("Screenshots:", DIR);
} catch (e) {
  console.error("FAIL:", e.message);
  await page.screenshot({ path: `${DIR}/error.png`, fullPage: true });
} finally {
  await b.close();
}
