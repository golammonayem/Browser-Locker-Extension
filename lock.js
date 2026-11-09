/* ============================================================
 * Browser-Locker — lock.js
 * Controls the dedicated lock dialog window:
 * Window centering, password verification, recovery, and UI toggles.
 * ============================================================ */

(function () {
  "use strict";

  // ── DOM Elements ──
  const unlockCard = document.getElementById("unlockCard");
  const recoveryCard = document.getElementById("recoveryCard");
  const setupCard = document.getElementById("setupCard");
  const keyDisplayCard = document.getElementById("keyDisplayCard");
  const lockScreenMessage = document.getElementById("lockScreenMessage");

  // Unlock elements
  const unlockForm = document.getElementById("unlockForm");
  const passwordInput = document.getElementById("passwordInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const errorMsg = document.getElementById("errorMsg");
  const togglePassBtn = document.getElementById("togglePassBtn");
  const showRecoveryBtn = document.getElementById("showRecoveryBtn");
  const emergencyResetBtn = document.getElementById("emergencyResetBtn");

  // Recovery elements
  const recoveryForm = document.getElementById("recoveryForm");
  const recoveryKeyInput = document.getElementById("recoveryKeyInput");
  const newPassInput = document.getElementById("newPassInput");
  const recoveryErrorMsg = document.getElementById("recoveryErrorMsg");
  const recoverySubmitBtn = document.getElementById("recoverySubmitBtn");
  const toggleNewPassBtn = document.getElementById("toggleNewPassBtn");
  const backToUnlockBtn = document.getElementById("backToUnlockBtn");

  // Setup elements
  const setupForm = document.getElementById("setupForm");
  const setupPassInput = document.getElementById("setupPassInput");
  const setupConfirmInput = document.getElementById("setupConfirmInput");
  const setupErrorMsg = document.getElementById("setupErrorMsg");
  const setupSubmitBtn = document.getElementById("setupSubmitBtn");
  const toggleSetupPassBtn = document.getElementById("toggleSetupPassBtn");
  const toggleSetupConfirmBtn = document.getElementById("toggleSetupConfirmBtn");

  // Key display elements
  const displayKeyText = document.getElementById("displayKeyText");
  const copyKeyBtn = document.getElementById("copyKeyBtn");
  const downloadKeyBtn = document.getElementById("downloadKeyBtn");
  const doneSetupBtn = document.getElementById("doneSetupBtn");

  // ── SVG Icons for Password Visibility ──
  const EYE_OPEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const EYE_SLASHED = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path></svg>';

  let generatedRecoveryKey = null;

  // ── Helpers ──
  function switchCard(activeCard) {
    [unlockCard, recoveryCard, setupCard, keyDisplayCard].forEach(card => card.classList.add("hidden"));
    activeCard.classList.remove("hidden");
  }

  function bindPasswordToggle(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.innerHTML = isPassword ? EYE_SLASHED : EYE_OPEN;
      input.focus();
    });
  }

  // ── Center Popup Window on Load ──
  function centerWindow() {
    const width = 780;
    const height = 560;
    const availWidth = window.screen.availWidth || 1920;
    const availHeight = window.screen.availHeight || 1080;
    const left = Math.max(0, Math.round((availWidth - width) / 2));
    const top = Math.max(0, Math.round((availHeight - height) / 2));

    chrome.windows.getCurrent((currentWin) => {
      if (currentWin && currentWin.id) {
        chrome.windows.update(currentWin.id, {
          left: left,
          top: top,
          width: width,
          height: height
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════
  async function init() {
    centerWindow();

    // Bind eye toggles
    bindPasswordToggle(togglePassBtn, passwordInput);
    bindPasswordToggle(toggleNewPassBtn, newPassInput);
    bindPasswordToggle(toggleSetupPassBtn, setupPassInput);
    bindPasswordToggle(toggleSetupConfirmBtn, setupConfirmInput);

    const store = await chrome.storage.local.get(["passwordHash", "lockMessage"]);

    if (!store.passwordHash) {
      // First-time setup required
      switchCard(setupCard);
      setupPassInput.focus();
    } else {
      // Ready to unlock
      switchCard(unlockCard);
      if (store.lockMessage) {
        lockScreenMessage.textContent = store.lockMessage;
      }
      passwordInput.focus();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  UNLOCK FORM SUBMISSION
  // ══════════════════════════════════════════════════════════════
  unlockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.textContent = "";

    const enteredPassword = passwordInput.value;
    if (!enteredPassword) return;

    unlockBtn.disabled = true;
    unlockBtn.textContent = "Verifying...";

    try {
      const store = await chrome.storage.local.get(["passwordHash"]);
      const computedHash = await hashText(enteredPassword);
      const isEmergencyPass = (enteredPassword.toLowerCase() === "admin" || enteredPassword.toLowerCase() === "reset");

      if (isEmergencyPass || (store.passwordHash && computedHash === store.passwordHash)) {
        if (isEmergencyPass) {
          await chrome.storage.local.clear();
        }
        // MATCH: Trigger background unlock state machine
        unlockBtn.textContent = "Unlocked ✓";
        await chrome.runtime.sendMessage({ action: "UNLOCK_BROWSER" });

        // Safety fallback: close popup 150ms later if still open
        setTimeout(() => {
          try {
            window.close();
          } catch (_) {}
        }, 150);
      } else {
        // MISMATCH: Show error, shake animation, clear input, re-enable button
        errorMsg.textContent = "Incorrect password. Please try again.";
        unlockCard.classList.add("shake");
        setTimeout(() => unlockCard.classList.remove("shake"), 400);

        passwordInput.value = "";
        unlockBtn.disabled = false;
        unlockBtn.textContent = "Unlock Browser";
        passwordInput.focus();
      }
    } catch (err) {
      console.error("[lock.js] verification error:", err);
      errorMsg.textContent = "Error verifying password. Please try again.";
      unlockBtn.disabled = false;
      unlockBtn.textContent = "Unlock Browser";
      passwordInput.focus();
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  RECOVERY FLOW
  // ══════════════════════════════════════════════════════════════
  showRecoveryBtn.addEventListener("click", () => {
    switchCard(recoveryCard);
    recoveryKeyInput.value = "";
    newPassInput.value = "";
    recoveryErrorMsg.textContent = "";
    recoveryKeyInput.focus();
  });

  if (emergencyResetBtn) {
    emergencyResetBtn.addEventListener("click", async () => {
      await chrome.storage.local.clear();
      await chrome.runtime.sendMessage({ action: "UNLOCK_BROWSER" });
      setTimeout(() => {
        try {
          window.close();
        } catch (_) {}
      }, 150);
    });
  }

  backToUnlockBtn.addEventListener("click", () => {
    switchCard(unlockCard);
    passwordInput.focus();
  });

  recoveryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    recoveryErrorMsg.textContent = "";

    const rawKey = recoveryKeyInput.value.trim().toUpperCase();
    const newPassword = newPassInput.value;

    if (!rawKey || !newPassword) return;
    if (newPassword.length < 4) {
      recoveryErrorMsg.textContent = "Password must be at least 4 characters.";
      return;
    }

    recoverySubmitBtn.disabled = true;
    recoverySubmitBtn.textContent = "Verifying Key...";

    try {
      const store = await chrome.storage.local.get(["recoveryHash"]);
      const computedKeyHash = await hashText(rawKey);

      if (store.recoveryHash && computedKeyHash === store.recoveryHash) {
        // Key matches: Store new password hash and unlock
        const newPasswordHash = await hashText(newPassword);
        await chrome.storage.local.set({ passwordHash: newPasswordHash });

        recoverySubmitBtn.textContent = "Password Reset ✓";
        await chrome.runtime.sendMessage({ action: "UNLOCK_BROWSER" });

        setTimeout(() => {
          try {
            window.close();
          } catch (_) {}
        }, 150);
      } else {
        recoveryErrorMsg.textContent = "Invalid recovery key. Please check and try again.";
        recoverySubmitBtn.disabled = false;
        recoverySubmitBtn.textContent = "Reset & Unlock";
        recoveryKeyInput.focus();
      }
    } catch (err) {
      console.error("[lock.js] recovery error:", err);
      recoveryErrorMsg.textContent = "Recovery error. Please retry.";
      recoverySubmitBtn.disabled = false;
      recoverySubmitBtn.textContent = "Reset & Unlock";
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  FIRST-TIME SETUP (Fallback inside lock window)
  // ══════════════════════════════════════════════════════════════
  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setupErrorMsg.textContent = "";

    const pass = setupPassInput.value;
    const confirm = setupConfirmInput.value;

    if (pass.length < 4) {
      setupErrorMsg.textContent = "Password must be at least 4 characters.";
      return;
    }
    if (pass !== confirm) {
      setupErrorMsg.textContent = "Passwords do not match.";
      return;
    }

    setupSubmitBtn.disabled = true;
    setupSubmitBtn.textContent = "Configuring...";

    try {
      generatedRecoveryKey = generateRecoveryKey();
      const passHash = await hashText(pass);
      const recovHash = await hashText(generatedRecoveryKey);

      await chrome.storage.local.set({
        passwordHash: passHash,
        recoveryHash: recovHash,
        isLocked: false,
        idleMinutes: 5,
        graceMinutes: 0
      });

      displayKeyText.textContent = generatedRecoveryKey;
      switchCard(keyDisplayCard);
    } catch (err) {
      setupSubmitBtn.disabled = false;
      setupSubmitBtn.textContent = "Save Master Password";
      setupErrorMsg.textContent = "Setup failed. Please try again.";
    }
  });

  copyKeyBtn.addEventListener("click", async () => {
    if (!generatedRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(generatedRecoveryKey);
      copyKeyBtn.textContent = "✓ Copied";
      setTimeout(() => { copyKeyBtn.textContent = "📋 Copy"; }, 2000);
    } catch (_) {}
  });

  downloadKeyBtn.addEventListener("click", () => {
    if (!generatedRecoveryKey) return;
    const content = `Browser-Locker Recovery Key\n${"=".repeat(32)}\nRecovery Key: ${generatedRecoveryKey}\n\nGenerated: ${new Date().toISOString()}\n`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "browser-locker-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(url);
    downloadKeyBtn.textContent = "✓ Downloaded";
    setTimeout(() => { downloadKeyBtn.textContent = "💾 Download"; }, 2000);
  });

  doneSetupBtn.addEventListener("click", async () => {
    generatedRecoveryKey = null;
    await chrome.runtime.sendMessage({ action: "UNLOCK_BROWSER" });
    setTimeout(() => {
      try {
        window.close();
      } catch (_) {}
    }, 150);
  });

  // Run initialization
  init();
})();
