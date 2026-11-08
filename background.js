/**
 * Browser-Locker - Background Service Worker (Manifest V3)
 * Bulletproof Window-Close Detection, Strict Single-Tab Prison,
 * Anti-Tamper Protection, and Instant Startup Locking.
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

/**
 * Checks if the vault is configured with a master password.
 * @returns {Promise<boolean>}
 */
async function isVaultConfigured() {
  const data = await chrome.storage.local.get(['isConfigured', 'passwordHash']);
  return Boolean(data.isConfigured && data.passwordHash);
}

/**
 * Retrieves the current lock state from storage.local.
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
 * Enforces strict lock across all windows:
 * Keeps lock.html active and closes other tabs to maintain a single-tab prison.
 */
async function enforceLock() {
  const lockUrl = chrome.runtime.getURL('lock.html');

  try {
    const windows = await chrome.windows.getAll({ populate: true });

    for (const win of windows) {
      if (win.incognito) {
        try {
          await chrome.windows.remove(win.id);
        } catch (_) {}
        continue;
      }

      const tabs = win.tabs || [];
      const lockTabs = tabs.filter(t => t.url && t.url.startsWith(lockUrl));

      if (lockTabs.length > 0) {
        // Focus the first lock tab
        const primaryLock = lockTabs[0];
        await chrome.tabs.update(primaryLock.id, { active: true });

        // Close all other tabs in this window (single-tab prison)
        for (const t of tabs) {
          if (t.id !== primaryLock.id) {
            try {
              await chrome.tabs.remove(t.id);
            } catch (_) {}
          }
        }
      } else if (tabs.length > 0) {
        // No lock tab in this window: update the active tab to lock.html
        const activeTab = tabs.find(t => t.active) || tabs[0];
        if (activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
          await chrome.storage.session.set({ intendedUrl: activeTab.url });
        }
        await chrome.tabs.update(activeTab.id, { url: lockUrl });

        // Close any other tabs in this window
        for (const t of tabs) {
          if (t.id !== activeTab.id) {
            try {
              await chrome.tabs.remove(t.id);
            } catch (_) {}
          }
        }
      } else {
        await chrome.tabs.create({ windowId: win.id, url: lockUrl, active: true });
      }
    }
  } catch (err) {
    console.error('[Browser-Locker] enforceLock error:', err);
  }
}

/**
 * Enforces lock on a specific newly created window.
 * @param {number} windowId 
 */
async function enforceLockOnWindow(windowId) {
  const lockUrl = chrome.runtime.getURL('lock.html');
  try {
    const win = await chrome.windows.get(windowId, { populate: true });
    if (win.incognito) {
      try {
        await chrome.windows.remove(win.id);
      } catch (_) {}
      return;
    }

    const tabs = win.tabs || [];
    if (tabs.length > 0) {
      const firstTab = tabs[0];
      if (firstTab.url && (firstTab.url.startsWith('http://') || firstTab.url.startsWith('https://'))) {
        await chrome.storage.session.set({ intendedUrl: firstTab.url });
      }
      await chrome.tabs.update(firstTab.id, { url: lockUrl });

      // Close any other tabs
      for (let i = 1; i < tabs.length; i++) {
        try {
          await chrome.tabs.remove(tabs[i].id);
        } catch (_) {}
      }
    } else {
      await chrome.tabs.create({ windowId, url: lockUrl, active: true });
    }
  } catch (err) {
    console.error('[Browser-Locker] enforceLockOnWindow error:', err);
  }
}

/**
 * Unlocks the vault and restores session.
 * @returns {Promise<string|null>}
 */
