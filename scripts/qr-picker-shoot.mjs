import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto("https://eventchart.vercel.app/login");
await page.fill('input[name="email"]', "daisy@test.com");
await page.fill('input[name="password"]', "testpass123");
await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");

// Go to the Smith Wedding event setup → QR tab
await page.goto("https://eventchart.vercel.app/dashboard/events/cmp0jt4zl0001ia9klwpeskvp?tab=qr");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);
await page.screenshot({ path: "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/qr-picker/01-qr-tab.png" });
console.log("📸 01-qr-tab.png");

// Open the New QR modal
await page.click('button:has-text("+ New QR")');
await page.waitForTimeout(700);
await page.screenshot({ path: "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/qr-picker/02-modal-landmarks-and-tables.png" });
console.log("📸 02-modal-landmarks-and-tables.png");

// Scroll the picker list down to see tables (within the modal's left column)
await page.click('text=Stage');
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/qr-picker/03-stage-selected.png" });
console.log("📸 03-stage-selected.png");

await page.click('text=T7');
await page.waitForTimeout(400);
await page.screenshot({ path: "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/qr-picker/04-table-selected.png" });
console.log("📸 04-table-selected.png");

await browser.close();
