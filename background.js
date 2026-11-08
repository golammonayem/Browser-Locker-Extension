/**
 * Browser-Locker - Background Service Worker (Manifest V3)
 * Fullscreen Toolbar-Free Kiosk Architecture:
 * - Hides/minimizes normal windows to eliminate the extensions toolbar & "Remove from Chrome" option.
 * - Spawns a dedicated toolbar-free fullscreen popup window for lock.html.
 * - Inescapable focus trap & anti-bypass guard (closing lock window terminates the browser).
 * - Smooth restoration of normal windows upon valid password verification.
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

// In-memory reference to the active fullscreen lock window
let lockWindowId = null;

// Rehydrate lockWindowId from storage upon Service Worker wake-up
chrome.storage.local.get(['lockWindowId', 'isLocked']).then((data) => {
  if (data.isLocked && data.lockWindowId) {
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
 * Retrieves current lock state from storage.local.
 * @returns {Promise<boolean>}
 */
async function getLockState() {
  const data = await chrome.storage.local.get(['isLocked']);
  return Boolean(data.isLocked);
}

/**
 * Updates lock state in storage and refreshes badge.
 * @param {boolean} locked 
 */
async function setLockState(locked) {
  await chrome.storage.local.set({ isLocked: locked });
  const configured = await isVaultConfigured();

  if (!configured) {
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d97706' }); // Amber
    await chrome.action.setTitle({ title: 'Browser-Locker: Initial Setup' });
  } else if (locked) {
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
 * Enforces the Fullscreen Toolbar-Free Kiosk Lock:
 * 1. Minimizes all normal browser windows.
 * 2. Focuses existing lock window or creates a dedicated type: 'popup', state: 'fullscreen' window.
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
          await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true });
          return;
        }
      } catch (_) {
        lockWindowId = null;
      }
    }

    // Minimize normal windows before presenting the lock window
    await minimizeNormalWindows();

    // Create the toolbar-free, extension-free popup window in fullscreen state
    const lockWin = await chrome.windows.create({
      url: lockUrl,
      type: 'popup',
      state: 'fullscreen',
      focused: true
    });

    lockWindowId = lockWin.id;
    await chrome.storage.local.set({ lockWindowId: lockWin.id });

    // Explicitly re-enforce fullscreen state in case the platform creates it maximized
    try {
      await chrome.windows.update(lockWin.id, { state: 'fullscreen', focused: true });
    } catch (_) {}
  } catch (err) {
    console.error('[Browser-Locker] enforceLock error:', err);
  }
}

/**
 * Unlocks the vault, restores minimized normal browser windows,
 * and cleanly closes the fullscreen lock window.
 */
async function unlockVault() {
  await setLockState(false);
  await chrome.storage.local.set({
    failedAttempts: 0,
    lockoutUntil: 0,
    lastActiveTimestamp: Date.now()
  });

  const activeLockWinId = lockWindowId;
  lockWindowId = null;
  await chrome.storage.local.remove(['lockWindowId']);

  try {
    const windows = await chrome.windows.getAll();
    const normalWindows = windows.filter(w => w.id !== activeLockWinId && !w.incognito);

    if (normalWindows.length > 0) {
      // Un-minimize and focus the primary normal window
      try {
        await chrome.windows.update(normalWindows[0].id, { state: 'maximized', focused: true });
      } catch (_) {
        try {
          await chrome.windows.update(normalWindows[0].id, { state: 'normal', focused: true });
        } catch (_) {}
      }
    } else {
      // If no normal window was open, spawn a fresh normal browser window
      try {
        await chrome.windows.create({
          url: 'chrome://newtab/',
          type: 'normal',
          state: 'maximized',
          focused: true
        });
      } catch (_) {}
    }

    // Close the dedicated kiosk lock window
    if (activeLockWinId) {
      try {
        await chrome.windows.remove(activeLockWinId);
      } catch (_) {}
    }
  } catch (err) {
    console.error('[Browser-Locker] unlockVault error:', err);
  }

  return true;
}

/* --------------------------------------------------------------------------
   Focus Trap & Window Lifecycle Enforcement
   -------------------------------------------------------------------------- */

/**
 * Window Focus Trap:
 * While locked, if user clicks/restores any normal Chrome window (e.g. from taskbar),
 * immediately re-minimize that window and force focus back to the fullscreen lock window.
 */
chrome.windows.onFocusChanged.addListener(async (focusedWindowId) => {
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (!locked) return;

  // Retrieve current lockWindowId if not cached in memory
  if (!lockWindowId) {
    const data = await chrome.storage.local.get(['lockWindowId']);
    lockWindowId = data.lockWindowId || null;
  }

  if (lockWindowId && focusedWindowId !== lockWindowId) {
    // Re-minimize the unauthorized normal window immediately
    try {
      await chrome.windows.update(focusedWindowId, { state: 'minimized' });
    } catch (_) {}

    // Pull focus back to the kiosk lock window
    try {
      await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true });
    } catch (_) {}
  } else if (!lockWindowId) {
    await enforceLock();
  }
});

/**
 * Window Created Interception:
 * If a new window is created while locked, keep it minimized and lock window focused.
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
        await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true });
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

  const locked = await getLockState();

  // If lockWindowId was closed while still locked: TERMINATE ENTIRE BROWSER
  if (locked && removedWindowId === lockWindowId) {
    console.warn('[Browser-Locker] Lock window was closed while locked. Exiting all browser windows.');
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
        await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true });
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
        try { await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true }); } catch (_) {}
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

      case 'UNLOCK': {
        await unlockVault();
        sendResponse({ success: true });
        break;
      }

      case 'VERIFY_FULLSCREEN': {
        const isLocked = await getLockState();
        if (isLocked && lockWindowId) {
          try {
            await chrome.windows.update(lockWindowId, { state: 'fullscreen', focused: true });
          } catch (_) {}
        }
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
          await unlockVault();
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
