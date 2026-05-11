// Demo: upload floor plan → AI auto-detects every table → review.
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const BASE = "http://localhost:3000";
const SHOTS = resolve("./screenshots/ai-flow");

async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${path}`);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  console.log("→ Sign in");
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "daisy@test.com");
  await page.fill('input[name="password"]', "testpass123");
  await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
  await page.waitForLoadState("networkidle");

  console.log("→ Open Smith Wedding event");
  await page.click("text=Smith Wedding");
  await page.waitForURL(/\/dashboard\/events\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await shot(page, "01-event-layout-empty");

  console.log("→ Upload floor plan (AI auto-detects)");
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles("/tmp/floorplan.png");
  // Wait for AI parse to finish — toast says "AI detected N tables"
  await page.waitForSelector("text=/AI detected \\d+ tables/", { timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot(page, "02-ai-auto-detected-review");

  // Scroll the review table area
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot(page, "03-review-top");

  // Click "Write directions"
  console.log("→ Click Write directions");
  await page.click('button:has-text("Write directions")');
  await page.waitForSelector("text=/Directions written for \\d+ tables/", { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot(page, "04-directions-written");

  await browser.close();
  console.log("\n✅ AI flow demo complete");
}

main().catch((e) => { console.error(e); process.exit(1); });
