import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Program, Position, YearSection, User } from '../types';
import { Camera, Fingerprint, UserPlus, Trash2, CheckCircle2 } from 'lucide-react';

interface RegisterSectionProps {
  onRegister: (user: User) => void;
  users: User[];
  lastScan?: {
    id?: string | number;
    fingerprint_id: string;
    device_id?: string;
    action?: string;
    created_at?: string;
  } | null;
}

const RegisterSection: React.FC<RegisterSectionProps> = ({ onRegister, users, lastScan }) => {
  const [fullName, setFullName] = useState('');
  const [program, setProgram] = useState<Program | ''>('');
  const [position, setPosition] = useState<Position | ''>('');
  const [photo, setPhoto] = useState<string | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);

 const [fingerprintReady, setFingerprintReady] = useState(false);
const [assignedFingerprintId, setAssignedFingerprintId] = useState<string>('');
const [scanMessage, setScanMessage] = useState('Waiting for fingerprint scan...');
const [lastHandledScanId, setLastHandledScanId] = useState<string | number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const nextFingerprintId = useMemo(() => {
    const numericIds = users
      .map((user) => Number(user.fingerprintId))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (numericIds.length === 0) return 1;

    return Math.max(...numericIds) + 1;
  }, [users]);

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

        const stream = videoRef.current.srcObject as MediaStream | null;
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }

        setIsCapturing(false);
      }
    }
  };

 const prepareFingerprintEnroll = () => {
  setFingerprintReady(false);
  setAssignedFingerprintId('');
  setScanMessage('Waiting for fingerprint scan...');
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

    if (!assignedFingerprintId) {
      alert('Please prepare fingerprint enroll first.');
      return;
    }

    if (!fingerprintReady) {
      alert('Please finish the fingerprint preparation first.');
      return;
    }

    const newUser: User = {
      id: Math.random().toString(36).substring(2, 11),
      fullName,
      program: program as Program,
      position: position as Position,
      yearSection: '' as YearSection,
      photoUrl: photo,
      fingerprintId: assignedFingerprintId,
      registeredAt: Date.now(),
    };

    onRegister(newUser);

    setFullName('');
    setProgram('');
    setPosition('');
    setPhoto(null);
    setFingerprintReady(false);
    setAssignedFingerprintId('');
    setScanMessage('Prepare fingerprint enroll to assign the next ID');
  };

  useEffect(() => {
  if (!lastScan) return;

  if (lastScan.id != null && lastHandledScanId === lastScan.id) return;

  if (lastScan.id != null) {
    setLastHandledScanId(lastScan.id);
  }

  const scannedId = String(lastScan.fingerprint_id ?? '').trim();
  if (!scannedId) return;

  const alreadyUsed = users.some(
    (user) => String(user.fingerprintId).trim() === scannedId
  );

  if (alreadyUsed) {
    setFingerprintReady(false);
    setAssignedFingerprintId('');
    setScanMessage(`Fingerprint ID ${scannedId} is already registered.`);
    return;
  }

  setAssignedFingerprintId(scannedId);
  setFingerprintReady(true);
  setScanMessage(`Fingerprint detected: ID ${scannedId}`);
}, [lastScan, lastHandledScanId, users]);

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
                onClick={() => setPhoto(null)}
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
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black placeholder-gray-400"
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Course
            </label>
            <select
              value={program}
              onChange={(e) => setProgram(e.target.value as Program)}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black appearance-none"
            >
              <option value="" className="text-gray-400">
                Select your course
              </option>
              <option value="BSCE" className="text-gray-900">
                BSCE
              </option>
              <option value="BSEE" className="text-gray-900">
                BSEE
              </option>
              <option value="BSME" className="text-gray-900">
                BSME
              </option>
              <option value="BSCPE" className="text-gray-900">
                BSCPE
              </option>
              <option value="BSIE" className="text-gray-900">
                BSIE
              </option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-1.5 ml-1">
              Position
            </label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position)}
              className="w-full px-4 py-3.5 bg-gray-50 border-2 border-indigo-50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-gray-900 font-black appearance-none"
            >
              <option value="" className="text-gray-400">
                Select position
              </option>
              <option value="Instructor" className="text-gray-900">
                Instructor
              </option>
              <option value="Class Mayor" className="text-gray-900">
                Class Mayor
              </option>
            </select>
          </div>

          <div className="hidden">
  <label>Next Fingerprint ID</label>
  <p>{assignedFingerprintId || nextFingerprintId}</p>
</div>
        </div>

        <div className="space-y-2 pt-2">
          <button
            onClick={prepareFingerprintEnroll}
            className={`w-full py-4 rounded-2xl border-2 flex items-center justify-center gap-3 transition-all ${
              fingerprintReady
                ? 'border-green-300 bg-green-50 text-green-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
            }`}
          >
            {fingerprintReady ? <CheckCircle2 size={24} /> : <Fingerprint size={24} />}
            <span className="font-black uppercase tracking-widest text-xs">
             {fingerprintReady ? 'Fingerprint Detected' : 'Wait for Fingerprint'}
            </span>
          </button>

          <p className="text-xs text-center text-gray-500 font-semibold">{scanMessage}</p>
        </div>

        <button
          onClick={handleRegister}
          className="w-full py-4 bg-gradient-to-r from-indigo-700 to-purple-700 text-white font-black rounded-2xl shadow-lg hover:shadow-indigo-200/50 hover:opacity-95 transition-all active:scale-[0.98] mt-4 uppercase tracking-wider text-sm"
        >
          Complete Registration
        </button>
      </div>
    </div>
  );
};

export default RegisterSection;