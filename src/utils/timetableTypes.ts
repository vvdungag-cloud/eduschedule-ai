export interface TimeSlot {
  day: number; // 2 (Thứ 2) -> 7 (Thứ 7)
  period: number; // 1 -> 5
}

export interface TimetableLesson {
  id: string;
  classId: string;
  className: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  day: number;
  period: number;
  isFixed?: boolean;
  fixedReason?: string; // 'Chào cờ' | 'Sinh hoạt lớp' | 'Cố định'
}

export interface TimetableByClass {
  [classId: string]: {
    [dayPeriodKey: string]: TimetableLesson; // key: `${day}_${period}`
  };
}

export interface TimetableByTeacher {
  [teacherId: string]: {
    [dayPeriodKey: string]: TimetableLesson;
  };
}

export interface TimetableStats {
  totalLessons: number;
  totalClasses: number;
  totalTeachers: number;
  teacherConflicts: number;
  classConflicts: number;
  isolatedGaps: number; // Tiết trống lắt léo giữa các tiết dạy của giáo viên trong 1 buổi
  teacherDaysWithLessons: number; // Tổng số lượt buổi dạy của GV
  solverUsed: 'ortools_cp_sat' | 'ts_constraint_engine' | 'cp_sat_constraint_engine';
  executionTimeMs: number;
}

export interface LockedSlotsConfig {
  byClass: Record<string, string[]>; // classId -> array of "day_period" e.g. ["2_5", "4_4"]
  byTeacher: Record<string, string[]>; // teacherId -> array of "day_period" e.g. ["3_1", "3_2"]
  byGrade?: Record<string, string[]>; // grade ('10' | '11' | '12') -> array of "day_period"
  global: string[]; // array of "day_period" locked for all classes e.g. ["7_4"]
  classBreakExceptions?: Record<string, string[]>; // classId -> array of "day_period" overrides/exceptions e.g. ["4_5"]
}

export type SessionMode = 'single' | 'double'; // 'single': 1 buổi/ngày (Sáng), 'double': 2 buổi/ngày (Sáng & Chiều)

export interface PeriodConfigItem {
  period: number; // 1..5 Sáng, 6..10 Chiều
  label: string;
  shortLabel: string;
  time: string;
  session: 'morning' | 'afternoon';
  sessionPeriod: number; // 1..5 trong buổi đó
}

export interface TimetableData {
  academicYear: string;
  semester: string;
  createdAt: string;
  lessons: TimetableLesson[];
  stats: TimetableStats;
  sessionMode?: SessionMode;
  afternoonPeriodsCount?: number;
  fixedSlotsConfig: {
    chaoCoDay: number; // default 2 (Thứ 2)
    chaoCoPeriod: number; // default 1 (Tiết 1)
    sinhHoatDay: number; // default 7 (Thứ 7)
    sinhHoatPeriod: number; // default 5 (Tiết 5)
  };
  lockedSlots?: LockedSlotsConfig;
}

export const DAYS_CONFIG = [
  { day: 2, label: 'Thứ 2', shortLabel: 'T2' },
  { day: 3, label: 'Thứ 3', shortLabel: 'T3' },
  { day: 4, label: 'Thứ 4', shortLabel: 'T4' },
  { day: 5, label: 'Thứ 5', shortLabel: 'T5' },
  { day: 6, label: 'Thứ 6', shortLabel: 'T6' },
  { day: 7, label: 'Thứ 7', shortLabel: 'T7' }
];

export const MORNING_PERIODS_CONFIG: PeriodConfigItem[] = [
  { period: 1, label: 'Tiết 1 (Sáng)', shortLabel: 'T1', time: '07:00 - 07:45', session: 'morning', sessionPeriod: 1 },
  { period: 2, label: 'Tiết 2 (Sáng)', shortLabel: 'T2', time: '07:50 - 08:35', session: 'morning', sessionPeriod: 2 },
  { period: 3, label: 'Tiết 3 (Sáng)', shortLabel: 'T3', time: '08:50 - 09:35', session: 'morning', sessionPeriod: 3 },
  { period: 4, label: 'Tiết 4 (Sáng)', shortLabel: 'T4', time: '09:40 - 10:25', session: 'morning', sessionPeriod: 4 },
  { period: 5, label: 'Tiết 5 (Sáng)', shortLabel: 'T5', time: '10:30 - 11:15', session: 'morning', sessionPeriod: 5 }
];

export const AFTERNOON_PERIODS_CONFIG: PeriodConfigItem[] = [
  { period: 6, label: 'Tiết 6 (Chiều 1)', shortLabel: 'T6', time: '13:00 - 13:45', session: 'afternoon', sessionPeriod: 1 },
  { period: 7, label: 'Tiết 7 (Chiều 2)', shortLabel: 'T7', time: '13:50 - 14:35', session: 'afternoon', sessionPeriod: 2 },
  { period: 8, label: 'Tiết 8 (Chiều 3)', shortLabel: 'T8', time: '14:50 - 15:35', session: 'afternoon', sessionPeriod: 3 },
  { period: 9, label: 'Tiết 9 (Chiều 4)', shortLabel: 'T9', time: '15:40 - 16:25', session: 'afternoon', sessionPeriod: 4 },
  { period: 10, label: 'Tiết 10 (Chiều 5)', shortLabel: 'T10', time: '16:30 - 17:15', session: 'afternoon', sessionPeriod: 5 }
];

export const ALL_PERIODS_CONFIG: PeriodConfigItem[] = [
  ...MORNING_PERIODS_CONFIG,
  ...AFTERNOON_PERIODS_CONFIG
];

export function getPeriodsConfig(sessionMode: SessionMode = 'single', afternoonPeriodsCount: number = 4): PeriodConfigItem[] {
  if (sessionMode === 'single') {
    return MORNING_PERIODS_CONFIG;
  }
  const count = Math.min(5, Math.max(1, afternoonPeriodsCount || 4));
  return [...MORNING_PERIODS_CONFIG, ...AFTERNOON_PERIODS_CONFIG.slice(0, count)];
}

export const PERIODS_CONFIG = MORNING_PERIODS_CONFIG;
