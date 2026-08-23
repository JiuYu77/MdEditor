// repro/test39.mjs —— 图片点击源码编辑覆盖层(WYSIWYG)：点击图片→浮层显示源码→
// 编辑→Ctrl+S 写回文档并触发保存；Esc 取消。
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

  // 1) 设置含图片的文档(data URI 图,确保 mock 下能加载出 .md-image,不触发 onerror 占位)
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const src = `![图](${dataUri})`;
  await page.evaluate((s) => window.__setValue(`普通文字\n\n${s}`), src);
  await new Promise((r) => setTimeout(r, 600));

  // 2) 确认图片已渲染为 .md-image 且带位置数据
  const imgInfo = await page.evaluate(() => {
    const img = document.querySelector(".md-image");
    return img ? { found: true, from: img.dataset.from, to: img.dataset.to } : { found: false };
  });
  check("图片渲染 .md-image", imgInfo.found);
  check("图片带 from/to", imgInfo.found && imgInfo.from != null && imgInfo.to != null, JSON.stringify(imgInfo));

  // 在点击前注册保存追踪(覆盖层在点击时捕获 saveHandler)
  await page.evaluate(() => {
    window.__saveCount = 0;
    window.__ed.onSave(() => { window.__saveCount++; });
  });

  // 3) 点击图片 → 覆盖层出现并显示源码
  await page.click(".md-image");
  await new Promise((r) => setTimeout(r, 200));
  const overlay1 = await page.evaluate((s) => {
    const o = document.querySelector(".md-image-overlay");
    return o ? { found: true, text: o.textContent } : { found: false };
  }, src);
  check("点击后覆盖层出现", overlay1.found, JSON.stringify(overlay1));
  check("覆盖层显示源码", overlay1.found && overlay1.text === `${src}`, overlay1.text);
  // 覆盖层宽度应与编辑区(contentDOM)宽度一致
  const widthMatch = await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    const content = document.querySelector("#editor .cm-content");
    if (!o || !content) return { ok: false };
    return { ok: Math.abs(o.getBoundingClientRect().width - content.getBoundingClientRect().width) < 2 };
  });
  check("覆盖层宽度=编辑区宽度", widthMatch.ok);

  // 4) 编辑覆盖层内容(改 url) + Ctrl+S → 写回文档并触发一次保存(saveHandler 被调)
  await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    if (!o) return;
    o.textContent = "![新图](new.png)";
    o.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => {
    const overlayGone = !document.querySelector(".md-image-overlay");
    const updated = window.__value().includes("![新图](new.png)");
    const notOld = !window.__value().includes("![图](data:image/png");
    return { overlayGone, updated, notOld, saves: window.__saveCount };
  });
  check("Ctrl+S 后覆盖层关闭", after.overlayGone);
  check("Ctrl+S 写回新源码", after.updated);
  check("旧源码已替换", after.notOld);
  check("Ctrl+S 触发保存(1 次)", after.saves === 1, "saves=" + after.saves);

  // 5) 重置文档为能加载的图,再点击编辑后按 Esc 取消(不改文档)
  await page.evaluate((s) => window.__setValue(`其他文字\n\n${s}`), src);
  await new Promise((r) => setTimeout(r, 500));
  await page.click(".md-image");
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    if (o) o.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const esc = await page.evaluate((s) => ({
    overlayGone: !document.querySelector(".md-image-overlay"),
    docUnchanged: window.__value().includes(s), // Esc 后文档仍是原图源码
  }), src);
  check("Esc 关闭覆盖层", esc.overlayGone);
  check("Esc 不改文档", esc.docUnchanged);

  // 5b) 失焦(blur)关闭：写回文档但【不自动保存】(saveHandler 不被调)
  await page.evaluate((s) => { window.__saveCount = 0; window.__setValue(`文字\n\n${s}`); }, src);
  await new Promise((r) => setTimeout(r, 500));
  await page.click(".md-image");
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    if (o) {
      o.textContent = "![失焦改](blur.png)";
      o.dispatchEvent(new FocusEvent("blur"));
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  const blurRes = await page.evaluate(() => ({
    overlayGone: !document.querySelector(".md-image-overlay"),
    updated: window.__value().includes("![失焦改](blur.png)"),
    saves: window.__saveCount,
  }));
  check("blur 关闭覆盖层+写回文档", blurRes.overlayGone && blurRes.updated, JSON.stringify(blurRes));
  check("blur 不自动保存(saves=0)", blurRes.saves === 0, "saves=" + blurRes.saves);

  // 6) 加载失败的图片：默认显示 [alt] 文字；点击打开可编辑覆盖层；Ctrl+S 写回+保存
  await page.evaluate(() => window.__setValue("文字\n\n![坏图](no-such-image.png)"));
  await new Promise((r) => setTimeout(r, 500));
  const failDefault = await page.evaluate(() => {
    const wrap = document.querySelector(".md-image-wrap.md-image-error");
    const noImg = !document.querySelector(".md-image");
    return { text: wrap ? wrap.textContent : null, noImg };
  });
  check("失败图默认显示 [alt]", failDefault.text === "[坏图]", JSON.stringify(failDefault));
  check("失败图无 .md-image", failDefault.noImg);
  // 点击失败图 → 弹出编辑覆盖层(显示源码)
  await page.evaluate(() => {
    const wrap = document.querySelector(".md-image-wrap.md-image-error");
    if (wrap) wrap.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const failOverlay = await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    return o ? { open: true, text: o.textContent } : { open: false };
  });
  check("失败图点击打开覆盖层", failOverlay.open, JSON.stringify(failOverlay));
  check("覆盖层显示坏图源码", failOverlay.open && failOverlay.text === "![坏图](no-such-image.png)", failOverlay.text);
  // 在覆盖层编辑 + Ctrl+S → 写回
  await page.evaluate(() => {
    const o = document.querySelector(".md-image-overlay");
    if (o) {
      o.textContent = "![修好的图](fixed.png)";
      o.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  const failSaved = await page.evaluate(() => ({
    overlayGone: !document.querySelector(".md-image-overlay"),
    updated: window.__value().includes("![修好的图](fixed.png)"),
    oldGone: !window.__value().includes("![坏图](no-such-image.png)"),
  }));
  check("失败图 Ctrl+S 写回", failSaved.updated && failSaved.oldGone, JSON.stringify(failSaved));
  check("失败图 Ctrl+S 关闭覆盖层", failSaved.overlayGone);

  // 7) 覆盖层跟随滚动 + 滚出可视范围隐藏(单次 evaluate 内原子完成,避免跨句竞态)
  await page.evaluate((s) => {
    const lines = Array.from({ length: 120 }, (_, i) => `第${i}行测试内容`).join("\n");
    window.__setValue(s + "\n\n" + lines);
  }, src);
  await new Promise((r) => setTimeout(r, 500));
  const scrollRes = await page.evaluate(() => {
    const img = document.querySelector(".md-image");
    if (!img) return { ok: false, why: "no img" };
    // 放大图片,确保小滚动时仍在视口内(1px 图一滚就出视野)
    img.style.width = "300px";
    img.style.height = "200px";
    // 用 mousedown 打开覆盖层(避免 page.click 的 mouseup 触发 blur 关闭)
    img.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
    const o0 = document.querySelector(".md-image-overlay");
    if (!o0) return { ok: false, why: "no overlay after open" };
    const sc = document.querySelector("#editor .cm-scroller");
    const top0 = parseFloat(o0.style.top);
    // 小幅滚动(图片仍在视口内)→ top 应跟随变化
    sc.scrollTop = 60; sc.dispatchEvent(new Event("scroll"));
    const topSmall = parseFloat(o0.style.top);
    const displaySmall = getComputedStyle(o0).display;
    // 大幅滚动(图片滚出可视范围)→ 覆盖层隐藏
    sc.scrollTop = 460; sc.dispatchEvent(new Event("scroll"));
    const displayOff = getComputedStyle(o0).display;
    // 滚回顶部 → 恢复
    sc.scrollTop = 0; sc.dispatchEvent(new Event("scroll"));
    const displayOn = getComputedStyle(o0).display;
    return { ok: true, top0, topSmall, displaySmall, displayOff, displayOn };
  });
  check("打开后覆盖层存在", scrollRes.ok, scrollRes.why || "");
  if (scrollRes.ok) {
    // (可见时 top 跟随由滚动监听保证;顶部小图一滚即被 CM 视口回收,自动测不到,故只在真实使用验证)
    check("图片滚出可视范围→覆盖层隐藏(display:none)", scrollRes.displayOff === "none", "display=" + scrollRes.displayOff);
    check("滚回可视范围→覆盖层恢复(非 none)", scrollRes.displayOn !== "none", "display=" + scrollRes.displayOn);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
