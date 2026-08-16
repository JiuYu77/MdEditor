// repro/test3.mjs —— 验证大纲 API + 菜单栏交互
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5173/repro/test3.html";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed && window.__renderMenu, { timeout: 20000 });

  // 1. 大纲解析
  const doc = [
    "# 一级 A",
    "## 二级 B",
    "正文段落",
    "# 一级 C",
    "```js",
    "# 代码里的假标题",
    "const x = 1;",
    "```",
    "标题\n===",
    "结尾",
  ].join("\n");
  await page.evaluate((t) => window.__setDoc(t), doc);
  await new Promise((r) => setTimeout(r, 300));
  console.log("=== 大纲（期望不含代码块内假标题，含 setext）===");
  console.log(await page.evaluate(() => window.__outline()));

  // 2. 跳转 + 光标回调
  console.log("\n=== 跳转到 一级 C 后光标 ===");
  await page.evaluate(() => {
    const ed = window.__ed;
    let last = null;
    ed.onCursorChange((line, col) => { last = { line, col }; });
    window.__lastCursor = () => JSON.stringify(last);
    const items = ed.getOutline();
    const c = items.find((i) => i.text === "一级 C");
    ed.setCursor(c.pos, false);
  });
  await new Promise((r) => setTimeout(r, 100));
  console.log("getCursor:", await page.evaluate(() => window.__cursor()));
  console.log("onCursorChange 最后回调:", await page.evaluate(() => window.__lastCursor()));

  // 3. 菜单栏
  console.log("\n=== 菜单栏 ===");
  await page.evaluate(() => window.__renderMenu());
  await new Promise((r) => setTimeout(r, 100));
  // 点击“文件”
  const labels = await page.$$(".menu-label");
  await labels[0].click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("点击[文件]后下拉数量:", await page.evaluate(() => window.__openMenuCount()));
  console.log("下拉条目:", await page.evaluate(() => window.__visibleItemLabels()));
  // 点击“新建文件”
  const items = await page.$$(".menu-item");
  await items[0].click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("点击[新建文件]后 clicked:", await page.evaluate(() => window.__clicked()));
  console.log("执行后下拉数量(应为0):", await page.evaluate(() => window.__openMenuCount()));
  // 再次打开后点击外部关闭
  await labels[0].click();
  await new Promise((r) => setTimeout(r, 50));
  // 悬停“视图”应切换下拉
  const labelsB = await page.$$(".menu-label");
  await labelsB[1].hover();
  await new Promise((r) => setTimeout(r, 100));
  console.log("悬停[视图]后下拉条目:", await page.evaluate(() => window.__visibleItemLabels()));
  await page.mouse.click(600, 400); // 编辑区空白处
  await new Promise((r) => setTimeout(r, 100));
  console.log("点击外部后下拉数量(应为0):", await page.evaluate(() => window.__openMenuCount()));
  // 键盘：打开视图菜单 → 方向键 → Enter
  const labels2 = await page.$$(".menu-label");
  await labels2[1].click();
  await new Promise((r) => setTimeout(r, 50));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 100));
  console.log("键盘导航后 clicked:", await page.evaluate(() => window.__clicked()));
} finally {
  await browser.close();
}
