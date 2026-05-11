// Demo: show how pins are actually used at runtime.
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const BASE = "http://localhost:3000";
const SHOTS = resolve("./screenshots/pin-demo");
const SLUG = "onwm6thm";
const QR_ID = "cmp0jtv0v000bia9k7x1t0bem";

async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${path}`);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await ctx.newPage();

  console.log("--- GUEST FLOW (phone viewport, what a real guest sees) ---");
  console.log("→ Guest scans QR, lands on lookup page");
  await guest.goto(`${BASE}/e/${SLUG}?qr=${QR_ID}`);
  await guest.waitForLoadState("networkidle");
  await shot(guest, "1-guest-lookup-empty");

  console.log("→ Types 'Shipp' (single match)");
  await guest.fill("#lastName", "Shipp");
  await shot(guest, "2-guest-typed-name");
  await guest.click('button:has-text("Find my seat")');
  await guest.waitForTimeout(1200);
  await shot(guest, "3-guest-sees-table");
  // Scroll to see the floor-plan with pin
  await guest.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await guest.waitForTimeout(400);
  await shot(guest, "4-guest-sees-pin-on-plan");

  console.log("→ Multi-match flow: 'Pierre'");
  await guest.goto(`${BASE}/e/${SLUG}?qr=${QR_ID}`);
  await guest.waitForLoadState("networkidle");
  await guest.fill("#lastName", "Pierre");
  await guest.click('button:has-text("Find my seat")');
  await guest.waitForTimeout(800);
  await shot(guest, "5-guest-multi-match");

  console.log("--- HOST LIVE VIEW (what the planner sees in real time) ---");
  const hostCtx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const host = await hostCtx.newPage();
  // Login first
  await host.goto(`${BASE}/login`);
  await host.fill('input[name="email"]', "daisy@test.com");
  await host.fill('input[name="password"]', "testpass123");
  await Promise.all([host.waitForURL(/\/dashboard/), host.click('button[type="submit"]')]);
  await host.waitForLoadState("networkidle");

  // Navigate to live view
  await host.goto(`${BASE}/dashboard`);
  await host.waitForLoadState("networkidle");
  await host.click("text=Smith Wedding");
  await host.waitForLoadState("networkidle");
  // Click "Preview live view"
  await host.click('a:has-text("Preview live view"), a:has-text("Live view")');
  await host.waitForURL(/\/live$/);
  await host.waitForLoadState("networkidle");
  await host.waitForTimeout(1500);
  await shot(host, "6-host-live-view-pins-colored");

  // Tap on Table 7 pin
  console.log("→ Host taps Table 7 pin");
  // Find pin with text "7"
  const t7 = host.locator(".pin:has-text('7')").first();
  if (await t7.isVisible()) {
    await t7.click();
    await host.waitForTimeout(600);
    await shot(host, "7-host-tapped-pin-table-7-sheet");
  }

  await ctx.close();
  await hostCtx.close();
  await browser.close();
  console.log("\n✅ done — open the screenshots folder");
}

main().catch((e) => { console.error(e); process.exit(1); });
