import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  School, GraduationCap, Users, UserCheck, BookOpen, Plus, Trash2, 
  Sparkles, CheckCircle, AlertTriangle, Printer, Download, Send, 
  RefreshCw, X, Info, Settings, HelpCircle, UserPlus, Check,
  ChevronDown, ChevronUp, ChevronRight, Copy, RotateCcw, Maximize2, Minimize2, MessageSquare,
  Pencil, ArrowUpDown, ArrowUp, ArrowDown, Search, BarChart3,
  FileSpreadsheet, FileText, FileDown, Upload, Calendar, CalendarDays, FolderArchive, Clock,
  Lock, Unlock, Save, Layers, KeyRound, ShieldCheck, Cloud, Shield, ClipboardList,
  Sun, Moon, Calculator
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  autoAssignSchedules, 
  solveAssignments, 
  normalizeSubjectName, 
  AutoAssignOptions, 
  UnassignedSlot 
} from './utils/assignmentSolver';
import { ExportModal } from './components/ExportModal';
import { TimetableTab } from './components/TimetableTab';
import { NaturalLanguageImportModal, NlImportType } from './components/NaturalLanguageImportModal';
import { TeacherHRStatsDashboard } from './components/TeacherHRStatsDashboard';
import { AdminAuthModal } from './components/AdminAuthModal';
import { UserManagementModal } from './components/UserManagementModal';
import { UserGuideModal } from './components/UserGuideModal';
import { SendScheduleModal } from './components/SendScheduleModal';
import { AIAssistant } from './components/AIAssistant';
import { useAuth } from './utils/authContext';
import { ClassPeriodsEditor } from './components/ClassPeriodsEditor';
import { 
  subscribeToTerm, 
  SCHOOL_DOC_REF, 
  TARGET_TERM_DOC_REF,
  TARGET_SCHOOL_ID,
  TARGET_TERM_KEY,
  pushSchoolDataToCloud, 
  pullSchoolDataFromCloud, 
  subscribeToSchoolDoc,
  subscribeToSchool,
  resizeImageToBase64,
  saveSchoolCustomLogo,
  DEFAULT_SCHOOL_NAME,
  DEFAULT_DEPARTMENT_NAME,
  removeUndefinedFields,
  sanitizeClassSubjectPeriods,
  getCachedTermData,
  setCachedTermData,
  invalidateTermCache,
  getLazyClassSubjectPeriods
} from './utils/firebaseSync';
import { getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { SchoolInfo, exportTeacherProfileToWord, exportTeacherProfileToPDF, TeacherProfileExportData } from './utils/exportUtils';
import { SchoolLogo, DEFAULT_SCHOOL_LOGO_DATA_URI, getSafeSchoolLogo } from './components/SchoolLogo';
import { 
  calculateRetirementDate, 
  parseDateOfBirth, 
  normalizeTeacherGender, 
  formatDOB, 
  RetirementInfo 
} from './utils/retirementCalculator';

export { calculateRetirementDate, parseDateOfBirth, normalizeTeacherGender, formatDOB };
export type { RetirementInfo };

// Definitions
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
  phone: string;
  namSinh?: number;
  birthYear?: number;
  dateOfBirth?: string; // Định dạng DD/MM/YYYY
  dob?: string;
  gender?: 'Nam' | 'Nữ' | string;
  namVaoNganh?: number;
  trinhDo?: string;
  department?: string;
  toChuyenMon?: string;
  email?: string;
}

const TRINH_DO_OPTIONS = [
  'Đại học',
  'Thạc sĩ',
  'Tiến sĩ',
  'Cao đẳng',
  'Cử nhân',
  'Khác'
];

const POSITIONS = [
  'Giáo viên',
  'Hiệu trưởng',
  'Phó Hiệu trưởng',
  'Tổ trưởng',
  'Tổ phó',
  'Bí thư đoàn trường',
  'Phó Bí thư đoàn trường',
  'Chủ tịch Công đoàn',
  'Khác'
];

export const getStandardQuotaForPosition = (position?: string): number => {
  const p = (position || '').trim();
  if (p === 'Hiệu trưởng') return 2;
  if (p === 'Phó Hiệu trưởng') return 4;
  if (p === 'Tổ trưởng' || p.includes('Tổ trưởng')) return 14;
  if (p === 'Tổ phó' || p.includes('Tổ phó')) return 16;
  if (p === 'Phó Bí thư đoàn trường' || p === 'Phó Bí thư Đoàn' || p.includes('Phó Bí thư')) return 8.5;
  if (p === 'Bí thư đoàn trường' || p === 'Bí thư Đoàn' || p.includes('Bí thư')) return 2.5;
  if (p === 'Chủ tịch Công đoàn') return 14;
  return 17; // Mặc định Giáo viên là 17
};

/**
 * Kiểm tra xem giáo viên có thuộc Ban Giám hiệu (Hiệu trưởng, Phó Hiệu trưởng) không
 */
export const isBanGiamHieu = (teacher?: Partial<Teacher> | null): boolean => {
  if (!teacher) return false;
  const pos = (
    teacher.position || 
    (teacher as any).role || 
    (teacher as any).chucVu || 
    ''
  ).toString().toLowerCase().trim();
  
  return (
    pos.includes('hiệu trưởng') ||
    pos.includes('hieu truong') ||
    pos.includes('principal') ||
    pos.includes('ban giám hiệu') ||
    pos.includes('ban giam hieu') ||
    pos === 'bgh'
  );
};

/**
 * Chuẩn hóa và map linh hoạt môn học của giáo viên vào danh mục Môn học (subjects)
 * Hỗ trợ teacher.subject, teacher.monGiangDay, teacher.subjectId, teacher.monDay, teacher.specialization...
 */
export const resolveTeacherSubject = (
  teacher: any,
  subjectsList: { id: string; name?: string }[] = []
): string => {
  if (!teacher) return '';
  const currentSubject = (
    teacher.specialization ||
    teacher.subject ||
    teacher.monGiangDay ||
    teacher.subjectId ||
    teacher.monDay ||
    teacher.monHoc ||
    ''
  ).toString().trim();

  if (!currentSubject) {
    return subjectsList.length > 0 ? subjectsList[0].id : '';
  }

  if (!subjectsList || subjectsList.length === 0) {
    return currentSubject;
  }

  // 1. Khớp chính xác với subject.id hoặc subject.name (không phân biệt chữ hoa/thường)
  const matchId = subjectsList.find(s => s.id.toLowerCase() === currentSubject.toLowerCase());
  if (matchId) return matchId.id;

  const matchName = subjectsList.find(s => s.name?.toLowerCase() === currentSubject.toLowerCase());
  if (matchName) return matchName.id;

  // 2. Tra cứu linh hoạt theo bí danh/tên môn phổ biến
  const norm = currentSubject.toLowerCase();

  // Tiếng Anh / Ngoại ngữ
  if (norm === 'anh' || norm === 'tiếng anh' || norm === 'tieng anh' || norm === 'ngoại ngữ' || norm === 'ngoai ngu' || norm === 'english' || norm.includes('anh')) {
    const match = subjectsList.find(s => s.id === 'Anh' || s.id.toLowerCase().includes('anh') || s.name?.toLowerCase().includes('anh'));
    if (match) return match.id;
  }

  // Toán
  if (norm.includes('toán') || norm.includes('toan') || norm === 'math') {
    const match = subjectsList.find(s => s.id === 'Toán' || s.name?.includes('Toán'));
    if (match) return match.id;
  }

  // Ngữ văn
  if (norm.includes('ngữ văn') || norm.includes('văn') || norm.includes('van')) {
    const match = subjectsList.find(s => s.id === 'Văn' || s.name?.includes('Văn'));
    if (match) return match.id;
  }

  // Vật lý
  if (norm === 'lý' || norm === 'ly' || norm.includes('vật lý') || norm.includes('vật lí')) {
    const match = subjectsList.find(s => s.id === 'Lý' || s.name?.includes('Lý') || s.id.includes('Lí'));
    if (match) return match.id;
  }

  // Hóa học
  if (norm.includes('hóa') || norm.includes('hoa')) {
    const match = subjectsList.find(s => s.id === 'Hóa' || s.name?.includes('Hóa'));
    if (match) return match.id;
  }

  // Sinh học
  if (norm.includes('sinh')) {
    const match = subjectsList.find(s => s.id === 'Sinh' || s.name?.includes('Sinh'));
    if (match) return match.id;
  }

  // Lịch sử
  if (norm.includes('sử') || norm.includes('su') || norm.includes('lịch sử')) {
    const match = subjectsList.find(s => s.id === 'Sử' || s.name?.includes('Sử'));
    if (match) return match.id;
  }

  // Địa lí / Địa lý
  if (norm.includes('địa') || norm.includes('dia')) {
    const match = subjectsList.find(s => s.id === 'Địa' || s.name?.includes('Địa'));
    if (match) return match.id;
  }

  // Tin học
  if (norm.includes('tin') || norm.includes('cntt')) {
    const match = subjectsList.find(s => s.id === 'Tin' || s.name?.includes('Tin'));
    if (match) return match.id;
  }

  // GDKTPL / Giáo dục KT-PL / GDCD
  if (norm.includes('gdktpl') || norm.includes('gdcd') || norm.includes('kinh tế') || norm.includes('pháp luật') || norm === 'gd') {
    const match = subjectsList.find(s => s.id === 'GDKTPL' || s.name?.includes('GDKTPL') || s.id === 'GD');
    if (match) return match.id;
  }

  // Công nghệ CNNN / Nông nghiệp
  if (norm.includes('nông nghiệp') || norm === 'cnnn' || norm.includes('nong nghiep')) {
    const match = subjectsList.find(s => s.id === 'CNNN' || s.name?.includes('CNNN') || s.name?.toLowerCase().includes('nông nghiệp'));
    if (match) return match.id;
  }

  // Công nghệ CNCN / Công nghiệp
  if (norm.includes('công nghiệp') || norm === 'cncn' || norm.includes('cong nghiep')) {
    const match = subjectsList.find(s => s.id === 'CNCN' || s.name?.includes('CNCN') || s.name?.toLowerCase().includes('công nghiệp'));
    if (match) return match.id;
  }

  // Generic Công nghệ / CN
  if (norm.includes('công nghệ') || norm === 'cn') {
    const match = subjectsList.find(s => s.id === 'CNCN' || s.id === 'CNNN' || s.id === 'CN');
    if (match) return match.id;
  }

  // GDTC / Thể dục
  if (norm.includes('gdtc') || norm.includes('thể dục') || norm.includes('the duc')) {
    const match = subjectsList.find(s => s.id === 'GDTC' || s.name?.includes('GDTC'));
    if (match) return match.id;
  }

  // GDQPAN / Giáo dục Quốc phòng
  if (norm.includes('gdqp') || norm.includes('quốc phòng') || norm.includes('an ninh')) {
    const match = subjectsList.find(s => s.id === 'GDQPAN' || s.name?.includes('GDQP') || s.id === 'GDQP');
    if (match) return match.id;
  }

  // Giáo dục địa phương (GDĐP)
  if (norm.includes('địa phương') || norm.includes('gdđp') || norm.includes('gddp')) {
    const match = subjectsList.find(s => s.id === 'GDĐP' || s.name?.includes('GDĐP'));
    if (match) return match.id;
  }

  // TNHN1
  if (norm.includes('tnhn1')) {
    const match = subjectsList.find(s => s.id === 'TNHN1');
    if (match) return match.id;
  }

  // TNHN2
  if (norm.includes('tnhn2')) {
    const match = subjectsList.find(s => s.id === 'TNHN2');
    if (match) return match.id;
  }

  // 3. Khớp chuỗi mờ (partial match)
  const partialMatch = subjectsList.find(s => 
    s.id.toLowerCase().includes(norm) || 
    norm.includes(s.id.toLowerCase()) ||
    (s.name && (s.name.toLowerCase().includes(norm) || norm.includes(s.name.toLowerCase())))
  );
  if (partialMatch) return partialMatch.id;

  return currentSubject;
};

const renderPositionBadge = (pos?: string) => {
  const p = pos || 'Giáo viên';
  if (p === 'Hiệu trưởng') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 shadow-2xs">
        Hiệu trưởng
      </span>
    );
  }
  if (p === 'Phó Hiệu trưởng') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs">
        Phó Hiệu trưởng
      </span>
    );
  }
  if (p === 'Tổ trưởng' || p === 'Tổ trưởng chuyên môn') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
        Tổ trưởng
      </span>
    );
  }
  if (p === 'Tổ phó' || p === 'Tổ phó chuyên môn') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
        Tổ phó
      </span>
    );
  }
  if (p === 'Bí thư đoàn trường' || p === 'Bí thư Đoàn') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
        Bí thư Đoàn
      </span>
    );
  }
  if (p === 'Phó Bí thư đoàn trường' || p === 'Phó Bí thư Đoàn') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-medium bg-teal-50 text-teal-800 border border-teal-200 shadow-2xs">
        Phó Bí thư Đoàn
      </span>
    );
  }
  if (p === 'Chủ tịch Công đoàn') {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
        {p}
      </span>
    );
  }
  if (p === 'Giáo viên' || !pos) {
    return (
      <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] text-slate-500 bg-slate-50 border border-slate-200 shadow-2xs">
        Giáo viên
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center mx-auto px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
      {p}
    </span>
  );
};

interface ClassModel {
  id: string;
  name: string;
  grade: '10' | '11' | '12';
  homeroomTeacherId?: string;
}

interface Assignments {
  homeroomAssignments: Record<string, string>; // classId -> teacherId
  subjectAssignments: Record<string, Record<string, string>>; // classId -> subjectName -> teacherId
}

interface ChatMessage {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedChanges?: any;
}

const DEFAULT_SUBJECTS = [
  { id: 'Toán', name: 'Toán' },
  { id: 'Lý', name: 'Vật lí' },
  { id: 'Hóa', name: 'Hóa học' },
  { id: 'Sinh', name: 'Sinh học' },
  { id: 'Tin', name: 'Tin học' },
  { id: 'CNCN', name: 'Công nghệ (Công nghiệp)' },
  { id: 'CNNN', name: 'Công nghệ (Nông nghiệp)' },
  { id: 'Văn', name: 'Ngữ văn' },
  { id: 'Sử', name: 'Lịch sử' },
  { id: 'Địa', name: 'Địa lí' },
  { id: 'GDKTPL', name: 'GDKTPL' },
  { id: 'Anh', name: 'Ngoại ngữ' },
  { id: 'GDTC', name: 'GDTC' },
  { id: 'GDQPAN', name: 'GDQPAN' },
  { id: 'GDĐP', name: 'GDĐP' },
  { id: 'TNHN1', name: 'TNHN1' },
  { id: 'TNHN2', name: 'TNHN2' }
];

export const DEFAULT_TEACHERS: Teacher[] = [
  { id: 't1', name: 'Ngô Thị Kiều Huệ', specialization: 'Địa', position: 'Hiệu trưởng', maxPeriods: 2, isHomeroomCapable: false, preferredGrades: ['12'], experienceYears: 24, phone: '0912345001', gender: 'Nữ', dateOfBirth: '15/05/1975', dob: '15/05/1975', birthYear: 1975, namSinh: 1975, trinhDo: 'Tiến sĩ' },
  { id: 't2', name: 'Lâm Đức Tín', specialization: 'Địa', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 16, phone: '0912345002' },
  { id: 't3', name: 'Nguyễn Thị Bé Hảo', specialization: 'Địa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 8, phone: '0912345003' },
  { id: 't4', name: 'Huỳnh Thị Mỹ Ngọc', specialization: 'Địa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 7, phone: '0912345004' },
  { id: 't5', name: 'Lê Thị Nguyệt', specialization: 'Địa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 6, phone: '0912345005' },
  { id: 't6', name: 'Trần Thị Mỹ', specialization: 'Địa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 5, phone: '0912345006' },
  { id: 't7', name: 'Trương Thành Tuấn', specialization: 'GDKTPL', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 14, phone: '0912345007' },
  { id: 't8', name: 'Võ Thị Huyền Anh', specialization: 'GDKTPL', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 6, phone: '0912345008' },
  { id: 't9', name: 'Nguyễn Thị Ngọc Đào', specialization: 'GDKTPL', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 5, phone: '0912345009' },
  { id: 't10', name: 'Phạm Công Tăng', specialization: 'GDKTPL', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 4, phone: '0912345010' },
  { id: 't11', name: 'Phạm Long Hồ', specialization: 'GDKTPL', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 3, phone: '0912345011' },
  { id: 't12', name: 'Lâm Thị Thanh Tâm', specialization: 'Hóa', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 18, phone: '0912345012' },
  { id: 't13', name: 'Huỳnh Hữu Nghĩa', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 12, phone: '0912345013' },
  { id: 't14', name: 'Mai Lương Bích Ngọc', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 9, phone: '0912345014' },
  { id: 't15', name: 'Trần Thị Nhanh', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 8, phone: '0912345015' },
  { id: 't16', name: 'Nguyễn Thị Thu Trang', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 7, phone: '0912345016' },
  { id: 't17', name: 'Nguyễn Thị Thuỳ Lan', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 6, phone: '0912345017' },
  { id: 't18', name: 'Lâm Thành Thới', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 4, phone: '0912345018' },
  { id: 't19', name: 'Trần Cao Thanh Tuyến', specialization: 'Hóa', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 3, phone: '0912345019' },
  { id: 't20', name: 'Nguyễn Văn Xinh', specialization: 'Lý', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 19, phone: '0912345020', gender: 'Nam', dateOfBirth: '18/09/1976', dob: '18/09/1976', birthYear: 1976, namSinh: 1976 },
  { id: 't21', name: 'Ngô Duy Phong', specialization: 'Lý', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 11, phone: '0912345021' },
  { id: 't22', name: 'Trần Thị Thuý Nga', specialization: 'Lý', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 10, phone: '0912345022' },
  { id: 't23', name: 'Lý Thị Thanh Dung', specialization: 'Lý', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 8, phone: '0912345023' },
  { id: 't24', name: 'Đỗ Thị Bích Hồng', specialization: 'Lý', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 7, phone: '0912345024' },
  { id: 't25', name: 'Nguyễn Thị Kim Thoa', specialization: 'Lý', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 4, phone: '0912345025' },
  { id: 't26', name: 'Lâm Mộc Tùng', specialization: 'CNCN', position: 'Phó Hiệu trưởng', maxPeriods: 4, isHomeroomCapable: false, preferredGrades: ['12'], experienceYears: 22, phone: '0912345026', gender: 'Nam', dateOfBirth: '15/11/1975', dob: '15/11/1975', birthYear: 1975, namSinh: 1975 },
  { id: 't27', name: 'Từ Thị Kim Thoa', specialization: 'CNCN', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 9, phone: '0912345027' },
  { id: 't28', name: 'Nguyễn Thị Tuyết Nga', specialization: 'CNCN', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 8, phone: '0912345028' },
  { id: 't29', name: 'Nguyễn Thị Hoa Hồng', specialization: 'Sinh', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 17, phone: '0912345029' },
  { id: 't30', name: 'Nguyễn Thị Thúy Kiều', specialization: 'Sinh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 11, phone: '0912345030' },
  { id: 't31', name: 'Nguyễn Thị Thuý', specialization: 'Sinh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 10, phone: '0912345031' },
  { id: 't32', name: 'Lê Thị Thúy Kiều', specialization: 'Sinh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 8, phone: '0912345032' },
  { id: 't33', name: 'Phạm Thị Mỹ Xuyên', specialization: 'Sinh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 7, phone: '0912345033' },
  { id: 't34', name: 'Hồ Thuý Kiều', specialization: 'Sinh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 4, phone: '0912345034' },
  { id: 't35', name: 'Huỳnh Ngọc Ý', specialization: 'CNNN', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 8, phone: '0912345035' },
  { id: 't36', name: 'Lương Thị Mộng Lành', specialization: 'CNNN', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 7, phone: '0912345036' },
  { id: 't37', name: 'Bùi Ngọc Hạnh', specialization: 'Sử', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 16, phone: '0912345037' },
  { id: 't38', name: 'Nguyễn Văn Hùng', specialization: 'Sử', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 11, phone: '0912345038', gender: 'Nam', dob: '15/08/1967', dateOfBirth: '15/08/1967', birthYear: 1967, namSinh: 1967 },
  { id: 't39', name: 'Nguyễn Bích Ngọc', specialization: 'Sử', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 9, phone: '0912345039' },
  { id: 't40', name: 'Thái Phước Huy', specialization: 'Sử', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 8, phone: '0912345040' },
  { id: 't41', name: 'Nguyễn Thị Kim Ngân', specialization: 'Sử', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 4, phone: '0912345041' },
  { id: 't42', name: 'Võ Việt Dũng', specialization: 'Tin', position: 'Phó Hiệu trưởng', maxPeriods: 4, isHomeroomCapable: false, preferredGrades: ['12'], experienceYears: 23, phone: '0912345042' },
  { id: 't43', name: 'Nguyễn Văn Thanh', specialization: 'Tin', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 15, phone: '0912345043', gender: 'Nam', dateOfBirth: '10/12/1967', dob: '10/12/1967', birthYear: 1967, namSinh: 1967 },
  { id: 't44', name: 'Phan Hồng Nhung', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 10, phone: '0912345044' },
  { id: 't45', name: 'Nguyễn Tấn Phong', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 9, phone: '0912345045' },
  { id: 't46', name: 'Võ Thị Thanh Thảo', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 8, phone: '0912345046' },
  { id: 't47', name: 'Nguyễn Thị Mộng Thu', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 7, phone: '0912345047' },
  { id: 't48', name: 'Trần Trung Hiếu', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 5, phone: '0912345048' },
  { id: 't49', name: 'Huỳnh An Nghĩa', specialization: 'Tin', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 4, phone: '0912345049' },
  { id: 't50', name: 'Nguyễn Thanh Tiến', specialization: 'Toán', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 18, phone: '0912345050', gender: 'Nam', dateOfBirth: '20/10/1978', dob: '20/10/1978', birthYear: 1978, namSinh: 1978 },
  { id: 't51', name: 'Phan Tấn Tài', specialization: 'Toán', position: 'Tổ phó', maxPeriods: 16, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 14, phone: '0912345051' },
  { id: 't52', name: 'Nguyễn Văn Chúng', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 12, phone: '0912345052' },
  { id: 't53', name: 'Lê Minh Chính', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 11, phone: '0912345053' },
  { id: 't54', name: 'Lâm Đạo Cường', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 10, phone: '0912345054', gender: 'Nam', dob: '25/04/1969', dateOfBirth: '25/04/1969', birthYear: 1969, namSinh: 1969 },
  { id: 't55', name: 'Nguyễn Minh Dương', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 9, phone: '0912345055' },
  { id: 't56', name: 'Đinh Đức Long', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 8, phone: '0912345056' },
  { id: 't57', name: 'Nguyễn Bình Dương', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 8, phone: '0912345057' },
  { id: 't58', name: 'Hứa Tứ Hà', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 7, phone: '0912345058', gender: 'Nam', dob: '20/03/1968', dateOfBirth: '20/03/1968', birthYear: 1968, namSinh: 1968 },
  { id: 't59', name: 'Nguyễn Thị Hiền', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 7, phone: '0912345059' },
  { id: 't60', name: 'Phan Thành Phi Hùng', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 6, phone: '0912345060', gender: 'Nam', dob: '10/11/1968', dateOfBirth: '10/11/1968', birthYear: 1968, namSinh: 1968 },
  { id: 't61', name: 'Trương Phong', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 6, phone: '0912345061' },
  { id: 't62', name: 'Trần Thị Ngọc Phương', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 5, phone: '0912345062' },
  { id: 't63', name: 'Nguyễn Hoàng Sáu', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 4, phone: '0912345063', gender: 'Nam', dob: '12/09/1968', dateOfBirth: '12/09/1968', birthYear: 1968, namSinh: 1968 },
  { id: 't64', name: 'Nguyễn Bá Lâm', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 3, phone: '0912345064', gender: 'Nam', dob: '05/06/1968', dateOfBirth: '05/06/1968', birthYear: 1968, namSinh: 1968 },
  { id: 't65', name: 'Lê Thị Huỳnh Châu', specialization: 'Toán', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 3, phone: '0912345065' },
  { id: 't66', name: 'Mai Hồng Thoại', specialization: 'Văn', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 19, phone: '0912345066', gender: 'Nam', dateOfBirth: '05/05/1977', dob: '05/05/1977', birthYear: 1977, namSinh: 1977 },
  { id: 't67', name: 'Nguyễn Thị Kiều Trang', specialization: 'Văn', position: 'Tổ phó', maxPeriods: 16, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 15, phone: '0912345067' },
  { id: 't68', name: 'Võ Thị Bích Chi', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 12, phone: '0912345068' },
  { id: 't69', name: 'Huỳnh Phương Đan', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 11, phone: '0912345069' },
  { id: 't70', name: 'Nguyễn Thị Thùy Trang', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 10, phone: '0912345070', gender: 'Nữ', dob: '18/07/1969', dateOfBirth: '18/07/1969', birthYear: 1969, namSinh: 1969 },
  { id: 't71', name: 'Nguyễn Trung Nam', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 9, phone: '0912345071' },
  { id: 't72', name: 'Vũ Thị Tố Loan', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 8, phone: '0912345072' },
  { id: 't73', name: 'Đặng Thị Thư', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 8, phone: '0912345073' },
  { id: 't74', name: 'Trần Thị Ngọc Phượng', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 7, phone: '0912345074' },
  { id: 't75', name: 'Lê Thị Thoại', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 6, phone: '0912345075' },
  { id: 't76', name: 'Đặng Thị Trinh', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 5, phone: '0912345076' },
  { id: 't77', name: 'Bùi Thị Trúc Ly', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 4, phone: '0912345077' },
  { id: 't78', name: 'Phan Đoàn Hồng Phụng', specialization: 'Văn', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 3, phone: '0912345078' },
  { id: 't79', name: 'Trần Thị Minh Châu', specialization: 'Anh', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['12'], experienceYears: 17, phone: '0912345079' },
  { id: 't80', name: 'Phan Thị Thanh Loan', specialization: 'Anh', position: 'Tổ phó', maxPeriods: 16, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 14, phone: '0912345080' },
  { id: 't81', name: 'Võ Ngọc Kim Châu', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 11, phone: '0912345081' },
  { id: 't82', name: 'Phan Thị Kiều Diễm', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 10, phone: '0912345082' },
  { id: 't83', name: 'Nguyễn Phạm Trúc Mai', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 9, phone: '0912345083' },
  { id: 't84', name: 'Đinh Thị Thuý Hằng', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 8, phone: '0912345084' },
  { id: 't85', name: 'Nguyễn Thị Thu Hương', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 7, phone: '0912345085' },
  { id: 't86', name: 'Nguyễn Thị Mười', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11'], experienceYears: 7, phone: '0912345086' },
  { id: 't87', name: 'Nguyễn Thị Mỹ Dung', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 6, phone: '0912345087' },
  { id: 't88', name: 'Trần Thị Thu Vân', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10'], experienceYears: 6, phone: '0912345088' },
  { id: 't89', name: 'Trần Thị Nhã Phương', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 5, phone: '0912345089' },
  { id: 't90', name: 'Nguyễn Thị Như Thảo', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 4, phone: '0912345090' },
  { id: 't91', name: 'Võ Thị Bích Tuyền', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 3, phone: '0912345091' },
  { id: 't92', name: 'Bùi Thị Quế Phương', specialization: 'Anh', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 3, phone: '0912345092' },
  { id: 't93', name: 'Huỳnh Thanh Hòa', specialization: 'GDQPAN', position: 'Tổ trưởng', maxPeriods: 14, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 16, phone: '0912345093', gender: 'Nam', dateOfBirth: '22/06/1978', dob: '22/06/1978', birthYear: 1978, namSinh: 1978 },
  { id: 't94', name: 'Đặng Thị Thuý Kiều', specialization: 'GDQPAN', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 8, phone: '0912345094' },
  { id: 't95', name: 'Huỳnh Vinh Huy', specialization: 'GDTC', position: 'Phó Hiệu trưởng', maxPeriods: 4, isHomeroomCapable: false, preferredGrades: ['12'], experienceYears: 21, phone: '0912345095', gender: 'Nam', dateOfBirth: '14/04/1977', dob: '14/04/1977', birthYear: 1977, namSinh: 1977 },
  { id: 't96', name: 'Phạm Nam Điền', specialization: 'GDTC', position: 'Tổ phó', maxPeriods: 16, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 13, phone: '0912345096' },
  { id: 't97', name: 'Nguyễn Phú Cường', specialization: 'GDTC', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 9, phone: '0912345097' },
  { id: 't98', name: 'Huỳnh Chí Thành', specialization: 'GDTC', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['11', '12'], experienceYears: 8, phone: '0912345098' },
  { id: 't99', name: 'Phùng Ngọc Thương', specialization: 'GDTC', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 7, phone: '0912345099' },
  { id: 't100', name: 'Lại Thanh Việt', specialization: 'GDTC', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11', '12'], experienceYears: 5, phone: '0912345100' },
  { id: 't101', name: 'Nguyễn Công Anh', specialization: 'GDTC', position: 'Giáo viên', maxPeriods: 17, isHomeroomCapable: true, preferredGrades: ['10', '11'], experienceYears: 4, phone: '0912345101' }
];

interface ClassModel {
  id: string;
  name: string;
  grade: '10' | '11' | '12';
  homeroomTeacherId?: string;
}

export const DEFAULT_CLASSES: ClassModel[] = [
  // Khối 10 (14 lớp)
  { id: 'c_10A1', name: '10A1', grade: '10' },
  { id: 'c_10A2', name: '10A2', grade: '10' },
  { id: 'c_10A3', name: '10A3', grade: '10' },
  { id: 'c_10A4', name: '10A4', grade: '10' },
  { id: 'c_10A5', name: '10A5', grade: '10' },
  { id: 'c_10A6', name: '10A6', grade: '10' },
  { id: 'c_10A7', name: '10A7', grade: '10' },
  { id: 'c_10A8', name: '10A8', grade: '10' },
  { id: 'c_10A9', name: '10A9', grade: '10' },
  { id: 'c_10A10', name: '10A10', grade: '10' },
  { id: 'c_10A11', name: '10A11', grade: '10' },
  { id: 'c_10A12', name: '10A12', grade: '10' },
  { id: 'c_10A13', name: '10A13', grade: '10' },
  { id: 'c_10A14', name: '10A14', grade: '10' },

  // Khối 11 (15 lớp)
  { id: 'c_11A1', name: '11A1', grade: '11' },
  { id: 'c_11A2', name: '11A2', grade: '11' },
  { id: 'c_11A3', name: '11A3', grade: '11' },
  { id: 'c_11A4', name: '11A4', grade: '11' },
  { id: 'c_11A5', name: '11A5', grade: '11' },
  { id: 'c_11B1', name: '11B1', grade: '11' },
  { id: 'c_11B2', name: '11B2', grade: '11' },
  { id: 'c_11B3', name: '11B3', grade: '11' },
  { id: 'c_11B4', name: '11B4', grade: '11' },
  { id: 'c_11B5', name: '11B5', grade: '11' },
  { id: 'c_11C1', name: '11C1', grade: '11' },
  { id: 'c_11C2', name: '11C2', grade: '11' },
  { id: 'c_11C3', name: '11C3', grade: '11' },
  { id: 'c_11C4', name: '11C4', grade: '11' },
  { id: 'c_11C5', name: '11C5', grade: '11' },

  // Khối 12 (15 lớp)
  { id: 'c_12A1', name: '12A1', grade: '12' },
  { id: 'c_12A2', name: '12A2', grade: '12' },
  { id: 'c_12A3', name: '12A3', grade: '12' },
  { id: 'c_12A4', name: '12A4', grade: '12' },
  { id: 'c_12A5', name: '12A5', grade: '12' },
  { id: 'c_12B1', name: '12B1', grade: '12' },
  { id: 'c_12B2', name: '12B2', grade: '12' },
  { id: 'c_12B3', name: '12B3', grade: '12' },
  { id: 'c_12B4', name: '12B4', grade: '12' },
  { id: 'c_12B5', name: '12B5', grade: '12' },
  { id: 'c_12C1', name: '12C1', grade: '12' },
  { id: 'c_12C2', name: '12C2', grade: '12' },
  { id: 'c_12C3', name: '12C3', grade: '12' },
  { id: 'c_12C4', name: '12C4', grade: '12' },
  { id: 'c_12C5', name: '12C5', grade: '12' }
];

export const DEFAULT_HOMEROOM_ASSIGNMENTS: Record<string, string> = {
  // Khối 10
  'c_10A1': 't27',  // Từ Thị Kim Thoa
  'c_10A2': 't65',  // Lê Thị Huỳnh Châu
  'c_10A3': 't57',  // Nguyễn Bình Dương
  'c_10A4': 't14',  // Mai Lương Bích Ngọc
  'c_10A5': 't90',  // Nguyễn Thị Như Thảo
  'c_10A6': 't18',  // Lâm Thành Thới
  'c_10A7': 't32',  // Lê Thị Thúy Kiều
  'c_10A8': 't45',  // Nguyễn Tấn Phong
  'c_10A9': 't47',  // Nguyễn Thị Mộng Thu
  'c_10A10': 't10', // Phạm Công Tăng
  'c_10A11': 't23', // Lý Thị Thanh Dung
  'c_10A12': 't83', // Nguyễn Phạm Trúc Mai
  'c_10A13': 't36', // Lương Thị Mộng Lành
  'c_10A14': 't48', // Trần Trung Hiếu

  // Khối 11
  'c_11A1': 't24',  // Đỗ Thị Bích Hồng
  'c_11A2': 't59',  // Nguyễn Thị Hiền
  'c_11A3': 't22',  // Trần Thị Thuý Nga
  'c_11A4': 't25',  // Nguyễn Thị Kim Thoa
  'c_11A5': 't56',  // Đinh Đức Long
  'c_11B1': 't44',  // Phan Hồng Nhung
  'c_11B2': 't19',  // Trần Cao Thanh Tuyến
  'c_11B3': 't31',  // Nguyễn Thị Thuý
  'c_11B4': 't86',  // Nguyễn Thị Mười
  'c_11B5': 't84',  // Đinh Thị Thuý Hằng
  'c_11C1': 't53',  // Lê Minh Chính
  'c_11C2': 't28',  // Nguyễn Thị Tuyết Nga
  'c_11C3': 't8',   // Võ Thị Huyền Anh
  'c_11C4': 't34',  // Hồ Thuý Kiều
  'c_11C5': 't9',   // Nguyễn Thị Ngọc Đào

  // Khối 12
  'c_12A1': 't77',  // Bùi Thị Trúc Ly
  'c_12A2': 't71',  // Nguyễn Trung Nam
  'c_12A3': 't85',  // Nguyễn Thị Thu Hương
  'c_12A4': 't92',  // Bùi Thị Quế Phương
  'c_12A5': 't78',  // Phan Đoàn Hồng Phụng
  'c_12B1': 't74',  // Trần Thị Ngọc Phượng
  'c_12B2': 't15',  // Trần Thị Nhanh
  'c_12B3': 't68',  // Võ Thị Bích Chi
  'c_12B4': 't75',  // Lê Thị Thoại
  'c_12B5': 't17',  // Nguyễn Thị Thuỳ Lan
  'c_12C1': 't72',  // Vũ Thị Tố Loan
  'c_12C2': 't82',  // Phan Thị Kiều Diễm
  'c_12C3': 't80',  // Phan Thị Thanh Loan
  'c_12C4': 't30',  // Nguyễn Thị Thúy Kiều
  'c_12C5': 't88'   // Trần Thị Thu Vân
};

export interface Department {
  id: string;
  name: string;
}

export const DEFAULT_DEPARTMENTS: Department[] = [
  { id: "dept_toan_tin", name: "Tổ Toán - Tin" },
  { id: "dept_ngu_van", name: "Tổ Ngữ văn" },
  { id: "dept_ngoai_ngu", name: "Tổ Ngoại ngữ" },
  { id: "dept_khtn", name: "Tổ KHTN (Lý - Hóa - Sinh)" },
  { id: "dept_khxh", name: "Tổ KHXH (Sử - Địa - GDKT&PL)" },
  { id: "dept_congnghe_nghethuat", name: "Tổ Công nghệ - Nghệ thuật" },
  { id: "dept_gdtc_gdqpan", name: "Tổ GDTC - GDQPAN" },
  { id: "dept_hdtn", name: "Tổ HĐTN-HN & Nội dung khác" }
];

export const getDefaultDepartment = (subjectId: string, subjectName?: string): string => {
  const norm = (subjectId + ' ' + (subjectName || '')).toLowerCase();
  if (norm.includes('toán') || norm.includes('tin')) return 'Tổ Toán - Tin';
  if (norm.includes('văn') || norm.includes('ngữ văn')) return 'Tổ Ngữ văn';
  if (norm.includes('anh') || norm.includes('pháp') || norm.includes('ngoại ngữ')) return 'Tổ Ngoại ngữ';
  if (norm.includes('lý') || norm.includes('vật lý') || norm.includes('hóa') || norm.includes('sinh')) return 'Tổ KHTN (Lý - Hóa - Sinh)';
  if (norm.includes('sử') || norm.includes('địa') || norm.includes('gdktpl') || norm.includes('gdcd') || norm.includes('triết')) return 'Tổ KHXH (Sử - Địa - GDKT&PL)';
  if (norm.includes('gdtc') || norm.includes('thể dục') || norm.includes('gdqpan') || norm.includes('quốc phòng')) return 'Tổ GDTC - GDQPAN';
  if (norm.includes('cn') || norm.includes('công nghệ') || norm.includes('nghệ thuật') || norm.includes('âm nhạc') || norm.includes('mỹ thuật')) return 'Tổ Công nghệ - Nghệ thuật';
  if (norm.includes('tnhn') || norm.includes('gddp') || norm.includes('địa phương') || norm.includes('trải nghiệm') || norm.includes('hướng nghiệp')) return 'Tổ HĐTN-HN & Nội dung khác';
  return 'Tổ Toán - Tin';
};

export interface SubjectConfig {
  id: string;
  name: string;
  departmentId?: string;
  department?: string;
  grade10Periods: number;
  grade11Periods: number;
  grade12Periods: number;
}

export const DEFAULT_SUBJECTS_CONFIG: SubjectConfig[] = [
  { id: 'Toán', name: 'Toán', grade10Periods: 3, grade11Periods: 3, grade12Periods: 3 },
  { id: 'Lý', name: 'Lý', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'Hóa', name: 'Hóa', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'Sinh', name: 'Sinh', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'Tin', name: 'Tin', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'CNCN', name: 'Công nghệ (Công nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 },
  { id: 'CNNN', name: 'Công nghệ (Nông nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 },
  { id: 'Văn', name: 'Văn', grade10Periods: 3, grade11Periods: 3, grade12Periods: 3 },
  { id: 'Sử', name: 'Sử', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'Địa', name: 'Địa', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'GDKTPL', name: 'GDKTPL', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'Anh', name: 'Anh', grade10Periods: 3, grade11Periods: 3, grade12Periods: 3 },
  { id: 'GDTC', name: 'GDTC', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 },
  { id: 'GDQPAN', name: 'GDQPAN', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 },
  { id: 'GDĐP', name: 'GDĐP', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 },
  { id: 'TNHN1', name: 'TNHN1', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 },
  { id: 'TNHN2', name: 'TNHN2', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 }
];

export const createDefault11B3Preset = () => ({
  'Toán': { mainPeriods: 4, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Văn': { mainPeriods: 3, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Anh': { mainPeriods: 3, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Lý': { mainPeriods: 2, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Hóa': { mainPeriods: 2, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Sinh': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Tin': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDTC': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDQPAN': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDĐP': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN1': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN2': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'CNCN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'CNNN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'Sử': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'Địa': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'GDKTPL': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true }
});

export const createDefaultGrade11Preset = () => ({
  'Toán': { mainPeriods: 3, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Văn': { mainPeriods: 4, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Anh': { mainPeriods: 3, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Lý': { mainPeriods: 2, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Hóa': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Sinh': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Tin': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'CNCN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'CNNN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'Sử': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Địa': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDKTPL': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDTC': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDQPAN': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDĐP': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN1': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN2': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false }
});

export const createDefaultGrade12Preset = () => ({
  'Toán': { mainPeriods: 3, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Văn': { mainPeriods: 3, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Anh': { mainPeriods: 3, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Lý': { mainPeriods: 2, oppPeriods: 1, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Hóa': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Sinh': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Tin': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'CNCN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'CNNN': { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true },
  'Sử': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'Địa': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDKTPL': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDTC': { mainPeriods: 2, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDQPAN': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'GDĐP': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN1': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false },
  'TNHN2': { mainPeriods: 1, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: false }
});

export const getTermStorageKey = (year: string, semester: string): string => {
  const cleanYear = (year || '2025 – 2026').replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
  const s = (semester || 'Học kỳ I').toLowerCase();
  const cleanSem = s.includes('ii') || s.includes('2')
    ? 'HK2'
    : (s.includes('cả năm') || s.includes('ca nam') ? 'CN' : 'HK1');
  return `${cleanYear}_${cleanSem}`;
};

export const getYearStartNumber = (yearStr: string): number => {
  const match = yearStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
};

export const DEFAULT_ACADEMIC_YEARS = [
  '2023 – 2024',
  '2024 – 2025',
  '2025 – 2026',
  '2026 – 2027',
  '2027 – 2028'
];

export const AVAILABLE_SEMESTERS = [
  'Học kỳ I',
  'Học kỳ II'
];

export default function App() {
  const [customLogo, setCustomLogo] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem('custom_school_logo');
      if (saved) {
        const lower = saved.toLowerCase();
        if (
          lower.includes('vinh_long') || 
          lower.includes('vinh long') || 
          lower.includes('vĩnh long') || 
          lower.includes('image_13') ||
          lower.includes('logo_nbk_wiki') ||
          lower.includes('gold_green') ||
          lower.includes('greenbg') ||
          lower.includes('16a34a') ||
          lower.includes('logo_nbk_an_giang_gold_green')
        ) {
          localStorage.removeItem('custom_school_logo');
          return null;
        }
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  });

  // Lắng nghe sự kiện cập nhật logo theo thời gian thực giữa các modal & thanh header
  useEffect(() => {
    const handleLogoUpdate = (e: any) => {
      setCustomLogo(e.detail || null);
    };
    window.addEventListener('school_logo_updated', handleLogoUpdate);
    return () => window.removeEventListener('school_logo_updated', handleLogoUpdate);
  }, []);

  // Lắng nghe dữ liệu trường học từ Cloud Firestore (schools/thpt-nguyen-binh-khiem)
  // để tự động hiển thị logo tùy biến hoặc logo chuẩn mới trên tất cả các máy tính
  useEffect(() => {
    const unsubSchool = subscribeToSchool(TARGET_SCHOOL_ID, (schoolData) => {
      if (!schoolData) return;
      if (schoolData.customLogo) {
        const safe = getSafeSchoolLogo(schoolData.customLogo);
        if (safe.includes('/logo_nbk.svg')) {
          setCustomLogo(null);
          try { localStorage.removeItem('custom_school_logo'); } catch {}
        } else {
          setCustomLogo(schoolData.customLogo);
          try { localStorage.setItem('custom_school_logo', schoolData.customLogo); } catch {}
        }
      } else if (schoolData.customLogo === null) {
        setCustomLogo(null);
        try { localStorage.removeItem('custom_school_logo'); } catch {}
      }
    });
    return () => unsubSchool();
  }, []);

  // Tự động dọn dẹp cache logo cũ trên trình duyệt máy khách (tránh dính cache máy tính tại trường)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('custom_school_logo');
      if (saved) {
        const lower = saved.toLowerCase();
        if (
          lower.includes('vinh_long') || 
          lower.includes('vinh long') || 
          lower.includes('vĩnh long') || 
          lower.includes('image_13') ||
          lower.includes('logo_nbk_wiki') ||
          lower.includes('gold_green') ||
          lower.includes('logo_nbk_an_giang_gold_green')
        ) {
          localStorage.removeItem('custom_school_logo');
          setCustomLogo(null);
        }
      }
      const infoStr = localStorage.getItem('edu_school_info_v1');
      if (infoStr) {
        const parsed = JSON.parse(infoStr);
        if (parsed.logoId === 'logo_nbk_an_giang_gold_green' || parsed.logoUrl?.includes('image_13')) {
          parsed.logoId = 'logo_nbk_an_giang_official_2026';
          parsed.logoUrl = '/logo_nbk.svg?v=3.0';
          localStorage.setItem('edu_school_info_v1', JSON.stringify(parsed));
        }
      }
    } catch {}
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64Data = await resizeImageToBase64(file, 200);
        setCustomLogo(base64Data);
        await saveSchoolCustomLogo(TARGET_SCHOOL_ID, base64Data);
      } catch (err) {
        console.error('Lỗi tải và lưu logo:', err);
      } finally {
        e.target.value = '';
      }
    }
  };

  const handleResetLogo = async () => {
    setCustomLogo(null);
    try {
      await saveSchoolCustomLogo(TARGET_SCHOOL_ID, null);
    } catch (err) {
      console.error('Lỗi khôi phục logo gốc:', err);
    }
  };
  const { 
    user,
    role,
    isAdmin, 
    isHeadOfDepartment,
    isTeacher,
    isGuest,
    hasPermission,
    openLoginModal, 
    logout, 
    currentUser, 
    syncToCloud, 
    fetchFromCloud, 
    isSyncing, 
    lastSyncedAt,
    currentSchoolId,
    setCurrentSchoolId,
    currentSchoolName,
    setCurrentSchoolName,
    cloudConnectionStatus
  } = useAuth();

  const [isUserManagementModalOpen, setIsUserManagementModalOpen] = useState(false);

  // Academic Year & Semester Persistence
  const [availableYears, setAvailableYears] = useState<string[]>(() => {
    const saved = localStorage.getItem('edu_available_years');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return DEFAULT_ACADEMIC_YEARS;
  });

  const [currentAcademicYear, setCurrentAcademicYear] = useState<string>(() => {
    const saved = localStorage.getItem('edu_current_academic_year');
    if (saved) return saved;
    const savedSchool = localStorage.getItem('edu_school_info_v1');
    if (savedSchool) {
      try {
        const parsed = JSON.parse(savedSchool);
        if (parsed.academicYear) return parsed.academicYear;
      } catch (e) {}
    }
    return '2025 – 2026';
  });

  // Năm hiện hành làm mốc chuẩn (các năm có số năm bắt đầu nhỏ hơn mốc này mặc định là các năm đã qua và sẽ bị khóa)
  const primarySchoolYear = useMemo(() => {
    return localStorage.getItem('edu_primary_school_year') || '2025 – 2026';
  }, []);

  // Quản lý Khóa / Mở khóa dữ liệu năm học (được lưu trữ bền vững)
  const [lockedYears, setLockedYears] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('edu_locked_years');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {};
  });

  const isYearLocked = (year: string): boolean => {
    if (lockedYears[year] !== undefined) {
      return lockedYears[year];
    }
    // Mặc định: năm hiện hành không khóa, các năm đã qua thì khóa
    const yStart = getYearStartNumber(year);
    const benchStart = getYearStartNumber(primarySchoolYear);
    return yStart > 0 && benchStart > 0 && yStart < benchStart;
  };

  const isCurrentTermLocked = isYearLocked(currentAcademicYear);

  const handleToggleLockYear = (yearToToggle: string) => {
    const currentlyLocked = isYearLocked(yearToToggle);
    const nextLocked = !currentlyLocked;
    setLockedYears(prev => {
      const updated = { ...prev, [yearToToggle]: nextLocked };
      localStorage.setItem('edu_locked_years', JSON.stringify(updated));
      return updated;
    });
    if (nextLocked) {
      showTermNotification(`🔒 Đã KHÓA dữ liệu năm học ${yearToToggle}! Dữ liệu được bảo vệ an toàn, tránh bị vô ý thay đổi.`);
    } else {
      showTermNotification(`🔓 Đã MỞ KHÓA dữ liệu năm học ${yearToToggle}! Thầy/cô có thể chỉnh sửa phân công bình thường.`);
    }
  };

  const [currentSemester, setCurrentSemester] = useState<string>(() => {
    const saved = localStorage.getItem('edu_current_semester');
    if (saved) return saved;
    const savedSchool = localStorage.getItem('edu_school_info_v1');
    if (savedSchool) {
      try {
        const parsed = JSON.parse(savedSchool);
        if (parsed.semester) return parsed.semester;
      } catch (e) {}
    }
    return 'Học kỳ I';
  });

  const [termInitModal, setTermInitModal] = useState<{
    targetYear: string;
    targetSemester: string;
  } | null>(null);

  const [isYearSemesterModalOpen, setIsYearSemesterModalOpen] = useState(false);
  const [isAddYearModalOpen, setIsAddYearModalOpen] = useState(false);
  const [newYearInput, setNewYearInput] = useState('');
  const [termNotification, setTermNotification] = useState<string | null>(null);

  const [isSendScheduleModalOpen, setIsSendScheduleModalOpen] = useState(false);

  const showTermNotification = (msg: string) => {
    setTermNotification(msg);
    setTimeout(() => setTermNotification(null), 4000);
  };

  const currentTermKey = useMemo(() => {
    return getTermStorageKey(currentAcademicYear, currentSemester);
  }, [currentAcademicYear, currentSemester]);

  // Persistence state
  const [teachers, setTeachers] = useState<Teacher[]>(() => {
    const saved = localStorage.getItem('edu_teachers');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length < 50) {
          // Force upgrade to the complete list of 101 teachers
          return DEFAULT_TEACHERS;
        }
        parsed.forEach((t: Teacher) => {
          if (!t.specialization && (t.subject || t.monGiangDay || t.subjectId || t.monDay || t.monHoc)) {
            t.specialization = (t.subject || t.monGiangDay || t.subjectId || t.monDay || t.monHoc) as string;
          }
          if (t.specialization === 'GD') t.specialization = 'GDKTPL';
          if (
            t.id === 't35' || t.id === 't36' ||
            t.name === 'Huỳnh Ngọc Ý' || t.name === 'Lương Thị Mộng Lành' ||
            t.specialization === 'CN (Nông nghiệp)' || t.specialization === 'CNNN' ||
            (typeof t.specialization === 'string' && t.specialization.includes('Nông nghiệp'))
          ) {
            t.specialization = 'CNNN';
          } else if (
            t.id === 't26' || t.id === 't27' || t.id === 't28' ||
            t.name === 'Lâm Mộc Tùng' || t.name === 'Từ Thị Kim Thoa' || t.name === 'Nguyễn Thị Tuyết Nga' ||
            t.specialization === 'CN (Công nghiệp)' || t.specialization === 'CNCN' ||
            t.specialization === 'Công nghệ (Công nghiệp)' ||
            t.specialization === 'Công nghệ' || t.specialization === 'CN' ||
            (typeof t.specialization === 'string' && (t.specialization.includes('Công nghiệp') || t.specialization.includes('Cong nghiep')))
          ) {
            t.specialization = 'CNCN';
          }
          if (!t.position) {
            const defaultMatch = DEFAULT_TEACHERS.find(dt => dt.id === t.id || dt.name === t.name);
            t.position = defaultMatch?.position || 'Giáo viên';
          }
          if (t.position === 'Bí thư Đoàn') t.position = 'Bí thư đoàn trường';
          if (t.position === 'Phó Bí thư Đoàn') t.position = 'Phó Bí thư đoàn trường';

          // Đồng bộ định mức chuẩn mới: HT 2, PHT 4, TT 14, TP 16, BTĐ 2.5, PBTĐ 8.5, GV 17
          if (t.name === 'Huỳnh Vinh Huy' || t.id === 't95') {
            t.position = 'Phó Hiệu trưởng';
            t.maxPeriods = 4;
          } else {
            const defaultMatch = DEFAULT_TEACHERS.find(dt => dt.id === t.id);
            if (defaultMatch) {
              t.maxPeriods = defaultMatch.maxPeriods;
              t.position = defaultMatch.position;
            } else {
              // Cho giáo viên thêm mới nếu trước đó dùng định mức cũ
              if (t.maxPeriods === 19 && t.position === 'Giáo viên') {
                t.maxPeriods = 17;
              } else if (t.maxPeriods === 15 && t.position === 'Tổ trưởng') {
                t.maxPeriods = 14;
              } else if (t.maxPeriods === 17 && t.position === 'Tổ phó') {
                t.maxPeriods = 16;
              }
            }
          }
          if (t.position === 'Bí thư đoàn trường' && (t.maxPeriods === 14.5 || t.maxPeriods === 4)) {
            t.maxPeriods = 2.5;
          }

          // Đồng bộ chuẩn hóa dữ liệu hồ sơ nhân sự (Nghị định 135/2020/NĐ-CP):
          // Nhóm chuẩn bị nghỉ hưu (1 - 5 năm tới) gồm 7 GV nam (1967/1968/1969) và 1 GV nữ (1969)
          if (t.id === 't38' || t.name === 'Nguyễn Văn Hùng') {
            t.dateOfBirth = '15/08/1967';
            t.dob = '15/08/1967';
            t.gender = 'Nam';
            t.namSinh = 1967;
            t.birthYear = 1967;
          } else if (t.id === 't58' || t.name === 'Hứa Tứ Hà') {
            t.dateOfBirth = '20/03/1968';
            t.dob = '20/03/1968';
            t.gender = 'Nam';
            t.namSinh = 1968;
            t.birthYear = 1968;
          } else if (t.id === 't60' || t.name === 'Phan Thành Phi Hùng') {
            t.dateOfBirth = '10/11/1968';
            t.dob = '10/11/1968';
            t.gender = 'Nam';
            t.namSinh = 1968;
            t.birthYear = 1968;
          } else if (t.id === 't64' || t.name === 'Nguyễn Bá Lâm') {
            t.dateOfBirth = '05/06/1968';
            t.dob = '05/06/1968';
            t.gender = 'Nam';
            t.namSinh = 1968;
            t.birthYear = 1968;
          } else if (t.id === 't63' || t.name === 'Nguyễn Hoàng Sáu') {
            t.dateOfBirth = '12/09/1968';
            t.dob = '12/09/1968';
            t.gender = 'Nam';
            t.namSinh = 1968;
            t.birthYear = 1968;
          } else if (t.id === 't54' || t.name === 'Lâm Đạo Cường') {
            t.dateOfBirth = '25/04/1969';
            t.dob = '25/04/1969';
            t.gender = 'Nam';
            t.namSinh = 1969;
            t.birthYear = 1969;
          } else if (t.id === 't70' || t.name === 'Nguyễn Thị Thùy Trang') {
            t.dateOfBirth = '18/07/1969';
            t.dob = '18/07/1969';
            t.gender = 'Nữ';
            t.namSinh = 1969;
            t.birthYear = 1969;
          } else if (t.id === 't43' || t.name === 'Nguyễn Văn Thanh') {
            t.dateOfBirth = '10/12/1967';
            t.dob = '10/12/1967';
            t.gender = 'Nam';
            t.namSinh = 1967;
            t.birthYear = 1967;
          } else {
            // Giữ nguyên ngày sinh của giáo viên nếu đã có trong dữ liệu
            const matchYear = String(t.birthYear || t.namSinh || t.dob || t.dateOfBirth || '').match(/\d{4}/);
            const rawYear = matchYear ? parseInt(matchYear[0], 10) : (t.experienceYears ? 2026 - 22 - t.experienceYears : 1985);
            t.namSinh = rawYear;
            t.birthYear = rawYear;

            if (!t.gender) {
              t.gender = normalizeTeacherGender(undefined, t.name);
            }
            if (!t.dateOfBirth && !t.dob) {
              const num = parseInt(t.id.replace(/\D/g, '')) || 1;
              const day = ((num * 7) % 28) + 1;
              const month = ((num * 3) % 12) + 1;
              t.dateOfBirth = formatDOB(day, month, t.namSinh);
              t.dob = t.dateOfBirth;
            } else {
              const p = parseDateOfBirth(t.dateOfBirth || t.dob, t.namSinh);
              t.dateOfBirth = formatDOB(p.day, p.month, p.year);
              t.dob = t.dateOfBirth;
              t.namSinh = p.year;
              t.birthYear = p.year;
            }
          }
        });
        return parsed;
      } catch (e) {
        return DEFAULT_TEACHERS;
      }
    }
    return DEFAULT_TEACHERS;
  });

  const [classes, setClasses] = useState<ClassModel[]>(() => {
    const saved = localStorage.getItem('edu_classes_v3') || localStorage.getItem('edu_classes');
    let baseList = DEFAULT_CLASSES;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) baseList = parsed;
      } catch (e) {}
    }
    const savedAssignments = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
    let hrMap: Record<string, string> = DEFAULT_HOMEROOM_ASSIGNMENTS;
    if (savedAssignments) {
      try {
        const p = JSON.parse(savedAssignments);
        if (p?.homeroomAssignments) hrMap = { ...DEFAULT_HOMEROOM_ASSIGNMENTS, ...p.homeroomAssignments };
      } catch (e) {}
    }
    return baseList.map(c => ({
      ...c,
      homeroomTeacherId: c.homeroomTeacherId || hrMap[c.id] || hrMap[c.id.replace(/^c_/, '')] || (c.name ? hrMap[c.name] : undefined)
    }));
  });

  const [assignments, setAssignments] = useState<Assignments>(() => {
    const saved = localStorage.getItem('edu_assignments_v3');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.homeroomAssignments) {
          if (parsed.subjectAssignments) {
            Object.keys(parsed.subjectAssignments).forEach(cId => {
              // Migrate GD -> GDKTPL
              if (parsed.subjectAssignments[cId]?.['GD']) {
                if (!parsed.subjectAssignments[cId]['GDKTPL']) {
                  parsed.subjectAssignments[cId]['GDKTPL'] = parsed.subjectAssignments[cId]['GD'];
                }
                delete parsed.subjectAssignments[cId]['GD'];
              }
              // Migrate CN (Công nghiệp) -> CNCN
              if (parsed.subjectAssignments[cId]?.['CN (Công nghiệp)']) {
                if (!parsed.subjectAssignments[cId]['CNCN']) {
                  parsed.subjectAssignments[cId]['CNCN'] = parsed.subjectAssignments[cId]['CN (Công nghiệp)'];
                }
                delete parsed.subjectAssignments[cId]['CN (Công nghiệp)'];
              }
              // Migrate CN (Nông nghiệp) -> CNNN
              if (parsed.subjectAssignments[cId]?.['CN (Nông nghiệp)']) {
                if (!parsed.subjectAssignments[cId]['CNNN']) {
                  parsed.subjectAssignments[cId]['CNNN'] = parsed.subjectAssignments[cId]['CN (Nông nghiệp)'];
                }
                delete parsed.subjectAssignments[cId]['CN (Nông nghiệp)'];
              }
              // Migrate any existing TNHN assignments to TNHN1
              if (parsed.subjectAssignments[cId]?.['TNHN']) {
                if (!parsed.subjectAssignments[cId]['TNHN1']) {
                  parsed.subjectAssignments[cId]['TNHN1'] = parsed.subjectAssignments[cId]['TNHN'];
                }
                delete parsed.subjectAssignments[cId]['TNHN'];
              }
              // Migrate GDQPAN variations
              if (parsed.subjectAssignments[cId]?.['GD QP-AN']) {
                if (!parsed.subjectAssignments[cId]['GDQPAN']) {
                  parsed.subjectAssignments[cId]['GDQPAN'] = parsed.subjectAssignments[cId]['GD QP-AN'];
                }
              }
              if (parsed.subjectAssignments[cId]?.['GDQP']) {
                if (!parsed.subjectAssignments[cId]['GDQPAN']) {
                  parsed.subjectAssignments[cId]['GDQPAN'] = parsed.subjectAssignments[cId]['GDQP'];
                }
              }
            });
          }
          return parsed;
        }
      } catch (e) {}
    }
    return { homeroomAssignments: DEFAULT_HOMEROOM_ASSIGNMENTS, subjectAssignments: {} };
  });

  const [subjectsConfig, setSubjectsConfig] = useState<SubjectConfig[]>(() => {
    const saved = localStorage.getItem('edu_subjects_config');
    if (saved) {
      try {
        const parsed: SubjectConfig[] = JSON.parse(saved);
        // Remove old TNHN only
        let updated = parsed.filter(s => s.id !== 'TNHN');

        // Migrate GD to GDKTPL
        const gdIdx = updated.findIndex(s => s.id === 'GD');
        if (gdIdx !== -1) {
          updated[gdIdx] = { ...updated[gdIdx], id: 'GDKTPL', name: 'GDKTPL' };
        } else if (!updated.some(s => s.id === 'GDKTPL')) {
          updated.push({ id: 'GDKTPL', name: 'GDKTPL', grade10Periods: 2, grade11Periods: 2, grade12Periods: 2 });
        }

        // Migrate CN (Công nghiệp) / Công nghệ / CNCN to CNCN
        const cncnIdx = updated.findIndex(s => s.id === 'CN (Công nghiệp)' || s.id === 'CNCN' || (s.id === 'CN' && s.name !== 'Công nghệ (Nông nghiệp)'));
        if (cncnIdx !== -1) {
          updated[cncnIdx] = { ...updated[cncnIdx], id: 'CNCN', name: 'Công nghệ (Công nghiệp)' };
        } else if (!updated.some(s => s.id === 'CNCN')) {
          updated.push({ id: 'CNCN', name: 'Công nghệ (Công nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }

        // Migrate CN (Nông nghiệp) / CNNN to CNNN
        const cnnnIdx = updated.findIndex(s => s.id === 'CN (Nông nghiệp)' || s.id === 'CNNN' || s.name === 'Công nghệ (Nông nghiệp)' || s.id === 'Nông nghiệp');
        if (cnnnIdx !== -1) {
          updated[cnnnIdx] = { ...updated[cnnnIdx], id: 'CNNN', name: 'Công nghệ (Nông nghiệp)' };
        } else if (!updated.some(s => s.id === 'CNNN')) {
          updated.push({ id: 'CNNN', name: 'Công nghệ (Nông nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }

        // Đồng bộ mọi bản ghi cũ có id hoặc tên CNCN / CNNN
        updated.forEach(s => {
          if (s.id === 'CNCN' || s.name === 'CN') {
            s.id = 'CNCN';
            s.name = 'Công nghệ (Công nghiệp)';
          }
          if (s.id === 'CNNN') {
            s.name = 'Công nghệ (Nông nghiệp)';
          }
        });

        // Migrate GDTC name to 'GDTC'
        const gdtcItem = updated.find(s => s.id === 'GDTC');
        if (gdtcItem) {
          gdtcItem.name = 'GDTC';
        }

        // Migrate GDQPAN / GD QP-AN / GDQP
        const qpanIdx = updated.findIndex(s => s.id === 'GDQPAN' || s.id === 'GD QP-AN' || s.id === 'GDQP' || s.id === 'QPAN');
        if (qpanIdx !== -1) {
          updated[qpanIdx] = {
            ...updated[qpanIdx],
            id: 'GDQPAN',
            name: 'GDQPAN',
            grade10Periods: updated[qpanIdx].grade10Periods || 1,
            grade11Periods: updated[qpanIdx].grade11Periods || 1,
            grade12Periods: updated[qpanIdx].grade12Periods || 1,
          };
        } else if (!updated.some(s => s.id === 'GDQPAN')) {
          updated.push({ id: 'GDQPAN', name: 'GDQPAN', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }
        updated.forEach(s => {
          if (s.id === 'GD QP-AN' || s.id === 'GDQP' || s.id === 'QPAN') {
            s.id = 'GDQPAN';
          }
          if (s.id === 'GDQPAN') {
            s.name = 'GDQPAN';
            if (!s.grade10Periods) s.grade10Periods = 1;
            if (!s.grade11Periods) s.grade11Periods = 1;
            if (!s.grade12Periods) s.grade12Periods = 1;
          }
        });

        if (!updated.some(s => s.id === 'TNHN1')) {
          updated.push({ id: 'TNHN1', name: 'TNHN1', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }
        if (!updated.some(s => s.id === 'TNHN2')) {
          updated.push({ id: 'TNHN2', name: 'TNHN2', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }

        // Đảm bảo không trùng lặp môn học nào theo tên chuẩn hóa
        const dedupedSubjects: SubjectConfig[] = [];
        const seenNorms = new Set<string>();
        updated.forEach(s => {
          const norm = normalizeSubjectName(s.id);
          if (!seenNorms.has(norm)) {
            seenNorms.add(norm);
            dedupedSubjects.push({
              ...s,
              id: norm === 'GDQPAN' ? 'GDQPAN' : (norm === 'CNCN' ? 'CNCN' : (norm === 'CNNN' ? 'CNNN' : s.id)),
              name: norm === 'CNCN' ? 'Công nghệ (Công nghiệp)' : (norm === 'CNNN' ? 'Công nghệ (Nông nghiệp)' : (norm === 'GDQPAN' ? 'GDQPAN' : (s.name || s.id)))
            });
          }
        });
        updated = dedupedSubjects;

        // Đảm bảo cả CNCN và CNNN đều có mặt
        if (!updated.some(s => s.id === 'CNCN')) {
          updated.push({ id: 'CNCN', name: 'Công nghệ (Công nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }
        if (!updated.some(s => s.id === 'CNNN')) {
          updated.push({ id: 'CNNN', name: 'Công nghệ (Nông nghiệp)', grade10Periods: 1, grade11Periods: 1, grade12Periods: 1 });
        }

        // Đảm bảo tổng số tiết trong tuần không vượt quá 30 tiết (đúng định mức tối đa 6 ngày x 5 tiết của GDPT 2018)
        const total10 = updated.reduce((sum, s) => sum + (s.grade10Periods || 0), 0);
        if (total10 > 30) {
          const tnhn2 = updated.find(s => s.id === 'TNHN2');
          if (tnhn2 && tnhn2.grade10Periods > 1) {
            tnhn2.grade10Periods = 1;
            tnhn2.grade11Periods = 1;
            tnhn2.grade12Periods = 1;
          }
        }
        return updated;
      } catch (e) {}
    }
    return DEFAULT_SUBJECTS_CONFIG;
  });

  // State danh mục Tổ chuyên môn (departments) đồng bộ Firestore và localStorage
  const [departments, setDepartments] = useState<Department[]>(() => {
    const saved = localStorage.getItem('edu_departments');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return DEFAULT_DEPARTMENTS;
  });

  const [isManageDepartmentsModalOpen, setIsManageDepartmentsModalOpen] = useState(false);
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState<string>('');
  const [newDepartmentName, setNewDepartmentName] = useState<string>('');

  // Dynamic subjects list synchronized with subjects configuration (duy nhất 1 môn cho mỗi bộ môn)
  const SUBJECTS = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    subjectsConfig.forEach(s => {
      const norm = normalizeSubjectName(s.id);
      if (!seen.has(norm)) {
        seen.add(norm);
        list.push({
          id: s.id,
          name: s.name || s.id
        });
      }
    });
    return list;
  }, [subjectsConfig]);

  const [statsSubTab, setStatsSubTab] = useState<'teaching' | 'personnel'>('teaching');
  const [excessTeachingSearch, setExcessTeachingSearch] = useState('');
  const [excessTeachingFilter, setExcessTeachingFilter] = useState<'all' | 'overload' | 'underload' | 'exact' | 'homeroom_overload'>('all');
  const [excessTeachingSort, setExcessTeachingSort] = useState<'diff_desc' | 'diff_asc' | 'name' | 'dept'>('diff_desc');
  const [activeTab, setActiveTab] = useState<'welcome' | 'board' | 'teachers' | 'subject_catalog' | 'classes' | 'subjects' | 'stats' | 'timetable' | null>('welcome');
  const [subjectCatalogSearch, setSubjectCatalogSearch] = useState('');

  // Filter states for Classes Tab (44 classes, grade filters, search)
  const [classGradeFilter, setClassGradeFilter] = useState<'all' | '10' | '11' | '12'>('all');
  const [classSearchQuery, setClassSearchQuery] = useState('');

  // Per-class customized periods & 3 consecutive periods state
  const [classSubjectPeriods, setClassSubjectPeriods] = useState<Record<string, Record<string, any>>>(() => {
    const saved = localStorage.getItem('edu_class_subject_periods_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(cId => {
          if (parsed[cId]?.['GD'] !== undefined) {
            if (parsed[cId]['GDKTPL'] === undefined) {
              parsed[cId]['GDKTPL'] = parsed[cId]['GD'];
            }
            delete parsed[cId]['GD'];
          }
          if (parsed[cId]?.['CN (Công nghiệp)'] !== undefined) {
            if (parsed[cId]['CNCN'] === undefined) {
              parsed[cId]['CNCN'] = parsed[cId]['CN (Công nghiệp)'];
            }
            delete parsed[cId]['CN (Công nghiệp)'];
          }
          if (parsed[cId]?.['CN (Nông nghiệp)'] !== undefined) {
            if (parsed[cId]['CNNN'] === undefined) {
              parsed[cId]['CNNN'] = parsed[cId]['CN (Nông nghiệp)'];
            }
            delete parsed[cId]['CN (Nông nghiệp)'];
          }
          if (parsed[cId]?.['TNHN'] !== undefined) {
            delete parsed[cId]['TNHN'];
          }
          if (parsed[cId]?.['GD QP-AN'] !== undefined) {
            if (parsed[cId]['GDQPAN'] === undefined) {
              parsed[cId]['GDQPAN'] = parsed[cId]['GD QP-AN'];
            }
            delete parsed[cId]['GD QP-AN'];
          }
          if (parsed[cId]?.['GDQP'] !== undefined) {
            if (parsed[cId]['GDQPAN'] === undefined) {
              parsed[cId]['GDQPAN'] = parsed[cId]['GDQP'];
            }
            delete parsed[cId]['GDQP'];
          }
        });
        const initial = parsed || {};
        if (!initial['c_11B3'] && !initial['11B3']) {
          const p11B3 = createDefault11B3Preset();
          initial['c_11B3'] = p11B3;
          initial['11B3'] = p11B3;
        }
        ['11A1', '11A2', '11A3', '11A4', '11A5'].forEach(name => {
          const cid = 'c_' + name;
          if (!initial[cid] && !initial[name]) {
            const p11 = createDefaultGrade11Preset();
            initial[cid] = p11;
            initial[name] = p11;
          }
        });
        ['12A1', '12A2', '12A3', '12A4', '12A5'].forEach(name => {
          const cid = 'c_' + name;
          if (!initial[cid] && !initial[name]) {
            const p12 = createDefaultGrade12Preset();
            initial[cid] = p12;
            initial[name] = p12;
          } else {
            // Chuẩn hóa môn Công nghệ cho các lớp 12A1..12A5 về 0 tiết nếu chưa từng sửa thủ công
            const targetObj = initial[cid] || initial[name];
            if (targetObj) {
              if (targetObj['CNCN'] && !targetObj['CNCN'].isRemoved && targetObj['CNCN'].mainPeriods === 1) {
                targetObj['CNCN'] = { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true };
              }
              if (targetObj['CNNN'] && !targetObj['CNNN'].isRemoved && targetObj['CNNN'].mainPeriods === 1) {
                targetObj['CNNN'] = { mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0, isRemoved: true };
              }
            }
          }
        });
        return initial;
      } catch (e) {}
    }
    const fallbackInit: Record<string, any> = {};
    const p11B3 = createDefault11B3Preset();
    fallbackInit['c_11B3'] = p11B3;
    fallbackInit['11B3'] = p11B3;
    ['11A1', '11A2', '11A3', '11A4', '11A5'].forEach(name => {
      const cid = 'c_' + name;
      const p11 = createDefaultGrade11Preset();
      fallbackInit[cid] = p11;
      fallbackInit[name] = p11;
    });
    ['12A1', '12A2', '12A3', '12A4', '12A5'].forEach(name => {
      const cid = 'c_' + name;
      const p12 = createDefaultGrade12Preset();
      fallbackInit[cid] = p12;
      fallbackInit[name] = p12;
    });
    return fallbackInit;
  });

  useEffect(() => {
    (window as any).DATA_TIET_THEO_LOP = classSubjectPeriods;
  }, [classSubjectPeriods]);

  // Bộ đệm tạm thời (Staging / Draft state) cho phân hệ "Khai báo số tiết theo lớp"
  const [draftHoursMap, setDraftHoursMap] = useState<Record<string, Record<string, any>>>(() => classSubjectPeriods);
  const [isPeriodsDirty, setIsPeriodsDirty] = useState<boolean>(false);

  // Tự động đồng bộ draft state khi classSubjectPeriods thay đổi từ nguồn chính thức (và chưa có thay đổi nháp)
  useEffect(() => {
    if (!isPeriodsDirty) {
      setDraftHoursMap(classSubjectPeriods);
    }
  }, [classSubjectPeriods, isPeriodsDirty]);

  const [classThreeConsecutivePeriods, setClassThreeConsecutivePeriods] = useState<Record<string, Record<string, boolean>>>(() => {
    const saved = localStorage.getItem('edu_class_three_consecutive_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(cId => {
          if (parsed[cId]?.['CN (Công nghiệp)'] !== undefined) {
            if (parsed[cId]['CNCN'] === undefined) {
              parsed[cId]['CNCN'] = parsed[cId]['CN (Công nghiệp)'];
            }
            delete parsed[cId]['CN (Công nghiệp)'];
          }
        });
        return parsed;
      } catch (e) {}
    }
    return {};
  });

  const [allowThreeConsecutivePeriods, setAllowThreeConsecutivePeriods] = useState<boolean>(false);
  const [expandedGrades, setExpandedGrades] = useState<Record<string, boolean>>({
    '10': true,
    '11': false,
    '12': false
  });
  const [selectedTreeClassId, setSelectedTreeClassId] = useState<string>('c_10A1');

  // Load and save class shifts state synced with TimetableTab
  const classShiftsStorageKey = `edu_class_shifts_${currentTermKey}`;
  const [classShifts, setClassShifts] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(classShiftsStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(classShiftsStorageKey);
      if (saved) {
        setClassShifts(JSON.parse(saved));
      } else {
        setClassShifts({});
      }
    } catch (e) {
      setClassShifts({});
    }
  }, [currentTermKey, classShiftsStorageKey]);

  useEffect(() => {
    localStorage.setItem(classShiftsStorageKey, JSON.stringify(classShifts));
  }, [classShifts, classShiftsStorageKey]);

  useEffect(() => {
    localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(classSubjectPeriods));
  }, [classSubjectPeriods]);

  useEffect(() => {
    localStorage.setItem('edu_class_three_consecutive_v2', JSON.stringify(classThreeConsecutivePeriods));
  }, [classThreeConsecutivePeriods]);

  const [isPullingCloud, setIsPullingCloud] = useState(false);
  const [isSavingAssignmentsCloud, setIsSavingAssignmentsCloud] = useState(false);

  // 3. TỰ ĐỘNG TẢI DỮ LIỆU KHI KHỞI ĐỘNG TRÊN THIẾT BỊ MỚI (Fetch/Pull on Mount)
  useEffect(() => {
    let isMounted = true;

    async function autoFetchFromCloudOnMount() {
      try {
        const res = await pullSchoolDataFromCloud(false);
        if (res.success && res.data && isMounted) {
          const cloudData = res.data;
          console.log('[Cloud Sync] Khởi tạo dữ liệu thành công', res.fromCache ? '(từ bộ nhớ đệm)' : '(từ Cloud Firestore)');

          if (cloudData.teachers && Array.isArray(cloudData.teachers) && cloudData.teachers.length > 0) {
            setTeachers(cloudData.teachers);
            try { localStorage.setItem('edu_teachers', JSON.stringify(cloudData.teachers)); } catch {}
          }
          if (cloudData.classes && Array.isArray(cloudData.classes) && cloudData.classes.length > 0) {
            setClasses(cloudData.classes);
            try { localStorage.setItem('edu_classes_v3', JSON.stringify(cloudData.classes)); } catch {}
          }
          if (cloudData.subjects && Array.isArray(cloudData.subjects) && cloudData.subjects.length > 0) {
            setSubjectsConfig(cloudData.subjects);
            try { localStorage.setItem('edu_subjects_config', JSON.stringify(cloudData.subjects)); } catch {}
          }
          if (cloudData.assignments && typeof cloudData.assignments === 'object') {
            const cloudAssign = cloudData.assignments;
            const cloudSubCount = Object.values(cloudAssign.subjectAssignments || {}).reduce(
              (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
            );

            // Kiểm tra phân công hiện có ở localStorage / State
            let localAssignments: any = null;
            try {
              const saved = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
              if (saved) {
                const p = JSON.parse(saved);
                localAssignments = p;
              }
            } catch {}

            const localSubCount = Object.values(localAssignments?.subjectAssignments || {}).reduce(
              (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
            );

            if (cloudSubCount > 0) {
              setAssignments(cloudAssign);
              try { 
                localStorage.setItem('edu_assignments_v3', JSON.stringify(cloudAssign));
                localStorage.setItem('edu_assignments', JSON.stringify(cloudAssign));
                localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(cloudAssign));
                localStorage.setItem(`edu_term_assignments_${TARGET_TERM_KEY}`, JSON.stringify(cloudAssign));
              } catch {}
            } else if (localSubCount > 0) {
              // Cloud document có subjectAssignments bị trống, nhưng thiết bị này ĐÃ CÓ phân công đầy đủ!
              // Bảo toàn phân công bộ môn của máy và tự động đồng bộ lên Cloud để vá document!
              console.log(`[Cloud Sync] Bảo toàn ${localSubCount} phân công từ máy và tự động cập nhật lên Firestore!`);
              const merged = {
                homeroomAssignments: cloudAssign.homeroomAssignments && Object.keys(cloudAssign.homeroomAssignments).length > 0
                  ? cloudAssign.homeroomAssignments
                  : (localAssignments.homeroomAssignments || DEFAULT_HOMEROOM_ASSIGNMENTS),
                subjectAssignments: localAssignments.subjectAssignments
              };
              setAssignments(merged);
              try { 
                localStorage.setItem('edu_assignments_v3', JSON.stringify(merged));
                localStorage.setItem('edu_assignments', JSON.stringify(merged));
                localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(merged));
                localStorage.setItem(`edu_term_assignments_${TARGET_TERM_KEY}`, JSON.stringify(merged));
              } catch {}

              pushSchoolDataToCloud({
                teachers: cloudData.teachers || teachers,
                classes: cloudData.classes || classes,
                subjects: cloudData.subjects || subjectsConfig,
                assignments: merged,
                schedules: cloudData.schedules,
                schoolInfo: cloudData.schoolInfo,
                academicYear: currentAcademicYear,
                semester: currentSemester
              }).catch(err => console.warn('[Cloud Sync] Auto-heal error:', err));
            } else {
              // Nếu cả 2 đều trống: Tôn trọng trạng thái hiện tại (nếu người dùng đã xóa)
              const hasExplicitState = localStorage.getItem('edu_assignments_v3') !== null || cloudData.assignments !== undefined;
              if (hasExplicitState) {
                setAssignments(cloudAssign || { homeroomAssignments: {}, subjectAssignments: {} });
              } else {
                // Chỉ chạy solver khởi tạo khi là phiên làm việc lần đầu tiên tuyệt đối
                const tList = cloudData.teachers && cloudData.teachers.length > 0 ? cloudData.teachers : DEFAULT_TEACHERS;
                const cList = cloudData.classes && cloudData.classes.length > 0 ? cloudData.classes : DEFAULT_CLASSES;
                const subjectReqs = cList.map((c: any) => ({
                  classId: c.id,
                  className: c.name,
                  grade: c.grade,
                  subjects: SUBJECTS.map(s => ({ name: s.id, periods: getSubjectPeriod(s.id, c.grade, c.id) }))
                }));
                const solved = solveAssignments(tList, cList, subjectReqs, cloudAssign, 'teaching_only');
                if (solved && solved.subjectAssignments && Object.keys(solved.subjectAssignments).length > 0) {
                  const fullAssign = {
                    homeroomAssignments: cloudAssign.homeroomAssignments && Object.keys(cloudAssign.homeroomAssignments).length > 0
                      ? cloudAssign.homeroomAssignments
                      : DEFAULT_HOMEROOM_ASSIGNMENTS,
                    subjectAssignments: solved.subjectAssignments
                  };
                  setAssignments(fullAssign);
                  try {
                    localStorage.setItem('edu_assignments_v3', JSON.stringify(fullAssign));
                    localStorage.setItem('edu_assignments', JSON.stringify(fullAssign));
                    localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(fullAssign));
                  } catch {}

                pushSchoolDataToCloud({
                  teachers: tList,
                  classes: cList,
                  subjects: cloudData.subjects || subjectsConfig,
                  assignments: fullAssign,
                  schedules: cloudData.schedules || null,
                  schoolInfo: cloudData.schoolInfo || schoolInfo,
                  academicYear: currentAcademicYear,
                  semester: currentSemester
                }).catch(err => console.warn('[Cloud Sync] Auto-heal push error:', err));
              }
            }
          }
          }
          if (cloudData.schedules) {
            try {
              localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(cloudData.schedules));
              localStorage.setItem('edu_timetable_active', JSON.stringify(cloudData.schedules));
            } catch {}
          }
          if (cloudData.classSubjectPeriods) {
            setClassSubjectPeriods(cloudData.classSubjectPeriods);
            try { localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(cloudData.classSubjectPeriods)); } catch {}
          }
          if (cloudData.classShifts) {
            setClassShifts(cloudData.classShifts);
            try { localStorage.setItem(`edu_class_shifts_${currentTermKey}`, JSON.stringify(cloudData.classShifts)); } catch {}
          }
          if (cloudData.schoolInfo) {
            setSchoolInfo(cloudData.schoolInfo);
            try { localStorage.setItem('edu_school_info_v1', JSON.stringify(cloudData.schoolInfo)); } catch {}
          }

          const updatedTime = cloudData.lastUpdatedText || new Date().toLocaleString('vi-VN');
          try { localStorage.setItem('edu_last_cloud_synced_at', updatedTime); } catch {}
        } else if (!res.data && isMounted) {
          // Document chưa có trên Cloud -> Tự động khởi tạo dữ liệu chuẩn 101 GV, 44 Lớp kèm phân công bộ môn đầy đủ
          console.log('[Cloud Sync] Khởi tạo dữ liệu gốc lên Cloud Firestore...');
          const initialSchedule = (() => {
            try {
              const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
              return s ? JSON.parse(s) : null;
            } catch { return null; }
          })();

          const subjectReqs = DEFAULT_CLASSES.map((c: any) => ({
            classId: c.id,
            className: c.name,
            grade: c.grade,
            subjects: DEFAULT_SUBJECTS_CONFIG.map(s => ({ name: s.id, periods: s.grade10Periods }))
          }));
          const solvedInit = solveAssignments(DEFAULT_TEACHERS, DEFAULT_CLASSES, subjectReqs, { homeroomAssignments: DEFAULT_HOMEROOM_ASSIGNMENTS, subjectAssignments: {} }, 'all');
          const initialAssignments = {
            homeroomAssignments: solvedInit.homeroomAssignments || DEFAULT_HOMEROOM_ASSIGNMENTS,
            subjectAssignments: solvedInit.subjectAssignments || {}
          };

          await pushSchoolDataToCloud({
            teachers: DEFAULT_TEACHERS,
            classes: DEFAULT_CLASSES,
            subjects: DEFAULT_SUBJECTS_CONFIG,
            assignments: initialAssignments,
            schedules: initialSchedule,
            academicYear: currentAcademicYear,
            semester: currentSemester
          });
        }
      } catch (err) {
        console.warn('[Cloud Sync] Lỗi tự động tải dữ liệu:', err);
      }
    }

    autoFetchFromCloudOnMount();

    // Lắng nghe thay đổi thời gian thực qua Firestore onSnapshot
    const unsub = subscribeToSchoolDoc((cloudData) => {
      if (!isMounted || !cloudData) return;
      if (cloudData.teachers && Array.isArray(cloudData.teachers) && cloudData.teachers.length > 0) {
        setTeachers(cloudData.teachers);
        try { localStorage.setItem('edu_teachers', JSON.stringify(cloudData.teachers)); } catch {}
      }
      if (cloudData.classes && Array.isArray(cloudData.classes) && cloudData.classes.length > 0) {
        setClasses(cloudData.classes);
        try { localStorage.setItem('edu_classes_v3', JSON.stringify(cloudData.classes)); } catch {}
      }
      if (cloudData.subjects && Array.isArray(cloudData.subjects) && cloudData.subjects.length > 0) {
        setSubjectsConfig(cloudData.subjects);
        try { localStorage.setItem('edu_subjects_config', JSON.stringify(cloudData.subjects)); } catch {}
      }
      if (cloudData.assignments && typeof cloudData.assignments === 'object') {
        const cloudAssign = cloudData.assignments;
        const subCount = Object.values(cloudAssign.subjectAssignments || {}).reduce(
          (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
        );
        if (subCount > 0) {
          setAssignments(cloudAssign);
          try { 
            localStorage.setItem('edu_assignments_v3', JSON.stringify(cloudAssign));
            localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(cloudAssign));
          } catch {}
        }
      }
      if (cloudData.schedules) {
        try {
          localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(cloudData.schedules));
          localStorage.setItem('edu_timetable_active', JSON.stringify(cloudData.schedules));
        } catch {}
      }
      if (cloudData.classSubjectPeriods && typeof cloudData.classSubjectPeriods === 'object') {
        setClassSubjectPeriods(prev => {
          const merged = { ...cloudData.classSubjectPeriods, ...prev };
          try { localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
      if (cloudData.classShifts) {
        setClassShifts(cloudData.classShifts);
        try { localStorage.setItem(`edu_class_shifts_${currentTermKey}`, JSON.stringify(cloudData.classShifts)); } catch {}
      }
    });

    // Lắng nghe sự kiện kéo dữ liệu thành công từ authContext
    const handleCustomPull = (e: any) => {
      if (!isMounted || !e.detail) return;
      const cloudData = e.detail;
      if (cloudData.teachers && Array.isArray(cloudData.teachers)) setTeachers(cloudData.teachers);
      if (cloudData.classes && Array.isArray(cloudData.classes)) setClasses(cloudData.classes);
      if (cloudData.subjects && Array.isArray(cloudData.subjects)) setSubjectsConfig(cloudData.subjects);
      if (cloudData.assignments) {
        const subCount = Object.values(cloudData.assignments.subjectAssignments || {}).reduce(
          (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
        );
        if (subCount > 0) {
          setAssignments(cloudData.assignments);
        }
      }
      if (cloudData.classSubjectPeriods) setClassSubjectPeriods(cloudData.classSubjectPeriods);
      if (cloudData.classShifts) setClassShifts(cloudData.classShifts);
    };
    window.addEventListener('cloud-data-pulled', handleCustomPull);

    return () => {
      isMounted = false;
      unsub();
      window.removeEventListener('cloud-data-pulled', handleCustomPull);
    };
  }, [currentTermKey]);

  // 4. HÀM CƯỠNG BỨC TẢI DỮ LIỆU TỪ CLOUD (Pull on Demand)
  const handleForcePullFromCloud = async () => {
    setIsPullingCloud(true);
    try {
      const res = await pullSchoolDataFromCloud();
      if (res.success && res.data) {
        const cloudData = res.data;
        if (cloudData.teachers && Array.isArray(cloudData.teachers)) setTeachers(cloudData.teachers);
        if (cloudData.classes && Array.isArray(cloudData.classes)) setClasses(cloudData.classes);
        if (cloudData.subjects && Array.isArray(cloudData.subjects)) setSubjectsConfig(cloudData.subjects);
        if (cloudData.assignments) {
          const subCount = Object.values(cloudData.assignments.subjectAssignments || {}).reduce(
            (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
          );
          if (subCount > 0) {
            setAssignments(cloudData.assignments);
            try {
              localStorage.setItem('edu_assignments_v3', JSON.stringify(cloudData.assignments));
              localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(cloudData.assignments));
            } catch {}
          } else {
            // Cloud có assignments nhưng subjectAssignments bị trống
            let localAssignments: any = null;
            try {
              const saved = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
              if (saved) localAssignments = JSON.parse(saved);
            } catch {}
            const localSubCount = Object.values(localAssignments?.subjectAssignments || {}).reduce(
              (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
            );

            if (localSubCount > 0) {
              const merged = {
                homeroomAssignments: cloudData.assignments.homeroomAssignments && Object.keys(cloudData.assignments.homeroomAssignments).length > 0
                  ? cloudData.assignments.homeroomAssignments
                  : (localAssignments.homeroomAssignments || DEFAULT_HOMEROOM_ASSIGNMENTS),
                subjectAssignments: localAssignments.subjectAssignments
              };
              setAssignments(merged);
              try {
                localStorage.setItem('edu_assignments_v3', JSON.stringify(merged));
                localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(merged));
              } catch {}
              pushSchoolDataToCloud({
                teachers: cloudData.teachers || teachers,
                classes: cloudData.classes || classes,
                subjects: cloudData.subjects || subjectsConfig,
                assignments: merged,
                schedules: cloudData.schedules || null,
                schoolInfo: cloudData.schoolInfo || schoolInfo,
                academicYear: currentAcademicYear,
                semester: currentSemester
              }).catch(e => console.warn('[Force Pull] Auto-heal push error:', e));
            } else {
              // Cả hai đều trống: Tôn trọng trạng thái hiện tại (nếu người dùng đã xóa)
              const hasExplicitState = localStorage.getItem('edu_assignments_v3') !== null || cloudData.assignments !== undefined;
              if (hasExplicitState) {
                setAssignments(cloudData.assignments || { homeroomAssignments: {}, subjectAssignments: {} });
              } else {
                const tList = cloudData.teachers && cloudData.teachers.length > 0 ? cloudData.teachers : teachers;
                const cList = cloudData.classes && cloudData.classes.length > 0 ? cloudData.classes : classes;
                const subjectReqs = cList.map((c: any) => ({
                  classId: c.id,
                  className: c.name,
                  grade: c.grade,
                  subjects: SUBJECTS.map(s => ({ name: s.id, periods: getSubjectPeriod(s.id, c.grade, c.id) }))
                }));
                const solved = solveAssignments(tList, cList, subjectReqs, cloudData.assignments, 'teaching_only');
                if (solved && solved.subjectAssignments && Object.keys(solved.subjectAssignments).length > 0) {
                  const fullAssign = {
                    homeroomAssignments: cloudData.assignments.homeroomAssignments && Object.keys(cloudData.assignments.homeroomAssignments).length > 0
                      ? cloudData.assignments.homeroomAssignments
                      : DEFAULT_HOMEROOM_ASSIGNMENTS,
                    subjectAssignments: solved.subjectAssignments
                  };
                  setAssignments(fullAssign);
                  try {
                    localStorage.setItem('edu_assignments_v3', JSON.stringify(fullAssign));
                    localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(fullAssign));
                  } catch {}
                  pushSchoolDataToCloud({
                    teachers: tList,
                    classes: cList,
                    subjects: cloudData.subjects || subjectsConfig,
                    assignments: fullAssign,
                    schedules: cloudData.schedules || null,
                    schoolInfo: cloudData.schoolInfo || schoolInfo,
                    academicYear: currentAcademicYear,
                    semester: currentSemester
                  }).catch(e => console.warn('[Force Pull] Solver push error:', e));
                }
              }
            }
          }
        }
        if (cloudData.classSubjectPeriods) setClassSubjectPeriods(cloudData.classSubjectPeriods);
        if (cloudData.classShifts) setClassShifts(cloudData.classShifts);
        showTermNotification(`✅ Đã nạp thành công dữ liệu mới nhất từ Cloud Firestore (101 GV, 44 Lớp, TKB)!`);
      } else {
        showTermNotification(`⚠️ ${res.message}`);
      }
    } catch (err: any) {
      showTermNotification(`⚠️ Lỗi kéo dữ liệu: ${err.message || 'Không thể kết nối'}`);
    } finally {
      setIsPullingCloud(false);
    }
  };

  // 2. HÀM GHI ĐẦY ĐỦ DỮ LIỆU LÊN CLOUD (Save/Push)
  const handlePushAllToCloud = async () => {
    try {
      const currentTimetable = (() => {
        try {
          const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
          return s ? JSON.parse(s) : null;
        } catch { return null; }
      })();

      const res = await pushSchoolDataToCloud({
        teachers,
        classes,
        subjects: subjectsConfig,
        departments,
        assignments,
        schedules: currentTimetable,
        classSubjectPeriods,
        classShifts,
        schoolInfo,
        academicYear: currentAcademicYear,
        semester: currentSemester
      });

      if (res.success) {
        showTermNotification(`✅ ${res.message}`);
      } else {
        showTermNotification(`❌ ${res.message}`);
      }
      return res;
    } catch (err: any) {
      showTermNotification('❌ Lỗi đẩy dữ liệu lên Cloud Firestore.');
    }
  };

  // NÚT 1: LƯU TRỰC TIẾP PHÂN CÔNG (HOMEROOM + SUBJECTS) LÊN CLOUD FIRESTORE
  const handleSaveAssignmentsToCloud = async () => {
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để lưu phân công lên Cloud!');
      openLoginModal();
      return;
    }

    setIsSavingAssignmentsCloud(true);
    try {
      const cleanHomeroom = { ...(assignments.homeroomAssignments || {}) };
      let cleanSubject = { ...(assignments.subjectAssignments || {}) };

      // Nếu rỗng, kiểm tra các khóa lưu trữ dự phòng
      if (Object.keys(cleanSubject).length === 0) {
        try {
          const a3 = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments') || localStorage.getItem(`edu_term_assignments_${currentTermKey}`);
          if (a3) {
            const p = JSON.parse(a3);
            if (p.subjectAssignments && Object.keys(p.subjectAssignments).length > 0) {
              cleanSubject = p.subjectAssignments;
            }
          }
        } catch {}
      }

      if (Object.keys(cleanSubject).length === 0) {
        const subjectReqs = classes.map((c: any) => ({
          classId: c.id,
          className: c.name,
          grade: c.grade,
          subjects: SUBJECTS.map(s => ({ name: s.id, periods: getSubjectPeriod(s.id, c.grade, c.id) }))
        }));
        const solved = solveAssignments(teachers, classes, subjectReqs, { homeroomAssignments: cleanHomeroom, subjectAssignments: {} }, 'all');
        if (solved && solved.subjectAssignments && Object.keys(solved.subjectAssignments).length > 0) {
          cleanSubject = solved.subjectAssignments;
          setAssignments({
            homeroomAssignments: cleanHomeroom,
            subjectAssignments: cleanSubject
          });
        }
      }

      const fullAssignPayload = {
        homeroomAssignments: cleanHomeroom,
        subjectAssignments: cleanSubject
      };

      const res = await pushSchoolDataToCloud({
        teachers,
        classes,
        subjects: subjectsConfig,
        departments,
        assignments: fullAssignPayload,
        classSubjectPeriods,
        classShifts,
        schoolInfo,
        academicYear: currentAcademicYear,
        semester: currentSemester
      });

      const subCount = Object.values(cleanSubject).reduce(
        (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
      );
      const hrCount = Object.keys(cleanHomeroom).length;

      if (res.success) {
        showTermNotification(`☁️ Đã lưu thành công ${subCount} phân công môn học & ${hrCount} GVCN lên Cloud document "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"!`);
      } else {
        showTermNotification(`⚠️ ${res.message}`);
      }
    } catch (err: any) {
      showTermNotification(`⚠️ Lỗi lưu phân công: ${err.message || 'Không thể kết nối'}`);
    } finally {
      setIsSavingAssignmentsCloud(false);
    }
  };

  // NÚT 2: XUẤT FILE SAO LƯU (.JSON) AN TOÀN TUYỆT ĐỐI VỀ MÁY TÍNH
  const handleExportBackupJson = () => {
    try {
      const currentTimetable = (() => {
        try {
          const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
          return s ? JSON.parse(s) : null;
        } catch { return null; }
      })();

      const subCount = Object.values(assignments.subjectAssignments || {}).reduce(
        (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
      );
      const hrCount = Object.keys(assignments.homeroomAssignments || {}).length;

      const backupData = {
        app: 'EduSchedule AI',
        schoolName: schoolInfo.schoolName || DEFAULT_SCHOOL_NAME,
        departmentName: schoolInfo.departmentName || DEFAULT_DEPARTMENT_NAME,
        schoolId: TARGET_SCHOOL_ID,
        academicYear: currentAcademicYear,
        semester: currentSemester,
        termKey: currentTermKey,
        targetFirestoreDoc: `schools/${TARGET_SCHOOL_ID}/terms/${TARGET_TERM_KEY}`,
        exportedAt: new Date().toISOString(),
        exportedTimeText: new Date().toLocaleString('vi-VN'),
        stats: {
          totalTeachers: teachers.length,
          totalClasses: classes.length,
          totalSubjects: subjectsConfig.length,
          homeroomAssigned: hrCount,
          subjectAssigned: subCount
        },
        teachers,
        classes,
        subjects: subjectsConfig,
        assignments: {
          homeroomAssignments: assignments.homeroomAssignments || {},
          subjectAssignments: assignments.subjectAssignments || {}
        },
        timetableData: currentTimetable,
        schedules: currentTimetable,
        classSubjectPeriods,
        classShifts,
        schoolInfo
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      const cleanYear = currentAcademicYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
      const cleanSem = currentSemester.includes('II') || currentSemester.includes('2') ? 'HK2' : 'HK1';
      downloadAnchor.setAttribute('download', `SaoLuu_TKB_THPT_NguyenBinhKhiem_${cleanYear}_${cleanSem}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      showTermNotification(`💾 Đã xuất file sao lưu JSON an toàn tuyệt đối (${teachers.length} GV, ${classes.length} Lớp, ${subCount} phân công) về máy tính thành công!`);
    } catch (err: any) {
      alert('Lỗi xuất file sao lưu JSON: ' + (err.message || err));
    }
  };

  const parseSubjectSessionConfig = (val: any, defaultPeriod = 2, subjectId?: string, classShift?: string) => {
    if (typeof val === 'object' && val !== null) {
      const normSub = subjectId ? normalizeSubjectName(subjectId) : '';
      const isTraiBuoiByDefault = normSub === 'GDQPAN' || normSub === 'GDĐP' || normSub === 'GDTC';
      let mP = val.mainPeriods ?? 0;
      let oP = val.oppPeriods ?? 0;
      // Khối liên môn GDQPAN + GDĐP và môn GDTC bắt buộc học đúng buổi trái buổi:
      if (isTraiBuoiByDefault && mP > 0 && oP === 0) {
        oP = mP;
        mP = 0;
      }
      return {
        mainPeriods: mP,
        mainMinPairs: val.mainMinPairs ?? 0,
        oppPeriods: oP,
        oppMinPairs: val.oppMinPairs ?? (normSub === 'GDTC' && oP >= 2 ? 1 : 0),
        allowRemainingSameSession: val.allowRemainingSameSession ?? false,
        sameSessionRule: val.sameSessionRule ?? '',
        maxPeriodsPerSession: (val.maxPeriodsPerSession === undefined || val.maxPeriodsPerSession === '' || val.maxPeriodsPerSession === null) 
          ? null 
          : (isNaN(Number(val.maxPeriodsPerSession)) ? null : Number(val.maxPeriodsPerSession)),
        alternateDays: val.alternateDays ?? false,
        singleSessionOnly: val.singleSessionOnly ?? false,
        isRemoved: !!val.isRemoved
      };
    }
    const periodsNum = typeof val === 'number' ? val : defaultPeriod;
    const normSub = subjectId ? normalizeSubjectName(subjectId) : '';
    // Môn GDQPAN, GDĐP và GDTC luôn là môn TRÁI BUỔI (OFF-SHIFT):
    // Khối 10 (chính chiều): học Sáng trái buổi -> oppPeriods = 1, mainPeriods = 0
    // Khối 11, 12 (chính sáng): học Chiều trái buổi -> oppPeriods = 1, mainPeriods = 0
    const isTraiBuoiByDefault = normSub === 'GDQPAN' || normSub === 'GDĐP' || normSub === 'GDTC';

    return {
      mainPeriods: isTraiBuoiByDefault ? 0 : periodsNum,
      mainMinPairs: 0,
      oppPeriods: isTraiBuoiByDefault ? periodsNum : 0,
      oppMinPairs: 0,
      allowRemainingSameSession: false,
      sameSessionRule: '',
      maxPeriodsPerSession: null,
      alternateDays: false,
      singleSessionOnly: false,
      isRemoved: false
    };
  };

  // Helper tính toán toàn diện, chính xác 100% định mức số tiết đã khai báo của từng lớp (DATA_TIET_THEO_LOP[classId])
  const getClassDeclaredSummary = useCallback((classId: string, classGrade?: '10' | '11' | '12') => {
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetClass = classes.find(c => c.id === classId || c.name === classId || c.id === prefixedId || c.name === cleanId);
    const grade = targetClass?.grade || classGrade || '10';
    const shift = classShifts[classId] || classShifts[cleanId] || classShifts[prefixedId] || (targetClass?.name ? classShifts[targetClass.name] : undefined) || 'morning_main';

    const classObj = classSubjectPeriods[classId] ||
      classSubjectPeriods[cleanId] ||
      classSubjectPeriods[prefixedId] ||
      (targetClass?.name ? classSubjectPeriods[targetClass.name] : undefined);

    // Danh sách 16 môn học chuẩn (đã khử trùng lặp)
    const canonicalSubs: { id: string; name: string; defaultPeriods: number }[] = [];
    const seen = new Set<string>();
    subjectsConfig.forEach(s => {
      const norm = normalizeSubjectName(s.id);
      if (!seen.has(norm)) {
        seen.add(norm);
        const defP = grade === '10' ? s.grade10Periods : (grade === '11' ? s.grade11Periods : s.grade12Periods);
        canonicalSubs.push({
          id: s.id,
          name: s.name || s.id,
          defaultPeriods: defP || 0
        });
      }
    });

    const hasCustomConfig = !!(classObj && Object.keys(classObj).length > 0);

    let mainTotal = 0;
    let oppTotal = 0;
    const subjectsDetail: {
      id: string;
      name: string;
      normName: string;
      mainPeriods: number;
      oppPeriods: number;
      totalPeriods: number;
      isRemoved: boolean;
    }[] = [];
    const subjectPeriodsMap: Record<string, number> = {};

    canonicalSubs.forEach(sub => {
      const norm = normalizeSubjectName(sub.id);
      let val = classObj ? (classObj[norm] !== undefined ? classObj[norm] : classObj[sub.id]) : undefined;
      if (val === undefined && classObj) {
        for (const [k, v] of Object.entries(classObj)) {
          if (normalizeSubjectName(k) === norm) {
            val = v;
            break;
          }
        }
      }

      let main = 0;
      let opp = 0;
      let isRemoved = false;

      if (val !== undefined) {
        if (typeof val === 'object' && val !== null) {
          isRemoved = !!val.isRemoved;
          main = isRemoved ? 0 : Math.max(0, Number(val.mainPeriods) || 0);
          opp = isRemoved ? 0 : Math.max(0, Number(val.oppPeriods) || 0);
        } else if (typeof val === 'number') {
          main = Math.max(0, Number(val) || 0);
          opp = 0;
          isRemoved = false;
        } else {
          isRemoved = true;
        }
      } else {
        if (hasCustomConfig) {
          // Lớp đã có cấu hình tùy chỉnh riêng nhưng môn này không có trong khai báo -> Môn bị loại khỏi tổ hợp (0 tiết)
          main = 0;
          opp = 0;
          isRemoved = true;
        } else {
          // Khối 12 hoặc 11 mặc định CN (Công nghệ) không nằm trong tổ hợp mặc định -> 0 tiết
          if ((grade === '12' || grade === '11') && (norm === 'CNCN' || norm === 'CNNN')) {
            main = 0;
            opp = 0;
            isRemoved = true;
          } else {
            // Lớp chưa từng tùy chỉnh -> Dùng cấu hình phân bổ mặc định của khối
            const cfg = parseSubjectSessionConfig(undefined, sub.defaultPeriods, sub.id, shift);
            main = cfg.mainPeriods;
            opp = cfg.oppPeriods;
            isRemoved = (main === 0 && opp === 0);
          }
        }
      }

      const total = isRemoved ? 0 : (main + opp);
      if (!isRemoved) {
        mainTotal += main;
        oppTotal += opp;
      }

      subjectsDetail.push({
        id: sub.id,
        name: sub.name,
        normName: norm,
        mainPeriods: main,
        oppPeriods: opp,
        totalPeriods: total,
        isRemoved
      });

      subjectPeriodsMap[sub.id] = total;
      subjectPeriodsMap[norm] = total;
    });

    return {
      classId: targetClass?.id || classId,
      className: targetClass?.name || cleanId,
      grade,
      mainTotal,
      oppTotal,
      totalPeriods: mainTotal + oppTotal,
      subjects: subjectsDetail,
      subjectPeriodsMap
    };
  }, [classes, classShifts, classSubjectPeriods, subjectsConfig]);

  // Bộ nhớ đệm tóm tắt số tiết của 44 lớp học (O(1) lookup thay vì tính lại hàng nghìn lần)
  const classDeclaredSummaryMap = useMemo(() => {
    const map: Record<string, ReturnType<typeof getClassDeclaredSummary>> = {};
    classes.forEach(c => {
      const summ = getClassDeclaredSummary(c.id, c.grade);
      map[c.id] = summ;
      const cleanId = c.id.replace(/^c_/, '');
      map[cleanId] = summ;
      map['c_' + cleanId] = summ;
      if (c.name) map[c.name] = summ;
    });
    return map;
  }, [classes, classSubjectPeriods, classShifts, subjectsConfig, getClassDeclaredSummary]);

  const getSubjectPeriod = useCallback((subject: string, grade: '10' | '11' | '12', classId?: string): number => {
    const normSubject = normalizeSubjectName(subject);
    if (classId) {
      const summary = classDeclaredSummaryMap[classId] || getClassDeclaredSummary(classId, grade);
      const periods = summary?.subjectPeriodsMap?.[normSubject] ?? summary?.subjectPeriodsMap?.[subject];
      if (periods !== undefined) return periods;
    }
    const config = subjectsConfig.find(s => normalizeSubjectName(s.id) === normSubject || s.id === subject);
    if (!config) {
      if (normSubject === 'GDQPAN') return 1;
      return 2;
    }
    if (grade === '10') return config.grade10Periods;
    if (grade === '11') return config.grade11Periods;
    return config.grade12Periods;
  }, [classDeclaredSummaryMap, getClassDeclaredSummary, subjectsConfig]);

  // lessonHoursMap: Bản đồ định mức số tiết chuẩn của từng lớp từ bảng "Khai báo số tiết" (classId -> { [subjectId]: number })
  // Đảm bảo tính toán động totalRequired và totalAssigned cho từng lớp, tuyệt đối không hardcode 29 tiết
  const lessonHoursMap = useMemo<Record<string, Record<string, number>>>(() => {
    const map: Record<string, Record<string, number>> = {};
    classes.forEach(cls => {
      const hoursObj: Record<string, number> = {};
      SUBJECTS.forEach(sub => {
        hoursObj[sub.id] = getSubjectPeriod(sub.id, cls.grade, cls.id);
      });
      map[cls.id] = hoursObj;
      const cleanId = cls.id.replace(/^c_/, '');
      map[cleanId] = hoursObj;
      if (cls.name) map[cls.name] = hoursObj;
    });
    return map;
  }, [classes, SUBJECTS, getSubjectPeriod]);

  // Bộ định thời tự động đồng bộ Cloud Firestore (Debounced Auto-save)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleAutoSave = useCallback((newPeriods?: Record<string, any>, newAssignments?: any) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        if (TARGET_TERM_DOC_REF && SCHOOL_DOC_REF) {
          const payload: Record<string, any> = {
            updatedAt: new Date().toISOString()
          };
          if (newPeriods) {
            payload.classSubjectPeriods = newPeriods;
          }
          if (newAssignments) {
            payload.assignments = newAssignments;
          }
          const cleanedData = removeUndefinedFields(payload);
          await Promise.all([
            setDoc(TARGET_TERM_DOC_REF, cleanedData, { merge: true }),
            ...(newPeriods ? [setDoc(SCHOOL_DOC_REF, { classSubjectPeriods: removeUndefinedFields(newPeriods), updatedAt: new Date().toISOString() }, { merge: true })] : [])
          ]);
          invalidateTermCache(currentTermKey);
        }
      } catch (err) {
        console.warn('[AutoSave] Error auto-saving to Firestore:', err);
      }
    }, 700);
  }, [currentTermKey]);

  const handleUpdateClassPeriod = (classId: string, subjectId: string, newPeriods: number) => {
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa số tiết.`);
      return;
    }
    const valid = Math.max(0, Math.min(20, newPeriods));
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetClass = classes.find(c => c.id === classId || c.name === classId || c.id === prefixedId || c.name === cleanId);
    const normSub = normalizeSubjectName(subjectId);

    let nextPeriodsState: any = null;
    setClassSubjectPeriods(prev => {
      const classObj = prev[classId] || prev[cleanId] || prev[prefixedId] || (targetClass ? (prev[targetClass.id] || prev[targetClass.name]) : {}) || {};
      const cur = classObj[subjectId];
      let updatedVal: any = valid;
      if (typeof cur === 'object' && cur !== null) {
        updatedVal = {
          ...cur,
          mainPeriods: valid,
          oppPeriods: 0,
          isRemoved: false
        };
      } else {
        updatedVal = {
          mainPeriods: valid,
          oppPeriods: 0,
          isRemoved: false
        };
      }
      const nextClassObj = {
        ...classObj,
        [subjectId]: updatedVal,
        [normSub]: updatedVal
      };
      const updated = {
        ...prev,
        [classId]: nextClassObj,
        [cleanId]: nextClassObj,
        [prefixedId]: nextClassObj,
        ...(targetClass?.name ? { [targetClass.name]: nextClassObj } : {})
      };
      try {
        localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(updated));
        localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(updated));
        (window as any).DATA_TIET_THEO_LOP = updated;
      } catch {}
      nextPeriodsState = updated;
      return updated;
    });

    // Tự động dọn sạch phân công nếu tiết = 0
    let nextAssignmentsState: any = null;
    if (valid === 0) {
      const keysToCheck = [classId, cleanId, prefixedId, targetClass?.name].filter(Boolean);
      setAssignments(prev => {
        const nextSubjects = { ...prev.subjectAssignments };
        let changed = false;
        keysToCheck.forEach(k => {
          if (nextSubjects[k as string]) {
            const classCopy = { ...nextSubjects[k as string] };
            if (classCopy[subjectId] || classCopy[normSub]) {
              delete classCopy[subjectId];
              delete classCopy[normSub];
              nextSubjects[k as string] = classCopy;
              changed = true;
            }
          }
        });
        if (!changed) return prev;
        const next = { ...prev, subjectAssignments: nextSubjects };
        try {
          localStorage.setItem('edu_assignments_v3', JSON.stringify(next));
          localStorage.setItem('edu_assignments', JSON.stringify(next));
          localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(next));
        } catch {}
        nextAssignmentsState = next;
        return next;
      });
    }

    scheduleAutoSave(nextPeriodsState || undefined, nextAssignmentsState || undefined);
  };

  const handleUpdateSubjectSessionConfig = (classId: string, subjectId: string, field: string, value: any) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa số tiết.`);
      return;
    }
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetClass = classes.find(c => c.id === classId || c.name === classId || c.id === prefixedId || c.name === cleanId);

    const shift = classShifts[classId] || classShifts[cleanId] || (targetClass?.grade === '10' ? 'afternoon_main' : 'morning_main');
    const classPeriods = draftHoursMap[classId] || draftHoursMap[cleanId] || draftHoursMap[prefixedId] || (targetClass ? (draftHoursMap[targetClass.id] || draftHoursMap[targetClass.name]) : {}) || {};
    const currentVal = classPeriods[subjectId];
    const config = parseSubjectSessionConfig(currentVal, getSubjectPeriod(subjectId, targetClass?.grade || '10', classId), subjectId, shift);
    
    const sanitizedValue = field === 'maxPeriodsPerSession'
      ? ((value === undefined || value === '' || value === null) ? null : (isNaN(Number(value)) ? null : Number(value)))
      : (value === undefined ? null : value);

    const newMain = field === 'mainPeriods' ? (Number(sanitizedValue) || 0) : (Number(config.mainPeriods) || 0);
    const newOpp = field === 'oppPeriods' ? (Number(sanitizedValue) || 0) : (Number(config.oppPeriods) || 0);
    const isRemoved = field === 'isRemoved' ? Boolean(sanitizedValue) : false;

    const updatedConfig = {
      ...config,
      [field]: sanitizedValue,
      mainPeriods: isRemoved ? 0 : Math.max(0, newMain),
      oppPeriods: isRemoved ? 0 : Math.max(0, newOpp),
      maxPeriodsPerSession: field === 'maxPeriodsPerSession' ? sanitizedValue : (config.maxPeriodsPerSession ?? null),
      isRemoved: isRemoved
    };

    const normSub = normalizeSubjectName(subjectId);
    const nextClassPeriods = {
      ...classPeriods,
      [subjectId]: updatedConfig,
      [normSub]: updatedConfig
    };

    const updatedDraft = {
      ...draftHoursMap,
      [classId]: nextClassPeriods,
      [cleanId]: nextClassPeriods,
      [prefixedId]: nextClassPeriods,
      ...(targetClass?.name ? { [targetClass.name]: nextClassPeriods } : {})
    };

    // Staging / Draft state ONLY - Không tự động ghi đè lessonHoursMap, không gửi xuống LocalStorage/Firebase khi chưa bấm Lưu
    setDraftHoursMap(updatedDraft);
    setIsPeriodsDirty(true);
  };

  const handleOpenCopyPeriodsModal = (sourceClassId: string) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    const sourceClass = classes.find(c => c.id === sourceClassId);
    setCopyPeriodsModalSourceClassId(sourceClassId);
    if (sourceClass) {
      // Pre-select other classes in the same grade by default
      const defaultTargets = classes
        .filter(c => c.grade === sourceClass.grade && c.id !== sourceClassId)
        .map(c => c.id);
      setSelectedTargetClassesForCopy(defaultTargets);
    } else {
      setSelectedTargetClassesForCopy([]);
    }
  };

  const handleToggleTargetClassForCopy = (classId: string) => {
    setSelectedTargetClassesForCopy(prev => 
      prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]
    );
  };

  const handleSelectAllTargetsInGrade = (grade: '10' | '11' | '12') => {
    const gradeClassIds = classes
      .filter(c => c.grade === grade && c.id !== copyPeriodsModalSourceClassId)
      .map(c => c.id);
    setSelectedTargetClassesForCopy(prev => {
      const allIncluded = gradeClassIds.every(id => prev.includes(id));
      if (allIncluded) {
        return prev.filter(id => !gradeClassIds.includes(id));
      } else {
        return Array.from(new Set([...prev, ...gradeClassIds]));
      }
    });
  };

  const handleSelectAllTargetsSchool = () => {
    const allOtherClassIds = classes
      .filter(c => c.id !== copyPeriodsModalSourceClassId)
      .map(c => c.id);
    setSelectedTargetClassesForCopy(allOtherClassIds);
  };

  const handleDeselectAllTargets = () => {
    setSelectedTargetClassesForCopy([]);
  };

  const handleExecuteCopyPeriods = () => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    if (!copyPeriodsModalSourceClassId || selectedTargetClassesForCopy.length === 0) return;
    const sourceClass = classes.find(c => c.id === copyPeriodsModalSourceClassId);
    if (!sourceClass) return;

    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
      return;
    }

    // Lấy cấu hình nguồn ưu tiên từ draftHoursMap trước, sau đó là classSubjectPeriods
    const sourcePeriodsObj = draftHoursMap[sourceClass.id] || draftHoursMap[sourceClass.name] || classSubjectPeriods[sourceClass.id] || {};
    const periodsToCopy: Record<string, any> = {};
    const sourceShift = classShifts[sourceClass.id] || (sourceClass.grade === '10' ? 'afternoon_main' : 'morning_main');

    SUBJECTS.forEach(s => {
      let cfg: any;
      if (sourcePeriodsObj[s.id] !== undefined) {
        cfg = typeof sourcePeriodsObj[s.id] === 'object' && sourcePeriodsObj[s.id] !== null
          ? { ...sourcePeriodsObj[s.id] }
          : sourcePeriodsObj[s.id];
      } else {
        const total = getSubjectPeriod(s.id, sourceClass.grade, sourceClass.id);
        cfg = parseSubjectSessionConfig(undefined, total, s.id, sourceShift);
      }
      periodsToCopy[s.id] = cfg;
      const norm = normalizeSubjectName(s.id);
      periodsToCopy[norm] = cfg;
    });

    const consecutiveToCopy: Record<string, boolean> = copyIncludeConsecutive
      ? (classThreeConsecutivePeriods[sourceClass.id] || {})
      : {};

    // 1. Thực hiện deep copy toàn bộ đối tượng cấu hình của lớp nguồn vào draftHoursMap của TẤT CẢ các lớp đích được chọn:
    setDraftHoursMap(prev => {
      const updated = { ...prev };
      selectedTargetClassesForCopy.forEach(cId => {
        const targetCls = classes.find(c => c.id === cId);
        const clean = cId.replace(/^c_/, '');
        const pref = 'c_' + clean;
        const clonedPeriods = JSON.parse(JSON.stringify(periodsToCopy));
        updated[cId] = clonedPeriods;
        updated[clean] = clonedPeriods;
        updated[pref] = clonedPeriods;
        if (targetCls?.name) {
          updated[targetCls.name] = clonedPeriods;
        }
      });
      return updated;
    });

    // 2. Đồng bộ ca học (shift) & 3 tiết liên tục
    if (sourceShift) {
      setClassShifts(prev => {
        const updated = { ...prev };
        selectedTargetClassesForCopy.forEach(cId => {
          updated[cId] = sourceShift;
        });
        return updated;
      });
    }

    if (copyIncludeConsecutive) {
      setClassThreeConsecutivePeriods(prev => {
        const updated = { ...prev };
        selectedTargetClassesForCopy.forEach(cId => {
          updated[cId] = { ...consecutiveToCopy };
        });
        return updated;
      });
    }

    // 3. Đặt cờ isDirty = true để nút "Lưu" sẵn sàng ghi nhận:
    setIsPeriodsDirty(true);
    const count = selectedTargetClassesForCopy.length;
    setCopyPeriodsModalSourceClassId(null);

    showTermNotification(
      `📋 Đã sao chép cấu hình từ lớp ${sourceClass.name} sang ${count} lớp vào bộ đệm. Bấm nút "Lưu" để áp dụng chính thức!`
    );
  };

  const handleCopyPeriodsToGrade = (sourceClassId: string, grade: '10' | '11' | '12') => {
    handleOpenCopyPeriodsModal(sourceClassId);
  };

  const handleResetClassPeriods = (classId: string) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    const cleanId = classId.replace(/^c_/, '');
    const prefId = 'c_' + cleanId;
    const targetCls = classes.find(c => c.id === classId || c.name === classId);
    setDraftHoursMap(prev => {
      const updated = { ...prev };
      delete updated[classId];
      delete updated[cleanId];
      delete updated[prefId];
      if (targetCls?.name) delete updated[targetCls.name];
      return updated;
    });
    setIsPeriodsDirty(true);
    showTermNotification(`🔄 Đã khôi phục số tiết lớp về mặc định (Chưa lưu - Bấm "Lưu" để áp dụng)!`);
  };

  const handleToggleThreeConsecutive = (classId: string, subjectId: string, checked: boolean) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    setClassThreeConsecutivePeriods(prev => ({
      ...prev,
      [classId]: {
        ...(prev[classId] || {}),
        [subjectId]: checked
      }
    }));
  };
  
  // AI Panel
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiChatLoading, setIsAiChatLoading] = useState(false);
  const [isAiOptimizing, setIsAiOptimizing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string>('');
  const [showAutoAssignNotice, setShowAutoAssignNotice] = useState<boolean>(false);
  const [isAutoAssignNoticeExpanded, setIsAutoAssignNoticeExpanded] = useState<boolean>(false);
  // Fullscreen state for Assignment Board
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };
  const isBoardFullscreen = isFullscreen;
  const setIsBoardFullscreen = setIsFullscreen;
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState<boolean>(false);

  // Tự động ẩn thông báo phân công tự động khi người dùng chuyển sang tab/trang khác
  useEffect(() => {
    if (activeTab !== 'board') {
      setShowAutoAssignNotice(false);
      setIsAutoAssignNoticeExpanded(false);
    }
  }, [activeTab]);

  // Modals / Editors state
  const [selectedCell, setSelectedCell] = useState<{ classId: string; subject: string; currentTeacherId: string } | null>(null);
  const [selectedHomeroomCell, setSelectedHomeroomCell] = useState<{ classId: string; currentTeacherId: string } | null>(null);
  const [modalTeacherSearch, setModalTeacherSearch] = useState<string>('');
  const [pendingAssignmentConfirm, setPendingAssignmentConfirm] = useState<{
    teacherId?: string;
    teacherName?: string;
    reasonsText?: string;
    title?: string;
    message?: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  useEffect(() => {
    setModalTeacherSearch('');
    setPendingAssignmentConfirm(null);
  }, [selectedCell, selectedHomeroomCell]);
  
  // CRUD state
  const [isAddingTeacher, setIsAddingTeacher] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [profileExportTeacher, setProfileExportTeacher] = useState<Teacher | null>(null);
  const [isExportingProfile, setIsExportingProfile] = useState(false);
  const [newTeacher, setNewTeacher] = useState<Omit<Teacher, 'id'>>({
    name: '',
    specialization: 'Toán',
    position: 'Giáo viên',
    maxPeriods: 17,
    isHomeroomCapable: true,
    preferredGrades: ['10', '11', '12'],
    experienceYears: 5,
    phone: '',
    namSinh: 1985,
    namVaoNganh: 2008,
    trinhDo: 'Đại học',
    email: ''
  });

  const [isAddingClass, setIsAddingClass] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassModel | null>(null);
  const [newClass, setNewClass] = useState<Omit<ClassModel, 'id'>>({
    name: '',
    grade: '10'
  });

  const [isAddingSubject, setIsAddingSubject] = useState(false);
  const [newSubject, setNewSubject] = useState<{
    id: string;
    name: string;
    departmentId?: string;
    department?: string;
    grade10Periods: number;
    grade11Periods: number;
    grade12Periods: number;
  }>({
    id: '',
    name: '',
    departmentId: '',
    department: '',
    grade10Periods: 2,
    grade11Periods: 2,
    grade12Periods: 2
  });

  const [editingSubject, setEditingSubject] = useState<{
    originalId: string;
    id: string;
    name: string;
    departmentId?: string;
    department?: string;
    grade10Periods: number;
    grade11Periods: number;
    grade12Periods: number;
  } | null>(null);

  const [isManageSubjectsModalOpen, setIsManageSubjectsModalOpen] = useState(false);
  const [subjectManageSearch, setSubjectManageSearch] = useState('');

  // Add subject to class bar state
  const [addSubjectToClassId, setAddSubjectToClassId] = useState<string>('');
  const [addSubjectMainPeriods, setAddSubjectMainPeriods] = useState<number>(2);
  const [addSubjectOppPeriods, setAddSubjectOppPeriods] = useState<number>(0);

  // Copy periods to selected classes state
  const [copyPeriodsModalSourceClassId, setCopyPeriodsModalSourceClassId] = useState<string | null>(null);
  const [selectedTargetClassesForCopy, setSelectedTargetClassesForCopy] = useState<string[]>([]);
  const [copyIncludeConsecutive, setCopyIncludeConsecutive] = useState<boolean>(true);

  // Teachers directory sort & filter state
  const [teacherSortOption, setTeacherSortOption] = useState<string>('default');
  const [teacherSearchTerm, setTeacherSearchTerm] = useState<string>('');

  // Clear assignments confirmation modal state
  const [isClearAssignmentsModalOpen, setIsClearAssignmentsModalOpen] = useState(false);
  const [clearAssignmentOption, setClearAssignmentOption] = useState<'all' | 'subject_only' | 'homeroom_only'>('all');

  // AI Optimization modal state
  const [isAiOptimizeModalOpen, setIsAiOptimizeModalOpen] = useState(false);
  const [aiOptimizeMode, setAiOptimizeMode] = useState<'all' | 'teaching_only' | 'homeroom_only' | 'manual_and_auto'>('manual_and_auto');
  const [optPrioritizeNormalTeachers, setOptPrioritizeNormalTeachers] = useState<boolean>(true);
  const [optStrictQuota, setOptStrictQuota] = useState<boolean>(false);
  const [optLimitGrades, setOptLimitGrades] = useState<boolean>(true);
  const [optBalanceWorkload, setOptBalanceWorkload] = useState<boolean>(true);
  const [unassignedReport, setUnassignedReport] = useState<UnassignedSlot[] | null>(null);

  // Delete confirmation modal state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    type: 'teacher' | 'class' | 'subject' | 'reset_defaults' | 'restore' | 'class_subject' | 'department';
    id?: string;
    title: string;
    entityName: string;
    subtitle?: string;
    details?: { label: string; value: string }[];
    warning: string;
    confirmText: string;
    onConfirm: () => void;
  } | null>(null);

  // Export & Print modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isUserGuideModalOpen, setIsUserGuideModalOpen] = useState(false);

  // Phím tắt mở nhanh Hướng dẫn sử dụng: F1 hoặc '?'
  useEffect(() => {
    const handleGlobalHelpKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setIsUserGuideModalOpen(prev => !prev);
        return;
      }
      if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setIsUserGuideModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalHelpKey);
    return () => window.removeEventListener('keydown', handleGlobalHelpKey);
  }, []);

  const [isNlImportOpen, setIsNlImportOpen] = useState(false);
  const [nlImportType, setNlImportType] = useState<NlImportType>('teachers');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [restoreScope, setRestoreScope] = useState<'all' | 'current_year'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo>(() => {
    const saved = localStorage.getItem('edu_school_info_v1');
    const defaultInfo: SchoolInfo = {
      schoolName: 'TRƯỜNG THPT NGUYỄN BỈNH KHIÊM',
      departmentName: 'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG',
      academicYear: currentAcademicYear,
      semester: currentSemester,
      createdDate: new Date().toLocaleDateString('vi-VN'),
      teachingWeeks: 18,
      applyDate: '08/9/2025',
      circularNumber: 'Thực hiện theo Thông tư số 05/2025/TT-BGDĐT ngày 07/03/2025 của Bộ GDĐT quy định về chế độ làm việc đối với giáo viên phổ thông, dự bị đại học',
      principalName: 'Ngô Thị Kiều Huệ',
      deanName: 'Tổ trưởng Chuyên môn',
      creatorName: 'Võ Việt Dũng'
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.principalName === 'Hiệu trưởng' || !parsed.principalName) {
          parsed.principalName = 'Ngô Thị Kiều Huệ';
        }
        if (parsed.creatorName === 'Bộ phận Chuyên môn' || parsed.creatorName === 'Bộ phận chuyên môn' || !parsed.creatorName) {
          parsed.creatorName = 'Võ Việt Dũng';
        }
        if (!parsed.departmentName || parsed.departmentName.includes('SỞ GD') || parsed.departmentName.includes('GD&ĐT')) {
          parsed.departmentName = 'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG';
        }
        return { ...defaultInfo, ...parsed, academicYear: currentAcademicYear, semester: currentSemester };
      } catch (e) {}
    }
    return defaultInfo;
  });

  useEffect(() => {
    localStorage.setItem('edu_school_info_v1', JSON.stringify(schoolInfo));
    localStorage.setItem(`edu_term_school_info_${currentTermKey}`, JSON.stringify(schoolInfo));
  }, [schoolInfo, currentTermKey]);

  useEffect(() => {
    localStorage.setItem('edu_current_academic_year', currentAcademicYear);
    localStorage.setItem('edu_current_semester', currentSemester);
    localStorage.setItem('edu_available_years', JSON.stringify(availableYears));
  }, [currentAcademicYear, currentSemester, availableYears]);

  // Synchronize active term assignments & periods to term keys
  useEffect(() => {
    const termAssignKey = `edu_term_assignments_${currentTermKey}`;
    localStorage.setItem(termAssignKey, JSON.stringify(assignments));
    localStorage.setItem(`edu_term_meta_${currentTermKey}`, JSON.stringify({
      academicYear: currentAcademicYear,
      semester: currentSemester,
      updatedAt: new Date().toISOString()
    }));
  }, [assignments, currentTermKey, currentAcademicYear, currentSemester]);

  useEffect(() => {
    localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(classSubjectPeriods));
  }, [classSubjectPeriods, currentTermKey]);

  useEffect(() => {
    localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(classes));
  }, [classes, currentTermKey]);

  // Save changes
  useEffect(() => {
    localStorage.setItem('edu_teachers', JSON.stringify(teachers));
  }, [teachers]);

  useEffect(() => {
    localStorage.setItem('edu_classes', JSON.stringify(classes));
    localStorage.setItem('edu_classes_v3', JSON.stringify(classes));
  }, [classes]);

  useEffect(() => {
    localStorage.setItem('edu_subjects_config', JSON.stringify(subjectsConfig));
    localStorage.setItem(`edu_term_subjects_${currentTermKey}`, JSON.stringify(subjectsConfig));
  }, [subjectsConfig, currentTermKey]);

  useEffect(() => {
    localStorage.setItem('edu_departments', JSON.stringify(departments));
    localStorage.setItem(`edu_term_departments_${currentTermKey}`, JSON.stringify(departments));
  }, [departments, currentTermKey]);

  // Handle ESC key to exit fullscreen or close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingAssignmentConfirm) setPendingAssignmentConfirm(null);
        else if (deleteConfirmation) setDeleteConfirmation(null);
        else if (selectedCell) setSelectedCell(null);
        else if (selectedHomeroomCell) setSelectedHomeroomCell(null);
        else if (isAddingTeacher) setIsAddingTeacher(false);
        else if (editingTeacher) setEditingTeacher(null);
        else if (isAddingClass) setIsAddingClass(false);
        else if (editingClass) setEditingClass(null);
        else if (isAddingSubject) setIsAddingSubject(false);
        else if (editingSubject) setEditingSubject(null);
        else if (isManageSubjectsModalOpen) setIsManageSubjectsModalOpen(false);
        else if (isManageDepartmentsModalOpen) setIsManageDepartmentsModalOpen(false);
        else if (copyPeriodsModalSourceClassId) setCopyPeriodsModalSourceClassId(null);
        else if (isExportModalOpen) setIsExportModalOpen(false);
        else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
        else if (isYearSemesterModalOpen) setIsYearSemesterModalOpen(false);
        else if (termInitModal) setTermInitModal(null);
        else if (isAddYearModalOpen) setIsAddYearModalOpen(false);
        else if (isAiOptimizeModalOpen) setIsAiOptimizeModalOpen(false);
        else if (unassignedReport) setUnassignedReport(null);
        else if (isBoardFullscreen) setIsBoardFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirmation, selectedCell, selectedHomeroomCell, isAddingTeacher, editingTeacher, isAddingClass, isAddingSubject, editingSubject, isManageSubjectsModalOpen, isManageDepartmentsModalOpen, copyPeriodsModalSourceClassId, isExportModalOpen, isSettingsModalOpen, isYearSemesterModalOpen, termInitModal, isAddYearModalOpen, isAiOptimizeModalOpen, unassignedReport, isBoardFullscreen, isSendScheduleModalOpen]);

  // Active timetable data for distribution modal and AIAssistant (Reactive State)
  const [activeTimetableData, setActiveTimetableData] = useState<any>(() => {
    try {
      const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
      setActiveTimetableData(s ? JSON.parse(s) : null);
    } catch {
      setActiveTimetableData(null);
    }
  }, [currentTermKey, isSendScheduleModalOpen]);

  useEffect(() => {
    const handleTimetableUpdate = (e: any) => {
      if (e.detail !== undefined) {
        setActiveTimetableData(e.detail);
      } else {
        try {
          const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
          setActiveTimetableData(s ? JSON.parse(s) : null);
        } catch {
          setActiveTimetableData(null);
        }
      }
    };
    window.addEventListener('edu_timetable_updated', handleTimetableUpdate);
    window.addEventListener('storage', handleTimetableUpdate);
    return () => {
      window.removeEventListener('edu_timetable_updated', handleTimetableUpdate);
      window.removeEventListener('storage', handleTimetableUpdate);
    };
  }, [currentTermKey]);

  // Update contact information for teachers
  const handleUpdateTeacherContact = useCallback((teacherId: string, email?: string, phone?: string) => {
    setTeachers(prev => {
      const updated = prev.map(t => {
        if (t.id === teacherId) {
          return {
            ...t,
            email: email !== undefined ? email.trim() : t.email,
            phone: phone !== undefined ? phone.trim() : t.phone
          };
        }
        return t;
      });
      try {
        localStorage.setItem('edu_teachers', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    showTermNotification('Đã cập nhật thông tin liên hệ giáo viên.');
  }, []);

  // Update contact information for classes
  const handleUpdateClassContact = useCallback((classId: string, email?: string, phone?: string) => {
    const hrTeacherId = assignments.homeroomAssignments?.[classId];
    if (hrTeacherId) {
      handleUpdateTeacherContact(hrTeacherId, email, phone);
    } else {
      showTermNotification('Đã lưu thông tin lớp học.');
    }
  }, [assignments.homeroomAssignments, handleUpdateTeacherContact]);

  // Helper tra cứu giáo viên được phân công bộ môn an toàn cho mọi biến thể mã môn (GDQPAN, GD QP-AN, v.v.)
  // Helper tra cứu giáo viên được phân công bộ môn an toàn cho mọi biến thể mã môn (GDQPAN, GD QP-AN, v.v.)
  const getAssignedTeacherId = useCallback((classId: string, subjectId: string): string | undefined => {
    // Môn nào có số tiết = 0 trong khai báo: tuyệt đối không trả về giáo viên phân công
    const cls = classes.find(c => c.id === classId || c.name === classId);
    if (cls && getSubjectPeriod(subjectId, cls.grade, cls.id) === 0) {
      return undefined;
    }
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const row = assignments.subjectAssignments[classId] || assignments.subjectAssignments[cleanId] || assignments.subjectAssignments[prefixedId] || (cls?.name ? assignments.subjectAssignments[cls.name] : undefined);
    if (!row) return undefined;
    if (row[subjectId]) return row[subjectId];
    const norm = normalizeSubjectName(subjectId);
    if (row[norm]) return row[norm];
    if (norm === 'GDQPAN') {
      return row['GD QP-AN'] || row['GDQP'] || row['QPAN'];
    }
    return undefined;
  }, [classes, assignments.subjectAssignments, getSubjectPeriod]);

  // Hàm rà soát và dọn dẹp nghiêm ngặt toàn bộ 44 lớp:
  // Quét toàn bộ bảng phân công, nếu phát hiện bất kỳ ô nào đang có giáo viên nhưng số tiết khai báo = 0
  // (ví dụ: Công nghệ ở các lớp khối 12, hoặc các môn lựa chọn không chọn học) -> tự động XÓA GÁN và trừ lại số tiết cho giáo viên ngay lập tức.
  const cleanAssignmentsForZeroPeriodSubjects = useCallback((
    currentSubjectAssignments: Record<string, Record<string, string>>,
    options: { notify?: boolean } = {}
  ): { cleaned: Record<string, Record<string, string>>; removedCount: number; details: string[] } => {
    let removedCount = 0;
    const details: string[] = [];
    const nextAssignments: Record<string, Record<string, string>> = {};

    Object.keys(currentSubjectAssignments || {}).forEach(k => {
      nextAssignments[k] = { ...(currentSubjectAssignments[k] || {}) };
    });

    classes.forEach(cls => {
      const summary = classDeclaredSummaryMap[cls.id] || getClassDeclaredSummary(cls.id, cls.grade);
      const activeSubs = new Set<string>();
      summary.subjects.forEach(s => {
        if (!s.isRemoved && s.totalPeriods > 0) {
          activeSubs.add(s.id);
          activeSubs.add(s.normName);
        }
      });

      const classKeys = [cls.id, cls.name, 'c_' + cls.id.replace(/^c_/, ''), cls.id.replace(/^c_/, '')];
      classKeys.forEach(k => {
        const row = nextAssignments[k];
        if (row) {
          Object.keys(row).forEach(subKey => {
            const normSub = normalizeSubjectName(subKey);
            const period = getSubjectPeriod(subKey, cls.grade, cls.id);
            if (period === 0 || (!activeSubs.has(subKey) && !activeSubs.has(normSub))) {
              const teacherId = row[subKey];
              const teacher = teachers.find(t => t.id === teacherId);
              details.push(`Lớp ${cls.name}: Môn ${subKey} (0 tiết) - Xóa phân công GV ${teacher?.name || teacherId}`);
              delete row[subKey];
              removedCount++;
            }
          });
        }
      });
    });

    if (options.notify) {
      if (removedCount > 0) {
        showTermNotification(`🧹 Đã quét 44 lớp: Đã xóa ${removedCount} phân công môn 0 tiết (ví dụ: Công nghệ ở khối 12) và trừ lại số tiết cho giáo viên!`);
      } else {
        showTermNotification(`✅ Đã rà soát 44 lớp: Bảng phân công 100% chuẩn xác (không có môn 0 tiết nào bị gán giáo viên).`);
      }
    }

    return { cleaned: nextAssignments, removedCount, details };
  }, [classes, classDeclaredSummaryMap, getClassDeclaredSummary, getSubjectPeriod, teachers, showTermNotification]);

  // Tự động quét và dọn dẹp sạch sẽ toàn bộ 44 lớp học: loại bỏ triệt để giáo viên khỏi các môn học có 0 tiết
  useEffect(() => {
    const { cleaned, removedCount } = cleanAssignmentsForZeroPeriodSubjects(assignments.subjectAssignments, { notify: false });
    if (removedCount > 0) {
      setAssignments(prev => ({
        ...prev,
        subjectAssignments: cleaned
      }));
    }
  }, [classes, classSubjectPeriods, subjectsConfig, cleanAssignmentsForZeroPeriodSubjects]);

  // TỐI ƯU HÓA HIỆU NĂNG CAO: Thống kê giáo viên gom cụm 1 lượt (Single-pass O(classes*subjects) thay vì 71,000 vòng lặp)
  const teacherStatsMap = useMemo(() => {
    const map: Record<string, {
      assignedPeriods: number;
      homeroomPeriods: number;
      totalPeriods: number;
      maxQuota: number;
      maxAllowed: number;
      isHomeroom: boolean;
      homeroomClass: string;
      assignedClasses: string[];
      assignedGrades: Set<'10' | '11' | '12'>;
      isOverloaded: boolean;
      excessPeriods: number;
      isExceedingGrades: boolean;
      gradesList: string;
      warnings: string[];
    }> = {};

    teachers.forEach(t => {
      map[t.id] = {
        assignedPeriods: 0,
        homeroomPeriods: 0,
        totalPeriods: 0,
        maxQuota: t.maxPeriods || 17,
        maxAllowed: t.maxPeriods || 17,
        isHomeroom: false,
        homeroomClass: '',
        assignedClasses: [],
        assignedGrades: new Set<'10' | '11' | '12'>(),
        isOverloaded: false,
        excessPeriods: 0,
        isExceedingGrades: false,
        gradesList: '',
        warnings: []
      };
    });

    // 1. Phân công Chủ nhiệm
    Object.entries(assignments.homeroomAssignments).forEach(([classId, tId]) => {
      if (tId && map[tId]) {
        map[tId].isHomeroom = true;
        map[tId].homeroomPeriods = 4;
        const cls = classes.find(c => c.id === classId);
        if (cls) {
          map[tId].homeroomClass = cls.name;
          map[tId].assignedGrades.add(cls.grade);
        }
      }
    });

    // 2. Gom phân công bộ môn trong 1 lượt duy nhất
    classes.forEach(cls => {
      SUBJECTS.forEach(sub => {
        const tId = getAssignedTeacherId(cls.id, sub.id);
        if (tId && map[tId]) {
          const p = getSubjectPeriod(sub.id, cls.grade, cls.id);
          if (p > 0) {
            map[tId].assignedPeriods += p;
            map[tId].assignedClasses.push(cls.name);
            map[tId].assignedGrades.add(cls.grade);
          }
        }
      });
    });

    // 3. Tính toán cảnh báo & hạn mức
    teachers.forEach(t => {
      const item = map[t.id];
      item.totalPeriods = item.assignedPeriods + item.homeroomPeriods;
      item.maxAllowed = item.isHomeroom ? item.maxQuota - 4 : item.maxQuota;
      item.isOverloaded = item.maxQuota > 0 ? item.totalPeriods > item.maxQuota : false;
      item.excessPeriods = item.isOverloaded ? item.totalPeriods - item.maxQuota : 0;
      item.isExceedingGrades = item.assignedGrades.size >= 3;
      item.gradesList = Array.from(item.assignedGrades).sort().join(', ');

      const warnings: string[] = [];
      if (item.isOverloaded) {
        warnings.push(`Vượt quá định mức (${item.totalPeriods}/${item.maxQuota} tiết, vượt ${item.excessPeriods} tiết)`);
      }
      if (item.isExceedingGrades) {
        warnings.push(`Dạy quá 2 khối lớp (${item.gradesList})`);
      }
      if (item.isHomeroom && !t.isHomeroomCapable) {
        warnings.push(`Chưa đạt tiêu chuẩn chủ nhiệm`);
      }
      item.assignedClasses.forEach(className => {
        const grade = className.substring(0, 2);
        if (grade && !t.preferredGrades?.includes(grade)) {
          const warnText = `Dạy khối ${grade} nằm ngoài sở thích`;
          if (!warnings.includes(warnText)) warnings.push(warnText);
        }
      });
      item.warnings = warnings;
    });

    return map;
  }, [teachers, classes, assignments, classSubjectPeriods]);

  const defaultTeacherStats = useMemo(() => ({
    assignedPeriods: 0,
    homeroomPeriods: 0,
    totalPeriods: 0,
    maxQuota: 17,
    maxAllowed: 17,
    isHomeroom: false,
    homeroomClass: '',
    assignedClasses: [] as string[],
    assignedGrades: new Set<'10' | '11' | '12'>(),
    isOverloaded: false,
    excessPeriods: 0,
    isExceedingGrades: false,
    gradesList: '',
    warnings: [] as string[]
  }), []);

  // Tra cứu thống kê giáo viên tức thì O(1) từ RAM, loại bỏ hoàn toàn đơ giật
  const getTeacherStats = useCallback((teacherId: string) => {
    return teacherStatsMap[teacherId] || defaultTeacherStats;
  }, [teacherStatsMap, defaultTeacherStats]);

  const conflictsCount = useMemo(() => {
    return Object.values(teacherStatsMap).reduce((sum, s) => sum + s.warnings.length, 0);
  }, [teacherStatsMap]);

  const getAssignedCount = useCallback(() => {
    let homeroomAssigned = 0;
    let subjectsAssigned = 0;
    let totalSubjects = 0;
    let totalPeriodsAssigned = 0;
    let totalRequiredPeriods = 0;
    const assignedTeachingTeacherIds = new Set<string>();

    classes.forEach(c => {
      const hrTeacherId = assignments.homeroomAssignments[c.id];
      if (hrTeacherId) {
        homeroomAssigned++;
      }
      SUBJECTS.forEach(s => {
        totalSubjects++;
        const period = getSubjectPeriod(s.id, c.grade, c.id);
        totalRequiredPeriods += period;
        const tId = getAssignedTeacherId(c.id, s.id);
        if (tId) {
          subjectsAssigned++;
          totalPeriodsAssigned += period;
          assignedTeachingTeacherIds.add(tId);
        }
      });
    });

    const assignedTeachersCount = teachers.filter(t => assignedTeachingTeacherIds.has(t.id)).length;
    const grade10Count = classes.filter(c => c.grade === '10').length;
    const grade11Count = classes.filter(c => c.grade === '11').length;
    const grade12Count = classes.filter(c => c.grade === '12').length;

    return {
      classesCount: classes.length,
      grade10Count,
      grade11Count,
      grade12Count,
      teachersCount: teachers.length,
      assignedTeachersCount,
      homeroomAssigned,
      subjectsAssigned,
      totalSubjects,
      totalPeriodsAssigned,
      totalRequiredPeriods
    };
  }, [classes, assignments, classSubjectPeriods, teachers]);

  const statsCount = useMemo(() => {
    return getAssignedCount();
  }, [getAssignedCount]);

  const removeVietnameseTones = (str: string): string => {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  };

  /**
   * Chuẩn hóa từ khóa tìm kiếm: xóa khoảng trắng đầu cuối, gộp khoảng trắng thừa và chuyển chữ thường
   */
  const normalizeSearchTerm = (str: string = ''): string => {
    return (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
  };

  const sortedAndFilteredTeachers = useMemo(() => {
    let result = [...teachers];

    // Filter by search term (Tên, Môn học hiển thị & mã môn & tên môn đầy đủ, Chức vụ, Tổ chuyên môn, Trình độ chuyên môn & từ viết tắt)
    if (teacherSearchTerm && teacherSearchTerm.trim()) {
      const searchTerm = normalizeSearchTerm(teacherSearchTerm);
      const searchTermNoSpace = searchTerm.replace(/\s+/g, '');
      const qNorm = removeVietnameseTones(searchTerm);
      const qNormNoSpace = qNorm.replace(/\s+/g, '');

      result = result.filter(t => {
        // 1. Tên giáo viên
        const nameRaw = (t.name || '').toLowerCase();
        const nameNorm = removeVietnameseTones(nameRaw);
        const nameNoSpace = nameRaw.replace(/\s+/g, '');
        const matchName = nameRaw.includes(searchTerm) || nameNorm.includes(qNorm) || nameNoSpace.includes(searchTermNoSpace);
        if (matchName) return true;

        // 2. Môn giảng dạy: Kiểm tra toàn diện mọi trường môn học và tên môn đầy đủ
        const resolvedSubject = (resolveTeacherSubject(t, SUBJECTS) || '').toLowerCase();
        const specRaw = (t.specialization || '').toLowerCase();
        const subRaw = (t.subject || '').toLowerCase();
        const subCode = (((t as any).subjectCode as string) || '').toLowerCase();
        const subId = (((t as any).subjectId as string) || '').toLowerCase();
        const monGiangDay = (((t as any).monGiangDay as string) || '').toLowerCase();
        const monDay = (((t as any).monDay as string) || '').toLowerCase();
        const monHoc = (((t as any).monHoc as string) || '').toLowerCase();

        // Tra cứu tên đầy đủ môn học trong danh mục (ví dụ CNCN -> Công nghệ (Công nghiệp))
        const matchedSubjectObj = SUBJECTS.find(s => 
          s.id.toLowerCase() === resolvedSubject || 
          s.id.toLowerCase() === specRaw || 
          (s.name && s.name.toLowerCase() === specRaw)
        );
        const subjectFullName = (((t as any).subjectName as string) || matchedSubjectObj?.name || '').toLowerCase();
        const subjectFullId = (matchedSubjectObj?.id || '').toLowerCase();

        const matchSubjectField = (val: string): boolean => {
          if (!val) return false;
          const valNoSpace = val.replace(/\s+/g, '');
          if (val.includes(searchTerm) || valNoSpace.includes(searchTermNoSpace)) return true;
          const valNorm = removeVietnameseTones(val);
          const valNormNoSpace = valNorm.replace(/\s+/g, '');
          return valNorm.includes(qNorm) || valNormNoSpace.includes(qNormNoSpace);
        };

        const matchSubject = (
          matchSubjectField(resolvedSubject) ||
          matchSubjectField(specRaw) ||
          matchSubjectField(subRaw) ||
          matchSubjectField(subCode) ||
          matchSubjectField(subId) ||
          matchSubjectField(subjectFullName) ||
          matchSubjectField(subjectFullId) ||
          matchSubjectField(monGiangDay) ||
          matchSubjectField(monDay) ||
          matchSubjectField(monHoc)
        );
        if (matchSubject) return true;

        // 3. Chức vụ
        const posRaw = (t.position || '').toLowerCase();
        const posNorm = removeVietnameseTones(posRaw);
        if (posRaw.includes(searchTerm) || posNorm.includes(qNorm)) return true;

        // 4. Tổ chuyên môn
        const deptRaw = (t.department || (t as any).toChuyenMon || (t as any).departmentId || getDefaultDepartment(t.specialization, subjectFullName)).toLowerCase();
        const deptNorm = removeVietnameseTones(deptRaw);
        const deptNoSpace = deptRaw.replace(/\s+/g, '');
        if (deptRaw.includes(searchTerm) || deptNorm.includes(qNorm) || deptNoSpace.includes(searchTermNoSpace)) return true;

        // Nhận diện truy vấn theo khối tự nhiên / xã hội
        const isKHTNQuery = qNorm.includes('tu nhien') || qNorm.includes('khtn');
        if (isKHTNQuery && (deptNorm.includes('khtn') || deptNorm.includes('tu nhien') || ['lý', 'hóa', 'sinh'].includes(specRaw))) return true;
        const isKHXHQuery = qNorm.includes('xa hoi') || qNorm.includes('khxh');
        if (isKHXHQuery && (deptNorm.includes('khxh') || deptNorm.includes('xa hoi') || ['sử', 'địa', 'gdktpl', 'gdcd'].includes(specRaw))) return true;

        // 5. Số điện thoại & Email
        const phone = t.phone || '';
        const email = (t.email || '').toLowerCase();
        if (phone.replace(/\s+/g, '').includes(searchTermNoSpace) || email.includes(searchTerm)) return true;

        // 6. Trình độ chuyên môn (ThS, TS, ĐH, CĐ, Thạc sĩ, Tiến sĩ, Đại học, Cao đẳng)
        const degreeRaw = (t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')).toLowerCase().trim();
        const degreeNorm = removeVietnameseTones(degreeRaw);
        if (degreeRaw.includes(searchTerm) || degreeNorm.includes(qNorm)) return true;

        const isThS = qNormNoSpace === 'ths' || qNorm.includes('thac si');
        if (isThS && degreeRaw.includes('thạc sĩ')) return true;

        const isDH = qNormNoSpace === 'dh' || qNorm.includes('dai hoc') || searchTerm.includes('đh');
        if (isDH && degreeRaw.includes('đại học')) return true;

        const isTS = qNormNoSpace === 'ts' || qNorm.includes('tien si');
        if (isTS && degreeRaw.includes('tiến sĩ')) return true;

        const isCD = qNormNoSpace === 'cd' || qNorm.includes('cao dang') || searchTerm.includes('cđ');
        if (isCD && degreeRaw.includes('cao đẳng')) return true;

        return false;
      });
    }

    if (teacherSortOption === 'default') {
      return result;
    }

    const getVietnameseSortName = (fullName: string) => {
      const cleanName = fullName.replace(/^(Thầy|Cô)\s+/i, '').trim();
      const parts = cleanName.split(/\s+/);
      const firstName = parts[parts.length - 1] || '';
      const lastNameAndMiddle = parts.slice(0, -1).join(' ');
      return { firstName, lastNameAndMiddle, cleanName };
    };

    const getPositionRank = (pos?: string): number => {
      const p = (pos || '').trim();
      if (p === 'Hiệu trưởng') return 1;
      if (p === 'Phó Hiệu trưởng') return 2;
      if (p.includes('Chủ tịch Công đoàn') || p.includes('Công đoàn')) return 3;
      if (p.includes('Tổ trưởng')) return 4;
      if (p.includes('Tổ phó')) return 5;
      if (p.includes('Bí thư đoàn') || p.includes('Bí thư Đoàn')) return 6;
      if (p.includes('Phó Bí thư')) return 7;
      if (p.includes('Trợ lý')) return 8;
      if (p === 'Giáo viên' || !pos) return 9;
      return 10;
    };

    const getSubjectPositionRank = (pos?: string): number => {
      const p = (pos || '').trim();
      if (p === 'Hiệu trưởng') return 1;
      if (p === 'Phó Hiệu trưởng') return 2;
      if (p.includes('Tổ trưởng')) return 3; // Ưu tiên Tổ trưởng trước
      if (p.includes('Tổ phó')) return 4;    // rồi tới Tổ phó
      if (p.includes('Chủ tịch Công đoàn') || p.includes('Công đoàn')) return 5;
      if (p.includes('Bí thư đoàn') || p.includes('Bí thư Đoàn')) return 6;
      if (p.includes('Phó Bí thư')) return 7;
      if (p.includes('Trợ lý')) return 8;
      if (p === 'Giáo viên' || !pos) return 9; // cuối cùng là giáo viên
      return 10;
    };

    const getSubjectOrder = (sub: string): number => {
      const norm = normalizeSubjectName(sub);
      const idx = SUBJECTS.findIndex(s => s.id === norm || s.name === norm || s.id === sub || s.name === sub);
      return idx !== -1 ? idx : 999;
    };

    const getTeacherBirthTimestamp = (t: Teacher): number => {
      const curYear = new Date().getFullYear() || 2026;
      const rawDob = t.dateOfBirth || t.dob;
      const fallbackYear = t.namSinh || (t.experienceYears ? curYear - 22 - t.experienceYears : 1985);
      const parsed = parseDateOfBirth(rawDob, fallbackYear);
      return new Date(parsed.year, parsed.month - 1, parsed.day).getTime();
    };

    const getTeacherSeniority = (t: Teacher): number => {
      const curYear = new Date().getFullYear() || 2026;
      if (t.namVaoNganh && t.namVaoNganh > 1950 && t.namVaoNganh <= curYear) {
        return curYear - t.namVaoNganh;
      }
      if (typeof t.experienceYears === 'number' && !isNaN(t.experienceYears)) {
        return t.experienceYears;
      }
      return 0;
    };

    // Trọng số thứ bậc học vị: Tiến sĩ (3) > Thạc sĩ (2) > Đại học (1) > Cao đẳng / Khác (0)
    const getDegreeRank = (t: Teacher): number => {
      const deg = (t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')).toLowerCase().trim();
      if (deg.includes('tiến sĩ') || deg === 'ts') return 3;
      if (deg.includes('thạc sĩ') || deg === 'ths') return 2;
      if (deg.includes('đại học') || deg === 'dh' || deg.includes('cử nhân')) return 1;
      return 0; // Cao đẳng / Khác
    };

    result.sort((a, b) => {
      // Sắp xếp theo Trình độ: Cao đến Thấp (Tiến sĩ → Thạc sĩ → Đại học)
      if (teacherSortOption === 'degree-desc') {
        const rankA = getDegreeRank(a);
        const rankB = getDegreeRank(b);
        if (rankB !== rankA) return rankB - rankA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      // Sắp xếp theo Trình độ: Thấp đến Cao (Đại học → Thạc sĩ → Tiến sĩ)
      if (teacherSortOption === 'degree-asc') {
        const rankA = getDegreeRank(a);
        const rankB = getDegreeRank(b);
        if (rankA !== rankB) return rankA - rankB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      // 1. Sắp xếp theo Tuổi: Tăng dần (Trẻ đến Lớn tuổi) -> Sinh sau (timestamp lớn hơn) xếp trước
      if (teacherSortOption === 'age-asc') {
        const timeA = getTeacherBirthTimestamp(a);
        const timeB = getTeacherBirthTimestamp(b);
        if (timeB !== timeA) return timeB - timeA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      // 2. Sắp xếp theo Tuổi: Giảm dần (Lớn tuổi đến Trẻ) -> Sinh trước (timestamp nhỏ hơn) xếp trước
      if (teacherSortOption === 'age-desc') {
        const timeA = getTeacherBirthTimestamp(a);
        const timeB = getTeacherBirthTimestamp(b);
        if (timeA !== timeB) return timeA - timeB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      // 3. Sắp xếp theo Thâm niên: Tăng dần (Ít đến Nhiều năm) -> Ít năm thâm niên xếp trước
      if (teacherSortOption === 'seniority-asc') {
        const senA = getTeacherSeniority(a);
        const senB = getTeacherSeniority(b);
        if (senA !== senB) return senA - senB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      // 4. Sắp xếp theo Thâm niên: Giảm dần (Nhiều đến Ít năm) -> Nhiều năm thâm niên xếp trước
      if (teacherSortOption === 'seniority-desc') {
        const senA = getTeacherSeniority(a);
        const senB = getTeacherSeniority(b);
        if (senB !== senA) return senB - senA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'name-asc') {
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'name-desc') {
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameB.firstName.localeCompare(nameA.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameB.lastNameAndMiddle.localeCompare(nameA.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'fullname-asc') {
        const nameA = getVietnameseSortName(a.name).cleanName;
        const nameB = getVietnameseSortName(b.name).cleanName;
        return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'position-asc') {
        const rankA = getPositionRank(a.position);
        const rankB = getPositionRank(b.position);
        if (rankA !== rankB) return rankA - rankB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'position-desc') {
        const rankA = getPositionRank(a.position);
        const rankB = getPositionRank(b.position);
        if (rankA !== rankB) return rankB - rankA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'specialization-curriculum') {
        const orderA = getSubjectOrder(a.specialization);
        const orderB = getSubjectOrder(b.specialization);
        if (orderA !== orderB) return orderA - orderB;
        
        // Trong cùng môn: Ưu tiên Tổ trưởng -> Tổ phó -> Giáo viên
        const posRankA = getSubjectPositionRank(a.position);
        const posRankB = getSubjectPositionRank(b.position);
        if (posRankA !== posRankB) return posRankA - posRankB;

        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmp = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'specialization-alpha') {
        const cmp = a.specialization.localeCompare(b.specialization, 'vi', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        
        // Trong cùng môn: Ưu tiên Tổ trưởng -> Tổ phó -> Giáo viên
        const posRankA = getSubjectPositionRank(a.position);
        const posRankB = getSubjectPositionRank(b.position);
        if (posRankA !== posRankB) return posRankA - posRankB;

        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        const cmpName = nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
        if (cmpName !== 0) return cmpName;
        return nameA.lastNameAndMiddle.localeCompare(nameB.lastNameAndMiddle, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'homeroom-asc') {
        const hrA = Object.entries(assignments.homeroomAssignments).find(([, tId]) => tId === a.id)?.[0] || '';
        const hrB = Object.entries(assignments.homeroomAssignments).find(([, tId]) => tId === b.id)?.[0] || '';
        if (hrA && !hrB) return -1;
        if (!hrA && hrB) return 1;
        if (hrA && hrB) {
          const clsA = classes.find(c => c.id === hrA)?.name || hrA;
          const clsB = classes.find(c => c.id === hrB)?.name || hrB;
          return clsA.localeCompare(clsB, 'vi', { numeric: true });
        }
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'periods-desc') {
        const pA = teacherStatsMap[a.id]?.totalPeriods ?? 0;
        const pB = teacherStatsMap[b.id]?.totalPeriods ?? 0;
        if (pB !== pA) return pB - pA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'periods-asc') {
        const pA = teacherStatsMap[a.id]?.totalPeriods ?? 0;
        const pB = teacherStatsMap[b.id]?.totalPeriods ?? 0;
        if (pA !== pB) return pA - pB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'quota-desc') {
        const qA = a.maxPeriods ?? 17;
        const qB = b.maxPeriods ?? 17;
        if (qB !== qA) return qB - qA;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      if (teacherSortOption === 'quota-asc') {
        const qA = a.maxPeriods ?? 17;
        const qB = b.maxPeriods ?? 17;
        if (qA !== qB) return qA - qB;
        const nameA = getVietnameseSortName(a.name);
        const nameB = getVietnameseSortName(b.name);
        return nameA.firstName.localeCompare(nameB.firstName, 'vi', { sensitivity: 'base' });
      }

      return 0;
    });

    return result;
  }, [teachers, teacherSortOption, teacherSearchTerm, assignments.homeroomAssignments, classes, teacherStatsMap, SUBJECTS]);

  // Multi-term Switching & Lifecycle handlers
  const switchTermDirectly = (targetYear: string, targetSemester: string) => {
    const targetKey = getTermStorageKey(targetYear, targetSemester);
    const savedAssignmentsRaw = localStorage.getItem(`edu_term_assignments_${targetKey}`);
    
    // First, flush current state to current term keys
    localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(assignments));
    localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(classSubjectPeriods));
    localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(classes));
    localStorage.setItem(`edu_term_school_info_${currentTermKey}`, JSON.stringify(schoolInfo));

    if (savedAssignmentsRaw) {
      try {
        const parsedAssignments = JSON.parse(savedAssignmentsRaw);
        setAssignments(parsedAssignments);

        const savedClassesRaw = localStorage.getItem(`edu_term_classes_${targetKey}`);
        if (savedClassesRaw) {
          const parsedClasses = JSON.parse(savedClassesRaw);
          if (Array.isArray(parsedClasses) && parsedClasses.length > 0) {
            setClasses(parsedClasses);
          }
        }

        const savedPeriodsRaw = localStorage.getItem(`edu_term_class_periods_${targetKey}`);
        if (savedPeriodsRaw) {
          setClassSubjectPeriods(JSON.parse(savedPeriodsRaw));
        } else {
          setClassSubjectPeriods({});
        }

        const savedSchoolInfoRaw = localStorage.getItem(`edu_term_school_info_${targetKey}`);
        if (savedSchoolInfoRaw) {
          const parsedInfo = JSON.parse(savedSchoolInfoRaw);
          setSchoolInfo(prev => ({ ...prev, ...parsedInfo, academicYear: targetYear, semester: targetSemester }));
        } else {
          setSchoolInfo(prev => ({ ...prev, academicYear: targetYear, semester: targetSemester }));
        }

        setCurrentAcademicYear(targetYear);
        setCurrentSemester(targetSemester);
        showTermNotification(`Đã chuyển sang ${targetSemester} năm học ${targetYear}!`);
        return;
      } catch (err) {
        console.error('Lỗi khi tải dữ liệu học kỳ:', err);
      }
    }

    // Nếu kỳ học này chưa có dữ liệu, mở hộp thoại tùy chọn thiết lập dữ liệu
    setTermInitModal({ targetYear, targetSemester });
  };

  const handleYearChange = (year: string) => {
    if (year === '__add_new__') {
      setIsAddYearModalOpen(true);
      return;
    }
    if (year === currentAcademicYear) return;
    switchTermDirectly(year, currentSemester);
  };

  const handleSemesterChange = (semester: string) => {
    if (semester === currentSemester) return;
    switchTermDirectly(currentAcademicYear, semester);
  };

  const handleCloneCurrentTermToTarget = () => {
    if (!termInitModal) return;
    const { targetYear, targetSemester } = termInitModal;
    const targetKey = getTermStorageKey(targetYear, targetSemester);

    // Lưu dữ liệu sao chép cho kỳ mới
    localStorage.setItem(`edu_term_assignments_${targetKey}`, JSON.stringify(assignments));
    localStorage.setItem(`edu_term_class_periods_${targetKey}`, JSON.stringify(classSubjectPeriods));
    localStorage.setItem(`edu_term_classes_${targetKey}`, JSON.stringify(classes));
    
    const updatedSchoolInfo = {
      ...schoolInfo,
      academicYear: targetYear,
      semester: targetSemester,
      createdDate: new Date().toLocaleDateString('vi-VN')
    };
    localStorage.setItem(`edu_term_school_info_${targetKey}`, JSON.stringify(updatedSchoolInfo));
    setSchoolInfo(updatedSchoolInfo);

    setCurrentAcademicYear(targetYear);
    setCurrentSemester(targetSemester);
    setTermInitModal(null);
    showTermNotification(`Đã sao chép phân công và chuyển sang ${targetSemester} năm học ${targetYear}!`);
  };

  const handleInitBlankTerm = () => {
    if (!termInitModal) return;
    const { targetYear, targetSemester } = termInitModal;
    const targetKey = getTermStorageKey(targetYear, targetSemester);

    const blankAssignments: Assignments = {
      homeroomAssignments: {},
      subjectAssignments: {}
    };
    setAssignments(blankAssignments);
    setClassSubjectPeriods({});

    localStorage.setItem(`edu_term_assignments_${targetKey}`, JSON.stringify(blankAssignments));
    localStorage.setItem(`edu_term_class_periods_${targetKey}`, JSON.stringify({}));
    localStorage.setItem(`edu_term_classes_${targetKey}`, JSON.stringify(classes));

    const updatedSchoolInfo = {
      ...schoolInfo,
      academicYear: targetYear,
      semester: targetSemester,
      createdDate: new Date().toLocaleDateString('vi-VN')
    };
    localStorage.setItem(`edu_term_school_info_${targetKey}`, JSON.stringify(updatedSchoolInfo));
    setSchoolInfo(updatedSchoolInfo);

    setCurrentAcademicYear(targetYear);
    setCurrentSemester(targetSemester);
    setTermInitModal(null);
    showTermNotification(`Đã tạo bảng phân công mới cho ${targetSemester} năm học ${targetYear}!`);
  };

  const handleConfirmAddNewYear = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newYearInput.trim();
    if (!trimmed) {
      alert('Vui lòng nhập năm học (Ví dụ: 2026 – 2027)!');
      return;
    }
    if (!availableYears.includes(trimmed)) {
      const updatedYears = [...availableYears, trimmed].sort();
      setAvailableYears(updatedYears);
    }
    setIsAddYearModalOpen(false);
    setNewYearInput('');
    switchTermDirectly(trimmed, currentSemester);
  };

  // Helper lấy danh sách các kỳ học đã lưu trong hệ thống
  const getSavedTermsCatalog = () => {
    const list: { key: string; academicYear: string; semester: string; assignmentsCount: number; isCurrent: boolean }[] = [];
    const activeKey = currentTermKey;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('edu_term_assignments_')) {
        const termKey = k.replace('edu_term_assignments_', '');
        let year = '';
        let sem = '';
        let count = 0;

        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            const subCount = Object.values(parsed.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
            const hrCount = Object.keys(parsed.homeroomAssignments || {}).length;
            count = subCount + hrCount;
          }
        } catch (e) {}

        const metaRaw = localStorage.getItem(`edu_term_meta_${termKey}`);
        if (metaRaw) {
          try {
            const m = JSON.parse(metaRaw);
            year = m.academicYear;
            sem = m.semester;
          } catch (e) {}
        }

        if (!year) {
          const parts = termKey.split('_');
          if (parts.length >= 3) {
            year = `${parts[0]} – ${parts[1]}`;
            sem = parts[2] === 'HK2' ? 'Học kỳ II' : (parts[2] === 'CN' ? 'Cả năm' : 'Học kỳ I');
          }
        }

        if (year) {
          list.push({
            key: termKey,
            academicYear: year,
            semester: sem || 'Học kỳ I',
            assignmentsCount: count,
            isCurrent: termKey === activeKey
          });
        }
      }
    }

    // Đảm bảo kỳ hiện tại luôn có mặt trong danh sách
    if (!list.some(item => item.key === activeKey)) {
      list.push({
        key: activeKey,
        academicYear: currentAcademicYear,
        semester: currentSemester,
        assignmentsCount: Object.keys(assignments.homeroomAssignments).length,
        isCurrent: true
      });
    }

    return list.sort((a, b) => b.academicYear.localeCompare(a.academicYear));
  };

  // Tra cứu trạng thái lưu trữ của từng cặp (Năm học, Học kỳ)
  const getTermStatus = (year: string, semester: string) => {
    const key = getTermStorageKey(year, semester);
    const isCurrent = (year === currentAcademicYear && semester === currentSemester);
    const raw = localStorage.getItem(`edu_term_assignments_${key}`);
    let count = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const subCount = Object.values(parsed.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
        const hrCount = Object.keys(parsed.homeroomAssignments || {}).length;
        count = subCount + hrCount;
      } catch (e) {}
    } else if (isCurrent) {
      const subCount = Object.values(assignments.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
      const hrCount = Object.keys(assignments.homeroomAssignments || {}).length;
      count = subCount + hrCount;
    }
    return {
      hasData: count > 0 || !!raw,
      count,
      isCurrent
    };
  };

  const handleDeleteYear = (yearToDelete: string) => {
    if (availableYears.length <= 1) {
      alert('Hệ thống cần tối thiểu 1 năm học để hoạt động!');
      return;
    }
    if (yearToDelete === currentAcademicYear) {
      alert('Không thể xóa năm học đang được kích hoạt và sử dụng!');
      return;
    }
    if (confirm(`Bạn có chắc chắn muốn xóa năm học "${yearToDelete}" khỏi danh sách? Dữ liệu đã lưu của năm này vẫn được bảo toàn an toàn trong bộ nhớ máy tính.`)) {
      setAvailableYears(prev => prev.filter(y => y !== yearToDelete));
    }
  };

  // Reset & Defaults
  const executeResetToDefaults = () => {
    setTeachers(DEFAULT_TEACHERS);
    setClasses(DEFAULT_CLASSES);
    setAssignments({ homeroomAssignments: DEFAULT_HOMEROOM_ASSIGNMENTS, subjectAssignments: {} });
    setSubjectsConfig(DEFAULT_SUBJECTS_CONFIG);
    setClassSubjectPeriods({});
    setClassThreeConsecutivePeriods({});
    setAiExplanation('');
    setShowAutoAssignNotice(false);
    setIsAutoAssignNoticeExpanded(false);
    setChatMessages([]);
  };

  const handleResetToDefaults = () => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để khôi phục dữ liệu mẫu gốc!');
      openLoginModal();
      return;
    }
    setDeleteConfirmation({
      type: 'reset_defaults',
      title: 'Xác nhận tải lại dữ liệu mẫu gốc',
      entityName: 'Khôi phục toàn bộ hệ thống về dữ liệu ban đầu',
      subtitle: 'Khôi phục danh sách giáo viên, lớp học, môn học và phân công chuẩn',
      details: [
        { label: 'Giáo viên hiện có', value: `${teachers.length} người` },
        { label: 'Lớp học hiện có', value: `${classes.length} lớp` },
        { label: 'Môn học hiện có', value: `${subjectsConfig.length} môn` },
      ],
      warning: 'Toàn bộ dữ liệu giáo viên, lớp học, định mức môn học và các phân công thời khóa biểu hiện tại sẽ bị xóa hoàn toàn và khôi phục về trạng thái mẫu ban đầu.',
      confirmText: 'Xác nhận tải lại mẫu gốc',
      onConfirm: executeResetToDefaults,
    });
  };

  // Backup & Restore
  const handleBackupData = () => {
    // 1. Đồng bộ cưỡng bức dữ liệu đang chỉnh sửa trên giao diện vào localStorage trước khi xuất file
    const termAssignKey = `edu_term_assignments_${currentTermKey}`;
    localStorage.setItem(termAssignKey, JSON.stringify(assignments));
    localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(classSubjectPeriods));
    localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(classes));
    localStorage.setItem(`edu_term_school_info_${currentTermKey}`, JSON.stringify(schoolInfo));
    localStorage.setItem(`edu_term_meta_${currentTermKey}`, JSON.stringify({
      academicYear: currentAcademicYear,
      semester: currentSemester,
      updatedAt: new Date().toISOString()
    }));
    localStorage.setItem('edu_current_academic_year', currentAcademicYear);
    localStorage.setItem('edu_current_semester', currentSemester);
    localStorage.setItem('edu_available_years', JSON.stringify(availableYears));
    localStorage.setItem('edu_teachers', JSON.stringify(teachers));
    localStorage.setItem('edu_classes', JSON.stringify(classes));
    localStorage.setItem('edu_classes_v3', JSON.stringify(classes));
    localStorage.setItem('edu_assignments_v3', JSON.stringify(assignments));
    localStorage.setItem('edu_subjects_config', JSON.stringify(subjectsConfig));
    localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(classSubjectPeriods));
    localStorage.setItem('edu_class_three_consecutive_v2', JSON.stringify(classThreeConsecutivePeriods));
    localStorage.setItem('edu_school_info_v1', JSON.stringify(schoolInfo));

    // 2. Thu thập toàn bộ dữ liệu hệ thống (tất cả các key bắt đầu bằng edu_)
    const backupObj: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('edu_')) {
        const val = localStorage.getItem(key);
        if (val) {
          backupObj[key] = val;
        }
      }
    }

    // 3. Thống kê danh mục các năm học và kỳ học có dữ liệu trong bản sao lưu
    const backupYearsSummary = availableYears.map(year => {
      const semStats = AVAILABLE_SEMESTERS.map(sem => {
        const key = getTermStorageKey(year, sem);
        const raw = localStorage.getItem(`edu_term_assignments_${key}`);
        let count = 0;
        if (raw) {
          try {
            const p = JSON.parse(raw);
            const subCount = Object.values(p.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
            const hrCount = Object.keys(p.homeroomAssignments || {}).length;
            count = subCount + hrCount;
          } catch (e) {}
        }
        return {
          semester: sem,
          storageKey: key,
          hasData: count > 0 || !!raw,
          assignmentsCount: count
        };
      });
      return {
        academicYear: year,
        semesters: semStats
      };
    });

    const backupData = {
      appId: "3146164e-781b-46fe-a221-468d2f1b3389",
      appName: "Phần mềm Phân công giảng dạy & Chủ nhiệm THPT",
      schoolName: schoolInfo.schoolName || "TRƯỜNG THPT NGUYỄN BỈNH KHIÊM",
      backupType: "FULL_ALL_ACADEMIC_YEARS",
      timestamp: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString('vi-VN'),
      version: "2.0",
      totalAcademicYears: availableYears.length,
      availableYears: availableYears,
      currentAcademicYear: currentAcademicYear,
      currentSemester: currentSemester,
      lockedYears: lockedYears,
      totalTeachersCount: teachers.length,
      yearsSummary: backupYearsSummary,
      localStorageData: backupObj
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
    a.download = `sao_luu_tat_ca_nam_hoc_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showTermNotification(`Đã xuất tệp sao lưu toàn bộ ${availableYears.length} năm học thành công!`);
  };

  // Sao lưu riêng năm học hiện tại
  const handleBackupCurrentYear = () => {
    // 1. Đồng bộ cưỡng bức dữ liệu đang chỉnh sửa của năm hiện tại vào localStorage
    const termAssignKey = `edu_term_assignments_${currentTermKey}`;
    localStorage.setItem(termAssignKey, JSON.stringify(assignments));
    localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(classSubjectPeriods));
    localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(classes));
    localStorage.setItem(`edu_term_school_info_${currentTermKey}`, JSON.stringify(schoolInfo));
    localStorage.setItem(`edu_term_meta_${currentTermKey}`, JSON.stringify({
      academicYear: currentAcademicYear,
      semester: currentSemester,
      updatedAt: new Date().toISOString()
    }));

    // 2. Thu thập các key thuộc năm học hiện tại
    const cleanYear = currentAcademicYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
    const backupObj: Record<string, string> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('edu_')) {
        if (
          key.includes(cleanYear) ||
          key === 'edu_teachers' ||
          key === 'edu_classes' ||
          key === 'edu_classes_v3' ||
          key === 'edu_subjects_config' ||
          key === 'edu_school_info_v1' ||
          key === 'edu_class_three_consecutive_v2'
        ) {
          const val = localStorage.getItem(key);
          if (val) {
            backupObj[key] = val;
          }
        }
      }
    }

    // Thống kê các học kỳ của năm hiện tại
    const semStats = AVAILABLE_SEMESTERS.map(sem => {
      const key = getTermStorageKey(currentAcademicYear, sem);
      const raw = localStorage.getItem(`edu_term_assignments_${key}`);
      let count = 0;
      if (raw) {
        try {
          const p = JSON.parse(raw);
          const subCount = Object.values(p.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
          const hrCount = Object.keys(p.homeroomAssignments || {}).length;
          count = subCount + hrCount;
        } catch (e) {}
      } else if (sem === currentSemester) {
        const subCount = Object.values(assignments.subjectAssignments || {}).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);
        const hrCount = Object.keys(assignments.homeroomAssignments || {}).length;
        count = subCount + hrCount;
      }
      return {
        semester: sem,
        storageKey: key,
        hasData: count > 0 || !!raw,
        assignmentsCount: count
      };
    });

    const backupData = {
      appId: "3146164e-781b-46fe-a221-468d2f1b3389",
      appName: "Phần mềm Phân công giảng dạy & Chủ nhiệm THPT",
      schoolName: schoolInfo.schoolName || "TRƯỜNG THPT NGUYỄN BỈNH KHIÊM",
      backupType: "SINGLE_ACADEMIC_YEAR",
      targetAcademicYear: currentAcademicYear,
      currentSemester: currentSemester,
      timestamp: new Date().toISOString(),
      dateFormatted: new Date().toLocaleString('vi-VN'),
      version: "2.0",
      isYearLocked: !!lockedYears[currentAcademicYear],
      semestersSummary: semStats,
      teachers: teachers,
      classes: classes,
      subjectsConfig: subjectsConfig,
      departments: departments,
      schoolInfo: schoolInfo,
      assignments: assignments,
      classSubjectPeriods: classSubjectPeriods,
      localStorageData: backupObj
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const safeYearStr = currentAcademicYear.replace(/[^0-9a-zA-Z]/g, '_').replace(/_+/g, '_');
    const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
    a.download = `sao_luu_nam_hoc_${safeYearStr}_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showTermNotification(`Đã xuất tệp sao lưu dữ liệu năm học ${currentAcademicYear} thành công!`);
  };

  // NÚT 2: [💾 XUẤT FILE SAO LƯU (.JSON)] - Tải toàn bộ dữ liệu (101 GV, 44 lớp, phân công, TKB) về máy tính
  const handleExportAllBackupJson = () => {
    try {
      const currentTimetable = (() => {
        try {
          const s = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
          return s ? JSON.parse(s) : null;
        } catch { return null; }
      })();

      const cleanHomeroom = assignments.homeroomAssignments || {};
      const cleanSubject = assignments.subjectAssignments || {};
      const subCount = Object.values(cleanSubject).reduce((sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0);

      const backupData = {
        appId: "3146164e-781b-46fe-a221-468d2f1b3389",
        appName: "EduSchedule AI - Hệ thống Phân công & Thời khóa biểu",
        schoolInfo: {
          ...schoolInfo,
          schoolName: schoolInfo.schoolName || "TRƯỜNG THPT NGUYỄN BỈNH KHIÊM",
          departmentName: schoolInfo.departmentName || "SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG",
          schoolId: TARGET_SCHOOL_ID,
          logoId: "logo_nbk_an_giang_official_2026",
          logoUrl: "/logo_nbk.svg?v=3.0",
          logoType: "svg_vector_official",
          address: (schoolInfo as any).address || "Hoa Long 3, TT. An Châu, Châu Thành, An Giang"
        },
        exportDate: new Date().toISOString(),
        exportDateFormatted: new Date().toLocaleString('vi-VN'),
        termKey: currentTermKey,
        academicYear: currentAcademicYear,
        semester: currentSemester,
        summary: {
          totalTeachers: teachers.length,
          totalClasses: classes.length,
          totalHomeroomAssigned: Object.keys(cleanHomeroom).length,
          totalSubjectAssignments: subCount,
          hasTimetable: !!currentTimetable
        },
        teachers: teachers,
        classes: classes,
        subjects: subjectsConfig,
        departments: departments,
        assignments: {
          homeroomAssignments: cleanHomeroom,
          subjectAssignments: cleanSubject
        },
        schedules: currentTimetable,
        timetableData: currentTimetable,
        classSubjectPeriods: classSubjectPeriods,
        classShifts: classShifts
      };

      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
      a.download = `sao_luu_toan_bo_du_lieu_nbk_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showTermNotification(`💾 Đã xuất file sao lưu toàn bộ dữ liệu (101 GV, 44 lớp, phân công, TKB) thành công!`);
    } catch (err: any) {
      showTermNotification(`❌ Lỗi xuất file sao lưu: ${err.message || 'Không thể tạo file'}`);
    }
  };

  // Hàm hỗ trợ khôi phục dữ liệu cho 1 năm học cụ thể
  const restoreSingleYearData = (parsed: any, targetYear: string, sourceYear?: string) => {
    let dataMap: Record<string, any> = parsed.localStorageData || {};
    if (Object.keys(dataMap).length === 0 || !Object.keys(dataMap).some(k => k.startsWith('edu_'))) {
      if (Object.keys(parsed).some(k => k.startsWith('edu_'))) {
        dataMap = parsed;
      }
    }
    const srcYear = sourceYear || parsed.targetAcademicYear || parsed.academicYear || targetYear;
    
    const targetClean = targetYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
    const sourceClean = srcYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');

    // 1. Phục hồi danh sách giáo viên, môn học nếu có
    if (Array.isArray(parsed.teachers) && parsed.teachers.length > 0) {
      localStorage.setItem('edu_teachers', JSON.stringify(parsed.teachers));
    } else if (dataMap['edu_teachers']) {
      localStorage.setItem('edu_teachers', typeof dataMap['edu_teachers'] === 'string' ? dataMap['edu_teachers'] : JSON.stringify(dataMap['edu_teachers']));
    }

    if (Array.isArray(parsed.classes) && parsed.classes.length > 0) {
      localStorage.setItem('edu_classes', JSON.stringify(parsed.classes));
      localStorage.setItem('edu_classes_v3', JSON.stringify(parsed.classes));
    } else if (dataMap['edu_classes']) {
      localStorage.setItem('edu_classes', typeof dataMap['edu_classes'] === 'string' ? dataMap['edu_classes'] : JSON.stringify(dataMap['edu_classes']));
    }

    if (parsed.subjectsConfig && typeof parsed.subjectsConfig === 'object') {
      localStorage.setItem('edu_subjects_config', JSON.stringify(parsed.subjectsConfig));
    } else if (dataMap['edu_subjects_config']) {
      localStorage.setItem('edu_subjects_config', typeof dataMap['edu_subjects_config'] === 'string' ? dataMap['edu_subjects_config'] : JSON.stringify(dataMap['edu_subjects_config']));
    }

    // 2. Ghi các key term của targetYear từ dataMap
    let restoredAnyTermKey = false;
    Object.entries(dataMap).forEach(([k, val]) => {
      if (k.startsWith('edu_term_') && k.includes(sourceClean)) {
        const newKey = k.replace(sourceClean, targetClean);
        const strVal = typeof val === 'string' ? val : JSON.stringify(val);
        localStorage.setItem(newKey, strVal);
        restoredAnyTermKey = true;
      }
    });

    // Nếu không tìm thấy key term-specific có chứa sourceClean (hoặc tệp định dạng cũ)
    if (!restoredAnyTermKey) {
      const sem = parsed.currentSemester || currentSemester || 'Học kỳ I';
      const termKey = getTermStorageKey(targetYear, sem);
      
      const oldAssign = dataMap['edu_assignments_v3'] || dataMap['edu_assignments_v2'] || dataMap['edu_assignments'] || parsed.assignments;
      if (oldAssign) {
        localStorage.setItem(`edu_term_assignments_${termKey}`, typeof oldAssign === 'string' ? oldAssign : JSON.stringify(oldAssign));
        restoredAnyTermKey = true;
      }
      
      const oldPeriods = dataMap['edu_class_subject_periods_v2'] || dataMap['edu_class_subject_periods'] || dataMap['edu_class_periods'] || parsed.classSubjectPeriods;
      if (oldPeriods) {
        localStorage.setItem(`edu_term_class_periods_${termKey}`, typeof oldPeriods === 'string' ? oldPeriods : JSON.stringify(oldPeriods));
      }
      
      const oldClasses = dataMap['edu_classes_v3'] || dataMap['edu_classes'] || dataMap['edu_classes_v2'] || parsed.classes;
      if (oldClasses) {
        localStorage.setItem(`edu_term_classes_${termKey}`, typeof oldClasses === 'string' ? oldClasses : JSON.stringify(oldClasses));
      }
      
      const oldSchool = dataMap['edu_school_info_v1'] || dataMap['edu_school_info'] || parsed.schoolInfo;
      if (oldSchool) {
        localStorage.setItem(`edu_term_school_info_${termKey}`, typeof oldSchool === 'string' ? oldSchool : JSON.stringify(oldSchool));
      }
    }

    // 3. Nếu targetYear là năm hiện tại, đồng bộ active keys
    if (targetYear === currentAcademicYear) {
      const currentSemKey = getTermStorageKey(targetYear, currentSemester);
      const currAssign = localStorage.getItem(`edu_term_assignments_${currentSemKey}`);
      if (currAssign) {
        localStorage.setItem('edu_assignments_v3', currAssign);
      } else if (parsed.assignments) {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(parsed.assignments));
      }

      const currPeriods = localStorage.getItem(`edu_term_class_periods_${currentSemKey}`);
      if (currPeriods) {
        localStorage.setItem('edu_class_subject_periods_v2', currPeriods);
      } else if (parsed.classSubjectPeriods) {
        localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(parsed.classSubjectPeriods));
      }

      const currClasses = localStorage.getItem(`edu_term_classes_${currentSemKey}`);
      if (currClasses) {
        localStorage.setItem('edu_classes_v3', currClasses);
      } else if (parsed.classes) {
        localStorage.setItem('edu_classes_v3', JSON.stringify(parsed.classes));
      }

      const currSchool = localStorage.getItem(`edu_term_school_info_${currentSemKey}`);
      if (currSchool) {
        localStorage.setItem('edu_school_info_v1', currSchool);
      } else if (parsed.schoolInfo) {
        localStorage.setItem('edu_school_info_v1', JSON.stringify(parsed.schoolInfo));
      }
    }

    // 4. Đảm bảo targetYear có trong danh sách availableYears
    const rawAvail = localStorage.getItem('edu_available_years');
    let availList: string[] = [];
    try {
      availList = rawAvail ? JSON.parse(rawAvail) : [...availableYears];
    } catch (e) {
      availList = [...availableYears];
    }
    if (!availList.includes(targetYear)) {
      availList.push(targetYear);
      availList.sort();
      localStorage.setItem('edu_available_years', JSON.stringify(availList));
    }

    // 5. Cập nhật trạng thái khóa nếu có
    if (typeof parsed.isYearLocked === 'boolean') {
      const rawLocked = localStorage.getItem('edu_locked_years');
      let lockedMap: Record<string, boolean> = {};
      try {
        lockedMap = rawLocked ? JSON.parse(rawLocked) : { ...lockedYears };
      } catch (e) {
        lockedMap = { ...lockedYears };
      }
      lockedMap[targetYear] = parsed.isYearLocked;
      localStorage.setItem('edu_locked_years', JSON.stringify(lockedMap));
    }
  };

  const handleRestoreData = (file: File, scope: 'all' | 'current_year' = restoreScope) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        
        if (!parsed || typeof parsed !== 'object') {
          alert('Tệp sao lưu không hợp lệ. Vui lòng chọn đúng tệp JSON được tải về từ hệ thống.');
          return;
        }

        let dataMap: Record<string, any> = parsed.localStorageData || {};
        if (Object.keys(dataMap).length === 0 || !Object.keys(dataMap).some(k => k.startsWith('edu_'))) {
          if (Object.keys(parsed).some(k => k.startsWith('edu_'))) {
            dataMap = parsed;
          }
        }

        if (Object.keys(dataMap).length === 0) {
          alert('Không tìm thấy dữ liệu sao lưu hợp lệ (các khóa bắt đầu bằng "edu_") trong tệp tin. Vui lòng chọn đúng tệp JSON đã xuất từ hệ thống.');
          return;
        }
        
        // Trích xuất danh sách các năm học có trong tệp sao lưu
        let yearsInFile: string[] = [];
        if (Array.isArray(parsed.availableYears) && parsed.availableYears.length > 0) {
          yearsInFile = parsed.availableYears;
        } else if (parsed.targetAcademicYear) {
          yearsInFile = [parsed.targetAcademicYear];
        } else if (parsed.academicYear) {
          yearsInFile = [parsed.academicYear];
        } else if (dataMap['edu_available_years']) {
          try {
            yearsInFile = JSON.parse(dataMap['edu_available_years']);
          } catch (e) {}
        }
        
        if (yearsInFile.length === 0) {
          const foundYears = new Set<string>();
          Object.keys(dataMap).forEach(k => {
            if (k.startsWith('edu_term_assignments_')) {
              const termKey = k.replace('edu_term_assignments_', '');
              const parts = termKey.split('_');
              if (parts.length >= 2) {
                foundYears.add(`${parts[0]} – ${parts[1]}`);
              }
            }
          });
          yearsInFile = Array.from(foundYears);
        }

        if (scope === 'all') {
          // === PHỤC HỒI TẤT CẢ CÁC NĂM (MẶC ĐỊNH) ===
          const isSingleYearBackup = parsed.backupType === 'SINGLE_ACADEMIC_YEAR' && parsed.targetAcademicYear;
          
          if (isSingleYearBackup) {
            const targetYear = parsed.targetAcademicYear;
            const confirmRestore = confirm(
              `XÁC NHẬN KHÔI PHỤC DỮ LIỆU TỪ TỆP SAO LƯU:\n\n` +
              `• Tệp này là bản sao lưu của riêng năm học: ${targetYear}\n` +
              `• Hệ thống sẽ nạp dữ liệu của năm học ${targetYear} vào máy tính và giữ nguyên các năm học khác.\n\n` +
              `Bạn có chắc chắn muốn khôi phục không?`
            );
            if (!confirmRestore) return;
            restoreSingleYearData(parsed, targetYear);
            alert(`Khôi phục thành công dữ liệu năm học ${targetYear}! Hệ thống sẽ tự động tải lại.`);
            window.location.reload();
            return;
          }

          const yearsSummaryText = yearsInFile.length > 0
            ? `Gồm ${yearsInFile.length} năm học: ${yearsInFile.join(', ')}`
            : 'Bao gồm toàn bộ các năm học và dữ liệu phân công';

          const confirmRestore = confirm(
            `XÁC NHẬN PHỤC HỒI TOÀN BỘ CÁC NĂM HỌC (MẶC ĐỊNH):\n\n` +
            `• Tìm thấy dữ liệu trong tệp sao lưu:\n  ${yearsSummaryText}\n\n` +
            `• Thao tác này sẽ đồng bộ và khôi phục toàn bộ:\n` +
            `  - Danh sách giáo viên, lớp học, môn học\n` +
            `  - Bảng phân công giảng dạy & chủ nhiệm của TẤT CẢ các năm học\n\n` +
            `Bạn có chắc chắn muốn khôi phục dữ liệu không?`
          );
          
          if (confirmRestore) {
            // Xóa các dữ liệu edu_ cũ để tránh xung đột
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const key = localStorage.key(i);
              if (key && key.startsWith('edu_')) {
                localStorage.removeItem(key);
              }
            }

            // Ghi đè dữ liệu mới cho tất cả các năm học
            Object.entries(dataMap).forEach(([key, val]) => {
              if (key.startsWith('edu_')) {
                if (typeof val === 'string') {
                  localStorage.setItem(key, val);
                } else if (typeof val === 'object' && val !== null) {
                  localStorage.setItem(key, JSON.stringify(val));
                }
              }
            });

            // Đảm bảo cấu hình các năm học được ghi nhận đầy đủ
            if (Array.isArray(parsed.availableYears) && parsed.availableYears.length > 0) {
              localStorage.setItem('edu_available_years', JSON.stringify(parsed.availableYears));
            }
            const activeYear = parsed.currentAcademicYear || currentAcademicYear;
            const activeSem = parsed.currentSemester || currentSemester;
            
            localStorage.setItem('edu_current_academic_year', activeYear);
            localStorage.setItem('edu_current_semester', activeSem);
            
            if (parsed.lockedYears && typeof parsed.lockedYears === 'object') {
              localStorage.setItem('edu_locked_years', JSON.stringify(parsed.lockedYears));
            }

            // Đồng bộ ngược lại vào active keys cho học kỳ hiện tại vừa nạp
            const activeSemKey = getTermStorageKey(activeYear, activeSem);
            const restoredAssign = localStorage.getItem(`edu_term_assignments_${activeSemKey}`);
            if (restoredAssign) {
              localStorage.setItem('edu_assignments_v3', restoredAssign);
            }
            const restoredPeriods = localStorage.getItem(`edu_term_class_periods_${activeSemKey}`);
            if (restoredPeriods) {
              localStorage.setItem('edu_class_subject_periods_v2', restoredPeriods);
            }
            const restoredClasses = localStorage.getItem(`edu_term_classes_${activeSemKey}`);
            if (restoredClasses) {
              localStorage.setItem('edu_classes_v3', restoredClasses);
            }
            const restoredSchool = localStorage.getItem(`edu_term_school_info_${activeSemKey}`);
            if (restoredSchool) {
              localStorage.setItem('edu_school_info_v1', restoredSchool);
            }

            alert(`Khôi phục thành công toàn bộ dữ liệu của tất cả các năm học (${yearsInFile.length || 'đa'} năm học)! Hệ thống sẽ tự động tải lại.`);
            window.location.reload();
          }

        } else {
          // === CHỈ PHỤC HỒI NĂM HIỆN TẠI (currentAcademicYear) ===
          const cleanCurrentYear = currentAcademicYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
          let sourceYear = currentAcademicYear;
          let hasYearData = false;

          if (parsed.backupType === 'SINGLE_ACADEMIC_YEAR' && parsed.targetAcademicYear) {
            sourceYear = parsed.targetAcademicYear;
            hasYearData = true;
          } else {
            hasYearData = Object.keys(dataMap).some(k => k.includes(cleanCurrentYear));
          }

          if (!hasYearData && yearsInFile.length > 0 && !yearsInFile.includes(currentAcademicYear)) {
            const proceedDifferentYear = confirm(
              `⚠️ Chú ý: Tệp sao lưu không chứa năm học hiện tại "${currentAcademicYear}".\n\n` +
              `Các năm học có trong tệp sao lưu: ${yearsInFile.join(', ')}.\n\n` +
              `Bạn có muốn lấy dữ liệu của năm [${yearsInFile[0]}] để nạp vào năm hiện tại "${currentAcademicYear}" không?`
            );
            if (!proceedDifferentYear) return;
            sourceYear = yearsInFile[0];
          }

          if (isCurrentTermLocked) {
            const proceedLocked = confirm(
              `⚠️ Năm học ${currentAcademicYear} hiện đang được KHÓA bảo vệ.\n\n` +
              `Bạn có đồng ý mở khóa và tiến hành phục hồi dữ liệu từ tệp sao lưu không?`
            );
            if (!proceedLocked) return;
            const updatedLocked = { ...lockedYears, [currentAcademicYear]: false };
            localStorage.setItem('edu_locked_years', JSON.stringify(updatedLocked));
          }

          const confirmRestore = confirm(
            `XÁC NHẬN CHỈ PHỤC HỒI NĂM HIỆN TẠI:\n\n` +
            `• Năm học sẽ được cập nhật: ${currentAcademicYear}\n` +
            `• Dữ liệu lấy từ tệp: ${sourceYear}\n\n` +
            `• LƯU Ý QUAN TRỌNG: Toàn bộ dữ liệu của TẤT CẢ các năm học khác trên máy tính được GIỮ NGUYÊN HOÀN TOÀN, không bị xóa hay thay đổi.\n\n` +
            `Bạn có chắc chắn muốn phục hồi cho riêng năm học ${currentAcademicYear} không?`
          );

          if (!confirmRestore) return;

          restoreSingleYearData(parsed, currentAcademicYear, sourceYear);
          alert(`Khôi phục thành công dữ liệu năm học ${currentAcademicYear}! Dữ liệu các năm học khác được giữ nguyên vẹn.`);
          window.location.reload();
        }

      } catch (err) {
        console.error(err);
        alert('Lỗi khi đọc tệp tin sao lưu: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const totalHomeroomAssigned = useMemo(() => {
    return Object.keys(assignments.homeroomAssignments).filter(k => !!assignments.homeroomAssignments[k]).length;
  }, [assignments.homeroomAssignments]);

  const totalSubjectAssigned = useMemo(() => {
    return Object.values(assignments.subjectAssignments).reduce((sum, clsMap) => {
      return sum + Object.values(clsMap || {}).filter(tId => !!tId).length;
    }, 0);
  }, [assignments.subjectAssignments]);

  const handleClearAssignments = () => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để xóa phân công!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Không thể xóa phân công khi đang khóa.`);
      return;
    }
    setClearAssignmentOption('all');
    setIsClearAssignmentsModalOpen(true);
  };

  const handleExecuteClearAssignments = () => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bị từ chối: Bắt buộc quyền Quản trị viên để xóa phân công!');
      openLoginModal();
      return;
    }
    let updatedAssignments: Assignments = { ...assignments };
    if (clearAssignmentOption === 'all') {
      updatedAssignments = { homeroomAssignments: {}, subjectAssignments: {} };
    } else if (clearAssignmentOption === 'subject_only') {
      updatedAssignments = { ...assignments, subjectAssignments: {} };
    } else if (clearAssignmentOption === 'homeroom_only') {
      updatedAssignments = { ...assignments, homeroomAssignments: {} };
    }
    setAssignments(updatedAssignments);

    try {
      localStorage.setItem('edu_assignments_v3', JSON.stringify(updatedAssignments));
      localStorage.setItem('edu_assignments', JSON.stringify(updatedAssignments));
      localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignments));
    } catch {}

    scheduleAutoSave(undefined, updatedAssignments);

    // Khi xóa toàn bộ hoặc xóa phân công môn: Reset sạch ma trận TKB và phát sự kiện cập nhật
    if (clearAssignmentOption === 'all' || clearAssignmentOption === 'subject_only') {
      try {
        localStorage.removeItem(`edu_timetable_${currentTermKey}`);
        localStorage.removeItem('edu_timetable_active');
      } catch {}
      window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: null }));
    } else if (clearAssignmentOption === 'homeroom_only') {
      // Khi xóa phân công chủ nhiệm: Làm sạch GVCN ở tiết Chào cờ và Sinh hoạt lớp
      try {
        const raw = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lessons)) {
            parsed.lessons = parsed.lessons.map((l: any) => {
              if (l.subject === 'Chào cờ' || l.subject === 'Sinh hoạt lớp') {
                return { ...l, teacherId: '', teacherName: 'GVCN' };
              }
              return l;
            });
            localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(parsed));
            localStorage.setItem('edu_timetable_active', JSON.stringify(parsed));
            window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: parsed }));
          }
        }
      } catch {}
    }

    setIsClearAssignmentsModalOpen(false);
    showTermNotification('Đã xóa dữ liệu phân công thành công và đồng bộ hệ thống.');
  };

  // AI Actions: Phân công tự động với phân tách ràng buộc cứng và mềm
  const handleAiOptimize = async (customOptions?: Partial<AutoAssignOptions>) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để chạy phân công tự động AI!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Không thể thực hiện AI phân công khi đang khóa.`);
      return;
    }
    setIsAiOptimizeModalOpen(false);
    setIsAiOptimizing(true);

    const mergedOptions: AutoAssignOptions = {
      optPrioritizeNormalTeachers,
      optStrictQuota,
      optLimitGrades,
      optBalanceWorkload,
      mode: aiOptimizeMode,
      ...customOptions
    };

    try {
      // BƯỚC 1: Quét sạch dữ liệu phân công cũ của các môn 0 tiết trước khi chạy AI
      const { cleaned: preCleaned } = cleanAssignmentsForZeroPeriodSubjects(assignments.subjectAssignments, { notify: false });
      const currentCleanedAssignments = {
        ...assignments,
        subjectAssignments: preCleaned
      };

      // BƯỚC 2: Yêu cầu phân công chỉ lấy các môn có số tiết khai báo > 0 (bỏ qua mọi môn 0 tiết)
      const subjectReqs = classes.map(c => {
        const summary = getClassDeclaredSummary(c.id, c.grade);
        return {
          classId: c.id,
          className: c.name,
          grade: c.grade,
          subjects: summary.subjects
            .filter((s: any) => !s.isRemoved && s.totalPeriods > 0)
            .map((s: any) => ({ name: s.id, periods: s.totalPeriods }))
        };
      });

      // BƯỚC 3: Giải thuật phân công tự động với phân tách Ràng buộc cứng và Ràng buộc mềm
      const data = autoAssignSchedules(teachers, classes, subjectReqs, currentCleanedAssignments, mergedOptions);

      // BƯỚC 4: Hậu kiểm tra quét sạch toàn bộ 44 lớp sau khi xếp
      const { cleaned: postCleaned } = cleanAssignmentsForZeroPeriodSubjects(data.subjectAssignments, { notify: false });
      data.subjectAssignments = postCleaned;

      const selectedMode = mergedOptions.mode || 'all';
      if (selectedMode === 'manual_and_auto') {
        if (data.homeroomAssignments && data.subjectAssignments) {
          setAssignments({
            homeroomAssignments: data.homeroomAssignments,
            subjectAssignments: data.subjectAssignments
          });
        }
      } else if (selectedMode === 'teaching_only') {
        if (data.subjectAssignments) {
          setAssignments(prev => ({
            ...prev,
            subjectAssignments: data.subjectAssignments
          }));
        }
      } else if (selectedMode === 'homeroom_only') {
        if (data.homeroomAssignments) {
          setAssignments(prev => ({
            ...prev,
            homeroomAssignments: data.homeroomAssignments
          }));
        }
      } else {
        if (data.homeroomAssignments && data.subjectAssignments) {
          setAssignments({
            homeroomAssignments: data.homeroomAssignments,
            subjectAssignments: data.subjectAssignments
          });
        }
      }

      setAiExplanation(data.explanation || 'Đã phân công tự động thành công theo đúng các nguyên tắc chuyên môn!');
      setShowAutoAssignNotice(true);
      setIsAutoAssignNoticeExpanded(false);

      // BƯỚC 4 (BÁO CÁO Ô TRỐNG): Nếu còn các ô trống chưa có GV nhận do bật optStrictQuota
      if (data.unassignedSlots && data.unassignedSlots.length > 0) {
        setUnassignedReport(data.unassignedSlots);
      } else {
        setUnassignedReport(null);
      }
      
      // Thêm thông điệp vào bảng chat AI
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: data.explanation,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (error: any) {
      console.error('Lỗi khi phân công tự động:', error);
      const { cleaned: preCleaned } = cleanAssignmentsForZeroPeriodSubjects(assignments.subjectAssignments, { notify: false });
      const currentCleanedAssignments = {
        ...assignments,
        subjectAssignments: preCleaned
      };
      const subjectReqs = classes.map(c => {
        const summary = getClassDeclaredSummary(c.id, c.grade);
        return {
          classId: c.id,
          className: c.name,
          grade: c.grade,
          subjects: summary.subjects
            .filter((s: any) => !s.isRemoved && s.totalPeriods > 0)
            .map((s: any) => ({ name: s.id, periods: s.totalPeriods }))
        };
      });
      const fallback = autoAssignSchedules(teachers, classes, subjectReqs, currentCleanedAssignments, mergedOptions);
      if (fallback && fallback.subjectAssignments) {
        const { cleaned: fallbackCleaned } = cleanAssignmentsForZeroPeriodSubjects(fallback.subjectAssignments, { notify: false });
        fallback.subjectAssignments = fallbackCleaned;
      }
      if (mergedOptions.mode === 'teaching_only') {
        setAssignments(prev => ({ ...prev, subjectAssignments: fallback.subjectAssignments }));
      } else if (mergedOptions.mode === 'homeroom_only') {
        setAssignments(prev => ({ ...prev, homeroomAssignments: fallback.homeroomAssignments }));
      } else {
        setAssignments({ homeroomAssignments: fallback.homeroomAssignments, subjectAssignments: fallback.subjectAssignments });
      }
      setAiExplanation(fallback.explanation);
      setShowAutoAssignNotice(true);
      setIsAutoAssignNoticeExpanded(false);
      if (fallback.unassignedSlots && fallback.unassignedSlots.length > 0) {
        setUnassignedReport(fallback.unassignedSlots);
      } else {
        setUnassignedReport(null);
      }
    } finally {
      setIsAiOptimizing(false);
    }
  };

  const handleSendChatMessage = async (msgText?: string) => {
    const textToSend = msgText || chatInput;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (!msgText) setChatInput('');
    setIsAiChatLoading(true);

    const lower = textToSend.toLowerCase().trim();

    // =========================================================================
    // CƠ CHẾ TRA CỨU HYBRID: ƯU TIÊN TRUY VẤN LOCAL STATE TRỰC TIẾP (TỨC THÌ 0.01s)
    // =========================================================================

    // 1. Rà soát tiết thiếu / Các lớp và môn học chưa có giáo viên
    const isMissingPeriodsQuery = 
      lower.includes('thiếu') || 
      lower.includes('chưa có giáo viên') || 
      lower.includes('chưa có gv') || 
      lower.includes('chưa phân công') || 
      lower.includes('chưa đủ') || 
      lower.includes('còn trống') || 
      lower.includes('chưa gán') || 
      lower.includes('rà soát tiết');

    if (isMissingPeriodsQuery) {
      const missingList: { className: string; subject: string; hours: number }[] = [];
      classes.forEach(cls => {
        const classHours = lessonHoursMap[cls.id] || {};
        Object.entries(classHours).forEach(([subCode, hours]) => {
          const lessonCount = Number(hours) || 0;
          // Nếu môn có số tiết > 0 mà chưa gán giáo viên
          const assignedTeacherId = 
            assignments.subjectAssignments?.[cls.id]?.[subCode] || 
            (assignments as any)[cls.id]?.[subCode];
          if (lessonCount > 0 && !assignedTeacherId) {
            const subObj = SUBJECTS.find(s => s.id === subCode);
            const subName = subObj?.name || subCode;
            missingList.push({ className: cls.name, subject: subName, hours: lessonCount });
          }
        });
      });

      // Tạo câu trả lời ngay lập tức:
      let reply = '';
      if (missingList.length === 0) {
        reply = '✅ Toàn bộ 44 lớp đã được phân công đầy đủ, không còn môn nào thiếu giáo viên!';
      } else {
        const totalMissingHours = missingList.reduce((sum, item) => sum + item.hours, 0);
        reply = `⚠️ Phát hiện ${missingList.length} vị trí chưa phân công giáo viên (Tổng thiếu: ${totalMissingHours} tiết):\n\n`;
        missingList.slice(0, 15).forEach(item => {
          reply += `• Lớp ${item.className} - Môn ${item.subject}: thiếu ${item.hours} tiết\n`;
        });
        if (missingList.length > 15) {
          reply += `\n... và còn ${missingList.length - 15} môn khác.`;
        }
        reply += `\n\n💡 Thầy/Cô có thể bấm nút "AI phân công" để hệ thống tự động điền các tiết còn trống này!`;
      }

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiChatLoading(false);
      return;
    }

    // 2. Kiểm tra danh sách giáo viên dạy vượt định mức / thừa giờ
    const isOverloadQuery = 
      lower.includes('vượt định mức') || 
      lower.includes('thừa giờ') || 
      lower.includes('dạy quá tiết') || 
      lower.includes('quá tải') || 
      lower.includes('vượt trần') || 
      lower.includes('vượt quota') || 
      lower.includes('quá định mức') ||
      (lower.includes('vượt') && lower.includes('tiết'));

    if (isOverloadQuery) {
      const overloadedTeachers = teachers
        .map(t => {
          const stats = teacherStatsMap[t.id];
          const total = stats ? stats.totalPeriods : 0;
          const quota = stats ? stats.maxQuota : (t.maxPeriods || 17);
          const excess = stats ? stats.excessPeriods : Math.max(0, total - quota);
          return {
            teacher: t,
            total,
            quota,
            excess,
            isOverloaded: total > quota
          };
        })
        .filter(item => item.isOverloaded);

      let reply = '';
      if (overloadedTeachers.length === 0) {
        reply = '✅ Tất cả giáo viên đều trong định mức quy định.\n\nToàn bộ thầy cô trong trường hiện tại đều có số tiết dạy trong giới hạn định mức, không có ai bị dạy quá tải hoặc thừa giờ.';
      } else {
        const lines = overloadedTeachers
          .sort((a, b) => b.excess - a.excess)
          .map(item => `• Thầy/Cô ${item.teacher.name} (${item.teacher.specialization || 'Bộ môn'}): ${item.total}/${item.quota} tiết (Thừa ${item.excess} tiết)`);
        
        reply = `📋 Danh sách GV vượt định mức (${overloadedTeachers.length} Thầy/Cô):\n\n${lines.join('\n')}\n\n💡 Lời khuyên: Thầy/Cô có thể bấm nút "AI phân công" và chọn ràng buộc "Không phân công vượt trần định mức" để hệ thống tự động tái cân bằng tiết dạy.`;
      }

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiChatLoading(false);
      return;
    }

    // 3. Kiểm tra xung đột & cảnh báo phân công
    const isConflictQuery = 
      lower.includes('xung đột') || 
      lower.includes('lỗi phân công') || 
      lower.includes('vi phạm') || 
      lower.includes('cảnh báo') ||
      (lower.includes('kiểm tra') && (lower.includes('lỗi') || lower.includes('phân công')));

    if (isConflictQuery) {
      const conflictList: string[] = [];
      teachers.forEach(t => {
        const stats = teacherStatsMap[t.id];
        if (stats && stats.warnings && stats.warnings.length > 0) {
          stats.warnings.forEach(w => {
            conflictList.push(`• Thầy/Cô ${t.name} (${t.specialization}): ${w}`);
          });
        }
      });

      // Kiểm tra lớp chưa có GVCN
      classes.forEach(c => {
        if (!assignments.homeroomAssignments[c.id]) {
          conflictList.push(`• Lớp ${c.name}: Chưa có Giáo viên Chủ nhiệm.`);
        }
      });

      let reply = '';
      if (conflictList.length === 0) {
        reply = '✅ Hoàn hảo! Không phát hiện bất kỳ xung đột nào trong bảng phân công hiện tại.\n\n• 100% lớp học đã có GVCN hợp lệ.\n• Không có giáo viên nào dạy quá 2 khối.\n• Phân công đúng 100% môn chuyên môn được đào tạo.\n• Tất cả định mức giờ dạy được phân bổ đúng quy chế.';
      } else {
        reply = `🔍 Kết quả kiểm tra xung đột phân công (Phát hiện ${conflictList.length} vấn đề):\n\n${conflictList.slice(0, 15).join('\n')}${conflictList.length > 15 ? `\n... và ${conflictList.length - 15} cảnh báo khác.` : ''}\n\n💡 Nhấp trực tiếp vào các ô tương ứng trên lưới phân công để điều chỉnh giáo viên!`;
      }

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiChatLoading(false);
      return;
    }

    // 4. Xem tải dạy theo tổ bộ môn
    const isDepartmentLoadQuery = 
      lower.includes('tổ bộ môn') || 
      lower.includes('tải dạy') || 
      lower.includes('tổ toán') || 
      lower.includes('tổ văn') || 
      lower.includes('tổ anh') || 
      lower.includes('phân bổ tải');

    if (isDepartmentLoadQuery) {
      const deptMap: Record<string, { teachers: string[]; totalHours: number; totalQuota: number }> = {};
      teachers.forEach(t => {
        const dept = t.specialization || 'Khác';
        if (!deptMap[dept]) deptMap[dept] = { teachers: [], totalHours: 0, totalQuota: 0 };
        const stats = teacherStatsMap[t.id];
        const h = stats ? stats.totalPeriods : 0;
        const q = stats ? stats.maxQuota : (t.maxPeriods || 17);
        deptMap[dept].teachers.push(`${t.name}: ${h}/${q}t`);
        deptMap[dept].totalHours += h;
        deptMap[dept].totalQuota += q;
      });

      const summary = Object.entries(deptMap)
        .slice(0, 8)
        .map(([dept, d]) => `• Tổ ${dept} (${d.teachers.length} GV): Đã phân ${d.totalHours}/${d.totalQuota} tiết (${d.totalQuota > 0 ? Math.round(d.totalHours * 100 / d.totalQuota) : 0}% định mức)`)
        .join('\n');

      const reply = `⚖️ Thống kê tải giảng dạy theo Tổ bộ môn:\n\n${summary}\n\n💡 Chi tiết phân bổ tiết từng giáo viên có thể tra cứu nhanh tại tab "Giáo viên".`;

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiChatLoading(false);
      return;
    }

    // 5. Rà soát danh sách chủ nhiệm
    const isHomeroomQuery = 
      lower.includes('chủ nhiệm') || 
      lower.includes('gvcn');

    if (isHomeroomQuery) {
      const hrAssignedCount = Object.values(assignments.homeroomAssignments).filter(Boolean).length;
      const bghHomerooms: string[] = [];
      teachers.forEach(t => {
        if (t.position === 'Hiệu trưởng' || t.position === 'Phó Hiệu trưởng') {
          const stats = teacherStatsMap[t.id];
          if (stats && stats.isHomeroom) {
            bghHomerooms.push(`${t.position} ${t.name} (Lớp ${stats.homeroomClass})`);
          }
        }
      });

      let reply = `🎓 Rà soát danh sách Giáo viên Chủ nhiệm:\n\n• Tiến độ phân công: ${hrAssignedCount}/${classes.length} Lớp đã có GVCN.`;
      if (bghHomerooms.length > 0) {
        reply += `\n⚠️ Cảnh báo quy chế: Có BGH đang kiêm nhiệm chủ nhiệm:\n${bghHomerooms.map(b => `  - ${b}`).join('\n')}`;
      } else {
        reply += `\n✅ Đúng quy chế 100%: Ban Giám Hiệu không làm GVCN.`;
      }
      reply += `\n\n💡 Bạn có thể bấm nút "AI phân công" để hệ thống tự động tối ưu hóa việc phân công chủ nhiệm theo thâm niên và chuyên môn.`;

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsAiChatLoading(false);
      return;
    }

    // =========================================================================
    // CÁC CÂU HỎI TỔNG QUÁT KHÁC: GỌI GEMINI API VỚI CONTEXT SUMMARY & TIMEOUT 30s
    // =========================================================================
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000); // 30 giây timeout

    try {
      const contextSummary = {
        schoolStats: {
          totalClasses: classes.length,
          totalTeachers: teachers.length,
          timetableStatus: activeTimetableData?.lessons?.length 
            ? `Đã xếp ${activeTimetableData.lessons.length} tiết (100%)` 
            : 'Chưa tạo TKB'
        },
        teacherSummary: teachers.map(t => {
          const stats = teacherStatsMap[t.id];
          return {
            name: t.name,
            subject: t.specialization || (t as any).subject || '',
            quota: stats ? stats.maxQuota : (t.maxPeriods || 17),
            assignedPeriods: stats ? stats.totalPeriods : 0,
            classes: stats?.assignedClasses ? stats.assignedClasses.map((ac: any) => `${ac.className} (${ac.subjectName})`).slice(0, 4) : []
          };
        })
      };

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: textToSend,
          contextSummary
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Lỗi máy chủ HTTP ${response.status}`);
      }
      const data = await response.json();

      const assistantMsg: ChatMessage = {
        sender: 'assistant',
        text: data.reply || 'Đã nhận được thông tin.',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        suggestedChanges: data.suggestedChanges
      };

      setChatMessages(prev => [...prev, assistantMsg]);
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('Lỗi khi gọi Trợ lý AI:', error);

      let errorNotice = 'Thời gian phản hồi quá lâu hoặc mất kết nối mạng.';
      if (error?.name === 'AbortError') {
        errorNotice = 'Quá thời gian chờ phản hồi từ máy chủ (30s).';
      } else if (error?.message) {
        errorNotice = error.message;
      }

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: `⚠️ **Không thể kết nối đến Trợ lý AI:**\n${errorNotice}\n\n💡 Bạn có thể bấm các nút tra cứu nhanh hoặc hỏi các câu hỏi trực tiếp để nhận kết quả tức thì không cần mạng!`,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      clearTimeout(timeoutId);
      setIsAiChatLoading(false);
    }
  };

  const handleApplySuggestedChanges = (suggestedChanges: any) => {
    if (!suggestedChanges) return;
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để áp dụng thay đổi!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Không thể thay đổi khi đang khóa.`);
      return;
    }
    
    setAssignments(prev => {
      const updatedHomeroom = { ...prev.homeroomAssignments };
      const updatedSubjects = { ...prev.subjectAssignments };

      if (suggestedChanges.homeroomAssignments) {
        Object.entries(suggestedChanges.homeroomAssignments).forEach(([classId, teacherId]) => {
          updatedHomeroom[classId] = teacherId as string;
        });
      }

      if (suggestedChanges.subjectAssignments) {
        Object.entries(suggestedChanges.subjectAssignments).forEach(([classId, subMap]: [string, any]) => {
          if (!updatedSubjects[classId]) updatedSubjects[classId] = {};
          Object.entries(subMap).forEach(([subId, teacherId]) => {
            updatedSubjects[classId][subId] = teacherId as string;
          });
        });
      }

      return {
        homeroomAssignments: updatedHomeroom,
        subjectAssignments: updatedSubjects
      };
    });

    alert('Đã áp dụng đề xuất thay đổi của AI vào bảng phân công!');
  };

  // Assign Handlers
  const handleSelectSubjectTeacher = (teacherId: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để phân công môn học!');
      openLoginModal();
      setSelectedCell(null);
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
      setSelectedCell(null);
      return;
    }
    if (!selectedCell) return;
    const { classId, subject } = selectedCell;

    setAssignments(prev => {
      const prevClassRow = prev.subjectAssignments?.[classId] || {};
      const nextClassRow = { ...prevClassRow };
      const norm = normalizeSubjectName(subject);
      
      if (teacherId === '') {
        delete nextClassRow[subject];
        if (norm) delete nextClassRow[norm];
        if (norm === 'GDQPAN') {
          delete nextClassRow['GDQPAN'];
          delete nextClassRow['GD QP-AN'];
          delete nextClassRow['GDQP'];
        }
      } else {
        nextClassRow[subject] = teacherId;
        if (norm) nextClassRow[norm] = teacherId;
        if (norm === 'GDQPAN') {
          nextClassRow['GDQPAN'] = teacherId;
          nextClassRow['GD QP-AN'] = teacherId;
        }
      }

      const cleanId = classId.replace(/^c_/, '');
      const prefixedId = 'c_' + cleanId;
      const targetCls = classes.find(c => c.id === classId || c.id === cleanId || c.name === cleanId);

      const nextSubjects = {
        ...prev.subjectAssignments,
        [classId]: nextClassRow,
        [cleanId]: nextClassRow,
        [prefixedId]: nextClassRow,
        ...(targetCls?.name ? { [targetCls.name]: nextClassRow } : {})
      };

      const updatedAssignments: Assignments = {
        ...prev,
        subjectAssignments: nextSubjects
      };

      try {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(updatedAssignments));
        localStorage.setItem('edu_assignments', JSON.stringify(updatedAssignments));
        localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignments));
      } catch {}

      scheduleAutoSave(undefined, updatedAssignments);

      // Cập nhật ma trận TKB thực thời: nếu đổi giáo viên thì đổi ngay trên TKB, nếu xóa phân công thì gỡ tiết
      try {
        const raw = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lessons)) {
            const teacherObj = teachers.find(t => t.id === teacherId);
            const teacherName = teacherObj?.name || 'Giáo viên';
            let changed = false;

            const updatedLessons: any[] = [];
            for (const l of parsed.lessons) {
              const matchesClass = l.classId === classId || l.classId === cleanId || l.classId === prefixedId || (targetCls && (l.classId === targetCls.id || l.className === targetCls.name));
              const matchesSub = l.subject === subject || normalizeSubjectName(l.subject) === norm;

              if (matchesClass && matchesSub) {
                changed = true;
                if (!teacherId) {
                  // Đã xóa phân công môn này: gỡ tiết khỏi ma trận TKB
                  continue;
                } else {
                  // Đổi giáo viên: cập nhật giáo viên mới vào tiết học trên TKB
                  updatedLessons.push({
                    ...l,
                    teacherId,
                    teacherName
                  });
                }
              } else {
                updatedLessons.push(l);
              }
            }

            if (changed) {
              const newTimetable = { ...parsed, lessons: updatedLessons };
              localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(newTimetable));
              localStorage.setItem('edu_timetable_active', JSON.stringify(newTimetable));
              window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: newTimetable }));
            }
          }
        }
      } catch (err) {
        console.warn('Reconcile timetable on subject assign error:', err);
      }

      return updatedAssignments;
    });

    setSelectedCell(null);
  };

  const handleSelectHomeroomTeacher = (teacherId: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để phân công giáo viên chủ nhiệm!');
      openLoginModal();
      setSelectedHomeroomCell(null);
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
      setSelectedHomeroomCell(null);
      return;
    }
    if (!selectedHomeroomCell) return;
    const { classId } = selectedHomeroomCell;
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetCls = classes.find(c => c.id === classId || c.id === cleanId || c.name === cleanId);

    // 1. Đồng bộ 2 chiều vào mảng classes (State, LocalStorage & Firestore)
    setClasses(prev => {
      const nextClasses = prev.map(c => {
        const isTarget = c.id === classId || c.id === cleanId || c.id === prefixedId || (targetCls && c.name === targetCls.name);
        if (isTarget) {
          return { ...c, homeroomTeacherId: teacherId || undefined };
        }
        if (teacherId && c.homeroomTeacherId === teacherId) {
          return { ...c, homeroomTeacherId: undefined };
        }
        return c;
      });
      try {
        localStorage.setItem('edu_classes_v3', JSON.stringify(nextClasses));
        localStorage.setItem('edu_classes', JSON.stringify(nextClasses));
        localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(nextClasses));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
        if (SCHOOL_DOC_REF) {
          setDoc(SCHOOL_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch (err) {}
      return nextClasses;
    });

    // 2. Đồng bộ vào bảng phân công (Chủ nhiệm & Môn chuyên môn của GVCN)
    setAssignments(prev => {
      const nextHomerooms = { ...prev.homeroomAssignments };
      const nextSubjects = { ...prev.subjectAssignments };

      if (teacherId === '') {
        delete nextHomerooms[classId];
        delete nextHomerooms[cleanId];
        delete nextHomerooms[prefixedId];
        if (targetCls?.name) delete nextHomerooms[targetCls.name];
      } else {
        // Warn if this teacher is already homeroom elsewhere
        const conflictClass = Object.entries(nextHomerooms).find(([cId, tId]) => tId === teacherId && cId !== classId && cId !== cleanId && cId !== prefixedId);
        if (conflictClass) {
          const otherClass = classes.find(c => c.id === conflictClass[0]);
          if (otherClass && !confirm(`Giáo viên này đang chủ nhiệm lớp ${otherClass.name}. Bạn vẫn muốn đổi sang lớp này chứ?`)) {
            return prev;
          }
          delete nextHomerooms[conflictClass[0]];
        }
        nextHomerooms[classId] = teacherId;
        nextHomerooms[cleanId] = teacherId;
        nextHomerooms[prefixedId] = teacherId;
        if (targetCls?.name) nextHomerooms[targetCls.name] = teacherId;

        // Tự động gán môn chuyên môn của GVCN mới cho lớp nếu lớp có học môn này
        const targetTeacher = teachers.find(t => t.id === teacherId);
        if (targetTeacher && targetCls) {
          const teacherSpec = resolveTeacherSubject(targetTeacher, SUBJECTS);
          const specPeriod = getSubjectPeriod(teacherSpec, targetCls.grade, targetCls.id);
          if (specPeriod > 0) {
            const prevClassRow = nextSubjects[classId] || {};
            const nextClassRow = { ...prevClassRow };
            const norm = normalizeSubjectName(teacherSpec);
            nextClassRow[teacherSpec] = teacherId;
            if (norm) nextClassRow[norm] = teacherId;
            if (norm === 'GDQPAN') {
              nextClassRow['GDQPAN'] = teacherId;
              nextClassRow['GD QP-AN'] = teacherId;
            }
            nextSubjects[classId] = nextClassRow;
            nextSubjects[cleanId] = nextClassRow;
            nextSubjects[prefixedId] = nextClassRow;
            if (targetCls.name) nextSubjects[targetCls.name] = nextClassRow;
          }
        }
      }

      const updatedAssignments: Assignments = {
        homeroomAssignments: nextHomerooms,
        subjectAssignments: nextSubjects
      };

      try {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(updatedAssignments));
        localStorage.setItem('edu_assignments', JSON.stringify(updatedAssignments));
        localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignments));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            assignments: updatedAssignments,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch {}

      scheduleAutoSave(undefined, updatedAssignments);

      // 3. Cập nhật customFixedSlots cho các tiết gắn với GVCN
      try {
        const customKey = `edu_custom_fixed_slots_${currentTermKey}`;
        const rawCustom = localStorage.getItem(customKey);
        if (rawCustom) {
          const parsedCustom = JSON.parse(rawCustom);
          if (Array.isArray(parsedCustom)) {
            const updatedCustom = parsedCustom.map((s: any) => {
              const matchesClass = s.classId === classId || s.classId === cleanId || s.classId === prefixedId || (targetCls && (s.classId === targetCls.id || s.className === targetCls.name));
              if (matchesClass && (s.subject === 'Chào cờ' || s.subject === 'Sinh hoạt lớp' || s.subject === 'TNHN2')) {
                return { ...s, teacherId: teacherId || '' };
              }
              return s;
            });
            localStorage.setItem(customKey, JSON.stringify(updatedCustom));
            window.dispatchEvent(new CustomEvent('edu_custom_fixed_slots_updated', { detail: updatedCustom }));
          }
        }
      } catch (err) {}

      // 4. Cập nhật ma trận TKB thực thời cho tiết Chào cờ & Sinh hoạt lớp
      try {
        const raw = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lessons)) {
            const teacherObj = teachers.find(t => t.id === teacherId);
            const teacherName = teacherObj?.name || (teacherId ? 'GVCN' : '');
            let changed = false;

            const updatedLessons = parsed.lessons.map((l: any) => {
              const matchesClass = l.classId === classId || l.classId === cleanId || l.classId === prefixedId || (targetCls && (l.classId === targetCls.id || l.className === targetCls.name));
              const isHomeroomSubject = l.subject === 'Chào cờ' || l.subject === 'Sinh hoạt lớp' || l.subject === 'TNHN2';
              if (matchesClass && isHomeroomSubject) {
                changed = true;
                return {
                  ...l,
                  teacherId: teacherId || '',
                  teacherName: teacherName || 'GVCN'
                };
              }
              return l;
            });

            if (changed) {
              const newTimetable = { ...parsed, lessons: updatedLessons };
              localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(newTimetable));
              localStorage.setItem('edu_timetable_active', JSON.stringify(newTimetable));
              window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: newTimetable }));
            }
          }
        }
      } catch (err) {
        console.warn('Reconcile timetable on homeroom assign error:', err);
      }

      return updatedAssignments;
    });

    setSelectedHomeroomCell(null);
  };

  // Hàm gán đồng thời GVCN và Môn chuyên môn của GVCN cho lớp học
  const handleSelectHomeroomAndSubject = (classId: string, teacherId: string, subjectName: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để phân công!');
      openLoginModal();
      setSelectedHomeroomCell(null);
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ.`);
      setSelectedHomeroomCell(null);
      return;
    }

    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetCls = classes.find(c => c.id === classId || c.id === cleanId || c.name === cleanId);

    // 1. Đồng bộ 2 chiều vào mảng classes (State, LocalStorage & Firestore)
    setClasses(prev => {
      const nextClasses = prev.map(c => {
        const isTarget = c.id === classId || c.id === cleanId || c.id === prefixedId || (targetCls && c.name === targetCls.name);
        if (isTarget) {
          return { ...c, homeroomTeacherId: teacherId || undefined };
        }
        if (teacherId && c.homeroomTeacherId === teacherId) {
          return { ...c, homeroomTeacherId: undefined };
        }
        return c;
      });
      try {
        localStorage.setItem('edu_classes_v3', JSON.stringify(nextClasses));
        localStorage.setItem('edu_classes', JSON.stringify(nextClasses));
        localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(nextClasses));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
        if (SCHOOL_DOC_REF) {
          setDoc(SCHOOL_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch (err) {}
      return nextClasses;
    });

    setAssignments(prev => {
      const nextH = { ...prev.homeroomAssignments };
      const nextS = { ...prev.subjectAssignments };

      // 1. Cập nhật phân công chủ nhiệm
      if (!teacherId) {
        delete nextH[classId];
        delete nextH[cleanId];
        delete nextH[prefixedId];
        if (targetCls?.name) delete nextH[targetCls.name];
      } else {
        nextH[classId] = teacherId;
        nextH[cleanId] = teacherId;
        nextH[prefixedId] = teacherId;
        if (targetCls?.name) nextH[targetCls.name] = teacherId;
      }

      // 2. Cập nhật phân công môn chuyên môn
      if (subjectName && teacherId) {
        const prevClassRow = nextS[classId] || {};
        const nextClassRow = { ...prevClassRow };
        const norm = normalizeSubjectName(subjectName);
        nextClassRow[subjectName] = teacherId;
        if (norm) nextClassRow[norm] = teacherId;
        if (norm === 'GDQPAN') {
          nextClassRow['GDQPAN'] = teacherId;
          nextClassRow['GD QP-AN'] = teacherId;
        }
        nextS[classId] = nextClassRow;
        nextS[cleanId] = nextClassRow;
        nextS[prefixedId] = nextClassRow;
        if (targetCls?.name) nextS[targetCls.name] = nextClassRow;
      }

      const updatedAssignments: Assignments = {
        homeroomAssignments: nextH,
        subjectAssignments: nextS
      };

      try {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(updatedAssignments));
        localStorage.setItem('edu_assignments', JSON.stringify(updatedAssignments));
        localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignments));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            assignments: updatedAssignments,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch (err) {}

      scheduleAutoSave(undefined, updatedAssignments);

      // Cập nhật customFixedSlots cho các tiết gắn với GVCN
      try {
        const customKey = `edu_custom_fixed_slots_${currentTermKey}`;
        const rawCustom = localStorage.getItem(customKey);
        if (rawCustom) {
          const parsedCustom = JSON.parse(rawCustom);
          if (Array.isArray(parsedCustom)) {
            const updatedCustom = parsedCustom.map((s: any) => {
              const matchesClass = s.classId === classId || s.classId === cleanId || s.classId === prefixedId || (targetCls && (s.classId === targetCls.id || s.className === targetCls.name));
              if (matchesClass && (s.subject === 'Chào cờ' || s.subject === 'Sinh hoạt lớp' || s.subject === 'TNHN2')) {
                return { ...s, teacherId: teacherId || '' };
              }
              return s;
            });
            localStorage.setItem(customKey, JSON.stringify(updatedCustom));
            window.dispatchEvent(new CustomEvent('edu_custom_fixed_slots_updated', { detail: updatedCustom }));
          }
        }
      } catch (err) {}

      // 3. Đồng bộ ma trận Thời khóa biểu thực thời
      try {
        const raw = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lessons)) {
            const teacherObj = teachers.find(t => t.id === teacherId);
            const teacherName = teacherObj?.name || 'GVCN';
            let changed = false;

            const updatedLessons = parsed.lessons.map((l: any) => {
              const matchesClass = l.classId === classId || l.classId === cleanId || l.classId === prefixedId || (targetCls && (l.classId === targetCls.id || l.className === targetCls.name));
              const isHomeroomSubject = l.subject === 'Chào cờ' || l.subject === 'Sinh hoạt lớp' || l.subject === 'TNHN2';
              const isTargetSubject = subjectName && (l.subject === subjectName || normalizeSubjectName(l.subject) === normalizeSubjectName(subjectName));

              if (matchesClass && (isHomeroomSubject || isTargetSubject)) {
                changed = true;
                return {
                  ...l,
                  teacherId: teacherId || '',
                  teacherName: teacherName || (isHomeroomSubject ? 'GVCN' : 'Giáo viên')
                };
              }
              return l;
            });

            if (changed) {
              const newTimetable = { ...parsed, lessons: updatedLessons };
              localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(newTimetable));
              localStorage.setItem('edu_timetable_active', JSON.stringify(newTimetable));
              window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: newTimetable }));
            }
          }
        }
      } catch (err) {
        console.warn('Reconcile timetable error on homeroom & subject assign:', err);
      }

      return updatedAssignments;
    });

    setSelectedHomeroomCell(null);
  };

  const handleAssignTeacherHomeroom = (teacherId: string, newClassId: string) => {
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
      return;
    }
    const targetTeacher = teachers.find(t => t.id === teacherId);
    if (targetTeacher && isBanGiamHieu(targetTeacher)) {
      alert(`⚠️ Cán bộ Ban Giám hiệu (${targetTeacher.name} - ${targetTeacher.position || 'Hiệu trưởng / Phó Hiệu trưởng'}) không phân công làm công tác chủ nhiệm!`);
      return;
    }
    // 1. Đồng bộ 2 chiều vào mảng classes (State, LocalStorage & Firestore)
    setClasses(prev => {
      const nextClasses = prev.map(c => {
        const isTarget = newClassId && (c.id === newClassId || c.id === newClassId.replace(/^c_/, '') || c.id === 'c_' + newClassId.replace(/^c_/, ''));
        if (isTarget) {
          return { ...c, homeroomTeacherId: teacherId };
        }
        if (c.homeroomTeacherId === teacherId && (!newClassId || !isTarget)) {
          return { ...c, homeroomTeacherId: undefined };
        }
        return c;
      });
      try {
        localStorage.setItem('edu_classes_v3', JSON.stringify(nextClasses));
        localStorage.setItem('edu_classes', JSON.stringify(nextClasses));
        localStorage.setItem(`edu_term_classes_${currentTermKey}`, JSON.stringify(nextClasses));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
        if (SCHOOL_DOC_REF) {
          setDoc(SCHOOL_DOC_REF, removeUndefinedFields({
            classes: nextClasses,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch (err) {}
      return nextClasses;
    });

    // 2. Đồng bộ customFixedSlots cho các tiết gắn với GVCN
    try {
      const customKey = `edu_custom_fixed_slots_${currentTermKey}`;
      const rawCustom = localStorage.getItem(customKey);
      if (rawCustom) {
        const parsedCustom = JSON.parse(rawCustom);
        if (Array.isArray(parsedCustom)) {
          const updatedCustom = parsedCustom.map((s: any) => {
            const isTarget = newClassId && (s.classId === newClassId || s.classId === newClassId.replace(/^c_/, '') || s.classId === 'c_' + newClassId.replace(/^c_/, ''));
            const isHomeroomSubject = s.subject === 'Chào cờ' || s.subject === 'Sinh hoạt lớp' || s.subject === 'TNHN2';
            if (isTarget && isHomeroomSubject) {
              return { ...s, teacherId };
            }
            if (s.teacherId === teacherId && isHomeroomSubject && !isTarget) {
              return { ...s, teacherId: '' };
            }
            return s;
          });
          localStorage.setItem(customKey, JSON.stringify(updatedCustom));
          window.dispatchEvent(new CustomEvent('edu_custom_fixed_slots_updated', { detail: updatedCustom }));
        }
      }
    } catch (err) {}

    setAssignments(prev => {
      const nextHomerooms = { ...prev.homeroomAssignments };

      // Xóa giáo viên này khỏi bất kỳ lớp chủ nhiệm nào hiện tại
      Object.entries(nextHomerooms).forEach(([cId, tId]) => {
        if (tId === teacherId) {
          delete nextHomerooms[cId];
        }
      });

      // Nếu chọn lớp mới
      if (newClassId) {
        const existingTeacherId = nextHomerooms[newClassId];
        if (existingTeacherId && existingTeacherId !== teacherId) {
          const oldTeacher = teachers.find(t => t.id === existingTeacherId);
          const targetClass = classes.find(c => c.id === newClassId);
          if (oldTeacher && targetClass) {
            const confirmed = confirm(
              `Lớp ${targetClass.name} hiện đang có GVCN là ${oldTeacher.name}. Bạn có muốn chuyển lớp này sang giáo viên được chọn không?`
            );
            if (!confirmed) {
              return prev;
            }
          }
        }
        const cleanId = newClassId.replace(/^c_/, '');
        const prefixedId = 'c_' + cleanId;
        const targetCls = classes.find(c => c.id === newClassId || c.id === cleanId || c.name === cleanId);
        nextHomerooms[newClassId] = teacherId;
        nextHomerooms[cleanId] = teacherId;
        nextHomerooms[prefixedId] = teacherId;
        if (targetCls?.name) nextHomerooms[targetCls.name] = teacherId;
      }

      const nextSubjects = { ...prev.subjectAssignments };
      if (newClassId && teacherId) {
        const cleanId = newClassId.replace(/^c_/, '');
        const prefixedId = 'c_' + cleanId;
        const targetCls = classes.find(c => c.id === newClassId || c.id === cleanId || c.name === cleanId);
        const targetTeacher = teachers.find(t => t.id === teacherId);
        if (targetTeacher && targetCls) {
          const teacherSpec = resolveTeacherSubject(targetTeacher, SUBJECTS);
          const specPeriod = getSubjectPeriod(teacherSpec, targetCls.grade, targetCls.id);
          const classSubj = nextSubjects[newClassId] || {};
          const currentSubjectTeacherId = classSubj[teacherSpec];
          if (specPeriod > 0 && !currentSubjectTeacherId) {
            const newRow = { ...classSubj, [teacherSpec]: teacherId };
            const norm = normalizeSubjectName(teacherSpec);
            if (norm) newRow[norm] = teacherId;
            nextSubjects[newClassId] = newRow;
            nextSubjects[cleanId] = newRow;
            nextSubjects[prefixedId] = newRow;
            if (targetCls.name) nextSubjects[targetCls.name] = newRow;
          }
        }
      }

      const updatedAssignments: Assignments = {
        ...prev,
        homeroomAssignments: nextHomerooms,
        subjectAssignments: nextSubjects
      };

      try {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(updatedAssignments));
        localStorage.setItem('edu_assignments', JSON.stringify(updatedAssignments));
        localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignments));
      } catch {}

      scheduleAutoSave(undefined, updatedAssignments);

      // Cập nhật ma trận TKB thực thời cho tiết Chào cờ & Sinh hoạt lớp
      try {
        const raw = localStorage.getItem(`edu_timetable_${currentTermKey}`) || localStorage.getItem('edu_timetable_active');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lessons)) {
            const teacherObj = teachers.find(t => t.id === teacherId);
            const teacherName = teacherObj?.name || (teacherId ? 'GVCN' : '');
            let changed = false;

            const updatedLessons = parsed.lessons.map((l: any) => {
              const isTarget = newClassId && (l.classId === newClassId || l.classId === newClassId.replace(/^c_/, '') || l.classId === 'c_' + newClassId.replace(/^c_/, ''));
              const isOldClass = Object.entries(prev.homeroomAssignments).some(([cId, tId]) => tId === teacherId && (l.classId === cId || l.classId === cId.replace(/^c_/, '')));
              const isHomeroomSubject = l.subject === 'Chào cờ' || l.subject === 'Sinh hoạt lớp' || l.subject === 'TNHN2';
              
              if (isTarget && isHomeroomSubject) {
                changed = true;
                return { ...l, teacherId: teacherId || '', teacherName: teacherName || 'GVCN' };
              }
              if (isOldClass && isHomeroomSubject && !isTarget) {
                changed = true;
                return { ...l, teacherId: '', teacherName: 'GVCN' };
              }
              return l;
            });

            if (changed) {
              const newTimetable = { ...parsed, lessons: updatedLessons };
              localStorage.setItem(`edu_timetable_${currentTermKey}`, JSON.stringify(newTimetable));
              localStorage.setItem('edu_timetable_active', JSON.stringify(newTimetable));
              window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: newTimetable }));
            }
          }
        }
      } catch (err) {
        console.warn('Reconcile timetable on assignTeacherHomeroom error:', err);
      }

      return updatedAssignments;
    });
  };

  // CRUD Handlers
  const handleAddTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để thêm giáo viên!');
      openLoginModal();
      return;
    }
    const id = 't_' + Date.now();
    const finalSub = resolveTeacherSubject(newTeacher, SUBJECTS);
    const createdTeacher: Teacher = {
      ...newTeacher,
      id,
      specialization: finalSub,
      subject: finalSub,
      monGiangDay: finalSub,
      subjectId: finalSub,
      monDay: finalSub,
      position: newTeacher.position || 'Giáo viên',
      trinhDo: newTeacher.trinhDo || 'Đại học'
    };
    setTeachers(prev => {
      const updated = [...prev, createdTeacher];
      localStorage.setItem('edu_teachers', JSON.stringify(updated));
      return updated;
    });
    setIsAddingTeacher(false);
    setNewTeacher({
      name: '',
      specialization: 'Toán',
      position: 'Giáo viên',
      maxPeriods: 17,
      isHomeroomCapable: true,
      preferredGrades: ['10', '11', '12'],
      experienceYears: 5,
      phone: '',
      namSinh: 1985,
      namVaoNganh: 2008,
      trinhDo: 'Đại học',
      email: ''
    });

    // Tự động đẩy đồng bộ lên Firebase Firestore khi có quyền admin
    setTimeout(() => {
      syncToCloud().catch(err => console.warn('[Firebase Sync] Auto-sync on add teacher:', err));
    }, 150);
  };

  // Helper chuẩn bị dữ liệu hồ sơ giáo viên để xuất Word/PDF
  const getTeacherProfileData = (targetTeacher: Teacher): TeacherProfileExportData => {
    const homeroomClassEntry = Object.entries(assignments.homeroomAssignments).find(
      ([, tId]) => tId === targetTeacher.id
    );
    const homeroomClassObj = homeroomClassEntry 
      ? classes.find(c => c.id === homeroomClassEntry[0]) 
      : null;

    const assignedClassList: Array<{
      className: string;
      subjectName: string;
      periods: number;
      grade: string;
    }> = [];

    let totalPeriods = 0;

    classes.forEach(c => {
      const classAssignments = assignments.subjectAssignments[c.id] || {};
      Object.entries(classAssignments).forEach(([subjectId, tId]) => {
        if (tId === targetTeacher.id) {
          // Lấy số tiết quy định của môn trong lớp
          const p = classSubjectPeriods[c.id]?.[subjectId] ?? (
            c.grade === '10' ? (subjectsConfig.find(s => s.id === subjectId)?.grade10Periods ?? 2) :
            c.grade === '11' ? (subjectsConfig.find(s => s.id === subjectId)?.grade11Periods ?? 2) :
            (subjectsConfig.find(s => s.id === subjectId)?.grade12Periods ?? 2)
          );
          if (p > 0) {
            assignedClassList.push({
              className: c.name,
              subjectName: subjectId,
              periods: p,
              grade: c.grade
            });
            totalPeriods += p;
          }
        }
      });
    });

    const isHr = !!homeroomClassObj;

    return {
      teacher: targetTeacher,
      schoolInfo,
      homeroomClass: homeroomClassObj ? { id: homeroomClassObj.id, name: homeroomClassObj.name, grade: homeroomClassObj.grade } : null,
      assignedClasses: assignedClassList,
      totalTeachingPeriods: totalPeriods,
      totalPeriodsWithHomeroom: totalPeriods + (isHr ? 4 : 0)
    };
  };

  const handleExportTeacherProfile = async (targetTeacher: Teacher, format: 'pdf' | 'docx') => {
    try {
      setIsExportingProfile(true);
      const data = getTeacherProfileData(targetTeacher);
      if (format === 'docx') {
        await exportTeacherProfileToWord(data);
        showTermNotification(`Đã xuất hồ sơ giáo viên ${targetTeacher.name} dạng Word (.docx) thành công!`);
      } else {
        await exportTeacherProfileToPDF(data);
        showTermNotification(`Đã xuất hồ sơ giáo viên ${targetTeacher.name} dạng PDF (.pdf) thành công!`);
      }
      setProfileExportTeacher(null);
    } catch (err) {
      console.error(err);
      alert('Đã xảy ra lỗi khi tạo tệp hồ sơ giáo viên.');
    } finally {
      setIsExportingProfile(false);
    }
  };

  const handleStartEditTeacher = (teacher: Teacher) => {
    const resolvedSubject = resolveTeacherSubject(teacher, SUBJECTS);
    setEditingTeacher({
      ...teacher,
      specialization: resolvedSubject,
      subject: resolvedSubject,
      monGiangDay: resolvedSubject,
      subjectId: resolvedSubject,
      monDay: resolvedSubject
    });
  };

  const handleSaveEditTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để chỉnh sửa giáo viên!');
      openLoginModal();
      return;
    }
    if (!editingTeacher) return;

    const finalSubject = resolveTeacherSubject(editingTeacher, SUBJECTS);
    const finalGender = editingTeacher.gender || normalizeTeacherGender(undefined, editingTeacher.name);
    const rawDob = editingTeacher.dateOfBirth || editingTeacher.dob || (editingTeacher.namSinh ? `01/01/${editingTeacher.namSinh}` : '15/08/1985');
    const parsedDob = parseDateOfBirth(rawDob, editingTeacher.namSinh);
    const formattedDob = formatDOB(parsedDob.day, parsedDob.month, parsedDob.year);

    const updatedTeacher: Teacher = {
      ...editingTeacher,
      specialization: finalSubject,
      subject: finalSubject,
      monGiangDay: finalSubject,
      subjectId: finalSubject,
      monDay: finalSubject,
      gender: finalGender,
      dateOfBirth: formattedDob,
      dob: formattedDob,
      namSinh: parsedDob.year
    };

    setTeachers(prev => {
      const updated = prev.map(t => t.id === editingTeacher.id ? updatedTeacher : t);
      localStorage.setItem('edu_teachers', JSON.stringify(updated));
      return updated;
    });
    setEditingTeacher(null);

    // Tự động đẩy đồng bộ trực tiếp lên Firebase Realtime Database/Firestore
    setTimeout(() => {
      syncToCloud().then(res => {
        if (res.success) {
          showTermNotification('Đã lưu thông tin giáo viên và đồng bộ trực tiếp lên Firebase Cloud!');
        }
      }).catch(err => console.warn('[Firebase Sync] Auto-sync on edit teacher:', err));
    }, 150);
  };

  const handleAddClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để thêm lớp học!');
      openLoginModal();
      return;
    }
    const id = 'c_' + Date.now();
    setClasses(prev => [...prev, { ...newClass, id }]);
    setIsAddingClass(false);
    setNewClass({
      name: '',
      grade: '10'
    });
  };

  const handleSaveEditClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để chỉnh sửa lớp học!');
      openLoginModal();
      return;
    }
    if (!editingClass) return;
    setClasses(prev => prev.map(c => c.id === editingClass.id ? editingClass : c));
    setEditingClass(null);
  };

  const handleImportTeachers = (parsedList: any[]) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để nhập dữ liệu giáo viên!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      alert('Dữ liệu đang khóa bảo vệ. Vui lòng mở khóa trước.');
      return;
    }
    if (!Array.isArray(parsedList) || parsedList.length === 0) return;

    setTeachers(prev => {
      const existingNames = new Set(prev.map(t => (t?.name || '').toLowerCase()));
      const added: Teacher[] = [];
      parsedList.forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        const name = String(t.name || '').trim();
        if (!name) return;
        if (existingNames.has(name.toLowerCase())) return;

        const id = 't_' + (Date.now() + i);
        const spec = String(t.subject || t.specialization || 'Toán').trim() || 'Toán';
        const pos = String(t.role || t.position || 'Giáo viên').trim() || 'Giáo viên';
        const quota = Number(t.quota) > 0 ? Number(t.quota) : getStandardQuotaForPosition(pos);
        const maxP = Number(t.maxPeriods) > 0 ? Number(t.maxPeriods) : quota;
        const phone = String(t.phone || '').trim();
        const email = String(t.email || `${name.toLowerCase().replace(/\s+/g, '')}@school.edu.vn`).trim();

        added.push({
          id,
          name,
          specialization: spec,
          position: pos,
          maxPeriods: maxP,
          isHomeroomCapable: t.isHomeroomCapable !== undefined ? !!t.isHomeroomCapable : true,
          preferredGrades: Array.isArray(t.preferredGrades) ? t.preferredGrades : ['10', '11', '12'],
          experienceYears: Number(t.experienceYears) || 5,
          phone,
          namSinh: t.namSinh ? Number(t.namSinh) : undefined,
          namVaoNganh: t.namVaoNganh ? Number(t.namVaoNganh) : undefined,
          trinhDo: t.trinhDo ? String(t.trinhDo).trim() : 'Đại học',
          email: t.email ? String(t.email).trim() : email
        });
      });
      showTermNotification('Dữ liệu đã lưu vào Danh mục Giáo viên');
      return [...prev, ...added];
    });
  };

  const handleImportClasses = (parsedList: any[]) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để nhập dữ liệu lớp học!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      alert('Dữ liệu đang khóa bảo vệ. Vui lòng mở khóa trước.');
      return;
    }
    if (!Array.isArray(parsedList) || parsedList.length === 0) return;

    setClasses(prev => {
      const existingNames = new Set(prev.map(c => (c?.name || '').toLowerCase()));
      const added: ClassModel[] = [];
      parsedList.forEach((c, i) => {
        if (!c || typeof c !== 'object') return;
        const name = String(c.name || '').trim();
        if (!name) return;
        if (existingNames.has(name.toLowerCase())) return;

        const id = 'c_' + (Date.now() + i);
        const grade = (c.grade || '10') as '10' | '11' | '12';

        added.push({
          id,
          name,
          grade
        });
      });
      showTermNotification('Dữ liệu đã lưu vào Danh mục Lớp học');
      return [...prev, ...added];
    });
  };

  const handleImportSubjects = (parsedList: any[]) => {
    if (isCurrentTermLocked) {
      alert('Dữ liệu đang khóa bảo vệ. Vui lòng mở khóa trước.');
      return;
    }
    if (!Array.isArray(parsedList) || parsedList.length === 0) return;

    setSubjectsConfig(prev => {
      const updated = [...prev];
      let addedCount = 0;
      parsedList.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const subId = String(item.id || item.subjectId || item.name || '').trim();
        const subName = String(item.name || item.id || item.subjectId || '').trim();
        if (!subId) return;

        const matchIdx = updated.findIndex(s => s && (s.id.toLowerCase() === subId.toLowerCase() || s.name.toLowerCase() === subName.toLowerCase()));
        if (matchIdx !== -1) {
          if (subName) updated[matchIdx].name = subName;
          if (item.grade10 !== undefined) updated[matchIdx].grade10Periods = Number(item.grade10);
          if (item.grade11 !== undefined) updated[matchIdx].grade11Periods = Number(item.grade11);
          if (item.grade12 !== undefined) updated[matchIdx].grade12Periods = Number(item.grade12);
        } else {
          updated.push({
            id: subId,
            name: subName || subId,
            grade10Periods: item.grade10 !== undefined ? Number(item.grade10) : 2,
            grade11Periods: item.grade11 !== undefined ? Number(item.grade11) : 2,
            grade12Periods: item.grade12 !== undefined ? Number(item.grade12) : 2
          });
          addedCount++;
        }
      });
      showTermNotification('Dữ liệu đã lưu vào Danh mục Môn học');
      return updated;
    });
  };

  const handleImportLessonHours = (parsedList: any[]) => {
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ.`);
      return;
    }
    if (!Array.isArray(parsedList) || parsedList.length === 0) return;

    let updatedCount = 0;

    // 1. Cập nhật số tiết theo từng lớp (classSubjectPeriods)
    setClassSubjectPeriods(prev => {
      const next = { ...prev };
      parsedList.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const cName = String(item.className || '').trim().toLowerCase().replace(/^c_/i, '');
        const subRaw = String(item.subjectId || item.subjectCode || item.subject || '').trim();
        const periods = item.periods !== undefined ? Number(item.periods) : undefined;

        if (cName && subRaw && periods !== undefined) {
          const matchedClass = (classes || []).find(c => 
            c && (
              c.name.toLowerCase() === cName || 
              c.id.toLowerCase() === `c_${cName}` || 
              c.id.toLowerCase() === cName
            )
          );
          if (matchedClass) {
            const norm = normalizeSubjectName(subRaw);
            const matchedSub = (subjectsConfig || []).find(s => 
              s && (
                normalizeSubjectName(s.id) === norm || 
                s.id.toLowerCase() === subRaw.toLowerCase() ||
                s.name.toLowerCase() === subRaw.toLowerCase()
              )
            );
            const subId = matchedSub ? matchedSub.id : subRaw;
            if (!next[matchedClass.id]) next[matchedClass.id] = {};
            next[matchedClass.id][subId] = periods;
            updatedCount++;
          }
        }
      });

      try {
        localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(next));
      } catch {}
      return next;
    });

    // 2. Cập nhật số tiết phân bổ theo khối (subjectsConfig)
    setSubjectsConfig(prev => {
      const updated = [...prev];
      parsedList.forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (item.grade10 !== undefined || item.grade11 !== undefined || item.grade12 !== undefined) {
          const subRaw = String(item.subjectId || item.name || '').trim();
          if (!subRaw) return;
          const norm = normalizeSubjectName(subRaw);
          const matchIdx = updated.findIndex(s => 
            s && (
              normalizeSubjectName(s.id) === norm || 
              s.id.toLowerCase() === subRaw.toLowerCase() || 
              s.name.toLowerCase() === subRaw.toLowerCase()
            )
          );
          if (matchIdx !== -1) {
            if (item.grade10 !== undefined) updated[matchIdx].grade10Periods = Number(item.grade10);
            if (item.grade11 !== undefined) updated[matchIdx].grade11Periods = Number(item.grade11);
            if (item.grade12 !== undefined) updated[matchIdx].grade12Periods = Number(item.grade12);
            updatedCount++;
          }
        }
      });
      return updated;
    });

    showTermNotification('Dữ liệu đã lưu vào Bảng khai báo số tiết');
  };

  const handleImportAssignments = (parsedList: any[]) => {
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ.`);
      return;
    }
    if (!Array.isArray(parsedList) || parsedList.length === 0) return;

    setAssignments(prev => {
      const nextH = { ...(prev?.homeroomAssignments || {}) };
      const nextS = { ...(prev?.subjectAssignments || {}) };
      let appliedCount = 0;

      parsedList.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const teacherName = String(item.teacherName || '').trim();
        const className = String(item.className || '').trim();
        const role = String(item.role || '').trim().toLowerCase();
        const rawCode = String(item.subjectCode || item.subject || '').trim();

        if (!teacherName || !className) return;

        // Tìm giáo viên: theo ID, tên chính xác hoặc chứa tên
        const cleanTName = teacherName.toLowerCase().replace(/^(thầy|cô|gv|thay|co)\s+/i, '');
        const matchedTeacher = (teachers || []).find(t => 
          t && (
            (item.teacherId && t.id === item.teacherId) ||
            t.name.toLowerCase() === teacherName.toLowerCase() ||
            t.name.toLowerCase() === cleanTName ||
            t.name.toLowerCase().includes(cleanTName) ||
            cleanTName.includes(t.name.toLowerCase())
          )
        );

        // Tìm lớp học: "12A1", "12a1", "c_12A1"
        const cleanCName = className.replace(/^c_/i, '').trim().toLowerCase();
        const matchedClass = (classes || []).find(c => 
          c && (
            c.id.toLowerCase() === className.toLowerCase() ||
            c.id.toLowerCase() === `c_${cleanCName}` ||
            c.name.toLowerCase() === cleanCName
          )
        );

        if (!matchedTeacher || !matchedClass) return;

        const isHomeroom = role === 'homeroom' || 
          rawCode.toUpperCase() === 'GVCN' || 
          rawCode.toLowerCase().includes('chủ nhiệm') ||
          rawCode.toLowerCase().includes('chu nhiem');

        if (isHomeroom) {
          nextH[matchedClass.id] = matchedTeacher.id;
          appliedCount++;
        } else {
          // Chuẩn hóa tên/mã môn (Toán, Văn, CNCN, CNNN, v.v.)
          const norm = normalizeSubjectName(rawCode);
          const matchedSubject = (subjectsConfig || []).find(s => 
            s && (
              normalizeSubjectName(s.id) === norm || 
              s.id.toLowerCase() === rawCode.toLowerCase() || 
              s.name.toLowerCase() === rawCode.toLowerCase() ||
              (norm === 'CNCN' && s.id === 'CNCN') ||
              (norm === 'CNNN' && s.id === 'CNNN')
            )
          );

          if (matchedSubject) {
            if (!nextS[matchedClass.id]) {
              nextS[matchedClass.id] = {};
            }
            nextS[matchedClass.id][matchedSubject.id] = matchedTeacher.id;
            appliedCount++;
          }
        }
      });

      const nextMerged = {
        homeroomAssignments: nextH,
        subjectAssignments: nextS
      };

      try {
        localStorage.setItem('edu_assignments_v3', JSON.stringify(nextMerged));
        localStorage.setItem('edu_assignments', JSON.stringify(nextMerged));
        localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(nextMerged));
        if (TARGET_TERM_DOC_REF) {
          setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            assignments: nextMerged,
            updatedAt: new Date().toISOString()
          }), { merge: true });
        }
      } catch (e) {}

      showTermNotification('Dữ liệu đã lưu vào Bảng phân công giảng dạy');
      return nextMerged;
    });
  };

  const executeDeleteTeacher = (id: string) => {
    setTeachers(prev => prev.filter(t => t.id !== id));
    
    // Clean assignments
    setAssignments(prev => {
      const nextH = { ...prev.homeroomAssignments };
      Object.entries(nextH).forEach(([cId, tId]) => {
        if (tId === id) delete nextH[cId];
      });

      const nextS = { ...prev.subjectAssignments };
      Object.entries(nextS).forEach(([cId, subMap]) => {
        const newMap = { ...subMap };
        Object.entries(newMap).forEach(([subName, tId]) => {
          if (tId === id) delete newMap[subName];
        });
        nextS[cId] = newMap;
      });

      return { homeroomAssignments: nextH, subjectAssignments: nextS };
    });
  };

  const handleDeleteTeacher = (id: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để xóa giáo viên!');
      openLoginModal();
      return;
    }
    const teacher = teachers.find(t => t.id === id);
    if (!teacher) return;
    const stats = getTeacherStats(teacher.id);
    const hrClass = classes.find(c => assignments.homeroomAssignments[c.id] === teacher.id);

    setDeleteConfirmation({
      type: 'teacher',
      id: teacher.id,
      title: 'Xác nhận xóa giáo viên',
      entityName: teacher.name,
      subtitle: `Tổ chuyên môn: ${teacher.specialization} • Chức vụ: ${teacher.position || 'Giáo viên'}`,
      details: [
        { label: 'Định mức số tiết', value: `${teacher.maxPeriods} tiết/tuần` },
        { label: 'Số tiết đang dạy', value: `${stats.assignedPeriods} tiết (Tổng cộng: ${stats.totalPeriods} tiết)` },
        { label: 'Chủ nhiệm lớp', value: hrClass ? `Lớp ${hrClass.name}` : 'Không' },
      ],
      warning: 'Xóa giáo viên này sẽ tự động hủy bỏ tất cả phân công giảng dạy môn học và phân công chủ nhiệm hiện có của giáo viên trong bảng phân công.',
      confirmText: 'Xác nhận xóa giáo viên',
      onConfirm: () => executeDeleteTeacher(teacher.id)
    });
  };

  const executeDeleteClass = (id: string) => {
    setClasses(prev => prev.filter(c => c.id !== id));
    setAssignments(prev => {
      const nextH = { ...prev.homeroomAssignments };
      delete nextH[id];
      const nextS = { ...prev.subjectAssignments };
      delete nextS[id];
      return { homeroomAssignments: nextH, subjectAssignments: nextS };
    });
  };

  const handleDeleteClass = (id: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để xóa lớp học!');
      openLoginModal();
      return;
    }
    const cls = classes.find(c => c.id === id);
    if (!cls) return;
    const hrTeacherId = assignments.homeroomAssignments[cls.id];
    const hrTeacher = teachers.find(t => t.id === hrTeacherId);
    const subMap = assignments.subjectAssignments[cls.id] || {};
    const assignedCount = Object.keys(subMap).length;

    setDeleteConfirmation({
      type: 'class',
      id: cls.id,
      title: 'Xác nhận xóa lớp học',
      entityName: `Lớp ${cls.name}`,
      subtitle: `Khối ${cls.grade}`,
      details: [
        { label: 'Giáo viên chủ nhiệm', value: hrTeacher ? hrTeacher.name : 'Chưa phân công' },
        { label: 'Số môn đã phân công', value: `${assignedCount} / ${SUBJECTS.length} môn` },
      ],
      warning: 'Toàn bộ phân công giảng dạy các môn học và phân công giáo viên chủ nhiệm của lớp này sẽ bị xóa khỏi bảng phân công.',
      confirmText: 'Xác nhận xóa lớp',
      onConfirm: () => executeDeleteClass(cls.id)
    });
  };

  const handleAddSubject = (e: React.FormEvent) => {
    e.preventDefault();
    const id = newSubject.id.trim();
    const name = newSubject.name.trim() || id;

    if (!id) {
      alert('Vui lòng nhập tên/mã viết tắt môn học!');
      return;
    }

    if (subjectsConfig.some(s => s.id.toLowerCase() === id.toLowerCase() || s.name.toLowerCase() === name.toLowerCase())) {
      alert(`Môn học "${id}" đã có trong hệ thống! Vui lòng chọn tên hoặc mã khác.`);
      return;
    }

    const g10 = Math.max(0, Math.min(20, Number(newSubject.grade10Periods) || 0));
    const g11 = Math.max(0, Math.min(20, Number(newSubject.grade11Periods) || 0));
    const g12 = Math.max(0, Math.min(20, Number(newSubject.grade12Periods) || 0));

    const selectedDept = departments.find(d => d.id === newSubject.departmentId) || departments.find(d => d.name === newSubject.department) || departments[0];
    const finalDeptId = selectedDept?.id || 'dept_toan_tin';
    const finalDeptName = selectedDept?.name || 'Tổ Toán - Tin';

    const newSub: SubjectConfig = {
      id,
      name,
      departmentId: finalDeptId,
      department: finalDeptName,
      grade10Periods: g10,
      grade11Periods: g11,
      grade12Periods: g12
    };

    const nextSubjectsConfig = [...subjectsConfig, newSub];
    setSubjectsConfig(nextSubjectsConfig);
    try {
      localStorage.setItem('edu_subjects_config', JSON.stringify(nextSubjectsConfig));
      localStorage.setItem(`edu_term_subjects_${currentTermKey}`, JSON.stringify(nextSubjectsConfig));
      setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
        subjects: nextSubjectsConfig,
        subjectsConfig: nextSubjectsConfig,
        updatedAt: new Date().toISOString()
      }), { merge: true });
    } catch (err) {
      console.warn('[Firestore] Error saving new subject:', err);
    }

    setIsAddingSubject(false);
    setNewSubject({
      id: '',
      name: '',
      departmentId: '',
      department: '',
      grade10Periods: 2,
      grade11Periods: 2,
      grade12Periods: 2
    });
    showTermNotification(`✅ Đã thêm môn học "${name}" (${finalDeptName}) vào hệ thống và đồng bộ lên Cloud Firestore!`);
  };

  const handleStartEditSubject = (subjectId: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để chỉnh sửa môn học!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
      return;
    }
    const sub = subjectsConfig.find(s => s.id === subjectId || s.name === subjectId || s.id.toLowerCase() === subjectId.toLowerCase());
    if (!sub) return;
    const currentDeptName = sub.department || getDefaultDepartment(sub.id, sub.name);
    const matchedDept = departments.find(d => d.id === sub.departmentId || d.name === currentDeptName || d.name.toLowerCase() === currentDeptName.toLowerCase());
    const currentDeptId = sub.departmentId || matchedDept?.id || departments[0]?.id || 'dept_toan_tin';
    const deptName = matchedDept ? matchedDept.name : currentDeptName;

    setEditingSubject({
      originalId: sub.id,
      id: sub.id,
      name: sub.name || sub.id,
      departmentId: currentDeptId,
      department: deptName,
      grade10Periods: sub.grade10Periods ?? 2,
      grade11Periods: sub.grade11Periods ?? 2,
      grade12Periods: sub.grade12Periods ?? 2
    });
  };

  const handleSaveEditSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubject) return;
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để lưu chỉnh sửa môn học!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ.`);
      return;
    }

    const origId = editingSubject.originalId;
    const newId = editingSubject.id.trim();
    const newName = editingSubject.name.trim() || newId;

    if (!newId) {
      alert('Vui lòng nhập mã / tên viết tắt môn học!');
      return;
    }

    // Kiểm tra trùng lặp nếu đổi mã sang mã môn khác đã tồn tại
    if (newId.toLowerCase() !== origId.toLowerCase() && subjectsConfig.some(s => s.id.toLowerCase() === newId.toLowerCase())) {
      alert(`Mã môn học "${newId}" đã tồn tại! Vui lòng chọn mã khác.`);
      return;
    }

    const g10 = Math.max(0, Math.min(20, Number(editingSubject.grade10Periods) || 0));
    const g11 = Math.max(0, Math.min(20, Number(editingSubject.grade11Periods) || 0));
    const g12 = Math.max(0, Math.min(20, Number(editingSubject.grade12Periods) || 0));

    const selectedDept = departments.find(d => d.id === editingSubject.departmentId) || departments.find(d => d.name === editingSubject.department) || departments[0];
    const finalDeptId = editingSubject.departmentId || selectedDept?.id || 'dept_toan_tin';
    const finalDeptName = selectedDept ? selectedDept.name : (editingSubject.department || 'Tổ Toán - Tin');

    const updatedConfigItem: SubjectConfig = {
      id: newId,
      name: newName,
      departmentId: finalDeptId,
      department: finalDeptName,
      grade10Periods: g10,
      grade11Periods: g11,
      grade12Periods: g12
    };

    // 1. Cập nhật danh sách môn học
    const nextSubjectsConfig = subjectsConfig.map(s => s.id === origId ? updatedConfigItem : s);
    setSubjectsConfig(nextSubjectsConfig);
    try {
      localStorage.setItem('edu_subjects_config', JSON.stringify(nextSubjectsConfig));
      localStorage.setItem(`edu_term_subjects_${currentTermKey}`, JSON.stringify(nextSubjectsConfig));
      setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
        subjects: nextSubjectsConfig,
        subjectsConfig: nextSubjectsConfig,
        updatedAt: new Date().toISOString()
      }), { merge: true });
    } catch (err) {
      console.warn('[Firestore] Error saving edited subject to Firestore:', err);
    }

    // 2. Nếu mã môn (id) thay đổi, cập nhật chuyển tiếp các khóa liên quan
    if (newId !== origId) {
      // 2.1 Cập nhật phân công bộ môn subjectAssignments
      setAssignments(prev => {
        const nextSubj = { ...prev.subjectAssignments };
        let changed = false;
        Object.keys(nextSubj).forEach(cId => {
          if (nextSubj[cId]?.[origId]) {
            const classCopy = { ...nextSubj[cId] };
            classCopy[newId] = classCopy[origId];
            delete classCopy[origId];
            nextSubj[cId] = classCopy;
            changed = true;
          }
        });
        return changed ? { ...prev, subjectAssignments: nextSubj } : prev;
      });

      // 2.2 Cập nhật classSubjectPeriods
      setClassSubjectPeriods(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(cId => {
          if (next[cId]?.[origId] !== undefined) {
            const classCopy = { ...next[cId] };
            classCopy[newId] = classCopy[origId];
            delete classCopy[origId];
            next[cId] = classCopy;
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      // 2.3 Cập nhật giáo viên có chuyên môn này
      setTeachers(prev => {
        let changed = false;
        const next = prev.map(t => {
          if (t.specialization === origId || t.subject === origId || t.monGiangDay === origId) {
            changed = true;
            return {
              ...t,
              specialization: newId,
              subject: newId,
              monGiangDay: newId,
              subjectId: newId,
              monDay: newId
            };
          }
          return t;
        });
        return changed ? next : prev;
      });
    }

    setEditingSubject(null);
    showTermNotification(`✅ Đã cập nhật thành công môn học "${newName}" (${finalDeptName}) và đồng bộ lên Cloud Firestore!`);
  };

  const executeDeleteSubject = (subjectId: string) => {
    const sub = subjectsConfig.find(s => s.id === subjectId || s.name === subjectId || s.id.toLowerCase() === subjectId.toLowerCase());
    const targetId = sub ? sub.id : subjectId;
    setSubjectsConfig(prev => {
      const next = prev.filter(s => s.id !== targetId);
      try {
        localStorage.setItem('edu_subjects_config', JSON.stringify(next));
        localStorage.setItem(`edu_term_subjects_${currentTermKey}`, JSON.stringify(next));
        setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
          subjects: next,
          subjectsConfig: next,
          updatedAt: new Date().toISOString()
        }), { merge: true });
      } catch (err) {
        console.warn('[Firestore] Error deleting subject:', err);
      }
      return next;
    });
    // Dọn dẹp phân công bộ môn
    setAssignments(prev => {
      const nextSubj = { ...prev.subjectAssignments };
      Object.keys(nextSubj).forEach(cId => {
        if (nextSubj[cId]?.[targetId] || nextSubj[cId]?.[subjectId]) {
          const classCopy = { ...nextSubj[cId] };
          delete classCopy[targetId];
          delete classCopy[subjectId];
          nextSubj[cId] = classCopy;
        }
      });
      return { ...prev, subjectAssignments: nextSubj };
    });
    // Dọn dẹp classSubjectPeriods
    setClassSubjectPeriods(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(cId => {
        if (next[cId]?.[targetId] !== undefined || next[cId]?.[subjectId] !== undefined) {
          const classCopy = { ...next[cId] };
          delete classCopy[targetId];
          delete classCopy[subjectId];
          next[cId] = classCopy;
        }
      });
      return next;
    });
    showTermNotification(`🗑️ Đã xóa môn học "${sub?.name || targetId}" khỏi hệ thống thành công!`);
  };

  // QUẢN LÝ TỔ CHUYÊN MÔN (DEPARTMENTS)
  const handleAddDepartment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để thêm Tổ chuyên môn!');
      openLoginModal();
      return;
    }
    const trimmed = newDepartmentName.trim();
    if (!trimmed) {
      alert('Vui lòng nhập tên Tổ chuyên môn mới!');
      return;
    }
    if (departments.some(d => d.name.toLowerCase() === trimmed.toLowerCase())) {
      alert(`Tổ chuyên môn "${trimmed}" đã tồn tại!`);
      return;
    }
    const slug = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const id = `dept_${slug || Date.now()}`;
    const newDept: Department = { id, name: trimmed };
    const nextDepartments = [...departments, newDept];

    setDepartments(nextDepartments);
    setNewDepartmentName('');
    try {
      localStorage.setItem('edu_departments', JSON.stringify(nextDepartments));
      localStorage.setItem(`edu_term_departments_${currentTermKey}`, JSON.stringify(nextDepartments));
      await setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
        departments: nextDepartments,
        updatedAt: new Date().toISOString()
      }), { merge: true });
      showTermNotification(`Đã thêm tổ "${trimmed}" và đồng bộ lên Cloud Firestore thành công!`);
    } catch (err: any) {
      console.error('Error saving new department:', err);
      showTermNotification(`Đã thêm tổ "${trimmed}" vào hệ thống.`);
    }
  };

  const handleSaveEditDepartment = async (deptId: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để chỉnh sửa Tổ chuyên môn!');
      openLoginModal();
      return;
    }
    const trimmed = editingDepartmentName.trim();
    if (!trimmed) {
      alert('Tên tổ chuyên môn không được để trống!');
      return;
    }
    const oldDept = departments.find(d => d.id === deptId);
    if (!oldDept) return;
    const oldName = oldDept.name;

    if (trimmed.toLowerCase() !== oldName.toLowerCase() && departments.some(d => d.name.toLowerCase() === trimmed.toLowerCase())) {
      alert(`Tổ chuyên môn "${trimmed}" đã tồn tại! Vui lòng chọn tên khác.`);
      return;
    }

    // 1. Cập nhật danh mục departments
    const nextDepartments = departments.map(d => d.id === deptId ? { ...d, name: trimmed } : d);
    setDepartments(nextDepartments);
    setEditingDepartmentId(null);
    setEditingDepartmentName('');

    // 2. Cập nhật tên mới cho các môn thuộc tổ đó
    const nextSubjectsConfig = subjectsConfig.map(s => {
      const isBelong = s.departmentId === deptId || s.department === oldName || (!s.department && getDefaultDepartment(s.id, s.name) === oldName);
      if (isBelong) {
        return { ...s, departmentId: deptId, department: trimmed };
      }
      return s;
    });
    setSubjectsConfig(nextSubjectsConfig);

    // 3. Cập nhật tên mới cho giáo viên thuộc tổ đó (specialization)
    const nextTeachers = teachers.map(t => {
      if (t.specialization === oldName) {
        return { ...t, specialization: trimmed };
      }
      return t;
    });
    setTeachers(nextTeachers);

    // 4. Lưu đồng bộ lên localStorage & Cloud Firestore
    try {
      localStorage.setItem('edu_departments', JSON.stringify(nextDepartments));
      localStorage.setItem(`edu_term_departments_${currentTermKey}`, JSON.stringify(nextDepartments));
      localStorage.setItem('edu_subjects_config', JSON.stringify(nextSubjectsConfig));
      localStorage.setItem(`edu_term_subjects_${currentTermKey}`, JSON.stringify(nextSubjectsConfig));
      localStorage.setItem('edu_teachers', JSON.stringify(nextTeachers));
      localStorage.setItem('edu_teachers_v3', JSON.stringify(nextTeachers));

      await setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
        departments: nextDepartments,
        subjects: nextSubjectsConfig,
        subjectsConfig: nextSubjectsConfig,
        teachers: nextTeachers,
        updatedAt: new Date().toISOString()
      }), { merge: true });

      showTermNotification(`✅ Đã cập nhật tổ "${trimmed}" và đồng bộ tên mới cho môn học, giáo viên lên Firestore!`);
    } catch (err: any) {
      console.error('Error saving updated department:', err);
      showTermNotification(`Đã cập nhật tổ "${trimmed}".`);
    }
  };

  const handleDeleteDepartment = (dept: Department) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để xóa Tổ chuyên môn!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }

    // Đếm số lượng môn học thuộc tổ này
    const subjectsInDept = subjectsConfig.filter(s => 
      s.departmentId === dept.id || s.department === dept.name || (!s.department && getDefaultDepartment(s.id, s.name) === dept.name)
    );

    // Đếm số lượng giáo viên thuộc tổ này
    const teachersInDept = teachers.filter(t => 
      t.specialization === dept.name || (t.specialization && t.specialization.includes(dept.name))
    );

    let confirmMsg = `Bạn có chắc chắn muốn xóa Tổ chuyên môn "${dept.name}" khỏi hệ thống?`;
    if (subjectsInDept.length > 0 || teachersInDept.length > 0) {
      confirmMsg = `⚠️ CẢNH BÁO QUAN TRỌNG: Tổ "${dept.name}" hiện đang có ${subjectsInDept.length} môn học trực thuộc (${subjectsInDept.map(s => s.name || s.id).join(', ') || 'không có'}) và ${teachersInDept.length} giáo viên thuộc tổ. Nếu xóa tổ này, các môn và giáo viên sẽ cần được phân bổ sang tổ khác. Bạn vẫn muốn tiếp tục xóa?`;
    }

    setDeleteConfirmation({
      type: 'department' as any,
      id: dept.id,
      title: `Xác nhận xóa ${dept.name}`,
      entityName: dept.name,
      subtitle: `${subjectsInDept.length} môn học trực thuộc • ${teachersInDept.length} giáo viên`,
      details: [
        { label: 'Số môn trực thuộc', value: `${subjectsInDept.length} môn` },
        { label: 'Số giáo viên thuộc tổ', value: `${teachersInDept.length} giáo viên` }
      ],
      warning: confirmMsg,
      confirmText: 'Xác nhận xóa tổ',
      onConfirm: async () => {
        const nextDepartments = departments.filter(d => d.id !== dept.id);
        setDepartments(nextDepartments);
        try {
          localStorage.setItem('edu_departments', JSON.stringify(nextDepartments));
          localStorage.setItem(`edu_term_departments_${currentTermKey}`, JSON.stringify(nextDepartments));
          await setDoc(TARGET_TERM_DOC_REF, removeUndefinedFields({
            departments: nextDepartments,
            updatedAt: new Date().toISOString()
          }), { merge: true });
          showTermNotification(`🗑️ Đã xóa tổ "${dept.name}" và đồng bộ lên Cloud Firestore.`);
        } catch (err) {
          console.error('Error deleting department:', err);
        }
        setDeleteConfirmation(null);
      }
    });
  };

  const handleDeleteSubject = (subjectId: string) => {
    if (!isAdmin) {
      showTermNotification('⚠️ Cần quyền Quản trị viên để xóa môn học!');
      openLoginModal();
      return;
    }
    if (isCurrentTermLocked) {
      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
      return;
    }

    const sub = subjectsConfig.find(s => s.id === subjectId || s.name === subjectId || s.id.toLowerCase() === subjectId.toLowerCase());
    if (!sub) return;

    let countAssignments = 0;
    Object.values(assignments.subjectAssignments).forEach(classSubMap => {
      if (classSubMap && (classSubMap[sub.id] || classSubMap[subjectId])) {
        countAssignments++;
      }
    });

    setDeleteConfirmation({
      type: 'subject',
      id: sub.id,
      title: 'Xác nhận xóa môn học',
      entityName: `${sub.name || sub.id} (${sub.id})`,
      subtitle: `Định mức: Khối 10 (${sub.grade10Periods}t) • Khối 11 (${sub.grade11Periods}t) • Khối 12 (${sub.grade12Periods}t)`,
      details: [
        { label: 'Số lớp đang phân công môn này', value: `${countAssignments} lớp` }
      ],
      warning: `Môn học "${sub.name || sub.id}" (${sub.id}) sẽ bị gỡ bỏ khỏi cấu hình. Toàn bộ phân công dạy môn này trên tất cả các lớp sẽ bị xóa.`,
      confirmText: 'Xác nhận xóa môn học',
      onConfirm: () => executeDeleteSubject(sub.id)
    });
  };

  const handleMoveSubject = (subjectId: string, direction: 'up' | 'down') => {
    const index = subjectsConfig.findIndex(s => s.id === subjectId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= subjectsConfig.length) return;

    setSubjectsConfig(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  // Export & Print report handler
  const handlePrint = () => {
    setSchoolInfo(prev => ({
      ...prev,
      academicYear: currentAcademicYear,
      semester: currentSemester,
      teachingWeeks: prev.teachingWeeks || (currentSemester === 'Học kỳ II' ? 17 : 18)
    }));
    setIsExportModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800">
      
      {/* HEADER SECTION - High-tech Blue Gradient & Emerald Accent Style */}
      <header 
        style={{
          background: 'linear-gradient(90deg, #0b2447 0%, #19376d 50%, #0b2447 100%)',
          borderBottom: '1px solid rgba(6, 182, 212, 0.3)',
          boxShadow: '0 4px 20px -2px rgba(11, 36, 71, 0.35)',
          height: '64px',
          padding: '0 28px'
        }}
        className="text-white print:hidden sticky top-0 z-30 flex items-center justify-between"
      >
        <div className={`mx-auto w-full h-full flex items-center justify-between gap-4 transition-all duration-200 ${
          isBoardFullscreen && activeTab === 'board' ? 'max-w-none' : 'max-w-7xl'
        }`}>
          {/* Logo & School Name */}
          <div 
            onClick={() => setActiveTab('welcome')}
            className="flex items-center gap-3.5 min-w-0 cursor-pointer select-none group"
            title="Về màn hình chính (Trang chủ)"
          >
            <div 
              style={{
                width: '46px',
                height: '46px',
                border: '2px solid #ffffff',
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.5)',
                borderRadius: '9999px'
              }}
              className="shrink-0 flex items-center justify-center overflow-hidden bg-white transition-transform group-hover:scale-105"
              title="Logo Trường THPT Nguyễn Bỉnh Khiêm (An Giang)"
            >
              <SchoolLogo 
                customLogo={customLogo} 
                alt="Logo Trường THPT Nguyễn Bỉnh Khiêm (An Giang)" 
                style={{ width: '42px', height: '42px' }}
                className="rounded-full object-contain shrink-0"
              />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span 
                  style={{
                    fontSize: '28px',
                    fontWeight: 900,
                    lineHeight: 1,
                    color: '#ffffff',
                    WebkitTextStroke: '1.2px #10b981',
                    textShadow: '0 0 12px rgba(16, 185, 129, 0.7), 0 2px 4px rgba(0,0,0,0.5)',
                    paintOrder: 'stroke fill'
                  }}
                  className="tracking-tight select-none"
                >
                  EduSchedule
                </span>
                <span 
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: '6px',
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.4)',
                    boxShadow: '0 2px 6px rgba(16, 185, 129, 0.35)',
                    lineHeight: 1
                  }}
                  className="tracking-wider inline-block shrink-0"
                >
                  AI
                </span>
              </div>
              <div 
                style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#6ee7b7',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginTop: '2px'
                }}
                className="truncate max-w-[200px] sm:max-w-xs md:max-w-sm tracking-wide" 
                title={schoolInfo.schoolName ? schoolInfo.schoolName.replace(/^TRƯỜNG\s+/, '') : 'THPT NGUYỄN BỈNH KHIÊM'}
              >
                {schoolInfo.schoolName ? schoolInfo.schoolName.replace(/^TRƯỜNG\s+/, '') : 'THPT NGUYỄN BỈNH KHIÊM'}
              </div>
            </div>
          </div>

          {/* Academic Year & Semester Selector (Glassmorphism) */}
          <div className="flex items-center gap-2 shrink-0">
            <div 
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '12px',
                padding: '5px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
              className="shrink-0 shadow-2xs"
            >
              <Calendar className="w-4 h-4 shrink-0 hidden sm:block" style={{ color: '#34d399' }} />
              <select
                value={currentAcademicYear}
                onChange={(e) => handleYearChange(e.target.value)}
                style={{
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '13.5px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer'
                }}
                className="focus:outline-none"
                title="Chọn năm học"
              >
                {availableYears.map(year => (
                  <option key={year} value={year} className="bg-[#0b2447] text-white font-medium">
                    {year}
                  </option>
                ))}
                <option value="__add_new__" className="bg-[#0b2447] text-emerald-300 font-semibold">
                  + Thêm năm...
                </option>
              </select>

              <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontWeight: 400 }}>/</span>

              <select
                value={currentSemester}
                onChange={(e) => handleSemesterChange(e.target.value)}
                style={{
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '13.5px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer'
                }}
                className="focus:outline-none"
                title="Chọn học kỳ"
              >
                {AVAILABLE_SEMESTERS.map(sem => (
                  <option key={sem} value={sem} className="bg-[#0b2447] text-white font-medium">
                    {sem}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleToggleLockYear(currentAcademicYear)}
                style={
                  isCurrentTermLocked
                    ? {
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#fca5a5',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }
                    : {
                        background: 'rgba(16, 185, 129, 0.2)',
                        color: '#6ee7b7',
                        border: '1px solid rgba(52, 211, 153, 0.4)',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }
                }
                className="flex items-center gap-1 hover:brightness-110 active:scale-95 ml-1"
                title={isCurrentTermLocked ? 'Dữ liệu đang khóa. Nhấp để mở khóa.' : 'Dữ liệu đang mở. Nhấp để khóa.'}
              >
                {isCurrentTermLocked ? (
                  <>
                    <Lock className="w-3.5 h-3.5 text-rose-400" />
                    <span className="hidden sm:inline">Khóa</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3.5 h-3.5" style={{ color: '#34d399' }} />
                    <span className="hidden sm:inline">Mở</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Account Cluster & Help Button */}
          <div className="flex items-center gap-2 shrink-0">
            {/* NÚT HƯỚNG DẪN SỬ DỤNG & PHÍM TẮT */}
            <button
              type="button"
              onClick={() => setIsUserGuideModalOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                borderRadius: '10px',
                padding: '7px 13px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              className="hover:bg-white/15 hover:border-[#34d399] hover:shadow-[0_0_12px_rgba(52,211,153,0.3)] active:scale-95 shadow-2xs"
              title="Hướng dẫn sử dụng & Phím tắt ứng dụng (Phím tắt: F1 hoặc ?)"
            >
              <HelpCircle className="w-4 h-4 text-emerald-300 shrink-0" />
              <span className="hidden sm:inline">Hướng dẫn</span>
              <span className="text-[10px] bg-emerald-500/25 text-emerald-200 px-1.5 py-0.5 rounded border border-emerald-400/40 font-mono hidden md:inline">
                F1
              </span>
            </button>

            {currentUser && role !== 'GUEST' ? (
              <div 
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(52, 211, 153, 0.45)',
                  borderRadius: '10px',
                  padding: '5px 12px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                className="shadow-2xs shrink-0"
              >
                {/* Đèn LED xanh lá chỉ báo Online có hiệu ứng sóng xung nhịp (pulse animation) & Khiên bảo vệ & Tên tài khoản & Badge */}
                <button
                  type="button"
                  onClick={openLoginModal}
                  className="flex items-center gap-2 text-white hover:text-emerald-300 transition cursor-pointer select-none"
                  title={`Vai trò: ${role}. Bấm để mở bảng tài khoản & quản trị.`}
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e] shadow-[0_0_6px_#22c55e]"></span>
                  </span>
                  <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: '#34d399' }} />
                  <span className="font-bold text-white flex items-center gap-1.5 whitespace-nowrap">
                    <span>
                      {role === 'ADMIN' 
                        ? 'Quản trị viên' 
                        : (currentUser?.displayName || currentUser?.username || 'Người dùng')}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${
                      role === 'ADMIN' ? 'bg-amber-400 text-amber-950 font-black' :
                      role === 'HEAD_OF_DEPARTMENT' ? 'bg-indigo-300 text-indigo-950' :
                      'bg-emerald-300 text-emerald-950'
                    }`}>
                      {role === 'ADMIN' ? '👑 ADMIN' : role === 'HEAD_OF_DEPARTMENT' ? '🎖️ Tổ trưởng' : '👨‍🏫 GV'}
                    </span>
                  </span>
                </button>

                {isAdmin && (
                  <>
                    <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>|</span>
                    <button
                      type="button"
                      onClick={() => setIsSettingsModalOpen(true)}
                      className="text-white/90 hover:text-emerald-300 transition cursor-pointer flex items-center gap-1 font-semibold text-xs whitespace-nowrap shrink-0"
                      title="Cài đặt hệ thống & Thông tin trường học, đổi logo trường"
                    >
                      <Settings className="w-3.5 h-3.5" style={{ color: '#6ee7b7' }} />
                      <span className="hidden sm:inline">Cài đặt</span>
                    </button>
                  </>
                )}

                <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>|</span>

                <button
                  type="button"
                  onClick={logout}
                  className="text-white/70 hover:text-rose-300 transition cursor-pointer flex items-center gap-1 font-semibold text-xs whitespace-nowrap shrink-0"
                  title="Đăng xuất khỏi tài khoản"
                >
                  <span>Đăng xuất</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openLoginModal}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(52, 211, 153, 0.45)',
                  borderRadius: '10px',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)'
                }}
                className="hover:bg-white/15 hover:border-[#34d399] hover:shadow-[0_0_12px_rgba(52,211,153,0.3)] active:scale-95 shadow-2xs"
                title="Đăng nhập tài khoản (Admin, Tổ trưởng chuyên môn, Giáo viên)"
              >
                {/* Đèn LED xanh lá chỉ báo Online có hiệu ứng sóng xung nhịp (pulse animation) */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e] shadow-[0_0_6px_#22c55e]"></span>
                </span>
                <KeyRound className="w-3.5 h-3.5 shrink-0" style={{ color: '#6ee7b7' }} />
                <span>Đăng nhập</span>
                <span className="text-[10px] bg-white/20 text-emerald-100 px-1.5 py-0.5 rounded font-medium">Khách</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* THÔNG BÁO CHUYỂN NĂM HỌC / HỌC KỲ */}
      {termNotification && (
        <div className="bg-emerald-600 text-white text-xs md:text-sm font-semibold py-1.5 px-4 text-center shadow-md flex items-center justify-center gap-2 animate-in fade-in duration-200 print:hidden">
          <CheckCircle className="w-4 h-4 text-emerald-200 shrink-0" />
          <span>{termNotification}</span>
        </div>
      )}

      {/* QUICK ACTIONS SUBBAR */}
      <div 
        className="bg-slate-50/70 border-b border-slate-200/80 shadow-2xs print:hidden"
        style={{
          paddingTop: "6px",
          paddingBottom: "6px",
          marginBottom: "0px"
        }}
      >
        <div 
          className={`mx-auto px-2 md:px-3 flex items-center justify-center transition-all duration-200 overflow-x-auto no-scrollbar ${
            isBoardFullscreen && activeTab === "board" ? "max-w-none px-2 md:px-4 justify-start" : "max-w-7xl"
          }`}
          style={{
            overflowX: "auto",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            WebkitOverflowScrolling: "touch"
          }}
        >
          {/* NAVIGATION TABS: MODERN COMPACT FLOATING NAVIGATION */}
          <div 
            className="w-auto bg-white/95 backdrop-blur-md rounded-xl border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.05)] shrink-0 flex items-center no-scrollbar"
            style={{
              padding: "3px 6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              flexWrap: "nowrap",
              marginBottom: "0px",
              minHeight: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none"
            }}
          >
            {/* 1. Giáo viên */}
            <button
              type="button"
              onClick={() => setActiveTab("teachers")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "teachers"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Danh sách & chuyên môn giáo viên"
            >
              <Users className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "teachers" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Giáo viên</span>
            </button>

            {/* 2. Môn học */}
            <button
              type="button"
              onClick={() => setActiveTab("subject_catalog")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "subject_catalog"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Danh mục môn học toàn trường, mã môn, tổ bộ môn & định mức chuẩn"
            >
              <BookOpen className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "subject_catalog" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Môn học</span>
            </button>

            {/* 3. Lớp học */}
            <button
              type="button"
              onClick={() => setActiveTab("classes")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "classes"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Danh mục các khối lớp (44 lớp, ban/tổ hợp môn)"
            >
              <GraduationCap className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "classes" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Lớp học</span>
            </button>

            {/* 4. Khai báo số tiết */}
            <button
              type="button"
              onClick={() => setActiveTab("subjects")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "subjects"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Bảng kế hoạch phân phối số tiết của từng môn theo khối lớp"
            >
              <ClipboardList className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "subjects" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Khai báo số tiết</span>
            </button>

            {/* 5. Bảng phân công */}
            <button
              type="button"
              onClick={() => setActiveTab("board")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "board"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Bảng phân công giảng dạy & Chủ nhiệm"
            >
              <ClipboardList className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "board" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Bảng phân công</span>
            </button>

            {/* 6. Thời khóa biểu */}
            <button
              type="button"
              onClick={() => setActiveTab("timetable")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "timetable"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Phân hệ xếp Thời khóa biểu (TKB)"
            >
              <Calendar className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "timetable" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Thời khóa biểu</span>
            </button>

            {/* 7. Gửi phân công và TKB */}
            <button
              type="button"
              onClick={() => setIsSendScheduleModalOpen(true)}
              className="group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 font-medium text-slate-600 hover:text-blue-700 hover:bg-blue-50/80"
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Trung tâm Gửi phân công và TKB chuyên môn cá nhân hóa qua Gmail & Zalo"
            >
              <Send className="w-[14px] h-[14px] shrink-0 text-blue-600 group-hover:scale-110 transition-transform" />
              <span className="whitespace-nowrap font-semibold text-blue-900">Gửi phân công và TKB</span>
            </button>

            {/* 8. Thống kê và phân tích */}
            <button
              type="button"
              onClick={() => setActiveTab("stats")}
              className={`group px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 ${
                activeTab === "stats"
                  ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-semibold shadow-sm shadow-indigo-500/25"
                  : "font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              style={{
                whiteSpace: "nowrap",
                gap: "5px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Thống kê và phân tích chuyên sâu phân công giảng dạy"
            >
              <BarChart3 className={`w-[14px] h-[14px] shrink-0 transition-colors ${activeTab === "stats" ? "text-white" : "text-slate-500 group-hover:text-indigo-600"}`} />
              <span className="whitespace-nowrap">Thống kê và phân tích</span>
            </button>

            {/* Divider */}
            <span className="w-px h-4 bg-slate-200 mx-0.5 shrink-0 hidden sm:inline-block" />

            {/* 9. Hướng dẫn sử dụng */}
            <button
              type="button"
              onClick={() => setIsUserGuideModalOpen(true)}
              className="group px-2.5 py-1.5 rounded-lg transition-all duration-200 ease-in-out flex items-center cursor-pointer select-none shrink-0 font-medium text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
              style={{
                whiteSpace: "nowrap",
                gap: "4px",
                fontSize: "0.82rem",
                lineHeight: 1.3
              }}
              title="Hướng dẫn sử dụng & Phím tắt ứng dụng (Phím tắt: F1 hoặc ?)"
            >
              <HelpCircle className="w-[14px] h-[14px] shrink-0 text-emerald-600 group-hover:scale-110 transition-transform" />
              <span className="whitespace-nowrap">Hướng dẫn</span>
            </button>
          </div>
        </div>
      </div>

{/* MAIN CONTAINER */}
      <div className={`flex-1 w-full mx-auto px-2 md:px-3 pt-0.5 ${(activeTab === 'subjects' || activeTab === 'subject_catalog') ? 'pb-1' : 'pb-4'} flex flex-col lg:flex-row gap-4 transition-all duration-200 ${
        isBoardFullscreen && activeTab === 'board' ? 'max-w-none px-2 md:px-4' : 'max-w-7xl'
      }`}>
        
        {/* LEFT COLUMN: ACTIVE WORK TAB */}
        <main className={`flex-1 flex flex-col min-w-0 ${
          activeTab === 'timetable'
            ? 'bg-transparent border-0 shadow-none overflow-visible'
            : (activeTab === 'welcome' || activeTab === null)
              ? 'bg-transparent border-0 shadow-none overflow-visible justify-center items-center'
              : 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden'
        } ${
          isFullscreen && activeTab === 'board'
            ? 'fixed inset-0 z-50 bg-white w-screen h-screen p-4 flex flex-col rounded-none border-0'
            : ''
        }`}>
          
          {/* TAB 1: MAIN ASSIGNMENT GRID */}
          {activeTab === 'board' && (
            <div className={`flex-1 flex flex-col min-h-0 ${isBoardFullscreen ? 'h-full' : 'p-2.5 md:p-3'}`}>
              {/* TẦNG 1: HEADER & TOOLBAR 2 HÀNG CÂN ĐỐI, GỌN GÀNG, KHÔNG BỊ TRÀN KHUNG */}
              <div className="flex flex-col gap-2 w-full mb-2 shrink-0 bg-white rounded-xl p-2.5 md:p-3 border border-slate-200/90 shadow-2xs">
                {/* HÀNG 1 (Header Info): Tiêu đề, Badges + Cụm tiện ích phụ (Gửi TKB, Toàn màn hình) */}
                <div className="flex items-center justify-between gap-3 w-full pb-2 border-b border-slate-100 flex-wrap sm:flex-nowrap">
                  {/* Bên trái: Icon bảng, Tiêu đề, Badges */}
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg text-white shadow-xs shrink-0 flex items-center justify-center">
                      <School className="w-4 h-4" />
                    </div>
                    <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
                      Bảng phân công
                    </h2>

                    <span className="text-[11px] md:text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                      {currentSemester} • {currentAcademicYear}
                    </span>

                    <span className="text-[11px] md:text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                      {classes.length} Lớp
                    </span>

                    {/* Badge trạng thái Khóa / Mở khóa */}
                    <button
                      type="button"
                      onClick={() => handleToggleLockYear(currentAcademicYear)}
                      className={`inline-flex items-center gap-1.5 text-[11px] md:text-xs font-bold px-2.5 py-0.5 rounded-full border transition cursor-pointer shrink-0 shadow-2xs ${
                        isCurrentTermLocked
                          ? 'bg-rose-100 hover:bg-rose-200 text-rose-800 border-rose-300'
                          : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border-emerald-300'
                      }`}
                      title={
                        isCurrentTermLocked
                          ? `Dữ liệu năm học ${currentAcademicYear} đang KHÓA (chống sửa đổi). Nhấp để mở khóa.`
                          : `Dữ liệu năm học ${currentAcademicYear} đang MỞ (cho phép chỉnh sửa). Nhấp để khóa bảo vệ dữ liệu.`
                      }
                    >
                      {isCurrentTermLocked ? (
                        <>
                          <Lock className="w-3 h-3 text-rose-600 shrink-0" />
                          <span>Đã khóa dữ liệu</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>Đang mở chỉnh sửa</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Bên phải: Cụm tiện ích phụ gồm nút Toàn màn hình cố định */}
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className={`h-8 px-3 py-1.5 text-xs sm:text-sm font-bold rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-2xs hover:shadow-xs whitespace-nowrap shrink-0 ${
                        isFullscreen
                          ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 ring-2 ring-amber-200/50'
                          : 'bg-white hover:bg-blue-50 text-blue-700 border-blue-300 hover:border-blue-400'
                      }`}
                      title={isFullscreen ? "Thu nhỏ lại kích thước chuẩn (hoặc bấm Esc)" : "Mở rộng toàn màn hình"}
                    >
                      {isFullscreen ? (
                        <>
                          <Minimize2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          <span>🗗 Thu nhỏ</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>⛶ Toàn màn hình</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* HÀNG 2 (Action Toolbar): Dành toàn bộ diện tích cho các nút thao tác chính */}
                <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5 w-full">
                  {isAdmin && (
                    <>
                      {/* [✨ AI phân công] */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isCurrentTermLocked) {
                            showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Hãy bấm "Mở khóa" trên thanh tiêu đề nếu muốn phân công AI.`);
                            return;
                          }
                          setIsAiOptimizeModalOpen(true);
                        }}
                        disabled={isAiOptimizing}
                        className={`h-8 px-2.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg border transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                          isCurrentTermLocked
                            ? 'opacity-60 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            : 'border-indigo-300 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700'
                        }`}
                        title="AI phân công tự động thông minh (có tùy chọn cấu hình ràng buộc cứng & mềm)"
                      >
                        <Sparkles className={`w-3.5 h-3.5 text-indigo-600 ${isAiOptimizing ? 'animate-spin' : ''}`} />
                        <span>{isAiOptimizing ? 'Đang xếp...' : 'AI phân công'}</span>
                      </button>

                      {/* [🧹 Rà soát 0t] */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isCurrentTermLocked) {
                            showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                            return;
                          }
                          const { cleaned, removedCount } = cleanAssignmentsForZeroPeriodSubjects(assignments.subjectAssignments, { notify: true });
                          if (removedCount > 0) {
                            setAssignments(prev => ({
                              ...prev,
                              subjectAssignments: cleaned
                            }));
                          }
                        }}
                        disabled={isCurrentTermLocked}
                        className="h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-amber-800 transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 disabled:opacity-60"
                        title="Quét toàn bộ 44 lớp: tự động xóa gán mọi môn có 0 tiết khai báo và hoàn lại số tiết cho giáo viên"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>Rà soát 0t</span>
                      </button>

                      {/* [✨ Nhập AI] */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isCurrentTermLocked) {
                            showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                            return;
                          }
                          setNlImportType('assignments');
                          setIsNlImportOpen(true);
                        }}
                        className="h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium bg-white hover:bg-slate-50 text-indigo-700 border border-slate-300 rounded-lg shadow-2xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                        title="Nhập phân công giảng dạy & chủ nhiệm bằng ngôn ngữ tự nhiên AI"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Nhập AI</span>
                      </button>
                    </>
                  )}

                  {/* [☁️ Lưu Cloud] - Nổi bật, nền xanh đậm */}
                  <button
                    type="button"
                    onClick={handleSaveAssignmentsToCloud}
                    disabled={isSavingAssignmentsCloud || isSyncing}
                    className="h-8 px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-lg border border-blue-600 bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0"
                    title="Lưu trực tiếp phân công lên Cloud Firestore an toàn tuyệt đối"
                  >
                    <Cloud className={`w-4 h-4 text-white ${isSavingAssignmentsCloud ? 'animate-spin' : ''}`} />
                    <span>{isSavingAssignmentsCloud ? 'Đang lưu...' : 'Lưu Cloud'}</span>
                  </button>

                  {/* [💾 Sao lưu] */}
                  <button
                    type="button"
                    onClick={handleExportAllBackupJson}
                    className="h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                    title="Tải toàn bộ dữ liệu (101 GV, 44 lớp, phân công, TKB) về máy tính làm file dự phòng JSON"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Sao lưu</span>
                  </button>

                  {/* [🖨️ In/Xuất] */}
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                    title="Mở bảng in và xuất báo cáo (PDF, Word, Excel)"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-500" />
                    <span>In/Xuất</span>
                  </button>

                  {/* [💬 Trợ lý AI] */}
                  <button
                    type="button"
                    onClick={() => setIsAiSidebarOpen(prev => !prev)}
                    className={`h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                      isAiSidebarOpen
                        ? 'bg-indigo-600 text-white border-indigo-700 font-semibold'
                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                    }`}
                    title="Bật/Tắt khung Trợ lý Phân công AI"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{isAiSidebarOpen ? 'Đóng AI' : 'Trợ lý AI'}</span>
                  </button>

                  {/* [🗑️ Xóa] hoặc [Mở khóa sửa] */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleClearAssignments}
                      disabled={isCurrentTermLocked}
                      className={`h-8 px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                        isCurrentTermLocked
                          ? 'opacity-60 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'border-slate-300 bg-white text-slate-600 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
                      }`}
                      title={isCurrentTermLocked ? `Dữ liệu năm học ${currentAcademicYear} đang khóa` : 'Xóa phân công để làm lại'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa</span>
                    </button>
                  )}

                  {!isAdmin && (
                    <button
                      type="button"
                      onClick={openLoginModal}
                      className="h-8 px-2.5 py-1.5 text-xs sm:text-sm font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg shadow-2xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                      title="Đăng nhập Quản trị viên để phân công giáo viên"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                      <span>Mở khóa sửa</span>
                    </button>
                  )}
                </div>
              </div>

              {/* TẦNG 2: DẢI CHỈ SỐ THỐNG KÊ SIÊU GỌN (COMPACT STRIP - CAO ~30px) */}
              <div className="h-7 md:h-8 px-3 bg-slate-50 border border-slate-200/90 rounded-md flex items-center justify-between text-[11px] md:text-xs text-slate-600 overflow-x-auto whitespace-nowrap mb-1.5 gap-2 shrink-0">
                <div className="flex items-center gap-2 flex-nowrap shrink-0">
                  <span><strong className="font-bold text-slate-900">{statsCount.classesCount}</strong> Lớp</span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span><strong className="font-bold text-slate-900">{statsCount.assignedTeachersCount}/{statsCount.teachersCount}</strong> GV</span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span>Chủ nhiệm: <strong className={`font-bold ${statsCount.homeroomAssigned === statsCount.classesCount ? 'text-emerald-700' : 'text-slate-900'}`}>{statsCount.homeroomAssigned}/{statsCount.classesCount}</strong></span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span>Đã phân công: <strong className="font-bold text-slate-900">{statsCount.totalPeriodsAssigned}/{statsCount.totalRequiredPeriods}</strong> tiết</span>
                  <span className="text-slate-300 font-bold">•</span>
                  {conflictsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                      <AlertTriangle className="w-3 h-3 text-rose-500 inline shrink-0" />
                      Xung đột: {conflictsCount} cảnh báo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <CheckCircle className="w-3 h-3 text-emerald-600 inline shrink-0" />
                      0 Xung đột ✓
                    </span>
                  )}
                </div>
              </div>

              {showAutoAssignNotice && aiExplanation && (
                <div className="mb-2 bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-indigo-50/90 border border-indigo-200/90 rounded-lg p-2 px-3 text-xs text-indigo-950 shrink-0 shadow-2xs transition-all">
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 animate-pulse" />
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-bold text-indigo-950 whitespace-nowrap">
                          Lưu ý về phương án AI phân công:
                        </span>
                        {!isAutoAssignNoticeExpanded && (
                          <span className="text-slate-600 truncate text-[11.5px] italic hidden sm:inline-block">
                            {aiExplanation.replace(/\*\*/g, '').replace(/\n+/g, ' ')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsAutoAssignNoticeExpanded(prev => !prev)}
                        className="px-2 py-0.5 rounded text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-100/80 hover:bg-indigo-100 border border-indigo-200/70 flex items-center gap-1 transition cursor-pointer"
                        title={isAutoAssignNoticeExpanded ? 'Thu gọn nội dung' : 'Xem đầy đủ chi tiết'}
                      >
                        <span>{isAutoAssignNoticeExpanded ? 'Thu gọn' : 'Chi tiết'}</span>
                        {isAutoAssignNoticeExpanded ? (
                          <ChevronUp className="w-3 h-3 text-indigo-600" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-indigo-600" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowAutoAssignNotice(false)}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        title="Đóng thông báo (✕)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isAutoAssignNoticeExpanded && (
                    <div className="mt-2 pt-2 border-t border-indigo-100/90 text-xs text-slate-700 leading-relaxed max-h-56 overflow-y-auto space-y-1.5 pl-6 pr-1">
                      {aiExplanation.split('\n').filter(line => line.trim()).map((line, idx) => {
                        const cleanLine = line.trim();
                        const isMainTitle = cleanLine.startsWith('🎯') || cleanLine.startsWith('**');
                        return (
                          <div 
                            key={idx} 
                            className={`${isMainTitle ? 'font-medium text-indigo-950' : 'text-slate-700'} ${cleanLine.startsWith('-') ? 'pl-2' : ''}`}
                          >
                            {cleanLine.split(/(\*\*[^*]+\*\*)/g).map((chunk, cIdx) => {
                              if (chunk.startsWith('**') && chunk.endsWith('**')) {
                                return (
                                  <strong key={cIdx} className="font-semibold text-slate-900">
                                    {chunk.slice(2, -2)}
                                  </strong>
                                );
                              }
                              return <span key={cIdx}>{chunk}</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* HIGH-DENSITY TABLE GRID */}
              <div className={`overflow-x-auto overflow-y-auto border border-slate-300 rounded-lg shadow-2xs bg-white ${
                isBoardFullscreen ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-210px)] min-h-[460px]'
              }`}>
                <table className="w-full text-left border-collapse min-w-[1100px] text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs">
                    <tr className="bg-slate-100 border-b border-slate-300 text-xs">
                      <th className="py-1.5 px-2 sticky left-0 top-0 bg-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-30 w-20 text-center font-bold text-blue-900 border border-slate-300">
                        Lớp
                      </th>
                      <th className="py-1.5 px-2 bg-blue-50/80 w-48 text-blue-900 font-bold text-center border border-slate-300">
                        GVCN
                      </th>
                      <th className="py-1.5 px-2 text-center w-36 bg-sky-50 text-blue-900 font-bold border border-slate-300 whitespace-nowrap">
                        Tổng số tiết
                      </th>
                      {SUBJECTS.map(sub => {
                        const headerLabel = 
                          sub.id === 'GD' || sub.id === 'GDKTPL' ? 'GDKTPL' :
                          sub.id === 'CN (Công nghiệp)' || sub.id === 'CNCN' ? 'CNCN' :
                          sub.id === 'CN (Nông nghiệp)' || sub.id === 'CNNN' ? 'CNNN' :
                          normalizeSubjectName(sub.id) === 'GDQPAN' ? 'GDQPAN' :
                          sub.name || sub.id;

                        return (
                          <th key={sub.id} className="py-1.5 px-1.5 font-bold text-blue-900 text-center min-w-[95px] border border-slate-300" title={sub.name}>
                            {headerLabel}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map(cls => {
                      const homeroomId = assignments.homeroomAssignments?.[cls.id];
                      const homeroomTeacher = teachers.find(t => t.id === homeroomId);

                      // 1. Nguồn dữ liệu định mức chuẩn (KHÔNG ĐƯỢC HARDCODE SỐ 29 HOẶC CỐ ĐỊNH):
                      // Tính động từ bảng "Khai báo số tiết" (lessonHoursMap)
                      const hoursObj = lessonHoursMap[cls.id] || {};
                      const totalRequired = Object.values(hoursObj).reduce((sum, h) => sum + (Number(h) || 0), 0);

                      // 2. Logic tính tổng số tiết thực tế đã phân công (totalAssigned):
                      // Duyệt qua các môn của lớp trong state phân công (assignments.subjectAssignments[cls.id])
                      // Phụ thuộc trực tiếp vào state assignments để re-render ngay khi người dùng chọn/đổi giáo viên
                      const currentAssignments = assignments.subjectAssignments?.[cls.id] || 
                        assignments.subjectAssignments?.[cls.id.replace(/^c_/, '')] || 
                        (cls.name ? assignments.subjectAssignments?.[cls.name] : {}) || {};
                      
                      const countedSubjects = new Set<string>();
                      const totalAssigned = Object.entries(currentAssignments).reduce((sum, [subCode, teacherId]) => {
                        if (!teacherId) return sum;
                        const norm = normalizeSubjectName(subCode);
                        if (countedSubjects.has(norm)) return sum;
                        countedSubjects.add(norm);
                        const hours = Number(hoursObj[subCode] ?? hoursObj[norm] ?? getSubjectPeriod(subCode, cls.grade, cls.id)) || 0;
                        return sum + hours;
                      }, 0);

                      const isFull = totalRequired > 0 && totalAssigned === totalRequired;
                      const isOver = totalAssigned > totalRequired;
                      const isUnder = totalRequired > 0 && totalAssigned < totalRequired;

                      return (
                        <tr key={cls.id} className="hover:bg-slate-50/80 transition-colors h-[34px]">
                          {/* Class cell (Sticky) */}
                          <td className="py-1 px-2 font-bold text-slate-900 sticky left-0 bg-white hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 text-center border border-slate-300 text-xs">
                            <div className="flex flex-col items-center justify-center leading-tight">
                              <span className="font-bold text-slate-900">{cls.name}</span>
                              <span 
                                className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded mt-0.5 border ${
                                  isFull
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                    : isOver
                                    ? 'bg-rose-50 text-rose-700 border-rose-300'
                                    : 'bg-amber-50 text-amber-800 border-amber-300'
                                }`}
                                title={`Lớp ${cls.name}: Đã phân công ${totalAssigned} / ${totalRequired} tiết (Chuẩn theo Khai báo số tiết).`}
                              >
                                {totalAssigned}/{totalRequired}t
                              </span>
                            </div>
                          </td>

                          {/* Homeroom cell */}
                          {(() => {
                            const hrStat = homeroomTeacher ? teacherStatsMap[homeroomTeacher.id] : null;
                            const hrTotal = hrStat?.totalPeriods ?? 0;
                            const hrMaxQuota = hrStat?.maxQuota ?? (homeroomTeacher?.maxPeriods || 17);
                            const hrOverloaded = hrStat ? hrTotal > hrMaxQuota : false;
                            const hrExcess = hrOverloaded ? hrTotal - hrMaxQuota : 0;
                            const hrExceedingGrades = hrStat ? hrStat.assignedGrades.size >= 3 : false;
                            const hrHasViolation = !!homeroomTeacher && (hrOverloaded || hrExceedingGrades);

                            const hrViolationMessages: string[] = [];
                            if (hrOverloaded) {
                              hrViolationMessages.push(`⚠️ Cảnh báo: Đã dạy ${hrTotal}/${hrMaxQuota} tiết (Vượt ${hrExcess} tiết)`);
                            }
                            if (hrExceedingGrades && hrStat) {
                              hrViolationMessages.push(`⚠️ Cảnh báo: Giáo viên đang dạy cả 3 khối (${Array.from(hrStat.assignedGrades).sort().join(', ')})`);
                            }
                            const hrViolationTooltip = hrViolationMessages.join('\n');

                            return (
                              <td 
                                onClick={() => {
                                  if (!isAdmin) {
                                    showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để can thiệp dữ liệu phân công!');
                                    openLoginModal();
                                    return;
                                  }
                                  if (isCurrentTermLocked) {
                                    showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                                    return;
                                  }
                                  setSelectedHomeroomCell({ classId: cls.id, currentTeacherId: homeroomId || '' });
                                }}
                                style={{
                                  backgroundColor: hrHasViolation ? 'rgba(239, 68, 68, 0.08)' : undefined
                                }}
                                className={`py-1 px-2 border transition-colors text-left text-xs ${
                                  hrHasViolation ? 'border-rose-300 ring-1 ring-rose-200/50' : 'border-slate-300'
                                } ${
                                  !isAdmin || isCurrentTermLocked
                                    ? 'bg-slate-50/50 cursor-not-allowed'
                                    : hrHasViolation
                                    ? 'cursor-pointer hover:bg-rose-100/60'
                                    : 'cursor-pointer bg-blue-50/20 hover:bg-blue-100/50'
                                }`}
                                title={
                                  hrHasViolation
                                    ? `${hrViolationTooltip}\n---\nGVCN: ${homeroomTeacher?.name} (${hrTotal}t / định mức ${hrMaxQuota}t)\n(Nhấp để đổi GVCN)`
                                    : !isAdmin ? 'Chế độ Chỉ xem.' : (isCurrentTermLocked ? `Dữ liệu đang khóa. GVCN: ${homeroomTeacher?.name}` : 'Bấm để phân công hoặc đổi GVCN')
                                }
                              >
                                {homeroomTeacher ? (
                                  <div className="flex items-center justify-between gap-1 leading-tight">
                                    <div className="truncate min-w-0">
                                      <div className={`truncate flex items-center gap-1 font-normal text-[13px] ${hrHasViolation ? 'text-rose-950 font-semibold' : 'text-slate-800'}`}>
                                        <span className="truncate">{homeroomTeacher.name}</span>
                                        {hrHasViolation && (
                                          <span className="text-[11px] shrink-0 select-none" title={hrViolationTooltip}>
                                            ⚠️
                                          </span>
                                        )}
                                      </div>
                                      <span className={`text-[11.5px] font-normal block leading-tight mt-0.5 ${hrOverloaded ? 'text-rose-600 font-bold' : 'text-blue-700'}`} title={`Tổng số tiết dạy của ${homeroomTeacher.name}: ${hrTotal} tiết / định mức ${hrMaxQuota}t`}>
                                        Tổng: {hrTotal}t
                                      </span>
                                      {(() => {
                                        const hrSpecSub = resolveTeacherSubject(homeroomTeacher, SUBJECTS);
                                        const hrAssignedSubTeacherId = getAssignedTeacherId(cls.id, hrSpecSub);
                                        const isTeachingHomeroomClass = hrAssignedSubTeacherId === homeroomTeacher.id || 
                                          Object.entries(assignments.subjectAssignments[cls.id] || {}).some(([s, tId]) => tId === homeroomTeacher.id);
                                        if (!isTeachingHomeroomClass) {
                                          return (
                                            <span 
                                              className="text-[9.5px] font-bold text-amber-900 bg-amber-100 border border-amber-300 px-1 py-0.2 rounded inline-block mt-0.5 leading-none shadow-2xs" 
                                              title={`CẢNH BÁO: GVCN (${homeroomTeacher.name}) chưa được phân công môn giảng dạy nào tại lớp ${cls.name}!`}
                                            >
                                              ⚠️ Chưa dạy lớp
                                            </span>
                                          );
                                        }
                                        return null;
                                      })()}
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-normal shrink-0">({homeroomTeacher.experienceYears}N)</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-400 font-normal text-xs italic flex items-center gap-1 justify-center">
                                    <UserPlus className="w-3 h-3" /> Chưa phân công
                                  </span>
                                )}
                              </td>
                            );
                          })()}

                          {/* Cột Tổng số tiết phân công */}
                          <td className="py-1 px-2 text-center bg-sky-50/30 border border-slate-300 align-middle">
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              <span 
                                className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md font-bold text-xs shadow-2xs whitespace-nowrap border ${
                                  isFull
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : isOver
                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                    : totalAssigned > 0
                                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                                    : 'bg-slate-100 text-slate-500 border-slate-300'
                                }`}
                                title={`Lớp ${cls.name}: Đã phân công ${totalAssigned} / ${totalRequired} tiết. ${
                                  isFull 
                                    ? 'Đã đủ số tiết chuẩn theo Khai báo số tiết ✓' 
                                    : isUnder 
                                    ? `Còn thiếu ${totalRequired - totalAssigned} tiết!` 
                                    : `Vượt ${totalAssigned - totalRequired} tiết!`
                                }`}
                              >
                                {totalAssigned} / {totalRequired} tiết
                              </span>
                              {totalRequired > 0 && !isFull && (
                                <span className={`text-[10px] font-semibold ${isUnder ? 'text-amber-700' : 'text-rose-600'}`}>
                                  {isUnder ? `(Thiếu ${totalRequired - totalAssigned}t)` : `(Vượt ${totalAssigned - totalRequired}t)`}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Subject cells */}
                          {SUBJECTS.map(sub => {
                            const teacherId = getAssignedTeacherId(cls.id, sub.id);
                            const teacher = teachers.find(t => t.id === teacherId);
                            const period = getSubjectPeriod(sub.id, cls.grade, cls.id);
                            const isZeroPeriod = period === 0;
                            const teacherStat = teacher ? teacherStatsMap[teacher.id] : null;
                            const teacherTotal = teacherStat?.totalPeriods ?? 0;
                            const maxQuota = teacherStat?.maxQuota ?? (teacher?.maxPeriods || 17);
                            const isOverloaded = teacherStat ? teacherTotal > maxQuota : false;
                            const excessPeriods = isOverloaded ? teacherTotal - maxQuota : 0;
                            const isExceedingGrades = teacherStat ? teacherStat.assignedGrades.size >= 3 : false;
                            const hasViolation = !!teacher && !isZeroPeriod && (isOverloaded || isExceedingGrades);

                            const violationMessages: string[] = [];
                            if (isOverloaded) {
                              violationMessages.push(`⚠️ Cảnh báo: Đã dạy ${teacherTotal}/${maxQuota} tiết (Vượt ${excessPeriods} tiết)`);
                            }
                            if (isExceedingGrades && teacherStat) {
                              violationMessages.push(`⚠️ Cảnh báo: Giáo viên đang dạy cả 3 khối (${Array.from(teacherStat.assignedGrades).sort().join(', ')})`);
                            }
                            const violationTooltip = violationMessages.join('\n');

                            // Nếu lớp không học môn này (0 tiết trong khai báo): ô phân công để trống hoàn toàn (0t / —)
                            if (isZeroPeriod) {
                              return (
                                <td
                                  key={sub.id}
                                  className="py-1 px-1 text-center border border-slate-200 bg-slate-50/50 text-slate-300 align-middle select-none"
                                  title={`Lớp ${cls.name} không học môn ${sub.name} (0 tiết trong khai báo).`}
                                >
                                  <span className="text-[11px] font-normal text-slate-300 select-none block leading-none">—</span>
                                </td>
                              );
                            }

                            return (
                              <td 
                                key={sub.id}
                                onClick={() => {
                                  if (!isAdmin) {
                                    showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để can thiệp dữ liệu phân công!');
                                    openLoginModal();
                                    return;
                                  }
                                  if (isCurrentTermLocked) {
                                    showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                                    return;
                                  }
                                  setSelectedCell({ classId: cls.id, subject: sub.id, currentTeacherId: teacherId || '' });
                                }}
                                style={{
                                  backgroundColor: hasViolation ? 'rgba(239, 68, 68, 0.08)' : undefined
                                }}
                                className={`py-1 px-1 text-center border transition-all align-middle ${
                                  hasViolation ? 'border-rose-300 ring-1 ring-rose-200/50' : 'border-slate-300'
                                } ${
                                  !isAdmin || isCurrentTermLocked 
                                    ? 'cursor-not-allowed hover:bg-slate-50' 
                                    : hasViolation
                                    ? 'cursor-pointer hover:bg-rose-100/60'
                                    : 'cursor-pointer hover:bg-slate-100/80'
                                }`}
                                title={
                                  hasViolation
                                    ? `${violationTooltip}\n---\nLớp ${cls.name} - Môn ${sub.name}: ${teacher.name} (${period}t)\n(Nhấp để xem/đổi phân công)`
                                    : !isAdmin ? 'Chế độ Chỉ xem. Bấm Đăng nhập Quản trị để thay đổi giáo viên.' : (isCurrentTermLocked ? `Dữ liệu năm học ${currentAcademicYear} đang khóa. Bấm "Mở khóa" nếu cần sửa.` : undefined)
                                }
                              >
                                {teacher ? (
                                  <div className="inline-block w-full text-center px-0.5">
                                    <div 
                                      className={`font-normal truncate leading-tight text-[13px] flex items-center justify-center gap-1 ${
                                        hasViolation ? 'text-rose-950 font-semibold' : 'text-slate-800'
                                      }`} 
                                      title={hasViolation ? violationTooltip : teacher.name}
                                    >
                                      <span className="truncate">{teacher.name.replace('Thầy ', '').replace('Cô ', '')}</span>
                                      {assignments.homeroomAssignments[cls.id] === teacher.id && (
                                        <span 
                                          className="text-[9px] font-black px-1 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0 leading-none shadow-2xs" 
                                          title={`Giáo viên chủ nhiệm lớp ${cls.name}`}
                                        >
                                          GVCN
                                        </span>
                                      )}
                                      {hasViolation && (
                                        <span 
                                          className="text-[11px] shrink-0 select-none animate-pulse" 
                                          title={violationTooltip}
                                        >
                                          ⚠️
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-center gap-1 mt-0.5 leading-none font-normal">
                                      <span 
                                        className={`font-normal px-1 py-0.2 rounded text-[11px] whitespace-nowrap ${
                                          isOverloaded 
                                            ? 'bg-rose-100 text-rose-700 font-bold border border-rose-300' 
                                            : 'bg-blue-50 text-blue-700'
                                        }`}
                                        title={`GV ${teacher.name}: Tổng ${teacherTotal}t / định mức ${maxQuota}t`}
                                      >
                                        {teacherTotal}t
                                      </span>
                                      <span className="text-slate-400 font-mono text-[11px] font-normal" title={`Số tiết môn này của lớp ${cls.name}: ${period} tiết`}>
                                        ({period}t)
                                      </span>
                                    </div>
                                    {isExceedingGrades && (
                                      <div className="mt-0.5">
                                        <span className="text-[9px] bg-rose-100 text-rose-700 font-semibold px-1 rounded inline-block leading-none border border-rose-200" title={`Giáo viên dạy cả 3 khối: ${Array.from(teacherStat!.assignedGrades).sort().join(', ')}`}>
                                          3 khối
                                        </span>
                                      </div>
                                    )}
                                    {normalizeSubjectName(teacher.specialization) !== normalizeSubjectName(sub.id) && !['GDĐP', 'TNHN1', 'TNHN2'].includes(sub.id) && (
                                      <div className="mt-0.5">
                                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-medium inline-block leading-none" title="Dạy trái chuyên môn">
                                          ⚠️ Sai môn
                                        </span>
                                      </div>
                                    )}
                                    {(() => {
                                      const hrTeacherId = assignments.homeroomAssignments[cls.id];
                                      const hrTeacher = teachers.find(t => t.id === hrTeacherId);
                                      if (!hrTeacher) return null;
                                      const hrSpec = resolveTeacherSubject(hrTeacher, SUBJECTS);
                                      const isHrSpec = normalizeSubjectName(sub.id) === normalizeSubjectName(hrSpec);
                                      if (isHrSpec && teacherId !== hrTeacherId) {
                                        return (
                                          <div className="mt-0.5">
                                            <span 
                                              className="text-[9px] bg-amber-50 text-amber-800 border border-amber-300 font-bold px-1 py-0.2 rounded inline-block leading-none shadow-2xs" 
                                              title={`Môn chuyên môn của GVCN (${hrTeacher.name}) chưa do GVCN phụ trách!`}
                                            >
                                              ⚠️ Chưa gán GVCN
                                            </span>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                ) : (
                                  <div className="inline-block w-full text-center px-0.5">
                                    <span className="text-slate-400 text-[11px] italic font-normal block text-center leading-none">
                                      {period}t trống
                                    </span>
                                    {(() => {
                                      const hrTeacherId = assignments.homeroomAssignments[cls.id];
                                      const hrTeacher = teachers.find(t => t.id === hrTeacherId);
                                      if (!hrTeacher) return null;
                                      const hrSpec = resolveTeacherSubject(hrTeacher, SUBJECTS);
                                      const isHrSpec = normalizeSubjectName(sub.id) === normalizeSubjectName(hrSpec);
                                      if (isHrSpec) {
                                        return (
                                          <div className="mt-0.5">
                                            <span 
                                              className="text-[9px] bg-amber-50 text-amber-800 border border-amber-300 font-bold px-1 py-0.2 rounded inline-block leading-none shadow-2xs" 
                                              title={`Môn chuyên môn của GVCN (${hrTeacher.name}) đang để trống, chưa gán cho GVCN!`}
                                            >
                                              ⚠️ Môn của GVCN
                                            </span>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 font-bold text-xs">
                    <tr className="bg-slate-100 text-slate-900 shadow-[0_-2px_5px_-2px_rgba(0,0,0,0.1)]">
                      <td className="py-1.5 px-2 sticky left-0 bottom-0 bg-slate-100 border border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-30 font-bold text-blue-900 text-center">
                        Tổng cộng
                      </td>
                      <td className="py-1.5 px-2 text-xs text-blue-950 border border-slate-300 font-semibold sticky bottom-0 bg-blue-50/90 z-20 text-center">
                        {statsCount.homeroomAssigned}/{classes.length} lớp có GVCN
                      </td>
                      <td className="py-1.5 px-1.5 text-center font-bold text-blue-800 bg-sky-100/90 border border-slate-300 sticky bottom-0 z-20" title="Tổng số tiết đã phân công toàn trường">
                        {classes.reduce((acc, c) => acc + SUBJECTS.reduce((s, sub) => {
                          const tId = getAssignedTeacherId(c.id, sub.id);
                          return tId ? s + getSubjectPeriod(sub.id, c.grade, c.id) : s;
                        }, 0), 0)} tiết
                      </td>
                      {SUBJECTS.map(sub => {
                        const subjectAssignedPeriods = classes.reduce((sum, c) => {
                          const tId = getAssignedTeacherId(c.id, sub.id);
                          return tId ? sum + getSubjectPeriod(sub.id, c.grade, c.id) : sum;
                        }, 0);
                        return (
                          <td key={sub.id} className="py-1.5 px-1 text-center text-xs text-blue-800 font-bold border border-slate-300 sticky bottom-0 bg-slate-100 z-20" title={`Đã phân công ${subjectAssignedPeriods} tiết môn ${sub.name}`}>
                            {subjectAssignedPeriods}t
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: TEACHERS DIRECTORY */}
          {activeTab === 'teachers' && (
            <div className="flex-1 flex flex-col p-3 md:p-4 min-h-0">
              {/* Header 1 row: Title + Action buttons */}
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap sm:flex-nowrap">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-base font-bold text-slate-900 tracking-tight whitespace-nowrap">
                    Danh sách giáo viên
                  </h2>
                  <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                    {teachers.length} Giáo viên
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin ? (
                    <>
                      <button
                        onClick={() => {
                          if (isCurrentTermLocked) {
                            alert(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                            return;
                          }
                          setNlImportType('teachers');
                          setIsNlImportOpen(true);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                        title="Nhập nhanh danh sách Giáo viên từ ngôn ngữ tự nhiên AI"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                        <span>Nhập Giáo viên bằng AI ✨</span>
                      </button>
                      <button
                        onClick={() => setIsAddingTeacher(true)}
                        className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm Giáo viên mới</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={openLoginModal}
                      className="px-2.5 py-1 text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-md shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                      title="Chế độ Chỉ xem. Mở khóa Quản trị để thêm hoặc chỉnh sửa giáo viên."
                    >
                      <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                      <span>Đăng nhập Quản trị để thêm/sửa GV</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Toolbar: Single line for Search & Sort filters (Non-wrapping) */}
              <div 
                className="flex items-center justify-between gap-2 mb-2 bg-slate-50/90 px-3 py-1.5 rounded-lg border border-slate-200 overflow-x-auto whitespace-nowrap"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'nowrap',
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}
              >
                {/* Left group: Dropdown + Quick sort buttons + Reset */}
                <div className="flex items-center gap-1.5 shrink-0" style={{ flexWrap: 'nowrap' }}>
                  {/* Sort Dropdown with fixed width & ellipsis */}
                  <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-md px-2 py-1 shadow-2xs shrink-0">
                    <ArrowUpDown className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <label htmlFor="teacherSortSelect" className="text-[11px] font-semibold text-slate-700 whitespace-nowrap shrink-0">
                      Sắp xếp:
                    </label>
                    <select
                      id="teacherSortSelect"
                      value={teacherSortOption}
                      onChange={(e) => setTeacherSortOption(e.target.value)}
                      className="text-xs font-medium text-slate-800 bg-transparent border-0 focus:outline-none cursor-pointer pr-1 truncate"
                      style={{
                        width: '220px',
                        maxWidth: '240px',
                        minWidth: '180px',
                        flexShrink: 0,
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap'
                      }}
                      title="Chọn tiêu chí sắp xếp danh sách giáo viên"
                    >
                      <option value="default">Mặc định (Ban đầu)</option>
                      <option value="degree-desc">Trình độ: Cao đến Thấp (Tiến sĩ → Thạc sĩ → Đại học)</option>
                      <option value="degree-asc">Trình độ: Thấp đến Cao (Đại học → Thạc sĩ → Tiến sĩ)</option>
                      <option value="age-asc">Tuổi: Tăng dần (Trẻ đến Lớn tuổi)</option>
                      <option value="age-desc">Tuổi: Giảm dần (Lớn tuổi đến Trẻ)</option>
                      <option value="seniority-asc">Thâm niên: Tăng dần (Ít đến Nhiều năm)</option>
                      <option value="seniority-desc">Thâm niên: Giảm dần (Nhiều đến Ít năm)</option>
                      <option value="position-asc">Chức vụ (Hiệu trưởng → GV)</option>
                      <option value="position-desc">Chức vụ (GV → Hiệu trưởng)</option>
                      <option value="specialization-curriculum">Môn giảng dạy (Tổ trưởng → Tổ phó → GV)</option>
                      <option value="specialization-alpha">Môn giảng dạy theo vần A-Z (Tổ trưởng → Tổ phó → GV)</option>
                      <option value="name-asc">Tên theo vần ABC (A → Z)</option>
                      <option value="name-desc">Tên theo vần ABC (Z → A)</option>
                      <option value="fullname-asc">Họ và tên đầy đủ (A → Z)</option>
                      <option value="homeroom-asc">Lớp chủ nhiệm (Có lớp lên đầu)</option>
                      <option value="periods-desc">Tiết dạy (Nhiều nhất → Ít nhất)</option>
                      <option value="periods-asc">Tiết dạy (Ít nhất → Nhiều nhất)</option>
                      <option value="quota-asc">Định mức tiết (Tăng dần)</option>
                      <option value="quota-desc">Định mức tiết (Giảm dần)</option>
                    </select>
                  </div>

                  {/* Quick one-click sort buttons (Compact & Non-wrapping) */}
                  <div className="flex items-center gap-1 shrink-0" style={{ flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'age-desc' ? 'age-asc' : 'age-desc')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption.startsWith('age')
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo tuổi (Nhấp để đổi Lớn tuổi ↓ / Trẻ tuổi ↑)"
                    >
                      Tuổi {teacherSortOption === 'age-desc' ? '↓' : teacherSortOption === 'age-asc' ? '↑' : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'seniority-desc' ? 'seniority-asc' : 'seniority-desc')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption.startsWith('seniority')
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo thâm niên công tác (Nhiều năm ↓ / Ít năm ↑)"
                    >
                      Thâm niên {teacherSortOption === 'seniority-desc' ? '↓' : teacherSortOption === 'seniority-asc' ? '↑' : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'position-asc' ? 'position-desc' : 'position-asc')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption.startsWith('position')
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo cấp bậc chức vụ (BGH/TTCM ↓ / GV ↑)"
                    >
                      Chức vụ {teacherSortOption === 'position-asc' ? '↓' : teacherSortOption === 'position-desc' ? '↑' : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'degree-desc' ? 'degree-asc' : 'degree-desc')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption.startsWith('degree')
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo trình độ chuyên môn (Nhấp 1: Cao → Thấp ↓, Nhấp 2: Thấp → Cao ↑)"
                    >
                      Trình độ {teacherSortOption === 'degree-desc' ? '↓' : teacherSortOption === 'degree-asc' ? '↑' : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'specialization-curriculum' ? 'specialization-alpha' : 'specialization-curriculum')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption.startsWith('specialization')
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo môn giảng dạy (Theo phân phối chương trình hoặc vần A-Z)"
                    >
                      Môn dạy {teacherSortOption.startsWith('specialization') ? (teacherSortOption === 'specialization-curriculum' ? '↓' : '↑') : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSortOption(prev => prev === 'name-asc' ? 'name-desc' : 'name-asc')}
                      className={`shrink-0 text-[13px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        teacherSortOption === 'name-asc' || teacherSortOption === 'name-desc'
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={{ flexShrink: 0 }}
                      title="Sắp xếp theo vần ABC của tên"
                    >
                      Tên ABC {teacherSortOption === 'name-asc' ? '↓' : teacherSortOption === 'name-desc' ? '↑' : ''}
                    </button>
                  </div>

                  {teacherSortOption !== 'default' && (
                    <button
                      type="button"
                      onClick={() => setTeacherSortOption('default')}
                      className="shrink-0 text-[13px] px-2.5 py-1 bg-white text-slate-600 hover:text-blue-700 hover:border-blue-300 border border-slate-200 rounded-md transition flex items-center gap-1 shadow-2xs cursor-pointer whitespace-nowrap"
                      style={{ flexShrink: 0 }}
                      title="Khôi phục thứ tự mặc định"
                    >
                      <RotateCcw className="w-3 h-3" /> Đặt lại
                    </button>
                  )}
                </div>

                {/* Right side: Flexible Search input with real-time count */}
                <div 
                  className="flex items-center gap-1.5 shrink-0 ml-auto"
                  style={{
                    flex: '1',
                    minWidth: '160px',
                    maxWidth: '260px'
                  }}
                >
                  <div className="relative w-full">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={teacherSearchTerm}
                      onChange={(e) => setTeacherSearchTerm(e.target.value)}
                      placeholder="🔍 Tìm tên, môn, tổ CM, chức vụ, trình độ..."
                      className="text-xs pl-8 pr-20 py-1 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 w-full truncate"
                      title="Tìm kiếm theo tên, môn, tổ CM, chức vụ hoặc trình độ (ThS, ĐH, TS, CĐ)"
                    />
                    {teacherSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setTeacherSearchTerm('')}
                        className="absolute right-16 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer font-bold px-1"
                        title="Xóa tìm kiếm"
                      >
                        ×
                      </button>
                    )}
                    <span 
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10.5px] font-bold text-slate-600 whitespace-nowrap pointer-events-none bg-slate-100/90 px-1.5 py-0.5 rounded border border-slate-200/80 shadow-2xs"
                      title="Số lượng giáo viên phù hợp / Tổng số giáo viên"
                    >
                      {sortedAndFilteredTeachers.length} / {teachers.length} GV
                    </span>
                  </div>
                </div>
              </div>

              {/* Teachers table: High-density grid */}
              <div className="overflow-x-auto border border-slate-300 rounded-lg shadow-2xs bg-white">
                <table className="w-full text-left border-collapse text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-300 text-[11px] font-semibold uppercase tracking-wider select-none">
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'name-asc' ? 'name-desc' : 'name-asc')}
                        className="py-1.5 px-2.5 border-r border-slate-300 cursor-pointer hover:bg-slate-200/70 transition group"
                        title="Bấm để sắp xếp theo tên giáo viên"
                      >
                        <div className="flex items-center gap-1">
                          <span>Giáo viên</span>
                          {teacherSortOption === 'name-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'name-desc' ? (
                            <ArrowDown className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'position-asc' ? 'position-desc' : 'position-asc')}
                        className="py-1.5 px-2 border-r border-slate-300 cursor-pointer hover:bg-slate-200/70 transition group text-center"
                        title="Bấm để sắp xếp theo chức vụ"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Chức vụ</span>
                          {teacherSortOption === 'position-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'position-desc' ? (
                            <ArrowDown className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      {/* Cột [TRÌNH ĐỘ / HỒ SƠ]: min-width: 145px; padding: 6px 8px; text-align: center; white-space: nowrap */}
                      <th 
                        onClick={() => setTeacherSortOption(prev => {
                          if (prev === 'degree-desc') return 'degree-asc';
                          if (prev === 'degree-asc') return 'age-asc';
                          if (prev === 'age-asc') return 'age-desc';
                          if (prev === 'age-desc') return 'seniority-desc';
                          if (prev === 'seniority-desc') return 'seniority-asc';
                          return 'degree-desc';
                        })}
                        className="py-1.5 px-2 border-r border-slate-300 text-center whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition group"
                        style={{ minWidth: '145px', padding: '6px 8px', textAlign: 'center' }}
                        title="Bấm để sắp xếp theo Trình độ (Tiến sĩ → ThS → ĐH), Tuổi hoặc Thâm niên"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Trình độ / Hồ sơ</span>
                          {teacherSortOption === 'degree-desc' ? (
                            <ArrowDown className="w-3 h-3 text-purple-600 font-bold" />
                          ) : teacherSortOption === 'degree-asc' ? (
                            <ArrowUp className="w-3 h-3 text-purple-600 font-bold" />
                          ) : teacherSortOption === 'age-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'age-desc' ? (
                            <ArrowDown className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'seniority-desc' ? (
                            <ArrowDown className="w-3 h-3 text-emerald-600 font-bold" />
                          ) : teacherSortOption === 'seniority-asc' ? (
                            <ArrowUp className="w-3 h-3 text-emerald-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'specialization-curriculum' ? 'specialization-alpha' : 'specialization-curriculum')}
                        className="py-1.5 px-2 border-r border-slate-300 cursor-pointer hover:bg-slate-200/70 transition group text-center"
                        title="Bấm để sắp xếp theo môn giảng dạy"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Môn giảng dạy</span>
                          {teacherSortOption === 'specialization-curriculum' || teacherSortOption === 'specialization-alpha' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'homeroom-asc' ? 'default' : 'homeroom-asc')}
                        className="py-1.5 px-2 border-r border-slate-300 text-center whitespace-nowrap cursor-pointer hover:bg-slate-200/70 transition group"
                        title="Bấm để sắp xếp theo lớp chủ nhiệm"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Lớp chủ nhiệm</span>
                          {teacherSortOption === 'homeroom-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'quota-asc' ? 'quota-desc' : 'quota-asc')}
                        className="py-1.5 px-2 border-r border-slate-300 text-center cursor-pointer hover:bg-slate-200/70 transition group"
                        title="Bấm để sắp xếp theo định mức tiết"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Định mức</span>
                          {teacherSortOption === 'quota-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'quota-desc' ? (
                            <ArrowDown className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th 
                        onClick={() => setTeacherSortOption(prev => prev === 'periods-desc' ? 'periods-asc' : 'periods-desc')}
                        className="py-1.5 px-2.5 border-r border-slate-300 cursor-pointer hover:bg-slate-200/70 transition group"
                        title="Bấm để sắp xếp theo số tiết dạy"
                      >
                        <div className="flex items-center gap-1">
                          <span>Tiết dạy / Định mức</span>
                          {teacherSortOption === 'periods-desc' ? (
                            <ArrowDown className="w-3 h-3 text-blue-600 font-bold" />
                          ) : teacherSortOption === 'periods-asc' ? (
                            <ArrowUp className="w-3 h-3 text-blue-600 font-bold" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-40 group-hover:opacity-100 transition" />
                          )}
                        </div>
                      </th>
                      <th className="py-1.5 px-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAndFilteredTeachers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400 border border-slate-300">
                          <Users className="w-6 h-6 mx-auto mb-1.5 text-slate-300" />
                          <p className="font-semibold text-xs text-slate-600">Không tìm thấy giáo viên nào</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Thử đổi từ khóa tìm kiếm hoặc đặt lại sắp xếp</p>
                          <button
                            onClick={() => { setTeacherSearchTerm(''); setTeacherSortOption('default'); }}
                            className="mt-2 px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-xs font-semibold cursor-pointer"
                          >
                            Đặt lại bộ lọc & sắp xếp
                          </button>
                        </td>
                      </tr>
                    ) : (
                      sortedAndFilteredTeachers.map((teacher, index) => {
                        const stats = getTeacherStats(teacher.id);
                        const totalAssigned = stats.totalPeriods; // Tổng số tiết phân công + 4 tiết chủ nhiệm (nếu có CN)
                        const maxQuota = teacher.maxPeriods ?? 17;
                        const percent = Math.min(100, (totalAssigned / maxQuota) * 100);
                        
                        // Progress bar colors
                        let barColor = 'bg-slate-400';
                        let textColor = 'text-slate-700';
                        if (totalAssigned === 0) {
                          barColor = 'bg-slate-200';
                          textColor = 'text-slate-400';
                        } else if (totalAssigned > maxQuota) {
                          barColor = 'bg-rose-500 animate-pulse';
                          textColor = 'text-rose-600 font-bold';
                        } else if (totalAssigned >= maxQuota - 4) {
                          barColor = 'bg-emerald-500';
                          textColor = 'text-emerald-700 font-semibold';
                        } else {
                          barColor = 'bg-amber-500';
                          textColor = 'text-amber-700';
                        }

                        const rowBg = index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white';

                        return (
                          <tr
                            key={teacher.id}
                            className={`${rowBg} hover:bg-blue-50/70 transition-colors border-b border-slate-300`}
                          >
                            {/* Cột GIÁO VIÊN: Dòng 1 Họ tên (font-size: 0.88rem; font-weight: 500; không in đậm), Dòng 2 SĐT • Email gộp */}
                            <td className="py-1 px-2.5 border-r border-slate-300 whitespace-nowrap align-middle">
                              <div className="text-[0.88rem] font-[500] text-slate-900 leading-tight">
                                {teacher.name}
                              </div>
                              <div className="text-[0.74rem] text-slate-500 leading-none mt-0.5 truncate max-w-[210px]" title={`${teacher.phone || 'Chưa có SĐT'} • ${teacher.email || 'Chưa có Email'}`}>
                                <span>{teacher.phone || 'Chưa có SĐT'}</span>
                                <span className="mx-1 text-slate-300">•</span>
                                <span className="text-slate-400">{teacher.email || 'Chưa có Email'}</span>
                              </div>
                            </td>

                            {/* Cột CHỨC VỤ: Căn giữa tuyệt đối cả hai trục */}
                            <td className="py-1 px-2 border-r border-slate-300 whitespace-nowrap text-center align-middle">
                              <div className="flex items-center justify-center w-full">
                                {renderPositionBadge(teacher.position)}
                              </div>
                            </td>

                            {/* Cột [TRÌNH ĐỘ / HỒ SƠ]: min-width: 145px; padding: 6px 8px; text-align: center; white-space: nowrap */}
                            <td 
                              className="border-r border-slate-300 align-middle whitespace-nowrap"
                              style={{ minWidth: '145px', padding: '6px 8px', textAlign: 'center' }}
                            >
                              {(() => {
                                const trinhDoRaw = teacher.trinhDo || (teacher.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học');
                                // Rút gọn 1 nhãn duy nhất, không lặp lại: ThS, TS, ĐH, CĐ hoặc tên chuẩn ngắn gọn
                                const singleLabel = trinhDoRaw.includes('Thạc sĩ') ? 'ThS' 
                                  : trinhDoRaw.includes('Tiến sĩ') ? 'TS' 
                                  : trinhDoRaw.includes('Cao đẳng') ? 'CĐ' 
                                  : 'Đại học';

                                const badgeColor = singleLabel === 'ThS'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200' 
                                  : singleLabel === 'TS' 
                                  ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                  : singleLabel === 'CĐ'
                                  ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                                const curYear = new Date().getFullYear();
                                const approxSinh = teacher.namSinh || (teacher.experienceYears ? curYear - 22 - teacher.experienceYears : undefined);
                                const approxVaoNganh = teacher.namVaoNganh || (teacher.experienceYears ? curYear - teacher.experienceYears : undefined);

                                return (
                                  <div className="flex flex-col items-center justify-center">
                                    <span 
                                      className={`border font-semibold shadow-2xs ${badgeColor}`}
                                      style={{
                                        fontSize: '0.72rem',
                                        padding: '1px 8px',
                                        borderRadius: '9999px',
                                        display: 'inline-block',
                                        marginBottom: '3px'
                                      }}
                                      title={`Trình độ: ${trinhDoRaw}`}
                                    >
                                      {singleLabel}
                                    </span>
                                    <div 
                                      className="whitespace-nowrap font-medium"
                                      style={{
                                        fontSize: '0.73rem',
                                        color: '#64748b',
                                        lineHeight: 1.2
                                      }}
                                    >
                                      NS: {approxSinh ? approxSinh : '—'} • Tuyển: {approxVaoNganh ? approxVaoNganh : '—'}
                                    </div>

                                    {/* Nút 'Xuất hồ sơ' (Export Profile) PDF / Word */}
                                    <button
                                      type="button"
                                      onClick={() => setProfileExportTeacher(teacher)}
                                      className="mt-1.5 inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold text-blue-700 bg-blue-50/80 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 transition-all cursor-pointer shadow-2xs group"
                                      title={`Xuất hồ sơ chi tiết của giáo viên ${teacher.name} (PDF / Word)`}
                                    >
                                      <FileDown className="w-2.5 h-2.5 text-blue-600 group-hover:scale-110 transition-transform" />
                                      <span>Xuất hồ sơ</span>
                                    </button>
                                  </div>
                                );
                              })()}
                            </td>

                            {/* Cột MÔN GIẢNG DẠY: Căn giữa tuyệt đối cả hai trục, font-weight: 500 */}
                            <td className="py-1 px-2 border-r border-slate-300 whitespace-nowrap text-center align-middle">
                              <span className="font-[500] text-indigo-700 text-xs inline-flex items-center justify-center">
                                {resolveTeacherSubject(teacher, SUBJECTS) || teacher.specialization || '—'}
                              </span>
                            </td>

                            {/* Cột LỚP CHỦ NHIỆM: Căn giữa tuyệt đối, max-width: 170px */}
                            <td className="py-1 px-2 border-r border-slate-300 text-center align-middle whitespace-nowrap">
                              {(() => {
                                const currentHomeroomClassId = Object.entries(assignments.homeroomAssignments).find(
                                  ([, tId]) => tId === teacher.id
                                )?.[0] || '';
                                const currentClass = classes.find(c => c.id === currentHomeroomClassId);

                                return isBanGiamHieu(teacher) ? (
                                  <span 
                                    className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 select-none inline-block" 
                                    title="Cán bộ Ban Giám hiệu (Hiệu trưởng / Phó Hiệu trưởng) không làm công tác chủ nhiệm"
                                  >
                                    BGH (Không CN)
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-1.5 justify-center mx-auto">
                                    <select
                                      value={currentHomeroomClassId}
                                      onChange={e => handleAssignTeacherHomeroom(teacher.id, e.target.value)}
                                      className={`text-xs font-medium h-[26px] py-0 px-1.5 rounded border transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 text-center mx-auto max-w-[170px] ${
                                        currentHomeroomClassId
                                          ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 font-semibold'
                                          : 'bg-white text-slate-400 border-slate-300 hover:text-slate-600 hover:bg-slate-50'
                                      }`}
                                      style={{ textAlignLast: 'center' }}
                                      title={currentClass ? `Chủ nhiệm lớp ${currentClass.name} (+4 tiết)` : 'Chọn lớp chủ nhiệm cho giáo viên'}
                                    >
                                      <option value="">— Chưa chủ nhiệm —</option>
                                      <optgroup label="Khối 10">
                                        {classes.filter(c => c.grade === '10').map(c => {
                                          const assignedTId = assignments.homeroomAssignments[c.id];
                                          const isOther = assignedTId && assignedTId !== teacher.id;
                                          const otherTeacher = isOther ? teachers.find(t => t.id === assignedTId) : null;
                                          return (
                                            <option key={c.id} value={c.id}>
                                              Lớp {c.name} {otherTeacher ? `(Đang: ${otherTeacher.name.split(' ').slice(-2).join(' ')})` : ''}
                                            </option>
                                          );
                                        })}
                                      </optgroup>
                                      <optgroup label="Khối 11">
                                        {classes.filter(c => c.grade === '11').map(c => {
                                          const assignedTId = assignments.homeroomAssignments[c.id];
                                          const isOther = assignedTId && assignedTId !== teacher.id;
                                          const otherTeacher = isOther ? teachers.find(t => t.id === assignedTId) : null;
                                          return (
                                            <option key={c.id} value={c.id}>
                                              Lớp {c.name} {otherTeacher ? `(Đang: ${otherTeacher.name.split(' ').slice(-2).join(' ')})` : ''}
                                            </option>
                                          );
                                        })}
                                      </optgroup>
                                      <optgroup label="Khối 12">
                                        {classes.filter(c => c.grade === '12').map(c => {
                                          const assignedTId = assignments.homeroomAssignments[c.id];
                                          const isOther = assignedTId && assignedTId !== teacher.id;
                                          const otherTeacher = isOther ? teachers.find(t => t.id === assignedTId) : null;
                                          return (
                                            <option key={c.id} value={c.id}>
                                              Lớp {c.name} {otherTeacher ? `(Đang: ${otherTeacher.name.split(' ').slice(-2).join(' ')})` : ''}
                                            </option>
                                          );
                                        })}
                                      </optgroup>
                                    </select>
                                    {currentClass ? (
                                      <span className="text-[10px] text-blue-600 font-semibold whitespace-nowrap">
                                        +4t
                                      </span>
                                    ) : !teacher.isHomeroomCapable ? (
                                      <span className="text-[10px] text-slate-400 whitespace-nowrap">KĐK</span>
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </td>

                            {/* Cột ĐỊNH MỨC */}
                            <td className="py-1 px-2 border-r border-slate-300 text-center whitespace-nowrap">
                              <span className="font-mono text-xs font-semibold text-slate-700">
                                {teacher.maxPeriods}
                              </span>
                            </td>

                            {/* Cột TIẾT DẠY / ĐỊNH MỨC & TIẾN ĐỘ */}
                            <td className="py-1 px-2.5 border-r border-slate-300 min-w-[200px]">
                              <div className="flex items-center justify-between leading-none mb-1">
                                <span className={`text-xs ${textColor}`}>
                                  <span className="font-bold">{totalAssigned}</span> / {maxQuota} tiết
                                </span>
                                {stats.isHomeroom && (
                                  <span className="text-[10px] text-blue-600 font-medium">
                                    ({stats.assignedPeriods}t dạy + 4t CN)
                                  </span>
                                )}
                              </div>
                              {/* Danh sách các lớp được phân công dạy */}
                              <div className="mb-1 text-[11px] text-slate-500 flex flex-wrap items-center gap-1 leading-none">
                                <span className="text-slate-400 text-[10px]">Lớp:</span>
                                {stats.assignedClasses.length > 0 ? (
                                  stats.assignedClasses.map((clsName, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-block px-1 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px] border border-slate-200"
                                    >
                                      {clsName}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-slate-300 italic text-[10px]">Chưa phân công</span>
                                )}
                              </div>
                              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${percent}%` }}></div>
                              </div>
                              {stats.warnings.map((w, i) => (
                                <div key={i} className="text-[10px] text-rose-500 flex items-center gap-0.5 mt-0.5 leading-none">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span>{w}</span>
                                </div>
                              ))}
                            </td>

                            {/* Cột THAO TÁC */}
                            <td className="py-1 px-2 text-right whitespace-nowrap">
                              {isAdmin ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => handleStartEditTeacher(teacher)}
                                    className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition cursor-pointer"
                                    title="Chỉnh sửa thông tin giáo viên"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTeacher(teacher.id)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                                    title="Xóa giáo viên"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-300 text-xs italic">Chỉ xem</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: SUBJECT CATALOG (QUẢN LÝ DANH MỤC MÔN HỌC TOÀN TRƯỜNG) */}
          {activeTab === 'subject_catalog' && (() => {
            return (
              <div className="flex-1 flex flex-col p-1.5 md:p-2 min-h-0 bg-slate-50/50 space-y-1.5">
                {/* Header & Main Actions */}
                <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
                  <div>
                    <h2 className="text-sm md:text-base font-bold text-slate-900 flex items-center gap-2 leading-tight">
                      <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>Danh mục Môn học toàn trường</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono font-bold border border-indigo-200">
                        {subjectsConfig.length} môn
                      </span>
                    </h2>
                    <p className="text-[11.5px] text-slate-500 mt-0.5">
                      Quản lý mã môn, tên viết tắt, tên đầy đủ, tổ bộ môn phụ trách và định mức số tiết chuẩn cho các khối
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentTermLocked) {
                              alert(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                              return;
                            }
                            setIsManageDepartmentsModalOpen(true);
                          }}
                          style={{ height: '30px', padding: '0 10px', fontSize: '11.5px' }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg border border-slate-300 shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                          title="Quản lý danh mục tổ chuyên môn của trường"
                        >
                          <Settings className="w-3.5 h-3.5 text-slate-600" />
                          <span>⚙ Quản lý Tổ chuyên môn</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentTermLocked) {
                              alert(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                              return;
                            }
                            setNlImportType('subjects');
                            setIsNlImportOpen(true);
                          }}
                          style={{ height: '30px', padding: '0 10px', fontSize: '11.5px' }}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg border border-indigo-200 shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                          title="Nhập danh mục môn học bằng ngôn ngữ tự nhiên AI"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Nhập bằng AI</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentTermLocked) {
                              alert(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                              return;
                            }
                            setNewSubject({
                              id: '',
                              name: '',
                              departmentId: departments[0]?.id || 'dept_toan_tin',
                              department: departments[0]?.name || 'Tổ Toán - Tin',
                              grade10Periods: 2,
                              grade11Periods: 2,
                              grade12Periods: 2
                            });
                            setIsAddingSubject(true);
                          }}
                          style={{ height: '30px', padding: '0 10px', fontSize: '11.5px' }}
                          className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                          title="Thêm môn học mới vào danh mục toàn trường"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>+ Thêm môn học mới</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={openLoginModal}
                        style={{ height: '30px', padding: '0 10px', fontSize: '11.5px' }}
                        className="font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-md shadow-2xs inline-flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                        <span>Đăng nhập Quản trị</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Subjects Table: Ultra-compact without search bar */}
                <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs flex flex-col min-h-0">
                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs" style={{ tableLayout: 'fixed', minWidth: '1015px' }}>
                      <colgroup>
                        <col style={{ width: '50px' }} />
                        <col style={{ width: '75px' }} />
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '150px' }} />
                        <col style={{ width: '280px' }} />
                        <col style={{ width: '240px' }} />
                        <col style={{ width: '120px' }} />
                      </colgroup>
                      <thead className="bg-slate-100/90 text-slate-800 font-bold sticky top-0 z-10 border-b border-slate-300">
                        <tr>
                          <th style={{ width: '50px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap' }} className="border-r border-slate-200">STT</th>
                          <th style={{ width: '75px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap' }} className="border-r border-slate-200">Mã môn</th>
                          <th style={{ width: '100px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', whiteSpace: 'nowrap' }} className="border-r border-slate-200">Tên viết tắt</th>
                          <th style={{ width: '150px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', whiteSpace: 'nowrap' }} className="border-r border-slate-200">Tên đầy đủ môn học</th>
                          <th style={{ width: '280px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', whiteSpace: 'nowrap' }} className="border-r border-slate-200">Tổ bộ môn phụ trách</th>
                          <th style={{ width: '240px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap' }} className="border-r border-slate-200">Định mức tiết (K10 / K11 / K12)</th>
                          <th style={{ width: '120px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectsConfig.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ padding: '12px', textAlign: 'center' }} className="text-slate-400 font-medium">
                              Chưa có môn học nào trong danh mục.
                            </td>
                          </tr>
                        ) : (
                          subjectsConfig.map((sub, idx) => {
                            const dept = sub.department || getDefaultDepartment(sub.id, sub.name);
                            return (
                              <tr 
                                key={sub.id} 
                                style={{ borderBottom: '1px solid #e2e8f0', height: '30px' }}
                                className="hover:bg-[#f8fafc] transition-colors border-b border-slate-200"
                              >
                                <td style={{ width: '50px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="font-mono text-slate-400 text-[11px] border-r border-b border-slate-200">
                                  {idx + 1}
                                </td>
                                <td style={{ width: '75px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="border-r border-b border-slate-200">
                                  <span 
                                    style={{ fontWeight: 600, color: '#2563eb', fontSize: '12px', background: 'transparent', border: 'none', textAlign: 'center' }}
                                    className="font-mono inline-block leading-tight"
                                  >
                                    {sub.id}
                                  </span>
                                </td>
                                <td style={{ width: '100px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', fontSize: '12px', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="font-bold text-slate-800 border-r border-b border-slate-200">
                                  {sub.id}
                                </td>
                                <td style={{ width: '150px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', fontSize: '12px', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="font-semibold text-slate-800 border-r border-b border-slate-200">
                                  {sub.name || sub.id}
                                </td>
                                <td style={{ width: '280px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="font-medium text-slate-700 border-r border-b border-slate-200">
                                  <span 
                                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200/80 leading-tight whitespace-nowrap"
                                    style={{ padding: '2px 8px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                                  >
                                    <Users style={{ width: '12px', height: '12px' }} className="text-slate-500 shrink-0" />
                                    <span>{dept}</span>
                                  </span>
                                </td>
                                <td style={{ width: '240px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="font-mono font-bold text-slate-700 border-r border-b border-slate-200">
                                  <span 
                                    className="rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono font-bold inline-block leading-tight"
                                    style={{ padding: '1px 6px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                                  >
                                    {sub.grade10Periods}t / {sub.grade11Periods}t / {sub.grade12Periods}t
                                  </span>
                                </td>
                                <td style={{ width: '120px', padding: '3px 8px', height: '30px', lineHeight: '1.2', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }} className="border-b border-slate-200">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditSubject(sub.id)}
                                      style={{ height: '22px', padding: '1px 6px', fontSize: '11px', whiteSpace: 'nowrap' }}
                                      className="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded transition cursor-pointer shadow-2xs leading-none shrink-0"
                                      title={`Chỉnh sửa môn ${sub.name || sub.id}`}
                                    >
                                      <Pencil style={{ width: '12px', height: '12px' }} className="text-indigo-600 shrink-0" />
                                      <span>Sửa</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSubject(sub.id)}
                                      style={{ height: '22px', padding: '1px 6px', fontSize: '11px', whiteSpace: 'nowrap' }}
                                      className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition cursor-pointer shadow-2xs leading-none shrink-0"
                                      title={`Xóa môn ${sub.name || sub.id}`}
                                    >
                                      <Trash2 style={{ width: '12px', height: '12px' }} className="text-rose-600 shrink-0" />
                                      <span>Xóa</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 3: CLASSES LIST */}
          {activeTab === 'classes' && (
            <div className="flex-1 flex flex-col p-3 md:p-4 min-h-0 bg-slate-50/40">
              {/* Header and Toolbar - Compact 1 Row */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 mb-2.5 bg-white p-2.5 px-3.5 rounded-lg border border-slate-200 shadow-2xs">
                {/* Left: Title + Grade Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 mr-1">
                    <h2 className="text-sm md:text-base font-bold text-slate-900 tracking-tight whitespace-nowrap">
                      Danh sách Lớp học
                    </h2>
                  </div>

                  {/* Mini Grade Filter Buttons */}
                  <div className="flex items-center gap-1 bg-slate-100/80 p-0.5 rounded-md border border-slate-200/80">
                    <button
                      type="button"
                      onClick={() => setClassGradeFilter('all')}
                      className={`px-2 py-0.5 rounded text-[11.5px] font-medium transition cursor-pointer ${
                        classGradeFilter === 'all'
                          ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                      }`}
                    >
                      Tất cả ({classes.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setClassGradeFilter('10')}
                      className={`px-2 py-0.5 rounded text-[11.5px] font-medium transition cursor-pointer ${
                        classGradeFilter === '10'
                          ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                      }`}
                    >
                      Khối 10 ({classes.filter(c => c.grade === '10').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setClassGradeFilter('11')}
                      className={`px-2 py-0.5 rounded text-[11.5px] font-medium transition cursor-pointer ${
                        classGradeFilter === '11'
                          ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                      }`}
                    >
                      Khối 11 ({classes.filter(c => c.grade === '11').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setClassGradeFilter('12')}
                      className={`px-2 py-0.5 rounded text-[11.5px] font-medium transition cursor-pointer ${
                        classGradeFilter === '12'
                          ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                      }`}
                    >
                      Khối 12 ({classes.filter(c => c.grade === '12').length})
                    </button>
                  </div>
                </div>

                {/* Right: Search box + Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={classSearchQuery}
                      onChange={(e) => setClassSearchQuery(e.target.value)}
                      placeholder="Tìm lớp (vd: 10A1)..."
                      className="w-40 md:w-44 pl-8 pr-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-[12px] font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-400 transition"
                    />
                  </div>

                  {isAdmin ? (
                    <>
                      <button
                        onClick={() => {
                          if (isCurrentTermLocked) {
                            alert(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                            return;
                          }
                          setNlImportType('classes');
                          setIsNlImportOpen(true);
                        }}
                        className="px-2.5 py-1 text-[12px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md shadow-2xs flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                        title="Nhập nhanh danh sách Lớp học từ ngôn ngữ tự nhiên AI"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                        <span>Nhập Lớp bằng AI ✨</span>
                      </button>
                      <button
                        onClick={() => setIsAddingClass(true)}
                        className="px-2.5 py-1 text-[12px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-2xs flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm lớp mới
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={openLoginModal}
                      className="px-2.5 py-1 text-[11.5px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-md shadow-2xs flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                      title="Chế độ Chỉ xem. Mở khóa Quản trị để thêm hoặc xóa lớp học."
                    >
                      <KeyRound className="w-3 h-3 text-amber-700" />
                      <span>Đăng nhập Quản trị</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Classes grid layout - Modern High-Density Grid (Fixed 5 columns on large screen) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {classes
                  .filter(cls => {
                    if (classGradeFilter !== 'all' && cls.grade !== classGradeFilter) return false;
                    if (classSearchQuery.trim() && !cls.name.toLowerCase().includes(classSearchQuery.trim().toLowerCase())) return false;
                    return true;
                  })
                  .map(cls => {
                    const homeroomId = assignments.homeroomAssignments[cls.id];
                    const homeroomTeacher = teachers.find(t => t.id === homeroomId);

                    // Calculate assigned subjects count and total periods
                    let assignedCount = 0;
                    let classTotalPeriods = 0;
                    const missingSubjects: string[] = [];

                    SUBJECTS.forEach(sub => {
                      const period = getSubjectPeriod(sub.id, cls.grade, cls.id);
                      classTotalPeriods += period;
                      if (getAssignedTeacherId(cls.id, sub.id)) {
                        assignedCount++;
                      } else {
                        missingSubjects.push(sub.id);
                      }
                    });

                    // Determine shift badge
                    const shiftVal = classShifts[cls.id] || (cls.grade === '10' ? 'afternoon_main' : 'morning_main');
                    const isMorningMain = shiftVal === 'morning_main' || shiftVal === 'morning';
                    const shiftLabel = isMorningMain ? 'Chính Sáng' : 'Chính Chiều';

                    // Grade badge color
                    const gradeBgColor =
                      cls.grade === '10'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : cls.grade === '11'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-purple-50 text-purple-700 border-purple-200';

                    const isFullyAssigned = missingSubjects.length === 0;

                    return (
                      <div
                        key={cls.id}
                        className="border border-slate-200 rounded-lg p-2.5 bg-white hover:border-blue-300 hover:shadow-xs transition-all flex flex-col justify-between group"
                      >
                        {/* Header: Class Name, Badges, Action buttons */}
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-blue-900 tracking-tight">
                              {cls.name}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium border ${gradeBgColor}`}>
                              K{cls.grade}
                            </span>
                            <span
                              className={`text-[9.5px] px-1 py-0.2 rounded font-normal ${
                                isMorningMain
                                  ? 'bg-sky-50 text-sky-700 border border-sky-100'
                                  : 'bg-orange-50 text-orange-700 border border-orange-100'
                              }`}
                              title={`Ca học: ${shiftVal}`}
                            >
                              {shiftLabel}
                            </span>
                          </div>

                          {/* Quick Actions (Edit & Delete) */}
                          <div className="flex items-center gap-0.5">
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingClass(cls)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition cursor-pointer"
                                  title="Chỉnh sửa thông tin lớp"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(cls.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                                  title="Xóa lớp học"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Card Body - Ultra Compact Info */}
                        <div className="space-y-1 mb-2 text-[11px]">
                          {/* Homeroom teacher */}
                          <div className="flex items-center justify-between gap-1 text-slate-600 bg-slate-50/80 px-1.5 py-0.5 rounded">
                            <span className="text-slate-400 font-medium shrink-0">GVCN:</span>
                            <span
                              className={`font-semibold truncate max-w-[130px] text-right ${
                                homeroomTeacher ? 'text-slate-800' : 'text-rose-500 italic'
                              }`}
                              title={homeroomTeacher ? homeroomTeacher.name : 'Chưa phân công'}
                            >
                              {homeroomTeacher ? homeroomTeacher.name : 'Chưa PC'}
                            </span>
                          </div>

                          {/* Subject & Periods Count */}
                          <div className="flex items-center justify-between px-1 text-slate-500">
                            <span>Phân công môn:</span>
                            <span className="font-semibold text-slate-700">
                              <span className={assignedCount === SUBJECTS.length ? 'text-emerald-600' : 'text-slate-800'}>
                                {assignedCount}
                              </span>
                              /{SUBJECTS.length} môn
                              <span className="text-slate-400 text-[10px] ml-1">({classTotalPeriods}t)</span>
                            </span>
                          </div>
                        </div>

                        {/* Card Footer: Status or Missing Subjects Strip */}
                        <div className="pt-1 border-t border-slate-50">
                          {isFullyAssigned ? (
                            <div className="flex items-center justify-center gap-1 py-0.5 px-1.5 bg-emerald-50/80 text-emerald-700 rounded text-[10px] font-medium border border-emerald-100/60">
                              <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>✓ Đủ GV ({classTotalPeriods} tiết)</span>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-1 py-0.5 px-1.5 bg-rose-50/80 text-rose-700 rounded text-[10px] border border-rose-100/60"
                              title={`Thiếu GV môn: ${missingSubjects.join(', ')}`}
                            >
                              <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                              <span className="font-semibold text-[9.5px] shrink-0">Thiếu {missingSubjects.length} môn:</span>
                              <span className="truncate text-[9.5px] text-rose-800 font-mono">
                                {missingSubjects.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* TAB: SUBJECTS LIST & EDITING (TREE VIEW STRUCTURE) */}
          {activeTab === 'subjects' && (() => {
            const currentTreeClass = classes.find(c => c.id === selectedTreeClassId) || classes[0];
            const getSubjectVal = (subId: string) => {
              if (!currentTreeClass) return undefined;
              const cleanId = currentTreeClass.id.replace(/^c_/, "");
              const prefixedId = "c_" + cleanId;
              const map = draftHoursMap[currentTreeClass.id] ||
                draftHoursMap[cleanId] ||
                draftHoursMap[prefixedId] ||
                (currentTreeClass.name ? draftHoursMap[currentTreeClass.name] : undefined);
              if (!map) return undefined;
              if (map[subId] !== undefined) return map[subId];
              const norm = normalizeSubjectName(subId);
              if (map[norm] !== undefined) return map[norm];
              return undefined;
            };

            const handleRemoveSubjectFromClass = (subjectId: string, subjectName: string) => {
              if (!isAdmin) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              if (!currentTreeClass) return;
              if (isCurrentTermLocked) {
                showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                return;
              }

              const subLabel = subjectName || subjectId;
              const targetClass = currentTreeClass;
              const cleanId = targetClass.id.replace(/^c_/, "");
              const prefixedId = "c_" + cleanId;
              const shift = classShifts[targetClass.id] || classShifts[cleanId] || (targetClass.grade === "10" ? "afternoon_main" : "morning_main");
              const currentVal = getSubjectVal(subjectId);
              const config = parseSubjectSessionConfig(currentVal, getSubjectPeriod(subjectId, targetClass.grade, targetClass.id), subjectId, shift);
              const normSub = normalizeSubjectName(subjectId);

              const updatedConfig = {
                ...config,
                mainPeriods: 0,
                oppPeriods: 0,
                isRemoved: true
              };

              setDraftHoursMap(prev => {
                const classPeriods = prev[targetClass.id] || prev[cleanId] || prev[prefixedId] || (targetClass.name ? prev[targetClass.name] : {}) || {};
                const nextClassPeriods = {
                  ...classPeriods,
                  [subjectId]: updatedConfig,
                  [normSub]: updatedConfig
                };

                return {
                  ...prev,
                  [targetClass.id]: nextClassPeriods,
                  [cleanId]: nextClassPeriods,
                  [prefixedId]: nextClassPeriods,
                  ...(targetClass.name ? { [targetClass.name]: nextClassPeriods } : {})
                };
              });

              setIsPeriodsDirty(true);
              showTermNotification(`🗑️ Đã xóa môn "${subLabel}" khỏi lớp ${targetClass.name} (Chưa lưu - Bấm "Lưu" để áp dụng)!`);
            };

            const handleAddSubjectToClass = () => {
              if (!isAdmin) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              if (!currentTreeClass) return;
              if (!addSubjectToClassId) {
                showTermNotification("⚠️ Vui lòng chọn môn học từ danh mục!");
                return;
              }
              if (isCurrentTermLocked) {
                showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                return;
              }

              const subObj = subjectsConfig.find(s => s.id === addSubjectToClassId);
              const subName = subObj ? subObj.name || subObj.id : addSubjectToClassId;
              const targetClass = currentTreeClass;
              const cleanId = targetClass.id.replace(/^c_/, "");
              const prefixedId = "c_" + cleanId;
              const shift = classShifts[targetClass.id] || classShifts[cleanId] || (targetClass.grade === "10" ? "afternoon_main" : "morning_main");
              const currentVal = getSubjectVal(addSubjectToClassId);
              const config = parseSubjectSessionConfig(currentVal, getSubjectPeriod(addSubjectToClassId, targetClass.grade, targetClass.id), addSubjectToClassId, shift);
              const normSub = normalizeSubjectName(addSubjectToClassId);

              const updatedConfig = {
                ...config,
                mainPeriods: Math.max(0, addSubjectMainPeriods),
                oppPeriods: Math.max(0, addSubjectOppPeriods),
                isRemoved: false
              };

              setDraftHoursMap(prev => {
                const classPeriods = prev[targetClass.id] || prev[cleanId] || prev[prefixedId] || (targetClass.name ? prev[targetClass.name] : {}) || {};
                const nextClassPeriods = {
                  ...classPeriods,
                  [addSubjectToClassId]: updatedConfig,
                  [normSub]: updatedConfig
                };

                return {
                  ...prev,
                  [targetClass.id]: nextClassPeriods,
                  [cleanId]: nextClassPeriods,
                  [prefixedId]: nextClassPeriods,
                  ...(targetClass.name ? { [targetClass.name]: nextClassPeriods } : {})
                };
              });

              setIsPeriodsDirty(true);
              showTermNotification(`✅ Đã thêm môn "${subName}" vào lớp ${targetClass.name} (${addSubjectMainPeriods}t chính khóa, ${addSubjectOppPeriods}t trái buổi) (Chưa lưu - Bấm "Lưu" để áp dụng)!`);

              setAddSubjectToClassId("");
              setAddSubjectMainPeriods(2);
              setAddSubjectOppPeriods(0);
            };

            const handleSaveClassPeriods = () => {
              if (!isAdmin) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              if (isCurrentTermLocked) {
                showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                return;
              }

              // 1. CHỈ CẬP NHẬT CÁC LỚP CÓ SỰ THAY ĐỔI (DELTA UPDATE):
              // So sánh trực tiếp giữa draftHoursMap và classSubjectPeriods
              const changedClasses: ClassModel[] = [];
              classes.forEach(cls => {
                const cleanId = cls.id.replace(/^c_/, "");
                const prefId = "c_" + cleanId;
                const draftObj = draftHoursMap[cls.id] || draftHoursMap[cleanId] || draftHoursMap[prefId] || (cls.name ? draftHoursMap[cls.name] : null);
                const origObj = classSubjectPeriods[cls.id] || classSubjectPeriods[cleanId] || classSubjectPeriods[prefId] || (cls.name ? classSubjectPeriods[cls.name] : null);

                if (!draftObj && !origObj) return;
                if (!draftObj || !origObj) {
                  changedClasses.push(cls);
                  return;
                }
                if (JSON.stringify(draftObj) !== JSON.stringify(origObj)) {
                  changedClasses.push(cls);
                }
              });

              // Nếu có lớp thay đổi, chỉ thao tác trên danh sách đó; nếu không có, ưu tiên lớp đang xem
              const targetClassesToUpdate = changedClasses.length > 0 
                ? changedClasses 
                : (currentTreeClass ? [currentTreeClass] : classes);

              // Tạo nextPeriods từ classSubjectPeriods hiện tại và chỉ ghi đè các lớp có thay đổi
              const nextPeriods = { ...classSubjectPeriods };
              targetClassesToUpdate.forEach(cls => {
                const cleanId = cls.id.replace(/^c_/, "");
                const prefId = "c_" + cleanId;
                const draftData = draftHoursMap[cls.id] || draftHoursMap[cleanId] || draftHoursMap[prefId] || (cls.name ? draftHoursMap[cls.name] : {});
                nextPeriods[cls.id] = draftData;
                nextPeriods[cleanId] = draftData;
                nextPeriods[prefId] = draftData;
                if (cls.name) nextPeriods[cls.name] = draftData;
              });

              // 2. TỐI ƯU BƯỚC DỌN SẠCH PHÂN CÔNG (AUTO-CLEANUP):
              // Tuyệt đối KHÔNG duyệt qua toàn bộ 44 lớp của trường.
              // Chỉ duyệt qua các môn có số tiết = 0 của những lớp nằm trong targetClassesToUpdate.
              let hasAssignmentChanges = false;
              const nextSubjectAssignments = { ...assignments.subjectAssignments };

              targetClassesToUpdate.forEach(cls => {
                const cleanId = cls.id.replace(/^c_/, "");
                const prefId = "c_" + cleanId;
                const keysToCheck = [cls.id, cleanId, prefId, cls.name].filter(Boolean);
                const classPeriodsObj = nextPeriods[cls.id] || nextPeriods[cleanId] || nextPeriods[prefId] || (cls.name ? nextPeriods[cls.name] : {}) || {};

                SUBJECTS.forEach(sub => {
                  const rawVal = classPeriodsObj[sub.id] || classPeriodsObj[normalizeSubjectName(sub.id)];
                  let total = 0;
                  let isRemoved = false;

                  if (rawVal !== undefined) {
                    if (typeof rawVal === "object" && rawVal !== null) {
                      isRemoved = Boolean(rawVal.isRemoved);
                      const main = Number(rawVal.mainPeriods) || 0;
                      const opp = Number(rawVal.oppPeriods) || 0;
                      total = isRemoved ? 0 : (main + opp);
                    } else if (typeof rawVal === "number") {
                      total = Math.max(0, rawVal);
                    }
                  } else {
                    total = getSubjectPeriod(sub.id, cls.grade, cls.id);
                  }

                  if (total <= 0 || isRemoved) {
                    const normSub = normalizeSubjectName(sub.id);
                    keysToCheck.forEach(k => {
                      const row = nextSubjectAssignments[k as string];
                      if (row && (row[sub.id] || row[normSub])) {
                        const classCopy = { ...row };
                        if (classCopy[sub.id]) delete classCopy[sub.id];
                        if (classCopy[normSub]) delete classCopy[normSub];
                        if (normSub === "GDQPAN") {
                          delete classCopy["GDQPAN"];
                          delete classCopy["GD QP-AN"];
                          delete classCopy["GDQP"];
                        }
                        if (normSub === "GDKTPL") {
                          delete classCopy["GDKTPL"];
                          delete classCopy["GD"];
                          delete classCopy["KTPL"];
                        }
                        nextSubjectAssignments[k as string] = classCopy;
                        hasAssignmentChanges = true;
                      }
                    });
                  }
                });
              });

              // 3. ÁP DỤNG OPTIMISTIC UI (PHẢN HỒI NGAY LẬP TỨC < 50ms):
              // Lập tức chuyển cờ isDirty = false (nút Lưu mờ lại ngay)
              setIsPeriodsDirty(false);

              // Cập nhật state chính thức ngay lập tức
              setClassSubjectPeriods(nextPeriods);
              (window as any).DATA_TIET_THEO_LOP = nextPeriods;

              let updatedAssignmentsPayload: any = null;
              if (hasAssignmentChanges) {
                updatedAssignmentsPayload = { ...assignments, subjectAssignments: nextSubjectAssignments };
                setAssignments(updatedAssignmentsPayload);
              }

              // Hiển thị thông báo thành công tức thì không chờ đợi
              const saveMsg = targetClassesToUpdate.length === 1
                ? `✅ Đã lưu cấu hình số tiết lớp ${targetClassesToUpdate[0].name} thành công!`
                : `✅ Đã lưu cấu hình số tiết cho ${targetClassesToUpdate.length} lớp có thay đổi!`;
              showTermNotification(saveMsg);

              // Ghi localStorage đồng bộ tức thì
              try {
                localStorage.setItem("edu_class_subject_periods_v2", JSON.stringify(nextPeriods));
                localStorage.setItem(`edu_term_class_periods_${currentTermKey}`, JSON.stringify(nextPeriods));
                if (hasAssignmentChanges && updatedAssignmentsPayload) {
                  localStorage.setItem("edu_assignments_v3", JSON.stringify(updatedAssignmentsPayload));
                  localStorage.setItem("edu_assignments", JSON.stringify(updatedAssignmentsPayload));
                  localStorage.setItem(`edu_term_assignments_${currentTermKey}`, JSON.stringify(updatedAssignmentsPayload));
                }
              } catch (e) {
                console.warn("[LocalStorage] Error saving class periods:", e);
              }

              // 4. QUÁ TRÌNH GHI FIREBASE CHẠY NGẦM BẤT ĐỒNG BỘ (ASYNC BACKGROUND TASK - KHÔNG ĐƠ UI):
              (async () => {
                try {
                  if (TARGET_TERM_DOC_REF && SCHOOL_DOC_REF) {
                    const payload: Record<string, any> = {
                      classSubjectPeriods: removeUndefinedFields(nextPeriods),
                      classShifts: removeUndefinedFields(classShifts),
                      classThreeConsecutivePeriods: removeUndefinedFields(classThreeConsecutivePeriods),
                      allowThreeConsecutivePeriods,
                      updatedAt: new Date().toISOString()
                    };
                    if (hasAssignmentChanges && updatedAssignmentsPayload) {
                      payload.assignments = removeUndefinedFields(updatedAssignmentsPayload);
                    }
                    await Promise.all([
                      setDoc(TARGET_TERM_DOC_REF, payload, { merge: true }),
                      setDoc(SCHOOL_DOC_REF, { classSubjectPeriods: removeUndefinedFields(nextPeriods), updatedAt: new Date().toISOString() }, { merge: true })
                    ]);
                    invalidateTermCache(currentTermKey);
                  }
                } catch (err: any) {
                  console.warn("[Firestore] Error saving class subject periods in background:", err?.message || err);
                }
              })();
            };

            return (
              <ClassPeriodsEditor
                classes={classes}
                selectedClassId={selectedTreeClassId}
                onSelectClass={setSelectedTreeClassId}
                subjectsConfig={subjectsConfig}
                classSubjectPeriods={draftHoursMap}
                isDirty={isPeriodsDirty}
                onSave={handleSaveClassPeriods}
                classShifts={classShifts}
                classThreeConsecutivePeriods={classThreeConsecutivePeriods}
                allowThreeConsecutivePeriods={allowThreeConsecutivePeriods}
                onToggleAllowThreeConsecutive={setAllowThreeConsecutivePeriods}
                onUpdateSubjectSessionConfig={handleUpdateSubjectSessionConfig}
                onUpdateClassShift={(classId, val) => setClassShifts(prev => ({ ...prev, [classId]: val }))}
                onRemoveSubjectFromClass={handleRemoveSubjectFromClass}
                onMoveSubject={handleMoveSubject}
                onOpenCopyModal={(cid) => handleOpenCopyPeriodsModal(cid)}
                onResetClassPeriods={(cid) => {
                  if (isCurrentTermLocked) {
                    showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                    return;
                  }
                  const targetCls = classes.find(c => c.id === cid);
                  setDeleteConfirmation({
                    type: "class_subject",
                    title: "Xác nhận xóa số tiết tùy chỉnh của lớp",
                    entityName: `Lớp ${targetCls?.name || cid}`,
                    subtitle: `Khối ${targetCls?.grade || ""}`,
                    warning: `Toàn bộ số tiết tùy chỉnh riêng của lớp ${targetCls?.name || cid} sẽ bị xóa và khôi phục về định mức mặc định của khối.`,
                    confirmText: "Khôi phục về mặc định",
                    onConfirm: () => {
                      handleResetClassPeriods(cid);
                    }
                  });
                }}
                onToggleThreeConsecutive={(cid, sid, checked) => {
                  setClassThreeConsecutivePeriods(prev => {
                    const classObj = { ...(prev[cid] || {}) };
                    if (checked) {
                      classObj[sid] = true;
                    } else {
                      delete classObj[sid];
                    }
                    const nextState = { ...prev, [cid]: classObj };
                    try {
                      localStorage.setItem("edu_class_three_consecutive_periods", JSON.stringify(nextState));
                    } catch {}
                    return nextState;
                  });
                }}
                isAdmin={isAdmin}
                isLocked={isCurrentTermLocked}
                academicYear={currentAcademicYear}
                onOpenLogin={openLoginModal}
                onOpenNlImport={() => {
                  setNlImportType('lessonHours');
                  setIsNlImportOpen(true);
                }}
                onNavigateToCatalog={() => setActiveTab("subject_catalog")}
                homeroomTeacherName={teachers.find(t => t.id === assignments.homeroomAssignments[selectedTreeClassId])?.name}
                addSubjectToClassId={addSubjectToClassId}
                setAddSubjectToClassId={setAddSubjectToClassId}
                addSubjectMainPeriods={addSubjectMainPeriods}
                setAddSubjectMainPeriods={setAddSubjectMainPeriods}
                addSubjectOppPeriods={addSubjectOppPeriods}
                setAddSubjectOppPeriods={setAddSubjectOppPeriods}
                onAddSubjectToClass={handleAddSubjectToClass}
                parseConfig={parseSubjectSessionConfig}
                getSubjectPeriod={getSubjectPeriod}
                onRefreshCloud={handleForcePullFromCloud}
              />
            );
          })()}

          {/* TAB 4: STATS & REPORTS */}
          {activeTab === 'stats' && (() => {
            const overloadedTeachers = teachers.filter(t => getTeacherStats(t.id).warnings.length > 0);
            const underloadedTeachers = teachers.filter(t => {
              const stats = getTeacherStats(t.id);
              return stats.totalPeriods < t.maxPeriods - 5;
            });

            return (
              <div className="flex-1 flex flex-col p-3 md:p-4 min-h-0 bg-slate-50/40">
                {/* Header & Tabs Navigation: [Phân công & Giảng dạy] | [Thống kê Nhân sự & Đội ngũ] */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-slate-200 pb-3">
                  <div>
                    <h2 className="text-[1.1rem] font-bold text-slate-900 leading-tight">
                      Thống kê và Phân tích Giáo dục
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Báo cáo tổng hợp phân công chuyên môn, định mức tiết và cơ cấu đội ngũ nhân sự
                    </p>
                  </div>

                  {/* Tabs Navigation */}
                  <div className="inline-flex items-center p-1 bg-slate-200/80 rounded-xl gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setStatsSubTab('teaching')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        statsSubTab === 'teaching'
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                      <span>📊 Phân công & Giảng dạy</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatsSubTab('personnel')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        statsSubTab === 'personnel'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      <span>👥 Thống kê Nhân sự & Đội ngũ</span>
                    </button>
                  </div>
                </div>

                {/* TAB 1: PHÂN CÔNG & GIẢNG DẠY */}
                {statsSubTab === 'teaching' && (() => {
                  // -------------------------------------------------------------
                  // 1. THỐNG KÊ TẢI CA HỌC (SÁNG / CHIỀU) TOÀN TRƯỜNG & THEO KHỐI
                  // -------------------------------------------------------------
                  let morningTotal = 0;
                  let afternoonTotal = 0;
                  const gradeShiftStats: Record<string, { morning: number; afternoon: number; total: number; classCount: number }> = {
                    '10': { morning: 0, afternoon: 0, total: 0, classCount: 0 },
                    '11': { morning: 0, afternoon: 0, total: 0, classCount: 0 },
                    '12': { morning: 0, afternoon: 0, total: 0, classCount: 0 },
                  };

                  classes.forEach(cls => {
                    const g = cls.grade || (cls.name.startsWith('10') ? '10' : cls.name.startsWith('11') ? '11' : '12');
                    if (!gradeShiftStats[g]) {
                      gradeShiftStats[g] = { morning: 0, afternoon: 0, total: 0, classCount: 0 };
                    }
                    gradeShiftStats[g].classCount++;

                    const shiftVal = classShifts[cls.id] || (cls.grade === '10' ? 'afternoon_main' : 'morning_main');
                    const isMorningMain = shiftVal === 'morning_main' || shiftVal === 'morning';

                    SUBJECTS.forEach(sub => {
                      const normSub = normalizeSubjectName(sub.id);
                      const val = classSubjectPeriods[cls.id]?.[normSub] !== undefined 
                        ? classSubjectPeriods[cls.id]?.[normSub] 
                        : classSubjectPeriods[cls.id]?.[sub.id];
                      const defaultP = getSubjectPeriod(sub.id, cls.grade as any, cls.id);
                      const cfg = parseSubjectSessionConfig(val, defaultP, sub.id, shiftVal);

                      const mPeriods = isMorningMain ? cfg.mainPeriods : cfg.oppPeriods;
                      const aPeriods = isMorningMain ? cfg.oppPeriods : cfg.mainPeriods;

                      morningTotal += mPeriods;
                      afternoonTotal += aPeriods;

                      gradeShiftStats[g].morning += mPeriods;
                      gradeShiftStats[g].afternoon += aPeriods;
                      gradeShiftStats[g].total += (mPeriods + aPeriods);
                    });
                  });

                  const totalAllShifts = morningTotal + afternoonTotal;
                  const morningTotalPct = totalAllShifts > 0 ? Math.round((morningTotal / totalAllShifts) * 100) : 0;
                  const afternoonTotalPct = totalAllShifts > 0 ? 100 - morningTotalPct : 0;

                  // -------------------------------------------------------------
                  // 2. TÍNH TOÁN DỰ TOÁN THỪA / THIẾU TIẾT HỌC KỲ CHO TỪNG GIÁO VIÊN
                  // -------------------------------------------------------------
                  const excessTeachingList = teachers.map(t => {
                    const stats = getTeacherStats(t.id);
                    const matchedDept = departments.find(d => d.id === (t as any).departmentId)?.name 
                      || (t as any).toChuyenMon 
                      || getDefaultDepartment(t.specialization, t.specialization) 
                      || 'Tổ chuyên môn';
                    // Chênh lệch thừa / thiếu = Số tiết thực dạy - Định mức chuẩn đã trừ kiêm nhiệm
                    const diff = stats.assignedPeriods - stats.maxAllowed;
                    const isDualWarning = stats.isHomeroom && stats.totalPeriods > t.maxPeriods;
                    const semesterExcess = diff > 0 ? diff * 18 : 0;
                    const semesterDeficit = diff < 0 ? Math.abs(diff) * 18 : 0;
                    const positionLabel = t.position || ((t as any).isTeamLeader ? 'Tổ trưởng' : ((t as any).isViceLeader ? 'Phó tổ trưởng' : 'Giáo viên'));

                    return {
                      teacher: t,
                      stats,
                      deptName: matchedDept,
                      diff,
                      isDualWarning,
                      semesterExcess,
                      semesterDeficit,
                      positionLabel
                    };
                  });

                  // Danh sách giáo viên cảnh báo kép
                  const dualWarningList = excessTeachingList.filter(item => item.isDualWarning);

                  // Lọc và sắp xếp danh sách thừa / thiếu
                  let displayedExcessList = excessTeachingList.filter(item => {
                    if (excessTeachingSearch.trim()) {
                      const q = excessTeachingSearch.toLowerCase().trim();
                      const matchName = item.teacher.name.toLowerCase().includes(q);
                      const resolvedSub = resolveTeacherSubject(item.teacher, SUBJECTS);
                      const qNoSpace = q.replace(/\s+/g, '');
                      const matchSpec = (
                        (item.teacher.specialization && item.teacher.specialization.toLowerCase().includes(q)) ||
                        (resolvedSub && resolvedSub.toLowerCase().includes(q)) ||
                        (item.teacher.specialization && item.teacher.specialization.toLowerCase().replace(/\s+/g, '').includes(qNoSpace)) ||
                        (resolvedSub && resolvedSub.toLowerCase().replace(/\s+/g, '').includes(qNoSpace))
                      );
                      const matchDept = item.deptName && item.deptName.toLowerCase().includes(q);
                      const matchCls = item.stats.isHomeroom && item.stats.homeroomClass.toLowerCase().includes(q);
                      if (!matchName && !matchSpec && !matchDept && !matchCls) return false;
                    }
                    if (excessTeachingFilter === 'overload') return item.diff > 0;
                    if (excessTeachingFilter === 'underload') return item.diff < 0;
                    if (excessTeachingFilter === 'exact') return item.diff === 0;
                    if (excessTeachingFilter === 'homeroom_overload') return item.isDualWarning;
                    return true;
                  });

                  displayedExcessList.sort((a, b) => {
                    if (excessTeachingSort === 'diff_desc') {
                      return b.diff - a.diff || a.teacher.name.localeCompare(b.teacher.name);
                    }
                    if (excessTeachingSort === 'diff_asc') {
                      return a.diff - b.diff || a.teacher.name.localeCompare(b.teacher.name);
                    }
                    if (excessTeachingSort === 'name') {
                      return a.teacher.name.localeCompare(b.teacher.name);
                    }
                    if (excessTeachingSort === 'dept') {
                      return a.deptName.localeCompare(b.deptName) || b.diff - a.diff;
                    }
                    return 0;
                  });

                  // Tổng hợp chỉ số
                  const overloadCount = excessTeachingList.filter(i => i.diff > 0).length;
                  const underloadCount = excessTeachingList.filter(i => i.diff < 0).length;
                  const exactCount = excessTeachingList.filter(i => i.diff === 0).length;
                  const totalWeeklyOverload = excessTeachingList.filter(i => i.diff > 0).reduce((sum, i) => sum + i.diff, 0);
                  const totalSemesterOverload = totalWeeklyOverload * 18;
                  const totalActualTeachingPeriods = excessTeachingList.reduce((sum, i) => sum + i.stats.assignedPeriods, 0);

                  // -------------------------------------------------------------
                  // XUẤT FILE EXCEL BÁO CÁO THỪA GIỜ PHỤC VỤ THANH QUYẾT TOÁN
                  // -------------------------------------------------------------
                  const handleExportExcessTeachingExcel = () => {
                    try {
                      const dataRows = displayedExcessList.map((item, idx) => ({
                        'STT': idx + 1,
                        'Họ và tên GV': item.teacher.name,
                        'Tổ Chuyên môn': item.deptName,
                        'Môn giảng dạy': item.teacher.specialization || '',
                        'Chức vụ / Kiêm nhiệm': item.positionLabel,
                        'GVCN Lớp': item.stats.isHomeroom ? item.stats.homeroomClass : 'Không',
                        'Định mức gốc (tiết/tuần)': item.teacher.maxPeriods,
                        'Tiết kiêm nhiệm / Chủ nhiệm': item.stats.homeroomPeriods,
                        'Định mức chuẩn sau trừ kiêm nhiệm (tiết/tuần)': item.stats.maxAllowed,
                        'Số tiết thực dạy (tiết/tuần)': item.stats.assignedPeriods,
                        'Thừa / Thiếu (+/-) (tiết/tuần)': item.diff > 0 ? `+${item.diff}` : `${item.diff}`,
                        'Dự tính tổng tiết vượt HK1 (nhân hệ số 18 tuần)': item.diff > 0 ? item.diff * 18 : 0,
                        'Dự tính số tiết thiếu HK1 (18 tuần)': item.diff < 0 ? Math.abs(item.diff) * 18 : 0,
                        'Tình trạng thanh quyết toán': item.diff > 0 
                          ? (item.isDualWarning ? '🔥 Vừa làm GVCN vừa vượt định mức dạy' : 'Thanh toán thù lao thừa giờ')
                          : (item.diff === 0 ? 'Đúng định mức chuẩn' : 'Chưa đủ định mức dạy'),
                        'Các lớp đang giảng dạy': item.stats.assignedClasses.join(', ') || 'Chưa phân công'
                      }));

                      const ws = XLSX.utils.json_to_sheet(dataRows);
                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'Du_Toan_Thua_Thieu_HK1');

                      const fileName = `Bao_Cao_Thua_Thieu_Tiet_HK1_2026_2027_${schoolInfo.schoolName.replace(/\\s+/g, '_')}.xlsx`;
                      XLSX.writeFile(wb, fileName);
                      showTermNotification(`✅ Đã xuất báo cáo dự toán thừa/thiếu tiết học kỳ ra file Excel (${fileName})!`);
                    } catch (err) {
                      console.error(err);
                      alert('Đã xảy ra lỗi khi xuất file Excel báo cáo thừa giờ.');
                    }
                  };

                  return (
                    <div className="space-y-4">
                      {/* TIỆN ÍCH 1: BIỂU ĐỒ & THẺ PHÂN TÍCH TẢI CA HỌC (SÁNG / CHIỀU) */}
                      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-slate-100 gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200/80">
                              <Sun className="w-4 h-4 text-amber-600" />
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-800 text-xs md:text-sm flex items-center gap-2">
                                <span>Phân tích Tải Ca học (Sáng / Chiều)</span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono font-normal">
                                  {classes.length} lớp học
                                </span>
                              </h3>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Thống kê tổng số tiết học buổi Sáng (Chính khóa) và Chiều (Trái buổi) của toàn trường và theo từng Khối (K10, K11, K12)
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-start sm:self-auto text-xs">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80 font-semibold text-[11px]">
                              <Sun className="w-3.5 h-3.5 text-amber-600" />
                              <span>Sáng (Chính khóa)</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200/80 font-semibold text-[11px]">
                              <Moon className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Chiều (Trái buổi)</span>
                            </span>
                          </div>
                        </div>

                        {/* 4 Thẻ chỉ số & Biểu đồ tiến độ */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          {/* Toàn trường */}
                          <div className="p-3.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/30 flex flex-col justify-between shadow-2xs">
                            <div>
                              <div className="flex justify-between items-center mb-1.5">
                                <span className="text-xs font-bold text-slate-800">Toàn trường</span>
                                <span className="text-[10.5px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.2 rounded border border-blue-200">
                                  {classes.length} lớp
                                </span>
                              </div>
                              <div className="text-xl font-bold font-mono text-slate-900 mb-2">
                                {totalAllShifts} <span className="text-xs font-normal text-slate-500">tiết/tuần</span>
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex justify-between text-[11.5px]">
                                  <span className="text-amber-700 font-medium flex items-center gap-1">
                                    <Sun className="w-3 h-3" /> Sáng:
                                  </span>
                                  <span className="font-bold text-slate-800 font-mono">
                                    {morningTotal}t ({morningTotalPct}%)
                                  </span>
                                </div>
                                <div className="flex justify-between text-[11.5px]">
                                  <span className="text-indigo-700 font-medium flex items-center gap-1">
                                    <Moon className="w-3 h-3" /> Chiều:
                                  </span>
                                  <span className="font-bold text-slate-800 font-mono">
                                    {afternoonTotal}t ({afternoonTotalPct}%)
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 w-full bg-slate-200 h-2.5 rounded-full overflow-hidden flex shadow-inner">
                              <div className="bg-amber-500 h-full transition-all" style={{ width: `${morningTotalPct}%` }} title={`Sáng: ${morningTotal} tiết (${morningTotalPct}%)`} />
                              <div className="bg-indigo-600 h-full transition-all" style={{ width: `${afternoonTotalPct}%` }} title={`Chiều: ${afternoonTotal} tiết (${afternoonTotalPct}%)`} />
                            </div>
                          </div>

                          {/* Khối 10 */}
                          {(['10', '11', '12'] as const).map(g => {
                            const data = gradeShiftStats[g] || { morning: 0, afternoon: 0, total: 0, classCount: 0 };
                            const mPct = data.total > 0 ? Math.round((data.morning / data.total) * 100) : 0;
                            const aPct = data.total > 0 ? 100 - mPct : 0;

                            return (
                              <div key={g} className="p-3.5 rounded-xl border border-slate-200 bg-white flex flex-col justify-between shadow-2xs hover:border-blue-200 transition">
                                <div>
                                  <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-xs font-bold text-slate-800">Khối {g}</span>
                                    <span className="text-[10.5px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.2 rounded border border-slate-200 font-mono">
                                      {data.classCount} lớp
                                    </span>
                                  </div>
                                  <div className="text-xl font-bold font-mono text-slate-900 mb-2">
                                    {data.total} <span className="text-xs font-normal text-slate-500">tiết/tuần</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    <div className="flex justify-between text-[11.5px]">
                                      <span className="text-amber-700 font-medium flex items-center gap-1">
                                        <Sun className="w-3 h-3" /> Sáng:
                                      </span>
                                      <span className="font-bold text-slate-800 font-mono">
                                        {data.morning}t ({mPct}%)
                                      </span>
                                    </div>
                                    <div className="flex justify-between text-[11.5px]">
                                      <span className="text-indigo-700 font-medium flex items-center gap-1">
                                        <Moon className="w-3 h-3" /> Chiều:
                                      </span>
                                      <span className="font-bold text-slate-800 font-mono">
                                        {data.afternoon}t ({aPct}%)
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex border border-slate-200/60 shadow-inner">
                                  <div className="bg-amber-500 h-full transition-all" style={{ width: `${mPct}%` }} title={`Khối ${g} Sáng: ${data.morning} tiết (${mPct}%)`} />
                                  <div className="bg-indigo-600 h-full transition-all" style={{ width: `${aPct}%` }} title={`Khối ${g} Chiều: ${data.afternoon} tiết (${aPct}%)`} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 2 KHỐI HIỆN TẠI: TỈ LỆ PHÂN CÔNG THEO BỘ MÔN & CẢNH BÁO GIÁO VIÊN */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
                        {/* Left Column: Tỉ lệ phân công theo Bộ môn */}
                        <div className="border border-slate-200/90 rounded-lg p-3 bg-white shadow-2xs">
                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                            <h3 className="font-semibold text-xs md:text-[13px] text-slate-800 flex items-center gap-1.5">
                              <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
                              <span>Tỉ lệ phân công theo Bộ môn</span>
                            </h3>
                            <span className="text-[11px] text-slate-400 font-medium font-mono">
                              {SUBJECTS.length} môn • {classes.length} lớp
                            </span>
                          </div>

                          <div className="divide-y divide-slate-100">
                            {SUBJECTS.map(sub => {
                              const totalClassesWithSub = classes.length;
                              let assigned = 0;
                              classes.forEach(c => {
                                if (getAssignedTeacherId(c.id, sub.id)) assigned++;
                              });
                              const pct = totalClassesWithSub > 0 ? (assigned / totalClassesWithSub) * 100 : 0;
                              const isComplete = assigned >= totalClassesWithSub && totalClassesWithSub > 0;

                              return (
                                <div
                                  key={sub.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    padding: '3px 0',
                                    height: '26px'
                                  }}
                                >
                                  {/* Tên môn */}
                                  <span
                                    style={{
                                      width: '68px',
                                      fontSize: '0.82rem',
                                      fontWeight: 500,
                                      color: '#1e293b'
                                    }}
                                    className="truncate shrink-0"
                                    title={sub.name}
                                  >
                                    {sub.name}
                                  </span>

                                  {/* Thanh tiến độ */}
                                  <div
                                    style={{
                                      flexGrow: 1,
                                      height: '6px',
                                      borderRadius: '3px',
                                      background: '#e2e8f0',
                                      overflow: 'hidden'
                                    }}
                                    className="mx-1 relative"
                                  >
                                    <div
                                      style={{
                                        width: `${pct}%`,
                                        height: '100%',
                                        borderRadius: '3px',
                                        background: isComplete ? '#10b981' : '#2563eb',
                                        transition: 'width 0.3s ease'
                                      }}
                                    />
                                  </div>

                                  {/* Chỉ số số lớp */}
                                  <span
                                    style={{
                                      width: '85px',
                                      textAlign: 'right',
                                      fontSize: '0.78rem',
                                      color: isComplete ? '#059669' : '#64748b'
                                    }}
                                    className="shrink-0 font-medium font-mono"
                                  >
                                    {assigned}/{totalClassesWithSub} lớp
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Right Column: 2 Khối cảnh báo Giáo viên */}
                        <div className="space-y-3">
                          {/* Khối 1: Quá tải hoặc sai định mức (CÓ CẢNH BÁO KÉP GVCN + QUÁ TẢI) */}
                          <div className="border border-rose-200/90 rounded-lg p-3 bg-white shadow-2xs">
                            <div className="flex items-center justify-between pb-2 mb-2 border-b border-rose-100">
                              <h3 className="font-semibold text-xs md:text-[13px] text-rose-800 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Giáo viên quá tải hoặc sai định mức</span>
                              </h3>
                              <div className="flex items-center gap-1.5">
                                {dualWarningList.length > 0 && (
                                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-rose-600 text-white animate-pulse shadow-2xs">
                                    {dualWarningList.length} GVCN quá tải
                                  </span>
                                )}
                                <span className="text-[11px] font-semibold px-2 py-0.2 rounded-full bg-rose-100 text-rose-700 border border-rose-200 font-mono">
                                  {overloadedTeachers.length} GV
                                </span>
                              </div>
                            </div>

                            {/* Banner Cảnh báo Kép nếu có */}
                            {dualWarningList.length > 0 && (
                              <div className="mb-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2">
                                <span className="font-semibold flex items-center gap-1 text-[11.5px]">
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>Cảnh báo kép: <strong>{dualWarningList.length}</strong> giáo viên vừa làm GVCN vừa vượt định mức dạy!</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setExcessTeachingFilter('homeroom_overload')}
                                  className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px] hover:bg-rose-700 transition cursor-pointer shrink-0"
                                >
                                  Lọc xem
                                </button>
                              </div>
                            )}

                            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                              {overloadedTeachers.map(t => {
                                const stats = getTeacherStats(t.id);
                                const isDual = stats.isHomeroom && stats.totalPeriods > t.maxPeriods;

                                return (
                                  <div
                                    key={t.id}
                                    style={{ minHeight: '36px', padding: '4px 6px' }}
                                    className={`rounded-md flex justify-between items-center gap-2 transition ${
                                      isDual 
                                        ? 'bg-rose-100/80 border-2 border-rose-400 shadow-2xs' 
                                        : 'bg-rose-50/40 border border-rose-100/80 hover:bg-rose-50'
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span
                                          style={{
                                            fontWeight: 600,
                                            fontSize: '0.82rem',
                                            color: '#0f172a'
                                          }}
                                          className="truncate block"
                                        >
                                          {t.name}
                                        </span>
                                        {/* BADGE CẢNH BÁO KÉP (CHỦ NHIỆM + QUÁ TẢI) */}
                                        {isDual && (
                                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-rose-600 text-white shadow-2xs">
                                            <AlertTriangle className="w-2.5 h-2.5 text-white" />
                                            <span>GVCN {stats.homeroomClass} + Quá tải</span>
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-slate-500 text-[10.5px] truncate leading-tight mt-0.5">
                                        {t.specialization} • Định mức: {t.maxPeriods}t {stats.isHomeroom ? `(CN ${stats.homeroomClass}: -4t)` : ''}
                                      </p>
                                    </div>

                                    <div className="text-right shrink-0">
                                      <span
                                        style={{ fontSize: '0.8rem' }}
                                        className="text-rose-600 font-bold font-mono block leading-tight"
                                      >
                                        {stats.totalPeriods} / {t.maxPeriods} tiết
                                      </span>
                                      {stats.warnings[0] && (
                                        <span
                                          style={{ fontSize: '0.72rem' }}
                                          className="text-rose-500 font-normal inline-block truncate max-w-[150px] leading-tight"
                                          title={stats.warnings[0]}
                                        >
                                          {stats.warnings[0]}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                              {overloadedTeachers.length === 0 && (
                                <div className="py-6 text-center text-slate-400 text-xs italic">
                                  ✓ Không có giáo viên nào bị quá tải hay sai phạm định mức
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Khối 2: Dưới định mức (Chưa đủ tiết dạy) */}
                          <div className="border border-amber-200/90 rounded-lg p-3 bg-white shadow-2xs">
                            <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-100">
                              <h3 className="font-semibold text-xs md:text-[13px] text-amber-800 flex items-center gap-1.5">
                                <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Giáo viên dưới định mức (Chưa đủ tiết dạy)</span>
                              </h3>
                              <span className="text-[11px] font-semibold px-2 py-0.2 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-mono">
                                {underloadedTeachers.length} GV
                              </span>
                            </div>

                            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                              {underloadedTeachers.map(t => {
                                const stats = getTeacherStats(t.id);
                                const remainingPeriods = t.maxPeriods - stats.totalPeriods;

                                return (
                                  <div
                                    key={t.id}
                                    style={{ minHeight: '36px', padding: '4px 6px' }}
                                    className="bg-amber-50/40 border border-amber-100/80 rounded-md flex justify-between items-center gap-2 hover:bg-amber-50 transition"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <span
                                        style={{
                                          fontWeight: 500,
                                          fontSize: '0.82rem',
                                          color: '#0f172a'
                                        }}
                                        className="truncate block"
                                      >
                                        {t.name}
                                      </span>
                                      <p className="text-slate-400 text-[10.5px] truncate leading-tight">
                                        {t.specialization} • Dạy: {stats.assignedClasses.join(', ') || 'Chưa dạy lớp nào'}
                                      </p>
                                    </div>

                                    <div className="text-right shrink-0">
                                      <span
                                        style={{ fontSize: '0.8rem' }}
                                        className="text-amber-800 font-bold font-mono block leading-tight"
                                      >
                                        {stats.totalPeriods} / {t.maxPeriods} tiết
                                      </span>
                                      <span
                                        style={{ fontSize: '0.72rem' }}
                                        className="text-amber-600/90 font-medium block leading-tight"
                                      >
                                        Trống {remainingPeriods} tiết
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}

                              {underloadedTeachers.length === 0 && (
                                <div className="py-6 text-center text-slate-400 text-xs italic">
                                  ✓ Mọi giáo viên đều đã phân bổ đủ định mức
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* TIỆN ÍCH 2: BẢNG TỔNG HỢP DỰ TOÁN THỪA / THIẾU TIẾT HỌC KỲ (NẰM DƯỚI 2 KHỐI HIỆN TẠI) */}
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                        {/* Header & Tiêu đề Bảng */}
                        <div className="p-4 bg-slate-50/90 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200/80">
                              <Calculator className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900 text-xs md:text-sm flex items-center gap-2">
                                <span>Bảng Tổng hợp Dự toán Thừa / Thiếu Tiết Học Kỳ 1</span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold font-mono">
                                  Hệ số 18 tuần
                                </span>
                              </h3>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Tính toán định mức chuẩn sau giảm trừ, số tiết thực dạy, chênh lệch (+/-) và dự tính tổng số tiết vượt giờ cả học kỳ phục vụ thanh quyết toán thù lao
                              </p>
                            </div>
                          </div>

                          {/* Nút Xuất Excel báo cáo thừa giờ */}
                          <button
                            type="button"
                            onClick={handleExportExcessTeachingExcel}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs self-start md:self-auto shrink-0"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                            <span>Xuất Excel báo cáo thừa giờ</span>
                          </button>
                        </div>

                        {/* Thẻ tóm tắt chỉ số nhanh */}
                        <div className="p-3 bg-slate-100/60 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-[11px] text-slate-500 block">Tổng số giáo viên</span>
                            <span className="font-bold font-mono text-slate-800 text-sm">{teachers.length} GV</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-emerald-200">
                            <span className="text-[11px] text-emerald-700 font-medium block">Thừa giờ (Vượt chuẩn)</span>
                            <span className="font-bold font-mono text-emerald-700 text-sm">
                              {overloadCount} GV <span className="text-[11px] font-normal font-mono">(+{totalWeeklyOverload}t/tuần)</span>
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-rose-200">
                            <span className="text-[11px] text-rose-700 font-medium block">Dự toán vượt HK1 (x18)</span>
                            <span className="font-bold font-mono text-rose-700 text-sm">+{totalSemesterOverload} tiết</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-amber-200">
                            <span className="text-[11px] text-amber-700 font-medium block">Thiếu định mức</span>
                            <span className="font-bold font-mono text-amber-700 text-sm">{underloadCount} GV</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-blue-200">
                            <span className="text-[11px] text-blue-700 font-medium block">Đúng chuẩn định mức</span>
                            <span className="font-bold font-mono text-blue-700 text-sm">{exactCount} GV</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-indigo-200">
                            <span className="text-[11px] text-indigo-700 font-medium block">Tổng tiết dạy toàn trường</span>
                            <span className="font-bold font-mono text-indigo-700 text-sm">{totalActualTeachingPeriods} tiết/tuần</span>
                          </div>
                        </div>

                        {/* Toolbar: Tìm kiếm, Bộ lọc & Sắp xếp */}
                        <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                            <div className="relative flex-1">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                placeholder="Tìm theo tên giáo viên, môn, tổ chuyên môn, lớp CN..."
                                value={excessTeachingSearch}
                                onChange={e => setExcessTeachingSearch(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-emerald-500 focus:bg-white transition"
                              />
                            </div>

                            {/* Bộ lọc trạng thái */}
                            <select
                              value={excessTeachingFilter}
                              onChange={e => setExcessTeachingFilter(e.target.value as any)}
                              className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
                            >
                              <option value="all">Tất cả giáo viên ({excessTeachingList.length})</option>
                              <option value="overload">🔴 Chỉ giáo viên thừa giờ (+{overloadCount})</option>
                              <option value="homeroom_overload">🔥 Cảnh báo kép GVCN + Quá tải ({dualWarningList.length})</option>
                              <option value="underload">🟡 Chỉ giáo viên thiếu giờ ({underloadCount})</option>
                              <option value="exact">🟢 Đúng chuẩn định mức ({exactCount})</option>
                            </select>
                          </div>

                          {/* Sắp xếp */}
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 text-[11px] font-medium shrink-0">Sắp xếp:</span>
                            <select
                              value={excessTeachingSort}
                              onChange={e => setExcessTeachingSort(e.target.value as any)}
                              className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
                            >
                              <option value="diff_desc">Thừa giờ nhiều nhất (Giảm dần)</option>
                              <option value="diff_asc">Thiếu giờ nhiều nhất (Tăng dần)</option>
                              <option value="name">Tên giáo viên (A - Z)</option>
                              <option value="dept">Theo Tổ chuyên môn</option>
                            </select>
                          </div>
                        </div>

                        {/* Bảng Dữ liệu Chi tiết */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="bg-slate-100/90 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10.5px]">
                              <tr>
                                <th className="py-2.5 px-3 text-center w-12 border-r border-slate-200">STT</th>
                                <th className="py-2.5 px-3 min-w-[190px] border-r border-slate-200">HỌ TÊN GV</th>
                                <th className="py-2.5 px-3 min-w-[150px] border-r border-slate-200">TỔ CM</th>
                                <th className="py-2.5 px-3 text-center border-r border-slate-200">MÔN</th>
                                <th className="py-2.5 px-3 text-center border-r border-slate-200 min-w-[150px]" title="Định mức gốc trừ đi tiết kiêm nhiệm (chủ nhiệm 4 tiết...)">
                                  ĐỊNH MỨC CHUẨN (ĐÃ TRỪ KIÊM NHIỆM)
                                </th>
                                <th className="py-2.5 px-3 text-center border-r border-slate-200" title="Số tiết thực dạy trên lớp">
                                  SỐ TIẾT THỰC DẠY
                                </th>
                                <th className="py-2.5 px-3 text-center border-r border-slate-200" title="Chênh lệch thực dạy so với định mức chuẩn">
                                  THỪA / THIẾU (+/-)
                                </th>
                                <th className="py-2.5 px-3 text-center border-r border-slate-200 min-w-[160px]" title="Chênh lệch nhân hệ số 18 tuần thực học HK1">
                                  DỰ TÍNH TỔNG TIẾT VƯỢT HK1 (HỆ SỐ 18 TUẦN)
                                </th>
                                <th className="py-2.5 px-3 text-center min-w-[160px]">
                                  THANH QUYẾT TOÁN
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              {displayedExcessList.length === 0 ? (
                                <tr>
                                  <td colSpan={9} className="py-8 text-center text-slate-400 font-medium">
                                    Không tìm thấy giáo viên nào phù hợp với điều kiện tìm kiếm/bộ lọc.
                                  </td>
                                </tr>
                              ) : (
                                displayedExcessList.map((item, idx) => {
                                  const isOver = item.diff > 0;
                                  const isUnder = item.diff < 0;
                                  const isExact = item.diff === 0;

                                  return (
                                    <tr 
                                      key={item.teacher.id} 
                                      className={`hover:bg-blue-50/50 transition-colors ${
                                        item.isDualWarning 
                                          ? 'bg-rose-50/60 font-medium' 
                                          : idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                                      }`}
                                    >
                                      {/* STT */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-400 font-semibold">
                                        {idx + 1}
                                      </td>

                                      {/* Họ tên GV */}
                                      <td className="py-2 px-3 border-r border-slate-200">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-bold text-slate-900 text-xs">
                                            {item.teacher.name}
                                          </span>
                                          {/* Badge Cảnh báo Kép */}
                                          {item.isDualWarning && (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-600 text-white shadow-2xs">
                                              <AlertTriangle className="w-2.5 h-2.5 text-white" />
                                              <span>GVCN {item.stats.homeroomClass} + Quá tải</span>
                                            </span>
                                          )}
                                          {!item.isDualWarning && item.stats.isHomeroom && (
                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                              CN {item.stats.homeroomClass}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[10.5px] text-slate-400 mt-0.5">
                                          {item.positionLabel}
                                        </div>
                                      </td>

                                      {/* Tổ CM */}
                                      <td className="py-2 px-3 border-r border-slate-200 text-slate-700 font-medium">
                                        {item.deptName}
                                      </td>

                                      {/* Môn */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-semibold text-slate-800">
                                        {item.teacher.specialization || '—'}
                                      </td>

                                      {/* Định mức chuẩn (đã trừ tiết kiêm nhiệm) */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-mono">
                                        <span className="font-bold text-slate-900 text-xs">
                                          {item.stats.maxAllowed} tiết/tuần
                                        </span>
                                        {item.stats.homeroomPeriods > 0 && (
                                          <span className="block text-[10px] text-slate-400 font-sans">
                                            (Gốc {item.teacher.maxPeriods}t - CN {item.stats.homeroomPeriods}t)
                                          </span>
                                        )}
                                      </td>

                                      {/* Số tiết thực dạy */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-bold font-mono text-slate-900 text-xs">
                                        {item.stats.assignedPeriods} tiết
                                      </td>

                                      {/* Thừa / Thiếu (+/-) */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-mono">
                                        {isOver && (
                                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                                            +{item.diff} tiết
                                          </span>
                                        )}
                                        {isUnder && (
                                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                            {item.diff} tiết
                                          </span>
                                        )}
                                        {isExact && (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                                            Đủ định mức (0)
                                          </span>
                                        )}
                                      </td>

                                      {/* Dự tính tổng tiết vượt HK1 (nhân hệ số 18 tuần) */}
                                      <td className="py-2 px-3 text-center border-r border-slate-200 font-mono">
                                        {isOver && (
                                          <div>
                                            <span className="font-bold text-emerald-700 text-xs block">
                                              +{item.semesterExcess} tiết vượt
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-sans">
                                              ({item.diff}t × 18 tuần)
                                            </span>
                                          </div>
                                        )}
                                        {isUnder && (
                                          <div>
                                            <span className="font-medium text-amber-700 text-xs block">
                                              Thiếu {item.semesterDeficit} tiết
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-sans">
                                              ({Math.abs(item.diff)}t × 18 tuần)
                                            </span>
                                          </div>
                                        )}
                                        {isExact && (
                                          <span className="text-slate-400 text-xs">
                                            0 tiết
                                          </span>
                                        )}
                                      </td>

                                      {/* Thanh quyết toán */}
                                      <td className="py-2 px-3 text-center">
                                        {isOver && (
                                          <span className={`inline-block px-2.5 py-1 rounded text-[11px] font-bold ${
                                            item.isDualWarning 
                                              ? 'bg-rose-100 text-rose-800 border border-rose-300' 
                                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                          }`}>
                                            Thanh toán thừa giờ ({item.semesterExcess}t)
                                          </span>
                                        )}
                                        {isExact && (
                                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600">
                                            Đúng định mức
                                          </span>
                                        )}
                                        {isUnder && (
                                          <span className="inline-block px-2 py-0.5 rounded text-[10.5px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                            Chưa đủ định mức (-{item.semesterDeficit}t)
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                            <tfoot className="bg-slate-100/90 text-slate-800 font-bold border-t-2 border-slate-300 text-xs">
                              <tr>
                                <td colSpan={4} className="py-2.5 px-3 text-right">
                                  TỔNG CỘNG TOÀN TRƯỜNG ({displayedExcessList.length} GV):
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {displayedExcessList.reduce((sum, i) => sum + i.stats.maxAllowed, 0)} tiết
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono text-indigo-700">
                                  {displayedExcessList.reduce((sum, i) => sum + i.stats.assignedPeriods, 0)} tiết
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">
                                  {displayedExcessList.reduce((sum, i) => sum + (i.diff > 0 ? i.diff : 0), 0) > 0 ? (
                                    <span className="text-emerald-700">
                                      +{displayedExcessList.reduce((sum, i) => sum + (i.diff > 0 ? i.diff : 0), 0)} tiết thừa
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono text-emerald-800 text-xs">
                                  +{displayedExcessList.reduce((sum, i) => sum + i.semesterExcess, 0)} tiết vượt HK1
                                </td>
                                <td className="py-2.5 px-3 text-center text-[11px] text-slate-600 font-semibold">
                                  {displayedExcessList.filter(i => i.diff > 0).length} GV thừa giờ
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* TAB 2: THỐNG KÊ NHÂN SỰ & ĐỘI NGŨ (DASHBOARD ĐA CHIỀU & DANH SÁCH SẮP NGHỈ HƯU) */}
                {statsSubTab === 'personnel' && (
                  <TeacherHRStatsDashboard
                    teachers={teachers}
                    assignments={assignments}
                    classes={classes}
                    subjectsConfig={subjectsConfig}
                    classSubjectPeriods={classSubjectPeriods}
                    schoolName={schoolInfo.schoolName}
                    academicYear={currentAcademicYear}
                    semester={currentSemester}
                    getTeacherStats={getTeacherStats}
                    departments={departments}
                  />
                )}
              </div>
            );
          })()}

          {/* TAB 5: TIMETABLE (THỜI KHÓA BIỂU) */}
          {activeTab === 'timetable' && (
            <div className="flex-1 flex flex-col p-0 m-0" style={{ marginTop: '0px', paddingTop: '0px', overflow: 'visible' }}>
              <TimetableTab
                teachers={teachers}
                classes={classes}
                assignments={assignments}
                subjectsConfig={subjectsConfig}
                classSubjectPeriods={classSubjectPeriods}
                classShifts={classShifts}
                onUpdateClassShifts={setClassShifts}
                currentAcademicYear={currentAcademicYear}
                currentSemester={currentSemester}
                currentTermKey={currentTermKey}
                isCurrentTermLocked={isCurrentTermLocked}
                onNotification={showTermNotification}
                onOpenSendSchedule={() => setIsSendScheduleModalOpen(true)}
              />
            </div>
          )}

          {/* 1. MÀN HÌNH KHỞI ĐỘNG MẶC ĐỊNH (DEFAULT WELCOME / DASHBOARD VIEW) */}
          {(activeTab === 'welcome' || activeTab === null) && (
            <div className="flex-1 flex flex-col items-center justify-center py-12 md:py-20 px-6 text-center max-w-3xl mx-auto w-full animate-in fade-in duration-300">
              {/* Logo & Tên Trường */}
              <div className="flex flex-col items-center mb-7">
                <div className="w-24 h-24 md:w-28 md:h-28 rounded-3xl bg-white border border-slate-200/90 shadow-md p-3 flex items-center justify-center mb-5 transform hover:scale-105 transition-all duration-300">
                  <SchoolLogo
                    customLogo={customLogo}
                    alt="Logo Trường THPT Nguyễn Bỉnh Khiêm (An Giang)"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-blue-50 border border-blue-200/80 text-blue-700 text-xs font-bold uppercase tracking-wider mb-2.5 shadow-2xs">
                  <School className="w-3.5 h-3.5" />
                  <span>SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG</span>
                </div>
                <h1 
                  className="text-2xl sm:text-3xl font-extrabold uppercase text-center leading-tight tracking-wider bg-gradient-to-r from-blue-900 via-indigo-800 to-blue-700 bg-clip-text text-transparent transition-all duration-300 drop-shadow-[0_2px_4px_rgba(30,58,138,0.12)]"
                  style={{ 
                    fontFamily: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                    letterSpacing: '0.04em',
                    filter: 'drop-shadow(0 2px 4px rgba(30, 58, 138, 0.12))'
                  }}
                >
                  THPT NGUYỄN BỈNH KHIÊM
                </h1>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-sm font-bold text-indigo-700 font-mono">EduSchedule AI</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-xs text-slate-500 font-medium">
                    {(currentSemester || 'Học kỳ I').replace(/^(Học kỳ\s*)+/i, 'Học kỳ ')} — Năm học {currentAcademicYear || '2026 – 2027'}
                  </span>
                </div>
              </div>

              {/* Khung thông báo trung lập */}
              <div className="bg-white/90 border border-slate-200/90 rounded-2xl p-4 md:p-5 max-w-xl mx-auto shadow-xs backdrop-blur-xs mb-6">
                <p className="text-sm md:text-base text-slate-700 font-medium leading-relaxed">
                  Phần mềm Phân công giảng dạy và Xếp thời khóa biểu thông minh. Vui lòng chọn một tính năng trên thanh điều hướng để bắt đầu làm việc.
                </p>
              </div>

              {/* BẢNG TÓM TẮT NHANH TÌNH HÌNH HỆ THỐNG */}
              <div className="w-full max-w-2xl bg-white/70 backdrop-blur-xs border border-slate-200/80 rounded-2xl p-4 md:p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Tóm tắt dữ liệu hệ thống
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">
                    Cơ sở dữ liệu đang hoạt động
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                  {/* THẺ 1: TỔNG SỐ GIÁO VIÊN */}
                  <div 
                    onClick={() => setActiveTab('teachers')}
                    className="group bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-2xs hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                    title="Bấm để xem danh sách hồ sơ Giáo viên"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 group-hover:text-indigo-600 transition-colors">
                        Đội ngũ Giáo viên
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <Users className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-slate-900 group-hover:text-indigo-700 transition-colors font-mono">
                        {teachers.length}
                      </span>
                      <span className="text-xs font-bold text-slate-500">giáo viên</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="font-medium">100% hồ sơ đầy đủ</span>
                    </div>
                  </div>

                  {/* THẺ 2: SỐ LỚP HỌC */}
                  <div 
                    onClick={() => setActiveTab('classes')}
                    className="group bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-2xs hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                    title="Bấm để xem danh sách Lớp học"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 group-hover:text-emerald-600 transition-colors">
                        Quy mô Lớp học
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <GraduationCap className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-slate-900 group-hover:text-emerald-700 transition-colors font-mono">
                        {classes.length}
                      </span>
                      <span className="text-xs font-bold text-slate-500">lớp học</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {classes.filter(c => c.grade === '10').length} K10
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {classes.filter(c => c.grade === '11').length} K11
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {classes.filter(c => c.grade === '12').length} K12
                      </span>
                    </div>
                  </div>

                  {/* THẺ 3: TRẠNG THÁI ĐỒNG BỘ CLOUD */}
                  <div 
                    onClick={() => openLoginModal()}
                    className="group bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-2xs hover:border-blue-300 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                    title="Bấm để quản lý kết nối Cloud & Quyền Admin"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 group-hover:text-blue-600 transition-colors">
                        Đồng bộ Cloud
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleForcePullFromCloud();
                          }}
                          disabled={isPullingCloud}
                          title="Cập nhật dữ liệu từ Cloud (Tải lại 101 GV, 44 Lớp, TKB mới nhất)"
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${isPullingCloud ? 'animate-spin' : ''}`} />
                          <span>{isPullingCloud ? 'Đang tải...' : 'Cập nhật từ Cloud'}</span>
                        </button>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                          cloudConnectionStatus === 'connected'
                            ? 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white'
                            : cloudConnectionStatus === 'syncing'
                            ? 'bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white'
                            : 'bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white'
                        }`}>
                          <Cloud className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`relative flex h-2.5 w-2.5 ${cloudConnectionStatus === 'syncing' ? 'animate-pulse' : ''}`}>
                        {cloudConnectionStatus === 'connected' && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        )}
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                          cloudConnectionStatus === 'connected' 
                            ? 'bg-emerald-500' 
                            : cloudConnectionStatus === 'syncing' 
                            ? 'bg-amber-500' 
                            : 'bg-rose-500'
                        }`}></span>
                      </span>
                      <span className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                        {cloudConnectionStatus === 'connected' 
                          ? 'Đã kết nối' 
                          : cloudConnectionStatus === 'syncing' 
                          ? 'Đang đồng bộ' 
                          : 'Ngoại tuyến'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500 truncate" title={lastSyncedAt ? `Lần cuối: ${lastSyncedAt}` : 'Firestore đồng bộ tự động'}>
                      <span className="truncate">
                        {lastSyncedAt ? `Lần cuối: ${lastSyncedAt}` : 'Tự động đồng bộ Firestore'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* THANH CÔNG CỤ TÓM TẮT & NÚT XUẤT FILE SAO LƯU (.JSON) */}
                <div className="mt-4 pt-3.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                    <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Dự phòng an toàn: 101 GV, 44 Lớp, Phân công, TKB</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportAllBackupJson}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-95"
                    title="Tải toàn bộ dữ liệu (101 GV, 44 lớp, phân công, TKB) về máy tính làm file dự phòng an toàn tuyệt đối (.json)"
                  >
                    <Download className="w-4 h-4 text-white" />
                    <span>💾 XUẤT FILE SAO LƯU (.JSON)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* COMPONENT: TRỢ LÝ AI TOÀN CỤC (EduSchedule AI Consultant - Global Level) */}
        <AIAssistant
          activeTab={activeTab}
          teachers={teachers}
          classes={classes}
          subjects={SUBJECTS}
          lessonHoursMap={lessonHoursMap}
          assignments={assignments}
          timetableData={activeTimetableData}
          isOpen={isAiSidebarOpen}
          onClose={() => setIsAiSidebarOpen(false)}
          onToggle={() => setIsAiSidebarOpen(prev => !prev)}
          isAdmin={isAdmin}
          openLoginModal={openLoginModal}
          onApplySuggestedChanges={handleApplySuggestedChanges}
        />

      </div>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500 print:hidden mt-auto">
        <div className={`mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2 transition-all duration-200 ${
          isBoardFullscreen && activeTab === 'board' ? 'max-w-none px-4 md:px-6' : 'max-w-7xl'
        }`}>
          <p>© 2026 EduSchedule AI - Giải pháp Phân công & Thời khóa biểu Học đường Kỷ nguyên Mới</p>
          <p className="text-slate-400">Trợ lý Phân công & Lập lịch hoàn chỉnh tích hợp AI Studio & Gemini 3.8 Flash</p>
        </div>
      </footer>

      {/* MODAL 1: SUBJECT TEACHER ASSIGNMENT */}
      {selectedCell && (() => {
        const targetClass = classes.find(c => c.id === selectedCell.classId);
        const cellPeriod = targetClass ? getSubjectPeriod(selectedCell.subject, targetClass.grade, targetClass.id) : 0;
        const isZeroPeriod = cellPeriod === 0;
        const subjectObj = SUBJECTS.find(s => s.id === selectedCell.subject);
        const subjectDisplayName = 
          selectedCell.subject === 'GD' || selectedCell.subject === 'GDKTPL' ? 'GDKTPL' :
          selectedCell.subject === 'CN (Công nghiệp)' || selectedCell.subject === 'CNCN' ? 'CN' :
          normalizeSubjectName(selectedCell.subject) === 'GDQPAN' ? 'GDQPAN' :
          subjectObj?.name || selectedCell.subject;

        const query = modalTeacherSearch.trim().toLowerCase();
        const matchesSearch = (t: Teacher) => {
          if (!query) return true;
          return (
            t.name.toLowerCase().includes(query) ||
            t.specialization.toLowerCase().includes(query) ||
            (t.position && t.position.toLowerCase().includes(query)) ||
            (t.phone && t.phone.toLowerCase().includes(query))
          );
        };

        const sameSpecTeachers = teachers.filter(t => {
          return normalizeSubjectName(selectedCell.subject) === normalizeSubjectName(t.specialization) && matchesSearch(t);
        }).sort((a, b) => {
          const isHrA = assignments.homeroomAssignments[targetClass?.id || ''] === a.id ? 1 : 0;
          const isHrB = assignments.homeroomAssignments[targetClass?.id || ''] === b.id ? 1 : 0;
          return isHrB - isHrA;
        });

        const otherSpecTeachers = teachers.filter(t => {
          return normalizeSubjectName(selectedCell.subject) !== normalizeSubjectName(t.specialization) && matchesSearch(t);
        });

        const totalFilteredCount = sameSpecTeachers.length + otherSpecTeachers.length;

        const handleAttemptAssignSubject = (teacher: Teacher) => {
          const isSelected = selectedCell.currentTeacherId === teacher.id;
          const stats = getTeacherStats(teacher.id);
          const extraPeriods = isSelected ? 0 : (cellPeriod > 0 ? cellPeriod : 2);
          const predictedTotal = stats.totalPeriods + extraPeriods;
          const willBeOverloaded = predictedTotal > teacher.maxPeriods;
          const predictedExcess = willBeOverloaded ? predictedTotal - teacher.maxPeriods : 0;

          const currentGrades = stats.assignedGrades;
          const predictedGrades = new Set(currentGrades);
          if (targetClass && extraPeriods > 0) {
            predictedGrades.add(targetClass.grade);
          }
          const willExceedGrades = predictedGrades.size >= 3;

          const proceedToAssign = () => {
            if (willBeOverloaded || willExceedGrades) {
              const reasons: string[] = [];
              if (willBeOverloaded) {
                reasons.push(`vượt định mức ${predictedExcess} tiết (${predictedTotal}/${teacher.maxPeriods} tiết)`);
              }
              if (willExceedGrades) {
                const gradesStr = Array.from(predictedGrades).sort().map(g => `K${g}`).join(', ');
                reasons.push(`dạy quá 2 khối (${gradesStr})`);
              }

              setPendingAssignmentConfirm({
                teacherId: teacher.id,
                teacherName: teacher.name,
                reasonsText: reasons.join(' / '),
                confirmButtonText: 'Vẫn phân công',
                cancelButtonText: 'Hủy bỏ',
                onConfirm: () => {
                  handleSelectSubjectTeacher(teacher.id);
                  setPendingAssignmentConfirm(null);
                }
              });
              return;
            }

            handleSelectSubjectTeacher(teacher.id);
          };

          // RÀNG BUỘC SƯ PHẠM VỀ GVCN:
          // Khi người dùng đổi thủ công GV bộ môn tại lớp mà vô tình gỡ môn dạy của chính GVCN lớp đó:
          // Hiển thị hộp thoại cảnh báo (Confirm Modal) để người dùng xác nhận
          const hrTeacherId = assignments.homeroomAssignments[targetClass?.id || ''];
          const hrTeacher = teachers.find(t => t.id === hrTeacherId);
          if (hrTeacher && targetClass && teacher.id !== hrTeacher.id) {
            const hrSpec = resolveTeacherSubject(hrTeacher, SUBJECTS);
            const isHrSpec = normalizeSubjectName(selectedCell.subject) === normalizeSubjectName(hrSpec);
            const isCurrentlyHrTeaching = selectedCell.currentTeacherId === hrTeacher.id;

            if (isCurrentlyHrTeaching || isHrSpec) {
              setPendingAssignmentConfirm({
                title: '⚠️ CẢNH BÁO GỠ MÔN CỦA GVCN',
                message: `Thầy/Cô ${hrTeacher.name} đang là GVCN lớp ${targetClass.name}. Thao tác này sẽ gỡ môn ${subjectDisplayName} của chính GVCN lớp đó để chuyển cho Thầy/Cô ${teacher.name}! Bạn có chắc chắn muốn tiếp tục?`,
                confirmButtonText: 'Xác nhận chuyển môn',
                cancelButtonText: 'Hủy bỏ',
                onConfirm: () => {
                  proceedToAssign();
                }
              });
              return;
            }
          }

          proceedToAssign();
        };

        const handleAttemptClearSubject = () => {
          const hrTeacherId = assignments.homeroomAssignments[targetClass?.id || ''];
          const hrTeacher = teachers.find(t => t.id === hrTeacherId);
          if (hrTeacher && targetClass) {
            const hrSpec = resolveTeacherSubject(hrTeacher, SUBJECTS);
            const isHrSpec = normalizeSubjectName(selectedCell.subject) === normalizeSubjectName(hrSpec);
            const isCurrentlyHrTeaching = selectedCell.currentTeacherId === hrTeacher.id;

            if (isCurrentlyHrTeaching || isHrSpec) {
              setPendingAssignmentConfirm({
                title: '⚠️ CẢNH BÁO GỠ MÔN CỦA GVCN',
                message: `Thầy/Cô ${hrTeacher.name} đang là GVCN lớp ${targetClass.name}. Thao tác này sẽ gỡ bỏ môn ${subjectDisplayName} của chính GVCN lớp đó và để trống! Bạn có chắc chắn muốn tiếp tục?`,
                confirmButtonText: 'Xác nhận để trống',
                cancelButtonText: 'Hủy bỏ',
                onConfirm: () => {
                  handleSelectSubjectTeacher('');
                }
              });
              return;
            }
          }
          handleSelectSubjectTeacher('');
        };

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Phân công Giáo viên môn {subjectDisplayName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Lớp {targetClass?.name} ({cellPeriod} tiết/tuần)
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedCell(null)} 
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition cursor-pointer"
                  title="Đóng cửa sổ (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* BỘ CHỈNH SỬA SỐ TIẾT TRỰC TIẾP CHO LỚP */}
              <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>Số tiết môn {subjectDisplayName} của lớp {targetClass?.name}:</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {isZeroPeriod ? (
                        <span className="text-amber-700 font-semibold">Hiện 0 tiết (Không học). Chọn số tiết bên phải để kích hoạt phân công:</span>
                      ) : (
                        <span>Thời lượng kế hoạch: <strong className="text-blue-700">{cellPeriod} tiết/tuần</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Nút tăng/giảm và chọn nhanh số tiết */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (targetClass) {
                          handleUpdateClassPeriod(targetClass.id, selectedCell.subject, Math.max(0, cellPeriod - 1));
                        }
                      }}
                      disabled={cellPeriod <= 0 || !isAdmin || isCurrentTermLocked}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs transition disabled:opacity-40 cursor-pointer shadow-2xs"
                      title="Giảm 1 tiết"
                    >
                      -
                    </button>
                    <span className="font-extrabold text-sm w-9 text-center text-slate-900 bg-white border border-slate-200 py-0.5 rounded-lg shadow-2xs">
                      {cellPeriod}t
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (targetClass) {
                          handleUpdateClassPeriod(targetClass.id, selectedCell.subject, Math.min(15, cellPeriod + 1));
                        }
                      }}
                      disabled={!isAdmin || isCurrentTermLocked}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs transition cursor-pointer shadow-2xs"
                      title="Tăng 1 tiết"
                    >
                      +
                    </button>
                    
                    {/* Quick presets */}
                    <div className="flex items-center gap-1 ml-1">
                      {[1, 2, 3, 4].map(pNum => (
                        <button
                          key={pNum}
                          type="button"
                          onClick={() => {
                            if (targetClass) {
                              handleUpdateClassPeriod(targetClass.id, selectedCell.subject, pNum);
                            }
                          }}
                          disabled={!isAdmin || isCurrentTermLocked}
                          className={`px-2 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
                            cellPeriod === pNum
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                          }`}
                        >
                          {pNum}t
                        </button>
                      ))}
                      {cellPeriod > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (targetClass) {
                              handleUpdateClassPeriod(targetClass.id, selectedCell.subject, 0);
                            }
                          }}
                          disabled={!isAdmin || isCurrentTermLocked}
                          className="px-1.5 py-1 rounded-md text-[10px] font-medium text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer"
                          title="Đặt về 0 tiết (Không học)"
                        >
                          0t
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Ô tìm kiếm giáo viên */}
              <div className="p-3 bg-white border-b border-slate-100 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={modalTeacherSearch}
                    onChange={e => setModalTeacherSearch(e.target.value)}
                    placeholder="Tìm kiếm giáo viên (tên, chức vụ, SĐT)..."
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                    autoFocus
                  />
                  {modalTeacherSearch && (
                    <button
                      onClick={() => setModalTeacherSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200 transition cursor-pointer"
                      title="Xóa tìm kiếm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {isZeroPeriod && (
                <div className="mx-4 mt-3 p-2.5 bg-blue-50/80 border border-blue-200 rounded-lg text-blue-900 text-xs flex items-start gap-2 shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Mẹo phân công nhanh:</p>
                    <p className="text-[11px] text-blue-700 mt-0.5">
                      Bạn có thể chọn số tiết ở thanh trên (ví dụ 2t) hoặc nhấp trực tiếp vào một giáo viên bên dưới — hệ thống sẽ tự động chuyển môn học sang 2 tiết chuẩn và phân công giáo viên ngay!
                    </p>
                  </div>
                </div>
              )}
              
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                <button
                  onClick={handleAttemptClearSubject}
                  className="w-full text-left p-2.5 rounded-lg border border-dashed border-slate-200 text-rose-600 hover:bg-rose-50/50 font-medium text-xs transition cursor-pointer"
                >
                  ❌ Bỏ phân công giáo viên này (Để trống)
                </button>

                {totalFilteredCount === 0 && query ? (
                  <div className="py-8 text-center text-slate-400">
                    <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">Không tìm thấy giáo viên nào</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Không có giáo viên khớp với từ khóa "{modalTeacherSearch}"</p>
                    <button
                      onClick={() => setModalTeacherSearch('')}
                      className="mt-3 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Xóa từ khóa tìm kiếm
                    </button>
                  </div>
                ) : (
                  <>
                    {sameSpecTeachers.length > 0 && (
                      <>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 flex items-center justify-between">
                          <span>Giáo viên đúng chuyên môn ({subjectDisplayName}):</span>
                          <span className="text-[10px] font-normal text-slate-400">{sameSpecTeachers.length} GV</span>
                        </div>

                        {sameSpecTeachers.map(teacher => {
                          const stats = getTeacherStats(teacher.id);
                          const isSelected = selectedCell.currentTeacherId === teacher.id;
                          const isHomeroomOfThisClass = assignments.homeroomAssignments[targetClass?.id || ''] === teacher.id;

                          const extraPeriods = isSelected ? 0 : (cellPeriod > 0 ? cellPeriod : 2);
                          const predictedTotal = stats.totalPeriods + extraPeriods;
                          const willBeOverloaded = predictedTotal > teacher.maxPeriods;
                          const isAlreadyOverloaded = stats.totalPeriods > teacher.maxPeriods;
                          const currentGrades = stats.assignedGrades;
                          const predictedGrades = new Set(currentGrades);
                          if (targetClass && extraPeriods > 0) {
                            predictedGrades.add(targetClass.grade);
                          }
                          const willExceedGrades = predictedGrades.size >= 3;
                          const isAddingThirdGrade = !currentGrades.has(targetClass?.grade as any) && currentGrades.size >= 2;
                          const hasViolation = willBeOverloaded || willExceedGrades;

                          return (
                            <button
                              key={teacher.id}
                              onClick={() => handleAttemptAssignSubject(teacher)}
                              className={`w-full text-left p-3 rounded-lg border transition-all text-xs flex justify-between items-center cursor-pointer ${
                                isHomeroomOfThisClass
                                  ? 'border-emerald-300 bg-emerald-50/50 hover:bg-emerald-100/60 text-slate-800'
                                  : isSelected
                                  ? 'border-blue-600 bg-blue-50/50 font-semibold text-blue-900'
                                  : hasViolation
                                  ? 'border-rose-200 bg-rose-50/30 hover:bg-rose-100/60 text-slate-800'
                                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <div>
                                <div className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                                  <span className={hasViolation ? 'text-rose-950 font-bold' : ''}>{teacher.name}</span>
                                  {isHomeroomOfThisClass && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded border border-emerald-300">
                                      GVCN của lớp
                                    </span>
                                  )}
                                  {teacher.position && teacher.position !== 'Giáo viên' && (
                                    <span className="text-[10px] font-normal px-1.5 py-0.2 bg-blue-50 text-blue-700 rounded border border-blue-200">
                                      {teacher.position}
                                    </span>
                                  )}
                                  {/* CẢNH BÁO TRỰC QUAN */}
                                  {willBeOverloaded && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-rose-100 text-rose-700 rounded border border-rose-200">
                                      {isAlreadyOverloaded ? `Quá tải (${stats.totalPeriods}t)` : `${predictedTotal}t (Sắp quá tải)`}
                                    </span>
                                  )}
                                  {(willExceedGrades || isAddingThirdGrade) && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded border border-amber-200" title={`Các khối đã dạy: ${Array.from(currentGrades).sort().map(g => `K${g}`).join(', ')}`}>
                                      Đã dạy {Array.from(currentGrades).sort().map(g => `K${g}`).join(', ')}
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-400 text-[10px] mt-0.5">
                                  Thâm niên: {teacher.experienceYears} năm • SĐT: {teacher.phone || 'Chưa cập nhật'}
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <span className={`font-semibold ${willBeOverloaded ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>
                                  {stats.totalPeriods} / {teacher.maxPeriods} tiết
                                </span>
                                <p className="text-[10px] text-slate-400">
                                  {stats.isHomeroom ? `(${stats.assignedPeriods}t dạy + 4t CN)` : 'Đã nhận'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {otherSpecTeachers.length > 0 && (
                      <>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 flex items-center justify-between">
                          <span>Giáo viên chuyên môn khác (Hạn chế):</span>
                          <span className="text-[10px] font-normal text-slate-400">{otherSpecTeachers.length} GV</span>
                        </div>

                        {otherSpecTeachers.map(teacher => {
                          const stats = getTeacherStats(teacher.id);
                          const isSelected = selectedCell.currentTeacherId === teacher.id;
                          const extraPeriods = isSelected ? 0 : (cellPeriod > 0 ? cellPeriod : 2);
                          const predictedTotal = stats.totalPeriods + extraPeriods;
                          const willBeOverloaded = predictedTotal > teacher.maxPeriods;
                          const currentGrades = stats.assignedGrades;
                          const predictedGrades = new Set(currentGrades);
                          if (targetClass && extraPeriods > 0) {
                            predictedGrades.add(targetClass.grade);
                          }
                          const willExceedGrades = predictedGrades.size >= 3;
                          const isAddingThirdGrade = !currentGrades.has(targetClass?.grade as any) && currentGrades.size >= 2;
                          const hasViolation = willBeOverloaded || willExceedGrades;

                          return (
                            <button
                              key={teacher.id}
                              onClick={() => handleAttemptAssignSubject(teacher)}
                              className={`w-full text-left p-2.5 rounded-lg border transition-all text-xs flex justify-between items-center cursor-pointer ${
                                isSelected 
                                  ? 'border-amber-600 bg-amber-50/30' 
                                  : hasViolation 
                                  ? 'border-rose-200 bg-rose-50/30 hover:bg-rose-100/60' 
                                  : 'border-slate-100 opacity-60 hover:opacity-100 hover:bg-slate-50'
                              }`}
                            >
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`font-medium ${hasViolation ? 'text-rose-950 font-bold' : 'text-slate-800'}`}>{teacher.name}</span>
                                  <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-normal">
                                    Môn: {teacher.specialization}
                                  </span>
                                  {willBeOverloaded && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-rose-100 text-rose-700 rounded border border-rose-200">
                                      {stats.totalPeriods > teacher.maxPeriods ? 'Quá tải' : 'Sắp quá tải'}
                                    </span>
                                  )}
                                  {(willExceedGrades || isAddingThirdGrade) && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded border border-amber-200">
                                      Đã dạy {Array.from(currentGrades).sort().map(g => `K${g}`).join(', ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <span className={`font-mono text-[11px] ${willBeOverloaded ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>{stats.totalPeriods}t</span>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 2: HOMEROOM TEACHER ASSIGNMENT */}
      {selectedHomeroomCell && (() => {
        const targetClass = classes.find(c => c.id === selectedHomeroomCell.classId);
        const query = modalTeacherSearch.trim().toLowerCase();
        const matchesSearch = (t: Teacher) => {
          if (!query) return true;
          return (
            t.name.toLowerCase().includes(query) ||
            t.specialization.toLowerCase().includes(query) ||
            (t.position && t.position.toLowerCase().includes(query)) ||
            (t.phone && t.phone.toLowerCase().includes(query))
          );
        };

        // LOẠI TRỪ 100% CÁN BỘ QUẢN LÝ / BAN GIÁM HIỆU (Hiệu trưởng, Phó Hiệu trưởng) KHỎI DANH SÁCH CHỦ NHIỆM
        const nonBghTeachers = teachers.filter(t => !isBanGiamHieu(t));
        const capableTeachers = nonBghTeachers.filter(t => t.isHomeroomCapable && matchesSearch(t));
        const otherTeachers = nonBghTeachers.filter(t => !t.isHomeroomCapable && matchesSearch(t));
        const totalFilteredCount = capableTeachers.length + otherTeachers.length;

        const handleAttemptAssignHomeroom = (teacher: Teacher) => {
          if (!targetClass) return;
          if (isBanGiamHieu(teacher)) {
            alert(`⚠️ Thầy/Cô ${teacher.name} là cán bộ Ban Giám hiệu (${teacher.position || 'Hiệu trưởng / Phó Hiệu trưởng'}), không phân công làm công tác chủ nhiệm!`);
            return;
          }
          const isSelected = selectedHomeroomCell.currentTeacherId === teacher.id;
          const stats = getTeacherStats(teacher.id);
          const extraPeriods = isSelected ? 0 : 4;
          const predictedTotal = stats.totalPeriods + extraPeriods;
          const willBeOverloaded = predictedTotal > teacher.maxPeriods;
          const predictedExcess = willBeOverloaded ? predictedTotal - teacher.maxPeriods : 0;

          // Helper thực hiện gán chủ nhiệm
          const finalizeHomeroomOnly = () => {
            if (willBeOverloaded) {
              setPendingAssignmentConfirm({
                title: 'Cảnh báo định mức số tiết',
                teacherId: teacher.id,
                teacherName: teacher.name,
                reasonsText: `vượt định mức ${predictedExcess} tiết khi kiêm nhiệm GVCN (${predictedTotal}/${teacher.maxPeriods} tiết)`,
                confirmButtonText: 'Vẫn gán GVCN',
                cancelButtonText: 'Hủy bỏ',
                onConfirm: () => {
                  handleSelectHomeroomTeacher(teacher.id);
                }
              });
              return;
            }
            handleSelectHomeroomTeacher(teacher.id);
          };

          // 1. RÀNG BUỘC SƯ PHẠM VỀ GVCN (GVCN BẮT BUỘC DẠY LỚP CHỦ NHIỆM)
          const teacherSpec = resolveTeacherSubject(teacher, SUBJECTS);
          const specPeriod = getSubjectPeriod(teacherSpec, targetClass.grade, targetClass.id);
          const currentAssignedSubjectTeacherId = getAssignedTeacherId(targetClass.id, teacherSpec);
          const currentSubjectTeacher = teachers.find(t => t.id === currentAssignedSubjectTeacherId);

          // RÀNG BUỘC SƯ PHẠM VỀ GVCN (UI VALIDATION THỦ CÔNG):
          // 1. Nếu GV được chọn có môn chuyên môn KHÔNG NẰM TRONG danh sách môn học của Lớp:
          // Hiển thị cảnh báo và không cho lưu ("Lớp không học môn của Thầy/Cô này").
          if (specPeriod <= 0) {
            setPendingAssignmentConfirm({
              title: '⚠️ CẢNH BÁO: LỚP KHÔNG HỌC MÔN CỦA GV',
              message: `Lớp ${targetClass.name} không học môn ${teacherSpec} của Thầy/Cô ${teacher.name} (0 tiết). Vui lòng chọn giáo viên có môn chuyên môn nằm trong danh sách môn học của lớp này!`,
              confirmButtonText: 'Đã hiểu',
              cancelButtonText: 'Đóng',
              onConfirm: () => {
                setPendingAssignmentConfirm(null);
              }
            });
            return;
          }

          // 2. Nếu hợp lệ: Tự động gán GV đó dạy môn của mình tại lớp trong Bảng phân công
          if (currentAssignedSubjectTeacherId === teacher.id) {
            // GV đã dạy đúng môn chuyên môn tại lớp này
            finalizeHomeroomOnly();
            return;
          }

          if (!currentAssignedSubjectTeacherId) {
            // Môn chưa ai dạy: Tự động gán môn chuyên môn cho GVCN ngay
            handleSelectHomeroomAndSubject(targetClass.id, teacher.id, teacherSpec);
            showTermNotification(`🎯 Đã phân công Thầy/Cô ${teacher.name} làm GVCN lớp ${targetClass.name} và tự động gán môn ${teacherSpec} (${specPeriod}t) trong Bảng phân công!`);
            return;
          }

          // Môn đang do GV khác dạy: Hiện xác nhận để tự động chuyển môn sang cho GVCN
          setPendingAssignmentConfirm({
            title: 'Tự động gán môn chuyên môn cho GVCN',
            message: `Thầy/Cô ${teacher.name} được chọn làm GVCN mới của lớp ${targetClass.name}. Hệ thống sẽ tự động gán môn ${teacherSpec} của lớp (hiện do Thầy/Cô ${currentSubjectTeacher?.name || 'giáo viên khác'} dạy) cho GVCN ${teacher.name}. Bạn có xác nhận không?`,
            confirmButtonText: 'Xác nhận gán GVCN & Chuyển môn',
            cancelButtonText: 'Hủy bỏ',
            onConfirm: () => {
              handleSelectHomeroomAndSubject(targetClass.id, teacher.id, teacherSpec);
              showTermNotification(`🎯 Đã phân công Thầy/Cô ${teacher.name} làm GVCN và tự động gán môn ${teacherSpec} lớp ${targetClass.name}!`);
            }
          });
        };

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Phân công Giáo viên Chủ nhiệm
                  </h3>
                  <p className="text-xs text-slate-500">
                    Lớp {targetClass?.name}
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedHomeroomCell(null)} 
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition cursor-pointer"
                  title="Đóng cửa sổ (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Ô tìm kiếm giáo viên chủ nhiệm */}
              <div className="p-3 bg-white border-b border-slate-100 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={modalTeacherSearch}
                    onChange={e => setModalTeacherSearch(e.target.value)}
                    placeholder="Tìm kiếm giáo viên chủ nhiệm (tên, môn, SĐT)..."
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                    autoFocus
                  />
                  {modalTeacherSearch && (
                    <button
                      onClick={() => setModalTeacherSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200 transition cursor-pointer"
                      title="Xóa tìm kiếm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                <button
                  onClick={() => handleSelectHomeroomTeacher('')}
                  className="w-full text-left p-2.5 rounded-lg border border-dashed border-slate-200 text-rose-600 hover:bg-rose-50/50 font-medium text-xs transition cursor-pointer"
                >
                  ❌ Bỏ chủ nhiệm lớp này (Để trống)
                </button>

                {totalFilteredCount === 0 && query ? (
                  <div className="py-8 text-center text-slate-400">
                    <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">Không tìm thấy giáo viên nào</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Không có giáo viên khớp với từ khóa "{modalTeacherSearch}"</p>
                    <button
                      onClick={() => setModalTeacherSearch('')}
                      className="mt-3 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Xóa từ khóa tìm kiếm
                    </button>
                  </div>
                ) : (
                  <>
                    {capableTeachers.length > 0 && (
                      <>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 flex items-center justify-between">
                          <span>Giáo viên đủ năng lực chủ nhiệm:</span>
                          <span className="text-[10px] font-normal text-slate-400">{capableTeachers.length} GV</span>
                        </div>

                        {capableTeachers.map(teacher => {
                          const stats = getTeacherStats(teacher.id);
                          const isSelected = selectedHomeroomCell.currentTeacherId === teacher.id;
                          const extraPeriods = isSelected ? 0 : 4;
                          const predictedTotal = stats.totalPeriods + extraPeriods;
                          const willBeOverloaded = predictedTotal > teacher.maxPeriods;

                          return (
                            <button
                              key={teacher.id}
                              onClick={() => handleAttemptAssignHomeroom(teacher)}
                              className={`w-full text-left p-3 rounded-lg border transition-all text-xs flex justify-between items-center cursor-pointer ${
                                isSelected 
                                  ? 'border-blue-600 bg-blue-50/50 font-semibold text-blue-900' 
                                  : willBeOverloaded
                                  ? 'border-rose-200 bg-rose-50/30 hover:bg-rose-100/60'
                                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <div>
                                <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                  <span className={willBeOverloaded ? 'text-rose-950 font-bold' : ''}>{teacher.name}</span>
                                  {teacher.position && teacher.position !== 'Giáo viên' && (
                                    <span className="text-[10px] font-normal px-1.5 py-0.2 bg-blue-50 text-blue-700 rounded border border-blue-200">
                                      {teacher.position}
                                    </span>
                                  )}
                                  {willBeOverloaded && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-rose-100 text-rose-700 rounded border border-rose-200">
                                      {stats.totalPeriods > teacher.maxPeriods ? 'Quá tải' : 'Sắp quá tải'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-400 text-[10px] mt-0.5">
                                  Môn: {teacher.specialization} • Thâm niên: {teacher.experienceYears} năm • SĐT: {teacher.phone || 'Chưa cập nhật'}
                                </div>
                              </div>
                              <div className="text-right">
                                {stats.isHomeroom ? (
                                  <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-medium block">
                                    Đang CN {stats.homeroomClass}
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-medium block">
                                    Sẵn sàng
                                  </span>
                                )}
                                <span className={`text-[10px] font-medium ${willBeOverloaded ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                                  {stats.totalPeriods}t / {teacher.maxPeriods}t
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {otherTeachers.length > 0 && (
                      <>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 flex items-center justify-between">
                          <span>Giáo viên khác (Chưa cấu hình chủ nhiệm):</span>
                          <span className="text-[10px] font-normal text-slate-400">{otherTeachers.length} GV</span>
                        </div>

                        {otherTeachers.map(teacher => {
                          const stats = getTeacherStats(teacher.id);
                          const isSelected = selectedHomeroomCell.currentTeacherId === teacher.id;

                          return (
                            <button
                              key={teacher.id}
                              onClick={() => handleAttemptAssignHomeroom(teacher)}
                              className={`w-full text-left p-2.5 rounded-lg border border-slate-100 transition-all text-xs flex justify-between items-center cursor-pointer ${isSelected ? 'border-blue-600' : 'opacity-60 hover:opacity-100 hover:bg-slate-50'}`}
                            >
                              <div>
                                <span className="font-medium text-slate-800">{teacher.name}</span>
                                <span className="text-[10px] text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded ml-1.5 font-normal">
                                  Thiếu tiêu chuẩn
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-slate-400 text-[10px]">Môn {teacher.specialization}</span>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* POP-UP XÁC NHẬN NHANH KHI PHÂN CÔNG VI PHẠM RÀNG BUỘC (ẢNH IMAGE_D2DC4C) */}
      {pendingAssignmentConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[75] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-rose-200 max-w-md w-full p-5 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5 mb-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm sm:text-base font-bold text-slate-900">
                  {pendingAssignmentConfirm.title || 'Cảnh báo ràng buộc phân công'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Phát hiện vi phạm quy tắc phân công chuyên môn & sư phạm
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (pendingAssignmentConfirm.onCancel) pendingAssignmentConfirm.onCancel();
                  setPendingAssignmentConfirm(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Đóng (Hủy bỏ)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl mb-4 text-xs text-rose-950 leading-relaxed font-medium">
              {pendingAssignmentConfirm.message || (
                <>
                  Thầy/Cô <strong>{pendingAssignmentConfirm.teacherName}</strong> sẽ <strong>{pendingAssignmentConfirm.reasonsText}</strong>. Thầy/Cô có chắc chắn muốn phân công không?
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (pendingAssignmentConfirm.onCancel) pendingAssignmentConfirm.onCancel();
                  setPendingAssignmentConfirm(null);
                }}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg font-semibold text-xs transition cursor-pointer"
              >
                {pendingAssignmentConfirm.cancelButtonText || 'Hủy bỏ'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingAssignmentConfirm.onConfirm;
                  setPendingAssignmentConfirm(null);
                  action();
                }}
                className="px-4.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs shadow-sm shadow-rose-600/30 flex items-center gap-1.5 transition cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{pendingAssignmentConfirm.confirmButtonText || 'Vẫn phân công'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD TEACHER MODAL */}
      {isAddingTeacher && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-[700px] w-[95%] max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header (Cố định) */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Thêm Giáo viên mới</h3>
                  <p className="text-[11px] text-slate-500">Khai báo hồ sơ giáo viên, chuyên môn & định mức giảng dạy</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsAddingTeacher(false)} 
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Đóng modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Form & Body */}
            <form onSubmit={handleAddTeacher} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 space-y-3.5 text-xs md:text-sm overflow-y-auto overflow-x-hidden flex-1">
                {/* Hàng 1: Họ và Tên giáo viên */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 text-xs">
                    Họ và Tên giáo viên <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Cô Nguyễn Thị Lan"
                    value={newTeacher.name}
                    onChange={e => setNewTeacher(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium"
                  />
                </div>

                {/* Hàng 2 (2 cột bằng nhau): [Môn chuyên môn *] | [Chức vụ *] */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Môn chuyên môn <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={newTeacher.specialization}
                      onChange={e => {
                        const val = e.target.value;
                        setNewTeacher(prev => ({ 
                          ...prev, 
                          specialization: val,
                          subject: val,
                          monGiangDay: val,
                          subjectId: val,
                          monDay: val
                        }));
                      }}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                    >
                      {SUBJECTS.map(s => (
                        <option key={s.id} value={s.id}>{s.name || s.id}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Chức vụ <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={newTeacher.position || 'Giáo viên'}
                      onChange={e => {
                        const pos = e.target.value;
                        const suggested = getStandardQuotaForPosition(pos);
                        const isLeader = pos === 'Hiệu trưởng' || pos === 'Phó Hiệu trưởng';
                        setNewTeacher(prev => ({
                          ...prev,
                          position: pos,
                          maxPeriods: suggested,
                          ...(isLeader ? { isHomeroomCapable: false } : {})
                        }));
                      }}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                    >
                      {POSITIONS.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Hàng 3 (2 cột): [Định mức tiết tối đa *] | [Đủ điều kiện chủ nhiệm] */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-slate-700 font-semibold text-xs">
                        Định mức tiết tối đa <span className="text-rose-500">*</span>
                      </label>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      step="0.5"
                      required
                      value={newTeacher.maxPeriods}
                      onChange={e => setNewTeacher(prev => ({ ...prev, maxPeriods: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-bold text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="block text-[11px] text-slate-400 mt-1">
                      Gợi ý: HT 2t, PHT 4t, TT 14t, TP 16t, BT Đoàn 2.5t, PBT 8.5t, GV 17t
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Đủ điều kiện chủ nhiệm
                    </label>
                    <div className="flex items-center gap-3 bg-slate-50/70 p-2 rounded-lg border border-slate-300 h-[38px] sm:h-[40px]">
                      <label className="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="newIsHomeroomCapable"
                          checked={newTeacher.isHomeroomCapable === true}
                          onChange={() => setNewTeacher(prev => ({ ...prev, isHomeroomCapable: true }))}
                          className="text-blue-600 focus:ring-blue-500 cursor-pointer"
                        /> 
                        <span>Đạt tiêu chuẩn</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-medium text-slate-500 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="newIsHomeroomCapable"
                          checked={newTeacher.isHomeroomCapable === false}
                          onChange={() => setNewTeacher(prev => ({ ...prev, isHomeroomCapable: false }))}
                          className="text-slate-400 focus:ring-slate-400 cursor-pointer"
                        /> 
                        <span>Chưa đạt</span>
                      </label>
                    </div>
                    <span className="block text-[11px] text-slate-400 mt-1">
                      {newTeacher.isHomeroomCapable ? '✓ Đủ điều kiện phân công GVCN' : '✕ Chỉ phân công chuyên môn'}
                    </span>
                  </div>
                </div>

                {/* CỤM THÔNG TIN CÁ NHÂN & NGHỈ HƯU (Khối nổi bật) */}
                <div className="bg-slate-50/90 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-start">
                    {/* 1. Ngày sinh (col-span-3) */}
                    <div className="col-span-2 sm:col-span-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngày sinh
                      </label>
                      <input
                        type="text"
                        placeholder="DD/MM/YYYY"
                        value={newTeacher.dateOfBirth || (newTeacher.namSinh ? `01/01/${newTeacher.namSinh}` : '')}
                        onChange={e => {
                          const val = e.target.value;
                          const parsed = parseDateOfBirth(val, newTeacher.namSinh);
                          setNewTeacher(prev => ({ 
                            ...prev, 
                            dateOfBirth: val,
                            dob: val,
                            namSinh: parsed.year 
                          }));
                        }}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono shadow-2xs"
                      />
                    </div>

                    {/* 2. Giới tính (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Giới tính
                      </label>
                      <select
                        value={newTeacher.gender || normalizeTeacherGender(undefined, newTeacher.name)}
                        onChange={e => setNewTeacher(prev => ({ ...prev, gender: e.target.value as 'Nam' | 'Nữ' }))}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium shadow-2xs"
                      >
                        <option value="Nữ">Nữ</option>
                        <option value="Nam">Nam</option>
                      </select>
                    </div>

                    {/* 3. Năm vào ngành (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Năm vào ngành
                      </label>
                      <input
                        type="number"
                        min={1970}
                        max={2030}
                        placeholder="2008"
                        value={newTeacher.namVaoNganh || ''}
                        onChange={e => {
                          const val = parseInt(e.target.value) || undefined;
                          const curYear = 2026;
                          const exp = val ? Math.max(0, curYear - val) : newTeacher.experienceYears;
                          setNewTeacher(prev => ({ ...prev, namVaoNganh: val, experienceYears: exp }));
                        }}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
                      />
                    </div>

                    {/* 4. Trình độ (col-span-3) */}
                    <div className="col-span-1 sm:col-span-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Trình độ
                      </label>
                      <select
                        value={newTeacher.trinhDo || 'Đại học'}
                        onChange={e => setNewTeacher(prev => ({ ...prev, trinhDo: e.target.value }))}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium shadow-2xs"
                      >
                        {TRINH_DO_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    {/* 5. Thâm niên (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Thâm niên
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={newTeacher.namVaoNganh ? `${Math.max(0, 2026 - newTeacher.namVaoNganh)} năm` : `${newTeacher.experienceYears || 0} năm`}
                        title="Thâm niên được tự động tính từ Năm vào ngành"
                        className="w-full bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 text-xs sm:text-sm font-bold text-center cursor-not-allowed select-none shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* Card thông tin nghỉ hưu theo Nghị định 135/2020/NĐ-CP (Tự động tính thời gian thực) */}
                  {(() => {
                    const retInfo = calculateRetirementDate(
                      newTeacher.dateOfBirth || newTeacher.dob, 
                      newTeacher.gender || normalizeTeacherGender(undefined, newTeacher.name), 
                      newTeacher.namSinh
                    );
                    return (
                      <div className="p-2.5 px-3.5 rounded-xl bg-amber-50/90 border border-amber-200/90 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                              <span>Nghị định 135/2020: Mốc {retInfo.retirementAgeLabel} ({retInfo.gender})</span>
                              <span className="text-slate-500 font-normal">• Ngày sinh: {retInfo.birthDateFormatted}</span>
                            </div>
                            <div className="text-[11px] text-amber-800 mt-0.5 truncate">
                              Thời điểm dự kiến hưu: <strong>{retInfo.retirementMonthYearLabel}</strong> (Hưởng lương hưu từ ngày {retInfo.retirementDateFormatted})
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-md font-bold text-[11px] shrink-0 self-start sm:self-auto border ${
                          retInfo.isRetired 
                            ? 'bg-rose-100 text-rose-800 border-rose-300' 
                            : retInfo.isRetiringSoon 
                            ? 'bg-amber-100 text-amber-800 border-amber-300' 
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}>
                          {retInfo.remainingTimeLabel}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Hàng liên hệ (2 cột bằng nhau) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">Số điện thoại liên hệ</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: 0912 345 678"
                      value={newTeacher.phone}
                      onChange={e => setNewTeacher(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">Email công vụ / liên hệ</label>
                    <input
                      type="email"
                      placeholder="tengiaovien@school.edu.vn"
                      value={newTeacher.email || ''}
                      onChange={e => setNewTeacher(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
                    />
                  </div>
                </div>

                {/* Ưu tiên giảng dạy khối */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 text-xs">Ưu tiên phân công giảng dạy khối</label>
                  <div className="flex gap-4 p-2.5 bg-slate-50/70 rounded-lg border border-slate-300">
                    {['10', '11', '12'].map(grade => {
                      const included = newTeacher.preferredGrades.includes(grade);
                      return (
                        <label key={grade} className="flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => {
                              const next = included 
                                ? newTeacher.preferredGrades.filter(g => g !== grade)
                                : [...newTeacher.preferredGrades, grade];
                              setNewTeacher(prev => ({ ...prev, preferredGrades: next }));
                            }}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          /> 
                          <span>Khối {grade}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer hành động (Cố định ở đáy) */}
              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddingTeacher(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-semibold text-slate-700 transition cursor-pointer text-xs"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5 text-xs"
                >
                  <Plus className="w-4 h-4" /> 
                  <span>Thêm giáo viên</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3B: EDIT TEACHER MODAL */}
            {/* Modal Xuất Hồ Sơ Giáo Viên (PDF / Word) */}
      {profileExportTeacher && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden transform animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center backdrop-blur-xs">
                  <FileDown className="w-4 h-4 text-blue-200" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-wide">Xuất hồ sơ giáo viên</h3>
                  <p className="text-[11px] text-blue-200">Tải về tệp tin PDF / Word chuyên nghiệp</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileExportTeacher(null)}
                className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Giáo viên:</span>
                  <span className="font-bold text-slate-900 text-sm">{profileExportTeacher.name}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500">Môn giảng dạy:</span>
                  <span className="font-semibold text-blue-700">{profileExportTeacher.specialization}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500">Chức vụ:</span>
                  <span className="font-medium text-slate-700">{profileExportTeacher.position || 'Giáo viên'}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500">Trình độ chuyên môn:</span>
                  <span className="font-bold text-purple-700">
                    {profileExportTeacher.trinhDo || (profileExportTeacher.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500">Năm sinh & Tuyển dụng:</span>
                  <span className="text-slate-700">
                    Sinh {profileExportTeacher.namSinh || (profileExportTeacher.experienceYears ? 2026 - 22 - profileExportTeacher.experienceYears : '—')} • Tuyển {profileExportTeacher.namVaoNganh || (profileExportTeacher.experienceYears ? 2026 - profileExportTeacher.experienceYears : '—')}
                  </span>
                </div>
              </div>

              <p className="text-slate-500 text-[11px] leading-relaxed">
                Tệp xuất bao gồm đầy đủ Quốc hiệu, Tiêu ngữ, thông tin nhân sự, văn bằng trình độ, chức vụ, lớp chủ nhiệm và bảng chi tiết các lớp được phân công giảng dạy trong học kỳ.
              </p>

              {/* Action Buttons: Word & PDF */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  disabled={isExportingProfile}
                  onClick={() => handleExportTeacherProfile(profileExportTeacher, 'docx')}
                  className="p-3 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100 hover:border-blue-300 text-blue-800 transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-2xs group disabled:opacity-50"
                >
                  <FileText className="w-5 h-5 text-blue-600 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs">Tải tệp Word (.docx)</span>
                  <span className="text-[10px] text-blue-600/80">Soạn thảo, chỉnh sửa</span>
                </button>

                <button
                  type="button"
                  disabled={isExportingProfile}
                  onClick={() => handleExportTeacherProfile(profileExportTeacher, 'pdf')}
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 hover:border-rose-300 text-rose-800 transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-2xs group disabled:opacity-50"
                >
                  <Download className="w-5 h-5 text-rose-600 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs">Tải tệp PDF (.pdf)</span>
                  <span className="text-[10px] text-rose-600/80">In ấn, lưu trữ chuẩn</span>
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setProfileExportTeacher(null)}
                className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 font-semibold transition cursor-pointer text-xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTeacher && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-[700px] w-[95%] max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header (Cố định) */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Chỉnh sửa thông tin giáo viên</h3>
                  <p className="text-[11px] text-slate-500">Mã GV: <span className="font-mono font-semibold text-blue-700">{editingTeacher.id}</span> • Cập nhật hồ sơ & định mức giảng dạy</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setEditingTeacher(null)} 
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                title="Đóng modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Form & Body (Cuộn mượt bên trong, Footer cố định) */}
            <form onSubmit={handleSaveEditTeacher} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 space-y-3.5 text-xs md:text-sm overflow-y-auto overflow-x-hidden flex-1">
                {/* Hàng 1: Họ và Tên giáo viên (chiếm 3/4) + Mã GV (chiếm 1/4) */}
                <div className="grid grid-cols-12 gap-3 items-start">
                  <div className="col-span-8 sm:col-span-9">
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Họ và Tên giáo viên <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ví dụ: Thầy Nguyễn Văn A"
                      value={editingTeacher.name}
                      onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <label className="block text-slate-500 font-semibold mb-1 text-xs">
                      Mã giáo viên
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={editingTeacher.id}
                      className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 font-mono text-center text-xs sm:text-sm cursor-not-allowed select-none font-semibold"
                    />
                  </div>
                </div>

                {/* Hàng 2 (2 cột bằng nhau): [Môn chuyên môn *] | [Chức vụ *] */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Môn chuyên môn <span className="text-rose-500">*</span>
                    </label>
                    {(() => {
                      const currentSubjectVal = resolveTeacherSubject(editingTeacher, SUBJECTS);
                      return (
                        <select
                          value={currentSubjectVal}
                          onChange={e => {
                            const newSub = e.target.value;
                            setEditingTeacher(prev => prev ? ({
                              ...prev,
                              specialization: newSub,
                              subject: newSub,
                              monGiangDay: newSub,
                              subjectId: newSub,
                              monDay: newSub
                            }) : null);
                          }}
                          className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                        >
                          {SUBJECTS.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.id}
                            </option>
                          ))}
                          {currentSubjectVal && !SUBJECTS.some(s => s.id === currentSubjectVal) && (
                            <option value={currentSubjectVal}>
                              {currentSubjectVal}
                            </option>
                          )}
                        </select>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Chức vụ <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={editingTeacher.position || 'Giáo viên'}
                      onChange={e => {
                        const pos = e.target.value;
                        setEditingTeacher(prev => {
                          if (!prev) return null;
                          const maxP = getStandardQuotaForPosition(pos);
                          const isLeader = pos === 'Hiệu trưởng' || pos === 'Phó Hiệu trưởng';
                          return {
                            ...prev,
                            position: pos,
                            maxPeriods: maxP,
                            ...(isLeader ? { isHomeroomCapable: false } : {})
                          };
                        });
                      }}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                    >
                      {POSITIONS.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Hàng 3 (2 cột): [Định mức tiết tối đa *] | [Đủ điều kiện chủ nhiệm] */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-slate-700 font-semibold text-xs">
                        Định mức tiết tối đa <span className="text-rose-500">*</span>
                      </label>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      step="0.5"
                      required
                      value={editingTeacher.maxPeriods}
                      onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, maxPeriods: parseFloat(e.target.value) || 0 }) : null)}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-bold text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="block text-[11px] text-slate-400 mt-1">
                      Gợi ý: HT 2t, PHT 4t, TT 14t, TP 16t, BT Đoàn 2.5t, PBT 8.5t, GV 17t
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">
                      Đủ điều kiện chủ nhiệm
                    </label>
                    <div className="flex items-center gap-3 bg-slate-50/70 p-2 rounded-lg border border-slate-300 h-[38px] sm:h-[40px]">
                      <label className="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="editIsHomeroomCapable"
                          checked={editingTeacher.isHomeroomCapable === true}
                          onChange={() => setEditingTeacher(prev => prev ? ({ ...prev, isHomeroomCapable: true }) : null)}
                          className="text-blue-600 focus:ring-blue-500 cursor-pointer"
                        /> 
                        <span>Đạt tiêu chuẩn</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-medium text-slate-500 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="editIsHomeroomCapable"
                          checked={editingTeacher.isHomeroomCapable === false}
                          onChange={() => setEditingTeacher(prev => prev ? ({ ...prev, isHomeroomCapable: false }) : null)}
                          className="text-slate-400 focus:ring-slate-400 cursor-pointer"
                        /> 
                        <span>Chưa đạt</span>
                      </label>
                    </div>
                    <span className="block text-[11px] text-slate-400 mt-1">
                      {editingTeacher.isHomeroomCapable ? '✓ Đủ điều kiện phân công GVCN' : '✕ Chỉ phân công chuyên môn'}
                    </span>
                  </div>
                </div>

                {/* CỤM THÔNG TIN CÁ NHÂN & NGHỈ HƯU (Khối nổi bật) */}
                <div className="bg-slate-50/90 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-start">
                    {/* 1. Ngày sinh (1.2fr -> col-span-3) */}
                    <div className="col-span-2 sm:col-span-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngày sinh
                      </label>
                      <input
                        type="text"
                        placeholder="DD/MM/YYYY"
                        value={editingTeacher.dateOfBirth || editingTeacher.dob || (editingTeacher.namSinh ? `01/01/${editingTeacher.namSinh}` : '')}
                        onChange={e => {
                          const val = e.target.value;
                          const parsed = parseDateOfBirth(val, editingTeacher.namSinh);
                          setEditingTeacher(prev => prev ? ({ 
                            ...prev, 
                            dateOfBirth: val,
                            dob: val,
                            namSinh: parsed.year 
                          }) : null);
                        }}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono shadow-2xs"
                      />
                    </div>

                    {/* 2. Giới tính (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Giới tính
                      </label>
                      <select
                        value={editingTeacher.gender || normalizeTeacherGender(undefined, editingTeacher.name)}
                        onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, gender: e.target.value as 'Nam' | 'Nữ' }) : null)}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium shadow-2xs"
                      >
                        <option value="Nữ">Nữ</option>
                        <option value="Nam">Nam</option>
                      </select>
                    </div>

                    {/* 3. Năm vào ngành (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Năm vào ngành
                      </label>
                      <input
                        type="number"
                        min={1970}
                        max={2030}
                        placeholder="2008"
                        value={editingTeacher.namVaoNganh || ''}
                        onChange={e => {
                          const val = parseInt(e.target.value) || undefined;
                          const curYear = 2026;
                          setEditingTeacher(prev => {
                            if (!prev) return null;
                            const exp = val ? Math.max(0, curYear - val) : prev.experienceYears;
                            return { ...prev, namVaoNganh: val, experienceYears: exp };
                          });
                        }}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
                      />
                    </div>

                    {/* 4. Trình độ (col-span-3) */}
                    <div className="col-span-1 sm:col-span-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Trình độ
                      </label>
                      <select
                        value={editingTeacher.trinhDo || 'Đại học'}
                        onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, trinhDo: e.target.value }) : null)}
                        className="w-full bg-white text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium shadow-2xs"
                      >
                        {TRINH_DO_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    {/* 5. Thâm niên (col-span-2) */}
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Thâm niên
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={editingTeacher.namVaoNganh ? `${Math.max(0, 2026 - editingTeacher.namVaoNganh)} năm` : `${editingTeacher.experienceYears || 0} năm`}
                        title="Thâm niên được tự động tính từ Năm vào ngành"
                        className="w-full bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 text-xs sm:text-sm font-bold text-center cursor-not-allowed select-none shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* Card thông tin nghỉ hưu theo Nghị định 135/2020/NĐ-CP (Tự động tính thời gian thực) */}
                  {(() => {
                    const retInfo = calculateRetirementDate(
                      editingTeacher.dateOfBirth || editingTeacher.dob, 
                      editingTeacher.gender || normalizeTeacherGender(undefined, editingTeacher.name), 
                      editingTeacher.namSinh
                    );
                    return (
                      <div className="p-2.5 px-3.5 rounded-xl bg-amber-50/90 border border-amber-200/90 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                              <span>Nghị định 135/2020: Mốc {retInfo.retirementAgeLabel} ({retInfo.gender})</span>
                              <span className="text-slate-500 font-normal">• Ngày sinh: {retInfo.birthDateFormatted}</span>
                            </div>
                            <div className="text-[11px] text-amber-800 mt-0.5 truncate">
                              Thời điểm dự kiến hưu: <strong>{retInfo.retirementMonthYearLabel}</strong> (Hưởng lương hưu từ ngày {retInfo.retirementDateFormatted})
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-md font-bold text-[11px] shrink-0 self-start sm:self-auto border ${
                          retInfo.isRetired 
                            ? 'bg-rose-100 text-rose-800 border-rose-300' 
                            : retInfo.isRetiringSoon 
                            ? 'bg-amber-100 text-amber-800 border-amber-300' 
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}>
                          {retInfo.remainingTimeLabel}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Hàng liên hệ (2 cột bằng nhau) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">Số điện thoại liên hệ</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: 0912 345 678"
                      value={editingTeacher.phone || ''}
                      onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, phone: e.target.value }) : null)}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1 text-xs">Email công vụ / liên hệ</label>
                    <input
                      type="email"
                      placeholder="tengiaovien@school.edu.vn"
                      value={editingTeacher.email || ''}
                      onChange={e => setEditingTeacher(prev => prev ? ({ ...prev, email: e.target.value }) : null)}
                      className="w-full bg-slate-50/70 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
                    />
                  </div>
                </div>

                {/* Ưu tiên giảng dạy khối */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1 text-xs">Ưu tiên phân công giảng dạy khối</label>
                  <div className="flex gap-4 p-2.5 bg-slate-50/70 rounded-lg border border-slate-300">
                    {['10', '11', '12'].map(grade => {
                      const included = editingTeacher.preferredGrades?.includes(grade) ?? false;
                      return (
                        <label key={grade} className="flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => {
                              const current = editingTeacher.preferredGrades || [];
                              const next = included 
                                ? current.filter(g => g !== grade)
                                : [...current, grade];
                              setEditingTeacher(prev => prev ? ({ ...prev, preferredGrades: next }) : null);
                            }}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          /> 
                          <span>Khối {grade}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer hành động (Cố định ở đáy) */}
              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingTeacher(null)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-semibold text-slate-700 transition cursor-pointer text-xs"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5 text-xs"
                >
                  <Check className="w-4 h-4" /> 
                  <span>Lưu thay đổi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD CLASS MODAL */}
      {isAddingClass && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-sm">Thêm Lớp học mới</h3>
              <button onClick={() => setIsAddingClass(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddClass} className="p-4 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Tên Lớp học</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: 10A3 hoặc 12D2"
                  value={newClass.name}
                  onChange={e => setNewClass(prev => ({ ...prev, name: e.target.value.toUpperCase() }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Khối lớp</label>
                <select
                  value={newClass.grade}
                  onChange={e => setNewClass(prev => ({ ...prev, grade: e.target.value as any }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
                >
                  <option value="10">Khối 10</option>
                  <option value="11">Khối 11</option>
                  <option value="12">Khối 12</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddingClass(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition cursor-pointer"
                >
                  Thêm Lớp học
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4B: EDIT CLASS MODAL */}
      {editingClass && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Chỉnh sửa Lớp học</h3>
                  <p className="text-[11px] text-slate-500">Mã lớp: {editingClass.id}</p>
                </div>
              </div>
              <button onClick={() => setEditingClass(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveEditClass} className="p-4 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Tên Lớp học <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: 10A1 hoặc 12D2"
                  value={editingClass.name}
                  onChange={e => setEditingClass(prev => prev ? ({ ...prev, name: e.target.value.toUpperCase() }) : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Khối lớp <span className="text-rose-500">*</span></label>
                <select
                  value={editingClass.grade}
                  onChange={e => setEditingClass(prev => prev ? ({ ...prev, grade: e.target.value as any }) : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none font-medium"
                >
                  <option value="10">Khối 10</option>
                  <option value="11">Khối 11</option>
                  <option value="12">Khối 12</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Ca / Buổi học chính</label>
                <select
                  value={classShifts[editingClass.id] || (editingClass.grade === '10' ? 'afternoon_main' : 'morning_main')}
                  onChange={e => {
                    const val = e.target.value;
                    setClassShifts(prev => ({ ...prev, [editingClass.id]: val }));
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none font-medium"
                >
                  <option value="morning_main">Chính khóa Sáng - Trái buổi Chiều 🌅</option>
                  <option value="afternoon_main">Chính khóa Chiều - Trái buổi Sáng 🌇</option>
                  <option value="morning">Chỉ học Buổi Sáng (Chính Sáng) ☀️</option>
                  <option value="afternoon">Chỉ học Buổi Chiều (Chính Chiều) 🌙</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingClass(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: ADD NEW SUBJECT */}
      {isAddingSubject && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                  <BookOpen className="w-5 h-5 text-blue-600" /> Thêm Môn học mới
                </h3>
                <p className="text-xs text-slate-500">Cấu hình tên môn và số tiết chính khóa mặc định cho từng khối</p>
              </div>
              <button 
                onClick={() => setIsAddingSubject(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubject} className="p-4 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Mã / Tên viết tắt môn học <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Pháp, Âm nhạc, Mỹ thuật, GDCD..."
                  value={newSubject.id}
                  onChange={e => setNewSubject(prev => ({ 
                    ...prev, 
                    id: e.target.value,
                    name: prev.name === prev.id ? e.target.value : prev.name 
                  }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Tên viết tắt sẽ hiển thị trên các tiêu đề cột của Bảng phân công
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Tên đầy đủ của môn học
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Tiếng Pháp, Nghệ thuật Âm nhạc... (Tùy chọn)"
                  value={newSubject.name}
                  onChange={e => setNewSubject(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Tổ bộ môn phụ trách <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={newSubject.departmentId || (departments[0]?.id || '')}
                  onChange={e => {
                    const selectedId = e.target.value;
                    const deptObj = departments.find(d => d.id === selectedId);
                    setNewSubject(prev => ({
                      ...prev,
                      departmentId: selectedId,
                      department: deptObj ? deptObj.name : ''
                    }));
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium cursor-pointer"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1.5">
                  Số tiết mặc định / tuần theo từng Khối
                </label>
                <div className="grid grid-cols-3 gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 10</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={newSubject.grade10Periods}
                      onChange={e => setNewSubject(prev => ({ ...prev, grade10Periods: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 11</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={newSubject.grade11Periods}
                      onChange={e => setNewSubject(prev => ({ ...prev, grade11Periods: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 12</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={newSubject.grade12Periods}
                      onChange={e => setNewSubject(prev => ({ ...prev, grade12Periods: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Sau khi thêm, bạn vẫn có thể điều chỉnh độc lập số tiết cho từng lớp cụ thể.
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddingSubject(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Thêm Môn học
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SUBJECT */}
      {editingSubject && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                  <Pencil className="w-5 h-5 text-blue-600" /> Chỉnh sửa Môn học
                </h3>
                <p className="text-xs text-slate-500">
                  Cập nhật thông tin mã, tên môn và định mức số tiết các khối
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setEditingSubject(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditSubject} className="p-4 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Mã / Tên viết tắt môn học <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Toán, Văn, Anh..."
                  value={editingSubject.id}
                  onChange={e => setEditingSubject(prev => prev ? ({ ...prev, id: e.target.value }) : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Lưu ý: Nếu đổi mã môn, hệ thống sẽ tự động cập nhật phân công và cấu hình số tiết tương ứng.
                </span>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Tên đầy đủ của môn học
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Toán học, Ngữ văn..."
                  value={editingSubject.name}
                  onChange={e => setEditingSubject(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Tổ bộ môn phụ trách <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={editingSubject.departmentId || ''}
                  onChange={e => {
                    const selectedId = e.target.value;
                    const deptObj = departments.find(d => d.id === selectedId);
                    setEditingSubject(prev => prev ? ({
                      ...prev,
                      departmentId: selectedId,
                      department: deptObj ? deptObj.name : prev.department
                    }) : null);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium cursor-pointer"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1.5">
                  Số tiết mặc định / tuần theo từng Khối
                </label>
                <div className="grid grid-cols-3 gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 10</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={editingSubject.grade10Periods}
                      onChange={e => setEditingSubject(prev => prev ? ({ ...prev, grade10Periods: parseInt(e.target.value) || 0 }) : null)}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 11</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={editingSubject.grade11Periods}
                      onChange={e => setEditingSubject(prev => prev ? ({ ...prev, grade11Periods: parseInt(e.target.value) || 0 }) : null)}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-slate-500 mb-1 text-center">Khối 12</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      required
                      value={editingSubject.grade12Periods}
                      onChange={e => setEditingSubject(prev => prev ? ({ ...prev, grade12Periods: parseInt(e.target.value) || 0 }) : null)}
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 text-center text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSubject(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <Save className="w-4 h-4" /> Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANAGE DEPARTMENTS (QUẢN LÝ TỔ CHUYÊN MÔN) */}
      {isManageDepartmentsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <span>Quản lý Danh mục Tổ Chuyên môn</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-mono font-bold">
                    {departments.length} tổ
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Thêm, chỉnh sửa tên hoặc xóa tổ chuyên môn (đồng bộ trực tiếp lên Cloud Firestore và cập nhật tên cho các môn học / GV)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManageDepartmentsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Thêm Tổ chuyên môn mới */}
            {isAdmin && (
              <form onSubmit={handleAddDepartment} className="p-3 bg-indigo-50/60 border-b border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    required
                    placeholder="Nhập tên Tổ chuyên môn mới (Ví dụ: Tổ Tin học - Công nghệ...)"
                    value={newDepartmentName}
                    onChange={e => setNewDepartmentName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400 transition"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-2xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Thêm Tổ mới</span>
                </button>
              </form>
            )}

            {/* Bảng Danh sách Tổ chuyên môn */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100/90 text-slate-800 font-bold sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-12 border-r border-slate-200">STT</th>
                      <th className="py-2.5 px-3 min-w-[200px] border-r border-slate-200">Tên Tổ chuyên môn</th>
                      <th className="py-2.5 px-3 text-center w-40 border-r border-slate-200">Số lượng môn trực thuộc</th>
                      <th className="py-2.5 px-3 text-center w-32">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {departments.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400 font-medium">
                          Chưa có tổ chuyên môn nào. Vui lòng thêm tổ mới phía trên.
                        </td>
                      </tr>
                    ) : (
                      departments.map((dept, idx) => {
                        const isEditingThis = editingDepartmentId === dept.id;
                        const subjectCount = subjectsConfig.filter(s => 
                          s.departmentId === dept.id || s.department === dept.name || (!s.department && getDefaultDepartment(s.id, s.name) === dept.name)
                        ).length;
                        const teacherCount = teachers.filter(t => 
                          t.specialization === dept.name || (t.specialization && t.specialization.includes(dept.name))
                        ).length;

                        return (
                          <tr key={dept.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 text-center font-mono text-slate-400 font-semibold border-r border-slate-100">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 border-r border-slate-100">
                              {isEditingThis ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editingDepartmentName}
                                    onChange={e => setEditingDepartmentName(e.target.value)}
                                    className="flex-1 px-2.5 py-1 text-xs border border-indigo-400 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveEditDepartment(dept.id);
                                      } else if (e.key === 'Escape') {
                                        setEditingDepartmentId(null);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditDepartment(dept.id)}
                                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-[11px] cursor-pointer shadow-2xs"
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingDepartmentId(null)}
                                    className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-semibold text-[11px] cursor-pointer"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-800 text-xs">
                                    {dept.name}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center border-r border-slate-100 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 text-xs">
                                <span>{subjectCount} môn</span>
                              </span>
                              {teacherCount > 0 && (
                                <span className="text-[11px] text-slate-400 block mt-0.5 font-medium">
                                  ({teacherCount} giáo viên)
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!isAdmin) {
                                      showTermNotification('⚠️ Cần quyền Quản trị viên để sửa tổ!');
                                      openLoginModal();
                                      return;
                                    }
                                    setEditingDepartmentId(dept.id);
                                    setEditingDepartmentName(dept.name);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition cursor-pointer shadow-2xs"
                                  title={`Sửa tên tổ ${dept.name}`}
                                >
                                  <Pencil className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDepartment(dept)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition cursor-pointer shadow-2xs"
                                  title={`Xóa tổ ${dept.name}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                  <span>Xóa</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                * Chỉnh sửa tên tổ sẽ tự động đồng bộ tên mới cho môn học và giáo viên thuộc tổ đó trên Firestore.
              </span>
              <button
                type="button"
                onClick={() => setIsManageDepartmentsModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MANAGE SUBJECTS LIST (SỬA & XÓA MÔN HỌC) */}
      {isManageSubjectsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-sky-600" />
                  <span>Quản lý Danh sách Môn học</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono font-semibold">
                    {subjectsConfig.length} môn
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chỉnh sửa mã, tên và định mức tiết hoặc xóa môn học khỏi hệ thống
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManageSubjectsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Actions Bar */}
            <div className="p-3 bg-white border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm môn học theo tên hoặc mã..."
                  value={subjectManageSearch}
                  onChange={e => setSubjectManageSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500 focus:bg-white transition"
                />
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingSubject(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Thêm môn mới vào danh mục trường</span>
                </button>
              )}
            </div>

            {/* Subjects Table */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100/80 text-slate-700 font-semibold sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-2 text-center w-10">STT</th>
                      <th className="py-2 px-2.5 w-24">Mã môn</th>
                      <th className="py-2 px-3">Tên môn học</th>
                      <th className="py-2 px-2 text-center w-28">Định mức (K10/11/12)</th>
                      <th className="py-2 px-2 text-center w-28">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subjectsConfig
                      .filter(s => {
                        if (!subjectManageSearch.trim()) return true;
                        const q = subjectManageSearch.toLowerCase();
                        return (s.id && s.id.toLowerCase().includes(q)) ||
                               (s.name && s.name.toLowerCase().includes(q));
                      })
                      .map((sub, idx) => (
                        <tr key={sub.id} className="hover:bg-slate-50/80 transition">
                          <td className="py-2 px-2 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2.5 font-bold text-slate-800">
                            <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-mono">
                              {sub.id}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            {sub.name || sub.id}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600 text-[11px]">
                            <span className="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-slate-700 font-bold">
                              {sub.grade10Periods}t / {sub.grade11Periods}t / {sub.grade12Periods}t
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEditSubject(sub.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition cursor-pointer shadow-2xs"
                                title={`Chỉnh sửa môn ${sub.name || sub.id}`}
                              >
                                <Pencil className="w-3 h-3 text-blue-600" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSubject(sub.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition cursor-pointer shadow-2xs"
                                title={`Xóa môn ${sub.name || sub.id}`}
                              >
                                <Trash2 className="w-3 h-3 text-rose-600" />
                                <span>Xóa</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs">
              <span className="text-slate-500">
                Tổng cộng: <strong className="text-slate-800">{subjectsConfig.length}</strong> môn học
              </span>
              <button
                type="button"
                onClick={() => setIsManageSubjectsModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: COPY PERIODS TO SELECTED CLASSES */}
      {copyPeriodsModalSourceClassId && (() => {
        const sourceClass = classes.find(c => c.id === copyPeriodsModalSourceClassId);
        if (!sourceClass) return null;

        const sourceTotalPeriods = SUBJECTS.reduce((sum, sub) => {
          return sum + getSubjectPeriod(sub.id, sourceClass.grade, sourceClass.id);
        }, 0);

        const gradesList: ('10' | '11' | '12')[] = ['10', '11', '12'];

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-start shrink-0">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Copy className="w-5 h-5 text-sky-600" /> Sao chép Cấu hình Thời lượng sang các Lớp
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chọn các lớp bạn muốn áp dụng toàn bộ định mức số tiết từ lớp nguồn.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCopyPeriodsModalSourceClassId(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Source Info Banner */}
              <div className="p-3.5 bg-sky-50/80 border-b border-sky-100 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-slate-600 font-medium">Lớp nguồn sao chép:</span>
                  <span className="px-2.5 py-0.5 bg-sky-600 text-white font-bold rounded shadow-2xs">
                    {sourceClass.name}
                  </span>
                  <span className="text-slate-500">(Khối {sourceClass.grade})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-600">Tổng thời lượng:</span>
                  <span className="font-bold text-sky-900 bg-white px-2 py-0.5 rounded border border-sky-200 shadow-2xs">
                    {sourceTotalPeriods} tiết/tuần
                  </span>
                </div>
              </div>

              {/* Quick Filter & Selection Toolbar */}
              <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-semibold mr-1">Chọn nhanh:</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAllTargetsInGrade(sourceClass.grade)}
                    className="px-2.5 py-1 rounded bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 font-medium transition cursor-pointer text-xs"
                  >
                    Cùng Khối {sourceClass.grade}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllTargetsInGrade('10')}
                    className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium transition cursor-pointer text-xs"
                  >
                    Khối 10
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllTargetsInGrade('11')}
                    className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium transition cursor-pointer text-xs"
                  >
                    Khối 11
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllTargetsInGrade('12')}
                    className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium transition cursor-pointer text-xs"
                  >
                    Khối 12
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectAllTargetsSchool}
                    className="px-2.5 py-1 rounded bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 font-medium transition cursor-pointer text-xs"
                  >
                    Toàn trường
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={handleDeselectAllTargets}
                    disabled={selectedTargetClassesForCopy.length === 0}
                    className="text-xs text-rose-600 hover:text-rose-700 hover:underline disabled:opacity-30 disabled:no-underline font-medium cursor-pointer"
                  >
                    Bỏ chọn tất cả
                  </button>
                </div>
              </div>

              {/* Class Selection List Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {gradesList.map(grade => {
                  const gradeClasses = classes.filter(c => c.grade === grade);
                  const isSourceGrade = sourceClass.grade === grade;
                  const selectableInGrade = gradeClasses.filter(c => c.id !== sourceClass.id);
                  const selectedInGradeCount = selectableInGrade.filter(c => selectedTargetClassesForCopy.includes(c.id)).length;
                  const allSelectedInGrade = selectableInGrade.length > 0 && selectedInGradeCount === selectableInGrade.length;

                  return (
                    <div key={grade} className="border border-slate-200 rounded-lg p-3 bg-white shadow-2xs">
                      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs sm:text-sm">
                            Khối {grade}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            ({selectedInGradeCount}/{selectableInGrade.length} lớp đã chọn)
                          </span>
                          {isSourceGrade && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-800 font-semibold rounded">
                              Khối của lớp nguồn
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectAllTargetsInGrade(grade)}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          {allSelectedInGrade ? 'Bỏ chọn khối này' : 'Chọn toàn bộ khối này'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {gradeClasses.map(cls => {
                          const isSource = cls.id === sourceClass.id;
                          const isChecked = selectedTargetClassesForCopy.includes(cls.id);
                          const clsTotal = SUBJECTS.reduce((sum, sub) => sum + getSubjectPeriod(sub.id, cls.grade, cls.id), 0);

                          if (isSource) {
                            return (
                              <div
                                key={cls.id}
                                className="p-2 rounded-lg border border-slate-200 bg-slate-100/80 opacity-60 flex flex-col items-center justify-center text-center cursor-not-allowed select-none"
                                title="Đây là lớp nguồn đang được sao chép"
                              >
                                <span className="font-bold text-xs text-slate-600">{cls.name}</span>
                                <span className="text-[10px] text-slate-500 font-medium mt-0.5">(Lớp nguồn)</span>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={cls.id}
                              type="button"
                              onClick={() => handleToggleTargetClassForCopy(cls.id)}
                              className={`p-2 rounded-lg border transition-all text-left flex items-center justify-between gap-1.5 cursor-pointer select-none ${
                                isChecked
                                  ? 'border-sky-500 bg-sky-50/80 text-sky-900 shadow-2xs font-semibold'
                                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 text-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center text-white shrink-0 ${
                                  isChecked ? 'bg-sky-600 border-sky-600' : 'border-slate-300 bg-white'
                                }`}>
                                  {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                                </div>
                                <span className="text-xs truncate">{cls.name}</span>
                              </div>
                              <span className={`text-[10px] shrink-0 ${isChecked ? 'text-sky-700' : 'text-slate-400'}`}>
                                {clsTotal}t
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Optional Settings & Footer */}
              <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 text-xs">
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={copyIncludeConsecutive}
                    onChange={e => setCopyIncludeConsecutive(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span>Sao chép cả thiết lập Tiết học 3 tiết liền nhau (nếu có)</span>
                </label>

                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setCopyPeriodsModalSourceClassId(null)}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteCopyPeriods}
                    disabled={selectedTargetClassesForCopy.length === 0}
                    className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:hover:bg-sky-600 text-white font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-2xs disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Xác nhận sao chép ({selectedTargetClassesForCopy.length} lớp)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 7: CONFIRM CLEAR ASSIGNMENTS */}
      {isClearAssignmentsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-rose-50 border-b border-rose-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  Xác nhận xóa phân công giảng dạy
                </h3>
                <p className="text-xs text-rose-700 mt-0.5 font-medium">
                  Cảnh báo: Hành động này sẽ hủy bỏ các kết quả phân công trong thời khóa biểu / bảng phân công.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsClearAssignmentsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-rose-100/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Current assignment statistics */}
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <span className="text-slate-600 font-semibold block mb-2">Thống kê phân công hiện tại:</span>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between shadow-2xs">
                    <span>Lớp đã phân công GVCN:</span>
                    <span className="font-bold text-blue-700 text-sm">{totalHomeroomAssigned} / {classes.length}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between shadow-2xs">
                    <span>Lượt phân công môn học:</span>
                    <span className="font-bold text-indigo-700 text-sm">{totalSubjectAssigned} lượt</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 italic">
                  * Danh sách giáo viên, lớp học và cấu hình số tiết môn học sẽ được giữ nguyên không bị ảnh hưởng.
                </p>
              </div>

              {/* Scope options */}
              <div>
                <label className="block text-slate-700 font-semibold mb-2">
                  Lựa chọn phạm vi xóa phân công:
                </label>
                <div className="space-y-2">
                  <label 
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition select-none ${
                      clearAssignmentOption === 'all' 
                        ? 'border-rose-400 bg-rose-50/70 ring-1 ring-rose-300' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="clearOption"
                      checked={clearAssignmentOption === 'all'}
                      onChange={() => setClearAssignmentOption('all')}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block text-xs">
                        Xóa toàn bộ phân công (Khuyên dùng khi xếp lại từ đầu)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Xóa sạch cả phân công giáo viên chủ nhiệm và tất cả phân công dạy bộ môn của các lớp.
                      </span>
                    </div>
                  </label>

                  <label 
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition select-none ${
                      clearAssignmentOption === 'subject_only' 
                        ? 'border-amber-400 bg-amber-50/70 ring-1 ring-amber-300' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="clearOption"
                      checked={clearAssignmentOption === 'subject_only'}
                      onChange={() => setClearAssignmentOption('subject_only')}
                      className="mt-0.5 text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block text-xs">
                        Chỉ xóa phân công dạy môn học
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Giữ nguyên danh sách giáo viên chủ nhiệm của các lớp hiện tại.
                      </span>
                    </div>
                  </label>

                  <label 
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition select-none ${
                      clearAssignmentOption === 'homeroom_only' 
                        ? 'border-blue-400 bg-blue-50/70 ring-1 ring-blue-300' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="clearOption"
                      checked={clearAssignmentOption === 'homeroom_only'}
                      onChange={() => setClearAssignmentOption('homeroom_only')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block text-xs">
                        Chỉ xóa phân công giáo viên chủ nhiệm
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Giữ nguyên các phân công giáo viên bộ môn giảng dạy các lớp.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsClearAssignmentsModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleExecuteClearAssignments}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-2xs text-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>Xác nhận xóa phân công</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 8: CẤU HÌNH TÙY CHỌN PHÂN CÔNG TỰ ĐỘNG (RÀNG BUỘC CỨNG & RÀNG BUỘC MỀM) */}
      {isAiOptimizeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header (Cố định - Fixed/Sticky) */}
            <div className="shrink-0 p-3.5 px-4 sm:px-5 bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 text-white flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-md text-white flex items-center justify-center shadow-xs shrink-0 border border-white/20">
                  <Sparkles className="w-5 h-5 text-yellow-300" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                      Cấu hình tùy chọn Phân công Tự động
                    </h3>
                    <span className="text-[10px] bg-yellow-400 text-slate-900 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider shrink-0 shadow-xs">
                      Quy chế sư phạm
                    </span>
                  </div>
                  <p className="text-[11.5px] text-blue-100 truncate font-medium mt-0.5">
                    Phân tách Ràng buộc cứng bắt buộc theo quy chế và Ràng buộc mềm tùy chỉnh linh hoạt
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAiOptimizeModalOpen(false)}
                className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer shrink-0"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body (Scrollable Body) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50/60 space-y-4">
              
              {/* CHỌN PHẠM VI / CHẾ ĐỘ PHÂN CÔNG */}
              <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    Phạm vi phân công:
                  </span>
                  <span className="text-[11px] text-slate-400">Chọn chế độ áp dụng phù hợp</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {/* Mode 1: manual_and_auto */}
                  <label className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex flex-col justify-between ${
                    aiOptimizeMode === 'manual_and_auto'
                      ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500 text-indigo-950 font-semibold'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">Thủ công & Tự động</span>
                      <input 
                        type="radio" 
                        name="assignScope" 
                        checked={aiOptimizeMode === 'manual_and_auto'} 
                        onChange={() => setAiOptimizeMode('manual_and_auto')}
                        className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10.5px] text-slate-500 mt-1 leading-snug">
                      Giữ nguyên các lớp đã xếp, chỉ phân công các ô trống.
                    </span>
                  </label>

                  {/* Mode 2: all */}
                  <label className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex flex-col justify-between ${
                    aiOptimizeMode === 'all'
                      ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500 text-indigo-950 font-semibold'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">Toàn diện (Cả hai)</span>
                      <input 
                        type="radio" 
                        name="assignScope" 
                        checked={aiOptimizeMode === 'all'} 
                        onChange={() => setAiOptimizeMode('all')}
                        className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10.5px] text-slate-500 mt-1 leading-snug">
                      Phân công lại toàn bộ cả GVCN và môn giảng dạy.
                    </span>
                  </label>

                  {/* Mode 3: teaching_only */}
                  <label className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex flex-col justify-between ${
                    aiOptimizeMode === 'teaching_only'
                      ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500 text-indigo-950 font-semibold'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">Chỉ dạy học bộ môn</span>
                      <input 
                        type="radio" 
                        name="assignScope" 
                        checked={aiOptimizeMode === 'teaching_only'} 
                        onChange={() => setAiOptimizeMode('teaching_only')}
                        className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10.5px] text-slate-500 mt-1 leading-snug">
                      Bảo lưu nguyên vẹn danh sách GVCN hiện có.
                    </span>
                  </label>

                  {/* Mode 4: homeroom_only */}
                  <label className={`p-2.5 rounded-lg border text-left cursor-pointer transition select-none flex flex-col justify-between ${
                    aiOptimizeMode === 'homeroom_only'
                      ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-500 text-indigo-950 font-semibold'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">Chỉ chủ nhiệm</span>
                      <input 
                        type="radio" 
                        name="assignScope" 
                        checked={aiOptimizeMode === 'homeroom_only'} 
                        onChange={() => setAiOptimizeMode('homeroom_only')}
                        className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10.5px] text-slate-500 mt-1 leading-snug">
                      Bảo lưu nguyên vẹn các môn giảng dạy đã xếp.
                    </span>
                  </label>
                </div>
              </div>

              {/* GRID 2 CỘT: KHUNG 1 (RÀNG BUỘC CỨNG) & KHUNG 2 (RÀNG BUỘC MỀM) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* 1. KHUNG THÔNG TIN RÀNG BUỘC CỨNG (MẶC ĐỊNH BẮT BUỘC, BỊ MỜ/KHÓA TICK, LUÔN BẬT) */}
                <div className="bg-slate-100/80 rounded-xl p-4 border border-slate-300 flex flex-col justify-between shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔒</span>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                          Ràng buộc cứng (Bắt buộc theo quy chế)
                        </h4>
                      </div>
                      <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        Khóa cố định
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 mb-3 italic">
                      Các nguyên tắc pháp lý và chuyên môn sư phạm bắt buộc 100%, hệ thống tự động tuân thủ nghiêm ngặt:
                    </p>

                    <div className="space-y-2.5">
                      {/* Cứng 1 */}
                      <label className="flex items-start gap-2.5 p-2 bg-white/70 rounded-lg border border-slate-200/80 cursor-not-allowed select-none opacity-85">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={true}
                          className="mt-0.5 text-emerald-600 rounded cursor-not-allowed accent-emerald-600"
                        />
                        <div className="text-xs leading-snug text-slate-800">
                          <strong>BGH tuyệt đối không làm GVCN</strong>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            (role === 'Hiệu trưởng' || role === 'Phó Hiệu trưởng'). BGH chỉ giảng dạy theo định mức chuẩn (HT: 2t, PHT: 4t).
                          </span>
                        </div>
                      </label>

                      {/* Cứng 2 */}
                      <label className="flex items-start gap-2.5 p-2 bg-white/70 rounded-lg border border-slate-200/80 cursor-not-allowed select-none opacity-85">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={true}
                          className="mt-0.5 text-emerald-600 rounded cursor-not-allowed accent-emerald-600"
                        />
                        <div className="text-xs leading-snug text-slate-800">
                          <strong>GVCN bắt buộc dạy chính lớp mình chủ nhiệm</strong>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            (nếu lớp có học môn đó). Gán ngay ở Bước 0 và trừ trực tiếp vào quota của giáo viên.
                          </span>
                        </div>
                      </label>

                      {/* Cứng 3 */}
                      <label className="flex items-start gap-2.5 p-2 bg-white/70 rounded-lg border border-slate-200/80 cursor-not-allowed select-none opacity-85">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={true}
                          className="mt-0.5 text-emerald-600 rounded cursor-not-allowed accent-emerald-600"
                        />
                        <div className="text-xs leading-snug text-slate-800">
                          <strong>Đúng môn chuyên môn của giáo viên</strong>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            Tuyệt đối không phân giáo viên dạy chéo môn hoặc trái chuyên ngành đào tạo (ngoại trừ GDĐP/TNHN).
                          </span>
                        </div>
                      </label>

                      {/* Cứng 4 */}
                      <label className="flex items-start gap-2.5 p-2 bg-white/70 rounded-lg border border-slate-200/80 cursor-not-allowed select-none opacity-85">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={true}
                          className="mt-0.5 text-emerald-600 rounded cursor-not-allowed accent-emerald-600"
                        />
                        <div className="text-xs leading-snug text-slate-800">
                          <strong>Môn 0 tiết tuyệt đối không gán giáo viên</strong>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            Lớp không học môn nào thì ô đó để trống hoàn toàn, không tính vào số tiết của giáo viên.
                          </span>
                        </div>
                      </label>

                      {/* Cứng 5 */}
                      <label className="flex items-start gap-2.5 p-2 bg-white/70 rounded-lg border border-slate-200/80 cursor-not-allowed select-none opacity-85">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled={true}
                          className="mt-0.5 text-emerald-600 rounded cursor-not-allowed accent-emerald-600"
                        />
                        <div className="text-xs leading-snug text-slate-800">
                          <strong>Mỗi lớp duy nhất 1 GVCN, mỗi GV chỉ chủ nhiệm tối đa 1 lớp</strong>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            Tuyệt đối không trùng lặp giáo viên chủ nhiệm giữa các lớp học trong trường.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>5/5 ràng buộc cứng được bảo vệ tự động</span>
                  </div>
                </div>

                {/* 2. KHUNG TÙY CHỌN RÀNG BUỘC MỀM (NGƯỜI DÙNG CÓ THỂ BẬT / TẮT BẰNG CHECKBOX) */}
                <div className="bg-white rounded-xl p-4 border border-indigo-200 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-indigo-100">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⚙️</span>
                        <h4 className="text-xs sm:text-sm font-bold text-indigo-950">
                          Tùy chọn tối ưu hóa sư phạm (Bật/Tắt theo nhu cầu)
                        </h4>
                      </div>
                      <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        Linh hoạt
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 mb-3">
                      Tick chọn các tiêu chí bạn muốn hệ thống ưu tiên tối ưu hóa theo tình hình thực tế của nhà trường:
                    </p>

                    <div className="space-y-2.5">
                      {/* Mềm 1: optPrioritizeNormalTeachers */}
                      <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        optPrioritizeNormalTeachers 
                          ? 'border-indigo-500 bg-indigo-50/60 shadow-2xs' 
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                      }`}>
                        <input
                          type="checkbox"
                          checked={optPrioritizeNormalTeachers}
                          onChange={e => setOptPrioritizeNormalTeachers(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="text-xs leading-snug">
                          <span className="font-bold text-slate-900 block">
                            Ưu tiên phân công GV thường làm GVCN trước, hạn chế Tổ trưởng / Tổ phó
                          </span>
                          <span className="text-[11px] text-slate-600 block mt-0.5">
                            Lọc ứng viên GVCN theo thứ tự ưu tiên: <strong>GV thường → Tổ phó → Tổ trưởng</strong> nhằm giảm tải công tác kiêm nhiệm cho cán bộ tổ.
                          </span>
                        </div>
                      </label>

                      {/* Mềm 2: optStrictQuota */}
                      <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        optStrictQuota 
                          ? 'border-indigo-500 bg-indigo-50/60 shadow-2xs' 
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                      }`}>
                        <input
                          type="checkbox"
                          checked={optStrictQuota}
                          onChange={e => setOptStrictQuota(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="text-xs leading-snug">
                          <span className="font-bold text-slate-900 block">
                            Không phân công vượt trần định mức
                          </span>
                          <span className="text-[11px] text-slate-600 block mt-0.5">
                            Chỉ gán nếu tổng tiết ≤ định mức. Nếu thiếu GV, để trống ô và báo cáo chi tiết. <em>(Nếu tắt: cho phép dạy vượt tiết/thừa giờ khi thiếu GV).</em>
                          </span>
                        </div>
                      </label>

                      {/* Mềm 3: optLimitGrades */}
                      <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        optLimitGrades 
                          ? 'border-indigo-500 bg-indigo-50/60 shadow-2xs' 
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                      }`}>
                        <input
                          type="checkbox"
                          checked={optLimitGrades}
                          onChange={e => setOptLimitGrades(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="text-xs leading-snug">
                          <span className="font-bold text-slate-900 block">
                            Giới hạn mỗi giáo viên dạy tối đa 1 đến 2 khối lớp
                          </span>
                          <span className="text-[11px] text-slate-600 block mt-0.5">
                            Ưu tiên xếp GV cùng khối đã nhận, tránh tình trạng 1 giáo viên phải dạy dàn trải cả 3 khối 10, 11 và 12.
                          </span>
                        </div>
                      </label>

                      {/* Mềm 4: optBalanceWorkload */}
                      <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                        optBalanceWorkload 
                          ? 'border-indigo-500 bg-indigo-50/60 shadow-2xs' 
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60'
                      }`}>
                        <input
                          type="checkbox"
                          checked={optBalanceWorkload}
                          onChange={e => setOptBalanceWorkload(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="text-xs leading-snug">
                          <span className="font-bold text-slate-900 block">
                            Cân bằng số tiết giữa các giáo viên trong cùng tổ bộ môn
                          </span>
                          <span className="text-[11px] text-slate-600 block mt-0.5">
                            Ưu tiên chọn GV đang có tỷ lệ <em>(Số tiết hiện tại / Quota)</em> thấp nhất để triệt tiêu chênh lệch thừa/thiếu tiết giữa các đồng nghiệp.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-indigo-100 text-[11px] text-indigo-700 font-medium flex items-center justify-between">
                    <span>Trạng thái: Đã kích hoạt {[optPrioritizeNormalTeachers, optStrictQuota, optLimitGrades, optBalanceWorkload].filter(Boolean).length}/4 tùy chọn</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOptPrioritizeNormalTeachers(true);
                        setOptStrictQuota(false);
                        setOptLimitGrades(true);
                        setOptBalanceWorkload(true);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 underline font-semibold cursor-pointer"
                    >
                      Đặt lại mặc định
                    </button>
                  </div>
                </div>

              </div>

            </div>

            {/* Footer actions (Cố định - Fixed/Sticky Footer) */}
            <div className="shrink-0 p-3.5 px-4 sm:px-5 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-2.5">
              <div className="text-[11.5px] text-slate-500 hidden sm:flex items-center gap-1.5">
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Hệ thống sẽ chạy thuật toán Heuristic Constraint Solver theo đúng các tùy chọn đã thiết lập.</span>
              </div>
              <div className="flex items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsAiOptimizeModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold transition cursor-pointer text-xs"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => handleAiOptimize()}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-lg font-bold transition cursor-pointer flex items-center gap-2 shadow-sm hover:shadow text-xs"
                >
                  <Sparkles className="w-4 h-4 text-yellow-300" />
                  <span>Bắt đầu phân công</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BÁO CÁO TỔNG HỢP Ô TRỐNG THIẾU GIÁO VIÊN (KHI BẬT optStrictQuota) */}
      {unassignedReport && unassignedReport.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[70] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-600 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/20 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-white stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                    Báo cáo: Còn {unassignedReport.length} môn học chưa được phân công giáo viên
                  </h3>
                  <p className="text-xs text-amber-100 mt-0.5">
                    Do đã bật tùy chọn <strong>[Không phân công vượt trần định mức]</strong>, các ô môn dưới đây chưa đủ GV thỏa mãn quota
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnassignedReport(null)}
                className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Table */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <p>
                  <strong>Nguyên nhân:</strong> Tất cả giáo viên cùng tổ bộ môn của các môn này đã đạt tối đa định mức trần (hoặc không còn giáo viên nào đủ điều kiện nhận thêm tiết mà không bị vượt giờ).
                </p>
                <p className="mt-1 text-slate-600">
                  Thầy/cô có thể phân công bổ sung thủ công trên lưới, hoặc bấm <strong>"Cho phép vượt định mức & Phân công lại ngay"</strong> để hệ thống tự động gán đều số tiết vượt giờ cho các giáo viên.
                </p>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="max-h-[320px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100/90 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="py-2 px-3 text-center w-12">STT</th>
                        <th className="py-2 px-3">Lớp học</th>
                        <th className="py-2 px-3 text-center">Khối</th>
                        <th className="py-2 px-3">Môn học</th>
                        <th className="py-2 px-3 text-center">Số tiết</th>
                        <th className="py-2 px-3">Lý do chưa xếp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {unassignedReport.map((slot, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2 px-3 text-center font-mono text-slate-400 font-semibold">{idx + 1}</td>
                          <td className="py-2 px-3 font-bold text-slate-900">{slot.className}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[11px]">
                              K{slot.grade}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-semibold text-indigo-700">{slot.subject}</td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-amber-700">{slot.periods}t</td>
                          <td className="py-2 px-3 text-slate-600 text-[11px] leading-tight">{slot.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3.5 px-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-2">
              <span className="text-xs text-slate-500">
                Tổng cộng: <strong className="text-slate-800">{unassignedReport.length}</strong> môn cần xử lý
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUnassignedReport(null)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold transition cursor-pointer text-xs"
                >
                  Đóng & Xem trên lưới
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnassignedReport(null);
                    setOptStrictQuota(false);
                    handleAiOptimize({ optStrictQuota: false });
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                  <span>Cho phép vượt định mức & Phân công lại ngay</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NATURAL LANGUAGE IMPORT MODAL */}
      <NaturalLanguageImportModal
        isOpen={isNlImportOpen}
        onClose={() => setIsNlImportOpen(false)}
        type={nlImportType}
        teachers={teachers}
        classes={classes}
        subjectsConfig={subjectsConfig}
        onImportTeachers={handleImportTeachers}
        onImportClasses={handleImportClasses}
        onImportSubjects={handleImportSubjects}
        onImportLessonHours={handleImportLessonHours}
        onImportAssignments={handleImportAssignments}
        onNotification={(msg) => showTermNotification(msg)}
      />

      {/* EXPORT & PRINT MODAL */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        classes={classes}
        teachers={teachers}
        subjects={SUBJECTS}
        assignments={assignments}
        getSubjectPeriod={getSubjectPeriod}
        getAssignedTeacherId={getAssignedTeacherId}
        teacherStatsMap={teacherStatsMap}
        schoolInfo={schoolInfo}
        setSchoolInfo={setSchoolInfo}
        currentSemester={currentSemester}
        currentAcademicYear={currentAcademicYear}
      />

      {/* MODAL: SETTINGS (BACKUP & RESTORE) */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 shadow-2xs">
                  <Settings className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Cài đặt hệ thống / Thông tin trường học</h3>
                  <p className="text-[10px] sm:text-xs text-slate-500">Quản lý thông tin trường, đổi logo thương hiệu, quản lý các năm học và sao lưu dữ liệu</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5 overflow-y-auto max-h-[75vh]">
              {/* Card RBAC: Quản lý Tài khoản & Phân quyền Chi tiết (Dành riêng Admin) */}
              {hasPermission('SETTINGS_MANAGE_SYSTEM') && (
                <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 rounded-xl p-4 text-white shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 overflow-hidden">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0 pr-2">
                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/20 shrink-0">
                      <ShieldCheck className="w-5 h-5 text-yellow-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <h4 className="font-bold text-sm whitespace-nowrap">Hệ thống Quản trị & Phân quyền (RBAC)</h4>
                        <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400 text-amber-950 whitespace-nowrap shadow-sm">
                          👑 ADMIN ONLY
                        </span>
                      </div>
                      <p className="text-sm text-blue-100 mt-1 leading-relaxed">
                        Cấp phát tài khoản, phân quyền 18 nghiệp vụ (Khai báo, Phân công, TKB, Gửi tin, Hệ thống) và bảo vệ tài khoản gốc
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsModalOpen(false);
                      setIsUserManagementModalOpen(true);
                    }}
                    className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-blue-50 text-blue-800 font-bold rounded-xl text-xs transition cursor-pointer shadow-xs active:scale-95 flex-shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5"
                  >
                    <Users className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Mở Quản lý tài khoản</span>
                  </button>
                </div>
              )}

              {/* Card 1: Thông tin trường học & Đổi Logo trường (Chỉ Quản trị viên) */}
              <div className="bg-gradient-to-br from-slate-50 via-indigo-50/30 to-blue-50/40 rounded-xl border border-indigo-200 p-4 shadow-2xs">
                <div className="flex items-start gap-4">
                  {/* Logo Preview & Upload */}
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <div className="w-16 h-16 rounded-full border-2 border-indigo-400 p-0.5 bg-white shadow-sm flex items-center justify-center overflow-hidden">
                      <SchoolLogo 
                        customLogo={customLogo} 
                        alt="Logo Trường THPT Nguyễn Bỉnh Khiêm (An Giang)" 
                        className="w-full h-full rounded-full object-contain"
                      />
                    </div>
                    <label 
                      htmlFor="admin-settings-logo-input"
                      className="px-3 py-1 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer transition flex items-center gap-1.5 shadow-2xs text-center"
                      title="Chọn ảnh logo mới từ máy tính"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Đổi Logo</span>
                    </label>
                    <input 
                      id="admin-settings-logo-input"
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleLogoUpload} 
                    />
                    {customLogo && (
                      <button
                        type="button"
                        onClick={handleResetLogo}
                        className="text-[10px] text-rose-600 hover:text-rose-800 underline cursor-pointer font-medium"
                        title="Khôi phục logo mặc định của trường"
                      >
                        Khôi phục logo gốc
                      </button>
                    )}
                  </div>

                  {/* School Information Form */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <School className="w-4 h-4 text-indigo-600" />
                        <span>Thông tin trường học & Logo</span>
                      </h4>
                      <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full border border-indigo-200">
                        Quyền Quản trị viên
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Chỉ Quản trị viên mới có quyền cập nhật Logo và thông tin tên trường. Logo mới sẽ được áp dụng tự động lên thanh Header, biểu mẫu in ấn và toàn bộ hệ thống.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Tên trường học:
                        </label>
                        <input 
                          type="text" 
                          value={schoolInfo.schoolName || currentSchoolName || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSchoolInfo(prev => ({ ...prev, schoolName: val }));
                            setCurrentSchoolName(val);
                            try {
                              localStorage.setItem('edu_school_name', val);
                            } catch {}
                          }}
                          placeholder="TRƯỜNG THPT NGUYỄN BỈNH KHIÊM"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500 font-medium text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Cơ quan chủ quản:
                        </label>
                        <input 
                          type="text" 
                          value={schoolInfo.departmentName || 'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSchoolInfo(prev => ({ ...prev, departmentName: val }));
                          }}
                          placeholder="SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500 font-medium text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 0: Quản lý Nhiều Năm học & Học kỳ */}
              <div className="bg-gradient-to-br from-indigo-50/70 to-blue-50/70 rounded-xl border border-indigo-200 p-4 shadow-2xs">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-indigo-600 text-white rounded-xl shrink-0 shadow-2xs">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-900 text-sm">Quản lý & Lưu trữ Nhiều Năm học, Học kỳ</h4>
                      <span className="text-xs font-bold bg-indigo-600 text-white px-2.5 py-0.5 rounded-full">
                        Đang làm việc: {currentAcademicYear} ({currentSemester})
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                      Hệ thống tự động lưu trữ dữ liệu phân công riêng biệt cho từng Năm học và từng Học kỳ. Thầy/cô có thể chuyển đổi năm học trực tiếp tại thanh tiêu đề bất cứ lúc nào.
                    </p>

                    {/* Danh sách các kỳ học đã lưu */}
                    <div className="mt-3 bg-white rounded-lg border border-indigo-100 p-2.5">
                      <div className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                        <FolderArchive className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Các năm học & học kỳ có dữ liệu trong máy:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {getSavedTermsCatalog().map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                              switchTermDirectly(item.academicYear, item.semester);
                              setIsSettingsModalOpen(false);
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                              item.isCurrent
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800'
                            }`}
                          >
                            <span>{item.academicYear} • {item.semester}</span>
                            {item.isCurrent && <Check className="w-3 h-3 text-yellow-300" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsModalOpen(false);
                          setIsAddYearModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg font-semibold transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm năm học mới...</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsModalOpen(false);
                          const nextSem = currentSemester === 'Học kỳ I' ? 'Học kỳ II' : 'Học kỳ I';
                          setTermInitModal({
                            targetYear: currentAcademicYear,
                            targetSemester: nextSem
                          });
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-medium transition cursor-pointer text-xs flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5 text-blue-600" />
                        <span>Sao chép sang {currentSemester === 'Học kỳ I' ? 'Học kỳ II' : 'Học kỳ I'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 1: Backup Data */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-900 text-sm">Sao lưu dữ liệu (Xuất tệp .json)</h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                        Năm hiện tại: {currentAcademicYear}
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                      Lưu trữ cơ sở dữ liệu về máy tính an toàn. Thầy/cô có thể chọn xuất bản sao lưu riêng cho <strong>năm học hiện tại ({currentAcademicYear})</strong> hoặc <strong>toàn bộ tất cả {availableYears.length} năm học</strong>.
                    </p>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Option 1A: Sao lưu năm hiện tại */}
                      <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50/70 transition flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                              Năm học hiện tại
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-200/70 text-indigo-800">
                              {currentAcademicYear}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-tight">
                            Chỉ đóng gói danh sách lớp, môn và bảng phân công của riêng năm học <strong>{currentAcademicYear}</strong>.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleBackupCurrentYear}
                          className="mt-3 w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Sao lưu năm {currentAcademicYear} (.json)</span>
                        </button>
                      </div>

                      {/* Option 1B: Sao lưu tất cả các năm */}
                      <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/40 hover:bg-blue-50/70 transition flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                              <FolderArchive className="w-3.5 h-3.5 text-blue-600" />
                              Tất cả các năm học
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-200/70 text-blue-800">
                              {availableYears.length} năm
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-tight">
                            Đóng gói toàn bộ cơ sở dữ liệu và bảng phân công của <strong>tất cả {availableYears.length} năm học</strong> có trong hệ thống.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleBackupData}
                          className="mt-3 w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Sao lưu tất cả {availableYears.length} năm (.json)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Restore Data */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl shrink-0">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-bold text-slate-900 text-sm">Phục hồi dữ liệu từ tệp (.json)</h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        {restoreScope === 'all' ? 'Mặc định: Tất cả các năm' : `Chỉ năm: ${currentAcademicYear}`}
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                      Chọn tệp sao lưu JSON để khôi phục dữ liệu vào phần mềm. Thầy/cô vui lòng chọn phạm vi phục hồi mong muốn dưới đây:
                    </p>

                    {/* Radio group chọn phạm vi phục hồi */}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-2.5 ${
                        restoreScope === 'all'
                          ? 'border-amber-400 bg-amber-50/70 text-slate-900 shadow-2xs ring-1 ring-amber-300'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-700'
                      }`}>
                        <input
                          type="radio"
                          name="restore_scope"
                          value="all"
                          checked={restoreScope === 'all'}
                          onChange={() => setRestoreScope('all')}
                          className="mt-0.5 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <div className="text-xs">
                          <div className="font-bold flex items-center gap-1.5 text-slate-900">
                            <span>Phục hồi tất cả các năm</span>
                            <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.2 rounded">Mặc định</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-tight">
                            Khôi phục toàn diện tất cả các năm học có trong tệp sao lưu (Đồng bộ toàn bộ cơ sở dữ liệu).
                          </p>
                        </div>
                      </label>

                      <label className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-2.5 ${
                        restoreScope === 'current_year'
                          ? 'border-indigo-400 bg-indigo-50/70 text-slate-900 shadow-2xs ring-1 ring-indigo-300'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-700'
                      }`}>
                        <input
                          type="radio"
                          name="restore_scope"
                          value="current_year"
                          checked={restoreScope === 'current_year'}
                          onChange={() => setRestoreScope('current_year')}
                          className="mt-0.5 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="text-xs">
                          <div className="font-bold flex items-center gap-1.5 text-slate-900">
                            <span>Chỉ phục hồi năm hiện tại</span>
                            <span className="text-[10px] font-bold bg-indigo-200 text-indigo-800 px-1.5 py-0.2 rounded">{currentAcademicYear}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-tight">
                            Chỉ nạp và cập nhật dữ liệu của năm {currentAcademicYear}. Giữ nguyên toàn bộ dữ liệu các năm khác.
                          </p>
                        </div>
                      </label>
                    </div>

                    {/* File upload drag/button */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3.5 flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-xl p-5 bg-amber-50/30 hover:bg-amber-50/60 cursor-pointer transition-all duration-200 group shadow-2xs"
                    >
                      <Upload className="w-8 h-8 text-amber-500 group-hover:scale-110 transition mb-2" />
                      <span className="text-xs font-bold text-slate-800 group-hover:text-amber-700">
                        {restoreScope === 'all'
                          ? 'Click để Chọn tệp Phục hồi tất cả các năm (Mặc định)'
                          : `Click để Chọn tệp Chỉ phục hồi năm ${currentAcademicYear}`}
                      </span>
                      <span className="text-[11px] text-slate-500 mt-1">
                        Hỗ trợ định dạng tệp JSON (.json) xuất từ phần mềm
                      </span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onClick={(e) => {
                          // Prevent event bubbling to parent div which would trigger double-click
                          e.stopPropagation();
                        }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleRestoreData(file, restoreScope);
                          }
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL THIẾT LẬP DỮ LIỆU CHO HỌC KỲ MỚI */}
      {termInitModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[75] animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            <div className="p-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-yellow-300" />
                <h3 className="font-bold text-base">
                  Chuyển sang {termInitModal.targetSemester} ({termInitModal.targetYear})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTermInitModal(null)}
                className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Chưa có dữ liệu phân công giảng dạy cho <strong>{termInitModal.targetSemester} năm học {termInitModal.targetYear}</strong>. Thầy/cô vui lòng chọn cách bắt đầu:
                </p>
              </div>

              <div className="space-y-3">
                {/* Phương án 1 */}
                <button
                  type="button"
                  onClick={handleCloneCurrentTermToTarget}
                  className="w-full text-left p-3.5 rounded-xl border-2 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-500 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-indigo-900 text-sm flex items-center gap-1.5">
                      <Copy className="w-4 h-4 text-indigo-600" />
                      Sao chép phân công từ {currentSemester} ({currentAcademicYear})
                    </span>
                    <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold">Khuyên dùng</span>
                  </div>
                  <p className="text-slate-600 text-xs leading-relaxed">
                    Giữ nguyên toàn bộ phân công giáo viên bộ môn và chủ nhiệm hiện tại để dễ dàng chỉnh sửa lại cho kỳ mới mà không phải phân công lại từ đầu.
                  </p>
                </button>

                {/* Phương án 2 */}
                <button
                  type="button"
                  onClick={handleInitBlankTerm}
                  className="w-full text-left p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 transition cursor-pointer"
                >
                  <div className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-blue-600" />
                    Tạo bảng phân công mới (Trống)
                  </div>
                  <p className="text-slate-600 text-xs leading-relaxed">
                    Giữ nguyên danh sách giáo viên, lớp học và môn học của trường, nhưng làm mới toàn bộ phân công dạy học để xếp mới hoàn toàn.
                  </p>
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTermInitModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
              >
                Hủy bỏ (Giữ nguyên {currentSemester} {currentAcademicYear})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CHỌN LỰA VÀ QUẢN LÝ NĂM HỌC, HỌC KỲ ĐA NĂM */}
      {isYearSemesterModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[75] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 max-h-[90vh]">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-lg border border-white/20">
                  <CalendarDays className="w-5 h-5 text-yellow-300" />
                </div>
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    Chọn lựa & Quản lý Năm học, Học kỳ
                    <span className="text-[10px] bg-yellow-400 text-slate-900 font-bold px-2 py-0.5 rounded-full">
                      Lưu trữ đa năm
                    </span>
                  </h3>
                  <p className="text-xs text-blue-100">
                    Lưu trữ độc lập dữ liệu phân công giảng dạy, lớp học và giáo viên qua nhiều năm học
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsYearSemesterModalOpen(false)}
                className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700 flex-1">
              {/* Thẻ trạng thái hiện hành */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide block">
                    Đang kích hoạt làm việc:
                  </span>
                  <div className="text-base font-extrabold text-blue-950 flex items-center gap-2 mt-0.5">
                    <span>Năm học {currentAcademicYear}</span>
                    <span>•</span>
                    <span className="text-indigo-700">{currentSemester}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Đã xếp: <strong className="text-emerald-700">{statsCount.homeroomAssigned}/{statsCount.classesCount}</strong> lớp GVCN • <strong className="text-indigo-700">{statsCount.subjectsAssigned}/{statsCount.totalSubjects}</strong> môn học
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setIsYearSemesterModalOpen(false);
                      setIsAddYearModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-2xs text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm năm học mới</span>
                  </button>
                </div>
              </div>

              {/* Danh sách Ma trận các Năm học & Học kỳ */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <span>Danh sách các năm học và học kỳ lưu trữ:</span>
                  </h4>
                  <span className="text-[11px] text-slate-500 font-medium">
                    (Nhấp vào học kỳ để chuyển đổi ngay)
                  </span>
                </div>

                <div className="mb-3 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center gap-2 text-xs text-blue-900">
                  <Lock className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    <strong>Chế độ khóa bảo vệ:</strong> Mặc định năm hiện hành không khóa, các năm học đã qua được khóa để tránh vô ý thay đổi. Bấm vào nút khóa để bật/tắt theo ý muốn.
                  </span>
                </div>

                <div className="space-y-3">
                  {availableYears.map(year => {
                    const isYearActive = year === currentAcademicYear;
                    const locked = isYearLocked(year);
                    return (
                      <div 
                        key={year}
                        className={`rounded-xl border p-3.5 transition-all ${
                          isYearActive 
                            ? 'border-indigo-300 bg-indigo-50/30 shadow-xs' 
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">
                              Năm học {year}
                            </span>
                            {isYearActive && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Năm hiện tại
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Nút Khóa / Mở khóa cho từng năm học */}
                            <button
                              type="button"
                              onClick={() => handleToggleLockYear(year)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold border flex items-center gap-1.5 transition cursor-pointer ${
                                locked
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 shadow-2xs'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300'
                              }`}
                              title={
                                locked
                                  ? `Năm học ${year} đang KHÓA để bảo vệ dữ liệu. Bấm để mở khóa.`
                                  : `Năm học ${year} đang MỞ (cho phép chỉnh sửa). Bấm để khóa lại.`
                              }
                            >
                              {locked ? (
                                <>
                                  <Lock className="w-3 h-3 text-rose-600" />
                                  <span>Đã khóa</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3 h-3 text-emerald-600" />
                                  <span>Đang mở</span>
                                </>
                              )}
                            </button>

                            {/* Xóa năm học nếu không phải năm hiện hành và có nhiều hơn 1 năm */}
                            {!isYearActive && availableYears.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteYear(year)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition cursor-pointer"
                                title={`Xóa năm học ${year} khỏi danh sách`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Các Học kỳ của năm này */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {AVAILABLE_SEMESTERS.map(sem => {
                            const status = getTermStatus(year, sem);
                            const isActive = status.isCurrent;

                            return (
                              <button
                                key={sem}
                                type="button"
                                onClick={() => {
                                  if (!isActive) {
                                    switchTermDirectly(year, sem);
                                    setIsYearSemesterModalOpen(false);
                                  }
                                }}
                                className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                                  isActive
                                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                                    : status.hasData
                                    ? 'border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-blue-950'
                                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`font-bold text-xs ${isActive ? 'text-white' : 'text-slate-900'}`}>
                                    {sem}
                                  </span>
                                  {isActive ? (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-yellow-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
                                      <Check className="w-3 h-3 stroke-[3]" /> Đang mở
                                    </span>
                                  ) : status.hasData ? (
                                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.2 rounded-full border border-emerald-200">
                                      Đã lưu
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-normal">
                                      Chưa có dữ liệu
                                    </span>
                                  )}
                                </div>

                                <div className="text-[11px] mt-1">
                                  {isActive ? (
                                    <span className="text-blue-100">Đang thao tác chỉnh sửa</span>
                                  ) : status.hasData ? (
                                    <span className="text-blue-700 font-medium">Nhấp để mở dữ liệu đã lưu</span>
                                  ) : (
                                    <span className="text-slate-500 italic flex items-center gap-1">
                                      <Plus className="w-3 h-3" /> Nhấp để tạo mới
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lời khuyên & Cơ chế lưu trữ */}
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950 leading-relaxed space-y-1">
                  <p className="font-semibold">Cơ chế lưu trữ độc lập qua các năm học:</p>
                  <p className="text-slate-600">
                    Mỗi năm học và từng học kỳ được hệ thống lưu trữ phân công hoàn toàn tách biệt. Khi chuyển sang một năm hoặc học kỳ mới, toàn bộ dữ liệu hiện tại của thầy/cô sẽ được tự động ghi nhớ và lưu an toàn, không bị mất mát hay ghi đè.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsYearSemesterModalOpen(false);
                    const nextSem = currentSemester === 'Học kỳ I' ? 'Học kỳ II' : 'Học kỳ I';
                    setTermInitModal({
                      targetYear: currentAcademicYear,
                      targetSemester: nextSem
                    });
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-medium transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                >
                  <Copy className="w-3.5 h-3.5 text-blue-600" />
                  <span>Sao chép phân công sang {currentSemester === 'Học kỳ I' ? 'Học kỳ II' : 'Học kỳ I'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleBackupCurrentYear}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg font-semibold transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                  title={`Tải về tệp sao lưu JSON chứa riêng phân công năm học ${currentAcademicYear}`}
                >
                  <Download className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Sao lưu năm {currentAcademicYear} (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={handleBackupData}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg font-semibold transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                  title="Tải về tệp sao lưu JSON chứa toàn bộ dữ liệu của tất cả các năm học"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Sao lưu tất cả {availableYears.length} năm (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsYearSemesterModalOpen(false);
                    setIsSettingsModalOpen(true);
                  }}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg font-semibold transition cursor-pointer text-xs flex items-center gap-1.5 shadow-2xs"
                  title="Mở giao diện phục hồi dữ liệu từ tệp sao lưu"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-600" />
                  <span>Phục hồi...</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsYearSemesterModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold transition cursor-pointer text-xs shadow-2xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL THÊM NĂM HỌC MỚI */}
      {isAddYearModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[80] animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            <div className="p-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-yellow-300" />
                <h3 className="font-bold text-base">Thêm năm học mới</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddYearModalOpen(false)}
                className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmAddNewYear} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Tên năm học (VD: 2026 – 2027):
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newYearInput}
                  onChange={(e) => setNewYearInput(e.target.value)}
                  placeholder="Ví dụ: 2026 – 2027"
                  className="w-full text-sm py-2 px-3 rounded-lg border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Gợi ý năm học kế tiếp */}
              <div>
                <span className="text-[11px] text-slate-500 font-semibold block mb-1.5">Gợi ý năm học tiếp theo:</span>
                <div className="flex flex-wrap gap-1.5">
                  {['2026 – 2027', '2027 – 2028', '2028 – 2029'].map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => setNewYearInput(yr)}
                      className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-800 rounded-md transition cursor-pointer border border-slate-200"
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-900 leading-relaxed">
                Năm học mới sẽ được thêm vào danh sách lựa chọn trên thanh công cụ và lưu trữ dữ liệu hoàn toàn độc lập với các năm trước.
              </div>

              <div className="pt-2 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddYearModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg font-semibold transition cursor-pointer text-xs shadow-xs"
                >
                  Thêm và Chuyển đến năm này
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[70] animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 bg-rose-50/80 border-b border-rose-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  {deleteConfirmation.title}
                </h3>
                {deleteConfirmation.subtitle && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    {deleteConfirmation.subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-rose-100/60 transition cursor-pointer"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-3.5 text-xs">
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200">
                <div className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <span className="text-rose-600">●</span>
                  <span>{deleteConfirmation.entityName}</span>
                </div>
                {deleteConfirmation.details && deleteConfirmation.details.length > 0 && (
                  <div className="space-y-1.5 text-slate-600 text-xs">
                    {deleteConfirmation.details.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center py-0.5 border-b border-slate-200/60 last:border-b-0">
                        <span className="text-slate-500">{item.label}:</span>
                        <span className="font-semibold text-slate-800">{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Warning Alert */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-900 leading-relaxed font-medium">
                  {deleteConfirmation.warning}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  const onConfirmAction = deleteConfirmation.onConfirm;
                  setDeleteConfirmation(null);
                  onConfirmAction();
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-2xs text-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deleteConfirmation.confirmText || 'Xác nhận xóa'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ĐĂNG NHẬP / QUẢN LÝ QUYỀN ADMIN & ĐỒNG BỘ ĐÁM MÂY */}
      <AdminAuthModal onOpenUserManagement={() => setIsUserManagementModalOpen(true)} />

      {/* MODAL QUẢN LÝ TÀI KHOẢN & PHÂN QUYỀN CHI TIẾT (RBAC 18 QUYỀN) */}
      <UserManagementModal
        isOpen={isUserManagementModalOpen}
        onClose={() => setIsUserManagementModalOpen(false)}
        teachers={teachers}
      />

      {/* POPUP MODAL HƯỚNG DẪN SỬ DỤNG & PHÍM TẮT NHANH */}
      <UserGuideModal 
        isOpen={isUserGuideModalOpen} 
        onClose={() => setIsUserGuideModalOpen(false)} 
      />

      {/* TRUNG TÂM GỬI THỜI KHÓA BIỂU & PHÂN CÔNG CHUYÊN MÔN (GMAIL & ZALO) */}
      <SendScheduleModal
        isOpen={isSendScheduleModalOpen}
        onClose={() => setIsSendScheduleModalOpen(false)}
        teachers={teachers}
        classes={classes}
        assignments={assignments}
        timetableData={activeTimetableData}
        schoolInfo={schoolInfo}
        subjectsConfig={subjectsConfig}
        classSubjectPeriods={classSubjectPeriods}
        onUpdateTeacherContact={handleUpdateTeacherContact}
        onUpdateClassContact={handleUpdateClassContact}
        isAdmin={isAdmin}
      />

    </div>
  );
}
