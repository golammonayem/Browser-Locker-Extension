/* ============================================================
 * Browser-Locker — background.js
 * Manifest V3 Service Worker.
 * Handles lock state machine, window management, and security guards.
 * ============================================================ */

// ── In-Memory Mutex Flags & State ──
let isLocked = false;
let lockWindowId = null;
let isProcessingLock = false;
let isUnlockingNow = false;

// ── Constants ──
const LOCK_URL = chrome.runtime.getURL("lock.html");
const HEARTBEAT_ALARM = "browser_locker_heartbeat";
const DEFAULT_IDLE_MINS = 5;
const DEFAULT_GRACE_MINS = 0;

// ── Ensure crypto helper is available ──
try {
  importScripts("crypto.js");
} catch (_) {
  // Fallback inline definition if importScripts is unavailable
  if (typeof hashText !== "function") {
    async function hashText(text) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text + "::browser-locker-salt");
      const buffer = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  1. LOCK BROWSER
// ══════════════════════════════════════════════════════════════
async function lockBrowser() {
  // Prevent re-entrant or conflicting calls
  if (isProcessingLock || isUnlockingNow) return;

  // Only lock if a master password has been configured
  const store = await chrome.storage.local.get(["passwordHash"]);
  if (!store.passwordHash) return;

  isProcessingLock = true;
  isLocked = true;
  await chrome.storage.local.set({ isLocked: true });

  try {
    const allWindows = await chrome.windows.getAll({ populate: true });

    // Minimize all normal browser windows
    for (const win of allWindows) {
      if (win.type === "normal") {
        try {
          await chrome.windows.update(win.id, { state: "minimized" });
        } catch (_) {}
      }
    }

    // Check if tracked lock window is already open and valid
    if (lockWindowId !== null) {
      try {
        const existingWin = await chrome.windows.get(lockWindowId);
        if (existingWin) {
          await chrome.windows.update(lockWindowId, { focused: true });
          isProcessingLock = false;
          return;
        }
      } catch (_) {
        lockWindowId = null;
      }
    }

    // Check if any popup window already displays lock.html
    for (const win of allWindows) {
      if (win.type === "popup" && win.tabs) {
        const hasLockTab = win.tabs.some(t => t.url && t.url.startsWith(LOCK_URL));
        if (hasLockTab) {
          lockWindowId = win.id;
          await chrome.storage.local.set({ lockWindowId: win.id });
          await chrome.windows.update(win.id, { focused: true });
          isProcessingLock = false;
          return;
        }
      }
    }

    // Create ONE dedicated popup lock window (780x560, resizable, toolbar-free)
    const createdWin = await chrome.windows.create({
      url: LOCK_URL,
      type: "popup",
      width: 780,
      height: 560,
      focused: true
    });

    lockWindowId = createdWin.id;
    await chrome.storage.local.set({ lockWindowId: createdWin.id });

  } catch (err) {
    console.error("[Browser-Locker] lockBrowser error:", err);
  } finally {
    isProcessingLock = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  2. UNLOCK BROWSER
// ══════════════════════════════════════════════════════════════
async function unlockBrowser() {
  // CRITICAL: Set mutex FIRST before touching any windows
  isUnlockingNow = true;
  isLocked = false;

  // Immediately persist unlocked state and reset tracking in storage
  await chrome.storage.local.set({
    isLocked: false,
    lockWindowId: null,
    lastClosedAt: Date.now()
  });

  const targetLockWinId = lockWindowId;
  lockWindowId = null;

  try {
    const allWindows = await chrome.windows.getAll({ populate: true });

    // 1. Close any window matching lockWindowId OR containing a tab with lock.html
    for (const win of allWindows) {
      const isLockWindow = (win.id === targetLockWinId);
      const hasLockTab = win.tabs && win.tabs.some(t => t.url && t.url.startsWith(LOCK_URL));

      if (isLockWindow || hasLockTab) {
        try {
          await chrome.windows.remove(win.id);
        } catch (_) {}
      }
    }

    // 2. Find existing normal windows and restore/focus them
    const remainingWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });

    if (remainingWindows.length > 0) {
      for (const win of remainingWindows) {
        try {
          await chrome.windows.update(win.id, { state: "maximized", focused: true });
        } catch (_) {}
      }
    } else {
      // 3. Only if ZERO normal windows exist, create a single new normal window
      await chrome.windows.create({
        type: "normal",
        state: "maximized",
        focused: true
      });
    }
  } catch (err) {
    console.error("[Browser-Locker] unlockBrowser error:", err);
  } finally {
    // Release mutex after a 500ms safety timeout
    setTimeout(() => {
      isUnlockingNow = false;
    }, 500);
  }
}

// ══════════════════════════════════════════════════════════════
//  3. SAFE WINDOW EVENT LISTENERS
// ══════════════════════════════════════════════════════════════

// --- Window Removed ---
chrome.windows.onRemoved.addListener(async (removedWindowId) => {
  // Ignore completely during unlocking
  if (isUnlockingNow) return;

  // If locked and the user closed the lock window without unlocking:
  // Close all remaining Chrome windows so the browser exits cleanly
  if (isLocked && removedWindowId === lockWindowId) {
    lockWindowId = null;
    await chrome.storage.local.remove(["lockWindowId"]);

    try {
      const wins = await chrome.windows.getAll();
      for (const w of wins) {
        try {
          await chrome.windows.remove(w.id);
        } catch (_) {}
      }
    } catch (_) {}
    return;
  }

  // If unlocked and all normal windows are closed, save lastClosedAt
  if (!isLocked) {
    try {
      const normalWins = await chrome.windows.getAll({ windowTypes: ["normal"] });
      if (normalWins.length === 0) {
        await chrome.storage.local.set({ lastClosedAt: Date.now() });
      }
    } catch (_) {}
  }
});

// --- Window Created ---
chrome.windows.onCreated.addListener(async (newWindow) => {
  // Ignore during lock or unlock processing
  if (isProcessingLock || isUnlockingNow) return;

  const store = await chrome.storage.local.get([
    "passwordHash",
    "graceMinutes",
    "lastClosedAt",
    "isLocked"
  ]);

  if (!store.passwordHash) return;

  // If already marked locked, immediately enforce lock
  if (isLocked || store.isLocked) {
    if (newWindow.type === "normal") {
      try {
        await chrome.windows.update(newWindow.id, { state: "minimized" });
      } catch (_) {}
    }
    await lockBrowser();
    return;
  }

  // Fresh launch: Check if graceMinutes > 0 and within grace period
  const graceMins = Number(store.graceMinutes) || 0;
  const lastClosed = store.lastClosedAt || 0;
  const elapsed = Date.now() - lastClosed;
  const withinGrace = (graceMins > 0 && lastClosed > 0 && elapsed <= (graceMins * 60 * 1000));

  if (!withinGrace) {
    await lockBrowser();
  }
});

// --- Window Focus Changed ---
chrome.windows.onFocusChanged.addListener(async (focusedWindowId) => {
  if (!isLocked || isUnlockingNow || isProcessingLock) return;
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  if (focusedWindowId === lockWindowId) return;

  // User clicked a minimized normal window while locked:
  // Re-minimize that window and refocus the lock window (without altering its size/state)
  try {
    const focusedWin = await chrome.windows.get(focusedWindowId);
    if (focusedWin.type === "normal") {
      await chrome.windows.update(focusedWindowId, { state: "minimized" });
    }
  } catch (_) {}

  if (lockWindowId !== null) {
    try {
      await chrome.windows.update(lockWindowId, { focused: true });
    } catch (_) {
      lockWindowId = null;
      await lockBrowser();
    }
  }
});

// --- Tab Anti-Bypass Guard while Locked ---
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!isLocked || isUnlockingNow || isProcessingLock) return;

  try {
    const win = await chrome.windows.get(tab.windowId);
    if (win.type === "normal") {
      await chrome.tabs.remove(tab.id);
      if (lockWindowId) {
        await chrome.windows.update(lockWindowId, { focused: true });
      }
    }
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!isLocked || isUnlockingNow || isProcessingLock) return;
  if (!changeInfo.url) return;

  try {
    const win = await chrome.windows.get(tab.windowId);
    if (win.type === "normal") {
      await chrome.tabs.update(tabId, { url: LOCK_URL });
      await chrome.windows.update(win.id, { state: "minimized" });
      if (lockWindowId) {
        await chrome.windows.update(lockWindowId, { focused: true });
      }
    }
  } catch (_) {}
});

