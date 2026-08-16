import { useState } from "react";

/** 菜单项（点击执行动作） */
export interface MenuItem {
  id: string;
  /** 显示文本（i18n 已翻译） */
  label: string;
  /** 快捷键提示（仅展示，不负责按键） */
  shortcut?: string;
  disabled?: boolean;
  /** 勾选态（复选/单选，如显示行号、主题） */
  checked?: boolean;
  onClick?: () => void;
}

/** 菜单定义 */
export interface MenuDef {
  id: string;
  label: string;
  items: (MenuItem | { separator: true })[];
}

interface MenuBarProps {
  menus: MenuDef[];
}

/**
 * 自绘菜单栏（Windows/Linux，对应需求 S-05）
 * - 点击菜单标题展开/收起；展开时悬停其他菜单直接切换
 * - 键盘导航：↑/↓ 移动、Enter 执行、Esc 关闭、←/→ 切换菜单
 * - 透明遮罩实现点击外部关闭；带 role="menubar"/"menuitem" 基础 ARIA
 */
export function MenuBar({ menus }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const openMenu = menus.find((m) => m.id === openId) ?? null;

  const close = () => {
    setOpenId(null);
    setFocusIdx(null);
  };

  const runItem = (item: MenuItem) => {
    item.onClick?.();
    close();
  };

  /** 在菜单项之间移动焦点（跳过分隔线与禁用项） */
  const moveFocus = (dir: 1 | -1) => {
    if (!openMenu) return;
    const n = openMenu.items.length;
    if (n === 0) return;
    let i = (focusIdx ?? (dir === 1 ? -1 : n)) + dir;
    for (let step = 0; step < n; step++) {
      i = (i + n) % n;
      const it = openMenu.items[i];
      if (!("separator" in it) && !it.disabled) {
        setFocusIdx(i);
        return;
      }
      i += dir;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!openMenu) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const idx = menus.findIndex((m) => m.id === openId);
        const next = menus[(idx + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length];
        setOpenId(next.id);
        setFocusIdx(null);
        break;
      }
      case "Enter": {
        const it = focusIdx != null ? openMenu.items[focusIdx] : null;
        if (it && !("separator" in it) && !it.disabled) {
          e.preventDefault();
          runItem(it);
        }
        break;
      }
    }
  };

  return (
    <nav className="menubar" role="menubar" aria-label="menu" onKeyDown={onKeyDown}>
      {menus.map((m) => (
        <div key={m.id} className="menu-root">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openId === m.id}
            className={"menu-label" + (openId === m.id ? " open" : "")}
            onClick={() => {
              if (openId === m.id) close();
              else {
                setOpenId(m.id);
                setFocusIdx(null);
              }
            }}
            onMouseEnter={() => {
              if (openId) setOpenId(m.id);
            }}
          >
            {m.label}
          </button>
          {openId === m.id && (
            <>
              <div className="menu-overlay" onClick={close} />
              <div className="menu-dropdown" role="menu">
                {m.items.map((it, i) =>
                  "separator" in it ? (
                    <div key={`sep-${i}`} className="menu-separator" />
                  ) : (
                    <button
                      key={it.id}
                      type="button"
                      role="menuitem"
                      className={
                        "menu-item" +
                        (i === focusIdx ? " focused" : "") +
                        (it.checked ? " checked" : "") +
                        (it.disabled ? " disabled" : "")
                      }
                      disabled={it.disabled}
                      onClick={() => !it.disabled && runItem(it)}
                      onMouseEnter={() => setFocusIdx(i)}
                    >
                      <span className="menu-check">
                        {it.checked && <i className="fa-solid fa-check" aria-hidden="true" />}
                      </span>
                      <span className="menu-label-text">{it.label}</span>
                      {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </nav>
  );
}
