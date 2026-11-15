import { 
  collection, doc, getDoc, setDoc, deleteDoc, deleteField,
  onSnapshot, getDocs, Unsubscribe, serverTimestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { UserAccount } from './authContext';

export type CloudConnectionStatus = 'connected' | 'syncing' | 'error' | 'offline';

export interface SchoolTenant {
  id: string;
  name: string;
  departmentName: string;
  updatedAt?: string;
}

export const DEFAULT_SCHOOL_ID = 'thpt-nguyen-binh-khiem';
export const DEFAULT_SCHOOL_NAME = 'TRƯỜNG THPT NGUYỄN BỈNH KHIÊM';
export const DEFAULT_DEPARTMENT_NAME = 'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG';

/**
 * 1. ĐƯỜNG DẪN LƯU TRỮ CỐ ĐỊNH CHUẨN TRÊN FIRESTORE
 * Document chuẩn: schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1
 * Kèm document fallback: eduschedule_data/thpt_nguyen_binh_khiem
 */
export const TARGET_SCHOOL_ID = 'thpt-nguyen-binh-khiem';
export const TARGET_TERM_KEY = '2026___2027_HK1';
export const TARGET_TERM_DOC_REF = doc(db, 'schools', TARGET_SCHOOL_ID, 'terms', TARGET_TERM_KEY);
export const SCHOOL_DOC_REF = doc(db, 'eduschedule_data', 'thpt_nguyen_binh_khiem');
export const PARENT_SCHOOL_DOC_REF = doc(db, 'schools', TARGET_SCHOOL_ID);

/**
 * Làm sạch dữ liệu đệ quy (sanitize/clean object) trước khi gọi setDoc()
 * để loại bỏ hoàn toàn mọi giá trị undefined trong toàn bộ object, mảng và lồng nhau
 */
export function removeUndefinedFields(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  // Bảo lưu Date instances
  if (obj instanceof Date) {
    return obj;
  }
  // Bảo lưu Firestore FieldValue (như serverTimestamp(), arrayUnion(), deleteField())
  if (typeof obj.isEqual === 'function' || obj._methodName) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => item === undefined ? null : removeUndefinedFields(item));
  }
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefinedFields(v)])
  );
}

/**
 * Các trường dữ liệu lớn / lồng nhau trên Firestore (/schools/.../terms/... và eduschedule_data/...)
 * Được tuần tự hóa thành JSON string khi ghi (JSON.stringify) để tránh vượt giới hạn 40.000 index entries của Firestore,
 * và tự động giải nén (JSON.parse) khi đọc (tương thích ngược cả dữ liệu cũ dạng Object/Array).
 */
export const SERIALIZED_TERM_FIELDS = new Set<string>([
  'teachers',
  'classes',
  'subjects',
  'subjectsConfig',
  'departments',
  'assignments',
  'timetableData',
  'schedules',
  'classSubjectPeriods',
  'subjectDistribution',
  'curriculumRules',
  'classThreeConsecutivePeriods',
  'classShifts',
  'lockedSlots',
  'timetableLockedSlots',
  'customFixedSlots',
  'teacherConstraints',
  'advancedConstraints',
  'availableYears',
  'lockedYears',
  'schoolInfo'
]);

function isFirestoreSpecialValue(v: any): boolean {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Date) return true;
  if (typeof v.isEqual === 'function' || typeof v.toDate === 'function' || v._methodName) return true;
  return false;
}

/**
 * Tuần tự hóa MỌI trường dữ liệu dạng Object/Array (trừ Date / Firestore FieldValue / Timestamp)
 * thành JSON string trước khi ghi lên Firestore bằng setDoc(), giúp tổng số index entries luôn < 50.
 */
export function serializeForFirestoreDoc<T extends Record<string, any>>(payload: T): Record<string, any> {
  const cleaned = removeUndefinedFields(payload);
  if (!cleaned || typeof cleaned !== 'object') return cleaned;

  const serialized: Record<string, any> = {};
  for (const [k, v] of Object.entries(cleaned)) {
    if (v !== null && v !== undefined && typeof v === 'object' && !isFirestoreSpecialValue(v)) {
      try {
        serialized[k] = JSON.stringify(v);
      } catch {
        serialized[k] = v;
      }
    } else {
      serialized[k] = v;
    }
  }
  return serialized;
}

/**
 * Giải nén các trường JSON string từ Firestore (getDoc / onSnapshot) về lại Object/Array.
 * Vẫn giữ nguyên tương thích ngược nếu dữ liệu cũ trên Cloud đang ở dạng Object/Array trực tiếp,
 * đồng thời tự động đồng bộ các khóa alias (timetableData <-> schedules, subjects <-> subjectsConfig, lockedSlots <-> timetableLockedSlots).
 */
export function deserializeFirestoreTermData<T = any>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw;

  const out: Record<string, any> = { ...(raw as Record<string, any>) };
  for (const [field, initialVal] of Object.entries(out)) {
    let val = initialVal;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const looksLikeJson =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (SERIALIZED_TERM_FIELDS.has(field) && (trimmed === 'null' || trimmed.startsWith('"')));
      if (looksLikeJson) {
        for (let attempt = 0; attempt < 2 && typeof val === 'string'; attempt++) {
          try {
            val = JSON.parse(val);
          } catch {
            break;
          }
        }
        out[field] = val;
      }
    }
  }

  // Bảo toàn tính tương thích giữa các tên trường alias
  if (out.timetableData !== undefined && out.schedules === undefined) {
    out.schedules = out.timetableData;
  } else if (out.schedules !== undefined && out.timetableData === undefined) {
    out.timetableData = out.schedules;
  }
  if (out.subjects !== undefined && out.subjectsConfig === undefined) {
    out.subjectsConfig = out.subjects;
  } else if (out.subjectsConfig !== undefined && out.subjects === undefined) {
    out.subjects = out.subjectsConfig;
  }
  if (out.lockedSlots !== undefined && out.timetableLockedSlots === undefined) {
    out.timetableLockedSlots = out.lockedSlots;
  } else if (out.timetableLockedSlots !== undefined && out.lockedSlots === undefined) {
    out.lockedSlots = out.timetableLockedSlots;
  }

  return out as T;
}

/**
 * Chuẩn hóa và làm sạch cấu hình số tiết classSubjectPeriods:
 * Đảm bảo trường maxPeriodsPerSession luôn là null hoặc number, tuyệt đối không mang undefined
 */