async function unlockVault() {
  await setLockState(false);
  await chrome.storage.local.set({
    failedAttempts: 0,
    lockoutUntil: 0,
    lastActiveTimestamp: Date.now()
  });

  const session = await chrome.storage.session.get(['intendedUrl']);
  const intendedUrl = session.intendedUrl;
  await chrome.storage.session.remove(['intendedUrl']);

  const lockUrl = chrome.runtime.getURL('lock.html');
  const tabs = await chrome.tabs.query({});
  const lockTabs = tabs.filter(t => t.url && t.url.startsWith(lockUrl));

  if (lockTabs.length > 0) {
    const primaryTab = lockTabs[0];
    const targetUrl = (intendedUrl && !intendedUrl.startsWith(lockUrl)) ? intendedUrl : 'chrome://newtab/';
    try {
      await chrome.tabs.update(primaryTab.id, { url: targetUrl });
    } catch (_) {
      try {
        await chrome.tabs.update(primaryTab.id, { url: 'chrome://newtab/' });
      } catch (_) {}
    }

    // Close any duplicate lock tabs
    for (let i = 1; i < lockTabs.length; i++) {
      try {
        await chrome.tabs.remove(lockTabs[i].id);
      } catch (_) {}
    }
  }

  return intendedUrl || null;
}

/* --------------------------------------------------------------------------
   CRITICAL FIX 1: Window Close & Reopen Detection (Windows Background Fix)
   -------------------------------------------------------------------------- */

/**
 * Whenever a window is closed: check if total window count is now 0.
 * If 0, record timestamp and lock immediately if gracePeriod is 0.
 */
chrome.windows.onRemoved.addListener(async () => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const allWindows = await chrome.windows.getAll();
  if (allWindows.length === 0) {
    const data = await chrome.storage.local.get(['settings']);
    const gracePeriod = data.settings?.gracePeriod ?? 0;
    await chrome.storage.local.set({ lastWindowClosedTimestamp: Date.now() });

    if (gracePeriod === 0) {
      // Immediate lock on last window close!
      await setLockState(true);
    }
  }
});

/**
 * Whenever a new window is created:
 * If gracePeriod is 0 or expired, or if isLocked is already true, enforce lock immediately!
 */
chrome.windows.onCreated.addListener(async (win) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const allWindows = await chrome.windows.getAll();
  const data = await chrome.storage.local.get(['settings', 'lastWindowClosedTimestamp', 'isLocked']);
  const gracePeriod = data.settings?.gracePeriod ?? 0;
  const lastClosed = data.lastWindowClosedTimestamp || 0;
  const now = Date.now();

  let shouldLock = Boolean(data.isLocked);

  // If this is the first window opened after having closed windows:
  if (allWindows.length <= 1) {
    if (gracePeriod === 0) {
      shouldLock = true;
    } else if (lastClosed > 0 && (now - lastClosed) >= gracePeriod * 60 * 1000) {
      shouldLock = true;
    }
  }

  if (shouldLock) {
    await setLockState(true);
    await enforceLockOnWindow(win.id);
  }
});

/**
 * Startup Lifecycle Event
 */
chrome.runtime.onStartup.addListener(async () => {
  const configured = await isVaultConfigured();
  if (!configured) {
    await setLockState(false);
    return;
  }

  const data = await chrome.storage.local.get(['settings', 'lastActiveTimestamp', 'lastWindowClosedTimestamp']);
  const gracePeriod = data.settings?.gracePeriod ?? 0;
  const lastActive = data.lastActiveTimestamp || 0;
  const elapsed = Date.now() - lastActive;

  if (gracePeriod > 0 && lastActive > 0 && elapsed < gracePeriod * 60 * 1000) {
    await setLockState(false);
  } else {
    // Default gracePeriod 0: always lock immediately on startup
    await setLockState(true);
    await enforceLock();
  }
});

/**
 * Extension Installed or Updated Event
 */
