/**
 * Browser-Locker - Extension Popup Controller
 * Enforces strict authentication before exposing settings.
 */

import {
  generateSalt,
  hashWithSalt,
  verifyPassword,
  generateRecoveryKey
} from './crypto.js';

// DOM Element References
const popupStatusBadge = document.getElementById('popup-status-badge');
const viewLocked = document.getElementById('view-locked');
const viewUnlocked = document.getElementById('view-unlocked');
const viewSetup = document.getElementById('view-setup');

// Locked View Elements
const popupUnlockForm = document.getElementById('popup-unlock-form');
const popupUnlockPwd = document.getElementById('popup-unlock-pwd');
const popupUnlockError = document.getElementById('popup-unlock-error');

// Unlocked View Elements
const btnLockNow = document.getElementById('btn-lock-now');
const popupSettingsForm = document.getElementById('popup-settings-form');
const settingIdleTimeout = document.getElementById('setting-idle-timeout');
const settingGracePeriod = document.getElementById('setting-grace-period');
const settingsFeedback = document.getElementById('settings-feedback');
const popupChangePwdForm = document.getElementById('popup-change-pwd-form');
const changeCurrentPwd = document.getElementById('change-current-pwd');
const changeNewPwd = document.getElementById('change-new-pwd');
const changeConfirmPwd = document.getElementById('change-confirm-pwd');
const changePwdError = document.getElementById('change-pwd-error');
const btnFactoryReset = document.getElementById('btn-factory-reset');

// Setup View Elements
const popupSetupForm = document.getElementById('popup-setup-form');
const setupMasterPwd = document.getElementById('setup-master-pwd');
const setupMasterConfirm = document.getElementById('setup-master-confirm');
const setupError = document.getElementById('setup-error');
const popupSetupRecoveryStep = document.getElementById('popup-setup-recovery-step');
const popupSetupKey = document.getElementById('popup-setup-key');
const popupCopyKeyBtn = document.getElementById('popup-copy-key-btn');
const popupDlKeyBtn = document.getElementById('popup-dl-key-btn');
const popupSetupAck = document.getElementById('popup-setup-ack');
const btnPopupSetupFinish = document.getElementById('btn-popup-setup-finish');

let currentGeneratedWizardKey = '';

/**
 * Downloads a plain text file.
 * @param {string} filename 
 * @param {string} content 
 */
function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Shows the specified view and hides all others.
 * @param {'locked'|'unlocked'|'setup'} viewName 
 */
function switchView(viewName) {
  viewLocked.classList.add('hidden');
  viewUnlocked.classList.add('hidden');
  viewSetup.classList.add('hidden');

  if (viewName === 'locked') {
    viewLocked.classList.remove('hidden');
    popupStatusBadge.className = 'status-badge locked';
    popupStatusBadge.innerHTML = '<span>Locked</span>';
    setTimeout(() => popupUnlockPwd.focus(), 50);
  } else if (viewName === 'unlocked') {
    viewUnlocked.classList.remove('hidden');
    popupStatusBadge.className = 'status-badge unlocked';
    popupStatusBadge.innerHTML = '<span>Active</span>';
  } else if (viewName === 'setup') {
    viewSetup.classList.remove('hidden');
    popupStatusBadge.className = 'status-badge';
    popupStatusBadge.style.backgroundColor = 'rgba(217, 119, 6, 0.15)';
    popupStatusBadge.style.color = '#fcd34d';
    popupStatusBadge.style.border = '1px solid rgba(217, 119, 6, 0.3)';
    popupStatusBadge.innerHTML = '<span>Setup</span>';
    setTimeout(() => setupMasterPwd.focus(), 50);
  }
}

/**
 * Initializes the popup UI based on current vault status.
 */
function initPopup() {
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (!res || !res.isConfigured) {
      switchView('setup');
      return;
    }

    if (res.isLocked) {
      switchView('locked');
    } else {
      switchView('unlocked');
      const settings = res.settings || {};
      settingIdleTimeout.value = typeof settings.idleTimeout === 'number' ? settings.idleTimeout : 5;
      settingGracePeriod.value = typeof settings.gracePeriod === 'number' ? settings.gracePeriod : 0;
    }
  });
}

/* --------------------------------------------------------------------------
   View 1: Locked View - Compact Authentication Only
   -------------------------------------------------------------------------- */
popupUnlockForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const password = popupUnlockPwd.value;
  if (!password) return;

  chrome.runtime.sendMessage({ action: 'VERIFY_AND_UNLOCK', password }, (res) => {
    if (res && res.success) {
      popupUnlockError.classList.add('hidden');
      popupUnlockPwd.value = '';
      initPopup(); // Transitions to unlocked settings view
    } else {
      popupUnlockError.classList.remove('hidden');
      if (res && res.lockedOut) {
        popupUnlockError.textContent = 'Too many failed attempts. Security cooldown active.';
      } else {
        const remaining = res ? (5 - (res.failedAttempts || 0)) : '';
        popupUnlockError.textContent = remaining > 0 
          ? `Incorrect password. ${remaining} attempts remaining.` 
          : 'Incorrect password.';
      }
      popupUnlockPwd.select();
    }
  });
});

