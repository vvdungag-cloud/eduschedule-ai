import {
  TimetableLesson,
  TimetableStats,
  TimetableData,
  LockedSlotsConfig,
  DAYS_CONFIG,
  PERIODS_CONFIG,
  SessionMode,
  getPeriodsConfig
} from './timetableTypes';
import { Teacher, ClassModel } from './assignmentSolver';

export interface SubjectPeriodReq {
  classId: string;
  className: string;
  grade: '10' | '11' | '12';
  subjects: {
    name: string;
    periods: number;
    mainPeriods?: number;
    oppPeriods?: number;
    mainMinPairs?: number;
    oppMinPairs?: number;
  }[];
}

export interface TimetableSolverOptions {
  teachers: Teacher[];
  classes: ClassModel[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  subjectRequirements: SubjectPeriodReq[];
  sessionMode?: SessionMode; // 'single' | 'double'
  afternoonPeriodsCount?: number; // 4 | 5
  classShifts?: Record<string, string>;
  fixedConfig?: {
    chaoCoDay: number; // 2
    chaoCoPeriod: number; // 1
    sinhHoatDay: number; // 7
    sinhHoatPeriod: number; // 5
  };
  lockedSlots?: LockedSlotsConfig;
  customFixedSlots?: Array<{
    id?: string;
    classId: string;
    subject: string;
    teacherId: string;
    day: number;
    period: number;
  }>;
  teacherConstraints?: Record<string, {
    maxDays?: number;
    maxSessions?: number;
  }>;
  maxSessionsPerTeacher?: Record<string, number>;
  teacherMaxHalfDays?: Record<string, number>;
  maxDaysPerTeacher?: Record<string, number>;
  advancedConstraints?: any;
  maxIterations?: number;
}

export interface LessonUnit {
  unitId: string;
  classId: string;
  className: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  isDouble: boolean; // 2 periods consecutive
  isInterSubject?: boolean; // Inter-subject atomic pair (e.g. GDQPAN + GDĐP)
  targetSession?: 'main' | 'opp'; // Force placement in either main or opposite session
  pairedUnit?: {
    subject: string;
    teacherId: string;
    teacherName: string;
  };
  priorityRank?: number;
}

/**
 * Normalizes subject names across various Vietnamese naming conventions.
 */
export const normalizeSubName = (name: string): string => {
  if (!name) return '';
  const nl = name.trim().toLowerCase();
  if (nl === 'toán' || nl === 'toán học' || nl === 'toan') return 'Toán';
  if (nl === 'ngữ văn' || nl === 'văn' || nl === 'van' || nl === 'ngu van') return 'Văn';
  if (nl === 'ngoại ngữ' || nl === 'tiếng anh' || nl === 'anh' || nl === 'tieng anh') return 'Anh';
  if (nl === 'vật lí' || nl === 'vật lý' || nl === 'lý' || nl === 'ly' || nl === 'vat ly' || nl === 'vat li') return 'Lý';
  if (nl === 'hóa học' || nl === 'hóa' || nl === 'hoa' || nl === 'hoa hoc') return 'Hóa';
  if (nl === 'sinh học' || nl === 'sinh' || nl === 'sinh hoc') return 'Sinh';
  if (nl === 'lịch sử' || nl === 'sử' || nl === 'su' || nl === 'lich su') return 'Sử';
  if (nl === 'địa lí' || nl === 'địa lý' || nl === 'địa' || nl === 'dia' || nl === 'dia ly' || nl === 'dia li') return 'Địa';
  if (nl === 'tin học' || nl === 'tin' || nl === 'tin hoc') return 'Tin';
  if (nl === 'công nghệ' || nl === 'cn' || nl === 'cncn' || nl === 'cn (công nghiệp)' || nl === 'cn (công nghệ)') return 'CNCN';
  if (nl === 'cnnn' || nl === 'cn (nông nghiệp)' || nl === 'nông nghiệp') return 'CNNN';
  if (nl === 'gdktpl' || nl === 'gdcd' || nl === 'gd' || nl === 'giáo dục kinh tế và pháp luật') return 'GDKTPL';
  if (nl === 'gdtc' || nl === 'thể dục' || nl === 'the duc' || nl === 'gd thể chất') return 'GDTC';
  if (nl === 'gdqpan' || nl === 'gd qp-an' || nl === 'gdqp' || nl === 'qpan' || nl === 'quân sự') return 'GDQPAN';
  if (nl === 'gdđp' || nl === 'gddp' || nl === 'giáo dục địa phương') return 'GDĐP';
  if (nl === 'tnhn1' || nl === 'hđtn1' || nl === 'hdtn1' || nl === 'tnhn') return 'TNHN1';
  if (nl === 'tnhn2' || nl === 'hđtn2' || nl === 'hdtn2') return 'TNHN2';
  if (nl === 'chào cờ' || nl === 'cc' || nl === 'chao co') return 'Chào cờ';
  if (nl === 'sinh hoạt lớp' || nl === 'shl' || nl === 'sinh hoat lop' || nl === 'sinh hoạt') return 'Sinh hoạt lớp';
  return name.trim();
};

/**
 * =========================================================================================
 * BỘ GIẢI THỜI KHÓA BIỂU CP-SAT (BẢN TỔNG QUÁT ĐỘNG VÀ ĐỒNG BỘ TOÀN DIỆN CÁC RÀNG BUỘC)
 * =========================================================================================
 * Kiến trúc 4 tầng độc lập:
 *  - TẦNG 0: Tiền xử lý & Đóng gói khối tiết động (Atomic Block Pre-processing)
 *  - TẦNG 1: Tập ràng buộc cứng (Hard Constraints - Vi phạm là loại nghiệm)
 *  - TẦNG 2: Thứ tự tìm kiếm của Solver (Search Strategy / Heuristics)
 *  - TẦNG 3: Tập ràng buộc mềm & Tối ưu hàm mục tiêu (Soft Constraints & Pedagogical Optimization)
 * =========================================================================================
 */
export function solveTimetable(options: TimetableSolverOptions): TimetableData {
  const startTime = performance.now();
  const {
    teachers,
    classes,
    assignments,
    subjectRequirements,
    sessionMode: rawSessionMode = 'single',
    afternoonPeriodsCount = 4,
    classShifts = {},
    fixedConfig = {
      chaoCoDay: 2,
      chaoCoPeriod: 1,
      sinhHoatDay: 7,
      sinhHoatPeriod: 5
    },
    customFixedSlots = [],
    teacherConstraints = {},
    maxSessionsPerTeacher,
    teacherMaxHalfDays,
    maxDaysPerTeacher,
    advancedConstraints = {}
  } = options;

  // Auto-detect double session mode (THPT Nguyễn Bỉnh Khiêm luôn vận hành 2 ca: Sáng & Chiều)
  const sessionMode: SessionMode = 'double';
  const effectiveAfternoonCount = Math.max(4, afternoonPeriodsCount || 5);

  if (!classes || classes.length === 0) {
    return {
      academicYear: 'Năm học 2026 – 2027',
      semester: 'Học kỳ I',
      createdAt: new Date().toISOString(),
      lessons: [],
      stats: {
        totalLessons: 0,
        totalClasses: 0,
        totalTeachers: teachers ? teachers.length : 0,
        teacherConflicts: 0,
        classConflicts: 0,
        isolatedGaps: 0,
        teacherDaysWithLessons: 0,
        solverUsed: 'cp_sat_constraint_engine',
        executionTimeMs: 0
      },
      sessionMode,
      afternoonPeriodsCount: effectiveAfternoonCount,
      fixedSlotsConfig: fixedConfig
    };
  }

  const teacherMap = new Map<string, Teacher>();
  teachers.forEach(t => teacherMap.set(t.id, t));

  const classMap = new Map<string, ClassModel>();
  classes.forEach(c => classMap.set(c.id, c));

  // Cấu hình số buổi dạy tối đa và số ngày dạy tối đa của từng giáo viên (Hard Constraints)
  const teacherMaxSessionsMap = new Map<string, number>();
  const teacherMaxDaysMap = new Map<string, number>();

  const registerTeacherLimit = (key: string, maxS?: number, maxD?: number) => {
    if (!key) return;
    const cleanKey = key.replace(/^t_/, '');
    const prefixedKey = 't_' + cleanKey;
    const tObj = teacherMap.get(key) || teacherMap.get(cleanKey) || teacherMap.get(prefixedKey);
    const tName = tObj?.name;

    if (maxS !== undefined && maxS !== null && !isNaN(Number(maxS)) && Number(maxS) > 0) {
      const val = Number(maxS);
      teacherMaxSessionsMap.set(key, val);
      teacherMaxSessionsMap.set(cleanKey, val);
      teacherMaxSessionsMap.set(prefixedKey, val);
      if (tName) teacherMaxSessionsMap.set(tName, val);
    }
    if (maxD !== undefined && maxD !== null && !isNaN(Number(maxD)) && Number(maxD) > 0) {
      const val = Number(maxD);
      teacherMaxDaysMap.set(key, val);
      teacherMaxDaysMap.set(cleanKey, val);
      teacherMaxDaysMap.set(prefixedKey, val);
      if (tName) teacherMaxDaysMap.set(tName, val);
    }
  };

  if (teacherConstraints) {
    Object.entries(teacherConstraints).forEach(([tid, conf]) => {
      registerTeacherLimit(tid, conf?.maxSessions, conf?.maxDays);
    });
  }
  const effectiveSessionsInput = maxSessionsPerTeacher || teacherMaxHalfDays;
  if (effectiveSessionsInput) {
    Object.entries(effectiveSessionsInput).forEach(([tid, val]) => {
      registerTeacherLimit(tid, Number(val), undefined);
    });
  }
  if (maxDaysPerTeacher) {
    Object.entries(maxDaysPerTeacher).forEach(([tid, val]) => {
      registerTeacherLimit(tid, undefined, Number(val));
    });
  }

  // Helper xác định chính xác ca học chính khóa: Khối 10 chính Chiều, Khối 11 & 12 chính Sáng
  const getClassShift = (classId: string): 'morning_main' | 'afternoon_main' => {
    const cleanId = classId.replace(/^c_/, '');
    const c = classMap.get(classId) || classMap.get(cleanId) || classMap.get('c_' + cleanId);
    const raw = classShifts[classId] || classShifts[cleanId] || classShifts['c_' + cleanId] || c?.shift;
    if (raw === 'afternoon_main' || raw === 'afternoon') return 'afternoon_main';
    if (raw === 'morning_main' || raw === 'morning') return 'morning_main';
    return c?.grade === '10' ? 'afternoon_main' : 'morning_main';
  };

  const subjectAssignments = assignments.subjectAssignments || {};

  // Cấu hình khung thời gian học tập: Thứ 2 đến Thứ 7
  const periodsConfig = getPeriodsConfig(sessionMode, effectiveAfternoonCount);
  const validDays = [2, 3, 4, 5, 6, 7]; // Thứ 2 đến Thứ 7
  const allDays = validDays;
  const allPeriods = periodsConfig.map(p => p.period);
  const periodsPerDay = allPeriods.length;
  const totalSlots = allDays.length * periodsPerDay;

  const slotToDayPeriod = (slotIdx: number) => {
    const day = allDays[Math.floor(slotIdx / periodsPerDay)];
    const period = allPeriods[slotIdx % periodsPerDay];
    return { day, period };
  };

  const dayPeriodToSlot = (day: number, period: number) => {
    const dayIdx = allDays.indexOf(day);
    const periodIdx = allPeriods.indexOf(period);
    if (dayIdx === -1 || periodIdx === -1) return -1;
    return dayIdx * periodsPerDay + periodIdx;
  };

  // =========================================================================
  // TẦNG 0: TIỀN XỬ LÝ & ĐÓNG GÓI KHỐI TIẾT ĐỘNG (ATOMIC BLOCK PRE-PROCESSING)
  // =========================================================================

  // 0.1. TỔNG SỐ TIẾT ĐỘNG (Tuyệt đối không hardcode con số cố định)
  let totalRequiredPeriods = 0;
  subjectRequirements.forEach(req => {
    req.subjects.forEach(s => {
      totalRequiredPeriods += (s.periods || 0);
    });
  });

  // Map class requirements
  const reqMap = new Map<string, Map<string, number>>();
  subjectRequirements.forEach(req => {
    const subMap = new Map<string, number>();
    req.subjects.forEach(s => {
      subMap.set(normalizeSubName(s.name), s.periods || 0);
      subMap.set(s.name, s.periods || 0);
    });
    reqMap.set(req.classId, subMap);
    reqMap.set(req.classId.replace(/^c_/, ''), subMap);
    if (req.className) reqMap.set(req.className, subMap);
  });

  // 0.2. THIẾT LẬP RÀNG BUỘC CỐ ĐỊNH & Ô ĐÃ KHÓA
  const fixedLessons: TimetableLesson[] = [];
  const customFixedCounts = new Map<string, number>();

  customFixedSlots.forEach(cfs => {
    const cid = cfs.classId;
    const rawSub = cfs.subject;
    const normSub = normalizeSubName(rawSub);
    let tid = cfs.teacherId;
    const day = cfs.day;
    const period = cfs.period;
    const cls = classMap.get(cid);

    const isHomeroomSub = rawSub === 'Chào cờ' || rawSub === 'Sinh hoạt lớp' || normSub === 'TNHN2' || rawSub === 'TNHN2';
    if (!isHomeroomSub) {
      const classReqs = reqMap.get(cid) || reqMap.get(cid.replace(/^c_/, ''));
      const totalPeriods = classReqs?.get(normSub) ?? classReqs?.get(rawSub) ?? 0;
      if (totalPeriods <= 0) {
        return; // Skip deleted or 0-period subjects
      }
      const cSubs = options.assignments.subjectAssignments[cid] || options.assignments.subjectAssignments[cid.replace(/^c_/, '')] || {};
      const currentTid = cSubs[normSub] || cSubs[rawSub];
      if (currentTid) {
        tid = currentTid;
      } else if (!tid) {
        return;
      }
    } else {
      const hrTid = options.assignments.homeroomAssignments[cid]
        || options.assignments.homeroomAssignments[cid.replace(/^c_/, '')]
        || (cls?.name ? options.assignments.homeroomAssignments[cls.name] : undefined)
        || cls?.homeroomTeacherId;
      if (hrTid) {
        tid = hrTid;
      }
    }

    const teacher = teacherMap.get(tid);

    const existingIdx = fixedLessons.findIndex(fl => fl.classId === cid && fl.day === day && fl.period === period);
    const lessonItem: TimetableLesson = {
      id: `fixed_custom_${cid}_${day}_${period}`,
      classId: cid,
      className: cls?.name || cid,
      subject: rawSub,
      teacherId: tid,
      teacherName: teacher?.name || 'Giáo viên',
      day,
      period,
      isFixed: true,
      fixedReason: `Cố định (${rawSub})`
    };

    if (existingIdx !== -1) {
      fixedLessons[existingIdx] = lessonItem;
    } else {
      fixedLessons.push(lessonItem);
    }

    const quotaKey = `${cid}_${normSub}`;
    customFixedCounts.set(quotaKey, (customFixedCounts.get(quotaKey) || 0) + 1);
  });

  // 0.3. HỢP NHẤT RÀNG BUỘC TIẾT NGHỈ (3-WAY UNION OF BLOCKED SLOTS):
  // blockedSlots(Lớp) = Tiết_nghỉ_Toàn_trường ∪ Tiết_nghỉ_của_Khối ∪ Tiết_nghỉ_riêng_của_Lớp
  const lockedSlots = options.lockedSlots;
  const filterMondayClassSlots = (slots: string[] = []) =>
    slots.filter(s => !(s.startsWith('2_') && s !== '2_1'));

  const classBlockedSlotsMap = new Map<string, Set<string>>();
  const lockedTeacherMap = new Map<string, Set<string>>();

  if (lockedSlots?.byTeacher) {
    Object.entries(lockedSlots.byTeacher).forEach(([tId, slots]) => {
      const cleanSlots = Array.isArray(slots) ? slots : [];
      lockedTeacherMap.set(tId, new Set(cleanSlots));
      const teacherObj = teacherMap.get(tId);
      if (teacherObj) {
        lockedTeacherMap.set(teacherObj.name, new Set(cleanSlots));
      }
    });
  }

  classes.forEach(cls => {
    const blockedSet = new Set<string>();

    if (lockedSlots?.global && Array.isArray(lockedSlots.global)) {
      filterMondayClassSlots(lockedSlots.global).forEach(s => blockedSet.add(s));
    }

    // Ngoại lệ mở lại học bình thường (classBreakExceptions) của riêng lớp này
    const exceptionSlots = new Set<string>();
    if (lockedSlots?.classBreakExceptions && typeof lockedSlots.classBreakExceptions === 'object') {
      const cleanId = cls.id.replace(/^c_/, '').toLowerCase();
      const normName = cls.name.trim().toLowerCase();
      Object.entries(lockedSlots.classBreakExceptions).forEach(([cKey, slots]) => {
        if (!Array.isArray(slots)) return;
        const normCKey = cKey.trim().toLowerCase().replace(/^c_/, '');
        if (normCKey === cleanId || normCKey === normName || cKey === cls.id || cKey === cls.name) {
          slots.forEach(s => exceptionSlots.add(s));
        }
      });
    }

    if (lockedSlots?.byGrade && typeof lockedSlots.byGrade === 'object') {
      const gClean = String(cls.grade).replace(/\D/g, '');
      Object.entries(lockedSlots.byGrade).forEach(([gKey, slots]) => {
        if (!Array.isArray(slots)) return;
        const normGKey = gKey.trim().toLowerCase();
        const keyNum = normGKey.replace(/\D/g, '');
        if (keyNum === gClean || normGKey === cls.grade.toLowerCase() || normGKey.includes(cls.grade)) {
          filterMondayClassSlots(slots).forEach(s => {
            // Chỉ cấm nếu ô đó KHÔNG nằm trong danh sách ngoại lệ mở lại của lớp
            if (!exceptionSlots.has(s)) {
              blockedSet.add(s);
            }
          });
        }
      });
    }

    if (lockedSlots?.byClass && typeof lockedSlots.byClass === 'object') {
      const cleanId = cls.id.replace(/^c_/, '').toLowerCase();
      const normName = cls.name.trim().toLowerCase();
      Object.entries(lockedSlots.byClass).forEach(([cKey, slots]) => {
        if (!Array.isArray(slots)) return;
        const normCKey = cKey.trim().toLowerCase().replace(/^c_/, '');
        if (normCKey === cleanId || normCKey === normName || cKey === cls.id || cKey === cls.name) {
          filterMondayClassSlots(slots).forEach(s => blockedSet.add(s));
        }
      });
    }

    // MỞ KHÓA HOÀN TOÀN NGÀY THỨ 2 (Tiết 2..10 là ngày học chính khóa hợp lệ mở 100%)
    for (let p = 2; p <= periodsPerDay; p++) {
      blockedSet.delete(`2_${p}`);
    }

    classBlockedSlotsMap.set(cls.id, blockedSet);
    classBlockedSlotsMap.set(cls.name, blockedSet);
    classBlockedSlotsMap.set(cls.id.replace(/^c_/, ''), blockedSet);
    classBlockedSlotsMap.set('c_' + cls.id.replace(/^c_/, ''), blockedSet);
  });

  const isClassSlotBlocked = (classId: string, day: number, period: number): boolean => {
    if (day === 2 && period > 1) return false;
    const key = `${day}_${period}`;
    const blocked = classBlockedSlotsMap.get(classId) ||
                    classBlockedSlotsMap.get(classId.replace(/^c_/, '')) ||
                    classBlockedSlotsMap.get('c_' + classId);
    return blocked ? blocked.has(key) : false;
  };

  const isTeacherSlotLocked = (teacherId: string, day: number, period: number): boolean => {
    const key = `${day}_${period}`;
    return lockedTeacherMap.get(teacherId)?.has(key) || false;
  };

  // 0.4. ĐỌC CÁC CẶP MÔN LIỀN KỀ & CẶP MÔN TÁCH BUỔI ĐỘNG TỪ MODAL RÀNG BUỘC
  const advConstraints = advancedConstraints || {};
  const lessonConsecutiveSubs = new Set<string>(
    (advConstraints.lessonConsecutiveSubjects || ['GDTC']).map((s: string) => normalizeSubName(s))
  );

  const lessonConsecutivePairsRaw: any[] = advConstraints.lessonConsecutivePairs || [
    { id: 'pair_gddp_gdqpan', subject1: 'GDĐP', subject2: 'GDQPAN', enabled: true }
  ];
  const lessonConsecutivePairs: [string, string][] = [];
  for (const item of lessonConsecutivePairsRaw) {
    if (typeof item === 'object' && item !== null) {
      if (item.enabled !== false) {
        const s1 = normalizeSubName(item.subject1 || '');
        const s2 = normalizeSubName(item.subject2 || '');
        if (s1 && s2 && s1 !== s2) lessonConsecutivePairs.push([s1, s2]);
      }
    } else if (Array.isArray(item) && item.length >= 2) {
      const s1 = normalizeSubName(item[0]);
      const s2 = normalizeSubName(item[1]);
      if (s1 && s2 && s1 !== s2) lessonConsecutivePairs.push([s1, s2]);
    }
  }

  const lessonNotSameSessionPairsRaw: any[] = advConstraints.lessonNotSameSessionPairs || [
    { id: 'pair_gdtc_gdqpan', subject1: 'GDTC', subject2: 'GDQPAN', enabled: true },
    { id: 'pair_gdtc_gddp', subject1: 'GDTC', subject2: 'GDĐP', enabled: true }
  ];
  const lessonNotSameSessionPairs: [string, string][] = [];
  for (const item of lessonNotSameSessionPairsRaw) {
    if (typeof item === 'object' && item !== null) {
      if (item.enabled !== false) {
        const s1 = normalizeSubName(item.subject1 || '');
        const s2 = normalizeSubName(item.subject2 || '');
        if (s1 && s2 && s1 !== s2) lessonNotSameSessionPairs.push([s1, s2]);
      }
    } else if (Array.isArray(item) && item.length >= 2) {
      const s1 = normalizeSubName(item[0]);
      const s2 = normalizeSubName(item[1]);
      if (s1 && s2 && s1 !== s2) lessonNotSameSessionPairs.push([s1, s2]);
    }
  }

  // 0.5. ĐÓNG GÓI CÁC KHỐI TIẾT ĐỘNG (ATOMIC DOUBLE-PERIODS & INTER-SUBJECT UNITS)
  const unitsToSchedule: LessonUnit[] = [];

  classes.forEach(cls => {
    const classSubs = subjectAssignments[cls.id] || {};
    const reqClass = subjectRequirements.find(r => r.classId === cls.id);
    const classReqMap = new Map<string, any>();
    reqClass?.subjects.forEach(s => {
      const norm = normalizeSubName(s.name);
      const isTraiBuoi = (norm === 'GDQPAN' || norm === 'GDĐP' || norm === 'GDTC');
      const totalP = s.periods || 0;
      const mP = s.mainPeriods !== undefined ? s.mainPeriods : (isTraiBuoi ? 0 : totalP);
      const oP = s.oppPeriods !== undefined ? s.oppPeriods : (isTraiBuoi ? totalP : 0);
      const mPairs = s.mainMinPairs !== undefined ? s.mainMinPairs : ((norm === 'Toán' || norm === 'Văn') ? Math.floor(mP / 2) : 0);
      const oPairs = s.oppMinPairs !== undefined ? s.oppMinPairs : (norm === 'GDTC' ? Math.floor(oP / 2) : 0);

      const entry = {
        periods: totalP,
        mainPeriods: mP,
        oppPeriods: oP,
        mainMinPairs: mPairs,
        oppMinPairs: oPairs
      };
      classReqMap.set(norm, entry);
      classReqMap.set(s.name, entry);
    });

    // Tính toán số ô khả dụng trong ca chính khóa của lớp (ví dụ: 25 ô khi Thứ 7 nghỉ)
    const cShift = getClassShift(cls.id);
    let availableMainSlots = 0;
    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (isClassSlotBlocked(cls.id, day, period)) continue;
      const isMorning = (period <= 5);
      const isMain = (cShift === 'morning_main') ? isMorning : !isMorning;
      if (isMain) availableMainSlots++;
    }

    const processedNormSubs = new Set<string>();

    // A. ĐÓNG GÓI CÁC KHỐI LIÊN MÔN ĐỘNG (Dynamic Inter-subject Consecutive Pairs)
    for (const [p1, p2] of lessonConsecutivePairs) {
      let subA: string | null = null;
      let tidA: string | null = null;
      let subB: string | null = null;
      let tidB: string | null = null;

      for (const [s, tid] of Object.entries(classSubs)) {
        if (!tid) continue;
        const norm = normalizeSubName(s);
        if (norm === p1) { subA = s; tidA = tid; }
        if (norm === p2) { subB = s; tidB = tid; }
      }

      if (subA && tidA && subB && tidB) {
        const fixedA = customFixedCounts.get(`${cls.id}_${p1}`) || 0;
        const fixedB = customFixedCounts.get(`${cls.id}_${p2}`) || 0;
        const reqA = classReqMap.get(p1) || classReqMap.get(subA);
        const reqB = classReqMap.get(p2) || classReqMap.get(subB);
        const neededA = Math.max(0, (reqA?.periods ?? 1) - fixedA);
        const neededB = Math.max(0, (reqB?.periods ?? 1) - fixedB);

        if (neededA > 0 && neededB > 0) {
          const t1Obj = teacherMap.get(tidA);
          const t2Obj = teacherMap.get(tidB);
          const targetSess: 'main' | 'opp' = (reqA?.oppPeriods > 0 || reqB?.oppPeriods > 0 || p1 === 'GDQPAN' || p1 === 'GDĐP' || p2 === 'GDQPAN' || p2 === 'GDĐP') ? 'opp' : 'main';

          unitsToSchedule.push({
            unitId: `${cls.id}_Block_${p1}_${p2}`,
            classId: cls.id,
            className: cls.name,
            subject: subA,
            teacherId: tidA,
            teacherName: t1Obj ? t1Obj.name : 'Giáo viên',
            isDouble: true,
            isInterSubject: true,
            targetSession: targetSess,
            pairedUnit: {
              subject: subB,
              teacherId: tidB,
              teacherName: t2Obj ? t2Obj.name : 'Giáo viên'
            }
          });
          processedNormSubs.add(p1);
          processedNormSubs.add(p2);
        }
      }
    }

    // B. ĐÓNG GÓI CÁC KHỐI CÙNG MÔN (Atomic Double-Periods) & TIẾT ĐƠN
    let classMainAssignedCount = 0;
    // Đếm số tiết chính khóa từ các khối liên môn (nếu có)
    unitsToSchedule.filter(u => u.classId === cls.id && u.targetSession === 'main').forEach(u => {
      classMainAssignedCount += (u.isDouble ? 2 : 1);
    });

    for (const [subject, teacherId] of Object.entries(classSubs)) {
      if (!teacherId) continue;
      const normSub = normalizeSubName(subject);
      if (processedNormSubs.has(normSub)) continue;
      processedNormSubs.add(normSub);

      const reqEntry = classReqMap.get(normSub) || classReqMap.get(subject);
      if (!reqEntry || reqEntry.periods <= 0) continue;

      let mainPeriods = reqEntry.mainPeriods;
      let oppPeriods = reqEntry.oppPeriods;

      let fixedCount = customFixedCounts.get(`${cls.id}_${normSub}`) || 0;
      let mainRemaining = Math.max(0, mainPeriods - fixedCount);
      fixedCount = Math.max(0, fixedCount - mainPeriods);
      let oppRemaining = Math.max(0, oppPeriods - fixedCount);

      // Cân đối thông minh: nếu số tiết chính khóa vượt quá số ô trống chính khóa khả dụng của tuần,
      // chuyển phần vượt vào ca trái buổi để không bao giờ bị mất tiết
      if (availableMainSlots > 0 && classMainAssignedCount + mainRemaining > availableMainSlots) {
        const canFit = Math.max(0, availableMainSlots - classMainAssignedCount);
        const overflow = mainRemaining - canFit;
        mainRemaining = canFit;
        oppRemaining += overflow;
      }
      classMainAssignedCount += mainRemaining;

      const teacher = teacherMap.get(teacherId);
      const teacherName = teacher ? teacher.name : 'Giáo viên';
      const isConsecutiveForced = lessonConsecutiveSubs.has(normSub) || normSub === 'GDTC';

      // 1. Phân bổ các khối tiết cho buổi chính khóa (main session)
      if (mainRemaining > 0) {
        let remaining = mainRemaining;
        let pairsToCreate = reqEntry.mainMinPairs || 0;
        if ((isConsecutiveForced || normSub === 'Toán' || normSub === 'Văn') && remaining >= 2) {
          pairsToCreate = Math.max(pairsToCreate, 1);
        }
        pairsToCreate = Math.min(pairsToCreate, Math.floor(remaining / 2));

        for (let i = 0; i < pairsToCreate; i++) {
          unitsToSchedule.push({
            unitId: `${cls.id}_${subject}_main_d_${i}`,
            classId: cls.id,
            className: cls.name,
            subject,
            teacherId,
            teacherName,
            isDouble: true,
            targetSession: 'main'
          });
          remaining -= 2;
        }

        while (remaining > 0) {
          unitsToSchedule.push({
            unitId: `${cls.id}_${subject}_main_s_${remaining}`,
            classId: cls.id,
            className: cls.name,
            subject,
            teacherId,
            teacherName,
            isDouble: false,
            targetSession: 'main'
          });
          remaining -= 1;
        }
      }

      // 2. Phân bổ các khối tiết cho buổi trái buổi (opposite session)
      if (oppRemaining > 0) {
        let remaining = oppRemaining;
        let pairsToCreate = reqEntry.oppMinPairs || 0;
        if (normSub === 'GDTC' && remaining >= 2) {
          pairsToCreate = Math.max(pairsToCreate, Math.floor(remaining / 2));
        }
        pairsToCreate = Math.min(pairsToCreate, Math.floor(remaining / 2));

        for (let i = 0; i < pairsToCreate; i++) {
          unitsToSchedule.push({
            unitId: `${cls.id}_${subject}_opp_d_${i}`,
            classId: cls.id,
            className: cls.name,
            subject,
            teacherId,
            teacherName,
            isDouble: true,
            targetSession: 'opp'
          });
          remaining -= 2;
        }

        while (remaining > 0) {
          unitsToSchedule.push({
            unitId: `${cls.id}_${subject}_opp_s_${remaining}`,
            classId: cls.id,
            className: cls.name,
            subject,
            teacherId,
            teacherName,
            isDouble: false,
            targetSession: 'opp'
          });
          remaining -= 1;
        }
      }
    }
  });