export function sanitizeClassSubjectPeriods(csp: any): Record<string, Record<string, any>> {
  if (!csp || typeof csp !== 'object') return {};
  const cleaned: Record<string, Record<string, any>> = {};
  for (const [classKey, subjectsObj] of Object.entries(csp)) {
    if (!subjectsObj || typeof subjectsObj !== 'object') continue;
    cleaned[classKey] = {};
    for (const [subKey, val] of Object.entries(subjectsObj as Record<string, any>)) {
      if (typeof val === 'object' && val !== null) {
        const periodObj = val as any;
        cleaned[classKey][subKey] = {
          ...periodObj,
          mainPeriods: periodObj.mainPeriods ?? 0,
          mainMinPairs: periodObj.mainMinPairs ?? 0,
          oppPeriods: periodObj.oppPeriods ?? 0,
          oppMinPairs: periodObj.oppMinPairs ?? 0,
          allowRemainingSameSession: periodObj.allowRemainingSameSession ?? false,
          sameSessionRule: periodObj.sameSessionRule ?? '',
          maxPeriodsPerSession: (periodObj.maxPeriodsPerSession === undefined || periodObj.maxPeriodsPerSession === '' || periodObj.maxPeriodsPerSession === null)
            ? null
            : (isNaN(Number(periodObj.maxPeriodsPerSession)) ? null : Number(periodObj.maxPeriodsPerSession)),
          alternateDays: periodObj.alternateDays ?? false,
          singleSessionOnly: periodObj.singleSessionOnly ?? false,
          isRemoved: !!periodObj.isRemoved
        };
      } else {
        cleaned[classKey][subKey] = val;
      }
    }
  }
  return cleaned;
}

export function computeTermKeyFromYearAndSemester(year?: string, semester?: string): string {
  const normalizedYear = normalizeAcademicYearString(year || '2025 – 2026');
  const cleanYear = normalizedYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '') || '2025___2026';
  const s = (semester || 'Học kỳ I').toLowerCase();
  const semSuffix = s.includes('ii') || s.includes('2')
    ? 'HK2'
    : (s.includes('cả năm') || s.includes('ca nam') ? 'CN' : 'HK1');
  return `${cleanYear}_${semSuffix}`;
}

export function normalizeAcademicYearString(year?: string): string {
  if (!year) return '2025 – 2026';
  const match = String(year).match(/(\d{4})\D+(\d{4})/);
  if (match) {
    return `${match[1]} – ${match[2]}`;
  }
  return String(year).replace(/^Năm học\s+/i, '').trim() || '2025 – 2026';
}

function safeParseJson<T = any>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function getUtf8ByteSize(data: any): number {
  try {
    const json = JSON.stringify(data);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length * 2;
  } catch {
    return 0;
  }
}

/**
 * Thu thập toàn bộ state hiện có trong localStorage để đồng bộ đầy đủ lên Cloud Firestore
 */