/* --------------------------------------------------------------------------
   View 2: Unlocked View - Settings & Credentials Management
   -------------------------------------------------------------------------- */
btnLockNow.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'LOCK' }, () => {
    window.close();
  });
});

popupSettingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const idleTimeout = Math.max(1, parseInt(settingIdleTimeout.value, 10) || 5);
  const gracePeriod = Math.max(0, parseInt(settingGracePeriod.value, 10) || 0);

  const updatedSettings = {
    idleTimeout,
    idleEnabled: true,
    gracePeriod
  };

  chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings: updatedSettings }, (res) => {
    if (res && res.success) {
      settingsFeedback.classList.remove('hidden');
      setTimeout(() => settingsFeedback.classList.add('hidden'), 2500);
    }
  });
});

popupChangePwdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = changeCurrentPwd.value;
  const newPwd = changeNewPwd.value;
  const confirmPwd = changeConfirmPwd.value;

  if (newPwd.length < 8) {
    changePwdError.classList.remove('hidden');
    changePwdError.textContent = 'New password must be at least 8 characters.';
    return;
  }
  if (newPwd !== confirmPwd) {
    changePwdError.classList.remove('hidden');
    changePwdError.textContent = 'New passwords do not match.';
    return;
  }

  const local = await chrome.storage.local.get(['passwordHash', 'passwordSalt']);
  const isValid = await verifyPassword(current, local.passwordHash, local.passwordSalt);

  if (!isValid) {
    changePwdError.classList.remove('hidden');
    changePwdError.textContent = 'Current password is incorrect.';
    changeCurrentPwd.select();
    return;
  }

  const salt = generateSalt(16);
  const passwordHash = await hashWithSalt(newPwd, salt);

  await chrome.storage.local.set({
    passwordHash,
    passwordSalt: salt,
    failedAttempts: 0,
    lockoutUntil: 0
  });

  changeCurrentPwd.value = '';
  changeNewPwd.value = '';
  changeConfirmPwd.value = '';
  changePwdError.classList.remove('hidden');
  changePwdError.style.color = '#4ade80';
  changePwdError.textContent = 'Password updated successfully.';
  setTimeout(() => {
    changePwdError.classList.add('hidden');
    changePwdError.style.color = '';
  }, 2500);
});

btnFactoryReset.addEventListener('click', () => {
  const confirmed = window.confirm(
    'Reset Browser-Locker to factory defaults?\n\nAll passwords and settings will be permanently erased.'
  );

  if (confirmed) {
    chrome.runtime.sendMessage({ action: 'FACTORY_RESET' }, () => {
      initPopup();
    });
  }
});

/* --------------------------------------------------------------------------
   View 3: Setup View - Onboarding Flow
   -------------------------------------------------------------------------- */
popupSetupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pwd = setupMasterPwd.value;
  const confirm = setupMasterConfirm.value;

  if (pwd.length < 8) {
    setupError.classList.remove('hidden');
    setupError.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (pwd !== confirm) {
    setupError.classList.remove('hidden');
    setupError.textContent = 'Passwords do not match.';
    return;
  }

  setupError.classList.add('hidden');
  currentGeneratedWizardKey = generateRecoveryKey();
  popupSetupKey.textContent = currentGeneratedWizardKey;

  popupSetupForm.classList.add('hidden');
  popupSetupRecoveryStep.classList.remove('hidden');
});

popupCopyKeyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentGeneratedWizardKey);
  popupCopyKeyBtn.textContent = 'Copied!';
  setTimeout(() => { popupCopyKeyBtn.textContent = 'Copy'; }, 2000);
});

popupDlKeyBtn.addEventListener('click', () => {
  downloadText('browser-locker-recovery-key.txt', `BROWSER-LOCKER RECOVERY KEY:\n${currentGeneratedWizardKey}\n\nKeep this offline.`);
});

popupSetupAck.addEventListener('change', () => {
  btnPopupSetupFinish.disabled = !popupSetupAck.checked;
});

btnPopupSetupFinish.addEventListener('click', async () => {
  const pwd = setupMasterPwd.value;
  const salt = generateSalt(16);
  const passwordHash = await hashWithSalt(pwd, salt);

  const recSalt = generateSalt(16);
  const recHash = await hashWithSalt(currentGeneratedWizardKey, recSalt);

  await chrome.storage.local.set({
    isConfigured: true,
    isLocked: false,
    passwordHash,
    passwordSalt: salt,
    recoveryHash: recHash,
    recoverySalt: recSalt,
    failedAttempts: 0,
    lockoutUntil: 0,
    lastActiveTimestamp: Date.now()
  });

  chrome.runtime.sendMessage({ action: 'SETUP_COMPLETED' }, () => {
    initPopup();
  });
});

// Run initialization on DOM load
document.addEventListener('DOMContentLoaded', initPopup);