// ══════════════════════════════════════════════════════════════
//  4. MESSAGE DISPATCHER
// ══════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  (async () => {
    switch (message.action) {
      case "GET_STATUS": {
        const store = await chrome.storage.local.get([
          "passwordHash",
          "isLocked",
          "idleMinutes",
          "graceMinutes",
          "lockMessage"
        ]);
        sendResponse({
          isLocked: isLocked || !!store.isLocked,
          hasPassword: !!store.passwordHash,
          idleMinutes: store.idleMinutes ?? DEFAULT_IDLE_MINS,
          graceMinutes: store.graceMinutes ?? DEFAULT_GRACE_MINS,
          lockMessage: store.lockMessage || ""
        });
        break;
      }

      case "LOCK_BROWSER": {
        await lockBrowser();
        sendResponse({ success: true });
        break;
      }

      case "UNLOCK_BROWSER": {
        await unlockBrowser();
        sendResponse({ success: true });
        break;
      }

      case "UPDATE_SETTINGS": {
        const updates = {};
        if (message.idleMinutes !== undefined) {
          const mins = Math.max(1, Math.min(60, parseInt(message.idleMinutes) || DEFAULT_IDLE_MINS));
          updates.idleMinutes = mins;
          chrome.idle.setDetectionInterval(mins * 60);
        }
        if (message.graceMinutes !== undefined) {
          updates.graceMinutes = Math.max(0, Math.min(30, parseInt(message.graceMinutes) || 0));
        }
        if (message.lockMessage !== undefined) {
          updates.lockMessage = String(message.lockMessage).slice(0, 200);
        }
        await chrome.storage.local.set(updates);
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ error: "Unknown action" });
    }
  })().catch(err => {
    console.error("[Browser-Locker] onMessage error:", err);
    sendResponse({ error: err.message });
  });

  return true; // Keep message channel open for async response
});

