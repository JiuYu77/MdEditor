// repro/test.mjs —— 用本机 Edge 驱动 repro 页面，验证 WYSIWYG 点击定位
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5173/repro/index.html";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  page.on("console", (m) => console.log("[console]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__view && window.__runDiag, { timeout: 20000 });

  await page.evaluate(() => window.__scrollToTop());
  await new Promise((r) => setTimeout(r, 500));

  console.log("=== 高度图 vs 真实 DOM ===");
  console.log(JSON.stringify(await page.evaluate(() => window.__dumpMetrics()), null, 2));

  console.log("\n=== viewport ===");
  console.log(JSON.stringify(await page.evaluate(() => window.__dumpViewport())));

  console.log("\n=== 高度图行块（MERGED = 多行被当成一个块，即“一块内容当成一行”）===");
  console.log(await page.evaluate(() => window.__dumpBlocks()));

  console.log("\n=== DOM 渲染行 ===");
  console.log(await page.evaluate(() => window.__dumpDOM()));

  console.log("\n=== 语法树 ===");
  console.log(await page.evaluate(() => window.__dumpTree()));

  console.log("\n=== 实际装饰集（每行）===");
  console.log(await page.evaluate(() => window.__dumpDecos()));

  console.log("\n=== 高度图长度 ===");
  console.log(JSON.stringify(await page.evaluate(() => window.__dumpMap())));

  console.log("\n=== 内容 DOM HTML（截断）===");
  console.log(await page.evaluate(() => window.__dumpHTML()));

  console.log("\n=== posAtCoords 逐行诊断（期望 hit 行 == 行号）===");
  const diag = await page.evaluate(() => window.__runDiag());
  console.log(diag);

  console.log("\n=== DOM 渲染行（检查是否有一块内容被当成一行）===");
  const dom = await page.evaluate(() => window.__dumpDOM());
  console.log(dom);

  console.log("\n=== 真实点击测试（点击后光标应在目标行内）===");
  // 找出可见的文档行（从 DOM 行号推断，避免越界点击）
  const targets = await page.evaluate(() => {
    const v = window.__view;
    const doc = v.state.doc;
    const out = [];
    for (let ln = 1; ln <= doc.lines; ln++) {
      const c = v.coordsAtPos(doc.line(ln).from);
      if (c && c.top > 0 && c.top < 800) out.push(ln);
    }
    return out;
  });
  let bad = 0;
  for (const ln of targets) {
    const c = await page.evaluate((n) => window.__clickLine(n), ln);
    if (c.error) { console.log(`行${ln}: ${c.error}`); continue; }
    await page.mouse.click(c.x, c.y);
    await new Promise((r) => setTimeout(r, 30));
    const sel = await page.evaluate(() => window.__selectionLine());
    const ok = sel.line === ln;
    if (!ok) bad++;
    console.log(`点击行${ln} (y=${Math.round(c.y)}) -> 光标在行${sel.line} "${sel.text.slice(0, 24)}" ${ok ? "OK" : "BAD"}`);
  }
  console.log(bad === 0 ? "\n全部点击 OK" : `\n${bad} 处点击错位`);
} finally {
  await browser.close();
}
