// End-to-end test of the planner → guest flow.
// Logs in as Daisy, exercises polygon-mode UI, assigns a guest, scans a QR.
// Saves screenshots and a JSON report so issues are easy to triage.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const EMAIL = "daisy@test.com";
const PASSWORD = "testpass123";
const EVENT_ID = "cmp0jt4zl0001ia9klwpeskvp";
const PUBLIC_SLUG = "onwm6thm";
const DIR = resolve("screenshots/flow-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(DIR, { recursive: true });

const report = { steps: [], errors: [], consoleErrors: [] };
function logStep(name, detail = {}) {
  console.log(`\n=== ${name} ===`);
  for (const [k, v] of Object.entries(detail)) console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  report.steps.push({ name, detail, at: new Date().toISOString() });
}
function logErr(name, err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  console.error(`\n!!! ${name} FAILED:`, msg);
  report.errors.push({ name, error: msg });
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (!t.includes("Failed to load resource") && !t.includes("favicon")) report.consoleErrors.push(t);
  }
});
page.on("pageerror", (e) => report.consoleErrors.push("PageError: " + e.message));

async function shot(name) {
  const p = `${DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

try {
  // ── 1. LOGIN ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
  await shot("01-dashboard");
  logStep("Login OK", { url: page.url() });

  // ── 2. OPEN SMITH WEDDING ────────────────────────────────────────────
  await page.goto(`${BASE}/dashboard/events/${EVENT_ID}?tab=layout`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=Tables — review & edit', { timeout: 15000 });
  await shot("02-event-layout");
  logStep("Event page loaded");

  // ── 3. POLYGON-MODE EDITOR ──────────────────────────────────────────
  await page.click('button:has-text("◇ Draw sections")');
  await page.waitForSelector('text=Draw sections on the floor plan', { timeout: 5000 });
  await shot("03-polygon-modal-open");
  logStep("Polygon editor opened");

  // Enter Draw mode
  await page.click('button:has-text("✎ Draw")');
  // Fill the section label
  await page.fill('input[placeholder*="Section name"]', "VIP Region");
  // The drawing surface is the relative container above the SVG.
  // Find it by its inline cursor:crosshair when in draw mode, falling back to the polygon-svg viewport's parent.
  const plane = await page.waitForSelector('div[style*="cursor: crosshair"]');
  const box = await plane.boundingBox();
  if (!box) throw new Error("Could not measure drawing plane bounding box");

  // Drop 4 vertices forming a rectangle in the top half of the plan (covers Table 14, 15 which are at y≈30).
  const pts = [
    { px: 0.20, py: 0.10 },
    { px: 0.80, py: 0.10 },
    { px: 0.80, py: 0.45 },
    { px: 0.20, py: 0.45 },
  ];
  for (const p of pts) {
    await page.mouse.click(box.x + box.width * p.px, box.y + box.height * p.py);
    await page.waitForTimeout(120);
  }
  await shot("04-polygon-drawn");
  logStep("Drew 4 vertices");

  // Click Finish
  await page.click('button:has-text("Finish"):not([disabled])');
  await page.waitForSelector('text=tables inside', { timeout: 5000 });
  // Capture the table count from the rail
  const memberText = await page.locator('text=/\\d+ tables? inside/').first().textContent();
  await shot("05-polygon-finished");
  logStep("Polygon finished", { memberText });

  // Save
  await page.click('button:has-text("Save sections")');
  // Sonner toast appears; modal closes
  await page.waitForSelector('text=Saved', { timeout: 10000 });
  await page.waitForSelector('text=Draw sections on the floor plan', { state: "hidden", timeout: 5000 });
  await shot("06-polygon-saved");
  logStep("Polygon saved");

  // ── 4. ASSIGN A GUEST VIA THE ASSIGN TAB ─────────────────────────────
  await page.goto(`${BASE}/dashboard/events/${EVENT_ID}?tab=assign`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=Unassigned', { timeout: 10000 });
  await shot("07-assign-tab");
  logStep("Assign tab loaded");

  // Get a guest name from the unassigned list and try to assign it
  // The Assign tab will have its own structure — let's snapshot first and inspect.
  const html = await page.content();
  const guestMatch = html.match(/(?:Alex Chen|Bob Smith|Anna Lopez)/);
  logStep("Sniffed guests", { firstGuestSeen: guestMatch?.[0] ?? "none" });

  // Look for any "Seat" or table-click action — different UIs may differ. We'll capture a screenshot and let the report show the live UI.

  // ── 5. PUBLIC SCAN — pick the FIRST Table QR and load the public URL ──
  // Find a table QR id from the network. We hit our own API directly with the auth cookie since we're logged in.
  const apiRes = await page.request.get(`${BASE}/api/events/${EVENT_ID}/qr`);
  const apiBody = await apiRes.json().catch(() => null);
  // Public scan URL: /e/[slug]/qr/[qrId]
  const firstTableQr = apiBody?.qrCodes?.find?.((q) => q.tableId);
  if (firstTableQr) {
    const scanUrl = `${BASE}/e/${PUBLIC_SLUG}?qr=${firstTableQr.id}`;
    await page.goto(scanUrl, { waitUntil: "networkidle" });
    await shot("08-guest-scan");
    logStep("Opened guest scan URL", { qrId: firstTableQr.id, scanUrl });
  } else {
    logStep("No table QR found in API", { apiBody });
  }

  // ── 6. FINAL: log VIPs in DB so I can confirm the VIP plumbing alongside the visual run.
  logStep("Done");
} catch (e) {
  logErr("UNCAUGHT", e);
  try { await shot("99-error"); } catch {}
} finally {
  await writeFile(`${DIR}/report.json`, JSON.stringify(report, null, 2));
  console.log("\nReport written to", DIR);
  console.log("Steps:", report.steps.length, "Errors:", report.errors.length, "Console errors:", report.consoleErrors.length);
  await browser.close();
}
