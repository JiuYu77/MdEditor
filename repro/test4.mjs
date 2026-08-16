// repro/test4.mjs —— 大纲树展开/折叠验证
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5173/repro/test4.html";

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
  await page.waitForFunction(() => window.__stats, { timeout: 20000 });

  const show = (label) => page.evaluate((lbl) => {
    const s = window.__stats();
    return `${lbl}: items=${s.items} carets=${s.carets} glyphs=[${s.carets ? s.caretGlyphs.join(",") : ""}] texts=[${s.texts.join("|")}] active=[${s.activeTexts.join("|")}] clicked=${s.clicked}`;
  }, label);

  console.log(await show("初始(全部展开)"));
  // 折叠 A（第 1 个 caret）
  await page.evaluate(() => window.__clickCaret(0));
  await new Promise((r) => setTimeout(r, 50));
  console.log(await show("折叠 A 后"));
  // 点击 A 的文本 → 跳转
  await page.evaluate(() => window.__clickItem(0));
  await new Promise((r) => setTimeout(r, 50));
  const s1 = await page.evaluate(() => window.__stats());
  console.log("点击 A 文本后 clicked:", s1.clicked);
  // 重新展开 A（再点 caret）
  await page.evaluate(() => window.__clickCaret(0));
  await new Promise((r) => setTimeout(r, 50));
  console.log(await show("重新展开 A 后"));
  // 折叠 B（现在第 2 个 caret）
  await page.evaluate(() => window.__clickCaret(1));
  await new Promise((r) => setTimeout(r, 50));
  console.log(await show("折叠 B 后"));
  // 光标移动到 A1a（索引 2）→ 自动展开祖先
  await page.evaluate(() => window.__setActive(2));
  await new Promise((r) => setTimeout(r, 50));
  console.log(await show("active=A1a 后"));
} finally {
  await browser.close();
}
