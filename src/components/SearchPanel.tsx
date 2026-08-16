import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { basename } from "../utils/path";

/** 全文搜索匹配行 */
export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  col: number;
  len: number;
}

interface SearchPanelProps {
  /** 搜索根目录（打开的文件夹；未打开时禁用） */
  rootDir: string;
  /** 点击结果：打开文件并跳转行 */
  onOpenResult: (path: string, line: number) => void;
}

/**
 * 全局搜索面板（VS Code 式）：
 * 输入关键词全文搜索当前工作区（md/markdown/txt），
 * 选项：区分大小写、整个单词；结果按文件分组，点击跳转。
 */
export function SearchPanel({ rootDir, onOpenResult }: SearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (q: string, cs: boolean, ww: boolean) => {
      const queryText = q.trim();
      if (!queryText || !rootDir) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const list = await invoke<SearchMatch[]>("search_files", {
          dir: rootDir,
          query: queryText,
          caseSensitive: cs,
          wholeWord: ww,
        });
        setResults(list);
      } catch (e) {
        console.error("search failed:", e);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [rootDir],
  );

  // 防抖搜索（300ms）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void run(query, caseSensitive, wholeWord);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, caseSensitive, wholeWord, run]);

  // 按文件分组（保持路径顺序）
  const groups: { path: string; matches: SearchMatch[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const m of results) {
    const idx = groupIndex.get(m.path);
    if (idx === undefined) {
      groupIndex.set(m.path, groups.length);
      groups.push({ path: m.path, matches: [m] });
    } else {
      groups[idx].matches.push(m);
    }
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggle = (fn: (v: boolean) => void, v: boolean) => () => fn(!v);

  return (
    <div className="search-panel">
      <div className="search-bar">
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("sidebar.searchPlaceholder")}
          spellCheck={false}
        />
        <div className="search-options">
          <button
            type="button"
            className={"search-opt" + (caseSensitive ? " active" : "")}
            title={t("search.caseSensitive")}
            onClick={toggle(setCaseSensitive, caseSensitive)}
          >
            Aa
          </button>
          <button
            type="button"
            className={"search-opt" + (wholeWord ? " active" : "")}
            title={t("search.wholeWord")}
            onClick={toggle(setWholeWord, wholeWord)}
          >
            {"\\b"}
          </button>
        </div>
      </div>

      <div className="search-summary">
        {searching
          ? t("search.searching")
          : query.trim()
            ? t("search.count", { count: results.length })
            : t("search.hint")}
      </div>

      <div className="search-results">
        {!rootDir && <p className="panel-note">{t("sidebar.openFolderPrompt")}</p>}
        {rootDir && query.trim() !== "" && results.length === 0 && !searching && (
          <p className="panel-note">{t("search.noResults")}</p>
        )}
        {groups.map((g) => {
          const open = expanded.has(g.path);
          return (
            <div key={g.path} className="search-group">
              <button type="button" className="search-group-header" onClick={() => toggleExpand(g.path)}>
                <i className={"fa-solid fa-chevron-" + (open ? "down" : "right")} aria-hidden="true" />
                <span className="search-group-name" title={g.path}>
                  {basename(g.path)}
                </span>
                <span className="search-group-count">{g.matches.length}</span>
              </button>
              {open &&
                g.matches.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    className="search-result-row"
                    onClick={() => onOpenResult(m.path, m.line)}
                    title={g.path + ":" + m.line}
                  >
                    <span className="search-result-line">{m.line}</span>
                    <span className="search-result-text">
                      <Highlighted text={m.text} col={m.col} len={m.len} />
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 匹配段高亮（col/len 按字符索引） */
function Highlighted({ text, col, len }: { text: string; col: number; len: number }) {
  const before = text.slice(0, col);
  const match = text.slice(col, col + len);
  const after = text.slice(col + len);
  return (
    <>
      {before}
      <mark className="search-hit">{match}</mark>
      {after}
    </>
  );
}
