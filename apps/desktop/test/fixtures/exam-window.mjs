import { EventEmitter } from 'node:events';

export const createExamWindow = (display, initial = {}) => {
  const window = new EventEmitter();
  const state = {
    bounds: { x: 200, y: 100, width: 900, height: 600 },
    minimum: [360, 560], maximum: [0, 0],
    resizable: true, maximizable: true, minimizable: true, movable: true,
    fullscreenable: true, fullscreen: false, kiosk: false, top: false,
    minimized: false, maximized: false, focused: true, destroyed: false,
    refuseBounds: false, contentInset: 0, messages: [], ...initial
  };
  let savedLimits;
  const clamp = bounds => ({ ...bounds,
    width: Math.max(state.minimum[0], Math.min(bounds.width, state.maximum[0] || Infinity)),
    height: Math.max(state.minimum[1], Math.min(bounds.height, state.maximum[1] || Infinity))
  });
  Object.assign(window, {
    state, isDestroyed: () => state.destroyed, isKiosk: () => state.kiosk,
    isFullScreen: () => state.fullscreen, isFullScreenable: () => state.fullscreenable,
    isAlwaysOnTop: () => state.top, isResizable: () => state.resizable,
    isMinimizable: () => state.minimizable, isMovable: () => state.movable,
    isMaximizable: () => state.maximizable, isMaximized: () => state.maximized,
    isFocused: () => state.focused, isMinimized: () => state.minimized,
    getBounds: () => ({ ...state.bounds }),
    getContentBounds: () => ({ x: state.bounds.x + state.contentInset, y: state.bounds.y + state.contentInset,
      width: state.bounds.width - 2 * state.contentInset, height: state.bounds.height - 2 * state.contentInset }),
    getMinimumSize: () => [...state.minimum], getMaximumSize: () => [...state.maximum],
    setMinimumSize: (w, h) => { state.minimum = [w, h]; },
    setMaximumSize: (w, h) => { state.maximum = [w, h]; },
    setBounds: bounds => { if (!state.refuseBounds) state.bounds = clamp(bounds); },
    setResizable: value => {
      if (state.resizable === value) return;
      state.resizable = value;
      if (!value) {
        savedLimits = [[...state.minimum], [...state.maximum]];
        state.minimum = state.maximum = [state.bounds.width, state.bounds.height];
      } else if (savedLimits) [state.minimum, state.maximum] = savedLimits;
    },
    setFullScreen: value => {
      if (!state.fullscreenable) return;
      state.fullscreen = state.kiosk = value;
      if (value && !state.refuseBounds) state.bounds = clamp(display.bounds);
    },
    setKiosk: value => window.setFullScreen(value),
    setFullScreenable: value => { state.fullscreenable = value; },
    setMaximizable: value => { state.maximizable = value; },
    setMinimizable: value => { state.minimizable = value; },
    setMovable: value => { state.movable = value; },
    setAlwaysOnTop: value => { state.top = value; },
    setContentProtection: value => { state.contentProtection = value; },
    maximize: () => { state.maximized = true; state.bounds = { ...display.bounds }; },
    restore: () => { state.minimized = false; }, show() {},
    focus: () => { state.focused = true; },
    webContents: { send: (channel, message) => state.messages.push({ channel, message }) }
  });
  return window;
};
