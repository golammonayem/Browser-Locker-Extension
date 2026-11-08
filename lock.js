/**
 * Browser-Locker - Native Lock Screen Controller
 * Standalone Desktop Dialog Mode:
 * - Automatically centers the 780x560 window upon initial launch.
 * - Freely allows the user to resize, shrink, or maximize the window.
 * - Immediate autofocus on the password input.
 * - Brute-force lockout and offline recovery key reset.
 */

import {
  generateSalt,
  hashWithSalt,
  verifyPassword,
  generateRecoveryKey,
  formatRecoveryKey,
  normalizeRecoveryKey,
  verifyRecoveryKey
} from './crypto.js';

// DOM Element References
const lockDialog = document.getElementById('lock-dialog');
const dialogHeading = document.getElementById('dialog-heading');
const dialogDesc = document.getElementById('dialog-desc');
const unlockForm = document.getElementById('unlock-form');
const masterPasswordInput = document.getElementById('master-password');
const unlockBtn = document.getElementById('unlock-btn');
const togglePassword = document.getElementById('togglePassword');
const unlockError = document.getElementById('unlock-error');
const cooldownBanner = document.getElementById('cooldown-banner');
const cooldownSec = document.getElementById('cooldown-sec');
const openRecoveryLink = document.getElementById('open-recovery-link');

// Setup Container Elements
const setupContainer = document.getElementById('setup-container');
const setupForm = document.getElementById('setup-form');
const setupPwd = document.getElementById('setup-pwd');
const setupPwdConfirm = document.getElementById('setup-pwd-confirm');
const setupRecoveryStep = document.getElementById('setup-recovery-step');
const setupKeyDisplay = document.getElementById('setup-key-display');
const setupCopyBtn = document.getElementById('setup-copy-btn');
const setupDlBtn = document.getElementById('setup-dl-btn');
const setupAckCheck = document.getElementById('setup-ack-check');
const setupFinishBtn = document.getElementById('setup-finish-btn');

// Recovery Modal Elements
const recoveryModal = document.getElementById('recovery-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelRecoveryBtn = document.getElementById('cancel-recovery-btn');
const recoveryForm = document.getElementById('recovery-form');
const recoveryKeyInput = document.getElementById('recovery-key-input');
const recoveryNewPwd = document.getElementById('recovery-new-pwd');
const recoveryConfirmPwd = document.getElementById('recovery-confirm-pwd');
const recoveryError = document.getElementById('recovery-error');
const recoveryPostStep = document.getElementById('recovery-post-step');
const newRecKeyDisplay = document.getElementById('new-rec-key-display');
const copyNewRecBtn = document.getElementById('copy-new-rec-btn');
const dlNewRecBtn = document.getElementById('dl-new-rec-btn');
const finishNewRecBtn = document.getElementById('finish-new-rec-btn');

let cooldownInterval = null;
let currentSetupKey = '';
let newlyGeneratedRecKey = '';

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
 * Centers the popup window cleanly on the user's available display on initial load.
 */
async function centerLockWindow() {
  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin && currentWin.type === 'popup') {
      const screenW = window.screen.availWidth || window.screen.width || 1920;
      const screenH = window.screen.availHeight || window.screen.height || 1080;
      const targetW = Math.min(780, screenW - 40);
      const targetH = Math.min(560, screenH - 40);
      const left = Math.max(0, Math.round((screenW - targetW) / 2));
      const top = Math.max(0, Math.round((screenH - targetH) / 2));
      await chrome.windows.update(currentWin.id, { left, top, width: targetW, height: targetH });
    }
  } catch (_) {}
}

/**
 * Ensures autofocus on password input immediately.
 */
function forceAutofocus() {
  if (masterPasswordInput && !masterPasswordInput.disabled && setupContainer.classList.contains('hidden')) {
    masterPasswordInput.focus();
  }
}

/**
 * Evaluates and displays brute-force lockout countdown.
 * @param {number} lockoutUntil 
 */
function checkLockoutState(lockoutUntil) {
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
    cooldownInterval = null;
  }

  const now = Date.now();
  if (lockoutUntil && lockoutUntil > now) {
    masterPasswordInput.disabled = true;
    unlockBtn.disabled = true;
    cooldownBanner.classList.remove('hidden');
    unlockError.classList.add('hidden');

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      cooldownSec.textContent = remaining;

      if (remaining <= 0) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
        cooldownBanner.classList.add('hidden');
        masterPasswordInput.disabled = false;
        unlockBtn.disabled = false;
        chrome.storage.local.set({ failedAttempts: 0, lockoutUntil: 0 });
        forceAutofocus();
      }
    };

    updateTimer();
    cooldownInterval = setInterval(updateTimer, 1000);
  } else {
    cooldownBanner.classList.add('hidden');
    masterPasswordInput.disabled = false;
    unlockBtn.disabled = false;
  }
}

