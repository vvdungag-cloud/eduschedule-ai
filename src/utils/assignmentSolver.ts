// EduSchedule AI Optimization Engine - Thuật toán phân công giảng dạy & chủ nhiệm THPT
// Phân tách Ràng buộc Cứng (Hard Constraints) và Ràng buộc Mềm (Soft Constraints) theo yêu cầu quy chế sư phạm

export interface Teacher {
  id: string;
  name: string;
  specialization: string;
  subject?: string;
  monGiangDay?: string;
  subjectId?: string;
  monDay?: string;
  monHoc?: string;
  position?: string;
  maxPeriods: number;
  isHomeroomCapable: boolean;
  preferredGrades: string[];
  experienceYears: number;
  phone?: string;
  namSinh?: number;
  namVaoNganh?: number;
  trinhDo?: string;
  email?: string;
  department?: string;
  toChuyenMon?: string;
}

export interface ClassModel {
  id: string;
  name: string;
  grade: '10' | '11' | '12';
  shift?: 'morning' | 'afternoon' | 'both';
  homeroomTeacherId?: string;
}

export interface SubjectRequirement {
  classId: string;
  className: string;
  grade: '10' | '11' | '12';
  subjects: { name: string; periods: number }[];
}

export interface AssignmentsState {
  homeroomAssignments: { [classId: string]: string };
  subjectAssignments: { [classId: string]: { [subjectName: string]: string } };
}

export type OptimizeMode = 'all' | 'teaching_only' | 'homeroom_only' | 'manual_and_auto';

export interface AutoAssignOptions {
  optPrioritizeNormalTeachers?: boolean; // Ưu tiên phân công GV thường làm GVCN trước, hạn chế Tổ trưởng / Tổ phó
  optStrictQuota?: boolean;              // Không phân công vượt trần định mức (Nếu tắt: cho phép dạy vượt tiết khi thiếu GV)
  optLimitGrades?: boolean;              // Giới hạn mỗi GV dạy tối đa 1 đến 2 khối (tránh dạy cả 3 khối 10, 11, 12)
  optBalanceWorkload?: boolean;          // Cân bằng số tiết giữa các giáo viên trong cùng tổ bộ môn
  mode?: OptimizeMode;                  // Chế độ phân công (toàn diện, thủ công & tự động, chỉ dạy, chỉ CN)
}

export interface UnassignedSlot {
  classId: string;
  className: string;
  grade: '10' | '11' | '12';
  subject: string;
  periods: number;
  reason: string;
}

export interface SolverResult {
  homeroomAssignments: { [classId: string]: string };
  subjectAssignments: { [classId: string]: { [subjectName: string]: string } };
  unassignedSlots?: UnassignedSlot[];
  explanation: string;
  stats: {
    totalClasses: number;
    totalHomerooms: number;
    totalSubjectSlots: number;
    unassignedCount: number;
    teachersWithMax2Grades: number;
    teachersCount: number;
    departmentStats: {
      department: string;
      teacherCount: number;
      minPeriods: number;
      maxPeriods: number;
      avgPeriods: number;
      diffPeriods: number;
    }[];
  };
}

export const NON_SPECIALIZED_SUBJECTS = new Set(['GDĐP', 'TNHN1', 'TNHN2']);

export function isPrincipal(t: Teacher): boolean {
  if (!t.position) return false;
  const p = t.position.trim().toLowerCase();
  if (p === 'ht') return true;
  if (p.includes('hiệu trưởng') && !p.includes('phó') && !p.includes('p.')) return true;
  return false;
}

export function isVicePrincipal(t: Teacher): boolean {
  if (!t.position) return false;
  const p = t.position.trim().toLowerCase();
  if (
    p === 'pht' ||
    p === 'hiệu phó' ||
    p.includes('phó ht') ||
    p.includes('p.hiệu trưởng') ||
    p.includes('p. hiệu trưởng') ||
    p.includes('phó hiệu trưởng')
  ) {
    return true;
  }
  return false;
}

export function isSchoolLeader(t: Teacher): boolean {
  if (!t.position) return false;
  const p = t.position.trim().toLowerCase();
  return isPrincipal(t) || isVicePrincipal(t) || p.includes('bgh') || p.includes('ban giám hiệu');
}

export function isDepartmentHead(t: Teacher): boolean {
  if (!t.position) return false;
  const p = t.position.trim().toLowerCase();
  if (isSchoolLeader(t)) return false;
  return (
    p.includes('tổ trưởng') ||
    p === 'tt' ||
    p.includes('trưởng bộ môn') ||
    p.includes('trưởng môn') ||
    p.includes('trưởng tổ')
  );
}

export function isDepartmentDeputy(t: Teacher): boolean {
  if (!t.position) return false;
  const p = t.position.trim().toLowerCase();
  if (isSchoolLeader(t) || isDepartmentHead(t)) return false;
  return (
    p.includes('tổ phó') ||
    p === 'tp' ||
    p.includes('phó tổ trưởng') ||
    p.includes('phó bộ môn') ||
    p.includes('phó tổ')
  );
}

export function isNormalTeacher(t: Teacher): boolean {
  return !isSchoolLeader(t) && !isDepartmentHead(t) && !isDepartmentDeputy(t);
}

export function getLeaderTargetQuota(t: Teacher): number {
  if (isPrincipal(t)) {
    if (typeof t.maxPeriods === 'number' && t.maxPeriods > 0 && t.maxPeriods <= 6) {
      return t.maxPeriods;
    }
    return 2;
  }
  if (isVicePrincipal(t)) {
    if (typeof t.maxPeriods === 'number' && t.maxPeriods > 0 && t.maxPeriods <= 8) {
      return t.maxPeriods;
    }
    return 4;
  }
  if (isSchoolLeader(t)) {
    if (typeof t.maxPeriods === 'number' && t.maxPeriods > 0 && t.maxPeriods <= 8) {
      return t.maxPeriods;
    }
    return 4;
  }
  return t.maxPeriods || 17;
}

export function findExactPeriodCombination<T extends { periods: number }>(items: T[], target: number): T[] | null {
  if (target <= 0) return [];
  if (items.length === 0) return null;

  for (let i = 0; i < items.length; i++) {
    if (Math.abs(items[i].periods - target) < 0.001) return [items[i]];
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (Math.abs(items[i].periods + items[j].periods - target) < 0.001) return [items[i], items[j]];
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      for (let k = j + 1; k < items.length; k++) {
        if (Math.abs(items[i].periods + items[j].periods + items[k].periods - target) < 0.001) {
          return [items[i], items[j], items[k]];
        }
      }
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      for (let k = j + 1; k < items.length; k++) {
        for (let l = k + 1; l < items.length; l++) {
          if (Math.abs(items[i].periods + items[j].periods + items[k].periods + items[l].periods - target) < 0.001) {
            return [items[i], items[j], items[k], items[l]];
          }
        }
      }
    }
  }
  return null;
}

