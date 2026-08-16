// render-icon.mjs —— 把 design/icon.svg 渲染为 PNG(1024 + 512)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const svg = fs.readFileSync(path.join("design", "icon.svg"), "utf8");
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.goto("about:blank");
  await page.setContent(`<html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body><img id="i" width="1024" height="1024" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/></body></html>`);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join("design", "icon-1024.png"), clip: { x: 0, y: 0, width: 1024, height: 1024 }, omitBackground: true });
  // 512 版本(缩放)
  await page.setViewport({ width: 512, height: 512 });
  await page.setContent(`<html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body><img id="i" width="512" height="512" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/></body></html>`);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join("design", "icon-512.png"), clip: { x: 0, y: 0, width: 512, height: 512 }, omitBackground: true });
  console.log("rendered");
} finally {
  await browser.close();
}
