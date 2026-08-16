// repro/test35.mjs —— 侧边栏全局搜索面板验证(app-test mock)
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5174/repro/app-test.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (name, c, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  c ? ok++ : fail++;
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => document.querySelector(".activity-bar"), { timeout: 20000 });
  await sleep(800);

  // 点击活动栏"搜索"按钮(等 title 就绪)
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll(".activity-bar button")).some((b) => (b.title || "") !== ""),
    { timeout: 15000 },
  );
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".activity-bar button"));
    const target = btns.find((b) => (b.title || "").includes("搜索") || (b.title || "").includes("Search"));
    if (!target) return null;
    target.click();
    return true;
  });
  console.log("点击搜索图标:", clicked);
  check("搜索面板可打开", clicked === true);

  await sleep(400);
  const panel = await page.evaluate(() => {
    const input = document.querySelector(".search-panel .search-input");
    const opts = Array.from(document.querySelectorAll(".search-opt")).map((b) => b.textContent.trim());
    return { hasInput: !!input, opts };
  });
  console.log("搜索面板:", JSON.stringify(panel));
  check("搜索输入框出现", panel.hasInput);
  check("区分大小写/整个单词按钮", panel.opts.includes("Aa") && panel.opts.includes("\\b"), JSON.stringify(panel.opts));

  // 输入查询词 → 防抖 → 结果渲染(mock 按文件名匹配)
  await page.type(".search-panel .search-input", "md");
  await sleep(900);
  const result = await page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll(".search-group"));
    const rows = Array.from(document.querySelectorAll(".search-result-row"));
    const summary = document.querySelector(".search-summary")?.textContent ?? "";
    return {
      groupCount: groups.length,
      groupNames: groups.map((g) => g.querySelector(".search-group-name")?.textContent),
      rowCount: rows.length,
      summary,
    };
  });
  console.log("搜索 md 结果:", JSON.stringify(result));
  check("结果按文件分组", result.groupCount >= 1, "groups=" + result.groupCount);
  check("分组含 .md 文件", result.groupNames.some((n) => n && n.endsWith(".md")), JSON.stringify(result.groupNames));
  check("汇总计数显示", /\d/.test(result.summary) && result.summary.includes("3"), "summary=" + result.summary);

  // 展开分组,点击结果行(应触发 onOpenResult,App 打开文件;mock read_file 返回固定文档)
  await page.evaluate(() => {
    const h = document.querySelector(".search-group-header");
    if (h) h.click();
  });
  await sleep(300);
  const rowsAfterExpand = await page.evaluate(() => document.querySelectorAll(".search-result-row").length);
  check("展开分组显示匹配行", rowsAfterExpand >= 1, "rows=" + rowsAfterExpand);
  await page.evaluate(() => {
    const row = document.querySelector(".search-result-row");
    if (row) row.click();
  });
  await sleep(800);
  const opened = await page.evaluate(() => {
    const editor = document.querySelector(".cm-content");
    return {
      hasEditorContent: !!editor && editor.textContent.length > 0,
      title: document.querySelector(".titlebar-app") ? document.title : null,
    };
  });
  console.log("点击结果后:", JSON.stringify(opened));
  check("点击结果打开文档", opened.hasEditorContent);

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
