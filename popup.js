/* ============================================================
 * Browser-Locker — popup.js
 * Controls the extension action popup:
 * Initial onboarding, quick lock, idle & grace settings,
 * password modification, and recovery key regeneration.
 * ============================================================ */

(function () {
  "use strict";

  // ── Views ──
  const setupView = document.getElementById("setupView");
  const setupKeyView = document.getElementById("setupKeyView");
  const mainDashboardView = document.getElementById("mainDashboardView");
  const changePasswordView = document.getElementById("changePasswordView");
  const regenKeyView = document.getElementById("regenKeyView");
  const displayNewKeyView = document.getElementById("displayNewKeyView");

  const views = [
    setupView,
    setupKeyView,
    mainDashboardView,
    changePasswordView,
    regenKeyView,
    displayNewKeyView
  ];

  // ── Header Status Elements ──
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");

  // ── Setup View Elements ──
  const setupForm = document.getElementById("setupForm");
  const setupPassword = document.getElementById("setupPassword");
  const setupConfirm = document.getElementById("setupConfirm");
  const setupErrorMsg = document.getElementById("setupErrorMsg");
  const setupSubmitBtn = document.getElementById("setupSubmitBtn");
  const toggleSetupPass = document.getElementById("toggleSetupPass");
  const toggleSetupConfirm = document.getElementById("toggleSetupConfirm");

  // ── Setup Key View Elements ──
  const setupKeyText = document.getElementById("setupKeyText");
  const setupCopyKeyBtn = document.getElementById("setupCopyKeyBtn");
  const setupDownloadKeyBtn = document.getElementById("setupDownloadKeyBtn");
  const setupFinishBtn = document.getElementById("setupFinishBtn");

  // ── Dashboard View Elements ──
  const lockNowBtn = document.getElementById("lockNowBtn");
  const idleMinutesInput = document.getElementById("idleMinutesInput");
  const graceMinutesInput = document.getElementById("graceMinutesInput");
  const lockMessageInput = document.getElementById("lockMessageInput");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const openChangePassBtn = document.getElementById("openChangePassBtn");
  const openRegenKeyBtn = document.getElementById("openRegenKeyBtn");

  // ── Change Password Elements ──
  const changePasswordForm = document.getElementById("changePasswordForm");
  const currentPasswordInput = document.getElementById("currentPasswordInput");
  const newPasswordInput = document.getElementById("newPasswordInput");
  const confirmNewPasswordInput = document.getElementById("confirmNewPasswordInput");
  const changePasswordError = document.getElementById("changePasswordError");
  const cancelChangePassBtn = document.getElementById("cancelChangePassBtn");
  const saveChangePassBtn = document.getElementById("saveChangePassBtn");

  // ── Regenerate Key Elements ──
  const regenKeyForm = document.getElementById("regenKeyForm");
  const regenPasswordInput = document.getElementById("regenPasswordInput");
  const regenKeyError = document.getElementById("regenKeyError");
  const cancelRegenKeyBtn = document.getElementById("cancelRegenKeyBtn");
  const confirmRegenKeyBtn = document.getElementById("confirmRegenKeyBtn");

  // ── Display New Key Elements ──
  const newKeyDisplay = document.getElementById("newKeyDisplay");
  const copyNewKeyBtn = document.getElementById("copyNewKeyBtn");
  const downloadNewKeyBtn = document.getElementById("downloadNewKeyBtn");
  const finishNewKeyBtn = document.getElementById("finishNewKeyBtn");

  // ── Toast Element ──
  const toast = document.getElementById("toast");

  // ── Internal State ──
  let generatedSetupKey = null;
  let activeNewRecoveryKey = null;

  // ── Eye Icon SVGs ──
  const EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const EYE_SLASHED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path></svg>';

  // ── Utility Functions ──
  function showView(targetView) {
    views.forEach(v => v.classList.add("hidden"));
    targetView.classList.remove("hidden");
  }

  function setStatusBadge(isLocked) {
    if (isLocked) {
      statusPill.className = "status-pill locked";
      statusText.textContent = "Locked";
    } else {
      statusPill.className = "status-pill unlocked";
      statusText.textContent = "Unlocked";
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  }

  function bindToggle(button, input) {
    if (!button || !input) return;
    button.addEventListener("click", () => {
      const isPass = input.type === "password";
      input.type = isPass ? "text" : "password";
      button.innerHTML = isPass ? EYE_SLASHED : EYE_OPEN;
      input.focus();
    });
  }

  function triggerDownload(key) {
    const text = `Browser-Locker Recovery Key\n${"=".repeat(32)}\nRecovery Key: ${key}\n\nGenerated: ${new Date().toISOString()}\nStore this key offline to reset your master password.\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "browser-locker-recovery-key.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════
  async function init() {
    bindToggle(toggleSetupPass, setupPassword);
    bindToggle(toggleSetupConfirm, setupConfirm);

    try {
      const status = await chrome.runtime.sendMessage({ action: "GET_STATUS" });

      if (!status || !status.hasPassword) {
        // First-Time Setup Screen
        setStatusBadge(false);
        showView(setupView);
        setupPassword.focus();
        return;
      }

      // Existing user: configure dashboard
      setStatusBadge(status.isLocked);
      idleMinutesInput.value = status.idleMinutes ?? 5;
      graceMinutesInput.value = status.graceMinutes ?? 0;
      lockMessageInput.value = status.lockMessage || "";

      showView(mainDashboardView);
    } catch (err) {
      console.error("[popup.js] init error:", err);
      showView(setupView);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  FIRST-TIME SETUP SUBMISSION
  // ══════════════════════════════════════════════════════════════
  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setupErrorMsg.textContent = "";

    const pass = setupPassword.value;
    const confirm = setupConfirm.value;

    if (pass.length < 4) {
      setupErrorMsg.textContent = "Password must be at least 4 characters.";
      return;
    }
    if (pass !== confirm) {
      setupErrorMsg.textContent = "Passwords do not match.";
      return;
    }

    setupSubmitBtn.disabled = true;
    setupSubmitBtn.textContent = "Saving...";

    try {
      generatedSetupKey = generateRecoveryKey();
      const passHash = await hashText(pass);
      const recovHash = await hashText(generatedSetupKey);

      await chrome.storage.local.set({
        passwordHash: passHash,
        recoveryHash: recovHash,
        isLocked: false,
        idleMinutes: 5,
        graceMinutes: 0,
        lockMessage: ""
      });

      setupKeyText.textContent = generatedSetupKey;
      showView(setupKeyView);
    } catch (err) {
      setupSubmitBtn.disabled = false;
      setupSubmitBtn.textContent = "Set Master Password";
      setupErrorMsg.textContent = "Configuration failed. Please retry.";
    }
  });

  setupCopyKeyBtn.addEventListener("click", async () => {
    if (!generatedSetupKey) return;
    try {
      await navigator.clipboard.writeText(generatedSetupKey);
      setupCopyKeyBtn.textContent = "✓ Copied";
      setTimeout(() => { setupCopyKeyBtn.textContent = "📋 Copy"; }, 2000);
    } catch (_) {}
  });

  setupDownloadKeyBtn.addEventListener("click", () => {
    if (!generatedSetupKey) return;
    triggerDownload(generatedSetupKey);
    setupDownloadKeyBtn.textContent = "✓ Downloaded";
    setTimeout(() => { setupDownloadKeyBtn.textContent = "💾 Download"; }, 2000);
  });

  setupFinishBtn.addEventListener("click", () => {
    generatedSetupKey = null;
    setStatusBadge(false);
    idleMinutesInput.value = 5;
    graceMinutesInput.value = 0;
    lockMessageInput.value = "";
    showView(mainDashboardView);
    showToast("Master password active!");
  });

  // ══════════════════════════════════════════════════════════════
  //  QUICK LOCK NOW ACTION
  // ══════════════════════════════════════════════════════════════
  lockNowBtn.addEventListener("click", async () => {
    lockNowBtn.disabled = true;
    lockNowBtn.textContent = "Locking...";

    try {
      await chrome.runtime.sendMessage({ action: "LOCK_BROWSER" });
      setStatusBadge(true);
      window.close(); // Close extension popup cleanly
    } catch (err) {
      lockNowBtn.disabled = false;
      lockNowBtn.textContent = "🔒 Lock Browser Now";
      showToast("Lock request failed.");
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  SAVE SETTINGS
  // ══════════════════════════════════════════════════════════════
  saveSettingsBtn.addEventListener("click", async () => {
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = "Saving...";

    const idleMins = parseInt(idleMinutesInput.value, 10) || 5;
    const graceMins = parseInt(graceMinutesInput.value, 10) || 0;
    const customMessage = lockMessageInput.value.trim();

    try {
      await chrome.runtime.sendMessage({
        action: "UPDATE_SETTINGS",
        idleMinutes: idleMins,
        graceMinutes: graceMins,
        lockMessage: customMessage
      });
      showToast("Settings saved successfully");
    } catch (_) {
      showToast("Failed to save settings");
    }

    saveSettingsBtn.disabled = false;
    saveSettingsBtn.textContent = "Save Settings";
  });

  // ══════════════════════════════════════════════════════════════
  //  CHANGE MASTER PASSWORD
  // ══════════════════════════════════════════════════════════════
  openChangePassBtn.addEventListener("click", () => {
    changePasswordForm.reset();
    changePasswordError.textContent = "";
    showView(changePasswordView);
    currentPasswordInput.focus();
  });

  cancelChangePassBtn.addEventListener("click", () => {
    showView(mainDashboardView);
  });

  changePasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    changePasswordError.textContent = "";

    const currentPass = currentPasswordInput.value;
    const newPass = newPasswordInput.value;
    const confirmNew = confirmNewPasswordInput.value;

    if (newPass.length < 4) {
      changePasswordError.textContent = "New password must be at least 4 characters.";
      return;
    }
    if (newPass !== confirmNew) {
      changePasswordError.textContent = "New passwords do not match.";
      return;
    }

    saveChangePassBtn.disabled = true;
    saveChangePassBtn.textContent = "Updating...";

    try {
      const store = await chrome.storage.local.get(["passwordHash"]);
      const checkHash = await hashText(currentPass);

      if (checkHash !== store.passwordHash) {
        changePasswordError.textContent = "Current password is incorrect.";
        saveChangePassBtn.disabled = false;
        saveChangePassBtn.textContent = "Update";
        currentPasswordInput.focus();
        return;
      }

      const updatedHash = await hashText(newPass);
      await chrome.storage.local.set({ passwordHash: updatedHash });

      changePasswordForm.reset();
      showView(mainDashboardView);
      showToast("Password updated!");
    } catch (err) {
      changePasswordError.textContent = "Error updating password.";
    } finally {
      saveChangePassBtn.disabled = false;
      saveChangePassBtn.textContent = "Update";
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  REGENERATE RECOVERY KEY
  // ══════════════════════════════════════════════════════════════
  openRegenKeyBtn.addEventListener("click", () => {
    regenKeyForm.reset();
    regenKeyError.textContent = "";
    showView(regenKeyView);
    regenPasswordInput.focus();
  });

  cancelRegenKeyBtn.addEventListener("click", () => {
    showView(mainDashboardView);
  });

  regenKeyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    regenKeyError.textContent = "";

    const pass = regenPasswordInput.value;
    if (!pass) return;

    confirmRegenKeyBtn.disabled = true;
    confirmRegenKeyBtn.textContent = "Verifying...";

    try {
      const store = await chrome.storage.local.get(["passwordHash"]);
      const checkHash = await hashText(pass);

      if (checkHash !== store.passwordHash) {
        regenKeyError.textContent = "Incorrect master password.";
        confirmRegenKeyBtn.disabled = false;
        confirmRegenKeyBtn.textContent = "Generate";
        regenPasswordInput.focus();
        return;
      }

      activeNewRecoveryKey = generateRecoveryKey();
      const newRecovHash = await hashText(activeNewRecoveryKey);
      await chrome.storage.local.set({ recoveryHash: newRecovHash });

      newKeyDisplay.textContent = activeNewRecoveryKey;
      regenKeyForm.reset();
      showView(displayNewKeyView);
    } catch (err) {
      regenKeyError.textContent = "Failed to regenerate recovery key.";
    } finally {
      confirmRegenKeyBtn.disabled = false;
      confirmRegenKeyBtn.textContent = "Generate";
    }
  });

  copyNewKeyBtn.addEventListener("click", async () => {
    if (!activeNewRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(activeNewRecoveryKey);
      copyNewKeyBtn.textContent = "✓ Copied";
      setTimeout(() => { copyNewKeyBtn.textContent = "📋 Copy"; }, 2000);
    } catch (_) {}
  });

  downloadNewKeyBtn.addEventListener("click", () => {
    if (!activeNewRecoveryKey) return;
    triggerDownload(activeNewRecoveryKey);
    downloadNewKeyBtn.textContent = "✓ Downloaded";
    setTimeout(() => { downloadNewKeyBtn.textContent = "💾 Download"; }, 2000);
  });

  finishNewKeyBtn.addEventListener("click", () => {
    activeNewRecoveryKey = null;
    showView(mainDashboardView);
    showToast("Recovery key refreshed");
  });

  // Run initialization
  init();
})();
