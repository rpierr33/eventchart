import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
await page.goto("https://eventchart.vercel.app/api/qr/print?eventSlug=onwm6thm&qr=cmp0jtv0v000bia9k7x1t0bem");
await page.waitForLoadState("networkidle");
await page.screenshot({ path: "/Users/ralphpierre/Desktop/kalocode/2026-projects/seating-chart-platform/screenshots/prod-redesign/07-qr-print-sheet.png", fullPage: false });
console.log("📸 07-qr-print-sheet.png");
await browser.close();