export function collectLocalSchoolSnapshot(preferredTermKey?: string): {
  academicYear: string;
  semester: string;
  termKey: string;
  teachers?: any[];
  classes?: any[];
  subjects?: any[];
  departments?: any[];
  assignments?: any;
  classSubjectPeriods?: any;
  classThreeConsecutivePeriods?: any;
  classShifts?: any;
  sessionMode?: string;
  afternoonPeriodsCount?: number;
  lockedSlots?: any;
  customFixedSlots?: any[];
  teacherConstraints?: any;
  advancedConstraints?: any;
  timetableData?: any;
  schoolInfo?: any;
  availableYears?: string[];
  lockedYears?: Record<string, boolean>;
} {
  const curYearRaw = localStorage.getItem('edu_current_academic_year') || '2025 – 2026';
  const curYear = normalizeAcademicYearString(curYearRaw);
  const curSem = localStorage.getItem('edu_current_semester') || 'Học kỳ I';
  const computedKey = computeTermKeyFromYearAndSemester(curYear, curSem);
  const candidateKeys = Array.from(new Set([preferredTermKey, computedKey, TARGET_TERM_KEY].filter(Boolean) as string[]));

  const readFirstTermKey = <T = any>(prefix: string, extraKeys: string[] = []): T | undefined => {
    for (const tk of candidateKeys) {
      const parsed = safeParseJson<T>(localStorage.getItem(`${prefix}${tk}`));
      if (parsed !== undefined) return parsed;
    }
    for (const ek of extraKeys) {
      const parsed = safeParseJson<T>(localStorage.getItem(ek));
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  };

  const teachers = safeParseJson<any[]>(localStorage.getItem('edu_teachers'))
    || safeParseJson<any[]>(localStorage.getItem('edu_teachers_v3'));

  const classes = safeParseJson<any[]>(localStorage.getItem('edu_classes_v3'))
    || safeParseJson<any[]>(localStorage.getItem('edu_classes'))
    || readFirstTermKey<any[]>('edu_term_classes_');

  const subjects = safeParseJson<any[]>(localStorage.getItem('edu_subjects_config'))
    || readFirstTermKey<any[]>('edu_term_subjects_');

  const departments = safeParseJson<any[]>(localStorage.getItem('edu_departments'))
    || readFirstTermKey<any[]>('edu_term_departments_');

  let assignments: any;
  const assignCandidates = [
    'edu_assignments_v3',
    'edu_assignments',
    ...candidateKeys.map(tk => `edu_term_assignments_${tk}`)
  ];
  for (const k of assignCandidates) {
    const parsed = safeParseJson<any>(localStorage.getItem(k));
    if (parsed && typeof parsed === 'object') {
      const subCount = Object.values(parsed.subjectAssignments || {}).reduce(
        (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
      );
      if (subCount > 0) {
        assignments = parsed;
        break;
      } else if (!assignments) {
        assignments = parsed;
      }
    }
  }

  const classSubjectPeriods = safeParseJson<any>(localStorage.getItem('edu_class_subject_periods_v2'))
    || readFirstTermKey<any>('edu_term_class_periods_');

  const classThreeConsecutivePeriods = safeParseJson<any>(localStorage.getItem('edu_class_three_consecutive_v2'))
    || safeParseJson<any>(localStorage.getItem('edu_class_three_consecutive_periods'));

  const classShifts = readFirstTermKey<any>('edu_class_shifts_', ['edu_class_shifts']);

  let sessionMode: string | undefined;
  for (const tk of candidateKeys) {
    const raw = localStorage.getItem(`edu_session_mode_${tk}`);
    if (raw === 'double' || raw === 'single') {
      sessionMode = raw;
      break;
    }
  }

  let afternoonPeriodsCount: number | undefined;
  for (const tk of candidateKeys) {
    const raw = localStorage.getItem(`edu_afternoon_periods_${tk}`);
    if (raw) {
      const n = parseInt(raw, 10);
      if (n === 4 || n === 5) {
        afternoonPeriodsCount = n;
        break;
      }
    }
  }

  const lockedSlots = readFirstTermKey<any>('edu_locked_slots_', ['edu_timetable_locked_slots_v1', 'edu_locked_slots_v1']);
  const customFixedSlots = readFirstTermKey<any[]>('edu_custom_fixed_slots_');
  const teacherConstraints = readFirstTermKey<any>('edu_teacher_constraints_');
  const advancedConstraints = readFirstTermKey<any>('edu_advanced_constraints_');

  // Đối với TKB, ưu tiên đọc theo học kỳ đang chọn (không fallback sang TARGET_TERM_KEY nếu người dùng vừa xóa TKB ở học kỳ hiện tại)
  const primaryTk = preferredTermKey || computedKey;
  let timetableData: any = null;
  if (localStorage.getItem(`edu_timetable_${primaryTk}`) !== null) {
    timetableData = safeParseJson<any>(localStorage.getItem(`edu_timetable_${primaryTk}`)) ?? null;
  } else if (localStorage.getItem('edu_timetable_active') !== null) {
    timetableData = safeParseJson<any>(localStorage.getItem('edu_timetable_active')) ?? null;
  }

  const schoolInfo = readFirstTermKey<any>('edu_term_school_info_', ['edu_school_info_v1']);
  const availableYears = safeParseJson<string[]>(localStorage.getItem('edu_available_years'));
  const lockedYears = safeParseJson<Record<string, boolean>>(localStorage.getItem('edu_locked_years'));

  return {
    academicYear: curYear,
    semester: curSem,
    termKey: primaryTk,
    teachers,
    classes,
    subjects,
    departments,
    assignments,
    classSubjectPeriods,
    classThreeConsecutivePeriods,
    classShifts,
    sessionMode,
    afternoonPeriodsCount,
    lockedSlots,
    customFixedSlots,
    teacherConstraints,
    advancedConstraints,
    timetableData,
    schoolInfo,
    availableYears,
    lockedYears
  };
}

/**
 * Nạp đè toàn bộ dữ liệu từ Cloud Firestore vào localStorage trên máy hiện tại (hoặc thiết bị mới)
 */
export function applyCloudDataToLocalStorage(cloudData: any, currentTermKey?: string): void {
  if (!cloudData || typeof cloudData !== 'object' || typeof window === 'undefined') return;

  const cloudYear = cloudData.academicYear ? normalizeAcademicYearString(cloudData.academicYear) : undefined;
  const cloudSem = cloudData.semester || undefined;
  const cloudTermKey = cloudData.termKey || (cloudYear && cloudSem ? computeTermKeyFromYearAndSemester(cloudYear, cloudSem) : undefined);

  const termKeys = Array.from(new Set([currentTermKey, cloudTermKey, TARGET_TERM_KEY].filter(Boolean) as string[]));

  const safeSet = (key: string, value: any) => {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (e) {
      console.warn(`[Cloud Hydrate] Failed writing localStorage key ${key}:`, e);
    }
  };

  if (Array.isArray(cloudData.teachers) && cloudData.teachers.length > 0) {
    safeSet('edu_teachers', cloudData.teachers);
    safeSet('edu_teachers_v3', cloudData.teachers);
  }

  if (Array.isArray(cloudData.classes) && cloudData.classes.length > 0) {
    safeSet('edu_classes_v3', cloudData.classes);
    safeSet('edu_classes', cloudData.classes);
    termKeys.forEach(tk => safeSet(`edu_term_classes_${tk}`, cloudData.classes));
  }

  const resolvedSubjects = Array.isArray(cloudData.subjects) && cloudData.subjects.length > 0
    ? cloudData.subjects
    : (Array.isArray(cloudData.subjectsConfig) && cloudData.subjectsConfig.length > 0 ? cloudData.subjectsConfig : undefined);
  if (resolvedSubjects) {
    safeSet('edu_subjects_config', resolvedSubjects);
    termKeys.forEach(tk => safeSet(`edu_term_subjects_${tk}`, resolvedSubjects));
  }

  if (Array.isArray(cloudData.departments) && cloudData.departments.length > 0) {
    safeSet('edu_departments', cloudData.departments);
    termKeys.forEach(tk => safeSet(`edu_term_departments_${tk}`, cloudData.departments));
  }

  if (cloudData.assignments && typeof cloudData.assignments === 'object') {
    const cloudSubCount = Object.values(cloudData.assignments.subjectAssignments || {}).reduce(
      (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
    );
    if (cloudSubCount > 0 || (cloudData.assignments.homeroomAssignments && Object.keys(cloudData.assignments.homeroomAssignments).length > 0)) {
      safeSet('edu_assignments_v3', cloudData.assignments);
      safeSet('edu_assignments', cloudData.assignments);
      termKeys.forEach(tk => safeSet(`edu_term_assignments_${tk}`, cloudData.assignments));
    }
  }

  if (cloudData.classSubjectPeriods && typeof cloudData.classSubjectPeriods === 'object') {
    safeSet('edu_class_subject_periods_v2', cloudData.classSubjectPeriods);
    termKeys.forEach(tk => safeSet(`edu_term_class_periods_${tk}`, cloudData.classSubjectPeriods));
  }

  if (cloudData.subjectDistribution && typeof cloudData.subjectDistribution === 'object') {
    termKeys.forEach(tk => safeSet(`edu_term_subject_distribution_${tk}`, cloudData.subjectDistribution));
  }

  if (cloudData.classThreeConsecutivePeriods && typeof cloudData.classThreeConsecutivePeriods === 'object') {
    safeSet('edu_class_three_consecutive_v2', cloudData.classThreeConsecutivePeriods);
    safeSet('edu_class_three_consecutive_periods', cloudData.classThreeConsecutivePeriods);
  }

  if (cloudData.classShifts && typeof cloudData.classShifts === 'object') {
    safeSet('edu_class_shifts', cloudData.classShifts);
    termKeys.forEach(tk => safeSet(`edu_class_shifts_${tk}`, cloudData.classShifts));
  }

  if (cloudData.sessionMode === 'double' || cloudData.sessionMode === 'single') {
    termKeys.forEach(tk => safeSet(`edu_session_mode_${tk}`, cloudData.sessionMode));
  }

  if (cloudData.afternoonPeriodsCount === 4 || cloudData.afternoonPeriodsCount === 5) {
    termKeys.forEach(tk => safeSet(`edu_afternoon_periods_${tk}`, String(cloudData.afternoonPeriodsCount)));
  }

  const resolvedLockedSlots = cloudData.lockedSlots || cloudData.timetableLockedSlots;
  if (resolvedLockedSlots && typeof resolvedLockedSlots === 'object') {
    termKeys.forEach(tk => safeSet(`edu_locked_slots_${tk}`, resolvedLockedSlots));
  }

  if (Array.isArray(cloudData.customFixedSlots)) {
    termKeys.forEach(tk => safeSet(`edu_custom_fixed_slots_${tk}`, cloudData.customFixedSlots));
  }

  if (cloudData.teacherConstraints && typeof cloudData.teacherConstraints === 'object') {
    termKeys.forEach(tk => safeSet(`edu_teacher_constraints_${tk}`, cloudData.teacherConstraints));
  }

  if (cloudData.advancedConstraints && typeof cloudData.advancedConstraints === 'object') {
    termKeys.forEach(tk => safeSet(`edu_advanced_constraints_${tk}`, cloudData.advancedConstraints));
  }

  const hasScheduleKey = cloudData.timetableData !== undefined || cloudData.schedules !== undefined;
  const resolvedSchedule = cloudData.timetableData !== undefined ? cloudData.timetableData : cloudData.schedules;
  if (hasScheduleKey) {
    if (resolvedSchedule && typeof resolvedSchedule === 'object' && Array.isArray(resolvedSchedule.lessons)) {
      safeSet('edu_timetable_active', resolvedSchedule);
      termKeys.forEach(tk => safeSet(`edu_timetable_${tk}`, resolvedSchedule));
    } else if (resolvedSchedule === null) {
      try {
        localStorage.removeItem('edu_timetable_active');
        termKeys.forEach(tk => localStorage.removeItem(`edu_timetable_${tk}`));
      } catch {}
    }
  }

  if (cloudData.schoolInfo && typeof cloudData.schoolInfo === 'object') {
    safeSet('edu_school_info_v1', cloudData.schoolInfo);
    termKeys.forEach(tk => safeSet(`edu_term_school_info_${tk}`, cloudData.schoolInfo));
  }

  if (Array.isArray(cloudData.availableYears) && cloudData.availableYears.length > 0) {
    safeSet('edu_available_years', cloudData.availableYears);
  }

  if (cloudData.lockedYears && typeof cloudData.lockedYears === 'object') {
    safeSet('edu_locked_years', cloudData.lockedYears);
  }

  const updatedTime = cloudData.lastUpdatedText
    || (cloudData.lastUpdated?.toDate ? cloudData.lastUpdated.toDate().toLocaleString('vi-VN') : undefined)
    || (cloudData.updatedAt ? new Date(cloudData.updatedAt).toLocaleString('vi-VN') : undefined);
  if (updatedTime) {
    safeSet('edu_last_cloud_synced_at', updatedTime);
  }
}

/**
 * Ghi toàn bộ dữ liệu (GV, Lớp, Phân công, Ràng buộc xếp lịch, TKB) lên Firestore
 * Ghi chính xác vào document: "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"
 */
export async function pushSchoolDataToCloud(payload: {
  teachers: any[];
  classes: any[];
  subjects?: any[];
  subjectsConfig?: any[];
  departments?: any[];
  assignments?: any;
  schedules?: any;
  timetableData?: any;
  schoolInfo?: any;
  classSubjectPeriods?: any;
  subjectDistribution?: any;
  curriculumRules?: any;
  classThreeConsecutivePeriods?: any;
  classShifts?: any;
  sessionMode?: string;
  afternoonPeriodsCount?: number;
  lockedSlots?: any;
  timetableLockedSlots?: any;
  customFixedSlots?: any[];
  teacherConstraints?: any;
  advancedConstraints?: any;
  availableYears?: string[];
  lockedYears?: Record<string, boolean>;
  academicYear?: string;
  semester?: string;
  termKey?: string;
  fullSync?: boolean;
  allowClearTimetable?: boolean;
}): Promise<{ success: boolean; message: string; timestamp: string }> {
  const formattedTime = new Date().toLocaleString('vi-VN');
  try {
    const localSnapshot = collectLocalSchoolSnapshot(payload.termKey);

    // Đảm bảo đóng gói đầy đủ: homeroomAssignments và subjectAssignments
    let homeroomAssignments = payload.assignments?.homeroomAssignments || localSnapshot.assignments?.homeroomAssignments || {};
    let subjectAssignments = payload.assignments?.subjectAssignments || {};

    // Nếu subjectAssignments bị rỗng trong payload, tra cứu ngay từ localSnapshot
    if (!subjectAssignments || Object.keys(subjectAssignments).length === 0) {
      if (localSnapshot.assignments?.subjectAssignments && Object.keys(localSnapshot.assignments.subjectAssignments).length > 0) {
        subjectAssignments = localSnapshot.assignments.subjectAssignments;
      }
    }

    const NEW_SCHOOL_LOGO_ID = 'logo_nbk_an_giang_official_2026';
    const NEW_SCHOOL_LOGO_URL = '/logo_nbk.svg?v=3.0';
    const NEW_SCHOOL_LOGO_TYPE = 'svg_vector_official';

    const mergedSchoolInfo = payload.schoolInfo || localSnapshot.schoolInfo || {};
    const schoolInfoToSave = {
      schoolName: mergedSchoolInfo?.schoolName || DEFAULT_SCHOOL_NAME,
      departmentName: mergedSchoolInfo?.departmentName || DEFAULT_DEPARTMENT_NAME,
      schoolId: TARGET_SCHOOL_ID,
      logoId: NEW_SCHOOL_LOGO_ID,
      logoUrl: NEW_SCHOOL_LOGO_URL,
      logoType: NEW_SCHOOL_LOGO_TYPE,
      address: 'Hoa Long 3, TT. An Châu, Châu Thành, An Giang',
      updatedAt: new Date().toISOString(),
      ...mergedSchoolInfo
    };
    schoolInfoToSave.logoId = NEW_SCHOOL_LOGO_ID;
    schoolInfoToSave.logoUrl = NEW_SCHOOL_LOGO_URL;
    schoolInfoToSave.logoType = NEW_SCHOOL_LOGO_TYPE;

    const resolvedSubjects = payload.subjects || payload.subjectsConfig || localSnapshot.subjects || [];
    const resolvedDepartments = payload.departments !== undefined ? payload.departments : localSnapshot.departments;
    const rawPeriods = payload.classSubjectPeriods !== undefined ? payload.classSubjectPeriods : localSnapshot.classSubjectPeriods;
    const sanitizedClassSubjectPeriods = rawPeriods ? sanitizeClassSubjectPeriods(rawPeriods) : undefined;
    const resolvedThreeConsec = payload.classThreeConsecutivePeriods !== undefined ? payload.classThreeConsecutivePeriods : localSnapshot.classThreeConsecutivePeriods;
    const resolvedShifts = payload.classShifts !== undefined ? payload.classShifts : localSnapshot.classShifts;
    const resolvedSessionMode = payload.sessionMode !== undefined ? payload.sessionMode : localSnapshot.sessionMode;
    const resolvedAfternoonCount = payload.afternoonPeriodsCount !== undefined ? payload.afternoonPeriodsCount : localSnapshot.afternoonPeriodsCount;
    const resolvedLockedSlots = payload.lockedSlots ?? payload.timetableLockedSlots ?? localSnapshot.lockedSlots;
    const resolvedCustomFixedSlots = payload.customFixedSlots !== undefined ? payload.customFixedSlots : localSnapshot.customFixedSlots;
    const resolvedTeacherConstraints = payload.teacherConstraints !== undefined ? payload.teacherConstraints : localSnapshot.teacherConstraints;
    const resolvedAdvancedConstraints = payload.advancedConstraints !== undefined ? payload.advancedConstraints : localSnapshot.advancedConstraints;
    const resolvedAvailableYears = payload.availableYears !== undefined ? payload.availableYears : localSnapshot.availableYears;
    const resolvedLockedYears = payload.lockedYears !== undefined ? payload.lockedYears : localSnapshot.lockedYears;

    // Tránh ghi đè `null` lên TKB đã lưu khi chỉ thực hiện đồng bộ một phần (như lưu phân công)
    let resolvedSchedule: any = payload.timetableData !== undefined ? payload.timetableData : payload.schedules;
    if (resolvedSchedule === undefined) {
      resolvedSchedule = localSnapshot.timetableData;
    }
    const shouldIncludeSchedule = resolvedSchedule !== undefined && (resolvedSchedule !== null || payload.allowClearTimetable === true || payload.fullSync === true);

    const dataToSave: Record<string, any> = {
      termKey: TARGET_TERM_KEY,
      activeTermKey: payload.termKey || localSnapshot.termKey,
      academicYear: payload.academicYear || localSnapshot.academicYear || '2026 – 2027',
      semester: payload.semester || localSnapshot.semester || 'Học kỳ I',
      teachers: (payload.teachers && payload.teachers.length > 0) ? payload.teachers : (localSnapshot.teachers || []),
      classes: (payload.classes && payload.classes.length > 0) ? payload.classes : (localSnapshot.classes || []),
      subjects: resolvedSubjects,
      subjectsConfig: resolvedSubjects,
      assignments: {
        homeroomAssignments: { ...homeroomAssignments },
        subjectAssignments: { ...subjectAssignments }
      },
      schoolInfo: schoolInfoToSave,
      lastUpdated: serverTimestamp(),
      lastUpdatedText: formattedTime,
      updatedAt: new Date().toISOString()
    };

    if (resolvedDepartments !== undefined) dataToSave.departments = resolvedDepartments;
    if (sanitizedClassSubjectPeriods !== undefined) dataToSave.classSubjectPeriods = sanitizedClassSubjectPeriods;
    if (payload.subjectDistribution !== undefined) dataToSave.subjectDistribution = payload.subjectDistribution;
    if (payload.curriculumRules !== undefined) dataToSave.curriculumRules = payload.curriculumRules;
    if (resolvedThreeConsec !== undefined) dataToSave.classThreeConsecutivePeriods = resolvedThreeConsec;
    if (resolvedShifts !== undefined) dataToSave.classShifts = resolvedShifts;
    if (resolvedSessionMode !== undefined) dataToSave.sessionMode = resolvedSessionMode;
    if (resolvedAfternoonCount !== undefined) dataToSave.afternoonPeriodsCount = resolvedAfternoonCount;
    if (resolvedLockedSlots !== undefined) {
      dataToSave.lockedSlots = resolvedLockedSlots;
      dataToSave.timetableLockedSlots = resolvedLockedSlots;
    }
    if (resolvedCustomFixedSlots !== undefined) dataToSave.customFixedSlots = resolvedCustomFixedSlots;
    if (resolvedTeacherConstraints !== undefined) dataToSave.teacherConstraints = resolvedTeacherConstraints;
    if (resolvedAdvancedConstraints !== undefined) dataToSave.advancedConstraints = resolvedAdvancedConstraints;
    if (resolvedAvailableYears !== undefined) dataToSave.availableYears = resolvedAvailableYears;
    if (resolvedLockedYears !== undefined) dataToSave.lockedYears = resolvedLockedYears;

    if (shouldIncludeSchedule) {
      dataToSave.timetableData = resolvedSchedule ?? null;
    }

    const cleanedData = removeUndefinedFields(dataToSave);
    // Loại bỏ bản sao dư thừa trước khi ghi lên Firestore (deserializeFirestoreTermData sẽ tự khôi phục alias khi đọc)
    const canonicalDocData: Record<string, any> = { ...cleanedData };
    delete canonicalDocData.schedules;
    delete canonicalDocData.subjectsConfig;
    delete canonicalDocData.timetableLockedSlots;

    // Tuần tự hóa các trường lớn/lồng nhau (TKB, khóa tiết, phân công, GV, lớp...) thành JSON string trước khi ghi setDoc
    const serializedForFirestore = serializeForFirestoreDoc(canonicalDocData);

    const finalBytes = getUtf8ByteSize(serializedForFirestore);
    if (finalBytes > 1_020_000) {
      return {
        success: false,
        message: `Dữ liệu vượt quá giới hạn 1MB của Firestore (${Math.round(finalBytes / 1024)} KB). Vui lòng kiểm tra dữ liệu trùng lặp.`,
        timestamp: formattedTime
      };
    }

    if (payload.fullSync) {
      // Ghi đè toàn bộ document (không merge) để dọn sạch hoàn toàn các field Object/Array lồng nhau cũ (>40k index entries) trên Cloud
      await setDoc(TARGET_TERM_DOC_REF, serializedForFirestore);
      await setDoc(SCHOOL_DOC_REF, serializedForFirestore);
    } else {
      const mergePayload = {
        ...serializedForFirestore,
        schedules: deleteField(),
        subjectsConfig: deleteField(),
        timetableLockedSlots: deleteField()
      };
      await setDoc(TARGET_TERM_DOC_REF, mergePayload, { merge: true });
      await setDoc(SCHOOL_DOC_REF, mergePayload, { merge: true });
    }

    // 3. Cập nhật parent school document "schools/thpt-nguyen-binh-khiem"
    await setDoc(PARENT_SCHOOL_DOC_REF, serializeForFirestoreDoc({
      id: TARGET_SCHOOL_ID,
      name: schoolInfoToSave.schoolName,
      departmentName: schoolInfoToSave.departmentName,
      logoId: NEW_SCHOOL_LOGO_ID,
      logoUrl: NEW_SCHOOL_LOGO_URL,
      logoType: NEW_SCHOOL_LOGO_TYPE,
      currentAcademicYear: dataToSave.academicYear,
      currentSemester: dataToSave.semester,
      availableYears: resolvedAvailableYears,
      lockedYears: resolvedLockedYears,
      schoolInfo: schoolInfoToSave,
      updatedAt: new Date().toISOString()
    }), { merge: true });

    const subCount = Object.values(subjectAssignments).reduce(
      (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
    );
    const fixedCount = Array.isArray(resolvedCustomFixedSlots) ? resolvedCustomFixedSlots.length : 0;

    // Cập nhật bộ nhớ đệm in-memory (lưu dạng Object đã giải nén + alias để UI & lazy reader dùng trực tiếp)
    const cacheCopy = deserializeFirestoreTermData(serializedForFirestore);
    setCachedTermData(TARGET_TERM_KEY, cacheCopy);

    return {
      success: true,
      message: `Đã lưu thành công dữ liệu (${dataToSave.teachers.length} GV, ${dataToSave.classes.length} Lớp, ${subCount} phân công, ${fixedCount} tiết cố định & đầy đủ ràng buộc/TKB) lên Cloud Firestore lúc ${formattedTime}!`,
      timestamp: formattedTime
    };
  } catch (error: any) {
    console.error('[Firestore] pushSchoolDataToCloud error:', error?.message || error);
    return {
      success: false,
      message: 'Lỗi khi lưu lên Cloud Firestore: ' + (error.message || 'Không thể kết nối'),
      timestamp: formattedTime
    };
  }
}

/**
 * BỘ NHỚ ĐỆM TẠM TRONG PHIÊN LÀM VIỆC (In-Memory Cache):
 * Tránh gửi trùng lặp request lên Firestore nếu dữ liệu đã được tải một lần.
 */
interface CacheEntry {
  data: any;
  cachedAt: number;
}
const termMemoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

export function getCachedTermData(key: string): any | null {
  const entry = termMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    termMemoryCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedTermData(key: string, data: any): void {
  if (!key || !data) return;
  termMemoryCache.set(key, { data, cachedAt: Date.now() });
}

export function invalidateTermCache(key?: string): void {
  if (key) {
    termMemoryCache.delete(key);
  } else {
    termMemoryCache.clear();
  }
}

/**
 * Tải toàn bộ dữ liệu từ document chuẩn "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1" trên Firestore về
 * Có tích hợp bộ nhớ đệm in-memory (In-memory caching) chống trùng lặp request
 */
export async function pullSchoolDataFromCloud(forceRefresh = false): Promise<{
  success: boolean;
  data?: any;
  message: string;
  fromCache?: boolean;
}> {
  try {
    // 1. Kiểm tra bộ nhớ đệm tạm trong phiên làm việc nếu không yêu cầu ép buộc làm mới
    if (forceRefresh) {
      invalidateTermCache(TARGET_TERM_KEY);
    } else {
      const cached = getCachedTermData(TARGET_TERM_KEY);
      if (cached) {
        return {
          success: true,
          data: cached,
          message: 'Dữ liệu nạp tức thì từ bộ nhớ đệm phiên làm việc (In-memory cache).',
          fromCache: true
        };
      }
    }

    // 2. Ưu tiên đọc document chuẩn: "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"
    let snap = await getDoc(TARGET_TERM_DOC_REF);
    let sourceDoc = 'schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1';

    // 3. Fallback nếu term doc chưa có dữ liệu, đọc từ document chung "eduschedule_data/thpt_nguyen_binh_khiem"
    if (!snap.exists()) {
      snap = await getDoc(SCHOOL_DOC_REF);
      sourceDoc = 'eduschedule_data/thpt_nguyen_binh_khiem';
    }

    if (snap.exists()) {
      const data = deserializeFirestoreTermData(snap.data());
      const updatedTime = data.lastUpdatedText || (data.lastUpdated?.toDate ? data.lastUpdated.toDate().toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN'));
      
      // Lưu vào bộ nhớ đệm tạm
      setCachedTermData(TARGET_TERM_KEY, data);

      return {
        success: true,
        data,
        message: `Đã nạp dữ liệu từ Cloud Firestore (${sourceDoc}) thành công (cập nhật lúc ${updatedTime})!`,
        fromCache: false
      };
    } else {
      return {
        success: false,
        message: 'Chưa tìm thấy dữ liệu trên Cloud Firestore.'
      };
    }
  } catch (error: any) {
    console.error('[Firestore] pullSchoolDataFromCloud error:', error?.message || error);
    return {
      success: false,
      message: 'Lỗi tải từ Cloud Firestore: ' + (error.message || 'Không thể kết nối')
    };
  }
}

/**
 * TẢI LƯỜI / BÓC TÁCH THEO NHU CẦU (Lazy Loading / On-demand Fetching):
 * Chỉ trích xuất hoặc nạp số tiết của ĐÚNG LỚP người dùng đang chọn (ví dụ 11A1)
 */
export function getLazyClassSubjectPeriods(
  classId: string, 
  allPeriodsMap?: Record<string, any>
): Record<string, any> {
  const cleanId = classId.replace(/^c_/, '');
  const prefixedId = 'c_' + cleanId;
  const cacheKey = `class_periods_${classId}`;

  // Kiểm tra cache lớp trước
  const cached = getCachedTermData(cacheKey);
  if (cached) return cached;

  const source = allPeriodsMap || getCachedTermData(TARGET_TERM_KEY)?.classSubjectPeriods || {};
  const classData = source[classId] || source[cleanId] || source[prefixedId] || {};

  setCachedTermData(cacheKey, classData);
  return classData;
}

/**
 * Lắng nghe thay đổi thời gian thực từ Firestore document chuẩn
 */
export function subscribeToSchoolDoc(
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    TARGET_TERM_DOC_REF,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(deserializeFirestoreTermData(snapshot.data()));
      } else {
        // Fallback đọc từ SCHOOL_DOC_REF nếu TARGET_TERM_DOC_REF chưa có
        getDoc(SCHOOL_DOC_REF).then(altSnap => {
          if (altSnap.exists()) {
            onData(deserializeFirestoreTermData(altSnap.data()));
          } else {
            onData(null);
          }
        }).catch(() => onData(null));
      }
    },
    (error) => {
      console.warn('[Firestore] Error subscribing to TARGET_TERM_DOC_REF:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Creates a URL-friendly, lowercase slug identifier for a school name
 */
export function slugifySchoolId(name: string): string {
  if (!name || !name.trim()) return DEFAULT_SCHOOL_ID;
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_SCHOOL_ID;
}

/**
 * Real-time listener for school metadata & global settings
 */
export function subscribeToSchool(
  schoolId: string, 
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const schoolRef = doc(db, 'schools', schoolId);
  return onSnapshot(
    schoolRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(deserializeFirestoreTermData(snapshot.data()));
      } else {
        onData(null);
      }
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to school ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Real-time listener for school accounts list
 */
export function subscribeToAccounts(
  schoolId: string,
  onData: (accounts: UserAccount[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const accountsCol = collection(db, 'schools', schoolId, 'accounts');
  return onSnapshot(
    accountsCol,
    (snapshot) => {
      const accounts: UserAccount[] = [];
      snapshot.forEach((d) => {
        accounts.push({ id: d.id, ...d.data() } as UserAccount);
      });
      onData(accounts);
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to accounts for ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Real-time listener for an academic term's timetable and assignment data
 */
export function subscribeToTerm(
  schoolId: string,
  termKey: string,
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const termRef = doc(db, 'schools', schoolId, 'terms', termKey);
  return onSnapshot(
    termRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(deserializeFirestoreTermData(snapshot.data()));
      } else {
        onData(null);
      }
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to term ${termKey} for ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Fetch all schools currently available in Firestore for multi-tenant switching
 */
export async function fetchAvailableSchools(): Promise<SchoolTenant[]> {
  try {
    const colRef = collection(db, 'schools');
    const snap = await getDocs(colRef);
    const schools: SchoolTenant[] = [];
    snap.forEach((d) => {
      const data = d.data();
      schools.push({
        id: d.id,
        name: data.name || data.schoolName || d.id,
        departmentName: data.departmentName || '',
        updatedAt: data.updatedAt
      });
    });
    return schools;
  } catch (err) {
    console.warn('[Firestore] Error fetching available schools:', err);
    return [];
  }
}

/**
 * Save / Update school tenant metadata in Firestore
 */
export async function saveSchoolToFirestore(
  schoolId: string, 
  schoolData: Record<string, any>, 
  author?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const schoolRef = doc(db, 'schools', schoolId);
    const payload = serializeForFirestoreDoc({
      ...schoolData,
      id: schoolId,
      updatedAt: new Date().toISOString(),
      lastUpdatedBy: author || 'Admin'
    });
    await setDoc(schoolRef, payload, { merge: true });
    return { success: true, message: 'Đã lưu thông tin trường học lên Cloud Firestore!' };
  } catch (error: any) {
    console.error('[Firestore] Error saving school:', error);
    return { success: false, message: error.message || 'Lỗi lưu trường học lên Firestore.' };
  }
}

/**
 * Save user account to school's accounts subcollection
 */
export async function saveAccountToFirestore(
  schoolId: string,
  account: UserAccount
): Promise<{ success: boolean; message: string }> {
  try {
    const accRef = doc(db, 'schools', schoolId, 'accounts', account.id);
    await setDoc(accRef, removeUndefinedFields({
      ...account,
      updatedAt: new Date().toISOString()
    }), { merge: true });
    return { success: true, message: `Đã lưu tài khoản ${account.displayName} lên Cloud Firestore!` };
  } catch (error: any) {
    console.error('[Firestore] Error saving account:', error);
    return { success: false, message: error.message || 'Lỗi lưu tài khoản lên Firestore.' };
  }
}

/**
 * Delete account from school's accounts subcollection
 */
export async function deleteAccountFromFirestore(
  schoolId: string,
  accountId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const accRef = doc(db, 'schools', schoolId, 'accounts', accountId);
    await deleteDoc(accRef);
    return { success: true, message: 'Đã xóa tài khoản trên Cloud Firestore!' };
  } catch (error: any) {
    console.error('[Firestore] Error deleting account:', error);
    return { success: false, message: error.message || 'Lỗi xóa tài khoản trên Firestore.' };
  }
}

/**
 * Save entire term data (teachers, classes, assignments, timetable) to Firestore
 */
export async function saveTermToFirestore(
  schoolId: string,
  termKey: string,
  termPayload: {
    academicYear: string;
    semester: string;
    teachers?: any[];
    classes?: any[];
    subjectsConfig?: any[];
    subjects?: any[];
    departments?: any[];
    classSubjectPeriods?: any;
    subjectDistribution?: any;
    curriculumRules?: any;
    classThreeConsecutivePeriods?: any;
    classShifts?: any;
    assignments?: any;
    timetableData?: any;
    schedules?: any;
    lockedSlots?: any;
    timetableLockedSlots?: any;
    customFixedSlots?: any[];
    teacherConstraints?: any;
    advancedConstraints?: any;
    sessionMode?: string;
    afternoonPeriodsCount?: number;
    schoolInfo?: any;
    availableYears?: string[];
    lockedYears?: Record<string, boolean>;
  },
  author?: string
): Promise<{ success: boolean; message: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  const formattedTime = new Date().toLocaleString('vi-VN');

  try {
    let assignmentsToSave = termPayload.assignments || {};
    let subAssignments = assignmentsToSave.subjectAssignments || {};
    let hrAssignments = assignmentsToSave.homeroomAssignments || {};

    if (!subAssignments || Object.keys(subAssignments).length === 0) {
      try {
        const a3 = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
        if (a3) {
          const p = JSON.parse(a3);
          if (p.subjectAssignments && Object.keys(p.subjectAssignments).length > 0) {
            subAssignments = p.subjectAssignments;
            if (!hrAssignments || Object.keys(hrAssignments).length === 0) {
              hrAssignments = p.homeroomAssignments || {};
            }
          }
        }
      } catch {}
    }

    assignmentsToSave = {
      homeroomAssignments: { ...hrAssignments },
      subjectAssignments: { ...subAssignments }
    };

    const sanitizedClassSubjectPeriods = sanitizeClassSubjectPeriods(termPayload.classSubjectPeriods);
    const resolvedSchedule = termPayload.timetableData !== undefined ? termPayload.timetableData : termPayload.schedules;
    const resolvedLocked = termPayload.lockedSlots ?? termPayload.timetableLockedSlots;
    const resolvedSubjects = termPayload.subjects || termPayload.subjectsConfig;

    const termRef = doc(db, 'schools', schoolId, 'terms', termKey);
    const completePayload: Record<string, any> = {
      termKey,
      ...termPayload,
      subjects: resolvedSubjects,
      classSubjectPeriods: sanitizedClassSubjectPeriods,
      assignments: assignmentsToSave,
      timetableData: resolvedSchedule ?? null,
      lockedSlots: resolvedLocked,
      lastUpdatedText: formattedTime,
      updatedAt: timestamp,
      lastUpdatedBy: author || 'Admin'
    };
    delete completePayload.schedules;
    delete completePayload.subjectsConfig;
    delete completePayload.timetableLockedSlots;

    const cleanedPayload = removeUndefinedFields(completePayload);

    // Tuần tự hóa toàn bộ các trường lớn/lồng nhau thành JSON string để không vượt quá 40.000 index entries của Firestore
    const serializedPayload = serializeForFirestoreDoc(cleanedPayload);

    // Ghi đè toàn bộ term document (không merge) để xóa sạch các field Object/Array lồng nhau cũ nếu có
    await setDoc(termRef, serializedPayload);

    // Cập nhật song song cả TARGET_TERM_DOC_REF nếu schoolId hoặc termKey tương ứng
    if (termKey !== TARGET_TERM_KEY || schoolId !== TARGET_SCHOOL_ID) {
      try {
        await setDoc(TARGET_TERM_DOC_REF, serializedPayload);
      } catch {}
    }

    // Also update parent school document's last activity
    const schoolRef = doc(db, 'schools', schoolId);
    await setDoc(schoolRef, serializeForFirestoreDoc({
      id: schoolId,
      name: termPayload.schoolInfo?.schoolName || DEFAULT_SCHOOL_NAME,
      departmentName: termPayload.schoolInfo?.departmentName || DEFAULT_DEPARTMENT_NAME,
      logoId: 'logo_nbk_an_giang_official_2026',
      logoUrl: '/logo_nbk.svg?v=3.0',
      logoType: 'svg_vector_official',
      currentAcademicYear: termPayload.academicYear,
      currentSemester: termPayload.semester,
      availableYears: termPayload.availableYears,
      lockedYears: termPayload.lockedYears,
      schoolInfo: termPayload.schoolInfo,
      updatedAt: timestamp,
      lastUpdatedBy: author || 'Admin'
    }), { merge: true });

    return { 
      success: true, 
      message: `Đồng bộ lên Cloud Firestore (${schoolId}) thành công lúc ${formattedTime}!`,
      timestamp: formattedTime
    };
  } catch (error: any) {
    console.error('[Firestore] Error saving term:', error);
    return { 
      success: false, 
      message: 'Lỗi ghi dữ liệu lên Cloud Firestore: ' + (error.message || 'Không thể kết nối'),
      timestamp: formattedTime
    };
  }
}

/**
 * Tối ưu nén ảnh về kích thước chuẩn ~200x200px Base64
 * Giúp nhẹ dữ liệu, tải tức thì và không làm phình document Firestore
 */
export async function resizeImageToBase64(file: File, maxDim = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/png", 0.9);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Không thể tải file ảnh để nén"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Không thể đọc file ảnh"));
    reader.readAsDataURL(file);
  });
}

/**
 * Đồng bộ Logo thương hiệu nhà trường lên Firestore theo đúng Tenant ID
 * Path: schools/${schoolId} (cụ thể: schools/thpt-nguyen-binh-khiem)
 * Field: customLogo: base64Data, updatedAt: ISOString
 * Khi base64Data = null: khôi phục về logo gốc chuẩn mới
 */
export async function saveSchoolCustomLogo(schoolId: string, base64Data: string | null): Promise<void> {
  const targetId = schoolId || TARGET_SCHOOL_ID;
  const schoolRef = doc(db, "schools", targetId);
  const now = new Date().toISOString();

  if (base64Data) {
    await setDoc(schoolRef, {
      customLogo: base64Data,
      logoId: "custom_logo_" + Date.now(),
      logoUrl: base64Data,
      updatedAt: now
    }, { merge: true });
    try {
      localStorage.setItem("custom_school_logo", base64Data);
    } catch {}
  } else {
    // Khôi phục gốc: xóa customLogo và ghi đè logo chuẩn mới
    await setDoc(schoolRef, {
      customLogo: null,
      logoId: "logo_nbk_an_giang_official_2026",
      logoUrl: "/logo_nbk.svg?v=3.0",
      logoType: "svg_vector_official",
      updatedAt: now
    }, { merge: true });
    try {
      localStorage.removeItem("custom_school_logo");
    } catch {}
  }

  // Phát tín hiệu đồng bộ tức thì cho toàn bộ các component đang mở
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("school_logo_updated", { detail: base64Data }));
  }
}
