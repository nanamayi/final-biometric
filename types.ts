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
  status: 'Borrowed' | 'Returned';
}

export type Tab = 'Register' | 'Keylocker' | 'Registered' | 'History';