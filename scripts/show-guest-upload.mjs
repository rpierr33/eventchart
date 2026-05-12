// Drives the planner's guest-upload flow end-to-end so you can SEE every screen.
// Uses the file-upload path with a .txt list because that triggers the rich
// review modal (VIP column + table label column + auto-seat on save).
//
// Captures: Guests tab → AI review modal with VIP rows pre-flagged + tinted →
// final saved list with VIP badges and table assignments.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const EMAIL = "daisy@test.com";
const PASSWORD = "testpass123";
const EVENT_ID = "cmp0jt4zl0001ia9klwpeskvp";
const DIR = resolve("screenshots/guest-upload-" + new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(DIR, { recursive: true });

// Realistic messy list. Mix of:
//   • title prefixes (Senator, Reverend, Judge) → VIP flagged
//   • section headers ("Head Table:") → VIP flagged
//   • bare Mr./Mrs. → NOT VIP (per the prompt)
//   • plus-ones via "+1"
//   • table-label hints like "Table 14:" → auto-seat to that table
const SAMPLE = `Head Table:
Senator Maya Pierre
Reverend Lawrence Pierre

Table 14:
Mr. and Mrs. Bennett
Judge Carla Bennett
★ Cousin Devon Bennett

Table 15:
James Whitfield
Olivia Whitfield
Mark Johnson +1

Bride's Friends:
Sam Park
Riya Patel
`;

const sampleFile = `${DIR}/sample-list.txt`;
await writeFile(sampleFile, SAMPLE);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
let step = 0;
async function shot(name) {
  await page.screenshot({ path: `${DIR}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: true });
  console.log(`  📸 ${name}`);
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

  // 2. Guests tab
  await page.goto(`${BASE}/dashboard/events/${EVENT_ID}?tab=guests`, { waitUntil: "networkidle" });
  await page.waitForSelector('text=📎 Upload guest list', { timeout: 10000 });
  await shot("guests-tab");

  // 3. Upload the .txt file through the hidden file input
  const fileInput = page.locator('input[type="file"][accept*="csv"]');
  await fileInput.setInputFiles(sampleFile);
  console.log("⏳ AI parsing — usually 5-15s…");

  // 4. Wait for the AIReviewModal
  await page.waitForSelector('text=Review AI-parsed guests', { timeout: 60000 });
  await page.waitForTimeout(800); // let rows fully render
  await shot("ai-review-modal");

  // Dump what the AI extracted so you can see the VIP judgment in the terminal too
  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr'));
    return trs.map(tr => {
      const inputs = tr.querySelectorAll('input');
      const text = Array.from(inputs).map(i => i.type === 'checkbox' ? (i.checked ? 'VIP' : '') : i.value).filter(Boolean);
      return text;
    });
  });
  console.log("\n┌─ AI extracted rows ──────────────────────────────────");
  for (const r of rows) console.log("│ " + r.join(" · "));
  console.log("└──────────────────────────────────────────────────────\n");

  // 5. Save
  const saveBtn = page.locator('button').filter({ hasText: /^Save \d+ guests$/ }).first();
  const saveLabel = await saveBtn.textContent();
  await saveBtn.click();
  console.log("⏳ Saving:", saveLabel);
  await page.waitForTimeout(3000); // bulk insert + auto-seat + reload

  // 6. Show the final list with VIP badges + table assignments
  await page.waitForSelector('text=📎 Upload guest list', { timeout: 10000 });
  await shot("guests-after-save");

  // Verify via the page DOM
  const summary = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li, tr')).map(el => el.innerText);
    const ourNames = ['Pierre', 'Bennett', 'Whitfield', 'Park', 'Patel', 'Johnson'];
    return items.filter(t => ourNames.some(n => t.includes(n))).map(t => t.replace(/\s+/g, ' ').trim().slice(0, 100));
  });
  console.log("\n┌─ Saved guests (filtered to our test names) ──────────");
  for (const t of summary.slice(0, 20)) console.log("│ " + t);
  console.log("└──────────────────────────────────────────────────────");

  console.log(`\n✓ Done. Screenshots: ${DIR}`);
} catch (e) {
  console.error("\n✗ FAIL:", e.message);
  try { await shot("error"); } catch {}
} finally {
  await browser.close();
}
