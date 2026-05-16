import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { User, HistoryItem, YearSection } from '../types';
import { Fingerprint, Lock, Unlock, CheckCircle2, XCircle, Loader2, WifiOff } from 'lucide-react';
import { supabase, SUPABASE_CONFIGURED } from '../supabase';

interface KeylockerSectionProps {
  users: User[];
  history: HistoryItem[];
  onBorrow: (item: HistoryItem) => void;
  onReturn: (logId: string) => void;
}

interface DeviceStatus {
  device_id: string;
  sensor_found: boolean;
  wifi_connected: boolean;
  current_mode: string;
  status_message: string;
  fingerprint_step: string;
  updated_at?: string;
}

// ─── Offline queue stored in localStorage ───────────────────────────────────
const OFFLINE_QUEUE_KEY = 'keylocker_offline_queue';

interface OfflineQueueItem {
  id: string;           // uuid
  action: 'borrow' | 'return';
  userId: string;
  userName: string;
  userPhoto: string;
  program: string;
  position: string;
  yearSection: string;
  keyNumber: string;
  logId?: string;       // for returns
  timestamp: number;
}

function loadOfflineQueue(): OfflineQueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue: OfflineQueueItem[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function addToOfflineQueue(item: OfflineQueueItem) {
  const queue = loadOfflineQueue();
  queue.push(item);
  saveOfflineQueue(queue);
}

function removeFromOfflineQueue(id: string) {
  const queue = loadOfflineQueue().filter((q) => q.id !== id);
  saveOfflineQueue(queue);
}

// ─── Offline PIN store (hashed in localStorage) ─────────────────────────────
// We store a simple hash so PIN verification works offline.
// On each successful online PIN verify we cache it.
const OFFLINE_PIN_KEY = 'keylocker_offline_pins'; // { [userId]: hashedPin }

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

function cacheOfflinePin(userId: string, pin: string) {
  try {
    const store = JSON.parse(localStorage.getItem(OFFLINE_PIN_KEY) || '{}');
    store[userId] = simpleHash(pin);
    localStorage.setItem(OFFLINE_PIN_KEY, JSON.stringify(store));
  } catch {}
}

function verifyOfflinePin(userId: string, pin: string): boolean {
  try {
    const store = JSON.parse(localStorage.getItem(OFFLINE_PIN_KEY) || '{}');
    return store[userId] === simpleHash(pin);
  } catch {
    return false;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ─── Component ───────────────────────────────────────────────────────────────
const KeylockerSection: React.FC<KeylockerSectionProps> = ({
  users,
  history,
  onBorrow,
  onReturn,
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedYearSection, setSelectedYearSection] = useState<YearSection | ''>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');

  const [showScanUI, setShowScanUI] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isWaitingForDevice, setIsWaitingForDevice] = useState(false);
  const [scanMessage, setScanMessage] = useState<string>('Place finger on scanner…');
  const [scanError, setScanError] = useState<string>('');

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [showPinInput, setShowPinInput] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);

  // ── Offline state ──
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>(loadOfflineQueue);
  const [isSyncing, setIsSyncing] = useState(false);

  // ── Toast ──
  const [toastQueue, setToastQueue] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const lastToastMessageRef = useRef('');

  const [showStatusBox, setShowStatusBox] = useState(false);
  const statusBoxTimeoutRef = useRef<number | null>(null);

  const keys = Array.from({ length: 20 }, (_, i) => `${101 + i}`);

  const activeBorrows = useMemo(
    () => history.filter((h) => h.status === 'Borrowed' && !h.timeOut),
    [history]
  );

  // ── Online/offline detection ──────────────────────────────────────────────
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ── Sync offline queue when back online ──────────────────────────────────
  const syncOfflineQueue = useCallback(async () => {
    const queue = loadOfflineQueue();
    if (!queue.length || !isOnline || !SUPABASE_CONFIGURED) return;

    setIsSyncing(true);
    enqueueToast(`Syncing ${queue.length} offline action(s)…`);

    for (const item of queue) {
      try {
        if (item.action === 'borrow') {
          const now = new Date();
          const newItem: HistoryItem = {
            id: '',
            userId: item.userId,
            userName: item.userName,
            userPhoto: item.userPhoto,
            program: item.program,
            position: item.position,
            yearSection: item.yearSection as YearSection,
            keyNumber: item.keyNumber,
            date: new Date(item.timestamp).toLocaleDateString(),
            timeIn: new Date(item.timestamp).toLocaleTimeString(),
            timeOut: null,
            status: 'Borrowed',
          };
          onBorrow(newItem);
        } else if (item.action === 'return' && item.logId) {
          onReturn(item.logId);
        }
        removeFromOfflineQueue(item.id);
        enqueueToast(`Synced: ${item.action} key #${item.keyNumber}`);
      } catch {
        enqueueToast(`Failed to sync key #${item.keyNumber}`);
      }
    }

    setOfflineQueue(loadOfflineQueue());
    setIsSyncing(false);
  }, [isOnline, onBorrow, onReturn]);

  useEffect(() => {
    if (isOnline) syncOfflineQueue();
  }, [isOnline, syncOfflineQueue]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const enqueueToast = (message: string) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    setToastQueue((prev) => {
      if (prev[prev.length - 1] === cleanMessage) return prev;
      return [...prev, cleanMessage];
    });
  };

  const flashStatusBox = () => {
    setShowStatusBox(true);
    if (statusBoxTimeoutRef.current) window.clearTimeout(statusBoxTimeoutRef.current);
    statusBoxTimeoutRef.current = window.setTimeout(() => setShowStatusBox(false), 5000);
  };

  useEffect(() => {
    if (showToast) return;
    if (toastQueue.length === 0) return;
    const nextMessage = toastQueue[0];
    if (!nextMessage) return;
    if (lastToastMessageRef.current === nextMessage) {
      setToastQueue((prev) => prev.slice(1));
      return;
    }
    lastToastMessageRef.current = nextMessage;
    setToastMessage(nextMessage);
    setShowToast(true);
    setToastQueue((prev) => prev.slice(1));
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setShowToast(false), 2200);
  }, [toastQueue, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
      if (statusBoxTimeoutRef.current) window.clearTimeout(statusBoxTimeoutRef.current);
    };
  }, []);

  // ── User selection ────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedUserId) {
      setSelectedUser(users.find((u) => u.id === selectedUserId) ?? null);
    } else {
      setSelectedUser(null);
    }
  }, [selectedUserId, users]);

  // ── Device status (online only) ───────────────────────────────────────────
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !isOnline) return;

    const loadDeviceStatus = async () => {
      const { data, error } = await supabase
        .from('device_status')
        .select('*')
        .eq('device_id', 'locker_1')
        .maybeSingle();
      if (!error && data) setDeviceStatus(data as DeviceStatus);
    };

    loadDeviceStatus();

    const channel = supabase
      .channel('keylocker-device-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_status', filter: 'device_id=eq.locker_1' },
        (payload) => { if (payload.new) setDeviceStatus(payload.new as DeviceStatus); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOnline]);

  useEffect(() => {
    if (!deviceStatus) return;
    const msg = `${deviceStatus.wifi_connected ? 'WiFi connected' : 'WiFi disconnected'}, ${
      deviceStatus.sensor_found ? 'sensor is ready' : 'sensor not ready'
    }`;
    enqueueToast(msg);
  }, [deviceStatus?.wifi_connected, deviceStatus?.sensor_found]);

  useEffect(() => {
    if (!deviceStatus?.status_message) return;
    const allowedModes = ['verify', 'unlock', 'recovery', 'test'];
    if (!allowedModes.includes(deviceStatus.current_mode)) return;
    const message = deviceStatus.status_message.trim();
    if (message) enqueueToast(message);
  }, [deviceStatus?.status_message, deviceStatus?.current_mode]);

  useEffect(() => {
    if (!deviceStatus) return;
    const importantModes = ['verify', 'unlock', 'recovery', 'test'];
    const shouldShow =
      importantModes.includes(deviceStatus.current_mode) ||
      !deviceStatus.wifi_connected ||
      !deviceStatus.sensor_found;
    if (!shouldShow) { setShowStatusBox(false); return; }
    flashStatusBox();
  }, [deviceStatus?.wifi_connected, deviceStatus?.sensor_found, deviceStatus?.current_mode]);

  useEffect(() => {
    if (!showScanUI || !deviceStatus) return;
    if (
      deviceStatus.status_message === 'Fingerprint sensor NOT found' ||
      deviceStatus.status_message === 'Sensor not ready'
    ) {
      setScanError('Fingerprint sensor is not ready.');
      setScanMessage('Fingerprint sensor is not ready.');
      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      return;
    }
    if (['verify', 'fingerprint', 'unlock'].includes(deviceStatus.current_mode)) {
      if (deviceStatus.status_message) setScanMessage(deviceStatus.status_message);
      if (deviceStatus.fingerprint_step === 'matched') {
        setScanError('');
        setIsWaitingForDevice(false);
        setIsUnlocking(true);
      } else if (['mismatch', 'capture_failed', 'remove_timeout'].includes(deviceStatus.fingerprint_step)) {
        setIsUnlocking(false);
      } else if (['place_finger_verify', 'remove_finger', 'finger_removed', 'unlocking'].includes(deviceStatus.fingerprint_step)) {
        setScanError('');
      }
    }
  }, [deviceStatus, showScanUI]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const currentUserBorrow = useMemo(
    () => (selectedUser ? activeBorrows.find((b) => b.userId === selectedUser.id) ?? null : null),
    [selectedUser, activeBorrows]
  );

  const borrowerForReturn = useMemo(
    () => (currentUserBorrow ? users.find((u) => u.id === currentUserBorrow.userId) ?? null : null),
    [currentUserBorrow, users]
  );

  const isIdentified = useMemo(() => {
    if (!selectedUser) return false;
    if (currentUserBorrow) return true;
    return !!selectedYearSection;
  }, [selectedUser, currentUserBorrow, selectedYearSection]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const waitForCommandResult = async (commandId: string, timeoutMs = 60000, pollMs = 300) => {
    const started = Date.now();
    let lastKnownResult = 'pending';
    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('id, processed, result, scanned_fingerprint_id')
        .eq('id', commandId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.result) lastKnownResult = data.result;
      if (data?.processed === true) return data;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`Command timeout. Last result: ${lastKnownResult}`);
  };

  const clearPendingDeviceCommands = async () => {
    const { error } = await supabase.rpc('clear_pending_device_commands', { p_device_id: 'locker_1' });
    if (error) throw new Error(error.message);
  };

  const clearVisualState = () => {
    setIsUnlocking(false);
    setIsWaitingForDevice(false);
    setShowScanUI(false);
    setShowPinInput(false);
    setEnteredPin('');
    setScanMessage('Place finger on scanner…');
    setScanError('');
  };

  const resetAllState = () => {
    setSelectedUser(null);
    setSelectedUserId('');
    setSelectedYearSection('');
    setSelectedKey('');
    setFailedAttempts(0);
    setShowPinInput(false);
    setEnteredPin('');
    setShowScanUI(false);
    setIsUnlocking(false);
    setIsWaitingForDevice(false);
    setScanMessage('Place finger on scanner…');
    setScanError('');
  };

  const executeFinalAction = () => {
    if (!selectedUser) return;
    if (currentUserBorrow) {
      onReturn(currentUserBorrow.id);
      enqueueToast(`Key #${currentUserBorrow.keyNumber} returned successfully.`);
    } else {
      const now = new Date();
      const newHistoryItem: HistoryItem = {
        id: '',
        userId: selectedUser.id,
        userName: selectedUser.fullName,
        userPhoto: selectedUser.photoUrl,
        program: selectedUser.program,
        position: selectedUser.position,
        yearSection: selectedYearSection as YearSection,
        keyNumber: selectedKey,
        date: now.toLocaleDateString(),
        timeIn: now.toLocaleTimeString(),
        timeOut: null,
        status: 'Borrowed',
      };
      onBorrow(newHistoryItem);
      enqueueToast(`Key #${selectedKey} borrowed successfully.`);
    }
    resetAllState();
  };

  // ── OFFLINE: execute action locally without ESP32 ─────────────────────────
  const executeOfflineAction = () => {
    if (!selectedUser) return;

    if (currentUserBorrow) {
      // Return — queue it for sync, and also call onReturn immediately so UI updates
      const item: OfflineQueueItem = {
        id: uuid(),
        action: 'return',
        userId: selectedUser.id,
        userName: selectedUser.fullName,
        userPhoto: selectedUser.photoUrl,
        program: selectedUser.program,
        position: selectedUser.position,
        yearSection: currentUserBorrow.yearSection,
        keyNumber: currentUserBorrow.keyNumber,
        logId: currentUserBorrow.id,
        timestamp: Date.now(),
      };
      addToOfflineQueue(item);
      setOfflineQueue(loadOfflineQueue());
      onReturn(currentUserBorrow.id);
      enqueueToast(`[Offline] Key #${currentUserBorrow.keyNumber} return queued.`);
    } else {
      // Borrow
      const now = new Date();
      const newHistoryItem: HistoryItem = {
        id: uuid(),
        userId: selectedUser.id,
        userName: selectedUser.fullName,
        userPhoto: selectedUser.photoUrl,
        program: selectedUser.program,
        position: selectedUser.position,
        yearSection: selectedYearSection as YearSection,
        keyNumber: selectedKey,
        date: now.toLocaleDateString(),
        timeIn: now.toLocaleTimeString(),
        timeOut: null,
        status: 'Borrowed',
      };

      const queueItem: OfflineQueueItem = {
        id: uuid(),
        action: 'borrow',
        userId: selectedUser.id,
        userName: selectedUser.fullName,
        userPhoto: selectedUser.photoUrl,
        program: selectedUser.program,
        position: selectedUser.position,
        yearSection: selectedYearSection as string,
        keyNumber: selectedKey,
        timestamp: Date.now(),
      };
      addToOfflineQueue(queueItem);
      setOfflineQueue(loadOfflineQueue());
      onBorrow(newHistoryItem);
      enqueueToast(`[Offline] Key #${selectedKey} borrow queued.`);
    }

    resetAllState();
  };

  // ── PIN verify — tries online first, falls back to cached hash ────────────
  const handlePinVerify = async () => {
    const actingUser = currentUserBorrow ? borrowerForReturn : selectedUser;
    if (!actingUser) return;
    if (!enteredPin.trim()) { alert('Please enter your backup PIN.'); return; }

    setIsVerifyingPin(true);

    try {
      if (isOnline && SUPABASE_CONFIGURED) {
        // Online path
        const { data, error } = await supabase.functions.invoke('verify-backup-pin', {
          body: { userId: actingUser.id, pin: enteredPin },
        });
        if (error) throw new Error(error.message);
        if (!data?.success) { alert('Wrong PIN.'); return; }

        // Cache PIN for future offline use
        cacheOfflinePin(actingUser.id, enteredPin);

        const keyForCommand = currentUserBorrow ? currentUserBorrow.keyNumber : selectedKey;
        if (!keyForCommand) throw new Error('No key selected.');

        setShowPinInput(false);
        setScanError('');
        setScanMessage('Backup PIN verified. Unlocking cabinet...');
        setShowScanUI(true);
        setIsWaitingForDevice(true);
        setIsUnlocking(false);
        enqueueToast('Backup PIN verified. Unlocking cabinet...');

        // Send unlock command to ESP32
        await clearPendingDeviceCommands();
        const { data: cmdData, error: cmdError } = await supabase
          .from('device_commands')
          .insert({
            device_id: 'locker_1',
            action: 'unlock_with_backup_pin',
            key_number: keyForCommand,
            processed: false,
            result: 'pending',
          })
          .select('id')
          .single();

        if (cmdError) throw new Error(cmdError.message);
        if (!cmdData?.id) throw new Error('Backup PIN unlock command was not created.');

        const result = await waitForCommandResult(cmdData.id, 60000, 300);
        if (result.result !== 'backup_pin_unlocked') {
          throw new Error(`Backup PIN unlock failed: ${result.result}`);
        }

        setEnteredPin('');
        setFailedAttempts(0);
        setIsWaitingForDevice(false);
        setIsUnlocking(true);
        setScanMessage('Backup PIN verified');
        setScanError('');
        enqueueToast('Backup PIN verified.');
        setTimeout(() => executeFinalAction(), 300);

      } else {
        // Offline PIN path — verify against cached hash
        const pinValid = verifyOfflinePin(actingUser.id, enteredPin);
        if (!pinValid) {
          alert('Wrong PIN. (Offline — using cached PIN)');
          return;
        }

        setShowPinInput(false);
        setEnteredPin('');
        setFailedAttempts(0);
        enqueueToast('[Offline] PIN verified locally.');

        // Show brief success UI then execute offline action
        setShowScanUI(true);
        setIsUnlocking(true);
        setScanMessage('PIN verified offline. Logging action…');
        setScanError('');

        setTimeout(() => {
          executeOfflineAction();
        }, 1000);
      }
    } catch (err: any) {
      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      setShowScanUI(false);
      setShowPinInput(true);
      alert(err.message || 'Failed to verify PIN.');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // ── Main action ───────────────────────────────────────────────────────────
  const initiateAction = async () => {
    if (!selectedUser) { alert('Please select a registered user.'); return; }

    const isReturning = !!currentUserBorrow;
    const actingUser = isReturning ? borrowerForReturn : selectedUser;
    if (!actingUser) { alert('Unable to resolve the user for this action.'); return; }

    if (!isReturning) {
      if (!selectedYearSection) { alert('Please select your Year & Section.'); return; }
      if (!selectedKey) { alert('Please select a key to borrow.'); return; }
      if (activeBorrows.find((b) => b.userId === actingUser.id)) {
        alert('This user still has an unreturned key.');
        return;
      }
    }

    // ── OFFLINE MODE ──────────────────────────────────────────────────────
    if (!isOnline || !SUPABASE_CONFIGURED) {
      // No fingerprint scanner reachable — go straight to PIN
      const hasCachedPin = (() => {
        try {
          const store = JSON.parse(localStorage.getItem(OFFLINE_PIN_KEY) || '{}');
          return !!store[actingUser.id];
        } catch { return false; }
      })();

      if (!hasCachedPin) {
        // No cached PIN either — allow action with a warning
        const confirmed = window.confirm(
          'You are offline and no cached PIN is available for this user.\n\n' +
          'The action will be logged locally and synced when back online.\n\nProceed?'
        );
        if (!confirmed) return;
        executeOfflineAction();
        return;
      }

      // Show PIN input for offline verification
      setShowPinInput(true);
      setScanError('');
      setEnteredPin('');
      return;
    }

    // ── ONLINE MODE ───────────────────────────────────────────────────────
    if (!actingUser.fingerprintId || String(actingUser.fingerprintId).trim() === '') {
      alert('This user has no fingerprint ID.');
      return;
    }

    const keyForCommand = isReturning ? currentUserBorrow!.keyNumber : selectedKey;
    const expectedFingerprintId = Number(String(actingUser.fingerprintId).trim());
    if (!Number.isFinite(expectedFingerprintId) || expectedFingerprintId <= 0) {
      alert('Invalid fingerprint ID for this user.');
      return;
    }

    try {
      await clearPendingDeviceCommands();

      const { data, error } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: 'verify_and_unlock',
          expected_fingerprint_id: expectedFingerprintId,
          key_number: keyForCommand,
          processed: false,
          result: 'pending',
        })
        .select('id')
        .single();

      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error('Borrow/return command was not created.');

      setFailedAttempts(0);
      setShowPinInput(false);
      setEnteredPin('');
      setScanError('');
      setScanMessage(
        deviceStatus?.sensor_found === false
          ? 'Fingerprint sensor is not ready.'
          : 'Waiting for fingerprint...'
      );
      setIsUnlocking(false);
      setIsWaitingForDevice(true);
      setShowScanUI(true);

      const result = await waitForCommandResult(data.id, 60000, 300);

      if (result.result === 'matched') {
        setScanError('');
        setScanMessage(
          isReturning
            ? `Return verified (ID ${result.scanned_fingerprint_id ?? expectedFingerprintId})`
            : `Verified (ID ${result.scanned_fingerprint_id ?? expectedFingerprintId})`
        );
        setIsWaitingForDevice(false);
        setIsUnlocking(true);
        setFailedAttempts(0);
        enqueueToast('Fingerprint matched.');
        setTimeout(() => executeFinalAction(), 300);
        return;
      }

      if (result.result === 'show_backup_pin') {
        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setScanError('Fingerprint mismatch.');
        setScanMessage('Please enter your backup PIN.');
        setShowScanUI(false);
        setShowPinInput(true);
        setFailedAttempts(1);
        enqueueToast('Fingerprint did not match. Please enter your backup PIN.');
        return;
      }

      if (result.result === 'timeout') {
        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setFailedAttempts(1);
        setScanError('No fingerprint detected in time.');
        setScanMessage('Verification failed. Please enter your backup PIN.');
        setShowScanUI(false);
        setShowPinInput(true);
        enqueueToast('No fingerprint detected. Please enter your backup PIN.');
        return;
      }

      if (result.result === 'mismatch') {
        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setFailedAttempts(1);
        setScanError(`Fingerprint mismatch. Scanned ID ${result.scanned_fingerprint_id ?? 'unknown'}.`);
        setScanMessage('Fingerprint did not match. Please enter your backup PIN.');
        setShowScanUI(false);
        setShowPinInput(true);
        enqueueToast('Fingerprint did not match. Please enter your backup PIN.');
        return;
      }

      if (result.result === 'sensor_not_ready') {
        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setScanError('Fingerprint sensor is not ready.');
        setScanMessage('Device sensor is not ready.');
        enqueueToast('Fingerprint sensor is not ready.');
        return;
      }

      if (result.result === 'unlock_failed') {
        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setScanError('Locker unlock failed.');
        setScanMessage('Locker unlock failed.');
        enqueueToast('Locker unlock failed.');
        return;
      }

      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      setScanError(`Unexpected result: ${result.result}`);
      setScanMessage(`Unexpected result: ${result.result}`);
      enqueueToast(`Unexpected result: ${result.result}`);
    } catch (err: any) {
      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      setShowScanUI(false);
      alert(err.message || 'Failed to communicate with device.');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Toast */}
      {showToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold animate-in fade-in slide-in-from-top-2 duration-300">
          {toastMessage}
        </div>
      )}

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center gap-3 px-5 py-3 bg-amber-50 border-2 border-amber-200 rounded-2xl text-amber-800 text-sm font-bold">
          <WifiOff size={18} className="shrink-0 text-amber-500" />
          <div>
            <span className="font-black uppercase tracking-wide text-xs">Offline Mode</span>
            <p className="text-xs font-medium text-amber-700 mt-0.5">
              Actions will be logged locally and synced when connection is restored.
              {offlineQueue.length > 0 && ` (${offlineQueue.length} pending)`}
            </p>
          </div>
        </div>
      )}

      {/* Syncing indicator */}
      {isSyncing && (
        <div className="flex items-center gap-3 px-5 py-3 bg-indigo-50 border-2 border-indigo-100 rounded-2xl text-indigo-700 text-sm font-bold">
          <Loader2 size={16} className="animate-spin shrink-0" />
          Syncing offline actions…
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 space-y-8 relative overflow-hidden border border-gray-100">

        {/* Device status box */}
        {showStatusBox && isOnline && (
          <div className="rounded-2xl border-2 border-indigo-50 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Device Status
              </span>
              <span
                className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                  deviceStatus?.sensor_found
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {deviceStatus?.sensor_found ? 'Sensor Found' : 'Sensor Not Ready'}
              </span>
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-600">
              {deviceStatus?.status_message || 'Waiting for device status...'}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                  deviceStatus?.wifi_connected
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {deviceStatus?.wifi_connected ? 'WiFi Connected' : 'WiFi Disconnected'}
              </span>
              {deviceStatus?.current_mode && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700">
                  {deviceStatus.current_mode}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Scan UI overlay */}
        {showScanUI && (
          <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                {isOnline ? 'Biometric Verification' : 'Offline Verification'}
              </h3>
              <p className="text-gray-500 text-sm font-medium">{scanMessage}</p>
            </div>

            <div className="relative mb-8">
              <div
                className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-700 ${
                  isUnlocking
                    ? 'bg-green-50 text-green-600 scale-110'
                    : scanError
                    ? 'bg-red-50 text-red-600'
                    : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                {isUnlocking ? (
                  <Unlock size={64} className="animate-bounce" />
                ) : isWaitingForDevice ? (
                  <Loader2 size={64} className="animate-spin" />
                ) : (
                  <Fingerprint size={64} className="animate-pulse" />
                )}
              </div>

              {!isUnlocking && !scanError && isWaitingForDevice && (
                <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
              )}

              {scanError && (
                <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2 text-red-600 font-black text-xs text-center">
                  <XCircle size={16} /> {scanError}
                </div>
              )}
            </div>

            <div className="w-full flex flex-col items-center gap-4">
              {isUnlocking ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-green-600 font-black text-sm uppercase">
                    <CheckCircle2 size={18} /> Verified
                  </div>
                  <p className="text-gray-400 text-[10px] font-black animate-pulse uppercase mt-2">
                    {isOnline ? 'Unlocking Cabinet...' : 'Logging Action...'}
                  </p>
                </div>
              ) : (
                <div className="text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {isOnline
                    ? (deviceStatus?.status_message || 'Waiting for ESP32 fingerprint verification…')
                    : 'Offline — verifying locally…'}
                  {isOnline && (
                    <>
                      <div className="mt-2 text-[11px] font-black text-gray-700 normal-case">
                        Expected fingerprint ID:{' '}
                        <span className="font-black">
                          {currentUserBorrow
                            ? String(borrowerForReturn?.fingerprintId ?? '—')
                            : String(selectedUser?.fingerprintId ?? '—')}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] font-black text-amber-600 normal-case">
                        Failed attempts: {failedAttempts}/1
                      </div>
                    </>
                  )}
                </div>
              )}

              {!isUnlocking && (
                <button
                  onClick={clearVisualState}
                  className="py-2 text-gray-400 font-bold uppercase tracking-widest text-[10px]"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}

        {/* PIN input overlay */}
        {showPinInput && (
          <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                Enter Backup PIN
              </h3>
              <p className="text-gray-500 text-sm font-medium">
                {isOnline
                  ? 'Fingerprint failed once. Enter your backup PIN to continue.'
                  : 'Offline mode. Enter your backup PIN to verify identity.'}
              </p>
              {!isOnline && (
                <div className="mt-2 flex items-center justify-center gap-1.5 text-amber-600 text-xs font-bold">
                  <WifiOff size={13} /> Offline verification
                </div>
              )}
            </div>

            <div className="w-full max-w-xs space-y-4">
              <input
                type="password"
                inputMode="numeric"
                placeholder="Enter PIN"
                value={enteredPin}
                onChange={(e) => setEnteredPin(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-100 rounded-2xl font-black text-sm text-gray-900 focus:bg-white focus:border-indigo-500 transition-all outline-none text-center tracking-[0.3em]"
              />

              <button
                onClick={handlePinVerify}
                disabled={isVerifyingPin}
                className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-lg hover:bg-indigo-700 transition-all uppercase tracking-wider text-sm disabled:opacity-70"
              >
                {isVerifyingPin ? 'Verifying PIN...' : 'Verify PIN'}
              </button>

              <button
                onClick={() => { setShowPinInput(false); setEnteredPin(''); }}
                className="w-full py-3 text-gray-400 font-bold uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto mb-4">
            <Lock size={28} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Key Management</h2>
          {!isOnline && (
            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-1">
              Offline Mode Active
            </p>
          )}
        </div>

        {/* Main form */}
        {!isIdentified ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">
                Identify User
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-5 py-4.5 bg-gray-50 border-2 border-indigo-100 rounded-2xl font-black text-sm text-gray-900 focus:bg-white focus:border-indigo-500 transition-all outline-none"
              >
                <option value="" className="text-gray-400 font-bold">Choose registered user</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id} className="text-gray-900 font-bold bg-white">
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">
                Year & Section
              </label>
              <select
                value={selectedYearSection}
                onChange={(e) => setSelectedYearSection(e.target.value as YearSection)}
                className="w-full px-5 py-4.5 bg-gray-50 border-2 border-indigo-100 rounded-2xl font-black text-sm text-gray-900 focus:bg-white focus:border-indigo-500 transition-all outline-none"
              >
                <option value="" className="text-gray-400 font-bold">Select current section</option>
                {[
                  '1st Year - Day', '1st Year - Night',
                  '2nd Year - Day', '2nd Year - Night',
                  '3rd Year - Day', '3rd Year - Night',
                  '4th Year - Day', '4th Year - Night',
                ].map((ys) => (
                  <option key={ys} value={ys} className="text-gray-900 font-bold bg-white">{ys}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-6 flex flex-col items-center">
            <div className="w-full flex items-center gap-4 p-5 bg-indigo-50/50 rounded-3xl border border-indigo-100 relative">
              <img
                src={selectedUser!.photoUrl || 'https://via.placeholder.com/80'}
                alt=""
                className="w-16 h-16 rounded-2xl object-cover border-2 border-white shadow-md"
              />
              <div>
                <p className="font-black text-indigo-900 text-lg">{selectedUser!.fullName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase">
                  {currentUserBorrow ? currentUserBorrow.yearSection : selectedYearSection}
                </p>
              </div>
              <button
                onClick={resetAllState}
                className="absolute -top-2 -right-2 w-7 h-7 bg-white border border-gray-100 rounded-full text-gray-400 shadow-sm hover:text-red-500 font-black flex items-center justify-center pb-0.5"
              >
                ×
              </button>
            </div>

            {currentUserBorrow ? (
              <div className="w-full p-6 bg-amber-50 rounded-[2rem] border-2 border-dashed border-amber-200 text-center">
                <p className="text-[10px] text-amber-900 font-black uppercase mb-1">Active Possession</p>
                <p className="text-5xl font-black text-amber-600">#{currentUserBorrow.keyNumber}</p>
              </div>
            ) : (
              <div className="w-full space-y-3">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">
                  Available Slots
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {keys.map((keyNum) => {
                    const isBorrowed = activeBorrows.some((b) => b.keyNumber === keyNum);
                    return (
                      <button
                        key={keyNum}
                        disabled={isBorrowed}
                        onClick={() => setSelectedKey(keyNum)}
                        className={`py-3 text-[11px] font-black rounded-xl border-2 transition-all ${
                          isBorrowed
                            ? 'bg-gray-50 border-gray-50 text-gray-200 opacity-50 cursor-not-allowed'
                            : selectedKey === keyNum
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-white border-gray-100 text-gray-700 hover:border-indigo-200'
                        }`}
                      >
                        #{keyNum}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={initiateAction}
              disabled={isWaitingForDevice || showScanUI || isVerifyingPin}
              className={`w-full py-5 rounded-2xl font-black text-base shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest disabled:opacity-60 disabled:cursor-not-allowed ${
                currentUserBorrow
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {!isOnline ? <WifiOff size={22} /> : <Fingerprint size={22} />}
              {currentUserBorrow
                ? (isOnline ? 'Verify to Return' : 'Offline Return')
                : (isOnline ? 'Verify to Borrow' : 'Offline Borrow')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KeylockerSection;