/**
 * Initializes lock screen state and centers window
 */
async function initLockScreen() {
  // Center window on initial launch
  await centerLockWindow();

  const data = await chrome.storage.local.get([
    'isConfigured',
    'passwordHash',
    'passwordSalt',
    'recoveryHash',
    'recoverySalt',
    'lockoutUntil',
    'failedAttempts'
  ]);

  if (!data.isConfigured || !data.passwordHash) {
    // Unconfigured state
    unlockForm.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    dialogHeading.textContent = 'Setup Browser-Locker';
    dialogDesc.textContent = 'Set a master password to secure your browser.';
    setupPwd.focus();
    return;
  }

  // Configured state: check brute-force lockout
  checkLockoutState(data.lockoutUntil);

  // Force autofocus immediately
  forceAutofocus();
}

/* --------------------------------------------------------------------------
   Keyboard Guard (Prevents accidental tab closures while permitting free typing)
   -------------------------------------------------------------------------- */

window.addEventListener('keydown', (e) => {
  const isCtrl = e.ctrlKey || e.metaKey;

  // Handle Escape: close recovery modal if open
  if (e.key === 'Escape') {
    if (recoveryModal && !recoveryModal.classList.contains('hidden')) {
      closeRecoveryModal();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }

  // Block shortcut keys that attempt to spawn tabs or close windows
  if (isCtrl && ['w', 'W', 't', 'T', 'n', 'N', 'h', 'H', 'j', 'J'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, true);

// Eye icon SVGs for password preview toggle
const EYE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
  <circle cx="12" cy="12" r="3"></circle>
</svg>`;

const EYE_SLASH_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
  <line x1="1" y1="1" x2="23" y2="23"></line>
</svg>`;

if (togglePassword) {
  togglePassword.addEventListener('click', () => {
    const isPassword = masterPasswordInput.type === 'password';
    masterPasswordInput.type = isPassword ? 'text' : 'password';
    togglePassword.innerHTML = isPassword ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG;
    forceAutofocus();
  });
}

// Window focus & tab visibility listeners to ensure autofocus
window.addEventListener('focus', forceAutofocus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) forceAutofocus();
});

/* --------------------------------------------------------------------------
   Unlock Form Submission Handler
   -------------------------------------------------------------------------- */
unlockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = masterPasswordInput.value;
  if (!password) return;

  const local = await chrome.storage.local.get([
    'passwordHash',
    'passwordSalt',
    'failedAttempts',
    'lockoutUntil'
  ]);

  if (local.lockoutUntil && local.lockoutUntil > Date.now()) {
    checkLockoutState(local.lockoutUntil);
    return;
  }

  const isValid = await verifyPassword(password, local.passwordHash, local.passwordSalt);

  if (isValid) {
    unlockBtn.disabled = true;
    masterPasswordInput.disabled = true;
    unlockError.classList.add('hidden');
    masterPasswordInput.value = '';
    // Un-minimizes normal windows and closes this desktop dialog popup
    chrome.runtime.sendMessage({ action: 'unlock_success' });
  } else {
    // Subtle shake animation
    lockDialog.classList.remove('shake');
    void lockDialog.offsetWidth;
    lockDialog.classList.add('shake');

    let attempts = (local.failedAttempts || 0) + 1;
    let lockoutUntil = 0;

    if (attempts >= 5) {
      lockoutUntil = Date.now() + 30000;
      await chrome.storage.local.set({ failedAttempts: attempts, lockoutUntil });
      checkLockoutState(lockoutUntil);
    } else {
      await chrome.storage.local.set({ failedAttempts: attempts, lockoutUntil: 0 });
      const remaining = 5 - attempts;
      unlockError.classList.remove('hidden');
      unlockError.textContent = `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
      masterPasswordInput.select();
    }
  }
});

/* --------------------------------------------------------------------------
   First-Time Setup Handler (If unconfigured)
   -------------------------------------------------------------------------- */
setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pwd = setupPwd.value;
  const confirm = setupPwdConfirm.value;

  if (pwd.length < 8) {
    alert('Password must be at least 8 characters.');
    return;
  }
  if (pwd !== confirm) {
    alert('Passwords do not match.');
    return;
  }

  currentSetupKey = generateRecoveryKey();
  setupKeyDisplay.textContent = currentSetupKey;
  setupForm.classList.add('hidden');
  setupRecoveryStep.classList.remove('hidden');
});

setupCopyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentSetupKey);
  setupCopyBtn.textContent = 'Copied!';
  setTimeout(() => { setupCopyBtn.textContent = 'Copy'; }, 2000);
});

setupDlBtn.addEventListener('click', () => {
  downloadText('browser-locker-recovery-key.txt', `BROWSER-LOCKER RECOVERY KEY:\n${currentSetupKey}\n\nKeep this offline.`);
});

setupAckCheck.addEventListener('change', () => {
  setupFinishBtn.disabled = !setupAckCheck.checked;
});

setupFinishBtn.addEventListener('click', async () => {
  const pwd = setupPwd.value;
  const salt = generateSalt(16);
  const passwordHash = await hashWithSalt(pwd, salt);

  const recSalt = generateSalt(16);
  const recHash = await hashWithSalt(currentSetupKey, recSalt);

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
    chrome.runtime.sendMessage({ action: 'unlock_success' });
  });
});

/* --------------------------------------------------------------------------
   Recovery Modal Handler
   -------------------------------------------------------------------------- */
openRecoveryLink.addEventListener('click', () => {
  recoveryModal.classList.remove('hidden');
  recoveryError.classList.add('hidden');
  recoveryKeyInput.value = '';
  recoveryNewPwd.value = '';
  recoveryConfirmPwd.value = '';
  recoveryForm.classList.remove('hidden');
  recoveryPostStep.classList.add('hidden');
  recoveryKeyInput.focus();
});

function closeRecoveryModal() {
  recoveryModal.classList.add('hidden');
  forceAutofocus();
}

closeModalBtn.addEventListener('click', closeRecoveryModal);
cancelRecoveryBtn.addEventListener('click', closeRecoveryModal);

recoveryKeyInput.addEventListener('input', () => {
  const clean = normalizeRecoveryKey(recoveryKeyInput.value);
  recoveryKeyInput.value = formatRecoveryKey(clean);
});

recoveryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = recoveryKeyInput.value.trim();
  const newPwd = recoveryNewPwd.value;
  const confirmPwd = recoveryConfirmPwd.value;

  if (newPwd.length < 8) {
    recoveryError.classList.remove('hidden');
    recoveryError.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (newPwd !== confirmPwd) {
    recoveryError.classList.remove('hidden');
    recoveryError.textContent = 'Passwords do not match.';
    return;
  }

  const local = await chrome.storage.local.get(['recoveryHash', 'recoverySalt']);
  const isValid = await verifyRecoveryKey(key, local.recoveryHash, local.recoverySalt);

  if (!isValid) {
    recoveryError.classList.remove('hidden');
    recoveryError.textContent = 'Invalid recovery key. Please check the code.';
    return;
  }

  // Update password with fresh salt
  const newSalt = generateSalt(16);
  const newPasswordHash = await hashWithSalt(newPwd, newSalt);

  // Generate new recovery key
  newlyGeneratedRecKey = generateRecoveryKey();
  const newRecSalt = generateSalt(16);
  const newRecHash = await hashWithSalt(newlyGeneratedRecKey, newRecSalt);

  await chrome.storage.local.set({
    passwordHash: newPasswordHash,
    passwordSalt: newSalt,
    recoveryHash: newRecHash,
    recoverySalt: newRecSalt,
    failedAttempts: 0,
    lockoutUntil: 0,
    lastActiveTimestamp: Date.now()
  });

  newRecKeyDisplay.textContent = newlyGeneratedRecKey;
  recoveryForm.classList.add('hidden');
  recoveryPostStep.classList.remove('hidden');
});

copyNewRecBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(newlyGeneratedRecKey);
  copyNewRecBtn.textContent = 'Copied!';
  setTimeout(() => { copyNewRecBtn.textContent = 'Copy'; }, 2000);
});

dlNewRecBtn.addEventListener('click', () => {
  downloadText('browser-locker-new-recovery-key.txt', `NEW RECOVERY KEY:\n${newlyGeneratedRecKey}\n\nKeep this offline.`);
});

finishNewRecBtn.addEventListener('click', () => {
  closeRecoveryModal();
  chrome.runtime.sendMessage({ action: 'unlock_success' });
});

// Run initialization
document.addEventListener('DOMContentLoaded', initLockScreen);
