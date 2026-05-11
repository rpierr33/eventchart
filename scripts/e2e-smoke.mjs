// e2e smoke for eventChart — drives the full flow with screenshots
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = resolve("./screenshots");

const HOST_EMAIL = `daisy+${Date.now()}@test.com`;
const HOST_PASSWORD = "testpass123";

async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${path}`);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // 1. Landing
  console.log("→ Landing");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(page, "01-landing");

  // 2. Signup
  console.log("→ Signup");
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="name"]', "Daisy Planner");
  await page.fill('input[name="email"]', HOST_EMAIL);
  await page.fill('input[name="password"]', HOST_PASSWORD);
  await shot(page, "02-signup-filled");
  await Promise.all([
    page.waitForURL(/\/dashboard/),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
  await shot(page, "03-dashboard-empty");

  // 3. Create event
  console.log("→ New event");
  await page.click('a[href="/dashboard/events/new"]');
  await page.waitForURL(/\/events\/new/);
  await page.fill('input[name="name"]', "Smith Wedding");
  await page.fill('input[name="venueName"]', "Four Seasons Ballroom");
  await page.fill('input[name="date"]', "2026-06-20");
  await shot(page, "04-new-event-form");
  await Promise.all([
    page.waitForURL((url) => /\/dashboard\/events\/[^/]+$/.test(url.pathname) && !/\/new$/.test(url.pathname), { timeout: 15000 }),
    page.click('button:has-text("Create event")'),
  ]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await shot(page, "05-event-setup-layout-empty");

  // 4. Upload layout (file input is hidden — use directly)
  console.log("→ Upload layout");
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles("/tmp/floorplan.png");
  // Wait for layout to render
  await page.waitForSelector("img[alt='Floor plan']", { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, "06-layout-uploaded");

  // 5. Drop 3 pins
  console.log("→ Drop pins");
  const board = await page.locator("img[alt='Floor plan']").first();
  const box = await board.boundingBox();
  // 3 pins at sensible positions
  const positions = [
    [box.x + box.width * 0.18, box.y + box.height * 0.25],
    [box.x + box.width * 0.55, box.y + box.height * 0.30],
    [box.x + box.width * 0.50, box.y + box.height * 0.65],
  ];
  for (const [x, y] of positions) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  }
  await shot(page, "07-pins-dropped");
  // Save
  const saveBtn = page.getByRole("button", { name: /Save changes/i });
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
    await page.waitForTimeout(1000);
  }
  await shot(page, "08-pins-saved");

  // 6. Edit Table 7 directions on third pin (currently labeled Table 3) — rename
  console.log("→ Edit Table 3 → Table 7 + directions");
  await page.locator(".pin").nth(2).click();
  await page.waitForTimeout(300);
  const labelInput = page.locator('input[value*="Table"]').first();
  await labelInput.fill("Table 7");
  const dirsInput = page.locator('input[placeholder*="Far right corner past the bar"]');
  await dirsInput.fill("Center, just before the stage");
  await shot(page, "09-pin-edited");
  await page.getByRole("button", { name: /Save changes/i }).click();
  await page.waitForTimeout(900);
  await shot(page, "10-pin-saved");

  // 7. Switch to Guests tab → import from paste-format
  console.log("→ Guests tab");
  await page.click('button:has-text("Guests")');
  await page.waitForTimeout(400);
  await shot(page, "11-guests-empty");

  // Add manual guest
  await page.click('button:has-text("+ Add guest")');
  await page.waitForSelector('input[name="firstName"]');
  await page.fill('input[name="firstName"]', "Eric");
  await page.fill('input[name="lastName"]', "Shipp");
  await page.click('button:has-text("Add"), button:has-text("Save")');
  await page.waitForTimeout(600);
  await shot(page, "12-guest-added");

  // 8. Assign tab → drag Eric to Table 7
  console.log("→ Assign tab");
  await page.click('button:has-text("Assign")');
  await page.waitForTimeout(400);
  await shot(page, "13-assign-tab");
  // Click Eric
  await page.click("text=Eric Shipp");
  await page.waitForTimeout(200);
  // Click "Seat 1" button on Table 7
  await page.getByRole("button", { name: /Seat 1/i }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "14-assigned");

  // 9. QR tab → create QR
  console.log("→ QR tab");
  await page.click('button:has-text("QR codes")');
  await page.waitForTimeout(400);
  page.once("dialog", async (d) => { await d.accept("Main Entrance"); });
  await page.click('button:has-text("+ Add QR code")');
  await page.waitForTimeout(1500);
  await shot(page, "15-qr-created");

  // Capture the public URL
  const url = await page.locator("text=/\\/e\\//").first().textContent();
  console.log("Public URL:", url);

  // 10. Live view
  console.log("→ Live view");
  await page.click("text=/Preview live view|Live view/");
  await page.waitForURL(/\/live$/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await shot(page, "16-live-view");

  // 11. Public lookup flow — fresh incognito context
  console.log("→ Public guest scan");
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestCtx.newPage();
  // Get slug from URL on live page
  const liveUrl = page.url();
  const slug = liveUrl.match(/events\/([^/]+)\//)?.[1];
  // we need publicSlug not eventId; pull from a network call
  const evState = await page.evaluate(async () => {
    const r = await fetch(`/api/events/${location.pathname.split("/")[3]}/state`);
    return r.json();
  });
  const publicSlug = evState.event.publicSlug;
  const qr = evState.qrCodes?.[0]?.id;
  console.log("publicSlug:", publicSlug, "qr:", qr);

  await guest.goto(`${BASE}/e/${publicSlug}?qr=${qr}`);
  await guest.waitForLoadState("networkidle");
  await shot(guest, "17-guest-lookup");
  await guest.fill("#lastName", "Shipp");
  await guest.click('button:has-text("Find my seat")');
  await guest.waitForTimeout(900);
  await shot(guest, "18-guest-found-table");

  await guestCtx.close();
  await browser.close();
  console.log("✅ end-to-end smoke complete");
}

main().catch((e) => { console.error(e); process.exit(1); });
