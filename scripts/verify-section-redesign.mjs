// Verifies the Layout-tab redesign:
//   • Section column is GONE from the review table
//   • A "Sections" card is visible above the review table
//   • Clicking "Draw sections on plan" opens the editor in Draw mode (label input focused, banner says "Click to drop the first corner")
//   • Drawing 4 vertices + Finish + Save creates the section and auto-assigns tables

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const EMAIL = "daisy@test.com";
const PASSWORD = "testpass123";
const EVENT_ID = "cmp0jt4zl0001ia9klwpeskvp";
const DIR = resolve("screenshots/redesign-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
let step = 0;
async function shot(name) {
  await page.screenshot({ path: `${DIR}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: true });
  console.log(`  📸 ${name}`);
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/dashboard/events/${EVENT_ID}?tab=layout`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=Tables — review & edit', { timeout: 15000 });
  await shot("layout-tab-clean");

  // ASSERTION 1: Section column is gone
  const headerCells = await page.locator('th').allInnerTexts();
  const hasSection = headerCells.some(t => /^section$/i.test(t.trim()));
  console.log("Section column gone?", !hasSection, "| headers:", headerCells.map(h => h.trim()));

  // ASSERTION 2: Sections card visible above
  const sectionsCardVisible = await page.locator('text=Sections — optional, text=Sections:').first().isVisible().catch(() => false);
  console.log("Sections card present?", sectionsCardVisible);

  // ASSERTION 3: Click "Draw sections on plan"
  await page.click('button:has-text("Draw sections on plan")');
  await page.waitForSelector('text=Draw sections on the floor plan', { timeout: 5000 });
  await shot("editor-opens-in-draw-mode");

  // The Draw banner should be visible immediately (mode = "draw" by default)
  const drawBanner = await page.locator('text=Click anywhere on the floor plan to drop the first corner').first().isVisible();
  console.log("Editor opens in Draw mode?", drawBanner);

  // Drop 4 vertices
  const plane = await page.waitForSelector('div[style*="cursor: crosshair"]');
  const box = await plane.boundingBox();
  if (!box) throw new Error("No plane");
  const pts = [
    { px: 0.20, py: 0.10 },
    { px: 0.80, py: 0.10 },
    { px: 0.80, py: 0.45 },
    { px: 0.20, py: 0.45 },
  ];
  // Type a section name FIRST (input is auto-focused)
  await page.locator('input[placeholder*="Section name"]').fill("Front Half");
  for (const p of pts) {
    await page.mouse.click(box.x + box.width * p.px, box.y + box.height * p.py);
    await page.waitForTimeout(120);
  }
  await shot("4-corners-dropped");
  await page.click('button:has-text("Finish"):not([disabled])');
  await page.waitForTimeout(400);
  await shot("polygon-closed");

  await page.click('button:has-text("Save sections")');
  await page.waitForSelector('text=Saved', { timeout: 10000 });
  await page.waitForSelector('text=Draw sections on the floor plan', { state: 'hidden', timeout: 5000 });
  await shot("saved-and-closed");

  // Back on the Layout tab — the Sections card should show "Front Half · N tables"
  const sectionsBadge = await page.locator('text=Front Half').first().isVisible().catch(() => false);
  console.log("Section badge visible after save?", sectionsBadge);
  await shot("layout-with-section");

  console.log("\nScreenshots:", DIR);
} catch (e) {
  console.error("FAIL:", e.message);
  try { await shot("error"); } catch {}
} finally {
  await browser.close();
}
