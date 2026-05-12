import { chromium } from "playwright";
const BASE = "http://localhost:3002";
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

  const selector = page.locator('select').nth(0);
  // Get the value of each option index 0..17 by selecting it and reading the directions textarea
  for (const i of [0, 4, 9, 13, 17]) {
    await selector.selectOption({ index: i });
    await page.waitForTimeout(80);
    const label = await page.locator('input[maxlength="40"]').first().inputValue();
    const cap = await page.locator('input[type="number"][min="1"][max="40"]').first().inputValue();
    const dir = await page.locator('textarea').first().inputValue();
    console.log(`option[${i}]: ${label} | cap ${cap} | directions = "${dir.slice(0, 80)}"`);
  }
} finally {
  await b.close();
}
