// repro/test9.mjs —— 修复验证：闭合围栏隐藏 / 标题无下划线 / 表格表头无下划线
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1420/repro/test9.html";
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

  const doc = [
    "```c",
    "#include <stdio.h>",
    "int main() {",
    "  return 0;",
    "}",
    "```",
    "",
    "```",
    "plain text content",
    "```",
    "",
    "# 大标题",
    "",
    "山东泰安",
    "========",
    "",
    "| _t1_ | _t2_ |",
    "| ---- | ---- |",
    "| _1_1 | 是否 | _2_2 |",
    "| sdf  | 山东 |",
  ].join("\n");
  await page.evaluate((d) => window.__setValue(d), doc);
  await new Promise((r) => setTimeout(r, 1200));

  const lines = await page.evaluate(() => window.__lines());
  console.log("=== 各行渲染 ===");
  lines.forEach((l, i) =>
    console.log(`行${i + 1}: h=${l.h.toFixed(1)} deco=${l.deco} ${JSON.stringify(l.cls)} | ${JSON.stringify(l.text)}`),
  );

  console.log("\n=== 1) 围栏反引号 ===");
  const bv = await page.evaluate(() => window.__backticksVisible());
  check("渲染文本中无 ```", bv.length === 0, bv.length ? JSON.stringify(bv) : "");
  const closeLine = lines.find((l) => l.cls.includes("md-code-close"));
  check("闭合围栏行折叠为 0 高 (md-code-close)", !!closeLine && closeLine.h < 2, closeLine ? `h=${closeLine.h}` : "未找到 md-code-close 行");
  const endLine = lines.find((l) => l.cls.includes("md-code-block-end"));
  check("圆角落在最后一行代码上", !!endLine && endLine.text.includes("}"), endLine ? JSON.stringify(endLine.text) : "未找到 md-code-block-end");

  console.log("\n=== 2) 标题下划线 ===");
  const hus = await page.evaluate(() => window.__headingUnderlines());
  hus.forEach((h) => console.log(`  标题 "${h.text}" deco=${h.deco} cls=${h.cls}`));
  check("标题均无 text-decoration underline", hus.length > 0 && hus.every((h) => !h.deco.includes("underline")), `共 ${hus.length} 个标题 span`);
  const atxLine = lines.find((l) => l.text.includes("大标题"));
  check("ATX 标题顶格（# 及空格移除）", !!atxLine && atxLine.text.trimStart().startsWith("大标题") && !atxLine.text.startsWith(" "), atxLine ? JSON.stringify(atxLine.text) : "未找到");

  console.log("\n=== 3) 表格第一行 ===");
  const thd = await page.evaluate(() => window.__tableHeaderDecos());
  if (thd) {
    thd.forEach((s) => console.log(`  span "${s.text}" deco=${s.deco} cls=${s.cls}`));
    check("表头行所有 span 无 underline", thd.every((s) => !s.deco.includes("underline")));
  } else {
    check("找到表头行 (md-table-header)", false, "未找到");
  }

  console.log("\n=== 4) 代码高亮回归 ===");
  const hl = await page.evaluate(() => window.__hlCount());
  check("代码块内仍有 ͼ 高亮 token", hl > 0, `hl=${hl}`);

  // 截图供视觉复核
  await page.screenshot({ path: "repro/test9-shot.png" });
  console.log("\n截图已存 repro/test9-shot.png");

  console.log("\n=== 5) 代码块语言标签（无残留原文）===");
  const starts = lines.filter((l) => l.cls.includes("md-code-block-start"));
  starts.forEach((l) => console.log(`  首行: ${JSON.stringify(l.text)}`));
  const cStart = starts.find((l) => !l.text.includes("plaintext"));
  const plainStart = starts.find((l) => l.text.includes("plaintext"));
  check("```c 首行仅工具栏（无残留 c）", !!cStart && cStart.text === "▾c复制", cStart ? JSON.stringify(cStart.text) : "未找到");
  check("无语言代码块标签为 plaintext", !!plainStart && plainStart.text === "▾plaintext复制", plainStart ? JSON.stringify(plainStart.text) : "未找到");

  console.log("\n=== 6) 语言可手动输入 + 选择即保存 ===");
  // 手动输入自定义语言 toml（第一个代码块，```c）
  await page.evaluate(() => window.__openPicker(0));
  await new Promise((r) => setTimeout(r, 60));
  const prefill = await page.evaluate(() => window.__pickerInputValue());
  check("输入框以文件为准预填 c", prefill === "c", `value=${JSON.stringify(prefill)}`);
  await page.evaluate(() => window.__typeLang("toml"));
  await new Promise((r) => setTimeout(r, 250));
  const afterTyped = await page.evaluate(() => window.__value());
  check("手动输入 toml 写入文件 (```toml)", afterTyped.includes("```toml"), "");
  const starts2 = await page.evaluate(() => window.__lines());
  const c2 = starts2.find((l) => l.cls.includes("md-code-block-start") && !l.text.includes("plaintext"));
  check("chip 显示 toml", !!c2 && c2.text.includes("toml"), c2 ? JSON.stringify(c2.text) : "未找到");

  // 预设选择 plaintext（第二个代码块，无语言）：写入 plaintext 保存
  await page.evaluate(() => window.__openPicker(1));
  await new Promise((r) => setTimeout(r, 60));
  const pickerOpen = await page.evaluate(() => window.__pickerOpen());
  await page.evaluate(() => window.__clickLangItem(0)); // plaintext
  await new Promise((r) => setTimeout(r, 250));
  const afterPlain = await page.evaluate(() => window.__value());
  check("选择 plaintext 写入文件 (```plaintext)", pickerOpen && afterPlain.includes("```plaintext"), "");
  const starts3 = await page.evaluate(() => window.__lines());
  const p3 = starts3.find((l) => l.cls.includes("md-code-block-start") && !l.text.includes("toml"));
  check("chip 显示 plaintext（与文件一致）", !!p3 && p3.text.includes("plaintext"), p3 ? JSON.stringify(p3.text) : "未找到");

  console.log("\n页面错误日志:", (await page.evaluate(() => window.__logs())).split("\n").filter((l) => l.includes("error")).join("; ") || "无");
  console.log(failed === 0 ? "\n全部通过 ✔" : `\n${failed} 项失败 ✘`);
} finally {
  await browser.close();
}