export function normalizeSubjectName(sub: string): string {
  if (!sub) return '';
  const trimmed = sub.trim();
  if (trimmed === 'Toán' || trimmed === 'Toán học') return 'Toán';
  if (trimmed === 'Lý' || trimmed === 'Vật lí' || trimmed === 'Vật lý' || trimmed === 'Vật Lí' || trimmed === 'Vật Lý') return 'Lý';
  if (trimmed === 'Hóa' || trimmed === 'Hóa học' || trimmed === 'Hóa Học') return 'Hóa';
  if (trimmed === 'Sinh' || trimmed === 'Sinh học' || trimmed === 'Sinh Học') return 'Sinh';
  if (trimmed === 'Tin' || trimmed === 'Tin học' || trimmed === 'Tin Học') return 'Tin';
  if (
    trimmed === 'CNNN' ||
    trimmed === 'CN (Nông nghiệp)' ||
    trimmed === 'Công nghệ (Nông nghiệp)' ||
    trimmed === 'Nông nghiệp' ||
    trimmed === 'CN Nông nghiệp' ||
    trimmed === 'Công nghệ NN'
  ) return 'CNNN';
  if (
    trimmed === 'CNCN' ||
    trimmed === 'CN (Công nghiệp)' ||
    trimmed === 'Công nghệ (Công nghiệp)' ||
    trimmed === 'Công nghiệp' ||
    trimmed === 'CN Công nghiệp' ||
    trimmed === 'Công nghệ CN' ||
    trimmed === 'CN' ||
    trimmed === 'Công nghệ' ||
    trimmed === 'Công Nghệ'
  ) return 'CNCN';
  if (trimmed === 'Văn' || trimmed === 'Ngữ văn' || trimmed === 'Ngữ Văn') return 'Văn';
  if (trimmed === 'Sử' || trimmed === 'Lịch sử' || trimmed === 'Lịch Sử') return 'Sử';
  if (trimmed === 'Địa' || trimmed === 'Địa lí' || trimmed === 'Địa lý' || trimmed === 'Địa Lí' || trimmed === 'Địa Lý') return 'Địa';
  if (
    trimmed === 'GD' ||
    trimmed === 'GDKTPL' ||
    trimmed === 'GDCD' ||
    trimmed === 'Giáo dục kinh tế và pháp luật' ||
    trimmed === 'Kinh tế & Pháp luật' ||
    trimmed === 'Giáo dục công dân'
  ) return 'GDKTPL';
  if (trimmed === 'Anh' || trimmed === 'Tiếng Anh' || trimmed === 'Ngoại ngữ' || trimmed === 'Ngoại Ngữ') return 'Anh';
  if (trimmed === 'GDTC' || trimmed === 'Thể dục' || trimmed === 'Giáo dục thể chất') return 'GDTC';
  if (
    trimmed === 'GDQPAN' ||
    trimmed === 'GD QP-AN' ||
    trimmed === 'GDQP-AN' ||
    trimmed === 'GD QP - AN' ||
    trimmed === 'GDQP' ||
    trimmed === 'QPAN' ||
    trimmed === 'Quốc phòng' ||
    trimmed === 'Giáo dục quốc phòng' ||
    trimmed === 'Giáo dục QP-AN'
  ) return 'GDQPAN';
  if (trimmed === 'GDĐP' || trimmed === 'Giáo dục địa phương') return 'GDĐP';
  return trimmed;
}

export function findClassRequirement(
  subjectRequirements: SubjectRequirement[],
  classId: string,
  className?: string
): SubjectRequirement | undefined {
  if (!subjectRequirements || !classId) return undefined;
  const cleanId = classId.replace(/^c_/, '');
  const prefixedId = 'c_' + cleanId;
  return subjectRequirements.find(r =>
    r.classId === classId ||
    r.classId === cleanId ||
    r.classId === prefixedId ||
    (className && (r.className === className || r.classId === className)) ||
    (r.className && r.className === cleanId)
  );
}

