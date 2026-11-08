/**
 * Browser-Locker - Background Service Worker (Manifest V3)
 * Standalone Desktop Popup Architecture:
 * - Hides/minimizes normal browser windows to hide tabs, bookmarks, and extension toolbars.
 * - Spawns a dedicated, toolbar-free 780x560 popup window for lock.html.
 * - Allows full, free window resizing, shrinking, or maximizing by the user.
 * - Inescapable focus trap: non-lock windows remain minimized; closing lock window terminates the browser.
 * - Smooth restoration of normal windows upon valid password authentication.
 */

import { verifyPassword } from './crypto.js';

// Default configuration settings - Default Grace Period is strictly 0
const DEFAULT_SETTINGS = {
  idleTimeout: 5,      // minutes (default: 5)
  idleEnabled: true,
  gracePeriod: 0       // minutes (default: 0 = Lock immediately when closed)
};

// Internal restricted URLs to block immediately while locked
const TAMPER_PREFIXES = [
  'chrome://extensions',
  'chrome://settings',
  'chrome://flags',
  'chrome://history',
  'chrome://downloads',
  'edge://extensions',
  'edge://settings',
  'edge://flags',
  'opera://extensions',
  'opera://settings',
  'brave://extensions',
  'brave://settings',
  'about:debugging',
  'about:addons'
];

// In-memory state tracking to eliminate async race conditions
let isLocked = false;
let lockWindowId = null;

// Rehydrate lockWindowId and isLocked from storage upon Service Worker wake-up
chrome.storage.local.get(['lockWindowId', 'isLocked', 'locked']).then((data) => {
  isLocked = Boolean(data.isLocked || data.locked);
  if (isLocked && data.lockWindowId) {
    lockWindowId = data.lockWindowId;
  }
});

/**
 * Checks if the vault is configured with a master password.
 * @returns {Promise<boolean>}
 */
async function isVaultConfigured() {
  const data = await chrome.storage.local.get(['isConfigured', 'passwordHash']);
  return Boolean(data.isConfigured && data.passwordHash);
}

/**
 * Retrieves current lock state synchronously from in-memory cache.
 * @returns {boolean}
 */
function getLockState() {
  return isLocked;
}

/**
 * Updates lock state in memory, storage, and action badge.
 * @param {boolean} locked 
 */
