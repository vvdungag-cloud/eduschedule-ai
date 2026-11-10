import * as XLSX from 'xlsx';
import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  PageOrientation,
  Packer,
  VerticalAlign,
  BorderStyle
} from 'docx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { toCanvas } from 'html-to-image';

export interface SchoolInfo {
  schoolName: string;
  departmentName: string;
  academicYear: string;
  semester: string;
  createdDate: string;
  principalName?: string;
  deanName?: string;
  creatorName?: string;
  teachingWeeks?: number;
  applyDate?: string;
  circularNumber?: string;
}

/**
 * Trích xuất mã học kỳ chuẩn hóa (HKI hoặc HKII) từ chuỗi học kỳ
 */
export const getSemesterCode = (semester?: string): 'HKI' | 'HKII' => {
  if (!semester) return 'HKI';
  const clean = semester.toUpperCase().trim();
  if (clean.includes('II') || clean.includes('2') || clean.includes('HAI') || clean.includes('HK2')) {
    return 'HKII';
  }
  return 'HKI';
};

export interface ExportData {
  classes: Array<{ id: string; name: string; grade: '10' | '11' | '12' }>;
  teachers: Array<{
    id: string;
    name: string;
    specialization: string;
    position?: string;
    maxPeriods: number;
    phone?: string;
    experienceYears?: number;
  }>;
  subjects: Array<{ id: string; name: string }>;
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  getSubjectPeriod: (subject: string, grade: '10' | '11' | '12', classId?: string) => number;
  getAssignedTeacherId: (classId: string, subjectId: string) => string | undefined;
  teacherStatsMap: Record<
    string,
    {
      assignedPeriods: number;
      homeroomPeriods: number;
      totalPeriods: number;
      maxQuota: number;
      isHomeroom: boolean;
      homeroomClass?: string;
      assignedClasses: string[];
      warnings?: string[];
    }
  >;
  schoolInfo: SchoolInfo;
  sortBy?: ReportSortOption;
}

export type ReportSortOption = 'default' | 'subject' | 'position' | 'name_abc';

export const getVietnameseSortKey = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName.trim().toLowerCase();
  const lastName = parts[parts.length - 1]; // Tên chính (An, Bình, Dũng...)
  const rest = parts.slice(0, parts.length - 1).join(' '); // Họ và đệm
  return `${lastName} ${rest}`.toLowerCase();
};

export const compareVietnameseNames = (nameA: string, nameB: string): number => {
  const keyA = getVietnameseSortKey(nameA);
  const keyB = getVietnameseSortKey(nameB);
  return keyA.localeCompare(keyB, 'vi', { sensitivity: 'base' });
};

export const getPositionPriority = (pos?: string): number => {
  if (!pos) return 99;
  const p = pos.trim().toLowerCase();
  if (p === 'hiệu trưởng') return 1;
  if (p.includes('hiệu trưởng') && !p.includes('phó')) return 1;
  if (p.includes('phó hiệu trưởng')) return 2;
  if (p.includes('tổ trưởng') || p.includes('ttcm')) return 3;
  if (p.includes('tổ phó') || p.includes('tpcm')) return 4;
  if (p.includes('bí thư') || p.includes('công đoàn')) return 5;
  if (p.includes('giáo viên') || p.includes('gv')) return 6;
  return 7;
};

const SUBJECT_ORDER: Record<string, number> = {
  'toán': 1,
  'toan': 1,
  'vật lí': 2,
  'vật lý': 2,
  'lí': 2,
  'ly': 2,
  'hóa học': 3,
  'hóa': 3,
  'sinh học': 4,
  'sinh': 4,
  'tin học': 5,
  'tin': 5,
  'ngữ văn': 6,
  'văn': 6,
  'lịch sử': 7,
  'sử': 7,
  'địa lí': 8,
  'địa lý': 8,
  'địa': 8,
  'tiếng anh': 9,
  'ngoại ngữ': 9,
  'anh': 9,
  'gdtc': 10,
  'thể dục': 10,
  'gdqp-an': 11,
  'gdqp': 11,
  'công nghệ': 12,
  'âm nhạc': 13,
  'mỹ thuật': 14,
  'gdcd': 15,
  'ktpl': 15
};

export const getSubjectPriority = (spec?: string): number => {
  if (!spec) return 99;
  const s = spec.trim().toLowerCase();
  for (const [key, val] of Object.entries(SUBJECT_ORDER)) {
    if (s.includes(key) || key.includes(s)) return val;
  }
  return 50;
};

export const sortTeachersList = <T extends { name: string; position?: string; specialization?: string }>(
  teachers: T[],
  sortBy: ReportSortOption = 'default'
): T[] => {
  if (sortBy === 'default') return [...teachers];

  return [...teachers].sort((a, b) => {
    if (sortBy === 'name_abc') {
      return compareVietnameseNames(a.name, b.name);
    }
    if (sortBy === 'position') {
      const pDiff = getPositionPriority(a.position) - getPositionPriority(b.position);
      if (pDiff !== 0) return pDiff;
      return compareVietnameseNames(a.name, b.name);
    }
    if (sortBy === 'subject') {
      const sDiff = getSubjectPriority(a.specialization) - getSubjectPriority(b.specialization);
      if (sDiff !== 0) return sDiff;
      const pDiff = getPositionPriority(a.position) - getPositionPriority(b.position);
      if (pDiff !== 0) return pDiff;
      return compareVietnameseNames(a.name, b.name);
    }
    return 0;
  });
};

export interface Mau04RowData {
  stt: number;
  name: string;
  degree: string;
  mainDuty: string;
  concurrentDuty: string;
  subjectName: string;
  assignedClassesText: string;
  weeks: number;
  col1_standardWeekly: number;
  col2_teachingWeekly: number;
  col3_concurrentWeekly: number;
  col4_totalWeekly: number;
  col5_overWeekly: number | '';
  col6_underWeekly: number | string | '';
  col7_standardSemester: number;
  col8_teachingSemester: number;
  col9_concurrentSemester: number;
  col10_totalSemester: number;
  col11_hsg: number | '';
  col12_overSemester: number | '';
  col13_underSemester: number | '';
  applyDate: string;
}

/**
 * Tính toán danh sách dữ liệu cho Báo cáo Mẫu 04 (Thông tư 05/2025/TT-BGDĐT)
 */