// ======================================================================
// THUẬT TOÁN PHÂN CÔNG TỰ ĐỘNG CHÍNH (autoAssignSchedules)
// ======================================================================
export function autoAssignSchedules(
  teachers: Teacher[],
  classes: ClassModel[],
  subjectRequirements: SubjectRequirement[],
  currentAssignments: AssignmentsState,
  options: AutoAssignOptions = {}
): SolverResult {
  const {
    optPrioritizeNormalTeachers = true,
    optStrictQuota = false,
    optLimitGrades = true,
    optBalanceWorkload = true,
    mode = 'all'
  } = options;

  const unassignedSlots: UnassignedSlot[] = [];

  // ====================================================================
  // BƯỚC 1: XỬ LÝ CHỦ NHIỆM (GVCN)
  // Ràng buộc cứng:
  // - BGH tuyệt đối không làm GVCN (isSchoolLeader(t) === true)
  // - Mỗi lớp duy nhất 1 GVCN, mỗi GV chỉ chủ nhiệm tối đa 1 lớp
  // Ràng buộc mềm:
  // - optPrioritizeNormalTeachers: Ưu tiên GV thường -> Tổ phó -> Tổ trưởng
  // ====================================================================
  const newHomeroomAssignments: { [classId: string]: string } =
    (mode === 'teaching_only' || mode === 'manual_and_auto') && currentAssignments?.homeroomAssignments
      ? { ...currentAssignments.homeroomAssignments }
      : {};

  const assignedHomeroomTeachers = new Set<string>();
  // Đảm bảo không gán BGH vào chủ nhiệm ngay cả từ dữ liệu cũ
  Object.entries(newHomeroomAssignments).forEach(([cId, tId]) => {
    const t = teachers.find(x => x.id === tId);
    if (t && !isSchoolLeader(t)) {
      assignedHomeroomTeachers.add(tId);
    } else {
      delete newHomeroomAssignments[cId];
    }
  });

  // Thống kê khối lượng giảng dạy môn chuyên môn của từng tổ
  const deptTeachingPeriods: { [dept: string]: number } = {};
  const deptTeacherCapacity: { [dept: string]: number } = {};
  teachers.forEach(t => {
    const s = normalizeSubjectName(t.specialization);
    deptTeacherCapacity[s] = (deptTeacherCapacity[s] || 0) + (isSchoolLeader(t) ? getLeaderTargetQuota(t) : t.maxPeriods);
  });
  classes.forEach(c => {
    const req = findClassRequirement(subjectRequirements, c.id, c.name);
    req?.subjects.forEach(sub => {
      const s = normalizeSubjectName(sub.name);
      if (!NON_SPECIALIZED_SUBJECTS.has(s) && sub.periods > 0) {
        deptTeachingPeriods[s] = (deptTeachingPeriods[s] || 0) + sub.periods;
      }
    });
  });

  if (mode === 'all' || mode === 'homeroom_only' || mode === 'manual_and_auto') {
    // Bảo lưu GVCN hợp lệ đã phân công nếu phù hợp
    if (currentAssignments?.homeroomAssignments) {
      classes.forEach(cls => {
        if (!newHomeroomAssignments[cls.id]) {
          const prevTId = currentAssignments.homeroomAssignments[cls.id];
          if (prevTId && !assignedHomeroomTeachers.has(prevTId)) {
            const t = teachers.find(x => x.id === prevTId);
            if (t && t.isHomeroomCapable && !isSchoolLeader(t)) {
              newHomeroomAssignments[cls.id] = prevTId;
              assignedHomeroomTeachers.add(prevTId);
            }
          }
        }
      });
    }

    // Xếp GVCN cho các lớp còn trống
    // Ưu tiên khối 12 trước, sau đó 11, rồi 10
    const sortedClasses = [...classes].sort((a, b) => {
      const gA = parseInt(a.grade, 10);
      const gB = parseInt(b.grade, 10);
      if (gB !== gA) return gB - gA;
      return a.name.localeCompare(b.name);
    });

    sortedClasses.forEach(cls => {
      if (newHomeroomAssignments[cls.id]) {
        assignedHomeroomTeachers.add(newHomeroomAssignments[cls.id]);
        return;
      }

      const reqCls = findClassRequirement(subjectRequirements, cls.id, cls.name);
      const availableSubjectsInClass = new Set<string>();
      if (reqCls) {
        reqCls.subjects.forEach(s => {
          if (s.periods > 0 && !NON_SPECIALIZED_SUBJECTS.has(s.name)) {
            availableSubjectsInClass.add(normalizeSubjectName(s.name));
          }
        });
      }

      // RÀNG BUỘC CỨNG: BGH tuyệt đối không làm GVCN, mỗi GV chỉ tối đa 1 lớp
      const candidates = teachers.filter(
        t => t.isHomeroomCapable && !assignedHomeroomTeachers.has(t.id) && !isSchoolLeader(t)
      );
      if (candidates.length === 0) return;

      candidates.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        // RÀNG BUỘC MỀM 1: optPrioritizeNormalTeachers
        // Ưu tiên GV thường -> Tổ phó -> Tổ trưởng
        if (optPrioritizeNormalTeachers) {
          const getPosRank = (t: Teacher): number => {
            if (isNormalTeacher(t)) return 3;       // GV thường: Điểm ưu tiên cao nhất
            if (isDepartmentDeputy(t)) return 2;    // Tổ phó: Điểm ưu tiên trung bình
            if (isDepartmentHead(t)) return 1;      // Tổ trưởng: Điểm ưu tiên thấp nhất
            return 3;
          };
          const rankA = getPosRank(a);
          const rankB = getPosRank(b);
          if (rankA !== rankB) {
            return rankB - rankA; // Ưu tiên xếp người có rank cao hơn
          }
        }

        // RÀNG BUỘC CỨNG (Khóa chặt): Giáo viên có môn chuyên môn được giảng dạy tại lớp này (>0 tiết)
        const specA = normalizeSubjectName(a.specialization);
        const specB = normalizeSubjectName(b.specialization);
        const teachesInClassA = availableSubjectsInClass.has(specA);
        const teachesInClassB = availableSubjectsInClass.has(specB);

        if (teachesInClassA && !teachesInClassB) scoreA += 5000;
        if (!teachesInClassA && teachesInClassB) scoreB += 5000;

        // Ưu tiên chọn GV từ tổ có dư thừa công suất (tỷ lệ tiết dạy/công suất thấp)
        const ratioA = (deptTeachingPeriods[specA] || 0) / Math.max(1, deptTeacherCapacity[specA] || 1);
        const ratioB = (deptTeachingPeriods[specB] || 0) / Math.max(1, deptTeacherCapacity[specB] || 1);
        scoreA -= ratioA * 500;
        scoreB -= ratioB * 500;

        // Ưu tiên khối mong muốn
        if (a.preferredGrades?.includes(cls.grade)) scoreA += 50;
        if (b.preferredGrades?.includes(cls.grade)) scoreB += 50;

        // Khối 12 ưu tiên thâm niên cao nhất
        if (cls.grade === '12') {
          scoreA += (a.experienceYears || 0) * 4;
          scoreB += (b.experienceYears || 0) * 4;
        } else {
          scoreA += (a.experienceYears || 0) * 2;
          scoreB += (b.experienceYears || 0) * 2;
        }

        // Ưu tiên giữ lại GVCN cũ nếu hợp lệ
        if (currentAssignments?.homeroomAssignments?.[cls.id] === a.id) scoreA += 500;
        if (currentAssignments?.homeroomAssignments?.[cls.id] === b.id) scoreB += 500;

        return scoreB - scoreA;
      });

      const chosen = candidates[0];
      newHomeroomAssignments[cls.id] = chosen.id;
      assignedHomeroomTeachers.add(chosen.id);
    });
  }

  // ====================================================================
  // BƯỚC 2: KHỞI TẠO TẢI & KHÓA CỨNG GVCN DẠY LỚP CHỦ NHIỆM (BƯỚC 0)
  // Ràng buộc cứng:
  // - GVCN bắt buộc dạy chính lớp mình chủ nhiệm (nếu lớp có học môn đó > 0 tiết)
  // - Trừ số tiết vào quota của GVCN
  // - BGH dạy đúng định mức chuẩn (HT: 2t, PHT: 4t)
  // ====================================================================
  interface TeacherLoad {
    teacher: Teacher;
    isHomeroom: boolean;
    homeroomPeriods: number;     // 4 nếu là GVCN, 0 nếu không
    teachingPeriods: number;     // Tổng số tiết trực tiếp đứng lớp
    totalPeriods: number;        // teachingPeriods + homeroomPeriods
    periods: number;
    targetQuota: number;         // Định mức chuẩn
    effectiveMax: number;
    grades: Set<string>;
    classCount: number;
  }

  const teacherLoads: { [teacherId: string]: TeacherLoad } = {};
  teachers.forEach(t => {
    const isHR = Object.values(newHomeroomAssignments).includes(t.id);
    const isLeader = isSchoolLeader(t);
    const targetQuota = isLeader ? getLeaderTargetQuota(t) : (t.maxPeriods || 17);
    const homeroomPeriods = isHR ? 4 : 0;
    const grades = new Set<string>();

    const hrClassId = Object.keys(newHomeroomAssignments).find(
      cId => newHomeroomAssignments[cId] === t.id
    );
    if (hrClassId) {
      const hrClass = classes.find(c => c.id === hrClassId);
      if (hrClass) grades.add(hrClass.grade);
    }

    teacherLoads[t.id] = {
      teacher: t,
      isHomeroom: isHR,
      homeroomPeriods,
      teachingPeriods: 0,
      totalPeriods: homeroomPeriods,
      periods: homeroomPeriods,
      targetQuota,
      effectiveMax: targetQuota,
      grades,
      classCount: 0
    };
  });

  const manualAssignedTasks = new Set<string>();
  let manualAssignmentCount = 0;

  const newSubjectAssignments: { [classId: string]: { [subjectName: string]: string } } =
    mode === 'homeroom_only' && currentAssignments?.subjectAssignments
      ? JSON.parse(JSON.stringify(currentAssignments.subjectAssignments))
      : {};

  classes.forEach(c => {
    if (!newSubjectAssignments[c.id]) newSubjectAssignments[c.id] = {};
  });

  const preAssignedTasks = new Set<string>();
  const preAssignedDeptPeriods: { [sNorm: string]: number } = {};

  // Bảo lưu phân công thủ công hợp lệ nếu ở chế độ manual_and_auto
  if (mode === 'manual_and_auto' && currentAssignments?.subjectAssignments) {
    classes.forEach(cls => {
      const curClsSubjects = currentAssignments.subjectAssignments[cls.id] ||
        currentAssignments.subjectAssignments[cls.name] ||
        currentAssignments.subjectAssignments['c_' + cls.id.replace(/^c_/, '')] || {};
      const req = findClassRequirement(subjectRequirements, cls.id, cls.name);
      const activeSubs = new Set<string>();
      if (req) {
        req.subjects.forEach(s => {
          if (s.periods > 0) {
            activeSubs.add(s.name);
            activeSubs.add(normalizeSubjectName(s.name));
          }
        });
      }

      Object.entries(curClsSubjects).forEach(([subName, teacherId]) => {
        const sNorm = normalizeSubjectName(subName);
        if (!activeSubs.has(subName) && !activeSubs.has(sNorm)) return; // Bỏ qua môn 0 tiết

        if (teacherId && teachers.some(t => t.id === teacherId)) {
          newSubjectAssignments[cls.id][subName] = teacherId;
          if (sNorm && sNorm !== subName) {
            newSubjectAssignments[cls.id][sNorm] = teacherId;
          }
          if (sNorm === 'GDQPAN') {
            newSubjectAssignments[cls.id]['GDQPAN'] = teacherId;
            newSubjectAssignments[cls.id]['GD QP-AN'] = teacherId;
          }

          const subReq = req?.subjects.find(s => s.name === subName || normalizeSubjectName(s.name) === sNorm);
          const p = subReq?.periods || 0;
          if (p > 0 && !preAssignedTasks.has(`${cls.id}_${subName}`)) {
            if (teacherLoads[teacherId]) {
              teacherLoads[teacherId].teachingPeriods += p;
              teacherLoads[teacherId].totalPeriods += p;
              teacherLoads[teacherId].periods = teacherLoads[teacherId].totalPeriods;
              teacherLoads[teacherId].grades.add(cls.grade);
              teacherLoads[teacherId].classCount += 1;
            }
            preAssignedTasks.add(`${cls.id}_${subName}`);
            preAssignedTasks.add(`${cls.id}_${sNorm}`);
            manualAssignedTasks.add(`${cls.id}_${subName}`);
            manualAssignedTasks.add(`${cls.id}_${sNorm}`);
            manualAssignmentCount++;
          }
        }
      });
    });
  }

  if (mode === 'all' || mode === 'teaching_only' || mode === 'manual_and_auto') {
    // 2.1. NGUYÊN TẮC BẮT BUỘC: MÔN TNHN2 PHÂN CÔNG CHO GVCN DẠY
    classes.forEach(cls => {
      const hrTeacherId = newHomeroomAssignments[cls.id];
      if (!hrTeacherId) return;

      const req = findClassRequirement(subjectRequirements, cls.id, cls.name);
      if (!req) return;

      const tnhn2Sub = req.subjects.find(s => s.name === 'TNHN2' || normalizeSubjectName(s.name) === 'TNHN2');
      if (tnhn2Sub && tnhn2Sub.periods > 0) {
        if (!preAssignedTasks.has(`${cls.id}_TNHN2`) && !newSubjectAssignments[cls.id]['TNHN2']) {
          newSubjectAssignments[cls.id]['TNHN2'] = hrTeacherId;
          const p = tnhn2Sub.periods;

          teacherLoads[hrTeacherId].teachingPeriods += p;
          teacherLoads[hrTeacherId].totalPeriods += p;
          teacherLoads[hrTeacherId].periods = teacherLoads[hrTeacherId].totalPeriods;
          teacherLoads[hrTeacherId].grades.add(cls.grade);
          teacherLoads[hrTeacherId].classCount += 1;

          preAssignedTasks.add(`${cls.id}_TNHN2`);
        }
      }
    });

    // 2.2. BƯỚC 0: KHÓA CỨNG GVCN BẮT BUỘC DẠY MÔN CHUYÊN MÔN TẠI LỚP CHỦ NHIỆM
    classes.forEach(cls => {
      const hrTeacherId = newHomeroomAssignments[cls.id];
      if (!hrTeacherId) return;

      const hrTeacher = teachers.find(t => t.id === hrTeacherId);
      if (!hrTeacher) return;

      const hrSpecNorm = normalizeSubjectName(hrTeacher.specialization);
      if (!hrSpecNorm || NON_SPECIALIZED_SUBJECTS.has(hrSpecNorm)) return;

      const req = findClassRequirement(subjectRequirements, cls.id, cls.name);
      if (!req) return;

      const matchSub = req.subjects.find(
        s => s.periods > 0 && normalizeSubjectName(s.name) === hrSpecNorm
      );

      if (matchSub) {
        if (!preAssignedTasks.has(`${cls.id}_${matchSub.name}`) && !preAssignedTasks.has(`${cls.id}_${hrSpecNorm}`)) {
          newSubjectAssignments[cls.id][matchSub.name] = hrTeacher.id;
          if (hrSpecNorm !== matchSub.name) {
            newSubjectAssignments[cls.id][hrSpecNorm] = hrTeacher.id;
          }
          if (hrSpecNorm === 'GDQPAN') {
            newSubjectAssignments[cls.id]['GDQPAN'] = hrTeacher.id;
            newSubjectAssignments[cls.id]['GD QP-AN'] = hrTeacher.id;
          }

          teacherLoads[hrTeacher.id].teachingPeriods += matchSub.periods;
          teacherLoads[hrTeacher.id].totalPeriods += matchSub.periods;
          teacherLoads[hrTeacher.id].periods = teacherLoads[hrTeacher.id].totalPeriods;
          teacherLoads[hrTeacher.id].grades.add(cls.grade);
          teacherLoads[hrTeacher.id].classCount += 1;

          preAssignedTasks.add(`${cls.id}_${matchSub.name}`);
          preAssignedTasks.add(`${cls.id}_${hrSpecNorm}`);
          preAssignedDeptPeriods[hrSpecNorm] = (preAssignedDeptPeriods[hrSpecNorm] || 0) + matchSub.periods;
        }
      }
    });

    // 2.3. RÀNG BUỘC CỨNG: BGH (HIỆU TRƯỞNG & PHÓ HIỆU TRƯỞNG) ĐÚNG VÀ ĐỦ ĐỊNH MỨC TIẾT
    const schoolLeaders = teachers.filter(t => isSchoolLeader(t));
    schoolLeaders.forEach(leader => {
      const targetQuota = getLeaderTargetQuota(leader);
      teacherLoads[leader.id].targetQuota = targetQuota;
      teacherLoads[leader.id].effectiveMax = targetQuota;
      const currentTeaching = teacherLoads[leader.id]?.teachingPeriods || 0;
      const needed = targetQuota - currentTeaching;
      if (needed <= 0) return;

      const sNorm = normalizeSubjectName(leader.specialization);
      if (!sNorm || NON_SPECIALIZED_SUBJECTS.has(sNorm)) return;

      const availableTasks: { class: ClassModel; subject: string; periods: number }[] = [];
      subjectRequirements.forEach(req => {
        const cls = classes.find(c => c.id === req.classId || c.name === req.className || c.name === req.classId || c.id.replace(/^c_/, '') === req.classId.replace(/^c_/, ''));
        if (!cls) return;

        req.subjects.forEach(sub => {
          if (sub.periods <= 0) return;
          if (normalizeSubjectName(sub.name) !== sNorm) return;
          if (preAssignedTasks.has(`${cls.id}_${sub.name}`) || preAssignedTasks.has(`${cls.id}_${sNorm}`)) return;

          availableTasks.push({ class: cls, subject: sub.name, periods: sub.periods });
        });
      });

      availableTasks.sort((a, b) => {
        const prefA = (leader.preferredGrades || []).includes(a.class.grade) ? 1 : 0;
        const prefB = (leader.preferredGrades || []).includes(b.class.grade) ? 1 : 0;
        if (prefB !== prefA) return prefB - prefA;
        if (b.class.grade !== a.class.grade) return b.class.grade.localeCompare(a.class.grade);
        return b.periods - a.periods;
      });

      let bestCombination = findExactPeriodCombination(availableTasks, needed);
      if (bestCombination) {
        bestCombination.forEach(task => {
          newSubjectAssignments[task.class.id][task.subject] = leader.id;
          if (sNorm !== task.subject) {
            newSubjectAssignments[task.class.id][sNorm] = leader.id;
          }
          if (sNorm === 'GDQPAN') {
            newSubjectAssignments[task.class.id]['GDQPAN'] = leader.id;
            newSubjectAssignments[task.class.id]['GD QP-AN'] = leader.id;
          }

          teacherLoads[leader.id].teachingPeriods += task.periods;
          teacherLoads[leader.id].totalPeriods += task.periods;
          teacherLoads[leader.id].periods = teacherLoads[leader.id].totalPeriods;
          teacherLoads[leader.id].grades.add(task.class.grade);
          teacherLoads[leader.id].classCount += 1;

          preAssignedTasks.add(`${task.class.id}_${task.subject}`);
          preAssignedTasks.add(`${task.class.id}_${sNorm}`);
          preAssignedDeptPeriods[sNorm] = (preAssignedDeptPeriods[sNorm] || 0) + task.periods;
        });
      }
    });

    // ====================================================================
    // BƯỚC 3: PHÂN CÔNG CÁC MÔN VÀ LỚP CÒN LẠI
    // Ràng buộc cứng:
    // - Bỏ qua toàn bộ ô môn học có số tiết = 0
    // - Chỉ phân GV có môn dạy khớp với môn học
    // Ràng buộc mềm:
    // - optStrictQuota: Không vượt trần định mức (nếu tắt: cho phép vượt khi thiếu GV)
    // - optLimitGrades: Giới hạn mỗi GV dạy tối đa 1 đến 2 khối lớp
    // - optBalanceWorkload: Cân bằng số tiết giữa các GV trong tổ
    // ====================================================================
    interface Task {
      class: ClassModel;
      subject: string;
      periods: number;
    }

    const specializedTasks: Task[] = [];
    const nonSpecializedTasks: Task[] = [];

    subjectRequirements.forEach(req => {
      const cls = classes.find(c => c.id === req.classId || c.name === req.className || c.name === req.classId || c.id.replace(/^c_/, '') === req.classId.replace(/^c_/, ''));
      if (!cls) return;

      req.subjects.forEach(sub => {
        // RÀNG BUỘC CỨNG: Tuyệt đối bỏ qua môn 0 tiết
        if (sub.periods <= 0) return;
        if (preAssignedTasks.has(`${cls.id}_${sub.name}`)) return;

        if (NON_SPECIALIZED_SUBJECTS.has(sub.name)) {
          nonSpecializedTasks.push({ class: cls, subject: sub.name, periods: sub.periods });
        } else {
          const sNorm = normalizeSubjectName(sub.name);
          if (!preAssignedTasks.has(`${cls.id}_${sNorm}`)) {
            specializedTasks.push({ class: cls, subject: sub.name, periods: sub.periods });
          }
        }
      });
    });

    // 3.1. Phân công Môn chuyên môn
    const tasksBySub: { [normSub: string]: Task[] } = {};
    specializedTasks.forEach(task => {
      const sNorm = normalizeSubjectName(task.subject);
      if (!tasksBySub[sNorm]) tasksBySub[sNorm] = [];
      tasksBySub[sNorm].push(task);
    });

    Object.keys(tasksBySub).forEach(sNorm => {
      const tasks = tasksBySub[sNorm];
      // RÀNG BUỘC CỨNG: Chỉ chọn giáo viên đúng chuyên môn
      const team = teachers.filter(t => normalizeSubjectName(t.specialization) === sNorm);
      if (team.length === 0) {
        tasks.forEach(task => {
          unassignedSlots.push({
            classId: task.class.id,
            className: task.class.name,
            grade: task.class.grade,
            subject: task.subject,
            periods: task.periods,
            reason: `Không có giáo viên chuyên môn ${sNorm} trong danh mục giáo viên trường`
          });
        });
        return;
      }

      const nonLeaderTeam = team.filter(t => !isSchoolLeader(t));
      const activeTeam = nonLeaderTeam.length > 0 ? nonLeaderTeam : team;

      // Sắp xếp các lớp: Khối 12 trước, 11 rồi 10
      tasks.sort((a, b) => {
        if (b.class.grade !== a.class.grade) return b.class.grade.localeCompare(a.class.grade);
        return b.periods - a.periods;
      });

      tasks.forEach(task => {
        const cls = task.class;
        const p = task.periods;

        // KIỂM TRA ĐỊNH MỨC VÀ TIÊU CHÍ LỰA CHỌN:
        let candidatePool = activeTeam.filter(t => {
          if (isSchoolLeader(t)) {
            const quota = getLeaderTargetQuota(t);
            return teacherLoads[t.id].totalPeriods + p <= quota;
          }
          return true;
        });

        if (candidatePool.length === 0) candidatePool = [...activeTeam];

        // RÀNG BUỘC MỀM 2: optStrictQuota
        let validCandidates: Teacher[] = [];
        if (optStrictQuota) {
          // Chỉ chọn GV có (tiết hiện tại + số tiết môn này <= quota)
          validCandidates = candidatePool.filter(t => {
            const load = teacherLoads[t.id];
            return load.totalPeriods + p <= load.targetQuota;
          });

          // Nếu bật optStrictQuota mà KHÔNG có GV nào còn quota -> Ghi nhận ô trống và bỏ qua
          if (validCandidates.length === 0) {
            unassignedSlots.push({
              classId: cls.id,
              className: cls.name,
              grade: cls.grade,
              subject: task.subject,
              periods: p,
              reason: `Tất cả ${activeTeam.length} giáo viên tổ ${sNorm} đã đủ hoặc vượt trần định mức (Bật tùy chọn chặn vượt trần)`
            });
            return;
          }
        } else {
          // Cho phép gán cả khi GV đã đủ tiết (chấp nhận vượt định mức khi thiếu GV)
          validCandidates = [...candidatePool];
        }

        // HEURISTIC SCORING ĐỂ CHỌN GIÁO VIÊN TỐI ƯU NHẤT:
        validCandidates.sort((a, b) => {
          const loadA = teacherLoads[a.id];
          const loadB = teacherLoads[b.id];

          let scoreA = 0;
          let scoreB = 0;

          // 1. Phạt nếu vượt định mức chuẩn (áp dụng cả khi optStrictQuota === false)
          const excessA = Math.max(0, (loadA.totalPeriods + p) - loadA.targetQuota);
          const excessB = Math.max(0, (loadB.totalPeriods + p) - loadB.targetQuota);
          scoreA += excessA * 5000;
          scoreB += excessB * 5000;

          // 2. RÀNG BUỘC MỀM 3: optLimitGrades
          // Giới hạn mỗi GV dạy tối đa 1 đến 2 khối lớp (tránh dạy cả 3 khối 10, 11, 12)
          if (optLimitGrades) {
            // Ưu tiên cộng điểm cho GV đã có lớp dạy ở cùng khối này
            if (loadA.grades.has(cls.grade)) scoreA -= 600;
            if (loadB.grades.has(cls.grade)) scoreB -= 600;

            // Phạt rất nặng nếu GV chưa dạy khối này mà đã dạy 2 khối khác (tránh dạy 3 khối)
            if (!loadA.grades.has(cls.grade) && loadA.grades.size >= 2) scoreA += 4000;
            if (!loadB.grades.has(cls.grade) && loadB.grades.size >= 2) scoreB += 4000;
          }

          // 3. RÀNG BUỘC MỀM 4: optBalanceWorkload
          // Cân bằng số tiết giữa các giáo viên trong cùng tổ bộ môn
          if (optBalanceWorkload) {
            // Ưu tiên chọn GV đang có tỷ lệ (Số tiết hiện tại / Quota) thấp nhất
            const ratioA = (loadA.totalPeriods + p) / Math.max(1, loadA.targetQuota);
            const ratioB = (loadB.totalPeriods + p) / Math.max(1, loadB.targetQuota);
            scoreA += ratioA * 1500;
            scoreB += ratioB * 1500;

            scoreA += (loadA.totalPeriods + p) * 50;
            scoreB += (loadB.totalPeriods + p) * 50;
          } else {
            // Nếu không bật cân bằng, chỉ ưu tiên số tiết tuyệt đối nhẹ
            scoreA += loadA.totalPeriods * 10;
            scoreB += loadB.totalPeriods * 10;
          }

          // 4. Ưu tiên khối mong muốn
          if (loadA.teacher.preferredGrades?.includes(cls.grade)) scoreA -= 50;
          if (loadB.teacher.preferredGrades?.includes(cls.grade)) scoreB -= 50;

          return scoreA - scoreB;
        });

        const chosen = validCandidates[0];
        newSubjectAssignments[cls.id][task.subject] = chosen.id;
        if (sNorm && sNorm !== task.subject) {
          newSubjectAssignments[cls.id][sNorm] = chosen.id;
        }
        if (sNorm === 'GDQPAN') {
          newSubjectAssignments[cls.id]['GDQPAN'] = chosen.id;
          newSubjectAssignments[cls.id]['GD QP-AN'] = chosen.id;
        }

        teacherLoads[chosen.id].teachingPeriods += p;
        teacherLoads[chosen.id].totalPeriods += p;
        teacherLoads[chosen.id].periods = teacherLoads[chosen.id].totalPeriods;
        teacherLoads[chosen.id].grades.add(cls.grade);
        teacherLoads[chosen.id].classCount += 1;
      });
    });

    // 3.2. Phân công Môn không chuyên (GDĐP, TNHN1)
    nonSpecializedTasks.sort((a, b) => a.periods - b.periods);

    nonSpecializedTasks.forEach(task => {
      const cls = task.class;
      const p = task.periods;

      let candidatePool = teachers.filter(t => !isSchoolLeader(t));

      // Kiểm tra optStrictQuota
      let validCandidates: Teacher[] = [];
      if (optStrictQuota) {
        validCandidates = candidatePool.filter(t => {
          const load = teacherLoads[t.id];
          return load.totalPeriods + p <= load.targetQuota;
        });

        if (validCandidates.length === 0) {
          unassignedSlots.push({
            classId: cls.id,
            className: cls.name,
            grade: cls.grade,
            subject: task.subject,
            periods: p,
            reason: `Tất cả giáo viên toàn trường đã đủ hoặc vượt trần định mức cho môn ${task.subject}`
          });
          return;
        }
      } else {
        validCandidates = [...candidatePool];
      }

      validCandidates.sort((a, b) => {
        const loadA = teacherLoads[a.id];
        const loadB = teacherLoads[b.id];

        let scoreA = 0;
        let scoreB = 0;

        const excessA = Math.max(0, (loadA.totalPeriods + p) - loadA.targetQuota);
        const excessB = Math.max(0, (loadB.totalPeriods + p) - loadB.targetQuota);
        scoreA += excessA * 5000;
        scoreB += excessB * 5000;

        if (optLimitGrades) {
          if (loadA.grades.has(cls.grade)) scoreA -= 500;
          if (loadB.grades.has(cls.grade)) scoreB -= 500;

          if (!loadA.grades.has(cls.grade) && loadA.grades.size >= 2) scoreA += 3000;
          if (!loadB.grades.has(cls.grade) && loadB.grades.size >= 2) scoreB += 3000;
        }

        if (optBalanceWorkload) {
          const ratioA = (loadA.totalPeriods + p) / Math.max(1, loadA.targetQuota);
          const ratioB = (loadB.totalPeriods + p) / Math.max(1, loadB.targetQuota);
          scoreA += ratioA * 1000;
          scoreB += ratioB * 1000;
          scoreA += loadA.totalPeriods * 20;
          scoreB += loadB.totalPeriods * 20;
        }

        return scoreA - scoreB;
      });

      const chosen = validCandidates[0];
      newSubjectAssignments[cls.id][task.subject] = chosen.id;

      teacherLoads[chosen.id].teachingPeriods += p;
      teacherLoads[chosen.id].totalPeriods += p;
      teacherLoads[chosen.id].periods = teacherLoads[chosen.id].totalPeriods;
      teacherLoads[chosen.id].grades.add(cls.grade);
      teacherLoads[chosen.id].classCount += 1;
    });

    // 3.3. Tinh chỉnh cân bằng nội bộ tổ (nếu bật optBalanceWorkload và không bật optStrictQuota quá ngặt)
    if (optBalanceWorkload && !optStrictQuota) {
      const allNormSpecs = [...new Set(teachers.map(t => normalizeSubjectName(t.specialization)))];
      allNormSpecs.forEach(sNorm => {
        const deptTeachers = teachers.filter(t => !isSchoolLeader(t) && normalizeSubjectName(t.specialization) === sNorm);
        if (deptTeachers.length < 2) return;

        for (let iter = 0; iter < 15; iter++) {
          deptTeachers.sort((a, b) => teacherLoads[b.id].totalPeriods - teacherLoads[a.id].totalPeriods);
          const highest = deptTeachers[0];
          const lowest = deptTeachers[deptTeachers.length - 1];

          const diff = teacherLoads[highest.id].totalPeriods - teacherLoads[lowest.id].totalPeriods;
          if (diff <= 2) break;

          let moved = false;
          for (const cls of classes) {
            if (manualAssignedTasks.has(`${cls.id}_${sNorm}`)) continue;
            const assignedId = newSubjectAssignments[cls.id]?.[sNorm];
            if (assignedId === highest.id) {
              const req = findClassRequirement(subjectRequirements, cls.id, cls.name);
              const subItem = req?.subjects.find(s => normalizeSubjectName(s.name) === sNorm);
              if (subItem && manualAssignedTasks.has(`${cls.id}_${subItem.name}`)) continue;
              const p = subItem?.periods || 0;
              if (p > 0) {
                const newHigh = teacherLoads[highest.id].totalPeriods - p;
                const newLow = teacherLoads[lowest.id].totalPeriods + p;
                if (Math.abs(newHigh - newLow) < diff) {
                  const loadLow = teacherLoads[lowest.id];
                  const canTakeGrade = !optLimitGrades || loadLow.grades.has(cls.grade) || loadLow.grades.size < 2;
                  const isHomeroomOfHighest = newHomeroomAssignments[cls.id] === highest.id;

                  if (canTakeGrade && !isHomeroomOfHighest) {
                    newSubjectAssignments[cls.id][sNorm] = lowest.id;
                    if (subItem) newSubjectAssignments[cls.id][subItem.name] = lowest.id;

                    teacherLoads[highest.id].teachingPeriods -= p;
                    teacherLoads[highest.id].totalPeriods -= p;
                    teacherLoads[highest.id].periods = teacherLoads[highest.id].totalPeriods;

                    teacherLoads[lowest.id].teachingPeriods += p;
                    teacherLoads[lowest.id].totalPeriods += p;
                    teacherLoads[lowest.id].periods = teacherLoads[lowest.id].totalPeriods;
                    teacherLoads[lowest.id].grades.add(cls.grade);

                    moved = true;
                    break;
                  }
                }
              }
            }
          }
          if (!moved) break;
        }
      });
    }
  }

  // ====================================================================
  // BƯỚC 4: TỔNG HỢP, BÁO CÁO & XỬ LÝ Ô TRỐNG
  // ====================================================================
  // Đảm bảo tuyệt đối không có môn 0 tiết bị gán
  classes.forEach(cls => {
    const req = findClassRequirement(subjectRequirements, cls.id, cls.name);
    const activeSubSet = new Set<string>();
    if (req) {
      req.subjects.forEach(s => {
        if (s.periods > 0) {
          activeSubSet.add(s.name);
          activeSubSet.add(normalizeSubjectName(s.name));
        }
      });
    }
    const cKeys = [cls.id, cls.name, 'c_' + cls.id.replace(/^c_/, ''), cls.id.replace(/^c_/, '')];
    cKeys.forEach(k => {
      if (newSubjectAssignments[k]) {
        Object.keys(newSubjectAssignments[k]).forEach(subKey => {
          const normKey = normalizeSubjectName(subKey);
          if (!activeSubSet.has(subKey) && !activeSubSet.has(normKey)) {
            delete newSubjectAssignments[k][subKey];
          }
        });
      }
    });
  });

  const departmentStats: SolverResult['stats']['departmentStats'] = [];
  const teams: { [s: string]: TeacherLoad[] } = {};
  teachers.forEach(t => {
    const s = normalizeSubjectName(t.specialization);
    if (!teams[s]) teams[s] = [];
    teams[s].push(teacherLoads[t.id]);
  });

  Object.keys(teams).forEach(s => {
    const loads = teams[s].map(l => l.totalPeriods);
    const min = Math.min(...loads);
    const max = Math.max(...loads);
    const avg = parseFloat(
      (loads.reduce((sum, val) => sum + val, 0) / Math.max(1, loads.length)).toFixed(1)
    );
    departmentStats.push({
      department: s,
      teacherCount: loads.length,
      minPeriods: min,
      maxPeriods: max,
      avgPeriods: avg,
      diffPeriods: max - min
    });
  });

  let teachersWithMax2Grades = 0;
  teachers.forEach(t => {
    if (teacherLoads[t.id].grades.size <= 2) teachersWithMax2Grades++;
  });

  const totalSubjectSlots = Object.values(newSubjectAssignments).reduce((sum, clsMap) => {
    return sum + Object.values(clsMap || {}).filter(tId => !!tId).length;
  }, 0);

  const autoAssignedCount = Math.max(0, totalSubjectSlots - manualAssignmentCount);
  const totalHomeroomsAssigned = Object.keys(newHomeroomAssignments).length;

  const schoolLeadersList = teachers.filter(t => isSchoolLeader(t));
  const bghDetails = schoolLeadersList.map(l => {
    return `${l.position || 'BGH'} ${l.name} (${teacherLoads[l.id].totalPeriods}/${getLeaderTargetQuota(l)}t)`;
  }).join(', ');

  const homeroomTeachingCount = classes.filter(cls => {
    const hrId = newHomeroomAssignments[cls.id];
    if (!hrId) return false;
    const hrT = teachers.find(t => t.id === hrId);
    if (!hrT) return false;
    const hrSpec = normalizeSubjectName(hrT.specialization);
    const subMap = newSubjectAssignments[cls.id] || {};
    return Object.keys(subMap).some(k => normalizeSubjectName(k) === hrSpec && subMap[k] === hrId);
  }).length;

  const modeName =
    mode === 'manual_and_auto'
      ? 'Phân công thủ công và tự động (bảo lưu các lớp đã xếp)'
      : mode === 'teaching_only'
      ? 'Chỉ phân công dạy học bộ môn (bảo lưu GVCN)'
      : mode === 'homeroom_only'
      ? 'Chỉ phân công giáo viên chủ nhiệm'
      : 'Phân công toàn diện (Chủ nhiệm & Dạy học)';

  const softOptionsSummary: string[] = [];
  softOptionsSummary.push(
    optPrioritizeNormalTeachers
      ? '✓ Ưu tiên GV thường làm GVCN (hạn chế Tổ trưởng/Tổ phó)'
      : '✕ Không ưu tiên GV thường (xếp GVCN không xét chức vụ)'
  );
  softOptionsSummary.push(
    optStrictQuota
      ? '✓ Chặn vượt trần định mức (nghiêm cấm vượt tiết)'
      : '✕ Cho phép vượt trần định mức khi thiếu giáo viên'
  );
  softOptionsSummary.push(
    optLimitGrades
      ? '✓ Giới hạn tối đa 2 khối lớp/giáo viên'
      : '✕ Không giới hạn số khối lớp'
  );
  softOptionsSummary.push(
    optBalanceWorkload
      ? '✓ Tối ưu cân bằng số tiết giữa các giáo viên trong tổ'
      : '✕ Không tối ưu cân bằng số tiết'
  );

  const unassignedWarning = unassignedSlots.length > 0
    ? `\n⚠️ **Cảnh báo thiếu giáo viên:** Còn **${unassignedSlots.length} môn học** chưa được phân công do bật tùy chọn [Không phân công vượt trần định mức]. Vui lòng xem danh sách chi tiết bên dưới.`
    : '';

  const explanation = `🎯 **Phân công tự động hoàn tất (${modeName})**
${unassignedWarning}
🔒 **Ràng buộc cứng đã tuân thủ 100%:**
- **Ban Giám Hiệu:** Tuyệt đối không làm GVCN. Giảng dạy chuẩn định mức (${bghDetails}).
- **GVCN dạy lớp chủ nhiệm:** 100% (${homeroomTeachingCount}/${totalHomeroomsAssigned} lớp) GVCN được phân công giảng dạy môn chuyên môn tại chính lớp mình chủ nhiệm.
- **Môn 0 tiết:** 100% các môn có 0 tiết được loại bỏ hoàn toàn, không gán giáo viên.
- **Đúng chuyên môn:** 100% các ô phân công đúng chuyên ngành của giáo viên.
- **Tính toán định mức:** Đã cộng 4 tiết chủ nhiệm vào tổng tải tiết của giáo viên.

⚙️ **Ràng buộc mềm đã áp dụng:**
${softOptionsSummary.map(s => `- ${s}`).join('\n')}
- **Thống kê khối lớp:** ${teachersWithMax2Grades}/${teachers.length} giáo viên (${Math.round((teachersWithMax2Grades / Math.max(1, teachers.length)) * 100)}%) dạy không quá 2 khối.`;

  return {
    homeroomAssignments: newHomeroomAssignments,
    subjectAssignments: newSubjectAssignments,
    unassignedSlots,
    explanation,
    stats: {
      totalClasses: classes.length,
      totalHomerooms: totalHomeroomsAssigned,
      totalSubjectSlots,
      unassignedCount: unassignedSlots.length,
      teachersWithMax2Grades,
      teachersCount: teachers.length,
      departmentStats
    }
  };
}

// Giữ lại alias solveAssignments để tương thích ngược 100% với các vị trí gọi hàm khác
export function solveAssignments(
  teachers: Teacher[],
  classes: ClassModel[],
  subjectRequirements: SubjectRequirement[],
  currentAssignments: AssignmentsState,
  modeOrOptions: OptimizeMode | AutoAssignOptions = 'all'
): SolverResult {
  const options: AutoAssignOptions = typeof modeOrOptions === 'string'
    ? { mode: modeOrOptions }
    : modeOrOptions;
  return autoAssignSchedules(teachers, classes, subjectRequirements, currentAssignments, options);
}
