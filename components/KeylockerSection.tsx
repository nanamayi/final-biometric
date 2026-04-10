import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, HistoryItem, YearSection } from '../types';
import { Fingerprint, Lock, Unlock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
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

const KeylockerSection: React.FC<KeylockerSectionProps> = ({
  users,
  history,
  onBorrow,
  onReturn
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

  const [toastQueue, setToastQueue] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const lastToastMessageRef = useRef('');

  const [showStatusBox, setShowStatusBox] = useState(false);
  const statusBoxTimeoutRef = useRef<number | null>(null);

  const keys = Array.from({ length: 20 }, (_, i) => `${101 + i}`);

  const activeBorrows = useMemo(() => {
    return history.filter((h) => h.status === 'Borrowed' && !h.timeOut);
  }, [history]);

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

    if (statusBoxTimeoutRef.current) {
      window.clearTimeout(statusBoxTimeoutRef.current);
    }

    statusBoxTimeoutRef.current = window.setTimeout(() => {
      setShowStatusBox(false);
    }, 5000);
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

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setShowToast(false);
    }, 2200);
  }, [toastQueue, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }

      if (statusBoxTimeoutRef.current) {
        window.clearTimeout(statusBoxTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      const user = users.find((u) => u.id === selectedUserId) ?? null;
      setSelectedUser(user);
    } else {
      setSelectedUser(null);
    }
  }, [selectedUserId, users]);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    const loadDeviceStatus = async () => {
      const { data, error } = await supabase
        .from('device_status')
        .select('*')
        .eq('device_id', 'locker_1')
        .maybeSingle();

      if (!error && data) {
        setDeviceStatus(data as DeviceStatus);
      }
    };

    loadDeviceStatus();

    const channel = supabase
      .channel('keylocker-device-status')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'device_status',
          filter: 'device_id=eq.locker_1'
        },
        (payload) => {
          if (payload.new) {
            setDeviceStatus(payload.new as DeviceStatus);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!deviceStatus) return;

    const connectionMessage = `${deviceStatus.wifi_connected ? 'WiFi connected' : 'WiFi disconnected'}, ${
      deviceStatus.sensor_found ? 'sensor is ready' : 'sensor not ready'
    }`;

    enqueueToast(connectionMessage);
  }, [deviceStatus?.wifi_connected, deviceStatus?.sensor_found]);

  useEffect(() => {
    if (!deviceStatus?.status_message) return;

    const allowedModes = ['verify', 'unlock', 'recovery', 'test'];
    if (!allowedModes.includes(deviceStatus.current_mode)) return;

    const message = deviceStatus.status_message.trim();
    if (!message) return;

    enqueueToast(message);
  }, [deviceStatus?.status_message, deviceStatus?.current_mode]);

  useEffect(() => {
    if (!deviceStatus) return;

    const importantModes = ['verify', 'unlock', 'recovery', 'test'];
    const shouldShow =
      importantModes.includes(deviceStatus.current_mode) ||
      !deviceStatus.wifi_connected ||
      !deviceStatus.sensor_found;

    if (!shouldShow) {
      setShowStatusBox(false);
      return;
    }

    flashStatusBox();
  }, [
    deviceStatus?.wifi_connected,
    deviceStatus?.sensor_found,
    deviceStatus?.current_mode
  ]);

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

    if (
      deviceStatus.current_mode === 'verify' ||
      deviceStatus.current_mode === 'fingerprint' ||
      deviceStatus.current_mode === 'unlock'
    ) {
      if (deviceStatus.status_message) {
        setScanMessage(deviceStatus.status_message);
      }

      if (deviceStatus.fingerprint_step === 'matched') {
        setScanError('');
        setIsWaitingForDevice(false);
        setIsUnlocking(true);
      } else if (
        deviceStatus.fingerprint_step === 'mismatch' ||
        deviceStatus.fingerprint_step === 'capture_failed' ||
        deviceStatus.fingerprint_step === 'remove_timeout'
      ) {
        setIsUnlocking(false);
      } else if (
        deviceStatus.fingerprint_step === 'place_finger_verify' ||
        deviceStatus.fingerprint_step === 'remove_finger' ||
        deviceStatus.fingerprint_step === 'finger_removed' ||
        deviceStatus.fingerprint_step === 'unlocking'
      ) {
        setScanError('');
      }
    }
  }, [deviceStatus, showScanUI]);

  const currentUserBorrow = useMemo(() => {
    if (!selectedUser) return null;
    return activeBorrows.find((b) => b.userId === selectedUser.id) ?? null;
  }, [selectedUser, activeBorrows]);

  const borrowerForReturn = useMemo(() => {
    if (!currentUserBorrow) return null;
    return users.find((u) => u.id === currentUserBorrow.userId) ?? null;
  }, [currentUserBorrow, users]);

  const isIdentified = useMemo(() => {
    if (!selectedUser) return false;
    if (currentUserBorrow) return true;
    return !!selectedYearSection;
  }, [selectedUser, currentUserBorrow, selectedYearSection]);

  const waitForCommandResult = async (
    commandId: string,
    timeoutMs = 60000,
    pollMs = 300
  ) => {
    const started = Date.now();
    let lastKnownResult = 'pending';

    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('id, processed, result, scanned_fingerprint_id')
        .eq('id', commandId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (data?.result) {
        lastKnownResult = data.result;
      }

      if (data?.processed === true) {
        return data;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(`Command timeout. Last result: ${lastKnownResult}`);
  };

  const clearPendingDeviceCommands = async () => {
    const { error } = await supabase.rpc('clear_pending_device_commands', {
      p_device_id: 'locker_1'
    });

    if (error) {
      throw new Error(error.message);
    }
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
        status: 'Borrowed'
      };

      onBorrow(newHistoryItem);
      enqueueToast(`Key #${selectedKey} borrowed successfully.`);
    }

    resetAllState();
  };

  const sendBackupPinUnlockCommand = async (keyNumber: string) => {
    await clearPendingDeviceCommands();

    const { data, error } = await supabase
      .from('device_commands')
      .insert({
        device_id: 'locker_1',
        action: 'unlock_with_backup_pin',
        key_number: keyNumber,
        processed: false,
        result: 'pending'
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.id) {
      throw new Error('Backup PIN unlock command was not created.');
    }

    return await waitForCommandResult(data.id, 60000, 300);
  };

  const handlePinVerify = async () => {
    const actingUser = currentUserBorrow ? borrowerForReturn : selectedUser;

    if (!actingUser) return;

    if (!enteredPin.trim()) {
      alert('Please enter your backup PIN.');
      return;
    }

    setIsVerifyingPin(true);

    try {
      const { data, error } = await supabase.functions.invoke('verify-backup-pin', {
        body: {
          userId: actingUser.id,
          pin: enteredPin
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.success) {
        alert('Wrong PIN.');
        return;
      }

      const keyForCommand = currentUserBorrow ? currentUserBorrow.keyNumber : selectedKey;

      if (!keyForCommand) {
        throw new Error('No key selected.');
      }

      setShowPinInput(false);
      setScanError('');
      setScanMessage('Backup PIN verified. Unlocking cabinet...');
      setShowScanUI(true);
      setIsWaitingForDevice(true);
      setIsUnlocking(false);
      enqueueToast('Backup PIN verified. Unlocking cabinet...');

      const result = await sendBackupPinUnlockCommand(keyForCommand);

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

      setTimeout(() => {
        executeFinalAction();
      }, 300);
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

  const initiateAction = async () => {
    if (!SUPABASE_CONFIGURED) {
      alert('Supabase is not configured.');
      return;
    }

    if (!selectedUser) {
      alert('Please select a registered user.');
      return;
    }

    const isReturning = !!currentUserBorrow;
    const actingUser = isReturning ? borrowerForReturn : selectedUser;

    if (!actingUser) {
      alert('Unable to resolve the user for this action.');
      return;
    }

    if (!actingUser.fingerprintId || String(actingUser.fingerprintId).trim() === '') {
      alert('This user has no fingerprint ID.');
      return;
    }

    if (!isReturning) {
      if (!selectedYearSection) {
        alert('Please select your Year & Section.');
        return;
      }

      if (!selectedKey) {
        alert('Please select a key to borrow.');
        return;
      }

      const alreadyBorrowing = activeBorrows.find((b) => b.userId === actingUser.id);
      if (alreadyBorrowing) {
        alert('This user still has an unreturned key.');
        return;
      }
    }

    const keyForCommand = isReturning ? currentUserBorrow!.keyNumber : selectedKey;
    const expectedFingerprintId = Number(String(actingUser.fingerprintId).trim());

    if (!Number.isFinite(expectedFingerprintId) || expectedFingerprintId <= 0) {
      alert('Invalid fingerprint ID for this user.');
      return;
    }

    const actionName = 'verify_and_unlock';

    try {
      await clearPendingDeviceCommands();

      const { data, error } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: actionName,
          expected_fingerprint_id: expectedFingerprintId,
          key_number: keyForCommand,
          processed: false,
          result: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.id) {
        throw new Error('Borrow/return command was not created.');
      }

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

        setTimeout(() => {
          executeFinalAction();
        }, 300);
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

      const message = err.message || 'Failed to communicate with device.';
      alert(message);
    }
  };

  const handleReset = () => {
    resetAllState();
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {showToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold animate-in fade-in slide-in-from-top-2 duration-300">
          {toastMessage}
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 space-y-8 relative overflow-hidden border border-gray-100">
        {showStatusBox && (
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

        {showScanUI && (
          <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                Biometric Verification
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
                <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
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
                    Unlocking Cabinet...
                  </p>
                </div>
              ) : (
                <div className="text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {deviceStatus?.status_message || 'Waiting for ESP32 fingerprint verification…'}
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
                </div>
              )}

              {!isUnlocking && (
                <button
                  onClick={() => {
                    clearVisualState();
                  }}
                  className="py-2 text-gray-400 font-bold uppercase tracking-widest text-[10px]"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}

        {showPinInput && (
          <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                Enter Backup PIN
              </h3>
              <p className="text-gray-500 text-sm font-medium">
                Fingerprint failed once. Enter your backup PIN to continue.
              </p>
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
                onClick={() => {
                  setShowPinInput(false);
                  setEnteredPin('');
                }}
                className="w-full py-3 text-gray-400 font-bold uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="text-center">
          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto mb-4">
            <Lock size={28} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Key Management</h2>
        </div>

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
                <option value="" className="text-gray-400 font-bold">
                  Choose registered user
                </option>
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
                <option value="" className="text-gray-400 font-bold">
                  Select current section
                </option>
                <option value="1st Year - Day" className="text-gray-900 font-bold bg-white">1st Year - Day</option>
                <option value="1st Year - Night" className="text-gray-900 font-bold bg-white">1st Year - Night</option>
                <option value="2nd Year - Day" className="text-gray-900 font-bold bg-white">2nd Year - Day</option>
                <option value="2nd Year - Night" className="text-gray-900 font-bold bg-white">2nd Year - Night</option>
                <option value="3rd Year - Day" className="text-gray-900 font-bold bg-white">3rd Year - Day</option>
                <option value="3rd Year - Night" className="text-gray-900 font-bold bg-white">3rd Year - Night</option>
                <option value="4th Year - Day" className="text-gray-900 font-bold bg-white">4th Year - Day</option>
                <option value="4th Year - Night" className="text-gray-900 font-bold bg-white">4th Year - Night</option>
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
                onClick={handleReset}
                className="absolute -top-2 -right-2 w-7 h-7 bg-white border border-gray-100 rounded-full text-gray-400 shadow-sm hover:text-red-500 font-black flex items-center justify-center pb-0.5"
              >
                ×
              </button>
            </div>

            {currentUserBorrow ? (
              <div className="w-full p-6 bg-amber-50 rounded-[2rem] border-2 border-dashed border-amber-200 text-center">
                <p className="text-[10px] text-amber-900 font-black uppercase mb-1">
                  Active Possession
                </p>
                <p className="text-5xl font-black text-amber-600">
                  #{currentUserBorrow.keyNumber}
                </p>
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
              <Fingerprint size={22} />
              {currentUserBorrow ? 'Verify to Return' : 'Verify to Borrow'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KeylockerSection;