export const calculateMau04Rows = (data: ExportData): Mau04RowData[] => {
  const {
    classes,
    teachers,
    subjects,
    assignments,
    getSubjectPeriod,
    getAssignedTeacherId,
    teacherStatsMap,
    schoolInfo,
    sortBy = 'default'
  } = data;

  const sortedTeachers = sortTeachersList(teachers, sortBy);

  const semCode = getSemesterCode(schoolInfo.semester);
  const weeks = schoolInfo.teachingWeeks || (semCode === 'HKII' ? 17 : 18);
  const applyDate = schoolInfo.applyDate || '08/9/2025';

  return sortedTeachers.map((t, idx) => {
    const stat = teacherStatsMap[t.id] || {
      assignedPeriods: 0,
      homeroomPeriods: 0,
      totalPeriods: 0,
      maxQuota: t.maxPeriods || 17,
      isHomeroom: false,
      homeroomClass: '',
      assignedClasses: []
    };

    // 1. Chuyên môn: "ĐHSP " + specialization
    const degree = t.specialization ? `ĐHSP ${t.specialization}` : 'ĐHSP';
    const mainDuty = 'Dạy';

    // 2. Kiêm nhiệm & số tiết kiêm
    let concurrentDuty = '';
    let concurrentPeriods = 0;
    const pos = (t.position || '').trim();
    const posLower = pos.toLowerCase();

    const hasPosition = 
      posLower.includes('hiệu trưởng') || 
      posLower.includes('phó hiệu trưởng') || 
      posLower.includes('tổ trưởng') ||
      posLower.includes('tổ phó') ||
      posLower.includes('bí thư') ||
      posLower.includes('công đoàn') ||
      (posLower !== '' && posLower !== 'giáo viên' && posLower !== 'gv' && posLower !== 'giáo viên bộ môn');

    if (posLower.includes('tổ trưởng')) {
      concurrentDuty = 'TTCM';
    } else if (posLower.includes('tổ phó')) {
      concurrentDuty = 'TPCM';
    } else if (posLower.includes('bí thư') && !posLower.includes('phó')) {
      concurrentDuty = 'Bí thư Đoàn';
    } else if (posLower.includes('phó bí thư')) {
      concurrentDuty = 'Phó Bí thư Đoàn';
    } else if (posLower.includes('công đoàn')) {
      concurrentDuty = 'Chủ tịch CĐ';
    } else if (posLower === 'hiệu trưởng') {
      concurrentDuty = 'Hiệu trưởng';
    } else if (posLower === 'phó hiệu trưởng') {
      concurrentDuty = 'Phó Hiệu trưởng';
    } else if (pos && pos !== 'Giáo viên') {
      concurrentDuty = pos;
    }

    if (stat.isHomeroom && stat.homeroomClass) {
      const hrDuty = `GVCN ${stat.homeroomClass}`;
      concurrentDuty = concurrentDuty ? `${concurrentDuty}, ${hrDuty}` : hrDuty;
      // Chỉ giáo viên không giữ chức vụ lãnh đạo/tổ mới cộng 4 tiết kiêm nhiệm (theo yêu cầu các GV có chức vụ thì cột Kiêm = 0)
      if (!hasPosition) {
        concurrentPeriods += 4;
      }
    }

    // Các giáo viên có chức vụ: Hiệu trưởng, Phó Hiệu trưởng, Tổ trưởng, ... cột Kiêm có giá trị bằng 0
    if (hasPosition) {
      concurrentPeriods = 0;
    }

    // 3. Các lớp giảng dạy
    // Thu thập tất cả các phân công dạy thực tế của giáo viên t
    interface TeacherTask {
      subjectId: string;
      subjectName: string;
      classId: string;
      className: string;
      grade: '10' | '11' | '12';
      periods: number;
    }

    const teacherTasks: TeacherTask[] = [];

    classes.forEach(cls => {
      subjects.forEach(sub => {
        const assignedId = getAssignedTeacherId(cls.id, sub.id);
        if (assignedId === t.id) {
          const p = getSubjectPeriod(sub.id, cls.grade, cls.id);
          if (p > 0) {
            teacherTasks.push({
              subjectId: sub.id,
              subjectName: sub.name || sub.id,
              classId: cls.id,
              className: cls.name,
              grade: cls.grade,
              periods: p
            });
          }
        }
      });
    });

    // Nhóm theo môn học
    const tasksBySubjectMap = new Map<string, { subjectName: string; tasks: TeacherTask[] }>();
    teacherTasks.forEach(task => {
      if (!tasksBySubjectMap.has(task.subjectId)) {
        tasksBySubjectMap.set(task.subjectId, {
          subjectName: task.subjectName,
          tasks: []
        });
      }
      tasksBySubjectMap.get(task.subjectId)!.tasks.push(task);
    });

    const distinctSubjectEntries = Array.from(tasksBySubjectMap.entries());
    let assignedClassesText = 'Chưa phân công';
    let displaySubjectName = t.specialization || '';

    if (distinctSubjectEntries.length === 1) {
      // TRƯỜNG HỢP 1: CHỈ DẠY 1 MÔN DUY NHẤT
      // Theo yêu cầu: "nếu chỉ dạy 1 môn thì liệt kê các lớp dạy (các lớp cách nhau bằng dấu phẩy), không ghi tên môn phía trước."
      const singleSub = distinctSubjectEntries[0][1];
      displaySubjectName = singleSub.subjectName || t.specialization;

      // Gom lớp theo khối (10, 11, 12), các lớp cách nhau bằng dấu phẩy
      const lines: string[] = [];
      (['10', '11', '12'] as const).forEach(gr => {
        const grTasks = singleSub.tasks.filter(tk => tk.grade === gr);
        if (grTasks.length > 0) {
          const classList = grTasks.map(tk => tk.className).join(', ');
          const grPeriods = grTasks.reduce((sum, tk) => sum + tk.periods, 0);
          lines.push(`${classList} (${grPeriods})`);
        }
      });

      assignedClassesText = lines.length > 0 ? lines.join('\n') : 'Chưa phân công';
    } else if (distinctSubjectEntries.length > 1) {
      // TRƯỜNG HỢP 2: DẠY TỪ 2 MÔN TRỞ LÊN (Ví dụ môn chuyên môn + môn TNHN, GDĐP, kiêm...)
      let mainEntry = distinctSubjectEntries.find(([subId, val]) => 
        subId === t.specialization || 
        val.subjectName === t.specialization ||
        val.subjectName.toLowerCase().includes((t.specialization || '').toLowerCase())
      );
      if (!mainEntry) {
        mainEntry = distinctSubjectEntries.slice().sort((a, b) => {
          const sumA = a[1].tasks.reduce((acc, x) => acc + x.periods, 0);
          const sumB = b[1].tasks.reduce((acc, x) => acc + x.periods, 0);
          return sumB - sumA;
        })[0];
      }

      displaySubjectName = mainEntry ? mainEntry[1].subjectName : t.specialization;

      const lines: string[] = [];

      // Môn chính: Liệt kê các lớp cách nhau bằng dấu phẩy, không ghi tên môn phía trước
      if (mainEntry) {
        (['10', '11', '12'] as const).forEach(gr => {
          const grTasks = mainEntry![1].tasks.filter(tk => tk.grade === gr);
          if (grTasks.length > 0) {
            const classList = grTasks.map(tk => tk.className).join(', ');
            const grPeriods = grTasks.reduce((sum, tk) => sum + tk.periods, 0);
            lines.push(`${classList} (${grPeriods})`);
          }
        });
      }

      // Các môn phụ (như TNHN, GDĐP...): Ghi tiền tố tên môn phía trước để phân biệt
      distinctSubjectEntries.forEach(([subId, entry]) => {
        if (subId === mainEntry?.[0]) return;
        const isTNHN = subId.includes('TNHN') || entry.subjectName.includes('TNHN') || entry.subjectName.includes('Trải nghiệm');
        const prefix = isTNHN ? 'TN+HN' : entry.subjectName;

        const classList = entry.tasks.map(tk => `${tk.className}(${tk.periods})`).join(', ');
        lines.push(`${prefix}: ${classList}`);
      });

      assignedClassesText = lines.length > 0 ? lines.join('\n') : 'Chưa phân công';
    } else {
      assignedClassesText = 'Chưa phân công';
      displaySubjectName = t.specialization || '-';
    }

    // 4. Các số liệu tính toán chuẩn theo Thông tư 05/2025/TT-BGDĐT
    // Số tiết quy định/tuần lấy chính xác theo Định mức của từng giáo viên
    const col1_standardWeekly = typeof t.maxPeriods === 'number'
      ? t.maxPeriods 
      : (stat.maxQuota ?? 17);
    const col2_teachingWeekly = stat.assignedPeriods;
    const col3_concurrentWeekly = concurrentPeriods;
    const col4_totalWeekly = col2_teachingWeekly + col3_concurrentWeekly;

    const col1_diff = col4_totalWeekly - col1_standardWeekly;
    const col5_overWeekly: number | '' = col1_diff > 0 ? Number(col1_diff.toFixed(1)) : '';
    const col6_underWeekly: number | '' = col1_diff < 0 ? Number(Math.abs(col1_diff).toFixed(1)) : '';

    const col7_standardSemester = Number((col1_standardWeekly * weeks).toFixed(1));
    const col8_teachingSemester = Number((col2_teachingWeekly * weeks).toFixed(1));
    const col9_concurrentSemester = Number((col3_concurrentWeekly * weeks).toFixed(1));
    const col10_totalSemester = Number((col8_teachingSemester + col9_concurrentSemester).toFixed(1));

    const col11_hsg: number | '' = '';
    const semesterDiff = col10_totalSemester - col7_standardSemester;
    const col12_overSemester: number | '' = semesterDiff > 0 ? Number(semesterDiff.toFixed(1)) : '';
    const col13_underSemester: number | '' = semesterDiff < 0 ? Number(Math.abs(semesterDiff).toFixed(1)) : '';

    return {
      stt: idx + 1,
      name: t.name,
      degree,
      mainDuty,
      concurrentDuty,
      subjectName: displaySubjectName || t.specialization || 'Văn',
      assignedClassesText,
      weeks,
      col1_standardWeekly,
      col2_teachingWeekly,
      col3_concurrentWeekly,
      col4_totalWeekly,
      col5_overWeekly,
      col6_underWeekly,
      col7_standardSemester,
      col8_teachingSemester,
      col9_concurrentSemester,
      col10_totalSemester,
      col11_hsg,
      col12_overSemester,
      col13_underSemester,
      applyDate
    };
  });
};

/**
 * Xuất dữ liệu sang file Excel theo chuẩn Mẫu 04 (Thông tư 05/2025/TT-BGDĐT)
 */
