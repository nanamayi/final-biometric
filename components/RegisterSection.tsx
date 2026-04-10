import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Program, Position, YearSection, User } from '../types';
import { Camera, Fingerprint, UserPlus, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase, SUPABASE_CONFIGURED } from '../supabase';

interface RegisterSectionProps {
  onRegister: (user: User & { backupPin?: string }) => void;
  users: User[];
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

const RegisterSection: React.FC<RegisterSectionProps> = ({ onRegister, users }) => {
  const [fullName, setFullName] = useState('');
  const [program, setProgram] = useState<Program | ''>('');
  const [position, setPosition] = useState<Position | ''>('');
  const [photo, setPhoto] = useState<string | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);

  const [fingerprintReady, setFingerprintReady] = useState(false);
  const [assignedFingerprintId, setAssignedFingerprintId] = useState<string>('');
  const [scanMessage, setScanMessage] = useState('Click to enroll fingerprint.');
  const [scanError, setScanError] = useState('');
  const [isWaitingForFingerprint, setIsWaitingForFingerprint] = useState(false);

  const [backupPin, setBackupPin] = useState('');
  const [confirmBackupPin, setConfirmBackupPin] = useState('');

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nextFingerprintId = useMemo(() => {
    const numericIds = users
      .map((user) => Number(user.fingerprintId))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (numericIds.length === 0) return 1;

    let nextId = 1;
    while (numericIds.includes(nextId)) {
      nextId++;
    }
    return nextId;
  }, [users]);

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const loadDeviceStatus = async () => {
    if (!SUPABASE_CONFIGURED) return;

    const { data, error } = await supabase
      .from('device_status')
      .select('*')
      .eq('device_id', 'locker_1')
      .maybeSingle();

    if (!error && data) {
      setDeviceStatus(data as DeviceStatus);
    }
  };

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    loadDeviceStatus();

    const channel = supabase
      .channel('register-device-status')
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
    if (!isWaitingForFingerprint || !deviceStatus) return;

    if (deviceStatus.current_mode === 'enroll') {
      setScanError('');
      setScanMessage(deviceStatus.status_message || 'Waiting for fingerprint enrollment...');
      return;
    }