// ══════════════════════════════════════════════════════════════
//  5. IDLE DETECTION & AUTO-LOCK
// ══════════════════════════════════════════════════════════════
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "idle" || state === "locked") {
    const store = await chrome.storage.local.get(["passwordHash"]);
    if (store.passwordHash && !isLocked && !isUnlockingNow) {
      await lockBrowser();
    }
  }
});

// Initialize idle detection interval from saved settings
chrome.storage.local.get(["idleMinutes"], (store) => {
  const mins = store.idleMinutes ?? DEFAULT_IDLE_MINS;
  chrome.idle.setDetectionInterval(mins * 60);
});

// ══════════════════════════════════════════════════════════════
//  6. HEARTBEAT ALARM (Background Sync & Self-Healing)
// ══════════════════════════════════════════════════════════════
chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;

  const store = await chrome.storage.local.get(["isLocked", "lockWindowId", "passwordHash"]);
  if (store.isLocked && store.passwordHash && !isUnlockingNow) {
    isLocked = true;
    if (store.lockWindowId) {
      try {
        await chrome.windows.get(store.lockWindowId);
        lockWindowId = store.lockWindowId;
      } catch (_) {
        lockWindowId = null;
        await lockBrowser();
      }
    } else {
      await lockBrowser();
    }
  }
});

// ══════════════════════════════════════════════════════════════
//  7. STARTUP & INSTALL HANDLERS
// ══════════════════════════════════════════════════════════════
chrome.runtime.onStartup.addListener(async () => {
  const store = await chrome.storage.local.get(["passwordHash", "graceMinutes", "lastClosedAt"]);
  if (!store.passwordHash) return;

  const graceMins = Number(store.graceMinutes) || 0;
  const lastClosed = store.lastClosedAt || 0;
  const elapsed = Date.now() - lastClosed;
  const withinGrace = (graceMins > 0 && lastClosed > 0 && elapsed <= (graceMins * 60 * 1000));

  if (!withinGrace) {
    await lockBrowser();
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({
      isLocked: false,
      idleMinutes: DEFAULT_IDLE_MINS,
      graceMinutes: DEFAULT_GRACE_MINS,
      lockMessage: ""
    });
  } else {
    // Check if previously locked across extension updates
    const store = await chrome.storage.local.get(["passwordHash", "isLocked"]);
    if (store.passwordHash && store.isLocked) {
      await lockBrowser();
    }
  }
});

// ══════════════════════════════════════════════════════════════
//  8. SHORTCUT KEY COMMAND (Alt+Shift+L)
// ══════════════════════════════════════════════════════════════
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "lock-browser") {
    if (!isLocked) {
      await lockBrowser();
    }
  }
});