export const exportMau04ToExcel = (data: ExportData) => {
  const { schoolInfo } = data;
  const rows = calculateMau04Rows(data);
  const semCode = getSemesterCode(schoolInfo.semester);
  const semFull = schoolInfo.semester || (semCode === 'HKII' ? 'Học kỳ II' : 'Học kỳ I');
  const weeks = schoolInfo.teachingWeeks || (semCode === 'HKII' ? 17 : 18);

  const wb = XLSX.utils.book_new();
  const sheetData: any[][] = [];

  // Dòng 1 - 7: Tiêu đề và Quốc hiệu
  sheetData.push([schoolInfo.departmentName.toUpperCase(), '', '', '', '', '', '', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM']);
  sheetData.push([schoolInfo.schoolName.toUpperCase(), '', '', '', '', '', '', 'Độc lập - Tự do - Hạnh phúc']);
  sheetData.push([]);
  sheetData.push([]);
  sheetData.push([`BẢNG PHÂN CÔNG GIẢNG DẠY ${semFull.toUpperCase()} NĂM HỌC ${schoolInfo.academicYear}`]);
  sheetData.push([schoolInfo.circularNumber || 'Thực hiện theo Thông tư số 05/2025/TT-BGDĐT ngày 07/03/2025 của Bộ GDĐT quy định về chế độ làm việc đối với giáo viên phổ thông, dự bị đại học']);
  sheetData.push(['', '', '', semCode, weeks, 'TUẦN']);

  // Dòng 8: Header Cấp 1
  sheetData.push([
    'STT',
    'Họ và tên',
    'Chuyên môn',
    'Nhiệm vụ',
    '',
    'Môn dạy',
    'Các lớp giảng dạy',
    `Số tuần thực dạy ${semCode}`,
    'Số tiết quy định/ tuần',
    'Số tiết thực tế dạy/tuần',
    '',
    '',
    'Số tiết thừa/ tuần',
    'Số tiết thiếu/ tuần',
    `Số tiết quy định/ ${semCode}`,
    `Số tiết thực tế dạy/${semCode} (${weeks} tuần)`,
    '',
    '',
    'BD HSG TN CĐ',
    `Số tiết thừa/ ${semCode}`,
    `Số tiết thiếu/ ${semCode}`,
    'Ngày áp dụng'
  ]);

  // Dòng 9: Header Cấp 2
  sheetData.push([
    '',
    '',
    '',
    'Chính',
    'Kiêm nhiệm',
    '',
    '',
    '',
    '',
    'Thực dạy',
    'Kiêm',
    'Cộng',
    '',
    '',
    '',
    'Thực dạy',
    'Kiêm',
    'Cộng',
    '',
    '',
    '',
    ''
  ]);

  // Dòng 10: Dòng ký hiệu chữ cái và công thức toán học (như ảnh)
  sheetData.push([
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'G',
    '',
    '1',
    '2',
    '3',
    '4=2+3',
    '5=4-1',
    '6=1-4',
    '7',
    '8',
    '9',
    '10=8+9',
    '11',
    '12=10-7+11',
    '13=7-10+11',
    ''
  ]);

  // Dòng 11+: Dữ liệu từng giáo viên
  rows.forEach(r => {
    sheetData.push([
      r.stt,
      r.name,
      r.degree,
      r.mainDuty,
      r.concurrentDuty,
      r.subjectName,
      r.assignedClassesText,
      r.weeks,
      r.col1_standardWeekly,
      r.col2_teachingWeekly,
      r.col3_concurrentWeekly,
      r.col4_totalWeekly,
      r.col5_overWeekly,
      r.col6_underWeekly,
      r.col7_standardSemester,
      r.col8_teachingSemester,
      r.col9_concurrentSemester,
      r.col10_totalSemester,
      r.col11_hsg,
      r.col12_overSemester,
      r.col13_underSemester,
      r.applyDate
    ]);
  });

  const principalTeacher = data.teachers.find(t => t.position?.trim().toLowerCase() === 'hiệu trưởng')
    || data.teachers.find(t => t.position?.includes('Hiệu trưởng') && !t.position?.includes('Phó'));
  const principalDisplayName = (schoolInfo.principalName && schoolInfo.principalName !== 'Hiệu trưởng' && schoolInfo.principalName !== 'Hiệu trưởng nhà trường')
    ? schoolInfo.principalName
    : (principalTeacher?.name || 'Ngô Thị Kiều Huệ');

  const creatorDisplayName = (schoolInfo.creatorName && schoolInfo.creatorName !== 'Bộ phận Chuyên môn' && schoolInfo.creatorName !== 'Bộ phận chuyên môn')
    ? schoolInfo.creatorName
    : 'Võ Việt Dũng';

  // Chân báo cáo phê duyệt (Chữ ký 2 cột)
  sheetData.push([]);
  sheetData.push([]);
  const signRowIdx = sheetData.length;
  sheetData.push([
    '', 'NGƯỜI LẬP BẢNG', '', '', '', '', '', '', '', '', '', '', '', '', '', 'HIỆU TRƯỞNG', '', '', '', '', '', ''
  ]);
  sheetData.push([
    '', '(Ký và ghi rõ họ tên)', '', '', '', '', '', '', '', '', '', '', '', '', '', '(Ký, ghi rõ họ tên & đóng dấu)', '', '', '', '', '', ''
  ]);
  sheetData.push([]);
  sheetData.push([]);
  sheetData.push([]);
  sheetData.push([
    '', creatorDisplayName, '', '', '', '', '', '', '', '', '', '', '', '', '', principalDisplayName, '', '', '', '', '', ''
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Thiết lập ô gộp (Merges)
  ws['!merges'] = [
    // Quốc hiệu & Tiêu ngữ 2 dòng
    { s: { r: 0, c: 7 }, e: { r: 0, c: 21 } },
    { s: { r: 1, c: 7 }, e: { r: 1, c: 21 } },
    // Tiêu đề chính
    { s: { r: 4, c: 0 }, e: { r: 4, c: 21 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 21 } },
    // Header Cấp 1 & 2
    { s: { r: 7, c: 0 }, e: { r: 8, c: 0 } }, // STT
    { s: { r: 7, c: 1 }, e: { r: 8, c: 1 } }, // Họ và tên
    { s: { r: 7, c: 2 }, e: { r: 8, c: 2 } }, // Chuyên môn
    { s: { r: 7, c: 3 }, e: { r: 7, c: 4 } }, // Nhiệm vụ
    { s: { r: 7, c: 5 }, e: { r: 8, c: 5 } }, // Môn dạy
    { s: { r: 7, c: 6 }, e: { r: 8, c: 6 } }, // Các lớp giảng dạy
    { s: { r: 7, c: 7 }, e: { r: 8, c: 7 } }, // Số tuần thực dạy HKI
    { s: { r: 7, c: 8 }, e: { r: 8, c: 8 } }, // Số tiết quy định/ tuần
    { s: { r: 7, c: 9 }, e: { r: 7, c: 11 } }, // Số tiết thực tế dạy/tuần
    { s: { r: 7, c: 12 }, e: { r: 8, c: 12 } }, // Số tiết thừa/ tuần
    { s: { r: 7, c: 13 }, e: { r: 8, c: 13 } }, // Số tiết thiếu/ tuần
    { s: { r: 7, c: 14 }, e: { r: 8, c: 14 } }, // Số tiết quy định/ HKI
    { s: { r: 7, c: 15 }, e: { r: 7, c: 17 } }, // Số tiết thực tế dạy/HKI
    { s: { r: 7, c: 18 }, e: { r: 8, c: 18 } }, // BD HSG
    { s: { r: 7, c: 19 }, e: { r: 8, c: 19 } }, // Số tiết thừa/ HKI
    { s: { r: 7, c: 20 }, e: { r: 8, c: 20 } }, // Số tiết thiếu/ HKI
    { s: { r: 7, c: 21 }, e: { r: 8, c: 21 } }, // Ngày áp dụng
    // Chữ ký 2 cột
    { s: { r: signRowIdx, c: 1 }, e: { r: signRowIdx, c: 7 } },
    { s: { r: signRowIdx + 1, c: 1 }, e: { r: signRowIdx + 1, c: 7 } },
    { s: { r: signRowIdx + 5, c: 1 }, e: { r: signRowIdx + 5, c: 7 } },

    { s: { r: signRowIdx, c: 15 }, e: { r: signRowIdx, c: 21 } },
    { s: { r: signRowIdx + 1, c: 15 }, e: { r: signRowIdx + 1, c: 21 } },
    { s: { r: signRowIdx + 5, c: 1 }, e: { r: signRowIdx + 5, c: 21 } }
  ];

  // Độ rộng các cột
  ws['!cols'] = [
    { wch: 5 },  // A: STT
    { wch: 22 }, // B: Họ tên
    { wch: 12 }, // C: Chuyên môn
    { wch: 8 },  // D: Chính
    { wch: 14 }, // E: Kiêm nhiệm
    { wch: 9 },  // F: Môn dạy
    { wch: 24 }, // G: Các lớp giảng dạy
    { wch: 9 },  // Số tuần
    { wch: 10 }, // 1: Quy định/tuần
    { wch: 9 },  // 2: Thực dạy
    { wch: 8 },  // 3: Kiêm
    { wch: 9 },  // 4: Cộng
    { wch: 10 }, // 5: Thừa/tuần
    { wch: 10 }, // 6: Thiếu/tuần
    { wch: 11 }, // 7: Quy định HKI
    { wch: 9 },  // 8: Thực dạy HKI
    { wch: 8 },  // 9: Kiêm HKI
    { wch: 9 },  // 10: Cộng HKI
    { wch: 9 },  // 11: BD HSG
    { wch: 10 }, // 12: Thừa HKI
    { wch: 10 }, // 13: Thiếu HKI
    { wch: 12 }  // Ngày áp dụng
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Mau04_PhanCongGiangDay');
  const safeYear = schoolInfo.academicYear.replace(/\s+/g, '').replace('/', '-');
  XLSX.writeFile(wb, `Mau_04_Bang_Phan_Cong_Giang_Day_TT05_${semCode}_${safeYear}.xlsx`);
};

/**
 * Xuất dữ liệu sang file Word theo chuẩn Mẫu 04 (Thông tư 05/2025/TT-BGDĐT)
 */
export const exportMau04ToWord = async (data: ExportData) => {
  const { schoolInfo } = data;
  const rows = calculateMau04Rows(data);
  const semCode = getSemesterCode(schoolInfo.semester);
  const semFull = schoolInfo.semester || (semCode === 'HKII' ? 'Học kỳ II' : 'Học kỳ I');
  const weeks = schoolInfo.teachingWeeks || (semCode === 'HKII' ? 17 : 18);

  const tableRows: TableRow[] = [];

  // Header Cấp 1
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        createCell('STT', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Họ và tên', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Chuyên môn', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Nhiệm vụ', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', colSpan: 2 }),
        createCell('Môn dạy', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Các lớp giảng dạy', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell(`Số tuần thực dạy ${semCode}`, { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Số tiết quy định/ tuần', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Số tiết thực tế dạy/tuần', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', colSpan: 3 }),
        createCell('Số tiết thừa/ tuần', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Số tiết thiếu/ tuần', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell(`Số tiết quy định/ ${semCode}`, { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell(`Số tiết thực tế dạy/${semCode} (${weeks} tuần)`, { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', colSpan: 3 }),
        createCell('BD HSG TN CĐ', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell(`Số tiết thừa/ ${semCode}`, { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell(`Số tiết thiếu/ ${semCode}`, { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 }),
        createCell('Ngày áp dụng', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9', rowSpan: 2 })
      ]
    })
  );

  // Header Cấp 2
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        createCell('Chính', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Kiêm', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Thực', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Kiêm', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Cộng', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Thực', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Kiêm', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' }),
        createCell('Cộng', { bold: true, alignment: AlignmentType.CENTER, shading: 'F1F5F9' })
      ]
    })
  );

  // Header Cấp 3: Dòng ký hiệu công thức
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        createCell('A', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('B', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('C', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('D', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('E', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('F', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('G', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('1', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('2', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('3', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('4=2+3', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('5=4-1', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('6=1-4', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('7', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('8', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('9', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('10=8+9', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('11', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('12', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('13', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' }),
        createCell('', { alignment: AlignmentType.CENTER, shading: 'F8FAFC' })
      ]
    })
  );

  // Data rows
  rows.forEach(r => {
    tableRows.push(
      new TableRow({
        children: [
          createCell(`${r.stt}`, { alignment: AlignmentType.CENTER }),
          createCell(r.name, { bold: true }),
          createCell(r.degree, { alignment: AlignmentType.CENTER }),
          createCell(r.mainDuty, { alignment: AlignmentType.CENTER }),
          createCell(r.concurrentDuty, { alignment: AlignmentType.CENTER }),
          createCell(r.subjectName, { alignment: AlignmentType.CENTER }),
          createCell(r.assignedClassesText),
          createCell(`${r.weeks}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col1_standardWeekly}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col2_teachingWeekly}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col3_concurrentWeekly}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col4_totalWeekly}`, { bold: true, alignment: AlignmentType.CENTER }),
          createCell(`${r.col5_overWeekly}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col6_underWeekly}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col7_standardSemester}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col8_teachingSemester}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col9_concurrentSemester}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col10_totalSemester}`, { bold: true, alignment: AlignmentType.CENTER }),
          createCell(`${r.col11_hsg}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col12_overSemester}`, { alignment: AlignmentType.CENTER }),
          createCell(`${r.col13_underSemester}`, { alignment: AlignmentType.CENTER }),
          createCell(r.applyDate, { alignment: AlignmentType.CENTER })
        ]
      })
    );
  });

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows
  });

  const principalTeacher = data.teachers.find(t => t.position?.trim().toLowerCase() === 'hiệu trưởng')
    || data.teachers.find(t => t.position?.includes('Hiệu trưởng') && !t.position?.includes('Phó'));
  const principalDisplayName = (schoolInfo.principalName && schoolInfo.principalName !== 'Hiệu trưởng' && schoolInfo.principalName !== 'Hiệu trưởng nhà trường')
    ? schoolInfo.principalName
    : (principalTeacher?.name || 'Ngô Thị Kiều Huệ');

  const creatorDisplayName = (schoolInfo.creatorName && schoolInfo.creatorName !== 'Bộ phận Chuyên môn' && schoolInfo.creatorName !== 'Bộ phận chuyên môn')
    ? schoolInfo.creatorName
    : 'Võ Việt Dũng';

  const noBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
  };

  const signaturesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorder,
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'NGƯỜI LẬP BẢNG', bold: true, size: 20 })],
                alignment: AlignmentType.CENTER
              }),
              new Paragraph({
                children: [new TextRun({ text: '(Ký và ghi rõ họ tên)', italics: true, size: 18 })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 1200 }
              }),
              new Paragraph({
                children: [new TextRun({ text: creatorDisplayName, bold: true, size: 20 })],
                alignment: AlignmentType.CENTER
              })
            ]
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorder,
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'HIỆU TRƯỞNG', bold: true, size: 20 })],
                alignment: AlignmentType.CENTER
              }),
              new Paragraph({
                children: [new TextRun({ text: '(Ký, ghi rõ họ tên & đóng dấu)', italics: true, size: 18 })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 1400 }
              }),
              new Paragraph({
                children: [new TextRun({ text: principalDisplayName, bold: true, size: 20 })],
                alignment: AlignmentType.CENTER
              })
            ]
          })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE }
          }
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: schoolInfo.departmentName.toUpperCase() + '\n', size: 18 }),
              new TextRun({ text: schoolInfo.schoolName.toUpperCase(), bold: true, size: 20 })
            ],
            alignment: AlignmentType.LEFT
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\n', bold: true, size: 20 }),
              new TextRun({ text: 'Độc lập - Tự do - Hạnh phúc', bold: true, underline: {}, size: 20 })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 140 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `BẢNG PHÂN CÔNG GIẢNG DẠY ${semFull.toUpperCase()} NĂM HỌC ${schoolInfo.academicYear}\n`, bold: true, size: 26 }),
              new TextRun({ text: schoolInfo.circularNumber || 'Thực hiện theo Thông tư số 05/2025/TT-BGDĐT ngày 07/03/2025 của Bộ GDĐT', italics: true, size: 18 })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 150, after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({ text: `${semCode}    ${weeks}    TUẦN`, bold: true, size: 20 })],
            spacing: { after: 150 }
          }),
          mainTable,
          new Paragraph({
            text: '',
            spacing: { before: 300, after: 200 }
          }),
          signaturesTable
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const safeYear = schoolInfo.academicYear.replace(/\s+/g, '').replace('/', '-');
  const filename = `Mau_04_Bang_Phan_Cong_Giang_Day_TT05_${semCode}_${safeYear}.docx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Helper tạo Cell văn bản có định dạng chuẩn trong docx (hỗ trợ xuống dòng \n chuẩn)
const createCell = (
  text: string,
  options?: {
    bold?: boolean;
    italics?: boolean;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    shading?: string;
    widthPct?: number;
    fontSize?: number;
    rowSpan?: number;
    colSpan?: number;
  }
) => {
  const lines = text.split('\n');
  const textRuns: TextRun[] = [];
  lines.forEach((line, i) => {
    textRuns.push(
      new TextRun({
        text: line,
        bold: !!options?.bold,
        italics: !!options?.italics,
        size: options?.fontSize || 15,
        break: i > 0 ? 1 : 0
      })
    );
  });

  return new TableCell({
    rowSpan: options?.rowSpan,
    columnSpan: options?.colSpan,
    children: [
      new Paragraph({
        alignment: options?.alignment || AlignmentType.LEFT,
        children: textRuns
      })
    ],
    shading: options?.shading ? { fill: options.shading } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    width: options?.widthPct ? { size: options.widthPct, type: WidthType.PERCENTAGE } : undefined
  });
};

/**
 * Xuất dữ liệu sang file Excel (.xlsx) với các Sheet hoàn chỉnh
 */
export const exportToExcel = (data: ExportData) => {
  const {
    classes,
    teachers,
    subjects,
    assignments,
    getSubjectPeriod,
    getAssignedTeacherId,
    teacherStatsMap,
    schoolInfo
  } = data;

  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const wb = XLSX.utils.book_new();

  // ----------------------------------------------------
  // SHEET 1: BẢNG PHÂN CÔNG GIẢNG DẠY THEO LỚP
  // ----------------------------------------------------
  const sheet1Data: any[][] = [];

  sheet1Data.push([schoolInfo.departmentName.toUpperCase(), '', '', 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM']);
  sheet1Data.push([schoolInfo.schoolName.toUpperCase(), '', '', 'Độc lập - Tự do - Hạnh phúc']);
  sheet1Data.push([]);
  sheet1Data.push([`BẢNG PHÂN CÔNG CHUYÊN MÔN VÀ CÔNG TÁC CHỦ NHIỆM`]);
  sheet1Data.push([`Năm học: ${schoolInfo.academicYear} - ${schoolInfo.semester}`]);
  sheet1Data.push([`Ngày lập: ${schoolInfo.createdDate}`]);
  sheet1Data.push([]);

  const s1Header: any[] = ['STT', 'Khối', 'Lớp', 'GV Chủ Nhiệm'];
  subjects.forEach(sub => {
    s1Header.push(sub.name);
  });
  s1Header.push('Tổng số tiết');
  sheet1Data.push(s1Header);

  let totalSchoolPeriods = 0;

  classes.forEach((cls, index) => {
    const homeroomTeacherId = assignments.homeroomAssignments[cls.id];
    const homeroomTeacher = homeroomTeacherId ? teacherMap.get(homeroomTeacherId) : null;
    const homeroomName = homeroomTeacher ? homeroomTeacher.name : 'Chưa phân công';

    const row: any[] = [index + 1, `Khối ${cls.grade}`, cls.name, homeroomName];
    let classTotalPeriods = 0;

    subjects.forEach(sub => {
      const tId = getAssignedTeacherId(cls.id, sub.id);
      const teacher = tId ? teacherMap.get(tId) : null;
      const period = getSubjectPeriod(sub.id, cls.grade, cls.id);

      if (period > 0) {
        classTotalPeriods += period;
        if (teacher) {
          row.push(`${teacher.name} (${period}t)`);
        } else {
          row.push(`[Chưa gán] (${period}t)`);
        }
      } else {
        if (teacher) {
          row.push(`${teacher.name} (0t)`);
        } else {
          row.push('-');
        }
      }
    });

    row.push(classTotalPeriods);
    totalSchoolPeriods += classTotalPeriods;
    sheet1Data.push(row);
  });

  const summaryRow: any[] = ['TỔNG CỘNG', `${classes.length} Lớp`, '', ''];
  subjects.forEach(() => summaryRow.push(''));
  summaryRow.push(totalSchoolPeriods);
  sheet1Data.push(summaryRow);

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  ws1['!cols'] = [
    { wch: 6 },
    { wch: 10 },
    { wch: 10 },
    { wch: 22 },
    ...subjects.map(() => ({ wch: 20 })),
    { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'PhanCong_TheoLop');

  // ----------------------------------------------------
  // SHEET 2: THỐNG KÊ ĐỊNH MỨC GIÁO VIÊN
  // ----------------------------------------------------
  const sheet2Data: any[][] = [];
  sheet2Data.push([schoolInfo.schoolName.toUpperCase()]);
  sheet2Data.push([`DANH SÁCH GIÁO VIÊN VÀ ĐỊNH MỨC GIẢNG DẠY (NĂM HỌC ${schoolInfo.academicYear})`]);
  sheet2Data.push([]);
  sheet2Data.push([
    'STT',
    'Mã GV',
    'Họ và tên',
    'Chức vụ',
    'Bộ môn chính',
    'Lớp chủ nhiệm',
    'Tiết chuyên môn',
    'Tiết CN (4t)',
    'Tổng số tiết/tuần',
    'Định mức chuẩn',
    'Chênh lệch (+/-)',
    'Đánh giá',
    'Số điện thoại'
  ]);

  const sortedTeachersForExcel = sortTeachersList(teachers, data.sortBy || 'default');
  sortedTeachersForExcel.forEach((t, idx) => {
    const stat = teacherStatsMap[t.id] || {
      assignedPeriods: 0,
      homeroomPeriods: 0,
      totalPeriods: 0,
      maxQuota: t.maxPeriods || 17,
      isHomeroom: false,
      homeroomClass: ''
    };

    const diff = stat.totalPeriods - stat.maxQuota;
    let evalText = 'Đủ định mức';
    if (diff > 0) {
      evalText = `Vượt định mức (+${diff}t)`;
    } else if (diff < 0) {
      evalText = `Thiếu định mức (${diff}t)`;
    }

    sheet2Data.push([
      idx + 1,
      t.id,
      t.name,
      t.position || 'Giáo viên',
      t.specialization,
      stat.homeroomClass || 'Không',
      stat.assignedPeriods,
      stat.homeroomPeriods,
      stat.totalPeriods,
      stat.maxQuota,
      diff > 0 ? `+${diff}` : `${diff}`,
      evalText,
      t.phone || ''
    ]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2['!cols'] = [
    { wch: 6 },
    { wch: 10 },
    { wch: 24 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 15 }
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'DinhMuc_GiaoVien');

  // ----------------------------------------------------
  // SHEET 3: TỔNG HỢP THEO TỔ BỘ MÔN
  // ----------------------------------------------------
  const sheet3Data: any[][] = [];
  sheet3Data.push([schoolInfo.schoolName.toUpperCase()]);
  sheet3Data.push([`TỔNG HỢP PHÂN CÔNG THEO TỔ BỘ MÔN`]);
  sheet3Data.push([]);
  sheet3Data.push([
    'STT',
    'Tổ Bộ môn',
    'Số lượng GV',
    'Tổng số tiết dạy',
    'Số tiết TB / GV',
    'Danh sách giáo viên và số tiết'
  ]);

  const groups: Record<string, typeof teachers> = {};
  teachers.forEach(t => {
    const spec = t.specialization || 'Khác';
    if (!groups[spec]) groups[spec] = [];
    groups[spec].push(t);
  });

  let groupIdx = 1;
  Object.entries(groups).forEach(([spec, tList]) => {
    let groupPeriods = 0;
    const detailList = tList.map(t => {
      const stat = teacherStatsMap[t.id];
      const p = stat ? stat.totalPeriods : 0;
      groupPeriods += p;
      return `${t.name}: ${p}t`;
    });

    const avg = tList.length > 0 ? (groupPeriods / tList.length).toFixed(1) : '0';

    sheet3Data.push([
      groupIdx++,
      `Tổ ${spec}`,
      tList.length,
      groupPeriods,
      avg,
      detailList.join(', ')
    ]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  ws3['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 60 }
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'TongHop_ToBoMon');

  const safeYear = schoolInfo.academicYear.replace(/\s+/g, '').replace('/', '-');
  const filename = `Bang_Phan_Cong_Chuyen_Mon_${safeYear}.xlsx`;
  XLSX.writeFile(wb, filename);
};

/**
 * Xuất dữ liệu sang file Word (.docx) chuẩn thể thức văn bản giáo dục
 */
export const exportToWord = async (data: ExportData) => {
  const {
    classes,
    teachers,
    subjects,
    assignments,
    getSubjectPeriod,
    getAssignedTeacherId,
    teacherStatsMap,
    schoolInfo
  } = data;

  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const tableRows: TableRow[] = [];

  const headerCells = [
    createCell('STT', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0', widthPct: 4 }),
    createCell('Khối', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0', widthPct: 5 }),
    createCell('Lớp', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0', widthPct: 6 }),
    createCell('GV Chủ Nhiệm', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0', widthPct: 14 })
  ];

  subjects.forEach(sub => {
    headerCells.push(
      createCell(sub.name, { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' })
    );
  });

  headerCells.push(
    createCell('Tổng', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0', widthPct: 5 })
  );

  tableRows.push(new TableRow({ children: headerCells, tableHeader: true }));

  classes.forEach((cls, idx) => {
    const homeroomTeacherId = assignments.homeroomAssignments[cls.id];
    const homeroomTeacher = homeroomTeacherId ? teacherMap.get(homeroomTeacherId) : null;
    const homeroomName = homeroomTeacher ? homeroomTeacher.name : 'Chưa phân';

    let classTotalPeriods = 0;
    const cells: TableCell[] = [
      createCell(`${idx + 1}`, { alignment: AlignmentType.CENTER }),
      createCell(cls.grade, { alignment: AlignmentType.CENTER }),
      createCell(cls.name, { bold: true, alignment: AlignmentType.CENTER }),
      createCell(homeroomName)
    ];

    subjects.forEach(sub => {
      const tId = getAssignedTeacherId(cls.id, sub.id);
      const teacher = tId ? teacherMap.get(tId) : null;
      const period = getSubjectPeriod(sub.id, cls.grade, cls.id);

      let cellText = '-';
      if (period > 0) {
        classTotalPeriods += period;
        cellText = teacher ? `${teacher.name} (${period})` : `[?] (${period})`;
      } else if (teacher) {
        cellText = teacher.name;
      }

      cells.push(
        createCell(cellText, { alignment: AlignmentType.CENTER })
      );
    });

    cells.push(
      createCell(`${classTotalPeriods}`, { bold: true, alignment: AlignmentType.CENTER })
    );

    tableRows.push(new TableRow({ children: cells }));
  });

  const assignmentTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows
  });

  const teacherRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        createCell('STT', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Họ và tên', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Chức vụ', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Môn dạy', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Lớp CN', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Tiết CM', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Tiết CN', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Tổng tiết', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Định mức', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
        createCell('Đánh giá', { bold: true, alignment: AlignmentType.CENTER, shading: 'E2E8F0' })
      ]
    })
  ];

  const sortedTeachersForWord = sortTeachersList(teachers, data.sortBy || 'default');
  sortedTeachersForWord.forEach((t, idx) => {
    const stat = teacherStatsMap[t.id] || {
      assignedPeriods: 0,
      homeroomPeriods: 0,
      totalPeriods: 0,
      maxQuota: t.maxPeriods || 17,
      isHomeroom: false,
      homeroomClass: ''
    };
    const diff = stat.totalPeriods - stat.maxQuota;
    let evalText = 'Đủ';
    if (diff > 0) evalText = `Thừa (+${diff})`;
    else if (diff < 0) evalText = `Thiếu (${diff})`;

    teacherRows.push(
      new TableRow({
        children: [
          createCell(`${idx + 1}`, { alignment: AlignmentType.CENTER }),
          createCell(t.name, { bold: true }),
          createCell(t.position || 'Giáo viên'),
          createCell(t.specialization, { alignment: AlignmentType.CENTER }),
          createCell(stat.homeroomClass || '-', { alignment: AlignmentType.CENTER }),
          createCell(`${stat.assignedPeriods}`, { alignment: AlignmentType.CENTER }),
          createCell(`${stat.homeroomPeriods}`, { alignment: AlignmentType.CENTER }),
          createCell(`${stat.totalPeriods}`, { bold: true, alignment: AlignmentType.CENTER }),
          createCell(`${stat.maxQuota}`, { alignment: AlignmentType.CENTER }),
          createCell(evalText, { alignment: AlignmentType.CENTER })
        ]
      })
    );
  });

  const teacherTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: teacherRows
  });

  const principalTeacher = data.teachers.find(t => t.position?.trim().toLowerCase() === 'hiệu trưởng')
    || data.teachers.find(t => t.position?.includes('Hiệu trưởng') && !t.position?.includes('Phó'));
  const principalDisplayName = (schoolInfo.principalName && schoolInfo.principalName !== 'Hiệu trưởng' && schoolInfo.principalName !== 'Hiệu trưởng nhà trường')
    ? schoolInfo.principalName
    : (principalTeacher?.name || 'Ngô Thị Kiều Huệ');

  const creatorDisplayName = (schoolInfo.creatorName && schoolInfo.creatorName !== 'Bộ phận Chuyên môn' && schoolInfo.creatorName !== 'Bộ phận chuyên môn')
    ? schoolInfo.creatorName
    : 'Võ Việt Dũng';

  const signaturesTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: '', alignment: AlignmentType.CENTER })],
            width: { size: 50, type: WidthType.PERCENTAGE }
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Ngày ${new Date().getDate()} tháng ${new Date().getMonth() + 1} năm ${new Date().getFullYear()}`,
                    italics: true
                  })
                ],
                alignment: AlignmentType.CENTER
              })
            ],
            width: { size: 50, type: WidthType.PERCENTAGE }
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({ children: [new TextRun({ text: 'NGƯỜI LẬP BẢNG', bold: true })], alignment: AlignmentType.CENTER }),
              new Paragraph({ children: [new TextRun({ text: '(Ký và ghi rõ họ tên)', italics: true })], alignment: AlignmentType.CENTER }),
              new Paragraph({ text: '\n\n\n' }),
              new Paragraph({ children: [new TextRun({ text: creatorDisplayName, bold: true })], alignment: AlignmentType.CENTER })
            ]
          }),
          new TableCell({
            children: [
              new Paragraph({ children: [new TextRun({ text: 'HIỆU TRƯỞNG', bold: true })], alignment: AlignmentType.CENTER }),
              new Paragraph({ children: [new TextRun({ text: '(Ký, ghi rõ họ tên & đóng dấu)', italics: true })], alignment: AlignmentType.CENTER }),
              new Paragraph({ text: '\n\n\n' }),
              new Paragraph({ children: [new TextRun({ text: principalDisplayName, bold: true })], alignment: AlignmentType.CENTER })
            ]
          })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE }
          }
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: schoolInfo.departmentName.toUpperCase() + '\n', size: 20 }),
              new TextRun({ text: schoolInfo.schoolName.toUpperCase(), bold: true, size: 22 })
            ],
            alignment: AlignmentType.LEFT
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'BẢNG PHÂN CÔNG CHUYÊN MÔN VÀ CÔNG TÁC CHỦ NHIỆM\n', bold: true, size: 30 }),
              new TextRun({ text: `Năm học: ${schoolInfo.academicYear} - ${schoolInfo.semester}`, italics: true, size: 22 })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 250 }
          }),
          new Paragraph({
            children: [new TextRun({ text: 'I. BẢNG PHÂN CÔNG GIẢNG DẠY THEO LỚP', bold: true, size: 24 })],
            spacing: { before: 150, after: 150 }
          }),
          assignmentTable,
          new Paragraph({
            children: [new TextRun({ text: 'II. BẢNG TỔNG HỢP ĐỊNH MỨC TIẾT DẠY CỦA GIÁO VIÊN', bold: true, size: 24 })],
            spacing: { before: 300, after: 150 }
          }),
          teacherTable,
          new Paragraph({
            text: '',
            spacing: { before: 300, after: 200 }
          }),
          signaturesTable
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const safeYear = schoolInfo.academicYear.replace(/\s+/g, '').replace('/', '-');
  const filename = `Bang_Phan_Cong_Chuyen_Mon_${safeYear}.docx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Xuất dữ liệu sang PDF bằng html-to-image toCanvas + jsPDF đảm bảo 100% tiếng Việt chuẩn,
 * xuất đầy đủ toàn bộ dữ liệu các trang (không bị trắng trang) và tương thích hoàn toàn Tailwind CSS v4
 */
export const exportToPdfFromElement = async (
  element: HTMLElement,
  filename: string,
  onProgress?: (percent: number) => void,
  paperSize: 'a4' | 'a3' = 'a4',
  orientation: 'landscape' | 'portrait' = 'landscape'
) => {
  // 1. Lưu lại trạng thái giao diện hiện tại để khôi phục sau khi xuất xong
  const scrollParent = element.parentElement;
  const originalScrollTop = scrollParent ? scrollParent.scrollTop : 0;
  const originalScrollLeft = scrollParent ? scrollParent.scrollLeft : 0;

  const originalWidth = element.style.width;
  const originalMaxWidth = element.style.maxWidth;
  const originalHeight = element.style.height;

  // Lấy danh sách các container có scroll bên trong (bảng 22 cột)
  const scrollContainers = Array.from(
    element.querySelectorAll<HTMLElement>('.overflow-x-auto, .overflow-y-auto, .overflow-auto')
  );
  const originalOverflows = scrollContainers.map((c) => c.style.overflow);

  // Tính toán chiều rộng của nội dung dựa trên khổ giấy và chiều giấy
  let contentWidth = 1250;
  if (paperSize === 'a3') {
    contentWidth = orientation === 'landscape' ? 1800 : 1250;
  } else { // a4
    // Luôn luôn sử dụng chiều rộng tối thiểu 1250px cho A4 để bảo đảm bảng phân công 22 cột không bị co cụm dồn chữ khi ở khổ giấy dọc (portrait)
    contentWidth = 1250;
  }

  try {
    if (onProgress) onProgress(10);

    // Đưa scroll về 0 trước khi đo đạc
    if (scrollParent) {
      scrollParent.scrollTop = 0;
      scrollParent.scrollLeft = 0;
    }

    // Tạm thời cố định chiều rộng chuẩn và mở overflow để toàn bộ 22 cột được hiển thị đầy đủ
    element.style.width = `${contentWidth}px`;
    element.style.maxWidth = 'none';
    element.style.height = 'auto';
    scrollContainers.forEach((c) => {
      c.style.overflow = 'visible';
    });

    // Cho trình duyệt tính toán lại layout (reflow)
    await new Promise((resolve) => setTimeout(resolve, 60));

    const contentHeight = Math.max(element.scrollHeight, element.offsetHeight, 600);

    // Thu thập các mốc chân dòng tr và khối chữ ký để phân trang thông minh (tránh cắt đôi chữ giữa 2 trang)
    const rowBottoms: number[] = [];
    const cutBoundaryElements = Array.from(element.querySelectorAll('tr, .select-text, h2'));
    const elementRect = element.getBoundingClientRect();
    cutBoundaryElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const relativeTop = rect.top - elementRect.top;
      const relativeBottom = rect.bottom - elementRect.top;
      if (relativeTop > 0) rowBottoms.push(relativeTop);
      if (relativeBottom > 0) rowBottoms.push(relativeBottom);
    });

    if (onProgress) onProgress(30);

    // 2. Chụp trực tiếp từ DOM thành canvas bằng toCanvas (tránh trung gian Data URL / Base64 decode)
    let fullCanvas: HTMLCanvasElement;
    try {
      fullCanvas = await toCanvas(element, {
        backgroundColor: '#ffffff',
        width: contentWidth,
        height: contentHeight,
        pixelRatio: 1.25,
        cacheBust: true,
        skipFonts: true,
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains('no-print')) {
            return false;
          }
          return true;
        }
      });
    } catch (err) {
      console.warn('toCanvas gặp cảnh báo ban đầu, thử lại pixelRatio 1.0:', err);
      fullCanvas = await toCanvas(element, {
        backgroundColor: '#ffffff',
        width: contentWidth,
        height: contentHeight,
        pixelRatio: 1.0,
        skipFonts: true
      });
    }

    if (onProgress) onProgress(65);

    // 3. Khởi tạo tài liệu PDF theo cấu hình khổ giấy và chiều giấy của người dùng
    const pdf = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: paperSize,
      compress: true
    });

    const pdfWidth = pdf.internal.pageSize.getWidth(); // 297mm
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 210mm
    const marginX = 6; // 6mm lề hai bên
    const marginTop = 6; // 6mm lề trên
    const marginBottom = 8; // 8mm lề dưới (chứa số trang)
    const usableWidthMm = pdfWidth - marginX * 2; // 285mm
    const usableHeightMm = pdfHeight - marginTop - marginBottom; // 196mm

    // Tỉ lệ scale giữa pixel ảnh và mm thực tế
    const pxPerMm = fullCanvas.width / usableWidthMm;
    const maxPageHeightPx = Math.floor(usableHeightMm * pxPerMm);
    const scaleFactor = fullCanvas.height / contentHeight;

    // Chuyển đổi các điểm ngắt dòng sang pixel canvas
    const scaledRowBottoms = Array.from(new Set(rowBottoms))
      .sort((a, b) => a - b)
      .map((b) => b * scaleFactor);

    // Tính toán các lát cắt phân trang thông minh (smart slicing)
    const pageSlices: { startY: number; height: number }[] = [];
    let currentY = 0;

    while (currentY < fullCanvas.height) {
      const remainingHeight = fullCanvas.height - currentY;
      if (remainingHeight <= maxPageHeightPx) {
        pageSlices.push({ startY: currentY, height: remainingHeight });
        break;
      }

      const targetEnd = currentY + maxPageHeightPx;
      // Tìm dòng bảng cuối cùng có thể nằm trọn trong trang hiện tại (không cắt ngang dòng)
      let bestEnd = targetEnd;
      const validCut = scaledRowBottoms
        .filter((b) => b > currentY + maxPageHeightPx * 0.7 && b <= targetEnd)
        .pop();

      if (validCut) {
        bestEnd = Math.floor(validCut);
      }

      const sliceHeight = Math.max(10, bestEnd - currentY);
      pageSlices.push({ startY: currentY, height: sliceHeight });
      currentY += sliceHeight;
    }

    const totalPages = Math.max(1, pageSlices.length);

    // 4. Kết xuất từng trang vào PDF từ fullCanvas
    for (let i = 0; i < totalPages; i++) {
      if (i > 0) {
        pdf.addPage();
      }

      const slice = pageSlices[i];
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = fullCanvas.width;
      sliceCanvas.height = slice.height;
      const ctx = sliceCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          fullCanvas,
          0,
          slice.startY,
          fullCanvas.width,
          slice.height,
          0,
          0,
          sliceCanvas.width,
          slice.height
        );

        const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.94);
        const renderHeightMm = slice.height / pxPerMm;
        pdf.addImage(
          sliceData,
          'JPEG',
          marginX,
          marginTop,
          usableWidthMm,
          renderHeightMm,
          undefined,
          'FAST'
        );
      }

      // Đánh số trang chuyên nghiệp ở góc dưới bên phải
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Trang ${i + 1} / ${totalPages}`,
        pdfWidth - marginX,
        pdfHeight - 3,
        { align: 'right' }
      );

      if (onProgress) {
        onProgress(65 + Math.floor(((i + 1) / totalPages) * 32));
      }
    }

    if (onProgress) onProgress(99);

    pdf.save(filename);

    if (onProgress) onProgress(100);
    return true;
  } catch (err) {
    console.error('Lỗi khi xuất PDF:', err);
    throw err;
  } finally {
    // 5. Luôn luôn khôi phục lại trạng thái giao diện ban đầu
    element.style.width = originalWidth;
    element.style.maxWidth = originalMaxWidth;
    element.style.height = originalHeight;
    scrollContainers.forEach((c, idx) => {
      c.style.overflow = originalOverflows[idx];
    });
    if (scrollParent) {
      scrollParent.scrollTop = originalScrollTop;
      scrollParent.scrollLeft = originalScrollLeft;
    }
  }
};

