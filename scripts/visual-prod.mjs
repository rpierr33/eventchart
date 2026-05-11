// Capture production screenshots after redesign
import { chromium } from "playwright";
import { mkdir } from "fs/promises";

const BASE = "https://eventchart.vercel.app";
const SHOTS = "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/prod-redesign";
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const shot = async (n) => { const p = `${SHOTS}/${n}.png`; await page.screenshot({ path: p, fullPage: false }); console.log("📸", p); };

console.log("→ Landing");
await page.goto(BASE); await page.waitForLoadState("networkidle");
await shot("01-landing");

console.log("→ Login");
await page.goto(`${BASE}/login`); await page.waitForLoadState("networkidle");
await shot("02-login");

console.log("→ Signup");
await page.goto(`${BASE}/signup`); await page.waitForLoadState("networkidle");
await shot("03-signup");

console.log("→ Sign in as daisy-prod");
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "daisy-prod@test.com");
await page.fill('input[name="password"]', "testpass123");
await Promise.all([page.waitForURL(/\/dashboard/), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");
await shot("04-dashboard-empty");

console.log("→ Guest lookup (mobile)");
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/e/onwm6thm`); await phone.waitForLoadState("networkidle");
await phone.screenshot({ path: `${SHOTS}/05-guest-lookup-empty.png` });
console.log("📸", `${SHOTS}/05-guest-lookup-empty.png`);

await phone.fill("#lastName", "Shipp");
await phone.click('button:has-text("Find my seat")');
await phone.waitForTimeout(1200);
await phone.screenshot({ path: `${SHOTS}/06-guest-shipp-table.png` });
console.log("📸", `${SHOTS}/06-guest-shipp-table.png`);

await browser.close();
console.log("done");
