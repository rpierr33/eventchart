import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = "http://localhost:3002";
const DIR = resolve("screenshots/directions-" + new Date().toISOString().replace(/[:.]/g, "-"));
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
  await page.waitForSelector('text=Tables — review & edit', { timeout: 15000 });
  await page.screenshot({ path: `${DIR}/layout-with-directions.png`, fullPage: true });

  // Sample some direction-input values
  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('tbody tr'));
    return trs.slice(0, 5).map(tr => {
      const inputs = tr.querySelectorAll('input');
      return Array.from(inputs).map(i => i.value);
    });
  });
  console.log("First 5 rows (label · cap · directions):");
  for (const r of rows) console.log(" ", r.join(" · "));
  console.log("\nScreenshot:", DIR + "/layout-with-directions.png");
} finally {
  await b.close();
}