// ============================================================================
// XUẤT HỒ SƠ GIÁO VIÊN CHI TIẾT (WORD .DOCX & PDF .PDF)
// ============================================================================

export interface TeacherProfileExportData {
  teacher: {
    id: string;
    name: string;
    specialization: string;
    position?: string;
    maxPeriods: number;
    phone?: string;
    email?: string;
    namSinh?: number;
    namVaoNganh?: number;
    trinhDo?: string;
    experienceYears?: number;
    isHomeroomCapable?: boolean;
    preferredGrades?: string[];
  };
  schoolInfo: SchoolInfo;
  homeroomClass?: { id: string; name: string; grade: string } | null;
  assignedClasses: Array<{
    className: string;
    subjectName: string;
    periods: number;
    grade: string;
  }>;
  totalTeachingPeriods: number;
  totalPeriodsWithHomeroom: number;
}

/**
 * Xuất hồ sơ giáo viên sang file Word (.docx) chuẩn thể thức công văn
 */
export const exportTeacherProfileToWord = async (data: TeacherProfileExportData): Promise<void> => {
  const { teacher, schoolInfo, homeroomClass, assignedClasses, totalTeachingPeriods, totalPeriodsWithHomeroom } = data;
  const curYear = new Date().getFullYear();
  const birthYear = teacher.namSinh || (teacher.experienceYears ? curYear - 22 - teacher.experienceYears : '—');
  const startYear = teacher.namVaoNganh || (teacher.experienceYears ? curYear - teacher.experienceYears : '—');
  const trinhDo = teacher.trinhDo || (teacher.experienceYears && teacher.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học');
  const position = teacher.position || 'Giáo viên';
  const thongKeNam = teacher.namVaoNganh ? `${curYear - teacher.namVaoNganh} năm` : `${teacher.experienceYears || 0} năm`;

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, bottom: 1134, left: 1417, right: 1134 } // Chuẩn thể thức lề Word A4
          }
        },
        children: [
          // Tiêu đề Quốc hiệu & Trường học
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 45, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: schoolInfo.departmentName.toUpperCase(), size: 18, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ children: [new TextRun({ text: schoolInfo.schoolName.toUpperCase(), bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER })
                    ]
                  }),
                  new TableCell({
                    width: { size: 55, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ children: [new TextRun({ text: "Độc lập - Tự do - Hạnh phúc", italics: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER })
                    ]
                  })
                ]
              })
            ]
          }),

          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Tên văn bản
          new Paragraph({
            children: [
              new TextRun({
                text: "PHIẾU THÔNG TIN HỒ SƠ & PHÂN CÔNG CHUYÊN MÔN",
                bold: true,
                size: 28,
                font: 'Times New Roman',
                color: '1E3A8A'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 80 }
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Năm học: ${schoolInfo.academicYear} — ${schoolInfo.semester}`,
                italics: true,
                size: 22,
                font: 'Times New Roman'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 }
          }),

          // I. THÔNG TIN HỒ SƠ CÁ NHÂN
          new Paragraph({
            children: [
              new TextRun({ text: "I. THÔNG TIN HỒ SƠ NHÂN SỰ", bold: true, size: 22, font: 'Times New Roman', color: '0F172A' })
            ],
            spacing: { before: 120, after: 100 }
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("1. Họ và tên:", { bold: true, widthPct: 25, shading: 'F1F5F9' }),
                  createCell(teacher.name.toUpperCase(), { bold: true, widthPct: 35 }),
                  createCell("2. Mã giáo viên:", { bold: true, widthPct: 20, shading: 'F1F5F9' }),
                  createCell(teacher.id, { widthPct: 20 })
                ]
              }),
              new TableRow({
                children: [
                  createCell("3. Năm sinh:", { bold: true, widthPct: 25, shading: 'F1F5F9' }),
                  createCell(String(birthYear), { widthPct: 35 }),
                  createCell("4. Năm vào ngành:", { bold: true, widthPct: 20, shading: 'F1F5F9' }),
                  createCell(`${startYear} (Thâm niên: ${thongKeNam})`, { widthPct: 20 })
                ]
              }),
              new TableRow({
                children: [
                  createCell("5. Trình độ chuyên môn:", { bold: true, widthPct: 25, shading: 'F1F5F9' }),
                  createCell(trinhDo, { bold: true, widthPct: 35 }),
                  createCell("6. Môn giảng dạy:", { bold: true, widthPct: 20, shading: 'F1F5F9' }),
                  createCell(teacher.specialization, { bold: true, widthPct: 20 })
                ]
              }),
              new TableRow({
                children: [
                  createCell("7. Chức vụ hiện tại:", { bold: true, widthPct: 25, shading: 'F1F5F9' }),
                  createCell(position, { widthPct: 35 }),
                  createCell("8. Lớp chủ nhiệm:", { bold: true, widthPct: 20, shading: 'F1F5F9' }),
                  createCell(homeroomClass ? `Lớp ${homeroomClass.name} (+4 tiết)` : "Không chủ nhiệm", { bold: !!homeroomClass, widthPct: 20 })
                ]
              }),
              new TableRow({
                children: [
                  createCell("9. Số điện thoại:", { bold: true, widthPct: 25, shading: 'F1F5F9' }),
                  createCell(teacher.phone || "Chưa cập nhật", { widthPct: 35 }),
                  createCell("10. Email công vụ:", { bold: true, widthPct: 20, shading: 'F1F5F9' }),
                  createCell(teacher.email || "Chưa cập nhật", { widthPct: 20 })
                ]
              })
            ]
          }),

          new Paragraph({ text: "", spacing: { after: 200 } }),

          // II. ĐỊNH MỨC & PHÂN CÔNG GIẢNG DẠY
          new Paragraph({
            children: [
              new TextRun({ text: "II. PHÂN CÔNG GIẢNG DẠY HIỆN TẠI", bold: true, size: 22, font: 'Times New Roman', color: '0F172A' })
            ],
            spacing: { before: 120, after: 100 }
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("STT", { bold: true, widthPct: 10, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
                  createCell("Lớp giảng dạy", { bold: true, widthPct: 30, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
                  createCell("Môn học", { bold: true, widthPct: 30, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
                  createCell("Khối", { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'E2E8F0' }),
                  createCell("Số tiết / tuần", { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'E2E8F0' })
                ]
              }),
              ...(assignedClasses.length > 0 ? assignedClasses.map((cls, idx) => (
                new TableRow({
                  children: [
                    createCell(String(idx + 1), { alignment: AlignmentType.CENTER, widthPct: 10 }),
                    createCell(`Lớp ${cls.className}`, { bold: true, widthPct: 30 }),
                    createCell(cls.subjectName, { widthPct: 30 }),
                    createCell(`Khối ${cls.grade}`, { alignment: AlignmentType.CENTER, widthPct: 15 }),
                    createCell(`${cls.periods} tiết`, { alignment: AlignmentType.CENTER, widthPct: 15, bold: true })
                  ]
                })
              )) : [
                new TableRow({
                  children: [
                    createCell("1", { alignment: AlignmentType.CENTER, widthPct: 10 }),
                    createCell("Chưa có lớp phân công dạy", { widthPct: 90 })
                  ]
                })
              ]),
              new TableRow({
                children: [
                  createCell("TỔNG CỘNG SỐ TIẾT DẠY:", { bold: true, widthPct: 85, shading: 'F8FAFC' }),
                  createCell(`${totalTeachingPeriods} tiết`, { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'F8FAFC' })
                ]
              }),
              ...(homeroomClass ? [
                new TableRow({
                  children: [
                    createCell(`Kiêm nhiệm Chủ nhiệm Lớp ${homeroomClass.name}:`, { bold: true, widthPct: 85, shading: 'EFF6FF' }),
                    createCell("+4 tiết", { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'EFF6FF' })
                  ]
                }),
                new TableRow({
                  children: [
                    createCell("TỔNG SỐ TIẾT NGHĨA VỤ (DẠY + CHỦ NHIỆM):", { bold: true, widthPct: 85, shading: 'DBEAFE' }),
                    createCell(`${totalPeriodsWithHomeroom} / ${teacher.maxPeriods} tiết`, { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'DBEAFE' })
                  ]
                })
              ] : [
                new TableRow({
                  children: [
                    createCell(`Định mức quy định (${position}):`, { bold: true, widthPct: 85, shading: 'F1F5F9' }),
                    createCell(`${teacher.maxPeriods} tiết`, { bold: true, widthPct: 15, alignment: AlignmentType.CENTER, shading: 'F1F5F9' })
                  ]
                })
              ])
            ]
          }),

          new Paragraph({ text: "", spacing: { after: 300 } }),

          // Ký tên xác nhận
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "GIÁO VIÊN BỘ MÔN", bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ children: [new TextRun({ text: "(Ký và ghi rõ họ tên)", italics: true, size: 18, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ text: "", spacing: { after: 1200 } }),
                      new Paragraph({ children: [new TextRun({ text: teacher.name, bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER })
                    ]
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `..., Ngày ... tháng ... năm ${curYear}`, italics: true, size: 18, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ children: [new TextRun({ text: "HIỆU TRƯỞNG", bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ children: [new TextRun({ text: "(Ký, đóng dấu)", italics: true, size: 18, font: 'Times New Roman' })], alignment: AlignmentType.CENTER }),
                      new Paragraph({ text: "", spacing: { after: 1200 } }),
                      new Paragraph({ children: [new TextRun({ text: schoolInfo.principalName || "Ban Giám Hiệu", bold: true, size: 20, font: 'Times New Roman' })], alignment: AlignmentType.CENTER })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const safeName = teacher.name.replace(/\s+/g, '_');
  const filename = `Ho_So_Giao_Vien_${safeName}.docx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Xuất hồ sơ giáo viên sang file PDF (.pdf) chất lượng cao
 */
export const exportTeacherProfileToPDF = async (data: TeacherProfileExportData): Promise<void> => {
  const { teacher, schoolInfo, homeroomClass, assignedClasses, totalTeachingPeriods, totalPeriodsWithHomeroom } = data;
  const curYear = new Date().getFullYear();
  const birthYear = teacher.namSinh || (teacher.experienceYears ? curYear - 22 - teacher.experienceYears : '—');
  const startYear = teacher.namVaoNganh || (teacher.experienceYears ? curYear - teacher.experienceYears : '—');
  const trinhDo = teacher.trinhDo || (teacher.experienceYears && teacher.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học');
  const position = teacher.position || 'Giáo viên';
  const thongKeNam = teacher.namVaoNganh ? `${curYear - teacher.namVaoNganh} năm` : `${teacher.experienceYears || 0} năm`;

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '0px';
  container.style.top = '100000px';
  container.style.width = '794px'; // Chuẩn A4 96 DPI
  container.style.padding = '36px 40px';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = 'Arial, "Segoe UI", sans-serif';
  container.style.boxSizing = 'border-box';

  container.innerHTML = `
    <div>
      {/* Header Quốc hiệu */}
      <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 14px;">
        <div style="line-height: 1.3;">
          <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold;">${schoolInfo.departmentName}</div>
          <div style="font-size: 13px; font-weight: 900; text-transform: uppercase; color: #0f172a;">${schoolInfo.schoolName}</div>
        </div>
        <div style="text-align: right; line-height: 1.3;">
          <div style="font-size: 11px; font-weight: bold; color: #0f172a;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
          <div style="font-size: 10px; font-style: italic; color: #64748b;">Độc lập - Tự do - Hạnh phúc</div>
        </div>
      </div>

      {/* Title */}
      <div style="text-align: center; margin-bottom: 16px;">
        <h1 style="font-size: 17px; font-weight: 900; text-transform: uppercase; margin: 0; color: #1e3a8a; letter-spacing: 0.5px;">
          PHIẾU HỒ SƠ GIÁO VIÊN & PHÂN CÔNG CHUYÊN MÔN
        </h1>
        <p style="font-size: 11px; font-style: italic; margin: 4px 0 0 0; color: #475569;">
          Năm học: ${schoolInfo.academicYear} — ${schoolInfo.semester}
        </p>
      </div>

      {/* I. Thông tin nhân sự */}
      <div style="margin-bottom: 16px;">
        <h2 style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #0f172a; margin-bottom: 6px; border-left: 3px solid #2563eb; padding-left: 6px;">
          I. THÔNG TIN HỒ SƠ NHÂN SỰ
        </h2>
        <table style="widthPct: 100%; border-collapse: collapse; font-size: 10.5px; border: 1px solid #cbd5e1;">
          <tbody>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold; width: 22%;">Họ và tên:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-weight: 900; color: #1e293b; width: 28%;">${teacher.name}</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold; width: 22%;">Mã GV:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; width: 28%; font-family: monospace;">${teacher.id}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Năm sinh:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${birthYear}</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Năm vào ngành:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${startYear} (Thâm niên: ${thongKeNam})</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Trình độ:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-weight: bold; color: #7c3aed;">${trinhDo}</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Môn chuyên môn:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-weight: bold; color: #2563eb;">${teacher.specialization}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Chức vụ:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${position}</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Lớp chủ nhiệm:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-weight: bold; color: ${homeroomClass ? '#2563eb' : '#64748b'};">
                ${homeroomClass ? `Lớp ${homeroomClass.name} (+4 tiết)` : 'Không chủ nhiệm'}
              </td>
            </tr>
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Điện thoại:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${teacher.phone || 'Chưa cập nhật'}</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; background: #f8fafc; font-weight: bold;">Email:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 10px; color: #475569;">${teacher.email || 'Chưa cập nhật'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* II. Phân công giảng dạy */}
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #0f172a; margin-bottom: 6px; border-left: 3px solid #2563eb; padding-left: 6px;">
          II. PHÂN CÔNG GIẢNG DẠY HIỆN TẠI
        </h2>
        <table style="widthPct: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #f1f5f9; color: #0f172a; font-weight: bold;">
              <th style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; width: 40px;">STT</th>
              <th style="border: 1px solid #cbd5e1; padding: 5px; text-align: left;">Lớp giảng dạy</th>
              <th style="border: 1px solid #cbd5e1; padding: 5px; text-align: left;">Môn học</th>
              <th style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; width: 80px;">Khối</th>
              <th style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; widthPct: 90px;">Số tiết/tuần</th>
            </tr>
          </thead>
          <tbody>
            ${assignedClasses.length > 0 ? assignedClasses.map((cls, idx) => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center;">${idx + 1}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; font-weight: bold; color: #0f172a;">Lớp ${cls.className}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px;">${cls.subjectName}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center;">Khối ${cls.grade}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; font-weight: bold;">${cls.periods} tiết</td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="5" style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; color: #94a3b8; font-style: italic;">
                  Chưa có phân công lớp dạy cụ thể
                </td>
              </tr>
            `}
            <tr style="background: #f8fafc; font-weight: bold;">
              <td colspan="4" style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">Tổng số tiết dạy:</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px; text-align: center; color: #2563eb; font-size: 11px;">${totalTeachingPeriods} tiết</td>
            </tr>
            ${homeroomClass ? `
              <tr style="background: #eff6ff; font-weight: bold;">
                <td colspan="4" style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">Kiêm nhiệm Chủ nhiệm lớp ${homeroomClass.name}:</td>
                <td style="border: 1px solid #cbd5e1; padding: 6px; text-align: center; color: #1d4ed8;">+4 tiết</td>
              </tr>
              <tr style="background: #dbeafe; font-weight: 900;">
                <td colspan="4" style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">TỔNG SỐ TIẾT NGHĨA VỤ (DẠY + CN):</td>
                <td style="border: 1px solid #cbd5e1; padding: 6px; text-align: center; color: #1e3a8a; font-size: 11px;">${totalPeriodsWithHomeroom} / ${teacher.maxPeriods} tiết</td>
              </tr>
            ` : `
              <tr style="background: #f1f5f9; font-weight: bold;">
                <td colspan="4" style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">Định mức nghĩa vụ quy định (${position}):</td>
                <td style="border: 1px solid #cbd5e1; padding: 6px; text-align: center; color: #334155;">${teacher.maxPeriods} tiết</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

      {/* Ký tên */}
      <div style="display: flex; justify-content: space-between; margin-top: 30px; text-align: center;">
        <div style="width: 45%;">
          <div style="font-weight: bold; font-size: 11px; text-transform: uppercase;">GIÁO VIÊN BỘ MÔN</div>
          <div style="font-size: 9.5px; font-style: italic; color: #64748b;">(Ký và ghi rõ họ tên)</div>
          <div style="height: 60px;"></div>
          <div style="font-weight: bold; font-size: 11px; color: #0f172a;">${teacher.name}</div>
        </div>
        <div style="width: 45%;">
          <div style="font-size: 10px; font-style: italic; color: #64748b; margin-bottom: 2px;">Ngày ... tháng ... năm ${curYear}</div>
          <div style="font-weight: bold; font-size: 11px; text-transform: uppercase;">HIỆU TRƯỞNG</div>
          <div style="font-size: 9.5px; font-style: italic; color: #64748b;">(Ký và đóng dấu)</div>
          <div style="height: 60px;"></div>
          <div style="font-weight: bold; font-size: 11px; color: #0f172a;">${schoolInfo.principalName || 'Ban Giám Hiệu'}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const imgRatio = canvas.width / canvas.height;
    let renderWidth = usableWidth;
    let renderHeight = usableWidth / imgRatio;

    if (renderHeight > usableHeight) {
      renderHeight = usableHeight;
      renderWidth = usableHeight * imgRatio;
    }

    const posX = margin + (usableWidth - renderWidth) / 2;
    const posY = margin + 4;

    pdf.addImage(imgData, 'JPEG', posX, posY, renderWidth, renderHeight, undefined, 'FAST');

    const safeName = teacher.name.replace(/\s+/g, '_');
    const filename = `Ho_So_Giao_Vien_${safeName}.pdf`;
    pdf.save(filename);
  } finally {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  }
};
