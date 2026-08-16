// 测试用 window mock：getCurrentWindow 返回最小可用对象（方法 no-op / 固定值）
const noopWin = {
  setDecorations: async () => {},
  onResized: async () => () => {},
  onCloseRequested: async () => () => {},
  onMoved: async () => () => {},
  outerSize: async () => ({ width: 1280, height: 860 }),
  innerSize: async () => ({ width: 1280, height: 800 }),
  scaleFactor: async () => 1,
  isMaximized: async () => false,
  isFocused: async () => true,
  close: async () => {},
  destroy: async () => {},
  show: async () => {},
  setFocus: async () => {},
};

export function getCurrentWindow(): typeof noopWin {
  return noopWin;
}
