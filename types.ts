export type Program = 'BSCE' | 'BSEE' | 'BSME' | 'BSCPE' | 'BSIE' | 'CME';

export type Position = 
  | 'Instructor' 
  | 'Class President' 
  | 'Class V-Pres';

export type YearSection = 
  | '1st Year - Day' | '1st Year - Night' 
  | '2nd Year - Day' | '2nd Year - Night' 
  | '3rd Year - Day' | '3rd Year - Night' 
  | '4th Year - Day' | '4th Year - Night';

export interface User {
  id: string;
  fullName: string;
  program: Program;
  position: Position;
  yearSection: YearSection;
  photoUrl: string;
  fingerprintId: string;
  registeredAt: number;
}

export interface HistoryItem {
  id: string;
  userId: string;
  userName: string;
  userPhoto: string;
  program: Program;
  position: Position;
  yearSection: YearSection;
  keyNumber: string; 
  date: string;
  timeIn: string;
  timeOut: string | null;
  status: 'Borrowed' | 'Returned' | 'Borrowed (Pending Sync)' | 'Returned (Pending Sync)';
}

export interface DeviceStatus {
  device_id: string;
  sensor_found: boolean;
  wifi_connected: boolean;
  current_mode: string;
  status_message: string;
  fingerprint_step: string;
  updated_at?: string;
}

export interface DeviceCommand {
  id: string;
  device_id: string;
  action: 'enroll_fingerprint' | 'verify_and_unlock' | 'return_key' | 'unlock_with_backup_pin';
  expected_fingerprint_id?: number;
  enroll_fingerprint_id?: number;
  scanned_fingerprint_id?: number;
  key_number?: string;
  result: 'pending' | 'enrolled' | 'enroll_failed' | 'matched' | 'mismatch' | 
          'timeout' | 'sensor_not_ready' | 'invalid_fingerprint_id' | 'error' | 
          'cancelled' | 'show_backup_pin' | 'backup_pin_unlocked' | 'unlock_failed';
  processed: boolean;
  processed_at?: string;
  created_at?: string;
  error_message?: string;
}

export type Tab = 'Register' | 'Keylocker' | 'Registered' | 'History';