import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, statSync } from "fs";
import { join, extname } from "path";

const root = "d:/tabel";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const server = createServer((req, res) => {
  let p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = join(root, p.replace(/^\//, "").replace(/\.\./g, ""));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((r) => server.listen(8765, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n")[1]));

await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const zonePool = await page.locator("#zpPool .person-chip").count();
const cpPool = await page.locator("#cpPool .person-chip").count();
console.log("zone pool chips:", zonePool, "curator pool chips:", cpPool);

await page.locator("#zonePlacementPanelToggle").click();
await page.locator("#curatorPairingPanelToggle").click();
await page.waitForTimeout(500);

await page.locator("#zp-zone-spg1").click({ force: true });
await page.waitForTimeout(300);
const zoneSheetOpen = await page.locator("#zoneSheetOverlay.open").count();
console.log("zone sheet open after zone click:", zoneSheetOpen);

if (zoneSheetOpen) await page.locator("#zoneSheetCancel").click();

await page.locator("#cpCuratorNew").click({ force: true });
await page.waitForTimeout(300);
const curatorSheetOpen = await page.locator("#curatorSheetOverlay.open").count();
console.log("curator sheet open after new-curator click:", curatorSheetOpen);

if (errors.length) console.log("page errors:", errors.join("\n"));

await browser.close();
server.close();

if (zonePool === 0) process.exitCode = 1;
if (cpPool === 0) process.exitCode = 1;
if (!zoneSheetOpen) process.exitCode = 1;
if (!curatorSheetOpen) process.exitCode = 1;