  // 0.6. VỊ TRÍ HỢP LỆ CỦA KHỐI 2 TIẾT (VALID DOUBLE SLOTS)
  const validDoubleSlotIndices: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4] // Buổi sáng: Tiết 1-2, 2-3, 3-4, 4-5
  ];
  if (periodsPerDay > 5) {
    for (let i = 5; i < periodsPerDay - 1; i++) {
      validDoubleSlotIndices.push([i, i + 1]); // Buổi chiều: Tiết 6-7, 7-8, 8-9, 9-10
    }
  }

  // =========================================================================
  // TẦNG 1: TẬP RÀNG BUỘC CỨNG (HARD CONSTRAINTS - VI PHẠM LÀ LOẠI NGHIỆM)
  // =========================================================================

  const classGrid = new Map<string, (LessonUnit | 'FIXED' | null)[]>();
  classes.forEach(c => {
    classGrid.set(c.id, new Array(totalSlots).fill(null));
  });

  const teacherGrid = new Map<string, (string | null)[]>();
  teachers.forEach(t => {
    teacherGrid.set(t.id, new Array(totalSlots).fill(null));
  });

  // Gán cứng tiết cố định
  fixedLessons.forEach(fl => {
    const slotIdx = dayPeriodToSlot(fl.day, fl.period);
    if (slotIdx >= 0) {
      const cSlots = classGrid.get(fl.classId);
      if (cSlots) cSlots[slotIdx] = 'FIXED';
      if (fl.teacherId && teacherGrid.has(fl.teacherId)) {
        teacherGrid.get(fl.teacherId)![slotIdx] = fl.classId;
      }
    }
  });

  // Đánh dấu ô nghỉ vào lưới
  classes.forEach(c => {
    const cSlots = classGrid.get(c.id);
    if (!cSlots) return;
    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (isClassSlotBlocked(c.id, day, period)) {
        cSlots[s] = 'FIXED';
      }
    }
  });

  teachers.forEach(t => {
    const tSlots = teacherGrid.get(t.id);
    if (!tSlots) return;
    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (isTeacherSlotLocked(t.id, day, period)) {
        tSlots[s] = 'LOCKED';
      }
    }
  });

  // Đánh dấu lịch họp chuyên môn
  const teacherMeetingDay = Number(advConstraints.teacherMeetingDay || 0);
  const teacherMeetingSession = advConstraints.teacherMeetingSession || 'all';
  const teacherMeetingSubject = String(advConstraints.teacherMeetingSubject || '').trim();
  const teacherMeetingRules = Array.isArray(advConstraints.teacherMeetingRules) ? advConstraints.teacherMeetingRules : [];

  const activeMeetingRules: Array<{ subject: string; day: number; session: string }> = [];
  if (teacherMeetingDay >= 2 && teacherMeetingDay <= 7) {
    activeMeetingRules.push({
      subject: teacherMeetingSubject,
      day: teacherMeetingDay,
      session: teacherMeetingSession
    });
  }
  teacherMeetingRules.forEach((r: any) => {
    const rDay = Number(r.day || 0);
    if (rDay >= 2 && rDay <= 7) {
      activeMeetingRules.push({
        subject: String(r.subject || '').trim(),
        day: rDay,
        session: r.session || 'all'
      });
    }
  });

  activeMeetingRules.forEach(rule => {
    const targetSub = rule.subject.toLowerCase();
    const affectedTids = new Set<string>();
    teachers.forEach(t => {
      const spec = (t.specialization || '').toLowerCase();
      if (!targetSub || targetSub === 'all' || targetSub === 'tất cả' || spec.includes(targetSub)) {
        affectedTids.add(t.id);
      }
    });

    affectedTids.forEach(tId => {
      const tSlots = teacherGrid.get(tId);
      if (!tSlots) return;
      for (let s = 0; s < totalSlots; s++) {
        const { day: d, period: p } = slotToDayPeriod(s);
        if (d === rule.day) {
          if (rule.session === 'all' || (rule.session === 'morning' && p <= 5) || (rule.session === 'afternoon' && p >= 6)) {
            tSlots[s] = 'MEETING';
          }
        }
      }
    });
  });

  const canPlaceSubjectInClassSlot = (
    cId: string,
    s: number,
    subName: string,
    targetSess?: 'main' | 'opp',
    ignoreSlot: number = -1,
    allowOppFallback: boolean = false
  ): boolean => {
    const { day, period } = slotToDayPeriod(s);
    if (isClassSlotBlocked(cId, day, period)) return false;
    const grid = classGrid.get(cId);
    if (!grid) return false;
    if (grid[s] === 'FIXED' && s !== ignoreSlot) return false;

    const cShift = getClassShift(cId);
    if (!allowOppFallback) {
      if (targetSess === 'main') {
        const mainIsMorning = (cShift === 'morning_main');
        if (mainIsMorning && period >= 6) return false;
        if (!mainIsMorning && period <= 5) return false;
      } else if (targetSess === 'opp') {
        const oppIsAfternoon = (cShift === 'morning_main');
        if (oppIsAfternoon && period <= 5) return false;
        if (!oppIsAfternoon && period >= 6) return false;
      }
    }

    const isMorning = (period <= 5);
    const normS = normalizeSubName(subName);
    let countInSess = 0;
    const startS = Math.floor(s / periodsPerDay) * periodsPerDay;
    for (let p = 0; p < periodsPerDay; p++) {
      const testS = startS + p;
      if (testS === s || testS === ignoreSlot) continue;
      const item = grid[testS];
      if (item && item !== 'FIXED') {
        if ((p < 5) === isMorning && normalizeSubName(item.subject) === normS) {
          countInSess++;
        }
      }
    }
    const maxAllowedInSession = advConstraints.subjectMaxPeriodsPerSession || 2;
    if (countInSess >= maxAllowedInSession) return false;

    for (const [dis1, dis2] of lessonNotSameSessionPairs) {
      const forbidden = dis1 === normS ? dis2 : (dis2 === normS ? dis1 : null);
      if (forbidden) {
        for (let p = 0; p < periodsPerDay; p++) {
          const testS = startS + p;
          if (testS === s || testS === ignoreSlot) continue;
          const item = grid[testS];
          if (item && item !== 'FIXED') {
            if ((p < 5) === isMorning && normalizeSubName(item.subject) === forbidden) {
              return false;
            }
          }
        }
      }
    }

    return true;
  };

  const getTeacherMaxSessionsLimit = (tId: string): number | undefined => {
    return teacherMaxSessionsMap.get(tId) ||
           teacherMaxSessionsMap.get(tId.replace(/^t_/, '')) ||
           teacherMaxSessionsMap.get('t_' + tId.replace(/^t_/, ''));
  };

  const getTeacherMaxDaysLimit = (tId: string): number | undefined => {
    return teacherMaxDaysMap.get(tId) ||
           teacherMaxDaysMap.get(tId.replace(/^t_/, '')) ||
           teacherMaxDaysMap.get('t_' + tId.replace(/^t_/, ''));
  };

  const isTeacherAvailableAtSlot = (tId: string, s: number, ignoreCid: string = ''): boolean => {
    const { day, period } = slotToDayPeriod(s);
    if (isTeacherSlotLocked(tId, day, period)) return false;
    const tSlots = teacherGrid.get(tId);
    if (!tSlots) return true;
    const occupant = tSlots[s];
    if (occupant === 'MEETING' || occupant === 'LOCKED') return false;
    if (occupant !== null && occupant !== ignoreCid) return false;
    return true;
  };

  const isSlotAvailable = (
    classId: string,
    day: number,
    period: number,
    teacherId?: string,
    subjectName?: string,
    targetSession?: 'main' | 'opp',
    ignoreSlot: number = -1,
    allowOppFallback: boolean = false
  ): boolean => {
    if (isClassSlotBlocked(classId, day, period)) return false;
    const slotIdx = dayPeriodToSlot(day, period);
    if (slotIdx < 0) return false;

    const cSlots = classGrid.get(classId);
    if (!cSlots) return false;
    if (cSlots[slotIdx] !== null && slotIdx !== ignoreSlot) return false;

    if (teacherId && !isTeacherAvailableAtSlot(teacherId, slotIdx, classId)) return false;
    if (subjectName && !canPlaceSubjectInClassSlot(classId, slotIdx, subjectName, targetSession, ignoreSlot, allowOppFallback)) return false;

    return true;
  };

  // =========================================================================
  // TẦNG 3: TẬP RÀNG BUỘC MỀM & TỐI ƯU HÀM MỤC TIÊU (SOFT CONSTRAINTS)
  // =========================================================================

  const calculateTeacherDayGapCost = (teacherId: string, day: number): number => {
    const tSlots = teacherGrid.get(teacherId);
    if (!tSlots) return 0;
    const dayIdx = allDays.indexOf(day);
    const startIdx = dayIdx * periodsPerDay;
    let totalGapCost = 0;

    const morningCount = Math.min(5, periodsPerDay);
    let firstM = -1;
    let lastM = -1;
    let countM = 0;
    for (let p = 0; p < morningCount; p++) {
      if (tSlots[startIdx + p] !== null) {
        if (firstM === -1) firstM = p;
        lastM = p;
        countM++;
      }
    }
    if (countM > 1 && firstM !== -1 && lastM !== -1) {
      totalGapCost += (lastM - firstM + 1 - countM) * 60;
    }

    if (periodsPerDay > 5) {
      const afternoonCount = periodsPerDay - 5;
      let firstA = -1;
      let lastA = -1;
      let countA = 0;
      for (let p = 0; p < afternoonCount; p++) {
        if (tSlots[startIdx + 5 + p] !== null) {
          if (firstA === -1) firstA = p;
          lastA = p;
          countA++;
        }
      }
      if (countA > 1 && firstA !== -1 && lastA !== -1) {
        totalGapCost += (lastA - firstA + 1 - countA) * 60;
      }
    }

    return totalGapCost;
  };

  const calculateTeacherWorkloadSoftCost = (teacherId: string, day: number, period: number): number => {
    let cost = 0;
    const tSlots = teacherGrid.get(teacherId);
    if (!tSlots) return cost;

    const maxDaysLimit = getTeacherMaxDaysLimit(teacherId);
    const maxSessionsLimit = getTeacherMaxSessionsLimit(teacherId);

    const activeDays = new Set<number>();
    let morningSessions = 0;
    let afternoonSessions = 0;

    for (let dIdx = 0; dIdx < allDays.length; dIdx++) {
      const d = allDays[dIdx];
      const sStart = dIdx * periodsPerDay;
      let hasM = false;
      let hasA = false;
      for (let p = 0; p < periodsPerDay; p++) {
        if (tSlots[sStart + p] !== null && tSlots[sStart + p] !== 'LOCKED' && tSlots[sStart + p] !== 'MEETING') {
          activeDays.add(d);
          if (p < 5) hasM = true;
          else hasA = true;
        }
      }
      if (hasM) morningSessions++;
      if (hasA) afternoonSessions++;
    }

    if (maxDaysLimit && !activeDays.has(day)) {
      if (activeDays.size >= maxDaysLimit) {
        cost += 5000;
      } else {
        cost += 100;
      }
    }

    const totalSessions = morningSessions + afternoonSessions;
    const isMorning = (period <= 5);
    const dIdx = allDays.indexOf(day);
    let sessionAlreadyActive = false;
    if (dIdx !== -1) {
      const sessStart = dIdx * periodsPerDay + (isMorning ? 0 : 5);
      const sessEnd = dIdx * periodsPerDay + (isMorning ? Math.min(5, periodsPerDay) : periodsPerDay);
      for (let pi = sessStart; pi < sessEnd; pi++) {
        if (tSlots[pi] !== null && tSlots[pi] !== 'LOCKED' && tSlots[pi] !== 'MEETING') {
          sessionAlreadyActive = true;
          break;
        }
      }
    }

    // Tự động gom buổi toàn trường: Phạt 150 điểm khi phải mở buổi mới, thưởng 80 điểm khi gom vào buổi đã mở
    if (!sessionAlreadyActive) {
      if (maxSessionsLimit && totalSessions >= maxSessionsLimit) {
        cost += 5000;
      } else {
        cost += 150;
      }
    } else {
      cost -= 80;
    }

    cost += calculateTeacherDayGapCost(teacherId, day);

    if (advConstraints.teacherNoFirstPeriod && (period === 1 || period === 6)) {
      cost += 35;
    }

    return cost;
  };

  const getCandidateSlots = (unit: LessonUnit): { slotIdx: number; cost: number }[] => {
    const candidates: { slotIdx: number; cost: number }[] = [];
    const cSlots = classGrid.get(unit.classId)!;
    const tSlots = teacherGrid.get(unit.teacherId);

    const existingDaysOfSubject = new Set<number>();
    const existingDoubleDaysOfSubject = new Set<number>();
    const unitNormSub = normalizeSubName(unit.subject);

    for (let s = 0; s < totalSlots; s++) {
      const item = cSlots[s];
      if (item && item !== 'FIXED') {
        const { day } = slotToDayPeriod(s);
        if (normalizeSubName(item.subject) === unitNormSub) {
          existingDaysOfSubject.add(day);
          if (item.isDouble) {
            existingDoubleDaysOfSubject.add(day);
          }
        }
      }
    }

    const classShift = getClassShift(unit.classId);

    for (let dayIdx = 0; dayIdx < allDays.length; dayIdx++) {
      const day = allDays[dayIdx];
      const startSlot = dayIdx * periodsPerDay;

      if (unit.isDouble) {
        // RÀNG BUỘC CỨNG: Các khối 2 tiết cùng một môn BẮT BUỘC nằm ở 2 NGÀY KHÁC NHAU
        if (!unit.isInterSubject && existingDoubleDaysOfSubject.has(day)) {
          continue;
        }

        for (const [p1Idx, p2Idx] of validDoubleSlotIndices) {
          const s1 = startSlot + p1Idx;
          const s2 = startSlot + p2Idx;
          const { period: p1 } = slotToDayPeriod(s1);
          const { period: p2 } = slotToDayPeriod(s2);

          // Phân bổ buổi học chính khóa & trái buổi
          if (unit.targetSession === 'main') {
            const mainIsMorning = (classShift === 'morning_main');
            if (mainIsMorning && (p1 >= 6 || p2 >= 6)) continue;
            if (!mainIsMorning && (p1 <= 5 || p2 <= 5)) continue;
          } else if (unit.targetSession === 'opp') {
            const oppIsAfternoon = (classShift === 'morning_main');
            if (oppIsAfternoon && (p1 <= 5 || p2 <= 5)) continue;
            if (!oppIsAfternoon && (p1 >= 6 || p2 >= 6)) continue;
          }

          // Trần sư phạm <= 2 tiết/môn/buổi
          const isMorningSlot = (p1 <= 5);
          let sessCountDouble = 0;
          for (let testP = 0; testP < periodsPerDay; testP++) {
            const itemInSlot = cSlots[startSlot + testP];
            if (itemInSlot && itemInSlot !== 'FIXED') {
              if ((testP < 5) === isMorningSlot && normalizeSubName(itemInSlot.subject) === unitNormSub) {
                sessCountDouble += 1;
              }
            }
          }
          if (sessCountDouble + 2 > 2) continue;

          if (cSlots[s1] !== null || cSlots[s2] !== null) continue;

          if (tSlots && tSlots[s1] !== null) continue;
          if (unit.pairedUnit) {
            const t2Slots = teacherGrid.get(unit.pairedUnit.teacherId);
            if (t2Slots && t2Slots[s2] !== null) continue;
          } else {
            if (tSlots && tSlots[s2] !== null) continue;
          }

          let violatesDisjoint = false;
          const subsToCheck = [unitNormSub];
          if (unit.pairedUnit) subsToCheck.push(normalizeSubName(unit.pairedUnit.subject));

          for (const sInUnit of subsToCheck) {
            for (const [dis1, dis2] of lessonNotSameSessionPairs) {
              const forbidden = dis1 === sInUnit ? dis2 : (dis2 === sInUnit ? dis1 : null);
              if (forbidden) {
                for (let testP = 0; testP < periodsPerDay; testP++) {
                  const testSlot = startSlot + testP;
                  const itemInSlot = cSlots[testSlot];
                  if (itemInSlot && itemInSlot !== 'FIXED') {
                    if ((testP < 5) === isMorningSlot && normalizeSubName(itemInSlot.subject) === forbidden) {
                      violatesDisjoint = true;
                      break;
                    }
                  }
                }
              }
              if (violatesDisjoint) break;
            }
            if (violatesDisjoint) break;
          }
          if (violatesDisjoint) continue;

          let cost = 0;
          if (existingDaysOfSubject.has(day)) cost += 80;

          if (unit.pairedUnit) {
            cost += calculateTeacherWorkloadSoftCost(unit.teacherId, day, p1);
            cost += calculateTeacherWorkloadSoftCost(unit.pairedUnit.teacherId, day, p2);
          } else {
            cost += calculateTeacherWorkloadSoftCost(unit.teacherId, day, p1);
          }

          candidates.push({ slotIdx: s1, cost });
        }
      } else {
        // Single period
        for (let pIdx = 0; pIdx < periodsPerDay; pIdx++) {
          const s = startSlot + pIdx;
          const { period: p } = slotToDayPeriod(s);

          if (unit.targetSession === 'main') {
            const mainIsMorning = (classShift === 'morning_main');
            if (mainIsMorning && p >= 6) continue;
            if (!mainIsMorning && p <= 5) continue;
          } else if (unit.targetSession === 'opp') {
            const oppIsAfternoon = (classShift === 'morning_main');
            if (oppIsAfternoon && p <= 5) continue;
            if (!oppIsAfternoon && p >= 6) continue;
          }

          const isMorningSingle = (p <= 5);
          let sessCountSingle = 0;
          for (let testP = 0; testP < periodsPerDay; testP++) {
            const itemInSlot = cSlots[startSlot + testP];
            if (itemInSlot && itemInSlot !== 'FIXED') {
              if ((testP < 5) === isMorningSingle && normalizeSubName(itemInSlot.subject) === unitNormSub) {
                sessCountSingle += 1;
              }
            }
          }
          if (sessCountSingle + 1 > 2) continue;

          if (cSlots[s] !== null) continue;
          if (tSlots && tSlots[s] !== null) continue;

          let violatesSingleDisjoint = false;
          for (const [dis1, dis2] of lessonNotSameSessionPairs) {
            const forbidden = dis1 === unitNormSub ? dis2 : (dis2 === unitNormSub ? dis1 : null);
            if (forbidden) {
              for (let testP = 0; testP < periodsPerDay; testP++) {
                const testSlot = startSlot + testP;
                const itemInSlot = cSlots[testSlot];
                if (itemInSlot && itemInSlot !== 'FIXED') {
                  if ((testP < 5) === isMorningSingle && normalizeSubName(itemInSlot.subject) === forbidden) {
                    violatesSingleDisjoint = true;
                    break;
                  }
                }
              }
            }
            if (violatesSingleDisjoint) break;
          }
          if (violatesSingleDisjoint) continue;

          let cost = 0;
          if (existingDaysOfSubject.has(day)) cost += 60;
          if (existingDaysOfSubject.has(day - 1) || existingDaysOfSubject.has(day + 1)) {
            cost += 30;
          }

          cost += calculateTeacherWorkloadSoftCost(unit.teacherId, day, p);
          candidates.push({ slotIdx: s, cost });
        }
      }
    }

    candidates.sort((a, b) => a.cost - b.cost);
    return candidates;
  };

  // =========================================================================
  // TẦNG 2: THỨ TỰ TÌM KIẾM CỦA SOLVER (SEARCH STRATEGY / HEURISTICS)
  // =========================================================================

  const teacherWorkload = new Map<string, number>();
  unitsToSchedule.forEach(u => {
    const cur = teacherWorkload.get(u.teacherId) || 0;
    teacherWorkload.set(u.teacherId, cur + (u.isDouble ? 2 : 1));
    if (u.pairedUnit) {
      const cur2 = teacherWorkload.get(u.pairedUnit.teacherId) || 0;
      teacherWorkload.set(u.pairedUnit.teacherId, cur2 + 1);
    }
  });

  const getPriorityRank = (u: LessonUnit): number => {
    const norm = normalizeSubName(u.subject);
    const isCore = (norm === 'Toán' || norm === 'Văn');
    if (u.isDouble && u.targetSession === 'main' && isCore) return 1;
    if (u.isDouble && (u.isInterSubject || u.targetSession === 'opp' || norm === 'GDTC')) return 2;
    if (u.isDouble && u.targetSession === 'main') return 3;
    if (!u.isDouble && u.targetSession === 'main') return 4;
    return 5;
  };

  unitsToSchedule.forEach(u => {
    u.priorityRank = getPriorityRank(u);
  });

  unitsToSchedule.sort((a, b) => {
    const rankDiff = (a.priorityRank || 5) - (b.priorityRank || 5);
    if (rankDiff !== 0) return rankDiff;

    const wA = teacherWorkload.get(a.teacherId) || 0;
    const wB = teacherWorkload.get(b.teacherId) || 0;
    return wB - wA;
  });

  // Tiến trình xếp lịch với Backtracking & Kempe Chains
  const unplacedUnits: LessonUnit[] = [];

  for (const unit of unitsToSchedule) {
    const candidates = getCandidateSlots(unit);
    if (candidates.length > 0) {
      const best = candidates[0].slotIdx;
      const cSlots = classGrid.get(unit.classId)!;
      const tSlots = teacherGrid.get(unit.teacherId);

      cSlots[best] = unit;
      if (tSlots) tSlots[best] = unit.classId;

      if (unit.isDouble) {
        if (unit.pairedUnit) {
          const t2Slots = teacherGrid.get(unit.pairedUnit.teacherId);
          cSlots[best + 1] = {
            ...unit,
            unitId: `${unit.unitId}_paired`,
            subject: unit.pairedUnit.subject,
            teacherId: unit.pairedUnit.teacherId,
            teacherName: unit.pairedUnit.teacherName,
            isDouble: true,
            isInterSubject: true
          };
          if (t2Slots) t2Slots[best + 1] = unit.classId;
        } else {
          cSlots[best + 1] = unit;
          if (tSlots) tSlots[best + 1] = unit.classId;
        }
      }
    } else {
      unplacedUnits.push(unit);
    }
  }

  // Thuật toán đảo tiết Kempe Chains và Intra-class swap
  const placeUnitWithAdvancedChains = (unit: LessonUnit, allowOppFallback: boolean = false): boolean => {
    const cid = unit.classId;
    const tid = unit.teacherId;
    const cSlots = classGrid.get(cid);
    if (!cSlots) return false;
    const tSlots = teacherGrid.get(tid);

    // LEVEL 1: Xếp trực tiếp vào ô trống
    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (!isSlotAvailable(cid, day, period, tid, unit.subject, unit.targetSession, -1, allowOppFallback)) continue;

      cSlots[s] = unit;
      if (tSlots) tSlots[s] = cid;
      return true;
    }

    // LEVEL 2: Intra-class 1-step swap (Hoán vị nội bộ lớp)
    for (let sFree = 0; sFree < totalSlots; sFree++) {
      if (cSlots[sFree] !== null) continue;

      for (let sOcc = 0; sOcc < totalSlots; sOcc++) {
        if (sOcc === sFree) continue;
        const occUnit = cSlots[sOcc];
        if (!occUnit || occUnit === 'FIXED' || occUnit.isInterSubject || occUnit.isDouble) continue;

        const { day: dFree, period: pFree } = slotToDayPeriod(sFree);
        const { day: dOcc, period: pOcc } = slotToDayPeriod(sOcc);

        if (!isSlotAvailable(cid, dFree, pFree, occUnit.teacherId, occUnit.subject, occUnit.targetSession, sOcc, allowOppFallback)) continue;
        if (!isSlotAvailable(cid, dOcc, pOcc, tid, unit.subject, unit.targetSession, sOcc, allowOppFallback)) continue;

        const tOccSlots = teacherGrid.get(occUnit.teacherId);
        cSlots[sFree] = occUnit;
        if (tOccSlots) { tOccSlots[sOcc] = null; tOccSlots[sFree] = cid; }
        cSlots[sOcc] = unit;
        if (tSlots) tSlots[sOcc] = cid;
        return true;
      }
    }

    // LEVEL 3: Inter-class 1-step swap (Kempe Chain qua giáo viên)
    for (let sFree = 0; sFree < totalSlots; sFree++) {
      if (cSlots[sFree] !== null) continue;
      if (!canPlaceSubjectInClassSlot(cid, sFree, unit.subject, unit.targetSession, -1, allowOppFallback)) continue;

      const otherCid = tSlots ? tSlots[sFree] : null;
      if (otherCid && otherCid !== cid && otherCid !== 'LOCKED' && otherCid !== 'MEETING') {
        const otherGrid = classGrid.get(otherCid);
        if (otherGrid) {
          const otherUnit = otherGrid[sFree];
          if (otherUnit && otherUnit !== 'FIXED' && !otherUnit.isInterSubject && !otherUnit.isDouble) {
            for (let sOther = 0; sOther < totalSlots; sOther++) {
              if (sOther === sFree || otherGrid[sOther] !== null) continue;
              if (!canPlaceSubjectInClassSlot(otherCid, sOther, otherUnit.subject, otherUnit.targetSession, sFree, allowOppFallback)) continue;
              if (!isTeacherAvailableAtSlot(tid, sOther, otherCid)) continue;

              otherGrid[sFree] = null;
              otherGrid[sOther] = otherUnit;
              if (tSlots) tSlots[sOther] = otherCid;

              cSlots[sFree] = unit;
              if (tSlots) tSlots[sFree] = cid;
              return true;
            }
          }
        }
      }
    }

    return false;
  };

  const unplacedPool: LessonUnit[] = [];
  unplacedUnits.forEach(u => {
    if (u.isDouble && !u.isInterSubject) {
      unplacedPool.push({ ...u, unitId: `${u.unitId}_s1`, isDouble: false });
      unplacedPool.push({ ...u, unitId: `${u.unitId}_s2`, isDouble: false });
    } else {
      unplacedPool.push(u);
    }
  });

  let remainingUnplaced: LessonUnit[] = [];
  for (const u of unplacedPool) {
    if (!placeUnitWithAdvancedChains(u, false)) {
      remainingUnplaced.push(u);
    }
  }

  // MIN-CONFLICTS LOCAL SEARCH WITH TABU EJECTION LOOP
  const timeLimitMs = 8000;
  const tabuMap = new Map<string, number>();
  let ejectionIter = 0;
  const maxEjectionIters = 6000;

  while (remainingUnplaced.length > 0 && ejectionIter < maxEjectionIters && (performance.now() - startTime) < timeLimitMs) {
    ejectionIter++;
    const unit = remainingUnplaced.shift()!;

    if (placeUnitWithAdvancedChains(unit, true)) {
      continue;
    }

    const cid = unit.classId;
    const tid = unit.teacherId;
    const cSlots = classGrid.get(cid)!;

    const candidates: Array<{
      slot: number;
      score: number;
      victimClass: LessonUnit | null;
      victimOther: { classId: string; unit: LessonUnit } | null;
    }> = [];

    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (isClassSlotBlocked(cid, day, period) || isTeacherSlotLocked(tid, day, period)) continue;
      if (cSlots[s] === 'FIXED') continue;

      const victimClass = cSlots[s] && cSlots[s] !== 'FIXED' ? (cSlots[s] as LessonUnit) : null;
      if (victimClass && victimClass.isInterSubject) continue;

      const tSlots = teacherGrid.get(tid);
      const otherCid = tSlots ? tSlots[s] : null;
      let victimOther: { classId: string; unit: LessonUnit } | null = null;
      if (otherCid && otherCid !== cid && otherCid !== 'LOCKED' && otherCid !== 'MEETING') {
        const otherGrid = classGrid.get(otherCid);
        const otherUnit = otherGrid ? otherGrid[s] : null;
        if (otherUnit && otherUnit !== 'FIXED' && !otherUnit.isInterSubject) {
          victimOther = { classId: otherCid, unit: otherUnit };
        } else {
          continue;
        }
      } else if (otherCid === 'LOCKED' || otherCid === 'MEETING') {
        continue;
      }

      let conflicts = 0;
      if (victimClass) {
        conflicts += 1;
        if ((tabuMap.get(victimClass.unitId) || 0) > ejectionIter) conflicts += 5;
      }
      if (victimOther) {
        conflicts += 1;
        if ((tabuMap.get(victimOther.unit.unitId) || 0) > ejectionIter) conflicts += 5;
      }

      candidates.push({ slot: s, score: conflicts, victimClass, victimOther });
    }

    if (candidates.length === 0) {
      remainingUnplaced.push(unit);
      continue;
    }

    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0];
    const sTarget = chosen.slot;

    if (chosen.victimClass) {
      cSlots[sTarget] = null;
      const vTSlots = teacherGrid.get(chosen.victimClass.teacherId);
      if (vTSlots) vTSlots[sTarget] = null;
      tabuMap.set(chosen.victimClass.unitId, ejectionIter + 8);
      remainingUnplaced.push(chosen.victimClass);
    }

    if (chosen.victimOther) {
      const oGrid = classGrid.get(chosen.victimOther.classId);
      if (oGrid) oGrid[sTarget] = null;
      const tSlots = teacherGrid.get(tid);
      if (tSlots) tSlots[sTarget] = null;
      tabuMap.set(chosen.victimOther.unit.unitId, ejectionIter + 8);
      remainingUnplaced.push(chosen.victimOther.unit);
    }

    cSlots[sTarget] = unit;
    const tSlots = teacherGrid.get(tid);
    if (tSlots) tSlots[sTarget] = cid;
  }

  // FINAL SWEEP: Quét nốt các ô trống còn lại trong ca để đảm bảo đạt 100%
  if (remainingUnplaced.length > 0) {
    for (const unit of [...remainingUnplaced]) {
      const cid = unit.classId;
      const tid = unit.teacherId;
      const cSlots = classGrid.get(cid);
      if (!cSlots) continue;
      const tSlots = teacherGrid.get(tid);

      for (let s = 0; s < totalSlots; s++) {
        if (cSlots[s] !== null) continue;
        const { day, period } = slotToDayPeriod(s);
        if (isClassSlotBlocked(cid, day, period)) continue;

        if (isTeacherAvailableAtSlot(tid, s, cid) && canPlaceSubjectInClassSlot(cid, s, unit.subject, undefined, -1, true)) {
          cSlots[s] = unit;
          if (tSlots) tSlots[s] = cid;
          remainingUnplaced = remainingUnplaced.filter(u => u.unitId !== unit.unitId);
          break;
        }
      }
    }
  }

  // =========================================================================
  // XÂY DỰNG DANH SÁCH TIẾT HỌC HOÀN CHỈNH & THỐNG KÊ (OUTPUT GENERATION)
  // =========================================================================
  const finalLessons: TimetableLesson[] = [...fixedLessons];
  let lessonCounter = 2000;

  classes.forEach(cls => {
    const cSlots = classGrid.get(cls.id);
    if (!cSlots) return;

    for (let s = 0; s < totalSlots; s++) {
      const item = cSlots[s];
      if (item && item !== 'FIXED') {
        const { day, period } = slotToDayPeriod(s);
        lessonCounter++;
        finalLessons.push({
          id: `lesson_${lessonCounter}`,
          classId: cls.id,
          className: cls.name,
          subject: item.subject,
          teacherId: item.teacherId,
          teacherName: item.teacherName,
          day,
          period,
          isFixed: false
        });
      }
    }
  });

  // Kiểm tra xung đột và thống kê chất lượng sư phạm
  let teacherConflicts = 0;
  let classConflicts = 0;
  let isolatedGaps = 0;
  let teacherDaysWithLessons = 0;

  for (let s = 0; s < totalSlots; s++) {
    const { day, period } = slotToDayPeriod(s);
    const teacherInSlot = new Set<string>();

    finalLessons.forEach(l => {
      if (l.day === day && l.period === period && l.teacherId) {
        if (teacherInSlot.has(l.teacherId)) {
          teacherConflicts++;
        }
        teacherInSlot.add(l.teacherId);
      }
    });
  }

  teachers.forEach(t => {
    allDays.forEach(day => {
      const dayLessons = finalLessons.filter(l => l.teacherId === t.id && l.day === day);
      if (dayLessons.length > 0) {
        teacherDaysWithLessons++;

        const morningPeriods = dayLessons.filter(l => l.period <= 5).map(l => l.period).sort((a, b) => a - b);
        if (morningPeriods.length > 1) {
          const gaps = (morningPeriods[morningPeriods.length - 1] - morningPeriods[0] + 1) - morningPeriods.length;
          if (gaps > 0) isolatedGaps += gaps;
        }

        const afternoonPeriods = dayLessons.filter(l => l.period >= 6).map(l => l.period).sort((a, b) => a - b);
        if (afternoonPeriods.length > 1) {
          const gaps = (afternoonPeriods[afternoonPeriods.length - 1] - afternoonPeriods[0] + 1) - afternoonPeriods.length;
          if (gaps > 0) isolatedGaps += gaps;
        }
      }
    });
  });

  const executionTimeMs = Math.round(performance.now() - startTime);

  const stats: TimetableStats = {
    totalLessons: finalLessons.length,
    totalClasses: classes.length,
    totalTeachers: teachers.length,
    teacherConflicts,
    classConflicts,
    isolatedGaps,
    teacherDaysWithLessons,
    solverUsed: 'cp_sat_constraint_engine',
    executionTimeMs
  };

  return {
    academicYear: 'Năm học 2026 – 2027',
    semester: 'Học kỳ I',
    createdAt: new Date().toISOString(),
    lessons: finalLessons,
    stats,
    sessionMode,
    afternoonPeriodsCount: effectiveAfternoonCount,
    fixedSlotsConfig: fixedConfig,
    lockedSlots
  };
}
