// repro/test2.mjs —— 验证单个 "-" 显示 + 表格分隔行高度
import puppeteer from "puppeteer-core";

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
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__view && window.__setDoc && window.__lineVisibility, { timeout: 20000 });

  for (const doc of ["x\n-", "a\n- \nb", "-", "x"]) {
    console.log(`\n===== syncCheck doc = ${JSON.stringify(doc)} =====`);
    const r = await page.evaluate((t) => window.__syncCheck(t), doc);
    console.log(JSON.stringify(r, null, 1));
  }

  // 表格分隔行高度测量
  console.log("\n===== 表格分隔行高度 =====\n");
  const tableDoc = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n结尾";
  await page.evaluate((t) => window.__setDoc(t), tableDoc);
  await new Promise((r) => setTimeout(r, 300));
  const m = await page.evaluate(() => {
    const v = window.__view;
    const doc = v.state.doc;
    const out = [];
    for (let ln = 1; ln <= doc.lines; ln++) {
      const domLine = v.contentDOM.querySelectorAll(".cm-line")[ln - 1];
      const cls = domLine ? domLine.className : "";
      const h = domLine ? domLine.getBoundingClientRect().height : -1;
      out.push(`行${ln} "${doc.line(ln).text.slice(0, 20)}" h=${h.toFixed(1)} class="${cls}"`);
    }
    return out.join("\n") + "\nmetrics: " + JSON.stringify(window.__dumpMetrics());
  });
  console.log(m);

  // Setext 标题渲染
  console.log("\n===== Setext 标题 =====\n");
  for (const doc of ["x\n-\n后文", "标题\n===\n正文"]) {
    await page.evaluate((t) => window.__setDoc(t), doc);
    await new Promise((r) => setTimeout(r, 250));
    console.log(`doc=${JSON.stringify(doc)}`);
    console.log(await page.evaluate(() => {
      const v = window.__view;
      const doc = v.state.doc;
      const out = [];
      for (let ln = 1; ln <= doc.lines; ln++) {
        const domLine = v.contentDOM.querySelectorAll(".cm-line")[ln - 1];
        const cls = domLine ? domLine.className : "";
        const h = domLine ? domLine.getBoundingClientRect().height : -1;
        const txt = domLine ? domLine.textContent.replace(/\n/g, "\\n") : "NO DOM";
        out.push(`行${ln} h=${h.toFixed(1)} class="${cls}" text="${txt}"`);
      }
      return out.join("\n");
    }));
    console.log("metrics:", JSON.stringify(await page.evaluate(() => window.__dumpMetrics())));
  }

  // setext + 表格混合文档的点击定位（0 高行/1px 行不得破坏映射）
  console.log("\n===== 混合文档点击 =====\n");
  await page.evaluate((t) => window.__setDoc(t), "标题\n===\n正文\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n结尾");
  await new Promise((r) => setTimeout(r, 300));
  const targets = await page.evaluate(() => {
    const v = window.__view;
    const doc = v.state.doc;
    const out = [];
    for (let ln = 1; ln <= doc.lines; ln++) {
      const c = v.coordsAtPos(doc.line(ln).from);
      if (c && c.top > 0 && c.top < 800 && c.bottom - c.top > 1) out.push(ln);
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
    console.log(`点击行${ln} -> 光标在行${sel.line} "${sel.text.slice(0, 20)}" ${ok ? "OK" : "BAD"}`);
  }
  console.log(bad === 0 ? "全部 OK" : `${bad} 处错位`);
} finally {
  await browser.close();
}
