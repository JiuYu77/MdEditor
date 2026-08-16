// repro/test26.mjs —— 真实鼠标点击单元格各位置,检查光标列号(对齐目标列)
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
  await page.setViewport({ width: 1100, height: 900 });
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
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(600);

  // 模拟真实鼠标点击:取第 3 数据行各单元格的 左缘/中央/右缘 坐标点击,再读光标列
  const probe = async (frac) => {
    // 先清空分隔行,再点击,再点居中,看哪个列变了
    await page.evaluate((d) => window.__ed.setValue(d), doc);
    await sleep(300);
    const cell = await page.evaluate((f) => {
      const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
      const row = rows[2]; // 第 3 数据行
      const cells = row.querySelectorAll(".md-table-cell");
      const out = [];
      cells.forEach((c) => {
        const r = c.getBoundingClientRect();
        out.push({ left: r.left, right: r.right, x: r.left + r.width * f, text: c.textContent.slice(0, 10) });
      });
      return out;
    }, frac);
    for (const c of cell) {
      await page.mouse.click(c.x, 120); // 行中部
      await sleep(200);
      const col = await page.evaluate(() => {
        // 通过把光标所在格文本周围的分隔行列变化来判断:点居中
        const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
        const b = btns.find((x) => x.title === "列居中");
        if (b) b.click();
        return null;
      });
      await sleep(250);
      const delim = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
      // 判断哪个列被居中
      const segs = delim.split("|").slice(1, -1).map((s) => (s.includes(":---:") ? "C" : s.includes(":") ? (s.trim().startsWith(":") ? "L" : "R") : "L"));
      // 重置
      await page.evaluate((d) => window.__ed.setValue(d), doc);
      await sleep(300);
      console.log(`点击 ${frac * 100}% 处「${c.text}」(${Math.round(c.left)}-${Math.round(c.right)}) → 分隔行 ${JSON.stringify(delim)} → 各列对齐 ${JSON.stringify(segs)}`);
    }
  };

  console.log("== 点击单元格左缘(20%) ==");
  await probe(0.2);
  console.log("== 点击单元格中央(50%) ==");
  await probe(0.5);
  console.log("== 点击单元格右缘(80%) ==");
  await probe(0.8);
} finally {
  await browser.close();
}
