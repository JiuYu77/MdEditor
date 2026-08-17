// repro/test38.mjs —— 新增语法验证：删除线 / 分割线 / 转义符（\* \#）
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  if (!ok) failed++;
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__lines, { timeout: 20000 });

  // 第一行放普通文字：光标默认在第 1 行，该行显示源码跳过装饰；
  // 删除线/分割线/转义都放在其后，避免被"光标行源码显示"影响
  const doc = ["普通文字", "", "~~删除线内容~~", "", "---", "", "\\*转义星号\\* 与 \\#转义井号"].join("\n");
  await page.evaluate((d) => window.__setValue(d), doc);
  await new Promise((r) => setTimeout(r, 900));

  // 1) 删除线：无 ~~ 残留 + md-strike 类 + text-decoration: line-through
  const strike = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll("#editor .cm-line")).find((l) => l.textContent.includes("删除线内容"));
    const mark = line ? line.querySelector(".md-strike") : null;
    return {
      found: !!line,
      rawText: line ? line.textContent : null,
      hasMark: !!mark,
      deco: mark ? getComputedStyle(mark).textDecorationLine : null,
    };
  });
  check("删除线行渲染", strike.found, strike.rawText);
  check("删除线无 ~~ 残留", !!strike.rawText && !strike.rawText.includes("~~"), strike.rawText);
  check("删除线 .md-strike 类", strike.hasMark);
  check("删除线样式 line-through", strike.deco === "line-through", strike.deco);

  // 2) 分割线：整行替换为 .md-hr 横线元素
  const hr = await page.evaluate(() => {
    const hrs = document.querySelectorAll("#editor .md-hr");
    return { count: hrs.length, border: hrs.length ? getComputedStyle(hrs[0]).borderTopWidth : null };
  });
  check("分割线 .md-hr 渲染", hr.count >= 1, "count=" + hr.count);
  check("分割线有可见上边框", hr.count >= 1 && parseFloat(hr.border) > 0, hr.border);

  // 3) 转义符：反斜杠隐藏，字符正常显示
  const esc = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll("#editor .cm-line")).find((l) => l.textContent.includes("转义"));
    return { text: line ? line.textContent : null };
  });
  check("转义行无反斜杠", !!esc.text && !esc.text.includes("\\"), esc.text);
  check("转义字符 * # 正常显示", !!esc.text && esc.text.includes("*") && esc.text.includes("#"), esc.text);

  // 4) 源码不被修改（装饰只影响显示）
  const val = await page.evaluate(() => window.__value());
  check("源码保留 ~~删除线~~", val.includes("~~删除线内容~~"));
  check("源码保留 ---", val.includes("---"));
  check("源码保留 \\*", val.includes("\\*转义星号"));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
