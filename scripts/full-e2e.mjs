import { chromium } from "playwright";
import { mkdir } from "fs/promises";

const BASE = "http://localhost:3000";
const SHOTS = "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/full-e2e";
await mkdir(SHOTS, { recursive: true });
const stamp = Date.now();
const EMAIL = `daisy+${stamp}@test.com`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const shot = async (n) => { const p = `${SHOTS}/${n}.png`; await page.screenshot({ path: p, fullPage: false }); console.log("📸", p); };

console.log("→ Sign up");
await page.goto(`${BASE}/signup`);
await page.fill('input[name="name"]', "Daisy");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', "testpass123");
await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");
await shot("01-dashboard");

console.log("→ Create event");
await page.click('a[href="/dashboard/events/new"]');
await page.fill('input[name="name"]', "Smith Wedding (E2E)");
await page.fill('input[name="venueName"]', "Four Seasons");
await page.fill('input[name="date"]', "2026-06-20");
await Promise.all([page.waitForURL((u) => /\/events\/[^/]+$/.test(u.pathname) && !/\/new$/.test(u.pathname)), page.click('button:has-text("Create event")')]);
await page.waitForLoadState("networkidle");
await shot("02-event-empty");

console.log("→ Upload floor plan (AI auto-detects)");
const inp1 = page.locator('input[type="file"]').first();
await inp1.setInputFiles("/tmp/floorplan.png");
await page.waitForSelector("text=/AI detected \\d+ tables/", { timeout: 90000 });
await page.waitForTimeout(1000);
await shot("03-floorplan-ai-parsed");

console.log("→ Switch to Guests tab");
await page.click('button:has-text("Guests")');
await page.waitForTimeout(400);
await shot("04-guests-empty");

console.log("→ Upload guest list (AI parses image with table labels)");
const inp2 = page.locator('input[type="file"]').first();
await inp2.setInputFiles("/tmp/guests.png");
await page.waitForSelector("text=/Imported \\d+ guests/", { timeout: 120000 });
await page.waitForTimeout(1500);
await shot("05-guests-imported");

console.log("→ Switch to Assign tab — see auto-assignments");
await page.click('button:has-text("Assign")');
await page.waitForTimeout(800);
await shot("06-assign-auto-seated");

console.log("→ QR codes tab");
await page.click('button:has-text("QR codes")');
await page.waitForTimeout(400);
page.once("dialog", async (d) => { await d.accept("Main Entrance"); });
await page.click('button:has-text("+ Add QR code")');
await page.waitForTimeout(1500);
await shot("07-qr-created");

const evState = await page.evaluate(async () => {
  const id = location.pathname.split("/")[3];
  const r = await fetch(`/api/events/${id}/state`);
  return r.json();
});
const slug = evState.event.publicSlug;
const qrId = evState.qrCodes?.[0]?.id;
console.log("publicSlug:", slug, "qrId:", qrId);

console.log("→ Mark Live");
await page.click('button:has-text("Mark Live")');
await page.waitForURL(/\/live$/, { timeout: 15000 });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3500);
await shot("08-live-view-host");

console.log("→ Guest scan (phone viewport, fresh ctx)");
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guest = await guestCtx.newPage();
await guest.goto(`${BASE}/e/${slug}?qr=${qrId}`);
await guest.waitForLoadState("networkidle");
const gShot = async (n) => { const p = `${SHOTS}/${n}.png`; await guest.screenshot({ path: p, fullPage: false }); console.log("📸", p); };
await gShot("09-guest-lookup");

// Try a couple of names
await guest.fill("#lastName", "Shipp");
await guest.click('button:has-text("Find my seat")');
await guest.waitForTimeout(1200);
await gShot("10-guest-shipp-result");

// Search again, pick a multi-match name
await guest.click('button:has-text("Search again")');
await guest.waitForTimeout(400);
await guest.fill("#lastName", "Smith");
await guest.click('button:has-text("Find my seat")');
await guest.waitForTimeout(800);
await gShot("11-guest-smith-multi");

// Pick one of them
await guest.locator('button:has-text("John Smith"), button:has-text("Mary Smith"), button:has-text("Bob Smith")').first().click();
await guest.waitForTimeout(1000);
await gShot("12-guest-smith-result");

await browser.close();
console.log("\n✅ full E2E done");