async function setLockState(locked) {
  isLocked = Boolean(locked);
  await chrome.storage.local.set({ isLocked: isLocked, locked: isLocked });
  const configured = await isVaultConfigured();

  if (!configured) {
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d97706' }); // Amber
    await chrome.action.setTitle({ title: 'Browser-Locker: Initial Setup' });
  } else if (isLocked) {
    await chrome.action.setBadgeText({ text: 'LOCK' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // Red
    await chrome.action.setTitle({ title: 'Browser-Locker: Browser is Locked' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' }); // Green
    await chrome.action.setTitle({ title: 'Browser-Locker: Unlocked' });
  }
}

/**
 * Checks if a URL is a tamper/browser management URL.
 * @param {string} url 
 * @returns {boolean}
 */
function isTamperUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return TAMPER_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * Minimizes all normal browser windows so that no tabs, bookmarks,
 * or extension toolbars ("Remove from Chrome") are visible or accessible.
 */
async function minimizeNormalWindows() {
  try {
    const windows = await chrome.windows.getAll();
    for (const w of windows) {
      if (w.id !== lockWindowId) {
        if (w.incognito) {
          try { await chrome.windows.remove(w.id); } catch (_) {}
        } else {
          try { await chrome.windows.update(w.id, { state: 'minimized' }); } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.error('[Browser-Locker] minimizeNormalWindows error:', err);
  }
}

/**
 * Enforces the Standalone Desktop Lock Dialog Window:
 * 1. Minimizes all normal browser windows.
 * 2. Focuses existing lock window or creates a dedicated resizable popup window (width: 780, height: 560).
 */
async function enforceLock() {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const lockUrl = chrome.runtime.getURL('lock.html');

  try {
    // Check if an existing lock window is still alive
    if (lockWindowId) {
      try {
        const existing = await chrome.windows.get(lockWindowId);
        if (existing) {
          await minimizeNormalWindows();
          if (existing.state === 'minimized') {
            await chrome.windows.update(lockWindowId, { focused: true, state: 'normal' });
          } else {
            await chrome.windows.update(lockWindowId, { focused: true });
          }
          return;
        }
      } catch (_) {
        lockWindowId = null;
      }
    }

    // Minimize normal windows before presenting the lock window
    await minimizeNormalWindows();

    // Default centered coordinate fallbacks for 1920x1080 display
    const defaultLeft = Math.max(0, Math.round((1920 - 780) / 2));
    const defaultTop = Math.max(0, Math.round((1080 - 560) / 2));

    // Create the toolbar-free, extension-free resizable popup window
    const lockWin = await chrome.windows.create({
      url: lockUrl,
      type: 'popup',
      width: 780,
      height: 560,
      left: defaultLeft,
      top: defaultTop,
      focused: true
    });

    lockWindowId = lockWin.id;
    await chrome.storage.local.set({ lockWindowId: lockWin.id });
  } catch (err) {
    console.error('[Browser-Locker] enforceLock error:', err);
  }
}

/**
 * Unlocks the vault, closes the lock popup window, and restores or creates the normal browser window.
 * @param {number|null} senderWindowId - Window ID of sender if available
 */
async function unlockVault(senderWindowId = null) {
  // 1. Set isLocked = false
  await setLockState(false);
  await chrome.storage.local.set({
    failedAttempts: 0,
    lockoutUntil: 0,
    lastActiveTimestamp: Date.now()
  });

  // Determine the lock popup window ID
  const local = await chrome.storage.local.get(['lockWindowId']);
  const winToClose = senderWindowId || lockWindowId || local.lockWindowId;

  // 2. CRITICAL: Explicitly close the lock window popup and reset lockWindowId = null;
  lockWindowId = null;
  await chrome.storage.local.remove(['lockWindowId']);

  if (winToClose) {
    try {
      await chrome.windows.remove(winToClose);
    } catch (_) {}
  }

  // Also query to make sure any lingering popup window with lock.html is closed
  try {
    const all = await chrome.windows.getAll({ populate: true });
    for (const w of all) {
      if (w.id === winToClose) continue;
      const isLockPopup = w.type === 'popup' && w.tabs?.some(t => t.url && t.url.includes('lock.html'));
      if (isLockPopup) {
        try { await chrome.windows.remove(w.id); } catch (_) {}
      }
    }
  } catch (_) {}

  // 3. Fetch all normal windows using { windowTypes: ['normal'] }
  let normalWindows = [];
  try {
    normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  } catch (_) {
    const all = await chrome.windows.getAll();
    normalWindows = all.filter(w => !w.incognito && w.type === 'normal');
  }

  // Filter out any lock window ID just in case
  normalWindows = normalWindows.filter(w => w.id !== winToClose);

  // 4. If normal windows exist, loop through them and un-minimize / maximize them.
  // If NO normal windows exist, create one: chrome.windows.create({ type: "normal", focused: true }).
  if (normalWindows.length > 0) {
    for (const win of normalWindows) {
      try {
        await chrome.windows.update(win.id, { state: 'maximized', focused: true });
      } catch (_) {
        try {
          await chrome.windows.update(win.id, { state: 'normal', focused: true });
        } catch (_) {}
      }
    }
  } else {
    try {
      await chrome.windows.create({
        type: 'normal',
        focused: true
      });
    } catch (_) {}
  }

  return true;
}

/* --------------------------------------------------------------------------
   Focus Trap & Window Lifecycle Enforcement (Permits Free User Resizing)
   -------------------------------------------------------------------------- */

/**
 * Window Focus Trap:
 * While locked, if user clicks/restores any normal Chrome window (e.g. from taskbar),
 * immediately re-minimize that window and force focus to the lock window without
 * altering the lock window's user-chosen size or maximized state.
 */
chrome.windows.onFocusChanged.addListener(async (focusedWindowId) => {
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (!locked) return;

  if (!lockWindowId) {
    const data = await chrome.storage.local.get(['lockWindowId']);
    lockWindowId = data.lockWindowId || null;
  }

  if (lockWindowId && focusedWindowId !== lockWindowId) {
    // Re-minimize the unauthorized normal window immediately
    try {
      await chrome.windows.update(focusedWindowId, { state: 'minimized' });
    } catch (_) {}

    // Focus lock window without overriding user's chosen dimensions or state
    try {
      const lockWin = await chrome.windows.get(lockWindowId);
      if (lockWin.state === 'minimized') {
        await chrome.windows.update(lockWindowId, { focused: true, state: 'normal' });
      } else {
        await chrome.windows.update(lockWindowId, { focused: true });
      }
    } catch (_) {}
  } else if (!lockWindowId) {
    await enforceLock();
  }
});

/**
 * Window Created Interception:
 * If a new normal window is created while locked, keep it minimized and lock window focused.
 */
chrome.windows.onCreated.addListener(async (win) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  // Allow our own lock window creation
  if (win.id === lockWindowId) return;

  const locked = await getLockState();
  if (locked) {
    if (win.incognito) {
      try { await chrome.windows.remove(win.id); } catch (_) {}
      return;
    }

    // Minimize newly created normal window immediately
    try {
      await chrome.windows.update(win.id, { state: 'minimized' });
    } catch (_) {}

    if (lockWindowId) {
      try {
        const lockWin = await chrome.windows.get(lockWindowId);
        if (lockWin.state === 'minimized') {
          await chrome.windows.update(lockWindowId, { focused: true, state: 'normal' });
        } else {
          await chrome.windows.update(lockWindowId, { focused: true });
        }
      } catch (_) {}
    } else {
      await enforceLock();
    }
    return;
  }

  // If unlocked: evaluate startup grace period on first window creation
  const allWindows = await chrome.windows.getAll();
  const data = await chrome.storage.local.get(['settings', 'lastWindowClosedTimestamp']);
  const gracePeriod = data.settings?.gracePeriod ?? 0;
  const lastClosed = data.lastWindowClosedTimestamp || 0;
  const now = Date.now();

  if (allWindows.length <= 1) {
    if (gracePeriod === 0 || (lastClosed > 0 && (now - lastClosed) >= gracePeriod * 60 * 1000)) {
      await setLockState(true);
      await enforceLock();
    }
  }
});

/**
 * Window Removed Interception (Anti-Bypass Guard):
 * 1. If the user closes the lock window while STILL locked (Alt+F4 / window X),
 *    immediately terminate ALL other Chrome windows so the entire browser exits!
 * 2. Track when total window count drops to 0 for startup auto-lock.
 */
chrome.windows.onRemoved.addListener(async (removedWindowId) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  // Only trigger the emergency browser shutdown IF windowId === lockWindowId AND isLocked === true
  if (isLocked === true && lockWindowId !== null && removedWindowId === lockWindowId) {
    console.warn('[Browser-Locker] Lock window was closed while locked. Exiting all browser windows.');
    isLocked = false;
    lockWindowId = null;
    await chrome.storage.local.remove(['lockWindowId']);

    try {
      const remaining = await chrome.windows.getAll();
      for (const w of remaining) {
        try { await chrome.windows.remove(w.id); } catch (_) {}
      }
    } catch (_) {}
    return;
  }

  // Check if all normal windows are now closed
  const allWindows = await chrome.windows.getAll();
  if (allWindows.length === 0 || (allWindows.length === 1 && allWindows[0].id === lockWindowId)) {
    const data = await chrome.storage.local.get(['settings']);
    const gracePeriod = data.settings?.gracePeriod ?? 0;
    await chrome.storage.local.set({ lastWindowClosedTimestamp: Date.now() });

    if (gracePeriod === 0) {
      await setLockState(true);
    }
  }
});

/**
 * Tab Activated Interception:
 * If user switches tabs inside a normal window, minimize it and focus lock window.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (locked) {
    if (lockWindowId && activeInfo.windowId !== lockWindowId) {
      try {
        await chrome.windows.update(activeInfo.windowId, { state: 'minimized' });
        const lockWin = await chrome.windows.get(lockWindowId);
        if (lockWin.state === 'minimized') {
          await chrome.windows.update(lockWindowId, { focused: true, state: 'normal' });
        } else {
          await chrome.windows.update(lockWindowId, { focused: true });
        }
      } catch (_) {}
    }
  } else {
    await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
  }
});

/**
 * Tab Updated Interception:
 * Block tamper management URLs (chrome://extensions, etc.) while locked.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  const urlToCheck = changeInfo.url || tab.url;
  if (!urlToCheck) return;

  if (locked) {
    if (isTamperUrl(urlToCheck)) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
      if (lockWindowId) {
        try { await chrome.windows.update(lockWindowId, { focused: true }); } catch (_) {}
      }
    }
  } else {
    await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
  }
});

/* --------------------------------------------------------------------------
   Startup, Idle, Commands, Alarms & Messages
   -------------------------------------------------------------------------- */

chrome.runtime.onStartup.addListener(async () => {
  const configured = await isVaultConfigured();
  if (!configured) {
    await setLockState(false);
    return;
  }

  const data = await chrome.storage.local.get(['settings', 'lastActiveTimestamp']);
  const gracePeriod = data.settings?.gracePeriod ?? 0;
  const lastActive = data.lastActiveTimestamp || 0;
  const elapsed = Date.now() - lastActive;

  if (gracePeriod > 0 && lastActive > 0 && elapsed < gracePeriod * 60 * 1000) {
    await setLockState(false);
  } else {
    await setLockState(true);
    await enforceLock();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const local = await chrome.storage.local.get(['settings', 'isConfigured']);
  if (!local.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }

  chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });

  const configured = Boolean(local.isConfigured);
  if (!configured) {
    await setLockState(false);
  } else {
    await setLockState(true);
    await enforceLock();
  }

  const settings = local.settings || DEFAULT_SETTINGS;
  const idleMinutes = Math.max(1, settings.idleTimeout || 5);
  try {
    chrome.idle.setDetectionInterval(idleMinutes * 60);
  } catch (_) {}
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const data = await chrome.storage.local.get(['settings']);
  const settings = data.settings || DEFAULT_SETTINGS;
  if (!settings.idleEnabled) return;

  if (newState === 'idle' || newState === 'locked') {
    const locked = await getLockState();
    if (!locked) {
      await setLockState(true);
      await enforceLock();
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    const locked = await getLockState();
    if (!locked) {
      await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'lock-browser') {
    const configured = await isVaultConfigured();
    if (!configured) return;
    await setLockState(true);
    await enforceLock();
  }
});

/**
 * Message Broker
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case 'GET_STATUS': {
        const locked = await getLockState();
        const configured = await isVaultConfigured();
        const local = await chrome.storage.local.get([
          'settings',
          'failedAttempts',
          'lockoutUntil'
        ]);
        sendResponse({
          success: true,
          isLocked: locked,
          isConfigured: configured,
          settings: local.settings || DEFAULT_SETTINGS,
          failedAttempts: local.failedAttempts || 0,
          lockoutUntil: local.lockoutUntil || 0
        });
        break;
      }

      case 'LOCK': {
        await setLockState(true);
        await enforceLock();
        sendResponse({ success: true });
        break;
      }

      case 'unlock_success':
      case 'UNLOCK': {
        const senderWinId = sender?.tab?.windowId || null;
        await unlockVault(senderWinId);
        sendResponse({ success: true });
        break;
      }

      case 'VERIFY_AND_UNLOCK': {
        const { password } = message;
        const local = await chrome.storage.local.get([
          'passwordHash',
          'passwordSalt',
          'failedAttempts',
          'lockoutUntil'
        ]);

        if (local.lockoutUntil && local.lockoutUntil > Date.now()) {
          sendResponse({ success: false, lockedOut: true, lockoutUntil: local.lockoutUntil });
          return;
        }

        const isValid = await verifyPassword(password, local.passwordHash, local.passwordSalt);
        if (isValid) {
          const senderWinId = sender?.tab?.windowId || null;
          await unlockVault(senderWinId);
          sendResponse({ success: true });
        } else {
          let attempts = (local.failedAttempts || 0) + 1;
          let lockoutUntil = 0;
          if (attempts >= 5) {
            lockoutUntil = Date.now() + 30000;
          }
          await chrome.storage.local.set({ failedAttempts: attempts, lockoutUntil });
          sendResponse({
            success: false,
            failedAttempts: attempts,
            lockoutUntil,
            lockedOut: attempts >= 5
          });
        }
        break;
      }

      case 'UPDATE_SETTINGS': {
        const current = await chrome.storage.local.get(['settings']);
        const merged = { ...(current.settings || DEFAULT_SETTINGS), ...(message.settings || {}) };
        await chrome.storage.local.set({ settings: merged });

        const idleMinutes = Math.max(1, merged.idleTimeout || 5);
        try {
          chrome.idle.setDetectionInterval(idleMinutes * 60);
        } catch (_) {}

        sendResponse({ success: true, settings: merged });
        break;
      }

      case 'SETUP_COMPLETED': {
        await setLockState(false);
        await chrome.storage.local.set({
          isConfigured: true,
          isLocked: false,
          lastActiveTimestamp: Date.now(),
          failedAttempts: 0,
          lockoutUntil: 0
        });
        sendResponse({ success: true });
        break;
      }

      case 'FACTORY_RESET': {
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, isLocked: false, isConfigured: false });
        await setLockState(false);
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  })();

  return true;
});