    if (
      deviceStatus.status_message === 'Fingerprint sensor NOT found' ||
      deviceStatus.status_message === 'Sensor not ready'
    ) {
      setScanError('Fingerprint sensor is not ready.');
      setScanMessage('Fingerprint sensor is not ready.');
    }
  }, [deviceStatus, isWaitingForFingerprint]);

  const resetFingerprintState = () => {
    setFingerprintReady(false);
    setAssignedFingerprintId('');
    setScanError('');
    setScanMessage('Click to enroll fingerprint.');
    setIsWaitingForFingerprint(false);
  };

  const startCamera = async () => {
    setIsCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera error:', err);
      alert('Could not access camera.');
      setIsCapturing(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        setPhoto(dataUrl);
        stopCamera();
        setIsCapturing(false);

        resetFingerprintState();
      }
    }
  };

  const waitForCommandResult = async (
    commandId: string,
    timeoutMs = 90000,
    pollMs = 1500
  ) => {
    const started = Date.now();
    let lastKnownResult = 'pending';

    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('id, processed, result, expected_fingerprint_id, scanned_fingerprint_id')
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
      console.warn('Failed to clear pending commands:', error.message);
    }
  };

  const prepareFingerprintEnroll = async () => {
    if (!SUPABASE_CONFIGURED) {
      alert('Supabase is not configured.');
      return;
    }

    if (!fullName.trim()) {
      alert('Please enter your Full Name first.');
      return;
    }

    if (!program) {
      alert('Please select a Course first.');
      return;
    }

    if (!position) {
      alert('Please select a Position first.');
      return;
    }

    if (!photo) {
      alert('Please take a photo first.');
      return;
    }

    const alreadyUsed = users.some(
      (user) => Number(user.fingerprintId) === nextFingerprintId
    );

    if (alreadyUsed) {
      setScanError(`Fingerprint ID ${nextFingerprintId} is already used.`);
      setScanMessage(`Fingerprint ID ${nextFingerprintId} is already used.`);
      return;
    }

    setFingerprintReady(false);
    setAssignedFingerprintId('');
    setScanError('');
    setIsWaitingForFingerprint(true);

    if (deviceStatus?.sensor_found === false) {
      setScanError('Fingerprint sensor is not ready.');
      setScanMessage('Fingerprint sensor is not ready.');
    } else {
      setScanMessage(
        `Waiting for ESP32 to enroll fingerprint ID ${nextFingerprintId}. Place your finger on the sensor, remove it when asked, then place the same finger again.`
      );
    }

    try {
      await clearPendingDeviceCommands();

      const { data, error } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: 'enroll_fingerprint',
          expected_fingerprint_id: nextFingerprintId,
          processed: false,
          result: 'pending',
          key_number: null,
          scanned_fingerprint_id: null
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      const result = await waitForCommandResult(data.id, 90000, 1500);

      if (result.result === 'enrolled') {
        const enrolledId = String(result.expected_fingerprint_id ?? nextFingerprintId);
        setAssignedFingerprintId(enrolledId);
        setFingerprintReady(true);
        setScanError('');
        setScanMessage(`Fingerprint enrolled successfully. ID ${enrolledId}`);
        return;
      }

      if (result.result === 'enroll_failed') {
        setFingerprintReady(false);
        setAssignedFingerprintId('');
        setScanError('ESP32 failed to enroll fingerprint.');
        setScanMessage('Fingerprint enrollment failed. Please try again.');
        return;
      }

      if (result.result === 'timeout') {
        setFingerprintReady(false);
        setAssignedFingerprintId('');
        setScanError('ESP32 enrollment timed out.');
        setScanMessage('Enrollment timed out on the ESP32. Please try again.');
        return;
      }

      if (result.result === 'sensor_not_ready') {
        setFingerprintReady(false);
        setAssignedFingerprintId('');
        setScanError('Fingerprint sensor is not ready.');
        setScanMessage('Fingerprint sensor is not ready.');
        return;
      }

      if (result.result === 'invalid_fingerprint_id') {
        setFingerprintReady(false);
        setAssignedFingerprintId('');
        setScanError('Invalid fingerprint ID sent to ESP32.');
        setScanMessage('Invalid fingerprint ID sent to ESP32.');
        return;
      }

      setFingerprintReady(false);
      setAssignedFingerprintId('');
      setScanError(`Unexpected result: ${result.result}`);
      setScanMessage(`Unexpected result: ${result.result}`);
    } catch (err: any) {
      setFingerprintReady(false);
      setAssignedFingerprintId('');
      setScanError(err.message || 'Failed to enroll fingerprint.');
      setScanMessage(err.message || 'Failed to enroll fingerprint.');
    } finally {
      setIsWaitingForFingerprint(false);
      loadDeviceStatus();
    }
  };

  const handleRegister = () => {
    if (!fullName.trim()) {
      alert('Please enter your Full Name.');
      return;
    }

    if (!program) {
      alert('Please select a Course.');
      return;
    }

    if (!position) {
      alert('Please select a Position.');
      return;
    }

    if (!photo) {
      alert('Please take a photo to proceed.');
      return;
    }

    if (!assignedFingerprintId || !fingerprintReady) {
      alert('Please enroll fingerprint first.');
      return;
    }

    if (!/^\d{4,6}$/.test(backupPin)) {
      alert('Backup PIN must be 4 to 6 digits.');
      return;
    }

    if (backupPin !== confirmBackupPin) {
      alert('Backup PIN does not match.');
      return;
    }

    const duplicate = users.some(
      (user) => String(user.fingerprintId).trim() === assignedFingerprintId.trim()
    );

    if (duplicate) {
      alert(`Fingerprint ID ${assignedFingerprintId} is already registered.`);
      return;
    }

    const newUser: User = {
      id: Math.random().toString(36).substring(2, 11),
      fullName: fullName.trim(),
      program: program as Program,
      position: position as Position,
      yearSection: '' as YearSection,
      photoUrl: photo,
      fingerprintId: assignedFingerprintId,
      registeredAt: Date.now(),
    };

    onRegister({
      ...newUser,
      backupPin
    });

    setFullName('');
    setProgram('');
    setPosition('');
    setPhoto(null);
    resetFingerprintState();
    setBackupPin('');
    setConfirmBackupPin('');
    stopCamera();
    setIsCapturing(false);
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-xl p-8 max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 mb-2">
          <UserPlus size={24} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Register New User</h2>
        <p className="text-gray-600 text-sm">Create a profile for keylocker access</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border-2 border-indigo-50 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-black uppercase tracking-widest text-gray-500">
              Device Status
            </span>
            <span
              className={`text-xs font-black uppercase tracking-widest px-3 py-1 rounded-full ${
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

        <div className="relative group">
          <div className="w-32 h-32 mx-auto bg-gray-100 rounded-full border-4 border-indigo-50 shadow-md overflow-hidden flex items-center justify-center">
            {photo ? (
              <img src={photo} alt="User" className="w-full h-full object-cover" />
            ) : isCapturing ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
            ) : (
              <Camera size={40} className="text-gray-400" />
            )}
          </div>

          <div className="flex justify-center mt-3">
            {!photo && !isCapturing && (
              <button
                onClick={startCamera}
                className="text-sm font-bold uppercase tracking-widest text-indigo-700 bg-indigo-50 px-5 py-2.5 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-100"
              >
                Take Photo
              </button>
            )}

            {isCapturing && (
              <button
                onClick={capturePhoto}
                className="text-sm font-bold uppercase tracking-widest text-white bg-indigo-600 px-5 py-2.5 rounded-full shadow-lg hover:bg-indigo-700 transition-all"
              >
                Capture
              </button>
            )}

            {photo && (
              <button
                onClick={() => {
                  setPhoto(null);
                  resetFingerprintState();
                }}
                className="text-sm font-bold uppercase tracking-widest text-red-700 bg-red-50 px-5 py-2.5 rounded-full hover:bg-red-100 transition-colors flex items-center gap-1 border border-red-100"
              >
                <Trash2 size={14} /> Retake
              </button>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Full Name
            </label>
            <input
              type="text"
              placeholder="Enter your full name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                if (fingerprintReady) resetFingerprintState();
              }}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black placeholder-gray-400"
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Course
            </label>
            <select
              value={program}
              onChange={(e) => {
                setProgram(e.target.value as Program);
                if (fingerprintReady) resetFingerprintState();
              }}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black appearance-none"
            >
              <option value="" className="text-gray-400">Select your course</option>
              <option value="BSCE" className="text-gray-900">BSCE</option>
              <option value="BSEE" className="text-gray-900">BSEE</option>
              <option value="BSME" className="text-gray-900">BSME</option>
              <option value="BSCPE" className="text-gray-900">BSCPE</option>
              <option value="BSIE" className="text-gray-900">BSIE</option>
              <option value="CME" className="text-gray-900">CME</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Position
            </label>
            <select
              value={position}
              onChange={(e) => {
                setPosition(e.target.value as Position);
                if (fingerprintReady) resetFingerprintState();
              }}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black appearance-none"
            >
              <option value="" className="text-gray-400">Select position</option>
              <option value="Instructor" className="text-gray-900">Instructor</option>
              <option value="Class President" className="text-gray-900">Class President</option>
              <option value="Class V-Pres" className="text-gray-900">Class V-Pres</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Backup PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Enter 4 to 6 digit PIN"
              value={backupPin}
              onChange={(e) => setBackupPin(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black placeholder-gray-400"
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Confirm Backup PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Confirm your PIN"
              value={confirmBackupPin}
              onChange={(e) => setConfirmBackupPin(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black placeholder-gray-400"
            />
          </div>

          <div className="hidden">
            <label>Next Fingerprint ID</label>
            <p>{assignedFingerprintId || nextFingerprintId}</p>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <button
            onClick={prepareFingerprintEnroll}
            disabled={isWaitingForFingerprint}
            className={`w-full py-4 rounded-2xl border-2 flex items-center justify-center gap-3 transition-all ${
              fingerprintReady
                ? 'border-green-300 bg-green-50 text-green-800'
                : isWaitingForFingerprint
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                : scanError
                ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
            } ${isWaitingForFingerprint ? 'opacity-80 cursor-not-allowed' : ''}`}
          >
            {fingerprintReady ? (
              <CheckCircle2 size={24} />
            ) : isWaitingForFingerprint ? (
              <Loader2 size={24} className="animate-spin" />
            ) : scanError ? (
              <XCircle size={24} />
            ) : (
              <Fingerprint size={24} />
            )}

            <span className="font-black uppercase tracking-widest text-xs">
              {fingerprintReady
                ? 'Fingerprint Enrolled'
                : isWaitingForFingerprint
                ? 'Enrolling Fingerprint'
                : 'Enroll Fingerprint'}
            </span>
          </button>

          <p className={`text-xs text-center font-semibold ${scanError ? 'text-red-600' : 'text-gray-500'}`}>
            {scanMessage}
          </p>
        </div>

        <button
          onClick={handleRegister}
          disabled={isWaitingForFingerprint}
          className="w-full py-4 bg-gradient-to-r from-indigo-700 to-purple-700 text-white font-black rounded-2xl shadow-lg hover:shadow-indigo-200/50 hover:opacity-95 transition-all active:scale-[0.98] mt-4 uppercase tracking-wider text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        >
          Complete Registration
        </button>
      </div>
    </div>
  );
};

export default RegisterSection;