// repro/test24.mjs —— 调试:压缩分支的输入输出
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| 的的 | 单独的 sss的上述水水水水水sssss | 黄河之水天上来 |",
    "| 是否 | 22 ss | 春江潮水连海平,海上明月共潮生 |",
    "| sdf | 山东 | 艳艳随波千万里,何处春江无月明。江流宛转绕芳甸,月照花林皆似霰 |",
    "",
  ].join("\n");

  await page.setViewport({ width: 800, height: 900 });
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(800);
  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#editor .cm-line.md-table-row"));
    const row0 = rows[0];
    const cells = Array.from(row0.querySelectorAll(".md-table-cell")).map((c) => ({
      style: c.getAttribute("style"),
      rectW: Math.round(c.getBoundingClientRect().width),
    }));
    const scroller = document.querySelector("#editor .cm-scroller");
    const content = document.querySelector("#editor .cm-content");
    const editor = document.querySelector("#editor");
    return {
      editorW: editor.getBoundingClientRect().width,
      scrollerClientW: scroller.clientWidth,
      scrollerScrollW: scroller.scrollWidth,
      contentClientW: content.clientWidth,
      contentPadding: getComputedStyle(content).padding,
      cells,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: "repro/table-w800-debug.png" });
} finally {
  await browser.close();
}