chrome.runtime.onInstalled.addListener(async () => {
  const local = await chrome.storage.local.get(['settings', 'isConfigured']);
  if (!local.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }

  // Periodic heartbeat alarm to track last active timestamp
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

/* --------------------------------------------------------------------------
   CRITICAL FIX 2: Strict Tab Prison & New Tab Bypass Fix
   -------------------------------------------------------------------------- */

/**
 * Tab Created: Immediately intercept chrome://newtab, about:blank, or any tab
 */
chrome.tabs.onCreated.addListener(async (tab) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (!locked) return;

  const lockUrl = chrome.runtime.getURL('lock.html');

  if (tab.url && tab.url.startsWith(lockUrl)) {
    return;
  }

  // Check if a lock tab already exists in this window
  if (tab.windowId) {
    const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
    const existingLockTab = windowTabs.find(t => t.url && t.url.startsWith(lockUrl));

    if (existingLockTab && existingLockTab.id !== tab.id) {
      // Close this newly spawned tab and refocus the lock tab
      try {
        await chrome.tabs.remove(tab.id);
      } catch (_) {}
      try {
        await chrome.tabs.update(existingLockTab.id, { active: true });
      } catch (_) {}
      return;
    }
  }

  // Otherwise, redirect this tab to lock.html
  try {
    await chrome.tabs.update(tab.id, { url: lockUrl });
  } catch (_) {}
});

/**
 * Tab Updated: Intercept any URL changes while locked
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  const urlToCheck = changeInfo.url || tab.url;
  if (!urlToCheck) return;

  const lockUrl = chrome.runtime.getURL('lock.html');

  if (locked) {
    // 1. Anti-Tamper: Block chrome://extensions, chrome://settings, etc.
    if (isTamperUrl(urlToCheck)) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {}
      await enforceLock();
      return;
    }

    // 2. Tab Prison: Redirect any non-lock URL back to lock.html
    if (!urlToCheck.startsWith(lockUrl)) {
      if (urlToCheck.startsWith('http://') || urlToCheck.startsWith('https://')) {
        const session = await chrome.storage.session.get(['intendedUrl']);
        if (!session.intendedUrl) {
          await chrome.storage.session.set({ intendedUrl: urlToCheck });
        }
      }
      try {
        await chrome.tabs.update(tabId, { url: lockUrl });
      } catch (_) {}
    }
  } else {
    // Unlocked safe navigation: update active timestamp
    await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
  }
});

/**
 * Tab Activated: Keep lock tab focused
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (!locked) {
    await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
    return;
  }

  const lockUrl = chrome.runtime.getURL('lock.html');
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || !tab.url.startsWith(lockUrl)) {
      if (tab.url && isTamperUrl(tab.url)) {
        await chrome.tabs.remove(tab.id);
        await enforceLock();
      } else {
        await chrome.tabs.update(activeInfo.tabId, { url: lockUrl });
      }
    }
  } catch (_) {}
});

/**
 * Window Focus Changed: Ensure lock screen is active tab
 */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const configured = await isVaultConfigured();
  if (!configured) return;

  const locked = await getLockState();
  if (locked) {
    const lockUrl = chrome.runtime.getURL('lock.html');
    try {
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      if (!activeTab || !activeTab.url || !activeTab.url.startsWith(lockUrl)) {
        await enforceLockOnWindow(windowId);
      }
    } catch (_) {}
  }
});

/* --------------------------------------------------------------------------
   Idle, Alarms, Commands, and Messaging
   -------------------------------------------------------------------------- */

/**
 * Idle State Detection: auto-locks when workstation is idle or locked
 */
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

/**
 * Heartbeat Alarm: periodically updates lastActiveTimestamp while unlocked
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    const locked = await getLockState();
    if (!locked) {
      await chrome.storage.local.set({ lastActiveTimestamp: Date.now() });
    }
  }
});

/**
 * Global Keyboard Shortcut: Alt+Shift+L
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'lock-browser') {
    const configured = await isVaultConfigured();
    if (!configured) return;
    await setLockState(true);
    await enforceLock();
  }
});

/**
 * Central Message Broker
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
        const restoredUrl = await unlockVault();
        sendResponse({ success: true, restoredUrl });
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
          const restoredUrl = await unlockVault();
          sendResponse({ success: true, restoredUrl });
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
