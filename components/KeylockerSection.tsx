import React, { useState, useMemo, useEffect } from 'react';
import { User, HistoryItem, YearSection } from '../types';
import { Fingerprint, Lock, Unlock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase, SUPABASE_CONFIGURED } from '../supabase';

interface KeylockerSectionProps {
  users: User[];
  history: HistoryItem[];
  onBorrow: (item: HistoryItem) => void;
  onReturn: (logId: string) => void;
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

  // ✅ NEW: PIN fallback states
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [showPinInput, setShowPinInput] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const keys = Array.from({ length: 20 }, (_, i) => `Key-${100 + i + 1}`);
  const activeBorrows = useMemo(() => history.filter(h => h.status === 'Borrowed'), [history]);

  useEffect(() => {
    if (selectedUserId) {
      const user = users.find(u => u.id === selectedUserId);
      setSelectedUser(user ?? null);
    } else {
      setSelectedUser(null);
    }
  }, [selectedUserId, users]);

  const currentUserBorrow = useMemo(() => {
    if (!selectedUser) return null;
    return activeBorrows.find(b => b.userId === selectedUser.id) ?? null;
  }, [selectedUser, activeBorrows]);

  const isIdentified = useMemo(() => {
    if (!selectedUser) return false;
    if (currentUserBorrow) return true;
    return !!selectedYearSection;
  }, [selectedUser, currentUserBorrow, selectedYearSection]);

  const waitForCommandResult = async (commandId: string, timeoutMs = 30000) => {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('processed,result,scanned_fingerprint_id')
        .eq('id', commandId)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (data?.processed) {
        return data;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new Error('Command timeout.');
  };

  const executeFinalAction = () => {
    if (!selectedUser) return;

    if (currentUserBorrow) {
      onReturn(currentUserBorrow.id);
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
    }

    setIsUnlocking(false);
    setIsWaitingForDevice(false);
    setShowScanUI(false);
    setShowPinInput(false);
    setEnteredPin('');
    setFailedAttempts(0);
    setScanMessage('Place finger on scanner…');
    setScanError('');
    handleReset();
  };

  // ✅ NEW: verify backup PIN through secure edge function
  const handlePinVerify = async () => {
    if (!selectedUser) return;

    if (!enteredPin.trim()) {
      alert('Please enter your backup PIN.');
      return;
    }

    setIsVerifyingPin(true);

    try {
      const { data, error } = await supabase.functions.invoke('verify-backup-pin', {
        body: {
          userId: selectedUser.id,
          backupPin: enteredPin
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.valid) {
        setShowPinInput(false);
        setEnteredPin('');
        setFailedAttempts(0);
        executeFinalAction();
      } else {
        alert('Wrong PIN.');
      }
    } catch (err: any) {
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

    if (!selectedUser) return;

    if (!currentUserBorrow) {
      if (!selectedYearSection) {
        alert('Please select your Year & Section.');
        return;
      }
      if (!selectedKey) {
        alert('Please select a key to borrow.');
        return;
      }
    }

    const keyForCommand = currentUserBorrow ? currentUserBorrow.keyNumber : selectedKey;

    setScanError('');
    setScanMessage('Waiting for ESP32 verification...');
    setIsUnlocking(false);
    setIsWaitingForDevice(true);
    setShowScanUI(true);

    try {
      const { data, error } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: 'verify_and_unlock',
          expected_fingerprint_id: Number(selectedUser.fingerprintId),
          key_number: keyForCommand,
          processed: false,
          result: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      const result = await waitForCommandResult(data.id, 30000);

      if (result.result === 'matched') {
        setScanError('');
        setScanMessage(`Verified (ID ${result.scanned_fingerprint_id ?? selectedUser.fingerprintId})`);
        setIsUnlocking(true);
        setFailedAttempts(0);

        setTimeout(() => {
          executeFinalAction();
        }, 800);

        return;
      }

      if (result.result === 'mismatch') {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);

        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setScanError(`Fingerprint mismatch. Scanned ID ${result.scanned_fingerprint_id ?? 'unknown'}.`);
        setScanMessage(`No match. Attempt ${newAttempts} of 3.`);

        if (newAttempts >= 3) {
          setShowScanUI(false);
          setShowPinInput(true);
        }

        return;
      }

      if (result.result === 'timeout') {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);

        setIsWaitingForDevice(false);
        setIsUnlocking(false);
        setScanError('No fingerprint detected in time.');
        setScanMessage(`Verification timeout. Attempt ${newAttempts} of 3.`);

        if (newAttempts >= 3) {
          setShowScanUI(false);
          setShowPinInput(true);
        }

        return;
      }

      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      setScanError(`Unexpected result: ${result.result}`);
      setScanMessage(`Unexpected result: ${result.result}`);
    } catch (err: any) {
      setIsWaitingForDevice(false);
      setIsUnlocking(false);
      setScanError(err.message || 'Failed to communicate with device.');
      setScanMessage(err.message || 'Failed to communicate with device.');
    }
  };

  const handleReset = () => {
    setSelectedUser(null);
    setSelectedUserId('');
    setSelectedYearSection('');
    setSelectedKey('');
    setFailedAttempts(0);
    setShowPinInput(false);
    setEnteredPin('');
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 space-y-8 relative overflow-hidden border border-gray-100">
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
                  Waiting for ESP32 fingerprint verification…
                  <div className="mt-2 text-[11px] font-black text-gray-700 normal-case">
                    Selected user fingerprint ID:{' '}
                    <span className="font-black">
                      {String(selectedUser?.fingerprintId ?? '—')}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] font-black text-amber-600 normal-case">
                    Failed attempts: {failedAttempts}/3
                  </div>
                </div>
              )}

              {!isUnlocking && (
                <button
                  onClick={() => {
                    setShowScanUI(false);
                    setIsWaitingForDevice(false);
                    setScanError('');
                    setScanMessage('Place finger on scanner…');
                  }}
                  className="py-2 text-gray-400 font-bold uppercase tracking-widest text-[10px]"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}

        {/* ✅ NEW: Backup PIN Modal */}
        {showPinInput && (
          <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                Enter Backup PIN
              </h3>
              <p className="text-gray-500 text-sm font-medium">
                Fingerprint failed 3 times. Enter your backup PIN to continue.
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
                  {currentUserBorrow.keyNumber.replace('Key-', '#')}
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
                        {keyNum.replace('Key-', '#')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={initiateAction}
              className={`w-full py-5 rounded-2xl font-black text-base shadow-xl transition-all flex items-center justify-center gap-3 uppercase tracking-widest ${
                currentUserBorrow ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-indigo-600 text-white hover:bg-indigo-700'
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