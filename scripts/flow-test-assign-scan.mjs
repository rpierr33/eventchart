// Tests the assign → scan portion of the planner/guest flow.
// 1. Login as Daisy
// 2. Open Smith Wedding → Assign tab
// 3. Click a guest pill to select, click Assign on Table 1
// 4. Verify the guest now appears in Table 1's seated list
// 5. Open public scan URL with Table 1 QR
// 6. Type the guest's last name → verify seat info appears

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const EMAIL = "daisy@test.com";
const PASSWORD = "testpass123";
const EVENT_ID = "cmp0jt4zl0001ia9klwpeskvp";
const PUBLIC_SLUG = "onwm6thm";
const TABLE_1_QR = "cmp1sc3w8000r04ld9wiyd3pu";
const GUEST_FIRST = "Bob";
const GUEST_LAST = "Smith";

const DIR = resolve("screenshots/assign-scan-" + new Date().toISOString().replace(/[:.]/g, "-"));
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

const allConsole = [];
page.on("console", (m) => {
  allConsole.push(`[${m.type()}] ${m.text()}`);
  if (m.type() === "error") {
    const t = m.text();
    if (!t.includes("Failed to load resource") && !t.includes("favicon") && !t.includes("Web push not supported")) {
      report.consoleErrors.push(t);
    }
  }
});
page.on("pageerror", (e) => report.consoleErrors.push("PageError: " + e.message));

async function shot(name) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

try {
  // 1. Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
  logStep("Login OK");

  // 2. Assign tab
  await page.goto(`${BASE}/dashboard/events/${EVENT_ID}?tab=assign`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=Unassigned', { timeout: 10000 });
  await shot("01-assign-tab");

  // 3. Click "Bob Smith" guest pill
  // The pill button contains the text "Bob Smith"
  const guestPill = page.locator(`button:has-text("${GUEST_FIRST} ${GUEST_LAST}")`).first();
  const guestVisible = await guestPill.isVisible();
  if (!guestVisible) {
    logStep("WARN: guest pill not visible — checking unassigned list HTML");
    const bodyText = await page.locator('body').innerText();
    logStep("body snippet", { snippet: bodyText.slice(0, 800) });
    throw new Error(`Guest "${GUEST_FIRST} ${GUEST_LAST}" not found in unassigned list`);
  }
  await guestPill.click();
  // Wait for "1 selected" indicator
  await page.waitForSelector('text=/\\d+ selected/', { timeout: 5000 });
  await shot("02-guest-selected");
  logStep("Guest selected");

  // 4. Find the "Table 1" card (h4 with EXACT text) and click its "Seat 1" button.
  // Avoid `hasText: 'Table 1'` because it also matches Table 10-19.
  const table1Card = page.locator('div.card').filter({
    has: page.locator('h4', { hasText: /^Table 1$/ }),
  }).first();
  await table1Card.waitFor({ timeout: 5000 });
  await table1Card.locator('button:has-text("Seat")').first().click();
  // Wait for the seated list inside Table 1 to contain the guest
  await page.waitForFunction(
    ([name]) => {
      const cards = Array.from(document.querySelectorAll('div.card'));
      const t1 = cards.find(c => {
        const h4 = c.querySelector('h4');
        return h4?.textContent?.trim() === 'Table 1';
      });
      return t1?.textContent?.includes(name) ?? false;
    },
    [`${GUEST_FIRST} ${GUEST_LAST}`],
    { timeout: 10000 },
  );
  await shot("03-guest-seated");
  logStep("Guest seated at Table 1");

  // 5. Verify via DB
  // (Skipping inline — separate Prisma check after this run)

  // 6. Public scan as guest — open in same tab in a fresh context-free state
  await page.goto(`${BASE}/e/${PUBLIC_SLUG}?qr=${TABLE_1_QR}`, { waitUntil: "networkidle" });
  await shot("04-scan-landing");
  logStep("Scan landing loaded");

  // Type guest's last name and submit
  await page.waitForSelector('input[placeholder*="Pierre"], input[placeholder*="last"], input[type="text"]', { timeout: 5000 });
  const lastNameInput = page.locator('input').first();
  await lastNameInput.fill(GUEST_LAST);
  await shot("05-scan-typed");
  // Press Enter or click the submit button
  await page.keyboard.press("Enter");

  // The lookup may return multiple matches — disambiguate by clicking the right one.
  await page.waitForTimeout(1500);
  await shot("06-scan-after-submit");

  // If the disambiguation screen showed up ("Which one are you?"), click "Bob Smith"
  const disambig = page.locator(`button:has-text("${GUEST_FIRST} ${GUEST_LAST}")`).first();
  if (await disambig.isVisible({ timeout: 1500 }).catch(() => false)) {
    await disambig.click();
    await page.waitForTimeout(1500);
    logStep("Disambig: clicked Bob Smith");
  }
  await shot("07-scan-final");

  const result = await page.locator('body').innerText();
  const showsTable = /TABLE\s*1\b/i.test(result) || result.includes("Table 1");
  // Look for any element with a ring / red border / pulse class or red-ish stroke on SVG
  const seatMarker = await page.evaluate(() => {
    const flags = { hasRedRing: false, hasPulse: false, hasYouAreHere: false, foundClass: [] };
    // Look at SVG <circle> elements for red strokes
    const circles = Array.from(document.querySelectorAll('svg circle, svg ellipse, svg polygon'));
    for (const c of circles) {
      const stroke = c.getAttribute('stroke') || '';
      const fill = c.getAttribute('fill') || '';
      if (stroke.toLowerCase().includes('red') || stroke.startsWith('#c') || stroke.startsWith('#d') || stroke.startsWith('#e') || stroke.startsWith('#f')) {
        flags.hasRedRing = true;
      }
      if (fill.toLowerCase().includes('red')) flags.hasRedRing = true;
    }
    // Look for animate class
    document.querySelectorAll('*').forEach(el => {
      const cn = (el.getAttribute('class') || '');
      if (/animate-ping|animate-pulse|ring-red|ring-rose|red-ring|youarehere|you-are-here/i.test(cn)) {
        flags.hasPulse = true;
        flags.foundClass.push(cn.slice(0, 80));
      }
    });
    if (/you.are.here/i.test(document.body.innerText)) flags.hasYouAreHere = true;
    return flags;
  });
  logStep("Final scan state", { showsTable, ...seatMarker, resultSnippet: result.slice(0, 400) });

  logStep("Done");
} catch (e) {
  logErr("UNCAUGHT", e);
  try { await shot("99-error"); } catch {}
} finally {
  await writeFile(`${DIR}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${DIR}/console.log`, allConsole.join("\n"));
  console.log("\nReport:", DIR);
  console.log("Steps:", report.steps.length, "Errors:", report.errors.length, "Console errors:", report.consoleErrors.length);
  await browser.close();
}
