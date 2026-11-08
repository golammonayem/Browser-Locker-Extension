# 🛡️ Browser-Locker

> **Native OS-grade browser lock for Chromium browsers (Manifest V3).**  
> Built with native Web Crypto API (SHA-256 with cryptographically random salts), zero-knowledge offline recovery, bulletproof window-close detection, and a clean, flat Zinc/Slate design system.

---

## ⚡ Key Capabilities

* 🔐 **Zero Plain-Text Credentials:** Master passwords and recovery keys are never stored in plain text. All secrets are salted with a 128-bit random salt and digested with `SHA-256` via the standard `crypto.subtle` Web Crypto API.
* 🛑 **Window-Close Auto-Lock (Windows Background Fix):** Solves the common Windows Chromium issue where closing all browser windows leaves background processes alive without triggering `onStartup`. Browser-Locker listens to `chrome.windows.onRemoved` and locks immediately once the total window count drops to zero.
* ⏱️ **Default 0-Minute Grace Period:** Configured by default to `0` minutes so that closing and reopening the browser ALWAYS demands the master password immediately.
* 🛑 **Strict Single-Tab Prison & New Tab Bypass Fix:** Intercepts `chrome://newtab/`, `about:blank`, `chrome://extensions/`, and `chrome://settings/`. If the browser is locked, only `lock.html` is permitted; all other tabs are closed or redirected.
* 🛡️ **Anti-Tamper Shielding:** Attempts to open browser management pages (`chrome://extensions`, `chrome://settings`, etc.) are terminated immediately (`chrome.tabs.remove`). Incognito windows created while locked are instantly closed.
* 🔒 **Secure Popup Authentication:** Opening the extension popup while locked displays **only** a compact password entry prompt. Settings, toggles, or controls are never exposed without prior authentication.
* ⚡ **Immediate Autofocus:** Password inputs in `lock.html` and `popup.html` have autofocus enabled so users can type their password immediately upon launch without clicking.
* 🎨 **Native OS Design System:** Clean, flat Zinc 900/800 design (`#18181b` backdrop, `#27272a` cards, `#3f3f46` borders, `#2563eb` buttons, and `-apple-system` native system typography). Zero neon glows, purple gradients, or artificial animations.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    Event([Browser Event]) --> Router{Event Dispatcher}

    Router -->|Window Closed| WinRemoved[chrome.windows.onRemoved]
    Router -->|Window Created| WinCreated[chrome.windows.onCreated]
    Router -->|Tab Created / Updated| TabEvent[chrome.tabs.onCreated / onUpdated]
    Router -->|System Inactive| Idle[chrome.idle.onStateChanged]
    Router -->|Shortcut Alt+Shift+L| Shortcut[chrome.commands.onCommand]

    WinRemoved --> CheckCount{Any open windows left?}
    CheckCount -->|No: Count = 0| GraceCheck{Grace Period > 0?}
    GraceCheck -->|No: Default 0| SetLockTrue[Lock in storage.local immediately]
    GraceCheck -->|Yes| RecordClosedTime[Record lastWindowClosedTimestamp]

    WinCreated --> CheckLockState{Is Locked or Grace Expired?}
    CheckLockState -->|Yes| EnforceLockOnWin[Redirect tab to lock.html & Close other tabs]
    CheckLockState -->|No| AllowWin[Allow normal browsing]

    TabEvent --> TabLockCheck{Is Vault Locked?}
    TabLockCheck -->|Yes: chrome://extensions or settings| RemoveTab[chrome.tabs.remove & Focus lock.html]
    TabLockCheck -->|Yes: chrome://newtab or other URL| RedirectToLock[chrome.tabs.update to lock.html]
    TabLockCheck -->|No| UpdateActive[Update lastActiveTimestamp]

    Idle --> SetLockTrue
    Shortcut --> SetLockTrue
```

---

## 📂 Project Structure

```
Browser-Locker/
├── manifest.json              # Chrome Manifest V3 configuration & permissions
├── crypto.js                  # Native Web Crypto API SHA-256 salted hashing & key gen
├── background.js              # Service Worker managing window tracking & single-tab prison
├── lock.html                  # Full-page native 360px lock dialog
├── lock.js                    # Lock controller with autofocus & lockout defense
├── popup.html                 # 340px native popup (locked auth view & unlocked settings)
├── popup.js                   # Popup view switcher & credential manager
├── styles.css                 # Neutral Zinc/Slate native OS design system
├── icons/                     # Extension graphics
│   ├── icon.svg               # Vector icon source
│   ├── icon16.png             # 16x16 toolbar icon
│   ├── icon48.png             # 48x48 extension management icon
│   ├── icon128.png            # 128x128 store/retina icon
│   └── generate_icons.html    # Standalone HTML5 Canvas icon generator
├── scripts/
│   └── build_icons.py         # Zero-dependency Python icon builder (zlib/struct)
├── LICENSE                    # MIT License
└── README.md                  # Documentation
```

---

## 🚀 Manual Installation Guide

1. Open your Chromium browser (**Google Chrome**, **Brave**, or **Microsoft Edge**).
2. Go to `chrome://extensions` (or `brave://extensions` / `edge://extensions`).
3. Turn on the **"Developer mode"** toggle in the top-right corner.
4. Click **"Load unpacked"** in the top-left toolbar.
5. Select the `Browser-Locker` root directory.
6. Pin **Browser-Locker** to your toolbar and set your Master Password.

---

## ⚙️ Configuration

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Reopen Grace Period** | `0` mins | `0` ensures closing and reopening the browser ALWAYS locks immediately. |
| **Idle Auto-Lock** | `5` mins | Minutes of inactivity before auto-locking. |
| **Master Password** | Required | Min. 8 characters hashed via salted SHA-256. |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> | **Lock Browser Instantly** |
| <kbd>Enter</kbd> | **Submit Password / Unlock** |

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
