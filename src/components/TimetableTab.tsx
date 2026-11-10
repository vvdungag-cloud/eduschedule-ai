import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar, Clock, Users, School, Sparkles, RefreshCw, Printer, Download,
  CheckCircle, AlertTriangle, AlertCircle, Search, Filter, ArrowLeftRight,
  Info, Eye, Trash2, Check, X, Shield, BookOpen, Layers, ChevronDown, ChevronRight,
  Lock, Unlock, Ban, SlidersHorizontal, Settings2, Save, Play, Pin, ListFilter,
  Sun, Sunset, Sunrise, FileSpreadsheet, FileText, Link2, CalendarCheck, CalendarX, Split,
  Cloud, KeyRound, Plus, Copy, Send, RotateCcw
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Teacher, ClassModel, normalizeSubjectName } from '../utils/assignmentSolver';
import { useAuth } from '../utils/authContext';
import {
  TimetableData,
  TimetableLesson,
  LockedSlotsConfig,
  DAYS_CONFIG,
  PERIODS_CONFIG,
  SessionMode,
  PeriodConfigItem,
  getPeriodsConfig,
  MORNING_PERIODS_CONFIG,
  AFTERNOON_PERIODS_CONFIG,
  ALL_PERIODS_CONFIG
} from '../utils/timetableTypes';
import { solveTimetable } from '../utils/timetableSolver';
import { TimetableExportModal } from './TimetableExportModal';
import { FixedSlotConstraintModal } from './FixedSlotConstraintModal';

interface TimetableTabProps {
  teachers: Teacher[];
  classes: ClassModel[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  subjectsConfig: { id: string; name?: string; grade10Periods: number; grade11Periods: number; grade12Periods: number }[];
  classSubjectPeriods: Record<string, Record<string, any>>;
  classShifts?: Record<string, string>;
  onUpdateClassShifts?: (shifts: Record<string, string>) => void;
  currentAcademicYear: string;
  currentSemester: string;
  currentTermKey: string;
  isCurrentTermLocked: boolean;
  onNotification?: (msg: string) => void;
  onOpenSendSchedule?: () => void;
}

export const TimetableTab: React.FC<TimetableTabProps> = ({
  teachers,
  classes,
  assignments,
  subjectsConfig,
  classSubjectPeriods,
  classShifts: propClassShifts,
  onUpdateClassShifts,
  currentAcademicYear,
  currentSemester,
  currentTermKey,
  isCurrentTermLocked,
  onNotification,
  onOpenSendSchedule
}) => {
  const { isAdmin, openLoginModal, syncToCloud, isSyncing, lastSyncedAt, currentSchoolId, cloudConnectionStatus } = useAuth();
  const storageKey = `edu_timetable_${currentTermKey}`;

  // Helper kiểm tra và chuẩn hóa TKB (lọc bỏ các tiết Chào cờ & Sinh hoạt lớp tự động chèn cũ nếu có)
  const sanitizeLoadedTimetable = (data: any): TimetableData | null => {
    if (!data || !Array.isArray(data.lessons) || data.lessons.length === 0) return null;
    const cleanLessons = data.lessons.filter((l: any) => {
      if (!l) return false;
      if (l.id?.startsWith('fixed_cc_')) return false;
      if (l.id?.startsWith('fixed_shl_')) return false;
      if (l.subject === 'Sinh hoạt lớp *') return false;
      if (l.isFixed && l.subject === 'Sinh hoạt lớp' && (l.fixedReason === 'Sinh hoạt lớp cuối tuần' || l.fixedReason?.includes('Sinh hoạt lớp'))) return false;
      return true;
    });
    return {
      ...data,
      lessons: cleanLessons,
      stats: {
        ...(data.stats || {}),
        totalLessons: cleanLessons.length
      }
    };
  };

  const isHealthyTimetable = (data: any): boolean => {
    if (!data || !Array.isArray(data.lessons) || data.lessons.length === 0) return false;
    return true;
  };

  // Persistent Timetable State for current term
  const [timetableData, setTimetableData] = useState<TimetableData | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sanitized = sanitizeLoadedTimetable(parsed);
        if (sanitized) {
          if (Array.isArray(parsed?.lessons) && sanitized.lessons.length !== parsed.lessons.length) {
            localStorage.setItem(storageKey, JSON.stringify(sanitized));
            localStorage.setItem('edu_timetable_active', JSON.stringify(sanitized));
          }
          return sanitized;
        }
      }
    } catch (e) {}
    return null;
  });

  // Re-load timetable when term key changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sanitized = sanitizeLoadedTimetable(parsed);
        if (sanitized) {
          if (Array.isArray(parsed?.lessons) && sanitized.lessons.length !== parsed.lessons.length) {
            localStorage.setItem(storageKey, JSON.stringify(sanitized));
            localStorage.setItem('edu_timetable_active', JSON.stringify(sanitized));
            window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: sanitized }));
          }
          setTimetableData(sanitized);
          return;
        }
      }
      setTimetableData(null);
    } catch (e) {}
  }, [storageKey]);

  // Đồng bộ khi có sự kiện nạp dữ liệu từ Cloud (khi bấm Làm mới)
  useEffect(() => {
    const handleCustomPull = (e: any) => {
      if (e.detail?.schedules) {
        const sanitized = sanitizeLoadedTimetable(e.detail.schedules);
        setTimetableData(sanitized);
      }
    };
    window.addEventListener('cloud-data-pulled', handleCustomPull);

    return () => {
      window.removeEventListener('cloud-data-pulled', handleCustomPull);
    };
  }, [storageKey]);

  // Lắng nghe sự kiện cập nhật TKB từ App.tsx (khi phân công thay đổi, xóa, hoặc giải lại)
  useEffect(() => {
    const handleTimetableUpdate = (e: any) => {
      if (e.detail === null) {
        setTimetableData(null);
      } else if (e.detail && Array.isArray(e.detail.lessons)) {
        const sanitized = sanitizeLoadedTimetable(e.detail);
        setTimetableData(sanitized);
      }
    };
    window.addEventListener('edu_timetable_updated', handleTimetableUpdate);
    return () => {
      window.removeEventListener('edu_timetable_updated', handleTimetableUpdate);
    };
  }, []);

  // Save changes and broadcast
  useEffect(() => {
    if (timetableData) {
      localStorage.setItem(storageKey, JSON.stringify(timetableData));
      localStorage.setItem('edu_timetable_active', JSON.stringify(timetableData));
    }
  }, [timetableData, storageKey]);

  // Solver states
  const [isSolving, setIsSolving] = useState(false);
  const [solverNotice, setSolverNotice] = useState<string | null>(null);
  const [infeasibleDiagnostics, setInfeasibleDiagnostics] = useState<any[] | null>(null);

  // View modes: 'by_class' | 'by_teacher' | 'matrix_class' | 'matrix_teacher'
  const [activeView, setActiveView] = useState<'by_class' | 'by_teacher' | 'matrix_class' | 'matrix_teacher'>('by_class');
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Close export dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isExportDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setIsExportDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExportDropdownOpen]);

  // Selected class & teacher
  const [selectedClassId, setSelectedClassId] = useState<string>(() => classes[0]?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(() => teachers[0]?.id || '');

  // Filters & Search
  const [filterGrade, setFilterGrade] = useState<'all' | '10' | '11' | '12'>('all');
  const [teacherSearch, setTeacherSearch] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [isTeacherSearchFocused, setIsTeacherSearchFocused] = useState(false);
  const teacherSearchRef = useRef<HTMLDivElement>(null);

  // Matrix View Filters & Search
  const [matrixClassGradeFilter, setMatrixClassGradeFilter] = useState<'all' | '10' | '11' | '12'>('all');
  const [matrixClassSearch, setMatrixClassSearch] = useState('');
  const [matrixTeacherDepartmentFilter, setMatrixTeacherDepartmentFilter] = useState('all');
  const [matrixTeacherSearch, setMatrixTeacherSearch] = useState('');
  const [matrixTeacherOnlyGaps, setMatrixTeacherOnlyGaps] = useState(false);

  // Crosshair highlight in matrix (highlight cả hàng ngang và cột dọc khi di chuột)
  const [matrixHoveredRow, setMatrixHoveredRow] = useState<string | null>(null);
  const [matrixHoveredCol, setMatrixHoveredCol] = useState<string | null>(null);

  // Close teacher search autocomplete on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (teacherSearchRef.current && !teacherSearchRef.current.contains(e.target as Node)) {
        setIsTeacherSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Manual cell swap / move state
  const [selectedCell, setSelectedCell] = useState<{
    day: number;
    period: number;
    lesson: TimetableLesson | null;
  } | null>(null);

  // Helper chuẩn hóa & mở lại Thứ 2: Thứ 2 là ngày học bình thường, chỉ khóa duy nhất Tiết 1 Chào cờ nếu có (2_1).
  // Tuyệt đối không để sót các khóa tiết 2..10 của ngày Thứ 2 đối với học sinh/lớp.
  const sanitizeLockedSlotsConfig = (config?: LockedSlotsConfig): LockedSlotsConfig => {
    if (!config) return { byClass: {}, byTeacher: {}, byGrade: {}, global: [] };
    const filterMondayClassSlots = (slots: string[] = []) =>
      slots.filter(s => !(s.startsWith('2_') && s !== '2_1'));

    const sanitizedGlobal = filterMondayClassSlots(config.global || []);
    const sanitizedByGrade: Record<string, string[]> = {};
    if (config.byGrade) {
      Object.entries(config.byGrade).forEach(([grade, slots]) => {
        sanitizedByGrade[grade] = filterMondayClassSlots(slots);
      });
    }
    const sanitizedByClass: Record<string, string[]> = {};
    if (config.byClass) {
      Object.entries(config.byClass).forEach(([cId, slots]) => {
        sanitizedByClass[cId] = filterMondayClassSlots(slots);
      });
    }

    const sanitizedExceptions: Record<string, string[]> = {};
    if (config.classBreakExceptions) {
      Object.entries(config.classBreakExceptions).forEach(([cId, slots]) => {
        sanitizedExceptions[cId] = filterMondayClassSlots(slots);
      });
    }

    return {
      global: sanitizedGlobal,
      byGrade: sanitizedByGrade,
      byClass: sanitizedByClass,
      byTeacher: config.byTeacher || {},
      classBreakExceptions: sanitizedExceptions
    };
  };

  // Locked slots state for current term
  const lockedStorageKey = `edu_locked_slots_${currentTermKey}`;
  const [lockedSlots, setLockedSlots] = useState<LockedSlotsConfig>(() => {
    try {
      const saved = localStorage.getItem(lockedStorageKey);
      if (saved) return sanitizeLockedSlotsConfig(JSON.parse(saved));
    } catch (e) {}
    return { byClass: {}, byTeacher: {}, byGrade: {}, global: [] };
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(lockedStorageKey);
      if (saved) setLockedSlots(sanitizeLockedSlotsConfig(JSON.parse(saved)));
      else setLockedSlots({ byClass: {}, byTeacher: {}, byGrade: {}, global: [] });
    } catch (e) {}
  }, [lockedStorageKey]);

  useEffect(() => {
    localStorage.setItem(lockedStorageKey, JSON.stringify(lockedSlots));
  }, [lockedSlots, lockedStorageKey]);

  // a) Custom fixed slots state
  const customFixedStorageKey = `edu_custom_fixed_slots_${currentTermKey}`;
  const [customFixedSlots, setCustomFixedSlots] = useState<Array<{
    id: string;
    classId: string;
    subject: string;
    teacherId: string;
    day: number;
    period: number;
    createdAt?: string;
  }>>(() => {
    try {
      const saved = localStorage.getItem(customFixedStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(customFixedStorageKey);
      if (saved) setCustomFixedSlots(JSON.parse(saved));
      else setCustomFixedSlots([]);
    } catch (e) {}
  }, [customFixedStorageKey]);

  useEffect(() => {
    localStorage.setItem(customFixedStorageKey, JSON.stringify(customFixedSlots));
  }, [customFixedSlots, customFixedStorageKey]);

  // d & e) Teacher Constraints
  const teacherConstraintsStorageKey = `edu_teacher_constraints_${currentTermKey}`;
  const [teacherConstraints, setTeacherConstraints] = useState<Record<string, {
    maxDays?: number;
    maxSessions?: number;
  }>>(() => {
    try {
      const saved = localStorage.getItem(teacherConstraintsStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(teacherConstraintsStorageKey);
      if (saved) setTeacherConstraints(JSON.parse(saved));
      else setTeacherConstraints({});
    } catch (e) {}
  }, [teacherConstraintsStorageKey]);

  useEffect(() => {
    localStorage.setItem(teacherConstraintsStorageKey, JSON.stringify(teacherConstraints));
  }, [teacherConstraints, teacherConstraintsStorageKey]);

  // Modal open states for Common Constraints
  const [isCommonConstraintsOpen, setIsCommonConstraintsOpen] = useState(false);
  const [activeConstraintMainTab, setActiveConstraintMainTab] = useState<'common' | 'all' | 'manage' | 'sync'>('common');
  const [activeConstraintTab, setActiveConstraintTab] = useState<'fixed_slots' | 'class_off' | 'teacher_busy' | 'teacher_days' | 'teacher_sessions' | 'teacher_rules' | 'lesson_rules' | 'subject_rules'>('fixed_slots');

  // Bộ lọc & Tìm kiếm cho tab "Số ngày dạy của GV"
  const [teacherDaysSearch, setTeacherDaysSearch] = useState('');
  const [teacherDaysDept, setTeacherDaysDept] = useState('all');
  const [teacherDaysStatus, setTeacherDaysStatus] = useState<'all' | 'configured'>('all');

  // Bộ lọc & Tìm kiếm cho tab "Số buổi dạy tối đa GV"
  const [teacherSessionsSearch, setTeacherSessionsSearch] = useState('');
  const [teacherSessionsDept, setTeacherSessionsDept] = useState('all');
  const [teacherSessionsStatus, setTeacherSessionsStatus] = useState<'all' | 'configured'>('all');

  // Helper chuẩn hóa mã môn chuẩn của giáo viên (Đồng bộ CNCN / CNNN và các môn khác)
  const getTeacherSubject = useCallback((t: Partial<Teacher> | null | undefined): string => {
    if (!t) return '';
    // Ánh xạ dứt khoát 3 giáo viên CNCN (Công nghệ Công nghiệp)
    if (
      t.id === 't26' || t.id === 't27' || t.id === 't28' ||
      t.name === 'Lâm Mộc Tùng' || t.name === 'Từ Thị Kim Thoa' || t.name === 'Nguyễn Thị Tuyết Nga'
    ) {
      return 'CNCN';
    }
    // Ánh xạ dứt khoát 2 giáo viên CNNN (Công nghệ Nông nghiệp)
    if (
      t.id === 't35' || t.id === 't36' ||
      t.name === 'Huỳnh Ngọc Ý' || t.name === 'Lương Thị Mộng Lành'
    ) {
      return 'CNNN';
    }

    const raw = (
      (t as any).subjectCode ||
      (t as any).teachingSubject ||
      (t as any).monGiangDay ||
      t.specialization ||
      (t as any).subject ||
      (t as any).monDay ||
      (t as any).monHoc ||
      ''
    ).toString().trim();

    if (
      raw === 'CN (Công nghiệp)' ||
      raw === 'Công nghệ (Công nghiệp)' ||
      raw === 'CN' ||
      raw === 'Công nghệ' ||
      raw === 'CNCN'
    ) {
      return 'CNCN';
    }
    if (
      raw === 'CN (Nông nghiệp)' ||
      raw === 'Công nghệ (Nông nghiệp)' ||
      raw === 'CNNN'
    ) {
      return 'CNNN';
    }
    if (raw === 'GD') {
      return 'GDKTPL';
    }

    return raw || 'Chưa phân';
  }, []);

  // Danh sách các tổ bộ môn duy nhất của toàn bộ giáo viên
  const teacherSpecializations = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach(t => {
      const subj = getTeacherSubject(t);
      if (subj && subj.trim()) {
        set.add(subj.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [teachers, getTeacherSubject]);

  // Helper tìm kiếm giáo viên hỗ trợ tiếng Việt có dấu / không dấu / hoa thường
  const matchesTeacherSearch = useCallback((t: Teacher, query: string): boolean => {
    if (!query.trim()) return true;
    const qRaw = query.trim().toLowerCase();
    const qNorm = qRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const qNoSpace = qRaw.replace(/\s+/g, '');
    const qNormNoSpace = qNorm.replace(/\s+/g, '');

    const nameRaw = (t.name || '').toLowerCase();
    const nameNorm = nameRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const nameNoSpace = nameRaw.replace(/\s+/g, '');

    const subj = getTeacherSubject(t);
    const specRaw = (
      subj ||
      t.specialization ||
      (t as any).subject ||
      (t as any).monGiangDay ||
      (t as any).subjectId ||
      (t as any).subjectCode ||
      ''
    ).toLowerCase();
    const specNorm = specRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const specNoSpace = specRaw.replace(/\s+/g, '');
    const specNormNoSpace = specNorm.replace(/\s+/g, '');

    const isCNCN = subj === 'CNCN';
    const isCNNN = subj === 'CNNN';
    const extraNames = isCNCN
      ? 'cong nghe cong nghiep cncn congnghecongnghiep'
      : isCNNN
      ? 'cong nghe nong nghiep cnnn congnghenongnghiep'
      : '';

    return (
      nameRaw.includes(qRaw) ||
      nameNorm.includes(qNorm) ||
      nameNoSpace.includes(qNoSpace) ||
      specRaw.includes(qRaw) ||
      specNorm.includes(qNorm) ||
      specNoSpace.includes(qNoSpace) ||
      specNormNoSpace.includes(qNormNoSpace) ||
      (extraNames ? (extraNames.includes(qRaw) || extraNames.includes(qNorm) || extraNames.includes(qNormNoSpace)) : false)
    );
  }, [getTeacherSubject]);

  // Advanced constraints state corresponding to the user's uploaded lists
  const advancedConstraintsStorageKey = `edu_advanced_constraints_${currentTermKey}`;
  const [advancedConstraints, setAdvancedConstraints] = useState<{
    teacherMaxGaps: number;
    teacherMaxConsecutive: number;
    teacherOnlyOneSession: boolean;
    teacherMinPeriodsPerSession: number;
    teacherNoFirstPeriod: boolean;
    teacherMeetingSubject: string;
    teacherMeetingDay: number;
    teacherMeetingSession: 'morning' | 'afternoon' | 'all';
    teacherMeetingRules?: Array<{
      id: string;
      subject: string;
      day: number;
      session: 'morning' | 'afternoon' | 'all';
    }>;
    lessonDoubleNoSpanRecess: boolean;
    lessonSpacingDays: boolean;
    lessonEndsOnly: string[];
    lessonStartsOnly: string[];
    lessonConsecutiveSubjects: string[];
    lessonSameSessionSubjects: string[];
    lessonNotSameSessionSubjects: string[];
    lessonConsecutivePairs?: Array<{
      id: string;
      subject1: string;
      subject2: string;
      enabled: boolean;
    }>;
    lessonNotSameSessionPairs?: Array<{
      id: string;
      subject1: string;
      subject2: string;
      enabled: boolean;
    }>;
    subjectMaxPerSession: number;
    subjectMaxPeriodsPerSession: number;
    subjectNoRoom: string[];
  }>(() => {
    const defaultConsecutivePairs = [
      { id: 'pair_gddp_gdqpan', subject1: 'GDĐP', subject2: 'GDQPAN', enabled: true }
    ];
    const defaultNotSamePairs = [
      { id: 'pair_gdtc_gdqpan', subject1: 'GDTC', subject2: 'GDQPAN', enabled: true },
      { id: 'pair_gdtc_gddp', subject1: 'GDTC', subject2: 'GDĐP', enabled: true }
    ];

    try {
      const saved = localStorage.getItem(advancedConstraintsStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          teacherMeetingSubject: parsed.teacherMeetingSubject || '',
          teacherMeetingRules: Array.isArray(parsed.teacherMeetingRules) ? parsed.teacherMeetingRules : [],
          lessonConsecutiveSubjects: Array.isArray(parsed.lessonConsecutiveSubjects) ? parsed.lessonConsecutiveSubjects : [],
          lessonSameSessionSubjects: Array.isArray(parsed.lessonSameSessionSubjects) ? parsed.lessonSameSessionSubjects : [],
          lessonNotSameSessionSubjects: Array.isArray(parsed.lessonNotSameSessionSubjects) ? parsed.lessonNotSameSessionSubjects : [],
          lessonConsecutivePairs: Array.isArray(parsed.lessonConsecutivePairs) ? parsed.lessonConsecutivePairs : defaultConsecutivePairs,
          lessonNotSameSessionPairs: Array.isArray(parsed.lessonNotSameSessionPairs) ? parsed.lessonNotSameSessionPairs : defaultNotSamePairs
        };
      }
    } catch (e) {}
    return {
      teacherMaxGaps: 2,
      teacherMaxConsecutive: 3,
      teacherOnlyOneSession: false,
      teacherMinPeriodsPerSession: 1,
      teacherNoFirstPeriod: false,
      teacherMeetingSubject: '',
      teacherMeetingDay: 0,
      teacherMeetingSession: 'all',
      teacherMeetingRules: [],
      lessonDoubleNoSpanRecess: true,
      lessonSpacingDays: true,
      lessonEndsOnly: [],
      lessonStartsOnly: ['Chào cờ'],
      lessonConsecutiveSubjects: ['GDTC'],
      lessonSameSessionSubjects: ['GDTC'],
      lessonNotSameSessionSubjects: [],
      lessonConsecutivePairs: defaultConsecutivePairs,
      lessonNotSameSessionPairs: defaultNotSamePairs,
      subjectMaxPerSession: 4,
      subjectMaxPeriodsPerSession: 2,
      subjectNoRoom: ['Thể dục', 'GDQPAN']
    };
  });

  // State for adding custom pairs in UI
  const [newConsecutivePairSub1, setNewConsecutivePairSub1] = useState('GDĐP');
  const [newConsecutivePairSub2, setNewConsecutivePairSub2] = useState('GDQPAN');
  const [newNotSamePairSub1, setNewNotSamePairSub1] = useState('GDTC');
  const [newNotSamePairSub2, setNewNotSamePairSub2] = useState('GDQPAN');

  useEffect(() => {
    localStorage.setItem(advancedConstraintsStorageKey, JSON.stringify(advancedConstraints));
  }, [advancedConstraints, advancedConstraintsStorageKey]);

  // a) Tạo tiết cố định new states matching design
  const [fixedTabSubView, setFixedTabSubView] = useState<'matrix' | 'table'>('matrix');
  const [fixedTableSubMode, setFixedTableSubMode] = useState<'list' | 'grid'>('grid');
  const [fixedClassId, setFixedClassId] = useState<string>(() => classes[0]?.id || '');
  const [fixedSubject, setFixedSubject] = useState<string>('TNHN2');
  const [fixedTeacherOverride, setFixedTeacherOverride] = useState<string>('');
  const [gridMarkedSlots, setGridMarkedSlots] = useState<Set<string>>(new Set());
  const [selectedConstraintRowIds, setSelectedConstraintRowIds] = useState<Set<string>>(new Set());
  const [bulkFixedGrade, setBulkFixedGrade] = useState<'all' | '10' | '11' | '12'>('all');
  const [bulkFixedSubject, setBulkFixedSubject] = useState<string>(() => subjectsConfig[0]?.id || 'Chào cờ');
  const [bulkFixedDay, setBulkFixedDay] = useState<number>(2);
  const [bulkFixedPeriod, setBulkFixedPeriod] = useState<number>(1);
  const [selectedBatchClasses, setSelectedBatchClasses] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`edu_batch_classes_${currentTermKey}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
      }
    } catch (e) {}
    return new Set(classes.map(c => c.id));
  });

  useEffect(() => {
    try {
      localStorage.setItem(`edu_batch_classes_${currentTermKey}`, JSON.stringify(Array.from(selectedBatchClasses)));
    } catch {}
  }, [selectedBatchClasses, currentTermKey]);

  const [selectedBatchSlots, setSelectedBatchSlots] = useState<Set<string>>(new Set());
  const [selectedBatchSubject, setSelectedBatchSubject] = useState<string>(() => subjectsConfig[0]?.id || 'TNHN2');
  const [isClassDropdownOpen, setIsClassDropdownOpen] = useState(false);
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(() => new Set(['10', '11', '12']));
  const [filterClassConstraint, setFilterClassConstraint] = useState<string>('all');
  const [filterSubjectConstraint, setFilterSubjectConstraint] = useState<string>('all');
  const [filterGradeConstraint, setFilterGradeConstraint] = useState<string>('all');
  const [isVideoGuideOpen, setIsVideoGuideOpen] = useState(false);

  // Sync grid marked slots when selected class or subject changes
  useEffect(() => {
    if (!fixedClassId || !fixedSubject) return;
    const marked = new Set<string>();
    customFixedSlots.forEach(s => {
      if (s.classId === fixedClassId && (s.subject === fixedSubject || normalizeSubjectName(s.subject) === normalizeSubjectName(fixedSubject))) {
        marked.add(`${s.day}_${s.period}`);
      }
    });
    setGridMarkedSlots(marked);
  }, [fixedClassId, fixedSubject, customFixedSlots]);

  // Active selection states for off/busy slots configuration
  const [selectedOffClassId, setSelectedOffClassId] = useState<string>('all');
  const [isCopyOffModalOpen, setIsCopyOffModalOpen] = useState<boolean>(false);
  const [copyOffTargets, setCopyOffTargets] = useState<Set<string>>(new Set());
  const [selectedBusyTeacherId, setSelectedBusyTeacherId] = useState<string>(() => teachers[0]?.id || '');

  // 2 Buổi / ngày (Session mode) states & persistence
  const sessionModeStorageKey = `edu_session_mode_${currentTermKey}`;
  const afternoonPeriodsStorageKey = `edu_afternoon_periods_${currentTermKey}`;
  const classShiftsStorageKey = `edu_class_shifts_${currentTermKey}`;

  const [sessionMode, setSessionMode] = useState<SessionMode>(() => {
    try {
      const saved = localStorage.getItem(sessionModeStorageKey);
      if (saved === 'double' || saved === 'single') return saved;
    } catch (e) {}
    return 'single';
  });

  const [afternoonPeriodsCount, setAfternoonPeriodsCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(afternoonPeriodsStorageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n === 4 || n === 5) return n;
      }
    } catch (e) {}
    return 4;
  });

  const [localClassShifts, setLocalClassShifts] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(classShiftsStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  // Effective class shifts: ưu tiên propClassShifts từ component cha (App.tsx), fallback sang localClassShifts
  const classShifts: Record<string, string> = useMemo(() => {
    if (propClassShifts && Object.keys(propClassShifts).length > 0) {
      return propClassShifts;
    }
    return localClassShifts;
  }, [propClassShifts, localClassShifts]);

  const handleUpdateClassShift = (classId: string, val: string) => {
    const nextShifts = { ...classShifts, [classId]: val };
    setLocalClassShifts(nextShifts);
    try {
      localStorage.setItem(classShiftsStorageKey, JSON.stringify(nextShifts));
    } catch (e) {}
    if (onUpdateClassShifts) {
      onUpdateClassShifts(nextShifts);
    }
  };

  const [sessionFilter, setSessionFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [isSessionConfigModalOpen, setIsSessionConfigModalOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(sessionModeStorageKey, sessionMode);
  }, [sessionMode, sessionModeStorageKey]);

  useEffect(() => {
    localStorage.setItem(afternoonPeriodsStorageKey, afternoonPeriodsCount.toString());
  }, [afternoonPeriodsCount, afternoonPeriodsStorageKey]);

  // Dynamic Periods configuration based on current session mode & auto-detection
  const effectiveSessionMode: SessionMode = useMemo(() => {
    if (sessionMode === 'double') return 'double';
    // Auto-detect if any class has opposite session / afternoon shift or oppPeriods > 0
    const hasOppOrAfternoon = Object.values(classShifts).some(
      s => s === 'morning_main' || s === 'afternoon_main' || s === 'afternoon' || s === 'both'
    ) || classes.some(c => {
      const shift = classShifts[c.id] || (c.grade === '10' ? 'afternoon_main' : 'morning_main');
      if (shift === 'morning_main' || shift === 'afternoon_main' || shift === 'afternoon') return true;
      const classPeriodsObj = classSubjectPeriods[c.id] || classSubjectPeriods[c.name] || {};
      return Object.values(classPeriodsObj).some((v: any) => typeof v === 'object' && v !== null && (v.oppPeriods || 0) > 0);
    });
    return hasOppOrAfternoon ? 'double' : 'single';
  }, [sessionMode, classShifts, classes, classSubjectPeriods]);

  const periodsConfig = useMemo(() => {
    return getPeriodsConfig(effectiveSessionMode, afternoonPeriodsCount);
  }, [effectiveSessionMode, afternoonPeriodsCount]);

  const morningPeriods = useMemo(() => {
    return periodsConfig.filter(p => p.session === 'morning');
  }, [periodsConfig]);

  const afternoonPeriods = useMemo(() => {
    return periodsConfig.filter(p => p.session === 'afternoon');
  }, [periodsConfig]);

  const displayedPeriods = useMemo(() => {
    if (effectiveSessionMode === 'single') return morningPeriods;
    if (sessionFilter === 'morning') return morningPeriods;
    if (sessionFilter === 'afternoon') return afternoonPeriods;
    return periodsConfig;
  }, [effectiveSessionMode, sessionFilter, morningPeriods, afternoonPeriods, periodsConfig]);

  // Lock mode toggle & Manager modal
  const [isLockModeActive, setIsLockModeActive] = useState(false);
  const [isLockManagerOpen, setIsLockManagerOpen] = useState(false);
  const [lockManagerTab, setLockManagerTab] = useState<'global' | 'grade' | 'class' | 'teacher'>('global');
  const [lockManagerGrade, setLockManagerGrade] = useState<'10' | '11' | '12'>('10');
  const [lockManagerClassId, setLockManagerClassId] = useState<string>(() => classes[0]?.id || '');
  const [lockManagerTeacherId, setLockManagerTeacherId] = useState<string>(() => teachers[0]?.id || '');

  // Helper kiểm tra class key alias
  const isClassKeyMatch = useCallback((key: string, cls: ClassModel | null | undefined, classId?: string): boolean => {
    if (!key) return false;
    const normKey = key.trim().toLowerCase().replace(/^c_/, '');
    if (cls) {
      const normId = (cls.id || '').trim().toLowerCase().replace(/^c_/, '');
      const normName = (cls.name || '').trim().toLowerCase().replace(/^c_/, '');
      if (key === cls.id || key === cls.name || normKey === normId || normKey === normName) return true;
    }
    if (classId) {
      const normClassId = classId.trim().toLowerCase().replace(/^c_/, '');
      if (key === classId || normKey === normClassId) return true;
    }
    return false;
  }, []);

  // Lấy toàn bộ các tiết nghỉ của lớp từ mọi khóa alias trong byClass
  const getClassOffSlots = useCallback((targetClass: ClassModel | null | undefined, targetId?: string): string[] => {
    if (!lockedSlots.byClass) return [];
    const slots = new Set<string>();
    Object.entries(lockedSlots.byClass).forEach(([k, arr]) => {
      if (isClassKeyMatch(k, targetClass, targetId) && Array.isArray(arr)) {
        arr.forEach(s => slots.add(s));
      }
    });
    return Array.from(slots);
  }, [lockedSlots.byClass, isClassKeyMatch]);

  // Kiểm tra xem tiết (d_p) của lớp có phải là ngoại lệ (mở lại học bình thường dù khối nghỉ) không
  const isClassBreakException = useCallback((targetClass: ClassModel | null | undefined, targetId?: string, key?: string): boolean => {
    if (!lockedSlots.classBreakExceptions || !key) return false;
    for (const [k, arr] of Object.entries(lockedSlots.classBreakExceptions)) {
      if (isClassKeyMatch(k, targetClass, targetId) && Array.isArray(arr) && arr.includes(key)) {
        return true;
      }
    }
    return false;
  }, [lockedSlots.classBreakExceptions, isClassKeyMatch]);

  // Lấy toàn bộ các tiết ngoại lệ (mở lại học) của lớp
  const getClassBreakExceptions = useCallback((targetClass: ClassModel | null | undefined, targetId?: string): string[] => {
    if (!lockedSlots.classBreakExceptions) return [];
    const slots = new Set<string>();
    Object.entries(lockedSlots.classBreakExceptions).forEach(([k, arr]) => {
      if (isClassKeyMatch(k, targetClass, targetId) && Array.isArray(arr)) {
        arr.forEach(s => slots.add(s));
      }
    });
    return Array.from(slots);
  }, [lockedSlots.classBreakExceptions, isClassKeyMatch]);

  // Detailed check if slot is locked and determine reason (Hợp nhất 3 nguồn: Toàn trường ∪ Theo Khối ∪ Theo Lớp, có tính đến Ngoại lệ Mở lại của lớp)
  const getClassSlotLockInfo = (classId: string, day: number, period: number): { isLocked: boolean; isOverridden?: boolean; reason?: 'global' | 'grade' | 'class'; grade?: string } => {
    // THỨ 2 LÀ NGÀY HỌC BÌNH THƯỜNG:
    // Tuyệt đối không được khóa ngày Thứ 2 cho các lớp (chỉ cho phép khóa duy nhất Tiết 1 Chào cờ nếu có)
    if (day === 2 && period > 1) {
      return { isLocked: false };
    }
    const key = `${day}_${period}`;

    // Nguồn 1: Tiết nghỉ Toàn trường (global)
    if ((lockedSlots.global || []).includes(key)) return { isLocked: true, reason: 'global' };

    const cls = classMap.get(classId) || classes.find(c => c.id === classId || c.name === classId);
    const grade = cls?.grade || (classId.startsWith('10') ? '10' : classId.startsWith('11') ? '11' : '12');

    // Nguồn 2: Tiết nghỉ theo Khối (byGrade - kiểm tra mọi biến thể alias: '10', 'grade_10', 'Khối 10', 'K10')
    if (lockedSlots.byGrade) {
      const gClean = grade.replace(/\D/g, '');
      for (const [gKey, slots] of Object.entries(lockedSlots.byGrade)) {
        if (!Array.isArray(slots)) continue;
        const normKey = gKey.trim().toLowerCase().replace(/\D/g, '');
        if ((normKey === gClean || gKey === grade || gKey === `grade_${grade}`) && slots.includes(key)) {
          // Nếu lớp này đã ghi đè mở lại tiết này (ngoại lệ) -> Không khóa!
          if (isClassBreakException(cls, classId, key)) {
            return { isLocked: false, isOverridden: true, reason: 'grade', grade };
          }
          return { isLocked: true, reason: 'grade', grade };
        }
      }
    }

    // Nguồn 3: Tiết nghỉ riêng của Lớp (byClass - kiểm tra mọi biến thể alias: '10A1', 'c_10A1', tên lớp)
    if (lockedSlots.byClass) {
      const offSlots = getClassOffSlots(cls, classId);
      if (offSlots.includes(key)) {
        return { isLocked: true, reason: 'class' };
      }
    }

    return { isLocked: false };
  };

  const isClassSlotLocked = (classId: string, day: number, period: number): boolean => {
    return getClassSlotLockInfo(classId, day, period).isLocked;
  };

  const isGradeSlotLocked = (grade: string, day: number, period: number): boolean => {
    if (day === 2 && period > 1) return false;
    const key = `${day}_${period}`;
    const gClean = grade.replace(/\D/g, '');
    if (lockedSlots.byGrade) {
      for (const [gKey, slots] of Object.entries(lockedSlots.byGrade)) {
        if (!Array.isArray(slots)) continue;
        const normKey = gKey.trim().toLowerCase().replace(/\D/g, '');
        if ((normKey === gClean || gKey === grade || gKey === `grade_${grade}`) && slots.includes(key)) {
          return true;
        }
      }
    }
    return false;
  };

  const isTeacherSlotLocked = (teacherId: string, day: number, period: number): boolean => {
    const key = `${day}_${period}`;
    return (lockedSlots.byTeacher?.[teacherId] || []).includes(key);
  };

  // Toggle slot lock for grade (applies to all classes in that grade)
  const toggleGradeSlotLock = (grade: '10' | '11' | '12', day: number, period: number) => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    const key = `${day}_${period}`;
    setLockedSlots(prev => {
      const currentList = prev.byGrade?.[grade] || [];
      const isLocked = currentList.includes(key);
      const nextList = isLocked ? currentList.filter(k => k !== key) : [...currentList, key];
      return {
        ...prev,
        byGrade: {
          ...(prev.byGrade || {}),
          [grade]: nextList
        }
      };
    });

    if (timetableData) {
      const classIdsInGrade = new Set(classes.filter(c => c.grade === grade).map(c => c.id));
      setTimetableData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lessons: prev.lessons.filter(l => !(classIdsInGrade.has(l.classId) && l.day === day && l.period === period && !l.isFixed))
        };
      });
    }
  };

  // Batch lock slots for grade
  const batchLockGradeSlots = (grade: '10' | '11' | '12', slotsToAdd: string[]) => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    const cleanSlotsToAdd = slotsToAdd.filter(s => !(s.startsWith('2_') && s !== '2_1'));
    setLockedSlots(prev => {
      const currentList = new Set(prev.byGrade?.[grade] || []);
      cleanSlotsToAdd.forEach(s => currentList.add(s));
      return {
        ...prev,
        byGrade: {
          ...(prev.byGrade || {}),
          [grade]: Array.from(currentList)
        }
      };
    });

    if (timetableData) {
      const classIdsInGrade = new Set(classes.filter(c => c.grade === grade).map(c => c.id));
      const slotsSet = new Set(cleanSlotsToAdd);
      setTimetableData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lessons: prev.lessons.filter(l => !(classIdsInGrade.has(l.classId) && slotsSet.has(`${l.day}_${l.period}`) && !l.isFixed))
        };
      });
    }
  };

  // Clear all locks for a grade
  const clearGradeSlots = (grade: '10' | '11' | '12') => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    setLockedSlots(prev => ({
      ...prev,
      byGrade: {
        ...(prev.byGrade || {}),
        [grade]: []
      }
    }));
  };

  // Toggle slot lock for class
  const toggleClassSlotLock = (classId: string, day: number, period: number) => {
    if (isCurrentTermLocked) {
      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
      if (onNotification) onNotification(msg); else alert(msg);
      return;
    }
    const key = `${day}_${period}`;
    const cls = classMap.get(classId) || classes.find(c =>
      c.id === classId ||
      c.name.trim().toLowerCase() === classId.trim().toLowerCase() ||
      c.id.replace(/^c_/, '').toLowerCase() === classId.replace(/^c_/, '').toLowerCase()
    );

    const existingSlots = getClassOffSlots(cls, classId);
    const isCurrentlyLocked = existingSlots.includes(key);

    if (!isCurrentlyLocked && day === 2 && period > 1) {
      const msg = 'Thứ 2 là ngày học bình thường (chỉ khóa Tiết 1 Chào cờ nếu có). Không thể khóa các tiết 2..10 của Thứ 2 cho học sinh/lớp.';
      if (onNotification) onNotification(msg); else alert(msg);
      return;
    }

    setLockedSlots(prev => {
      const nextByClass = { ...(prev.byClass || {}) };
      const matchingKeys = Object.keys(nextByClass).filter(k => isClassKeyMatch(k, cls, classId));
      if (matchingKeys.length === 0) {
        matchingKeys.push(cls?.id || classId);
      }

      if (isCurrentlyLocked) {
        matchingKeys.forEach(k => {
          if (Array.isArray(nextByClass[k])) {
            nextByClass[k] = nextByClass[k].filter(s => s !== key);
          }
        });
        const targetId = cls?.id || classId;
        nextByClass[targetId] = (nextByClass[targetId] || []).filter(s => s !== key);
      } else {
        const setCls = new Set<string>();
        matchingKeys.forEach(k => {
          (nextByClass[k] || []).forEach(s => setCls.add(s));
          delete nextByClass[k];
        });
        setCls.add(key);
        nextByClass[cls?.id || classId] = Array.from(setCls);
      }

      const updated = {
        ...prev,
        byClass: nextByClass
      };
      try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });

    // Remove any scheduled lesson in this slot if locking
    if (timetableData && !isCurrentlyLocked) {
      setTimetableData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lessons: prev.lessons.filter(l => !(isClassKeyMatch(l.classId, cls, classId) && l.day === day && l.period === period && !l.isFixed))
        };
      });
    }
  };

  // Bật / Tắt ngoại lệ mở lại tiết học cho lớp (ghi đè tiết nghỉ theo Khối)
  const toggleClassBreakException = (classId: string, day: number, period: number) => {
    if (isCurrentTermLocked) {
      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
      if (onNotification) onNotification(msg); else alert(msg);
      return;
    }
    const key = `${day}_${period}`;
    const cls = classMap.get(classId) || classes.find(c =>
      c.id === classId ||
      c.name.trim().toLowerCase() === classId.trim().toLowerCase() ||
      c.id.replace(/^c_/, '').toLowerCase() === classId.replace(/^c_/, '').toLowerCase()
    );

    const existingExceptions = getClassBreakExceptions(cls, classId);
    const isCurrentlyException = existingExceptions.includes(key);

    setLockedSlots(prev => {
      const nextExceptions = { ...(prev.classBreakExceptions || {}) };
      const matchingKeys = Object.keys(nextExceptions).filter(k => isClassKeyMatch(k, cls, classId));
      if (matchingKeys.length === 0) {
        matchingKeys.push(cls?.id || classId);
      }

      if (isCurrentlyException) {
        // Hủy ngoại lệ -> quay lại nghỉ theo Khối
        matchingKeys.forEach(k => {
          if (Array.isArray(nextExceptions[k])) {
            nextExceptions[k] = nextExceptions[k].filter(s => s !== key);
          }
        });
        const targetId = cls?.id || classId;
        nextExceptions[targetId] = (nextExceptions[targetId] || []).filter(s => s !== key);
      } else {
        // Kích hoạt ngoại lệ -> Mở lại cho lớp học bình thường
        const setCls = new Set<string>();
        matchingKeys.forEach(k => {
          (nextExceptions[k] || []).forEach(s => setCls.add(s));
          delete nextExceptions[k];
        });
        setCls.add(key);
        nextExceptions[cls?.id || classId] = Array.from(setCls);
      }

      const updated = {
        ...prev,
        classBreakExceptions: nextExceptions
      };
      try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  // Toggle slot lock for teacher
  const toggleTeacherSlotLock = (teacherId: string, day: number, period: number) => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    const key = `${day}_${period}`;
    setLockedSlots(prev => {
      const currentList = prev.byTeacher?.[teacherId] || [];
      const isLocked = currentList.includes(key);
      const nextList = isLocked ? currentList.filter(k => k !== key) : [...currentList, key];
      return {
        ...prev,
        byTeacher: {
          ...prev.byTeacher,
          [teacherId]: nextList
        }
      };
    });

    if (timetableData) {
      setTimetableData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lessons: prev.lessons.filter(l => !(l.teacherId === teacherId && l.day === day && l.period === period && !l.isFixed))
        };
      });
    }
  };

  // Toggle global slot lock
  const toggleGlobalSlotLock = (day: number, period: number) => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    if (day === 2 && period > 1) {
      alert('Thứ 2 là ngày học bình thường (chỉ khóa Tiết 1 Chào cờ nếu có). Không thể khóa toàn trường các tiết 2..10 của Thứ 2.');
      return;
    }
    const key = `${day}_${period}`;
    setLockedSlots(prev => {
      const currentList = prev.global || [];
      const isLocked = currentList.includes(key);
      const nextGlobal = isLocked ? currentList.filter(k => k !== key) : [...currentList, key];
      return {
        ...prev,
        global: nextGlobal
      };
    });

    if (timetableData) {
      setTimetableData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lessons: prev.lessons.filter(l => !(l.day === day && l.period === period && !l.isFixed))
        };
      });
    }
  };

  const handleClearAllLocks = () => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    if (window.confirm('Bạn có chắc chắn muốn mở khóa tất cả các vị trí đã khóa trên TKB (Toàn trường, Theo Khối, Theo Lớp, Theo GV) không?')) {
      setLockedSlots({ byClass: {}, byTeacher: {}, byGrade: {}, global: [] });
      if (onNotification) onNotification('Đã mở khóa toàn bộ các vị trí trên TKB.');
    }
  };

  const totalLockedCount = useMemo(() => {
    let count = (lockedSlots.global || []).length * classes.length;
    const gradeClassCounts: Record<string, number> = { '10': 0, '11': 0, '12': 0 };
    classes.forEach(c => {
      if (gradeClassCounts[c.grade] !== undefined) {
        gradeClassCounts[c.grade]++;
      }
    });
    Object.entries(lockedSlots.byGrade || {}).forEach(([gr, arr]) => {
      count += arr.length * (gradeClassCounts[gr] || 0);
    });
    Object.values(lockedSlots.byClass || {}).forEach(arr => {
      count += arr.length;
    });
    Object.values(lockedSlots.byTeacher || {}).forEach(arr => {
      count += arr.length;
    });
    return count;
  }, [lockedSlots, classes]);

  // Lookup Maps
  const teacherMap = useMemo(() => {
    const map = new Map<string, Teacher>();
    teachers.forEach(t => map.set(t.id, t));
    return map;
  }, [teachers]);

  const classMap = useMemo(() => {
    const map = new Map<string, ClassModel>();
    classes.forEach(c => map.set(c.id, c));
    return map;
  }, [classes]);

  // Filtered classes & teachers for selectors
  const filteredClasses = useMemo(() => {
    if (filterGrade === 'all') return classes;
    return classes.filter(c => c.grade === filterGrade);
  }, [classes, filterGrade]);

  // Danh sách các Tổ bộ môn động từ giáo viên toàn trường
  const teacherDepartments = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach(t => {
      const subj = getTeacherSubject(t);
      if (subj && subj !== 'Chưa rõ') set.add(subj);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [teachers, getTeacherSubject]);

  // Gợi ý Autocomplete khi gõ tìm kiếm giáo viên (tìm kiếm không phân biệt hoa thường và hỗ trợ tiếng Việt không dấu)
  const teacherSearchSuggestions = useMemo(() => {
    const q = teacherSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').trim();
    if (!q) return [];
    return teachers.filter(t => {
      const subj = getTeacherSubject(t);
      const normName = t.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      const normSubj = subj.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      const normId = t.id.toLowerCase();
      const normPos = (t.position || '').toLowerCase();
      return normName.includes(q) || normSubj.includes(q) || normId.includes(q) || normPos.includes(q);
    }).slice(0, 10);
  }, [teachers, teacherSearch, getTeacherSubject]);

  const handleSelectTeacherFromSearch = useCallback((t: Teacher) => {
    setSelectedTeacherId(t.id);
    const subj = getTeacherSubject(t);
    if (filterDepartment !== 'all' && subj !== filterDepartment) {
      setFilterDepartment('all');
    }
    setTeacherSearch('');
    setIsTeacherSearchFocused(false);
  }, [filterDepartment, getTeacherSubject]);

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').trim();
    return teachers.filter(t => {
      const subj = getTeacherSubject(t);
      const matchesDept = filterDepartment === 'all' || subj === filterDepartment;
      if (!matchesDept) return false;
      if (!q) return true;
      const normName = t.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      const normSubj = subj.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      return normName.includes(q) || normSubj.includes(q) || t.id.toLowerCase().includes(q);
    });
  }, [teachers, teacherSearch, filterDepartment, getTeacherSubject]);

  // Matrix Class: Danh sách lớp đã lọc theo Khối và Tìm kiếm
  const filteredMatrixClasses = useMemo(() => {
    const q = matrixClassSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').trim();
    return classes.filter(cls => {
      if (matrixClassGradeFilter !== 'all' && cls.grade.toString() !== matrixClassGradeFilter) {
        return false;
      }
      if (!q) return true;
      const normName = cls.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      const hrId = assignments.homeroomAssignments[cls.id];
      const hrTeacher = hrId ? teacherMap.get(hrId) : undefined;
      const normHr = (hrTeacher?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      return normName.includes(q) || normHr.includes(q) || cls.id.toLowerCase().includes(q);
    });
  }, [classes, matrixClassGradeFilter, matrixClassSearch, assignments.homeroomAssignments, teacherMap]);

  // Matrix Teacher: Bản đồ phát hiện các ô tiết trống lủng giữa ca học cho từng giáo viên
  const teacherGapCellsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!timetableData?.lessons) return map;

    teachers.forEach(t => {
      const gapSet = new Set<string>();
      DAYS_CONFIG.forEach(d => {
        const dayLessons = timetableData.lessons.filter(l => l.teacherId === t.id && l.day === d.day);
        if (dayLessons.length > 1) {
          // Buổi Sáng (tiết 1 - 5)
          const morningPeriods = dayLessons.filter(l => l.period <= 5).map(l => l.period).sort((a, b) => a - b);
          if (morningPeriods.length > 1) {
            const minM = morningPeriods[0];
            const maxM = morningPeriods[morningPeriods.length - 1];
            for (let p = minM + 1; p < maxM; p++) {
              if (!morningPeriods.includes(p)) {
                gapSet.add(`${d.day}_${p}`);
              }
            }
          }
          // Buổi Chiều (tiết 6 - 10)
          const afternoonPeriods = dayLessons.filter(l => l.period >= 6).map(l => l.period).sort((a, b) => a - b);
          if (afternoonPeriods.length > 1) {
            const minA = afternoonPeriods[0];
            const maxA = afternoonPeriods[afternoonPeriods.length - 1];
            for (let p = minA + 1; p < maxA; p++) {
              if (!afternoonPeriods.includes(p)) {
                gapSet.add(`${d.day}_${p}`);
              }
            }
          }
        }
      });
      if (gapSet.size > 0) {
        map.set(t.id, gapSet);
      }
    });

    return map;
  }, [teachers, timetableData]);

  const teachersWithGapsCount = useMemo(() => {
    return teacherGapCellsMap.size;
  }, [teacherGapCellsMap]);

  // Danh sách Bộ môn kèm số lượng GV cho bộ lọc Ma trận GV
  const matrixTeacherDepartments = useMemo(() => {
    const countMap = new Map<string, number>();
    teachers.forEach(t => {
      const subj = getTeacherSubject(t);
      if (subj && subj !== 'Chưa rõ') {
        countMap.set(subj, (countMap.get(subj) || 0) + 1);
      }
    });
    return Array.from(countMap.entries())
      .map(([dept, count]) => ({ dept, count }))
      .sort((a, b) => a.dept.localeCompare(b.dept, 'vi'));
  }, [teachers, getTeacherSubject]);

  // Danh sách Giáo viên đã lọc cho Ma trận GV
  const filteredMatrixTeachers = useMemo(() => {
    const q = matrixTeacherSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').trim();
    return teachers.filter(t => {
      const subj = getTeacherSubject(t);
      const matchesDept = matrixTeacherDepartmentFilter === 'all' || subj === matrixTeacherDepartmentFilter;
      if (!matchesDept) return false;

      if (matrixTeacherOnlyGaps && !teacherGapCellsMap.has(t.id)) {
        return false;
      }

      if (!q) return true;
      const normName = t.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      const normSubj = subj.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd');
      return normName.includes(q) || normSubj.includes(q) || t.id.toLowerCase().includes(q);
    });
  }, [teachers, matrixTeacherSearch, matrixTeacherDepartmentFilter, matrixTeacherOnlyGaps, getTeacherSubject, teacherGapCellsMap]);

  // Color mapping by subject
  const getSubjectColorClass = (subject: string): { bg: string; text: string; border: string; badge: string } => {
    const s = (subject || '').trim();
    if (s === 'Chào cờ') {
      return { bg: 'bg-red-50 hover:bg-red-100', text: 'text-red-800', border: 'border-red-300', badge: 'bg-red-600 text-white' };
    }
    if (s === 'Sinh hoạt lớp' || s === 'SHL') {
      return { bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', badge: 'bg-amber-600 text-white' };
    }
    if (s.includes('Toán')) {
      return { bg: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', badge: 'bg-blue-600 text-white' };
    }
    if (s.includes('Văn')) {
      return { bg: 'bg-emerald-50 hover:bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', badge: 'bg-emerald-600 text-white' };
    }
    if (s.includes('Anh') || s.includes('Ngoại ngữ')) {
      return { bg: 'bg-violet-50 hover:bg-violet-100', text: 'text-violet-800', border: 'border-violet-200', badge: 'bg-violet-600 text-white' };
    }
    if (s.includes('Lý')) {
      return { bg: 'bg-cyan-50 hover:bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200', badge: 'bg-cyan-600 text-white' };
    }
    if (s.includes('Hóa')) {
      return { bg: 'bg-indigo-50 hover:bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200', badge: 'bg-indigo-600 text-white' };
    }
    if (s.includes('Sinh')) {
      return { bg: 'bg-teal-50 hover:bg-teal-100', text: 'text-teal-800', border: 'border-teal-200', badge: 'bg-teal-600 text-white' };
    }
    if (s.includes('Sử')) {
      return { bg: 'bg-orange-50 hover:bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', badge: 'bg-orange-600 text-white' };
    }
    if (s.includes('Địa')) {
      return { bg: 'bg-lime-50 hover:bg-lime-100', text: 'text-lime-800', border: 'border-lime-200', badge: 'bg-lime-600 text-white' };
    }
    if (s.includes('GDKTPL') || s.includes('GD')) {
      return { bg: 'bg-rose-50 hover:bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', badge: 'bg-rose-600 text-white' };
    }
    if (s.includes('Tin')) {
      return { bg: 'bg-sky-50 hover:bg-sky-100', text: 'text-sky-800', border: 'border-sky-200', badge: 'bg-sky-600 text-white' };
    }
    if (s.includes('CN')) {
      return { bg: 'bg-stone-50 hover:bg-stone-100', text: 'text-stone-800', border: 'border-stone-200', badge: 'bg-stone-600 text-white' };
    }
    if (s.includes('GDTC') || s.includes('Thể dục')) {
      return { bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', badge: 'bg-amber-600 text-white' };
    }
    if (s.includes('GDQP') || s.includes('QPAN')) {
      return { bg: 'bg-green-50 hover:bg-green-100', text: 'text-green-800', border: 'border-green-200', badge: 'bg-green-600 text-white' };
    }
    return { bg: 'bg-purple-50 hover:bg-purple-100', text: 'text-purple-800', border: 'border-purple-200', badge: 'bg-purple-600 text-white' };
  };

  const parseSubjectSessionConfig = (val: any, defaultPeriod = 2, subjectId?: string, classShift?: string) => {
    if (typeof val === 'object' && val !== null) {
      const normSub = subjectId ? normalizeSubjectName(subjectId) : '';
      const isTraiBuoiByDefault = normSub === 'GDQPAN' || normSub === 'GDĐP' || normSub === 'GDTC';
      let mP = val.mainPeriods ?? 0;
      let oP = val.oppPeriods ?? 0;
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
        singleSessionOnly: val.singleSessionOnly ?? false
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
      singleSessionOnly: false
    };
  };

  // Helper lấy cấu hình số tiết của lớp qua tất cả các bí danh (c.id, cleanId, prefixedId, c.name)
  const getClassPeriodsObj = (classId: string) => {
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetClass = classes.find(c => c.id === classId || c.name === classId || c.id === prefixedId || c.name === cleanId);
    return classSubjectPeriods[classId] || classSubjectPeriods[cleanId] || classSubjectPeriods[prefixedId] || (targetClass ? (classSubjectPeriods[targetClass.id] || classSubjectPeriods[targetClass.name]) : null) || null;
  };

  // Helper tính chuẩn hóa Tổng số tiết của lớp = Chính khóa + Trái buổi (đồng bộ 100% với Bảng phân công & Khai báo số tiết)
  const getClassDeclaredTotal = (classId: string, gradeInput?: '10' | '11' | '12') => {
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetClass = classes.find(c => c.id === classId || c.name === classId || c.id === prefixedId || c.name === cleanId);
    const grade = gradeInput || targetClass?.grade || (classId.startsWith('10') ? '10' : classId.startsWith('11') ? '11' : '12');
    const classObj = getClassPeriodsObj(classId);

    let mainTotal = 0;
    let oppTotal = 0;
    const subjectPeriodsMap: Record<string, number> = {};

    const canonicalSubs = subjectsConfig.map(s => {
      const def = grade === '10' ? s.grade10Periods : grade === '11' ? s.grade11Periods : s.grade12Periods;
      return { id: s.id, name: s.name, defaultPeriods: def };
    });

    const hasCustomConfig = !!classObj && Object.keys(classObj).length > 0;
    const shift = classShifts[classId] || classShifts[cleanId] || (targetClass ? classShifts[targetClass.id] : '') || 'morning_main';

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
          if (main === 0 && opp === 0) isRemoved = true;
        } else if (typeof val === 'number') {
          main = Math.max(0, Number(val) || 0);
          opp = 0;
          isRemoved = (main === 0);
        } else {
          isRemoved = true;
        }
      } else {
        if (hasCustomConfig) {
          main = 0;
          opp = 0;
          isRemoved = true;
        } else {
          if ((grade === '12' || grade === '11') && (norm === 'CNCN' || norm === 'CNNN')) {
            main = 0;
            opp = 0;
            isRemoved = true;
          } else {
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
      subjectPeriodsMap[sub.id] = total;
      subjectPeriodsMap[norm] = total;
    });

    return {
      mainTotal,
      oppTotal,
      totalPeriods: mainTotal + oppTotal,
      subjectPeriodsMap
    };
  };

  // Helper to get periods requirement for a class-subject
  const getSubjectPeriod = (subject: string, grade: '10' | '11' | '12', classId: string): number => {
    const summary = getClassDeclaredTotal(classId, grade);
    const normTarget = normalizeSubjectName(subject);
    const p = summary.subjectPeriodsMap[normTarget] ?? summary.subjectPeriodsMap[subject];
    if (p !== undefined) return p;
    const config = subjectsConfig.find(s => s.id === subject || s.name === subject || normalizeSubjectName(s.id) === normTarget);
    if (!config) return 2;
    if (grade === '10') return config.grade10Periods;
    if (grade === '11') return config.grade11Periods;
    return config.grade12Periods;
  };

  // Helper tra cứu giáo viên được phân công bộ môn chuẩn hóa (đồng bộ 100% với Bảng phân công giảng dạy)
  const getNormalizedAssignedTeacherId = (classId: string, subjectId: string): string | undefined => {
    const cleanId = classId.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const targetCls = classes.find(c => c.id === classId || c.name === classId || c.id === cleanId || c.name === cleanId || c.id === prefixedId);

    // Môn nào có 0 tiết trong khai báo của lớp: không trả về giáo viên
    if (targetCls && getSubjectPeriod(subjectId, targetCls.grade, targetCls.id) === 0) {
      return undefined;
    }

    const row = assignments.subjectAssignments?.[classId]
      || assignments.subjectAssignments?.[cleanId]
      || assignments.subjectAssignments?.[prefixedId]
      || (targetCls?.name ? assignments.subjectAssignments?.[targetCls.name] : undefined);

    const getHomeroomId = () => {
      return assignments.homeroomAssignments?.[classId]
        || assignments.homeroomAssignments?.[cleanId]
        || assignments.homeroomAssignments?.[prefixedId]
        || (targetCls?.name ? assignments.homeroomAssignments?.[targetCls.name] : undefined);
    };

    if (!row) {
      if (subjectId === 'TNHN2' || subjectId === 'TNHN') {
        return getHomeroomId();
      }
      return undefined;
    }
    if (row[subjectId]) return row[subjectId];

    const normTarget = normalizeSubjectName(subjectId);
    if (row[normTarget]) return row[normTarget];

    // Check all keys in row by normalizing
    for (const [key, val] of Object.entries(row)) {
      if (!val) continue;
      if (normalizeSubjectName(key) === normTarget) {
        return val;
      }
    }

    if (normTarget === 'CNCN') return row['CNCN'] || row['CN (Công nghiệp)'] || row['Công nghệ (Công nghiệp)'] || row['CN'] || row['Công nghệ'];
    if (normTarget === 'CNNN') return row['CNNN'] || row['CN (Nông nghiệp)'] || row['Công nghệ (Nông nghiệp)'];
    if (normTarget === 'GDKTPL') return row['GDKTPL'] || row['GD'] || row['GDCD'] || row['Kinh tế & Pháp luật'];
    if (normTarget === 'GDQPAN') return row['GDQPAN'] || row['GD QP-AN'] || row['GDQP'] || row['QPAN'];
    if (normTarget === 'Anh') return row['Anh'] || row['Tiếng Anh'] || row['Ngoại ngữ'];
    if (normTarget === 'Lý') return row['Lý'] || row['Vật lí'] || row['Vật lý'];
    if (normTarget === 'Hóa') return row['Hóa'] || row['Hóa học'];
    if (normTarget === 'Sinh') return row['Sinh'] || row['Sinh học'];
    if (normTarget === 'Sử') return row['Sử'] || row['Lịch sử'];
    if (normTarget === 'Địa') return row['Địa'] || row['Địa lí'] || row['Địa lý'];
    if (normTarget === 'Tin') return row['Tin'] || row['Tin học'];
    if (normTarget === 'Văn') return row['Văn'] || row['Ngữ văn'];
    if (normTarget === 'GDTC') return row['GDTC'] || row['Thể dục'];
    if (normTarget === 'GDĐP') return row['GDĐP'] || row['GDDP'] || row['Giáo dục địa phương'];
    if (normTarget === 'TNHN1') return row['TNHN1'] || row['HĐTN1'] || row['TNHN'];
    if (normTarget === 'TNHN2') return row['TNHN2'] || row['HĐTN2'] || row['SHL'] || getHomeroomId();

    // Fallback for TNHN2: 100% assigned to Homeroom Teacher in GDPT 2018
    if (subjectId === 'TNHN2' || normTarget === 'TNHN2') {
      return getHomeroomId();
    }

    return undefined;
  };

  // Reconcile timetableData whenever assignments prop changes
  useEffect(() => {
    if (!timetableData || !Array.isArray(timetableData.lessons)) return;
    const hasAnyAssignment = Object.keys(assignments.homeroomAssignments || {}).length > 0 ||
      Object.values(assignments.subjectAssignments || {}).some(m => Object.keys(m || {}).length > 0);

    if (!hasAnyAssignment) {
      setTimetableData(null);
      try {
        localStorage.removeItem(storageKey);
        localStorage.removeItem('edu_timetable_active');
      } catch {}
      window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: null }));
      return;
    }

    let changed = false;
    const updatedLessons: TimetableLesson[] = [];

    for (const l of timetableData.lessons) {
      if (l.subject === 'Chào cờ' || l.subject === 'Sinh hoạt lớp') {
        const cleanId = l.classId.replace(/^c_/, '');
        const currentHrId = assignments.homeroomAssignments?.[l.classId] || assignments.homeroomAssignments?.[cleanId];
        if (currentHrId && currentHrId !== l.teacherId) {
          const tObj = teachers.find(t => t.id === currentHrId);
          changed = true;
          updatedLessons.push({
            ...l,
            teacherId: currentHrId,
            teacherName: tObj?.name || 'GVCN'
          });
        } else {
          updatedLessons.push(l);
        }
      } else {
        const assignedTid = getNormalizedAssignedTeacherId(l.classId, l.subject);
        if (!assignedTid) {
          // Phân công đã bị xóa hoặc 0 tiết: gỡ khỏi ma trận
          changed = true;
          continue;
        } else if (assignedTid !== l.teacherId) {
          // Phân công đổi giáo viên: cập nhật giáo viên mới
          const tObj = teachers.find(t => t.id === assignedTid);
          changed = true;
          updatedLessons.push({
            ...l,
            teacherId: assignedTid,
            teacherName: tObj?.name || 'Giáo viên'
          });
        } else {
          updatedLessons.push(l);
        }
      }
    }

    if (changed) {
      const reconciled = { ...timetableData, lessons: updatedLessons };
      setTimetableData(reconciled);
      try {
        localStorage.setItem(storageKey, JSON.stringify(reconciled));
        localStorage.setItem('edu_timetable_active', JSON.stringify(reconciled));
      } catch {}
      window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: reconciled }));
    }
  }, [assignments, teachers]);

  // Handle Automatic Timetable Generation via OR-Tools CP-SAT or TS engine
  const handleSolveTimetable = async () => {
    if (!isAdmin) {
      if (onNotification) {
        onNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" ở góc trên bên phải để chạy thuật toán xếp TKB!');
      }
      openLoginModal();
      return;
    }

    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA để bảo vệ dữ liệu. Vui lòng mở khóa trên thanh tiêu đề nếu cần xếp lại Thời khóa biểu.`);
      return;
    }

    // Check if assignments exist
    const hasAssignments = Object.keys(assignments.homeroomAssignments).length > 0 ||
      Object.values(assignments.subjectAssignments).some(m => Object.keys(m).length > 0);

    if (!hasAssignments) {
      alert('⚠️ Chưa có dữ liệu phân công giảng dạy hoặc phân công chủ nhiệm. Vui lòng hoàn thành phân công tại tab "Bảng phân công" trước khi xếp Thời khóa biểu.');
      return;
    }

    setIsSolving(true);
    setSolverNotice('Đang khởi động mô hình Google OR-Tools CP-SAT để lập lịch tối ưu (đảm bảo xếp đủ 100% tiết)...');
    setInfeasibleDiagnostics(null);

    // Chuẩn hóa và làm sạch bảng phân công: đảm bảo mọi môn học khớp chính xác danh mục môn và giáo viên phân công
    const cleanSubjectAssignments: Record<string, Record<string, string>> = {};
    const cleanHomeroomAssignments: Record<string, string> = {};

    // Đồng bộ 2 chiều danh mục lớp với thông tin GVCN mới nhất từ assignments
    const effectiveClasses = classes.map(c => {
      const cleanId = c.id.replace(/^c_/, '');
      const hrId = assignments.homeroomAssignments?.[c.id]
        || assignments.homeroomAssignments?.[cleanId]
        || assignments.homeroomAssignments?.[c.id.startsWith('c_') ? c.id : `c_${cleanId}`]
        || (c.name ? assignments.homeroomAssignments?.[c.name] : undefined)
        || c.homeroomTeacherId;
      return {
        ...c,
        homeroomTeacherId: hrId || undefined
      };
    });

    effectiveClasses.forEach(c => {
      cleanSubjectAssignments[c.id] = {};
      const cleanId = c.id.replace(/^c_/, '');
      const hrId = c.homeroomTeacherId;
      if (hrId) {
        cleanHomeroomAssignments[c.id] = hrId;
        cleanHomeroomAssignments[cleanId] = hrId;
        cleanHomeroomAssignments[`c_${cleanId}`] = hrId;
        if (c.name) cleanHomeroomAssignments[c.name] = hrId;
      }

      subjectsConfig.forEach(s => {
        const tId = getNormalizedAssignedTeacherId(c.id, s.id);
        if (tId) {
          cleanSubjectAssignments[c.id][s.id] = tId;
        }
      });
      cleanSubjectAssignments[cleanId] = cleanSubjectAssignments[c.id];
      if (c.name) cleanSubjectAssignments[c.name] = cleanSubjectAssignments[c.id];
    });

    const normalizedAssignments = {
      homeroomAssignments: cleanHomeroomAssignments,
      subjectAssignments: cleanSubjectAssignments
    };

    const isHomeroomFixedSubject = (sub: string) =>
      sub === 'Chào cờ' || sub === 'Sinh hoạt lớp' || sub === 'TNHN2';

    // Làm sạch customFixedSlots: loại bỏ các tiết có môn không còn được phân công, và cập nhật giáo viên mới
    const reconciledCustomFixedSlots = customFixedSlots.filter(s => {
      if (isHomeroomFixedSubject(s.subject)) return true;
      const tid = getNormalizedAssignedTeacherId(s.classId, s.subject);
      return Boolean(tid);
    }).map(s => {
      if (isHomeroomFixedSubject(s.subject)) {
        const cleanId = s.classId.replace(/^c_/, '');
        const hrId = cleanHomeroomAssignments[s.classId]
          || cleanHomeroomAssignments[cleanId]
          || effectiveClasses.find(c => c.id === s.classId || c.id === cleanId)?.homeroomTeacherId;
        return hrId ? { ...s, teacherId: hrId } : s;
      }
      const tid = getNormalizedAssignedTeacherId(s.classId, s.subject);
      return tid ? { ...s, teacherId: tid } : s;
    });

    // Cập nhật lại customFixedSlots state và storage để đồng bộ 2 chiều
    setCustomFixedSlots(reconciledCustomFixedSlots);
    try {
      localStorage.setItem(customFixedStorageKey, JSON.stringify(reconciledCustomFixedSlots));
    } catch (e) {}

    // Trích xuất tường minh cấu hình số buổi tối đa & số ngày tối đa cho từng giáo viên (dùng chung cho cả try và catch)
    const maxSessionsPerTeacher: Record<string, number> = {};
    const maxDaysPerTeacher: Record<string, number> = {};
    if (teacherConstraints) {
      Object.entries(teacherConstraints).forEach(([tid, conf]) => {
        const sVal = Number(conf?.maxSessions);
        if (!isNaN(sVal) && sVal > 0) {
          maxSessionsPerTeacher[tid] = sVal;
        }
        const dVal = Number(conf?.maxDays);
        if (!isNaN(dVal) && dVal > 0) {
          maxDaysPerTeacher[tid] = dVal;
        }
      });
    }

    try {
      const subjectRequirements = classes.map(c => {
        const classPeriodsObj = getClassPeriodsObj(c.id) || {};
        const rawShift = classShifts[c.id] || (c.grade === '10' ? 'afternoon_main' : 'morning_main');
        const classReqSubs = subjectsConfig.map(s => {
          const total = getSubjectPeriod(s.id, c.grade, c.id);
          if (total === 0) {
            return {
              name: s.id,
              periods: 0,
              mainPeriods: 0,
              oppPeriods: 0,
              mainMinPairs: 0,
              oppMinPairs: 0
            };
          }
          const normS = normalizeSubjectName(s.id);
          let rawVal = classPeriodsObj[s.id]
            ?? (s.name ? classPeriodsObj[s.name] : undefined)
            ?? classPeriodsObj[normS];
          if (rawVal === undefined) {
            for (const [k, v] of Object.entries(classPeriodsObj)) {
              if (normalizeSubjectName(k) === normS) {
                rawVal = v;
                break;
              }
            }
          }
          const config = parseSubjectSessionConfig(rawVal, total, s.id, rawShift);
          return {
            name: s.id,
            periods: total,
            mainPeriods: config.mainPeriods,
            oppPeriods: config.oppPeriods,
            mainMinPairs: config.mainMinPairs,
            oppMinPairs: config.oppMinPairs
          };
        });

        // VietSchool Super-period: BẮT BUỘC GDQPAN, GDĐP và GDTC học TRÁI BUỔI (OFF-SHIFT):
        // Khối 10: học sáng trái buổi; Khối 11 & 12: học chiều trái buổi
        const qpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDQPAN');
        const dpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDĐP');
        if (qpSubReq && dpSubReq && qpSubReq.periods > 0 && dpSubReq.periods > 0) {
          qpSubReq.mainPeriods = 0;
          qpSubReq.oppPeriods = 1;
          dpSubReq.mainPeriods = 0;
          dpSubReq.oppPeriods = 1;
        }

        const gdtcSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDTC');
        if (gdtcSubReq && gdtcSubReq.periods > 0) {
          gdtcSubReq.mainPeriods = 0;
          gdtcSubReq.oppPeriods = gdtcSubReq.periods;
          gdtcSubReq.oppMinPairs = Math.floor(gdtcSubReq.periods / 2);
        }

        return {
          classId: c.id,
          className: c.name,
          grade: c.grade,
          subjects: classReqSubs
        };
      });

      const fixedConfig = {
        chaoCoDay: 2,
        chaoCoPeriod: 1,
        sinhHoatDay: 7,
        sinhHoatPeriod: 5
      };

      const cleanLockedSlots = sanitizeLockedSlotsConfig(lockedSlots);
      const totalDeclaredAcrossSchool = classes.reduce((sum, c) => {
        return sum + getClassDeclaredTotal(c.id, c.grade).totalPeriods;
      }, 0);


      // Call backend API (runs Python OR-Tools CP-SAT or fallback TS engine)
      const res = await fetch('/api/timetable/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teachers,
          classes: effectiveClasses,
          assignments: normalizedAssignments,
          subjectRequirements,
          sessionMode: effectiveSessionMode,
          afternoonPeriodsCount,
          classShifts,
          fixedConfig,
          lockedSlots: cleanLockedSlots,
          customFixedSlots: reconciledCustomFixedSlots,
          teacherConstraints,
          maxSessionsPerTeacher,
          teacherMaxHalfDays: maxSessionsPerTeacher,
          maxDaysPerTeacher,
          advancedConstraints,
          academicYear: currentAcademicYear,
          semester: currentSemester,
          preferOrtools: true
        })
      });

      if (res.status === 400) {
        const errorData = await res.json();
        if (errorData.status === 'INFEASIBLE') {
          setInfeasibleDiagnostics(errorData.diagnostics || []);
          setSolverNotice(`❌ Không thể xếp Thời khóa biểu hoàn chỉnh do kẹt lịch hoặc phân công quá tải (Xung đột ràng buộc cứng).`);
          if (onNotification) onNotification(`❌ Không thể xếp Thời khóa biểu do xung đột cấu hình phân công.`);
          return;
        }
      }

      if (!res.ok) {
        throw new Error('Máy chủ không thể hoàn thành giải thuật xếp TKB.');
      }

      const result: TimetableData = await res.json();
      setTimetableData(result);
      window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: result }));
      if (effectiveSessionMode === 'double' && sessionMode !== 'double') {
        setSessionMode('double');
      }

      const solverName = result.stats.solverUsed === 'ortools_cp_sat'
        ? 'Google OR-Tools CP-SAT'
        : 'EduSchedule AI Constraint Engine';

      const totalPlaced = result.lessons.length;
      const pct = totalDeclaredAcrossSchool > 0
        ? Math.round((totalPlaced / totalDeclaredAcrossSchool) * 100)
        : 100;

      const msg = `✅ Sắp xếp Thời khóa biểu thành công bằng ${solverName} (${result.stats.executionTimeMs}ms)! Đã xếp ${totalPlaced.toLocaleString('vi-VN')}/${totalDeclaredAcrossSchool.toLocaleString('vi-VN')} tiết (${pct}%), 0 trùng tiết, bảo đảm ngày Thứ 2 và các vị trí đã khóa.`;
      setSolverNotice(msg);
      if (onNotification) onNotification(msg);
    } catch (err: any) {
      console.warn('Lỗi gọi API, chạy trực tiếp bộ giải CP-SAT Constraint Engine phía Client:', err);
      // Fallback directly on client to guarantee 100% success
      const subjectRequirements = classes.map(c => {
        const classPeriodsObj = getClassPeriodsObj(c.id) || {};
        const rawShift = classShifts[c.id] || (c.grade === '10' ? 'afternoon_main' : 'morning_main');
        const classReqSubs = subjectsConfig.map(s => {
          const total = getSubjectPeriod(s.id, c.grade, c.id);
          if (total === 0) {
            return {
              name: s.id,
              periods: 0,
              mainPeriods: 0,
              oppPeriods: 0,
              mainMinPairs: 0,
              oppMinPairs: 0
            };
          }
          const normS = normalizeSubjectName(s.id);
          let rawVal = classPeriodsObj[s.id]
            ?? (s.name ? classPeriodsObj[s.name] : undefined)
            ?? classPeriodsObj[normS];
          if (rawVal === undefined) {
            for (const [k, v] of Object.entries(classPeriodsObj)) {
              if (normalizeSubjectName(k) === normS) {
                rawVal = v;
                break;
              }
            }
          }
          const config = parseSubjectSessionConfig(rawVal, total, s.id, rawShift);
          return {
            name: s.id,
            periods: total,
            mainPeriods: config.mainPeriods,
            oppPeriods: config.oppPeriods,
            mainMinPairs: config.mainMinPairs,
            oppMinPairs: config.oppMinPairs
          };
        });

        // VietSchool Super-period: BẮT BUỘC GDQPAN, GDĐP và GDTC học TRÁI BUỔI (OFF-SHIFT):
        // Khối 10: học sáng trái buổi; Khối 11 & 12: học chiều trái buổi
        const qpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDQPAN');
        const dpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDĐP');
        if (qpSubReq && dpSubReq && qpSubReq.periods > 0 && dpSubReq.periods > 0) {
          qpSubReq.mainPeriods = 0;
          qpSubReq.oppPeriods = 1;
          dpSubReq.mainPeriods = 0;
          dpSubReq.oppPeriods = 1;
        }

        const gdtcSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDTC');
        if (gdtcSubReq && gdtcSubReq.periods > 0) {
          gdtcSubReq.mainPeriods = 0;
          gdtcSubReq.oppPeriods = gdtcSubReq.periods;
          gdtcSubReq.oppMinPairs = Math.floor(gdtcSubReq.periods / 2);
        }

        return {
          classId: c.id,
          className: c.name,
          grade: c.grade,
          subjects: classReqSubs
        };
      });

      const cleanLockedSlots = sanitizeLockedSlotsConfig(lockedSlots);
      const totalDeclaredAcrossSchool = classes.reduce((sum, c) => {
        return sum + getClassDeclaredTotal(c.id, c.grade).totalPeriods;
      }, 0);

      const fallbackResult = solveTimetable({
        teachers,
        classes: effectiveClasses,
        assignments: normalizedAssignments,
        subjectRequirements,
        sessionMode: effectiveSessionMode,
        afternoonPeriodsCount,
        classShifts,
        fixedConfig: { chaoCoDay: 2, chaoCoPeriod: 1, sinhHoatDay: 7, sinhHoatPeriod: 5 },
        lockedSlots: cleanLockedSlots,
        customFixedSlots: reconciledCustomFixedSlots,
        teacherConstraints,
        maxSessionsPerTeacher,
        teacherMaxHalfDays: maxSessionsPerTeacher,
        maxDaysPerTeacher,
        advancedConstraints
      });

      setTimetableData(fallbackResult);
      window.dispatchEvent(new CustomEvent('edu_timetable_updated', { detail: fallbackResult }));
      if (effectiveSessionMode === 'double' && sessionMode !== 'double') {
        setSessionMode('double');
      }

      const totalPlaced = fallbackResult.lessons.length;
      const pct = totalDeclaredAcrossSchool > 0
        ? Math.round((totalPlaced / totalDeclaredAcrossSchool) * 100)
        : 100;

      const msg = `✅ Sắp xếp Thời khóa biểu thành công với Bộ giải CP-SAT Constraint Engine (${fallbackResult.stats.executionTimeMs}ms)! Đã xếp ${totalPlaced.toLocaleString('vi-VN')}/${totalDeclaredAcrossSchool.toLocaleString('vi-VN')} tiết (${pct}%), 0 trùng tiết, bảo đảm ngày Thứ 2 và các vị trí đã khóa.`;
      setSolverNotice(msg);
      if (onNotification) onNotification(msg);
    } finally {
      setIsSolving(false);
    }
  };

  // Tự động sắp xếp TKB đủ 100% (và mở Thứ 2) nếu chưa có TKB hợp lệ trên hệ thống
  const hasAutoSolvedRef = useRef(false);
  useEffect(() => {
    if (timetableData) return;
    if (hasAutoSolvedRef.current) return;
    const hasAssignments = Object.keys(assignments.homeroomAssignments || {}).length > 0 ||
      Object.values(assignments.subjectAssignments || {}).some(m => Object.keys(m).length > 0);
    if (!hasAssignments || isCurrentTermLocked) return;

    hasAutoSolvedRef.current = true;
    try {
      const cleanSubjectAssignments: Record<string, Record<string, string>> = {};
      const cleanHomeroomAssignments: Record<string, string> = {};

      const effectiveClasses = classes.map(c => {
        const cleanId = c.id.replace(/^c_/, '');
        const hrId = assignments.homeroomAssignments?.[c.id]
          || assignments.homeroomAssignments?.[cleanId]
          || assignments.homeroomAssignments?.[c.id.startsWith('c_') ? c.id : `c_${cleanId}`]
          || (c.name ? assignments.homeroomAssignments?.[c.name] : undefined)
          || c.homeroomTeacherId;
        return {
          ...c,
          homeroomTeacherId: hrId || undefined
        };
      });

      effectiveClasses.forEach(c => {
        cleanSubjectAssignments[c.id] = {};
        const cleanId = c.id.replace(/^c_/, '');
        const hrId = c.homeroomTeacherId;
        if (hrId) {
          cleanHomeroomAssignments[c.id] = hrId;
          cleanHomeroomAssignments[cleanId] = hrId;
          cleanHomeroomAssignments[`c_${cleanId}`] = hrId;
          if (c.name) cleanHomeroomAssignments[c.name] = hrId;
        }

        subjectsConfig.forEach(s => {
          const tId = getNormalizedAssignedTeacherId(c.id, s.id);
          if (tId) cleanSubjectAssignments[c.id][s.id] = tId;
        });
        cleanSubjectAssignments[cleanId] = cleanSubjectAssignments[c.id];
        if (c.name) cleanSubjectAssignments[c.name] = cleanSubjectAssignments[c.id];
      });

      const normalizedAssignments = {
        homeroomAssignments: cleanHomeroomAssignments,
        subjectAssignments: cleanSubjectAssignments
      };

      const subjectRequirements = effectiveClasses.map(c => {
        const classPeriodsObj = getClassPeriodsObj(c.id) || {};
        const rawShift = classShifts[c.id] || (c.grade === '10' ? 'afternoon_main' : 'morning_main');
        const classReqSubs = subjectsConfig.map(s => {
          const total = getSubjectPeriod(s.id, c.grade, c.id);
          if (total === 0) {
            return { name: s.id, periods: 0, mainPeriods: 0, oppPeriods: 0, mainMinPairs: 0, oppMinPairs: 0 };
          }
          const normS = normalizeSubjectName(s.id);
          let rawVal = classPeriodsObj[s.id]
            ?? (s.name ? classPeriodsObj[s.name] : undefined)
            ?? classPeriodsObj[normS];
          if (rawVal === undefined) {
            for (const [k, v] of Object.entries(classPeriodsObj)) {
              if (normalizeSubjectName(k) === normS) {
                rawVal = v;
                break;
              }
            }
          }
          const config = parseSubjectSessionConfig(rawVal, total, s.id, rawShift);
          return {
            name: s.id,
            periods: total,
            mainPeriods: config.mainPeriods,
            oppPeriods: config.oppPeriods,
            mainMinPairs: config.mainMinPairs,
            oppMinPairs: config.oppMinPairs
          };
        });

        const qpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDQPAN');
        const dpSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDĐP');
        if (qpSubReq && dpSubReq && qpSubReq.periods > 0 && dpSubReq.periods > 0) {
          qpSubReq.mainPeriods = 0;
          qpSubReq.oppPeriods = 1;
          dpSubReq.mainPeriods = 0;
          dpSubReq.oppPeriods = 1;
        }

        const gdtcSubReq = classReqSubs.find(s => normalizeSubjectName(s.name) === 'GDTC');
        if (gdtcSubReq && gdtcSubReq.periods > 0) {
          gdtcSubReq.mainPeriods = 0;
          gdtcSubReq.oppPeriods = gdtcSubReq.periods;
          gdtcSubReq.oppMinPairs = Math.floor(gdtcSubReq.periods / 2);
        }

        return { classId: c.id, className: c.name, grade: c.grade, subjects: classReqSubs };
      });

      const maxSessionsPerTeacher: Record<string, number> = {};
      const maxDaysPerTeacher: Record<string, number> = {};
      if (teacherConstraints) {
        Object.entries(teacherConstraints).forEach(([tid, conf]) => {
          const sVal = Number(conf?.maxSessions);
          if (!isNaN(sVal) && sVal > 0) {
            maxSessionsPerTeacher[tid] = sVal;
          }
          const dVal = Number(conf?.maxDays);
          if (!isNaN(dVal) && dVal > 0) {
            maxDaysPerTeacher[tid] = dVal;
          }
        });
      }

      const cleanLockedSlots = sanitizeLockedSlotsConfig(lockedSlots);
      const initialResult = solveTimetable({
        teachers,
        classes: effectiveClasses,
        assignments: normalizedAssignments,
        subjectRequirements,
        sessionMode: effectiveSessionMode,
        afternoonPeriodsCount,
        classShifts,
        fixedConfig: { chaoCoDay: 2, chaoCoPeriod: 1, sinhHoatDay: 7, sinhHoatPeriod: 5 },
        lockedSlots: cleanLockedSlots,
        customFixedSlots,
        teacherConstraints,
        maxSessionsPerTeacher,
        teacherMaxHalfDays: maxSessionsPerTeacher,
        maxDaysPerTeacher,
        advancedConstraints: {
          ...advancedConstraints,
          lessonConsecutivePairs: [['GDQPAN', 'GDĐP']]
        }
      });

      setTimetableData(initialResult);
      if (effectiveSessionMode === 'double' && sessionMode !== 'double') {
        setSessionMode('double');
      }

      const totalPlaced = initialResult.lessons.length;
      const totalDeclared = classes.reduce((sum, c) => {
        return sum + getClassDeclaredTotal(c.id, c.grade).totalPeriods;
      }, 0);
      const pct = totalDeclared > 0 ? Math.round((totalPlaced / totalDeclared) * 100) : 100;
      const msg = `✅ Đã tự động sắp xếp Thời khóa biểu hoàn chỉnh (${initialResult.stats.executionTimeMs}ms): Đã xếp ${totalPlaced.toLocaleString('vi-VN')}/${totalDeclared.toLocaleString('vi-VN')} tiết (${pct}%), mở khóa toàn bộ ngày Thứ 2 cho 44 lớp, 0 trùng tiết.`;
      setSolverNotice(msg);
    } catch (err) {
      console.warn('Initial auto-solve error:', err);
    }
  }, [timetableData]);

  // Clear Timetable
  const handleClearTimetable = () => {
    if (!isAdmin) {
      if (onNotification) {
        onNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để thực hiện thao tác xóa TKB!');
      }
      openLoginModal();
      return;
    }

    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    if (window.confirm('Bạn có chắc chắn muốn xóa Thời khóa biểu hiện tại không?')) {
      setTimetableData(null);
      localStorage.removeItem(storageKey);
      setSolverNotice(null);
    }
  };

  // Group lessons by class: classId -> `${day}_${period}` -> Lesson
  const lessonsByClass = useMemo(() => {
    const map = new Map<string, Map<string, TimetableLesson>>();
    classes.forEach(c => map.set(c.id, new Map<string, TimetableLesson>()));
    if (timetableData?.lessons) {
      timetableData.lessons.forEach(l => {
        const cMap = map.get(l.classId);
        if (cMap) {
          cMap.set(`${l.day}_${l.period}`, l);
        }
      });
    }
    return map;
  }, [classes, timetableData]);

  // Group lessons by teacher: teacherId -> `${day}_${period}` -> Lesson
  const lessonsByTeacher = useMemo(() => {
    const map = new Map<string, Map<string, TimetableLesson>>();
    teachers.forEach(t => map.set(t.id, new Map<string, TimetableLesson>()));
    if (timetableData?.lessons) {
      timetableData.lessons.forEach(l => {
        if (l.teacherId) {
          if (!map.has(l.teacherId)) map.set(l.teacherId, new Map());
          map.get(l.teacherId)!.set(`${l.day}_${l.period}`, l);
        }
      });
    }
    return map;
  }, [teachers, timetableData]);

  // Handle cell click for manual swapping or locking
  const handleCellClick = (classId: string, day: number, period: number) => {
    if (!isAdmin) {
      if (onNotification) {
        onNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để can thiệp vị trí tiết dạy hoặc khóa tiết!');
      }
      openLoginModal();
      return;
    }

    if (isCurrentTermLocked) {
      alert('⚠️ Dữ liệu đang khóa.');
      return;
    }

    // 1. If Lock Mode is active:
    const lockInfo = getClassSlotLockInfo(classId, day, period);
    if (isLockModeActive) {
      if (lockInfo.isLocked) {
        if (lockInfo.reason === 'global') {
          alert(`🔒 Vị trí Thứ ${day}, Tiết ${period} đang bị KHÓA TOÀN TRƯỜNG.\n\nVui lòng mở nút "Vị trí đã khóa" -> tab "Toàn trường" để mở khóa.`);
          return;
        }
        if (lockInfo.reason === 'grade') {
          alert(`🔒 Vị trí Thứ ${day}, Tiết ${period} đang bị KHÓA THEO KHỐI ${lockInfo.grade}.\n\nVui lòng mở nút "Vị trí đã khóa" -> tab "Theo Khối" để mở khóa.`);
          return;
        }
      }
      toggleClassSlotLock(classId, day, period);
      return;
    }

    // 2. If slot is currently locked:
    if (lockInfo.isLocked) {
      if (lockInfo.reason === 'global') {
        alert(`🔒 Vị trí Thứ ${day}, Tiết ${period} đang bị KHÓA TOÀN TRƯỜNG không cho sắp tiết dạy.\n\nĐể điều chỉnh, vui lòng vào "Vị trí đã khóa" -> tab "Toàn trường".`);
        return;
      }
      if (lockInfo.reason === 'grade') {
        alert(`🔒 Vị trí Thứ ${day}, Tiết ${period} đang bị KHÓA THEO KHỐI ${lockInfo.grade} không cho sắp tiết dạy.\n\nĐể điều chỉnh, vui lòng vào "Vị trí đã khóa" -> tab "Theo Khối".`);
        return;
      }
      if (window.confirm(`🔒 Vị trí Thứ ${day}, Tiết ${period} đang bị KHÓA riêng cho lớp này.\n\nBạn có muốn MỞ KHÓA vị trí này không?`)) {
        toggleClassSlotLock(classId, day, period);
      }
      return;
    }

    if (!timetableData) return;

    const cLessons = lessonsByClass.get(classId);
    const lesson = cLessons?.get(`${day}_${period}`) || null;

    // Do not allow moving fixed lessons (Chào cờ, Sinh hoạt lớp)
    if (lesson?.isFixed) {
      alert(`🔒 Tiết "${lesson.subject}" là tiết cố định toàn trường theo quy định, không thể di chuyển.`);
      return;
    }

    if (!selectedCell) {
      // First selection: pick this cell
      if (!lesson) {
        // Can't pick empty as source
        return;
      }
      setSelectedCell({ day, period, lesson });
    } else {
      // Second selection: attempt swap or move
      const src = selectedCell;
      if (src.day === day && src.period === period) {
        // Deselect
        setSelectedCell(null);
        return;
      }

      // Check if target is locked
      if (isClassSlotLocked(classId, day, period)) {
        alert(`⚠️ Không thể chuyển tiết học vào vị trí đang bị KHÓA (Thứ ${day}, Tiết ${period})!`);
        setSelectedCell(null);
        return;
      }

      // Target lesson
      const destLesson = lesson;
      if (destLesson?.isFixed) {
        alert(`🔒 Không thể đổi vào tiết cố định "${destLesson.subject}".`);
        setSelectedCell(null);
        return;
      }

      // Check conflict for src.lesson at target (day, period)
      const srcTeacherId = src.lesson?.teacherId;
      if (srcTeacherId) {
        const teacherBusy = timetableData.lessons.some(
          l => l.teacherId === srcTeacherId &&
               l.day === day &&
               l.period === period &&
               l.classId !== classId
        );
        if (teacherBusy) {
          const conflicting = timetableData.lessons.find(
            l => l.teacherId === srcTeacherId && l.day === day && l.period === period
          );
          const teacherName = teacherMap.get(srcTeacherId)?.name || 'Giáo viên';
          alert(`⚠️ Xung đột: Giáo viên ${teacherName} đã có tiết dạy tại lớp ${conflicting?.className || 'khác'} vào Thứ ${day}, Tiết ${period}! Không thể chuyển.`);
          setSelectedCell(null);
          return;
        }
      }

      // Check conflict for destLesson (if any) at src (src.day, src.period)
      if (destLesson && destLesson.teacherId) {
        const destTeacherBusy = timetableData.lessons.some(
          l => l.teacherId === destLesson.teacherId &&
               l.day === src.day &&
               l.period === src.period &&
               l.classId !== classId
        );
        if (destTeacherBusy) {
          const conflicting = timetableData.lessons.find(
            l => l.teacherId === destLesson.teacherId && l.day === src.day && l.period === src.period
          );
          const teacherName = teacherMap.get(destLesson.teacherId)?.name || 'Giáo viên';
          alert(`⚠️ Xung đột: Giáo viên ${teacherName} đã có tiết dạy tại lớp ${conflicting?.className || 'khác'} vào Thứ ${src.day}, Tiết ${src.period}! Không thể hoán đổi.`);
          setSelectedCell(null);
          return;
        }
      }

      // Execute swap in timetable state
      const updatedLessons = timetableData.lessons.map(l => {
        if (l.classId === classId) {
          if (l.day === src.day && l.period === src.period) {
            return { ...l, day, period };
          }
          if (destLesson && l.day === day && l.period === period) {
            return { ...l, day: src.day, period: src.period };
          }
        }
        return l;
      });

      setTimetableData({
        ...timetableData,
        lessons: updatedLessons
      });

      setSelectedCell(null);
      if (onNotification) onNotification(`Đã hoán đổi vị trí tiết học thành công.`);
    }
  };

  // Handle cell click on Teacher Timetable grid (for locking busy periods)
  const handleTeacherCellClick = (teacherId: string, day: number, period: number) => {
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }

    if (isLockModeActive) {
      toggleTeacherSlotLock(teacherId, day, period);
      return;
    }

    if (isTeacherSlotLocked(teacherId, day, period)) {
      const teacherName = teacherMap.get(teacherId)?.name || 'Giáo viên';
      if (window.confirm(`🔒 Giáo viên ${teacherName} đang bị KHÓA tiết bận vào Thứ ${day}, Tiết ${period} (Không xếp dạy).\n\nBạn có muốn MỞ KHÓA tiết bận này không?`)) {
        toggleTeacherSlotLock(teacherId, day, period);
      }
    }
  };

  // Export Timetable to Excel
  const handleExportExcel = () => {
    if (!timetableData) {
      alert('Chưa có Thời khóa biểu để xuất.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // -------------------------------------------------------------
    // SHEET 1: THỜI KHÓA BIỂU TỔNG HỢP TOÀN TRƯỜNG (MA TRẬN DỌC - CÁC LỚP LÀ CỘT)
    // -------------------------------------------------------------
    const masterRows: any[] = [];
    const masterMerges: any[] = [];
    
    // Title
    masterRows.push([`THỜI KHÓA BIỂU HỌC KỲ ${currentSemester.toUpperCase()} - NĂM HỌC ${currentAcademicYear.toUpperCase()}`]);
    masterRows.push([`Áp dụng từ ngày: ${new Date().toLocaleDateString('vi-VN')}`]);
    masterRows.push([]); // Empty spacing

    // Header row
    const masterHeader = ['Thứ', 'Buổi', 'Tiết', ...classes.map(c => c.name)];
    masterRows.push(masterHeader);

    // Dynamic Merges for Title
    const totalCols = 3 + classes.length;
    masterMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
    masterMerges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });

    let masterCurrentRow = 4; // Data rows start at index 4 (0-indexed)
    const days = [2, 3, 4, 5, 6, 7];

    days.forEach(dayNum => {
      const dayStartRow = masterCurrentRow;

      // 1. Morning session (S)
      const morningStartRow = masterCurrentRow;
      for (let p = 1; p <= 5; p++) {
        const row: any[] = [`${dayNum}`, 'S', p];
        classes.forEach(cls => {
          const cLessons = lessonsByClass.get(cls.id);
          const l = cLessons?.get(`${dayNum}_${p}`);
          row.push(l ? `${l.subject}-${l.teacherName}` : '');
        });
        masterRows.push(row);
        masterCurrentRow++;
      }
      const morningEndRow = masterCurrentRow - 1;
      masterMerges.push({ s: { r: morningStartRow, c: 1 }, e: { r: morningEndRow, c: 1 } });

      // 2. Afternoon session (C)
      if (sessionMode === 'double') {
        const afternoonStartRow = masterCurrentRow;
        for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
          const row: any[] = [`${dayNum}`, 'C', p - 5];
          classes.forEach(cls => {
            const cLessons = lessonsByClass.get(cls.id);
            const l = cLessons?.get(`${dayNum}_${p}`);
            row.push(l ? `${l.subject}-${l.teacherName}` : '');
          });
          masterRows.push(row);
          masterCurrentRow++;
        }
        const afternoonEndRow = masterCurrentRow - 1;
        masterMerges.push({ s: { r: afternoonStartRow, c: 1 }, e: { r: afternoonEndRow, c: 1 } });
      }

      // Merge day cell vertically
      const dayEndRow = masterCurrentRow - 1;
      masterMerges.push({ s: { r: dayStartRow, c: 0 }, e: { r: dayEndRow, c: 0 } });
    });

    const wsMaster = XLSX.utils.aoa_to_sheet(masterRows);
    wsMaster['!merges'] = masterMerges;

    // Define column widths for master sheet
    wsMaster['!cols'] = [
      { wch: 8 },  // Thứ
      { wch: 8 },  // Buổi
      { wch: 8 },  // Tiết
      ...classes.map(() => ({ wch: 16 })) // Individual classes
    ];

    XLSX.utils.book_append_sheet(wb, wsMaster, 'TKB_Tong_Hop');

    // -------------------------------------------------------------
    // SHEET 2: THỜI KHÓA BIỂU CHI TIẾT TỪNG LỚP (CÁC THẺ GIAO DIỆN IN ẤN)
    // -------------------------------------------------------------
    const classRows: any[] = [];
    const classMerges: any[] = [];
    let classCurrentRow = 0;

    classes.forEach(cls => {
      const hrId = assignments.homeroomAssignments[cls.id];
      const hrName = hrId ? (teacherMap.get(hrId)?.name || '') : 'Chưa phân công';

      // Header info cards
      classRows.push(['Trường THPT Nguyễn Bỉnh Khiêm']);
      classRows.push([`TKB LỚP: ${cls.name}`]);
      classRows.push([`Học kỳ ${currentSemester} - Năm học ${currentAcademicYear}`]);
      classRows.push([`- Tên lớp: ${cls.name}`]);
      classRows.push([`- Chủ nhiệm: ${hrName}`]);

      // Merge header info across columns A-H (width 8)
      for (let offset = 0; offset < 5; offset++) {
        classMerges.push({ s: { r: classCurrentRow + offset, c: 0 }, e: { r: classCurrentRow + offset, c: 7 } });
      }
      classCurrentRow += 5;

      // Table columns headers: Thứ 2 to Thứ 7
      classRows.push(['', '', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
      classCurrentRow++;

      // Morning grid
      const morningStart = classCurrentRow;
      for (let p = 1; p <= 5; p++) {
        const row: any[] = ['SÁNG', `S${p}`];
        for (let day = 2; day <= 7; day++) {
          const cLessons = lessonsByClass.get(cls.id);
          const l = cLessons?.get(`${day}_${p}`);
          row.push(l ? l.subject : '');
        }
        classRows.push(row);
        classCurrentRow++;
      }
      // Merge "SÁNG" vertically
      classMerges.push({ s: { r: morningStart, c: 0 }, e: { r: classCurrentRow - 1, c: 0 } });

      // Afternoon grid
      if (sessionMode === 'double') {
        const afternoonStart = classCurrentRow;
        for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
          const row: any[] = ['CHIỀU', `C${p - 5}`];
          for (let day = 2; day <= 7; day++) {
            const cLessons = lessonsByClass.get(cls.id);
            const l = cLessons?.get(`${day}_${p}`);
            row.push(l ? l.subject : '');
          }
          classRows.push(row);
          classCurrentRow++;
        }
        // Merge "CHIỀU" vertically
        classMerges.push({ s: { r: afternoonStart, c: 0 }, e: { r: classCurrentRow - 1, c: 0 } });
      }

      // Spacing rows between class cards
      classRows.push([]);
      classRows.push([]);
      classRows.push([]);
      classCurrentRow += 3;
    });

    const wsClasses = XLSX.utils.aoa_to_sheet(classRows);
    wsClasses['!merges'] = classMerges;
    wsClasses['!cols'] = [
      { wch: 10 }, // Buổi
      { wch: 8 },  // Tiết
      { wch: 16 }, // T2
      { wch: 16 }, // T3
      { wch: 16 }, // T4
      { wch: 16 }, // T5
      { wch: 16 }, // T6
      { wch: 16 }  // T7
    ];

    XLSX.utils.book_append_sheet(wb, wsClasses, 'TKB_Tung_Lop');

    // -------------------------------------------------------------
    // SHEET 3: THỜI KHÓA BIỂU GIÁO VIÊN
    // -------------------------------------------------------------
    const teacherRows: any[] = [];
    teacherRows.push([`THỜI KHÓA BIỂU GIÁO VIÊN - NĂM HỌC ${currentAcademicYear} (${currentSemester})`]);
    teacherRows.push([]);

    const tHeader = ['Mã GV', 'Họ và tên', 'Bộ môn', 'Chức vụ', 'Tổng tiết'];
    DAYS_CONFIG.forEach(d => {
      periodsConfig.forEach(p => {
        tHeader.push(`${d.shortLabel}-${p.label.split(' ')[0]}`);
      });
    });
    teacherRows.push(tHeader);

    teachers.forEach(t => {
      const tLessons = lessonsByTeacher.get(t.id);
      const totalPeriods = tLessons ? tLessons.size : 0;
      const row = [t.id, t.name, getTeacherSubject(t), t.position || 'Giáo viên', totalPeriods];

      DAYS_CONFIG.forEach(d => {
        periodsConfig.forEach(p => {
          const l = tLessons?.get(`${d.day}_${p.period}`);
          if (l) {
            row.push(`${l.subject} - ${l.className}`);
          } else {
            row.push('');
          }
        });
      });
      teacherRows.push(row);
    });

    const wsTeachers = XLSX.utils.aoa_to_sheet(teacherRows);
    wsTeachers['!cols'] = [
      { wch: 10 }, // Mã GV
      { wch: 20 }, // Họ và tên
      { wch: 15 }, // Bộ môn
      { wch: 15 }, // Chức vụ
      { wch: 10 }, // Tổng tiết
      ...DAYS_CONFIG.flatMap(() => periodsConfig.map(() => ({ wch: 14 })))
    ];
    XLSX.utils.book_append_sheet(wb, wsTeachers, 'TKB_Theo_GiaoVien');

    // Write file and trigger download
    const fileName = `ThoiKhoaBieu_${currentAcademicYear.replace(/\s+/g, '_')}_${currentSemester.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Export Timetable to PDF (High Fidelity, Multi-Page, support diacritics)
  const handleExportPDF = async () => {
    if (!timetableData) {
      alert('Chưa có Thời khóa biểu để xuất.');
      return;
    }

    // Loading overlay
    const loadingDiv = document.createElement('div');
    loadingDiv.className = "fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[9999] text-white font-semibold text-sm";
    loadingDiv.innerHTML = `
      <div class="bg-white text-slate-800 p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 border border-slate-100 max-w-sm text-center">
        <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        <div>
          <h3 class="font-bold text-base text-slate-900">Đang khởi tạo PDF...</h3>
          <p class="text-xs text-slate-500 mt-1">Hệ thống đang thiết kế dữ liệu chất lượng cao.</p>
        </div>
      </div>
    `;
    document.body.appendChild(loadingDiv);

    try {
      // Create off-screen container for rendering
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'fixed';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '0';
      tempContainer.style.width = '1200px';
      tempContainer.style.background = '#ffffff';
      tempContainer.style.color = '#1e293b';
      document.body.appendChild(tempContainer);

      // Page 1: Master Timetable (Landscape)
      const masterPage = document.createElement('div');
      masterPage.className = "p-8 bg-white";
      masterPage.style.width = '1200px';
      masterPage.style.boxSizing = 'border-box';
      
      const academicYearLabel = currentAcademicYear.toUpperCase();
      const semesterLabel = currentSemester.toUpperCase();
      const applyDateStr = new Date().toLocaleDateString('vi-VN');

      const classesHeaderCols = classes.map(c => `
        <th style="border: 1px solid #334155; padding: 5px; font-weight: bold; text-align: center; background-color: #f8fafc; color: #0f172a;">
          ${c.name}
        </th>
      `).join('');

      masterPage.innerHTML = `
        <div style="font-family: sans-serif; padding: 10px;">
          <!-- Title Banner -->
          <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #334155; padding-bottom: 12px; margin-bottom: 20px;">
            <div style="text-align: left; line-height: 1.4;">
              <div style="font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600;">SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG</div>
              <div style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #0f172a;">TRƯỜNG THPT NGUYỄN BỈNH KHIÊM</div>
            </div>
            <div style="text-align: right; line-height: 1.4;">
              <div style="font-size: 11px; font-weight: bold; color: #0f172a;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div style="font-size: 10px; font-style: italic; color: #64748b;">Độc lập - Tự do - Hạnh phúc</div>
            </div>
          </div>

          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="font-size: 18px; font-weight: bold; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.5px;">
              THỜI KHÓA BIỂU TỔNG HỢP TOÀN TRƯỜNG
            </h1>
            <h2 style="font-size: 12px; font-weight: 600; margin: 6px 0 0 0; color: #334155;">
              HỌC KỲ ${semesterLabel} - NĂM HỌC ${academicYearLabel}
            </h2>
            <p style="font-size: 10px; font-style: italic; margin: 4px 0 0 0; color: #64748b;">
              Áp dụng từ ngày: ${applyDateStr}
            </p>
          </div>

          <!-- Master Table Grid -->
          <table style="width: 100%; border-collapse: collapse; font-size: 9px; border: 1.5px solid #0f172a;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #0f172a;">
                <th style="border: 1px solid #334155; padding: 5px; font-weight: bold; text-align: center; width: 45px;">Thứ</th>
                <th style="border: 1px solid #334155; padding: 5px; font-weight: bold; text-align: center; width: 40px;">Buổi</th>
                <th style="border: 1px solid #334155; padding: 5px; font-weight: bold; text-align: center; width: 35px;">Tiết</th>
                ${classesHeaderCols}
              </tr>
            </thead>
            <tbody>
              <!-- Row items appended programmatically -->
            </tbody>
          </table>
        </div>
      `;

      const tbody = masterPage.querySelector('tbody')!;
      const days = [2, 3, 4, 5, 6, 7];

      days.forEach(dayNum => {
        const morningPeriods = [1, 2, 3, 4, 5];
        const afternoonPeriods = sessionMode === 'double' ? Array.from({ length: afternoonPeriodsCount }, (_, idx) => 6 + idx) : [];
        const totalPeriodsForDay = morningPeriods.length + afternoonPeriods.length;

        // Morning rows
        morningPeriods.forEach((p, pIdx) => {
          const rowEl = document.createElement('tr');
          rowEl.style.height = '22px';
          
          let dayCellHTML = '';
          if (pIdx === 0) {
            dayCellHTML = `<td rowspan="${totalPeriodsForDay}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; background-color: #f8fafc; font-size: 11px; color: #0f172a;">Thứ ${dayNum}</td>`;
          }

          let sessionCellHTML = '';
          if (pIdx === 0) {
            sessionCellHTML = `<td rowspan="5" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; background-color: #f8fafc; color: #1e293b;">Sáng</td>`;
          }

          const colsHTML = classes.map(cls => {
            const cLessons = lessonsByClass.get(cls.id);
            const l = cLessons?.get(`${dayNum}_${p}`);
            if (l) {
              return `
                <td style="border: 1px solid #94a3b8; text-align: center; padding: 2px 4px; font-size: 8px; line-height: 1.1;">
                  <div style="font-weight: bold; color: #1e293b;">${l.subject}</div>
                  <div style="font-size: 7px; color: #64748b;">${l.teacherName}</div>
                </td>
              `;
            } else {
              return `
                <td style="border: 1px solid #94a3b8; text-align: center; padding: 2px 4px; font-size: 8px; line-height: 1.1;">
                  <span style="color: #cbd5e1;">—</span>
                </td>
              `;
            }
          }).join('');

          rowEl.innerHTML = `
            ${dayCellHTML}
            ${sessionCellHTML}
            <td style="border: 1px solid #0f172a; text-align: center; font-weight: 600; background-color: #fafafa;">S${p}</td>
            ${colsHTML}
          `;
          tbody.appendChild(rowEl);
        });

        // Afternoon rows
        if (sessionMode === 'double' && afternoonPeriods.length > 0) {
          afternoonPeriods.forEach((p, pIdx) => {
            const rowEl = document.createElement('tr');
            rowEl.style.height = '22px';

            let sessionCellHTML = '';
            if (pIdx === 0) {
              sessionCellHTML = `<td rowspan="${afternoonPeriods.length}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; background-color: #fffbeb; color: #b45309;">Chiều</td>`;
            }

            const colsHTML = classes.map(cls => {
              const cLessons = lessonsByClass.get(cls.id);
              const l = cLessons?.get(`${dayNum}_${p}`);
              if (l) {
                return `
                  <td style="border: 1px solid #94a3b8; text-align: center; padding: 2px 4px; font-size: 8px; line-height: 1.1; background-color: #fffdfa;">
                    <div style="font-weight: bold; color: #1e293b;">${l.subject}</div>
                    <div style="font-size: 7px; color: #64748b;">${l.teacherName}</div>
                  </td>
                `;
              } else {
                return `
                  <td style="border: 1px solid #94a3b8; text-align: center; padding: 2px 4px; font-size: 8px; line-height: 1.1; background-color: #fffdfa;">
                    <span style="color: #cbd5e1;">—</span>
                  </td>
                `;
              }
            }).join('');

            rowEl.innerHTML = `
              ${sessionCellHTML}
              <td style="border: 1px solid #0f172a; text-align: center; font-weight: 600; background-color: #fffdf5;">C${p - 5}</td>
              ${colsHTML}
            `;
            tbody.appendChild(rowEl);
          });
        }
      });

      tempContainer.appendChild(masterPage);

      // Create PDF in landscape orientation for Master Table
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      // Capture and add landscape master page
      const canvasMaster = await html2canvas(masterPage, {
        scale: 2,
        useCORS: true
      });
      const imgDataMaster = canvasMaster.toDataURL('image/png');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.addImage(imgDataMaster, 'PNG', 0, 0, pdfWidth, pdfHeight);

      // Build Portrait Cards (2 classes per page)
      const classGroupPages: HTMLDivElement[] = [];
      const itemsPerPage = 2;

      for (let idx = 0; idx < classes.length; idx += itemsPerPage) {
        const pageEl = document.createElement('div');
        pageEl.className = "p-8 bg-white";
        pageEl.style.width = '820px'; // standard portrait width
        pageEl.style.boxSizing = 'border-box';
        pageEl.style.display = 'flex';
        pageEl.style.flexDirection = 'column';
        pageEl.style.gap = '30px';
        pageEl.style.fontFamily = 'sans-serif';

        const pageClasses = classes.slice(idx, idx + itemsPerPage);

        pageClasses.forEach(cls => {
          const hrId = assignments.homeroomAssignments[cls.id];
          const hrName = hrId ? (teacherMap.get(hrId)?.name || '') : 'Chưa phân công';

          const cardEl = document.createElement('div');
          cardEl.style.border = '2px solid #1e293b';
          cardEl.style.borderRadius = '10px';
          cardEl.style.padding = '18px';
          cardEl.style.background = '#ffffff';

          cardEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 12px;">
              <div style="text-align: left; line-height: 1.3;">
                <div style="font-size: 10px; color: #64748b; font-weight: 600;">TRƯỜNG THPT NGUYỄN BỈNH KHIÊM</div>
                <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 1px;">TKB LỚP: ${cls.name}</div>
              </div>
              <div style="text-align: right; line-height: 1.3;">
                <div style="font-size: 10px; color: #64748b;">Học kỳ ${currentSemester} - Năm học ${currentAcademicYear}</div>
                <div style="font-size: 11px; font-weight: bold; color: #4f46e5; margin-top: 1px;">GVCN: ${hrName}</div>
              </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1.2px solid #1e293b;">
              <thead>
                <tr style="background-color: #4f46e5; color: #ffffff;">
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center; width: 60px;">Buổi</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center; width: 45px;">Tiết</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 2</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 3</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 4</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 5</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 6</th>
                  <th style="border: 1px solid #4f46e5; padding: 5px; font-weight: bold; text-align: center;">Thứ 7</th>
                </tr>
              </thead>
              <tbody>
                <!-- Row records -->
              </tbody>
            </table>
          `;

          const cardTbody = cardEl.querySelector('tbody')!;
          
          // Morning
          for (let p = 1; p <= 5; p++) {
            const rowEl = document.createElement('tr');
            rowEl.style.height = '24px';

            let sessionHTML = '';
            if (p === 1) {
              sessionHTML = `<td rowspan="5" style="border: 1px solid #1e293b; text-align: center; font-weight: bold; background-color: #f8fafc; color: #1e293b;">SÁNG</td>`;
            }

            const daysHTML = [2, 3, 4, 5, 6, 7].map(day => {
              const cLessons = lessonsByClass.get(cls.id);
              const l = cLessons?.get(`${day}_${p}`);
              return `
                <td style="border: 1px solid #cbd5e1; text-align: center; font-weight: 500; font-size: 10px; color: #1e293b;">
                  ${l ? l.subject : ''}
                </td>
              `;
            }).join('');

            rowEl.innerHTML = `
              ${sessionHTML}
              <td style="border: 1px solid #475569; text-align: center; font-weight: 600; background-color: #f8fafc;">S${p}</td>
              ${daysHTML}
            `;
            cardTbody.appendChild(rowEl);
          }

          // Afternoon
          if (sessionMode === 'double' && afternoonPeriodsCount > 0) {
            for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
              const rowEl = document.createElement('tr');
              rowEl.style.height = '24px';

              let sessionHTML = '';
              if (p === 6) {
                sessionHTML = `<td rowspan="${afternoonPeriodsCount}" style="border: 1px solid #1e293b; text-align: center; font-weight: bold; background-color: #fffbeb; color: #b45309;">CHIỀU</td>`;
              }

              const daysHTML = [2, 3, 4, 5, 6, 7].map(day => {
                const cLessons = lessonsByClass.get(cls.id);
                const l = cLessons?.get(`${day}_${p}`);
                return `
                  <td style="border: 1px solid #cbd5e1; text-align: center; font-weight: 500; font-size: 10px; color: #1e293b; background-color: #fffdfa;">
                    ${l ? l.subject : ''}
                  </td>
                `;
              }).join('');

              rowEl.innerHTML = `
                ${sessionHTML}
                <td style="border: 1px solid #475569; text-align: center; font-weight: 600; background-color: #fffdf5;">C${p - 5}</td>
                ${daysHTML}
              `;
              cardTbody.appendChild(rowEl);
            }
          }

          pageEl.appendChild(cardEl);
        });

        tempContainer.appendChild(pageEl);
        classGroupPages.push(pageEl);
      }

      // Render Portrait Pages
      for (const pageEl of classGroupPages) {
        pdf.addPage('a4', 'portrait');
        const canvasClass = await html2canvas(pageEl, {
          scale: 2,
          useCORS: true
        });
        const imgDataClass = canvasClass.toDataURL('image/png');
        const portraitWidth = pdf.internal.pageSize.getWidth();
        const portraitHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgDataClass, 'PNG', 0, 0, portraitWidth, portraitHeight);
      }

      const pdfFileName = `ThoiKhoaBieu_${currentAcademicYear.replace(/\s+/g, '_')}_${currentSemester.replace(/\s+/g, '_')}.pdf`;
      pdf.save(pdfFileName);

      document.body.removeChild(tempContainer);
    } catch (err) {
      console.error(err);
      alert('Đã xảy ra lỗi khi tạo tệp PDF.');
    } finally {
      document.body.removeChild(loadingDiv);
    }
  };

  // Print Timetable
  const handlePrint = () => {
    window.print();
  };

  // Details for selected class
  const currentClass = classMap.get(selectedClassId) || classes[0];
  const currentClassLessons = currentClass ? (lessonsByClass.get(currentClass.id) || new Map()) : new Map();
  const currentClassHomeroomTeacher = currentClass ? teacherMap.get(assignments.homeroomAssignments[currentClass.id] || '') : undefined;
  const currentClassTotalPeriods = currentClassLessons.size;

  // Class navigation index & handlers for filteredClasses
  const currentClassIdx = filteredClasses.findIndex(c => c.id === (currentClass?.id || selectedClassId));
  const effectiveClassIdx = currentClassIdx >= 0 ? currentClassIdx : 0;
  const canGoPrevClass = filteredClasses.length > 0 && effectiveClassIdx > 0;
  const canGoNextClass = filteredClasses.length > 0 && effectiveClassIdx < filteredClasses.length - 1;

  const handlePrevClass = () => {
    if (canGoPrevClass && filteredClasses[effectiveClassIdx - 1]) {
      setSelectedClassId(filteredClasses[effectiveClassIdx - 1].id);
    }
  };

  const handleNextClass = () => {
    if (canGoNextClass && filteredClasses[effectiveClassIdx + 1]) {
      setSelectedClassId(filteredClasses[effectiveClassIdx + 1].id);
    }
  };

  // Total declared periods for current class (chuẩn hóa = Chính khóa + Trái buổi, đồng bộ 100% với Bảng phân công & Khai báo)
  const currentClassDeclaredSummary = useMemo(() => {
    if (!currentClass) return { mainTotal: 0, oppTotal: 0, totalPeriods: 0, subjectPeriodsMap: {} };
    return getClassDeclaredTotal(currentClass.id, currentClass.grade);
  }, [currentClass, classSubjectPeriods, subjectsConfig, classShifts]);

  // Mẫu số tiến độ xếp TKB của lớp đang chọn (tính động 100% không hardcode)
  const classRequiredPeriods = currentClassDeclaredSummary.totalPeriods;
  const currentClassAssignedSubjectPeriods = classRequiredPeriods;

  // Tổng số tiết yêu cầu toàn trường (tính động 100% từ Bảng phân công & Khai báo số tiết)
  const totalRequiredPeriods = useMemo(() => {
    return classes.reduce((sum, c) => {
      return sum + getClassDeclaredTotal(c.id, c.grade).totalPeriods;
    }, 0);
  }, [classes, classSubjectPeriods, subjectsConfig, classShifts]);
  const totalDeclaredAcrossSchool = totalRequiredPeriods;

  // Details for selected teacher
  const currentTeacher = teacherMap.get(selectedTeacherId) || teachers[0];
  const currentTeacherLessons = currentTeacher ? (lessonsByTeacher.get(currentTeacher.id) || new Map()) : new Map();
  const currentTeacherHomeroomClass = currentTeacher
    ? classes.find(c => assignments.homeroomAssignments[c.id] === currentTeacher.id)
    : undefined;

  // Teacher navigation index & handlers for filteredTeachers
  const currentTeacherIdx = filteredTeachers.findIndex(t => t.id === (currentTeacher?.id || selectedTeacherId));
  const effectiveTeacherIdx = currentTeacherIdx >= 0 ? currentTeacherIdx : 0;
  const canGoPrevTeacher = filteredTeachers.length > 0 && effectiveTeacherIdx > 0;
  const canGoNextTeacher = filteredTeachers.length > 0 && effectiveTeacherIdx < filteredTeachers.length - 1;

  const handlePrevTeacher = () => {
    if (canGoPrevTeacher && filteredTeachers[effectiveTeacherIdx - 1]) {
      setSelectedTeacherId(filteredTeachers[effectiveTeacherIdx - 1].id);
    }
  };

  const handleNextTeacher = () => {
    if (canGoNextTeacher && filteredTeachers[effectiveTeacherIdx + 1]) {
      setSelectedTeacherId(filteredTeachers[effectiveTeacherIdx + 1].id);
    }
  };

  // Calculate teacher stats: sessions taught & isolated gaps
  const currentTeacherStats = useMemo(() => {
    if (!currentTeacher || !timetableData) return { total: 0, sessions: 0, gaps: 0 };
    let total = 0;
    let sessions = 0;
    let gaps = 0;

    DAYS_CONFIG.forEach(d => {
      const dayLessons = timetableData.lessons.filter(l => l.teacherId === currentTeacher.id && l.day === d.day);
      if (dayLessons.length > 0) {
        total += dayLessons.length;

        // Morning session lessons (period <= 5)
        const morningLessons = dayLessons.filter(l => l.period <= 5).map(l => l.period).sort((a, b) => a - b);
        if (morningLessons.length > 0) {
          sessions++;
          if (morningLessons.length > 1) {
            const gapM = (morningLessons[morningLessons.length - 1] - morningLessons[0] + 1) - morningLessons.length;
            if (gapM > 0) gaps += gapM;
          }
        }

        // Afternoon session lessons (period >= 6)
        const afternoonLessons = dayLessons.filter(l => l.period >= 6).map(l => l.period).sort((a, b) => a - b);
        if (afternoonLessons.length > 0) {
          sessions++;
          if (afternoonLessons.length > 1) {
            const gapA = (afternoonLessons[afternoonLessons.length - 1] - afternoonLessons[0] + 1) - afternoonLessons.length;
            if (gapA > 0) gaps += gapA;
          }
        }
      }
    });

    return { total, sessions, gaps };
  }, [currentTeacher, timetableData]);

  return (
    <div className="flex flex-col m-0 p-0" style={{ marginTop: '0px', paddingTop: '0px', overflow: 'visible' }}>
      {/* COMPACT DASHBOARD TOP CONTROLS */}
      {/* Tầng 1: Thanh tiêu đề và cụm nút tác vụ (1 hàng duy nhất) */}
      <div 
        className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 min-h-[38px] mb-1 relative"
        style={{ overflow: 'visible' }}
      >
        {/* Bên trái: Tiêu đề + mini badge CP-SAT + info tooltip */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600 shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <h2 className="text-[1.1rem] font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap leading-none">
            <span>Thời khóa biểu</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
              CP-SAT
            </span>
            <div className="relative group/tip cursor-pointer inline-flex items-center text-slate-400 hover:text-indigo-600 shrink-0 ml-0.5" title="Mẹo hoán đổi tiết">
              <Info className="w-3.5 h-3.5" />
              <div className="invisible group-hover/tip:visible opacity-0 group-hover/tip:opacity-100 transition-all duration-150 absolute left-0 top-full mt-1.5 w-72 p-2 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-50 pointer-events-none leading-relaxed font-normal">
                Mẹo: Bạn có thể nhấp chọn 2 ô trong bảng để hoán đổi tiết học thủ công (hệ thống tự kiểm tra chống trùng tiết).
              </div>
            </div>
          </h2>
        </div>

        {/* Bên phải: Toàn bộ nút lệnh trên cùng 1 hàng */}
        <div 
          className="flex items-center flex-wrap sm:flex-nowrap gap-1.5 shrink-0 relative"
          style={{ overflow: 'visible' }}
        >
          {/* Nút hành động chính: Sắp xếp TKB tự động */}
          <button
            onClick={handleSolveTimetable}
            disabled={isSolving || isCurrentTermLocked || !isAdmin}
            className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer whitespace-nowrap shrink-0 ${
              !isAdmin
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                : isSolving
                ? 'bg-indigo-400 text-white cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 shadow-indigo-100'
            }`}
            title={
              !isAdmin
                ? 'Vui lòng đăng nhập Quản trị viên để sắp xếp TKB.'
                : isCurrentTermLocked
                ? 'Dữ liệu đang khóa chống sửa đổi.'
                : 'Chạy thuật toán sắp xếp Thời khóa biểu tự động'
            }
          >
            <Sparkles className={`w-3.5 h-3.5 ${isSolving ? 'animate-spin' : ''}`} />
            <span>{isSolving ? 'Đang giải TKB...' : 'Sắp xếp TKB tự động'}</span>
            {!isAdmin && <Lock className="w-3 h-3 text-slate-400 ml-0.5" />}
          </button>

          {/* Ràng buộc */}
          {isAdmin && (
            <button
              onClick={() => setIsCommonConstraintsOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              title="Thiết lập các ràng buộc: Tiết cố định, Tiết nghỉ lớp, Thời gian bận GV, Ghép cặp môn"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>Ràng buộc</span>
            </button>
          )}

          {/* Dạy 2 buổi/ngày */}
          {isAdmin && (
            <button
              onClick={() => setIsSessionConfigModalOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              title="Cấu hình chế độ dạy học: 1 buổi/ngày (Sáng) hoặc 2 buổi/ngày (Sáng & Chiều)"
            >
              {sessionMode === 'double' ? (
                <Sunset className="w-3.5 h-3.5 text-indigo-600" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{sessionMode === 'double' ? 'Dạy 2 buổi / ngày' : 'Dạy 1 buổi / ngày'}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold bg-slate-100 text-slate-600 ml-0.5">
                {sessionMode === 'double' ? `${5 + afternoonPeriodsCount}t` : '5t'}
              </span>
            </button>
          )}

          {/* Khóa vị trí tiết (504) */}
          {isAdmin && (
            <div className="h-8 inline-flex items-center rounded-lg border border-slate-300 bg-white shadow-2xs overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setIsLockModeActive(prev => !prev)}
                className={`h-full inline-flex items-center gap-1.5 px-2.5 text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  isLockModeActive
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
                title="Bật/Tắt chế độ nhấp vào các ô trên bảng TKB để Khóa/Mở khóa vị trí"
              >
                <Lock className={`w-3.5 h-3.5 ${isLockModeActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{isLockModeActive ? 'Đang khóa' : 'Khóa vị trí'}</span>
                {totalLockedCount > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-0.5 ${
                    isLockModeActive ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {totalLockedCount}
                  </span>
                )}
              </button>
              {totalLockedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setIsLockManagerOpen(true)}
                  className={`h-full px-2 border-l border-slate-200 transition cursor-pointer flex items-center justify-center ${
                    isLockModeActive ? 'bg-slate-900 text-slate-300 hover:text-white' : 'hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Mở danh sách chi tiết các vị trí khóa"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Lưu đám mây */}
          {isAdmin && (
            <button
              onClick={async () => {
                const res = await syncToCloud();
                if (onNotification) onNotification(res.message);
              }}
              disabled={isSyncing}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Đồng bộ tự động cả Phân công giảng dạy và Thời khóa biểu lên Cloud Firestore"
            >
              <Cloud className={`w-3.5 h-3.5 text-slate-500 ${isSyncing ? 'animate-spin text-indigo-600' : ''}`} />
              <span>{isSyncing ? 'Đang lưu...' : 'Lưu đám mây'}</span>
            </button>
          )}

          {/* Viewer login unlock button */}
          {!isAdmin && (
            <button
              onClick={openLoginModal}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition shadow-2xs cursor-pointer whitespace-nowrap shrink-0"
              title="Đăng nhập Quản trị viên để chỉnh sửa và chạy thuật toán xếp TKB"
            >
              <KeyRound className="w-3.5 h-3.5 text-slate-500" />
              <span>Mở khóa chỉnh sửa</span>
            </button>
          )}

          {/* Xuất dữ liệu ▾ (Cửa sổ trung gian tùy chọn xuất dữ liệu & in ấn TKB) */}
          {timetableData && (
            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs whitespace-nowrap hover:border-indigo-400 hover:text-indigo-600 shrink-0"
              title="Xuất dữ liệu & In Thời khóa biểu"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>Xuất dữ liệu</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
          )}

          {/* Xóa TKB */}
          {timetableData && isAdmin && (
            <button
              type="button"
              onClick={handleClearTimetable}
              disabled={isCurrentTermLocked}
              className="h-8 inline-flex items-center gap-1 px-2 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0"
              title="Xóa thời khóa biểu hiện tại để xếp lại từ đầu"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa TKB</span>
            </button>
          )}
        </div>
      </div>

      {/* Tầng 2: Dải chỉ số thống kê siêu gọn (Compact Stat Strip - height ~32px) */}
      <div className="h-7 md:h-8 px-3 bg-slate-50 border border-slate-200/90 rounded-md flex items-center justify-between text-[11px] md:text-xs text-slate-600 overflow-x-auto whitespace-nowrap mb-1 gap-2">
        <div className="flex items-center gap-2 flex-nowrap shrink-0">
          <span>
            Tổng số tiết: <strong className="font-bold text-slate-900">{timetableData ? `${timetableData.stats.totalLessons.toLocaleString('vi-VN')} / ${totalDeclaredAcrossSchool.toLocaleString('vi-VN')}` : `0 / ${totalDeclaredAcrossSchool.toLocaleString('vi-VN')}`}</strong>
            {timetableData && totalDeclaredAcrossSchool > 0 && (
              <span className={`ml-1 px-1.5 py-0.2 rounded font-bold text-[10px] ${
                timetableData.stats.totalLessons >= totalDeclaredAcrossSchool
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                ({Math.round((timetableData.stats.totalLessons / totalDeclaredAcrossSchool) * 100)}%)
              </span>
            )}
          </span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Lớp: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.totalClasses : classes.length}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Giáo viên: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.totalTeachers : teachers.length}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
            Trùng tiết: <CheckCircle className="w-3 h-3 text-emerald-600 inline" /> 0 (Tuyệt đối) ✓
          </span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Tiết trống GV: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.isolatedGaps : 0}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <button
            type="button"
            onClick={() => setIsLockManagerOpen(true)}
            className="inline-flex items-center gap-1 hover:text-indigo-600 cursor-pointer"
            title="Bấm để xem danh sách vị trí đã khóa"
          >
            <Lock className="w-3 h-3 text-slate-400" />
            <span>Đã khóa: <strong className="font-bold text-slate-900">{totalLockedCount}</strong></span>
          </button>
        </div>
      </div>

      {/* Lock Mode Notice Banner (nếu đang bật) */}
      {isLockModeActive && (
        <div className="mb-1.5 p-2 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-amber-900 text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Chế độ Khóa vị trí tiết đang BẬT:</strong> Nhấp vào bất kỳ ô nào trên bảng TKB dưới đây để Khóa hoặc Mở khóa vị trí.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsLockModeActive(false)}
            className="px-2.5 py-1 bg-amber-800 hover:bg-amber-900 text-white rounded text-xs font-semibold cursor-pointer shrink-0"
          >
            Hoàn tất khóa
          </button>
        </div>
      )}

      {/* Solver Notice / Infeasible Diagnostics */}
      {solverNotice && (
        <div className="mb-1.5 p-2 bg-indigo-50 border border-indigo-200 rounded text-indigo-800 text-xs flex items-center justify-between">
          <span>{solverNotice}</span>
          <button onClick={() => setSolverNotice(null)} className="text-indigo-500 hover:text-indigo-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {infeasibleDiagnostics && infeasibleDiagnostics.length > 0 && (
        <div className="mb-2 p-3 bg-rose-50 border border-rose-200 rounded-lg animate-in fade-in text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-rose-900 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" /> Chi tiết xung đột kẹt lịch & phân công quá tải
            </span>
            <button onClick={() => setInfeasibleDiagnostics(null)} className="text-rose-500 hover:text-rose-800 font-semibold cursor-pointer">
              Đóng
            </button>
          </div>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
            {infeasibleDiagnostics.map((diag, idx) => (
              <div key={idx} className="bg-white border border-rose-100 p-2 rounded text-rose-900">
                <strong>{diag.message}</strong>
                {diag.details && <p className="text-slate-600 mt-0.5">{diag.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tầng 3: Thanh công cụ bộ lọc và chế độ xem (Bố cục 2 tầng rõ ràng, chống tràn, tự co giãn mượt mà) */}
      <div className="flex flex-col gap-1.5 pb-2 border-b border-slate-200/80 mb-2">
        {/* HÀNG 1: Điều hướng & Thông tin chi tiết (Lớp / Giáo viên) */}
        <div className="flex flex-wrap items-center justify-between gap-2 min-h-[32px]">
          {/* Cụm chọn & Điều hướng */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeView === 'by_class' && (
              <>
                {/* Dropdown Khối */}
                <select
                  value={filterGrade}
                  onChange={e => {
                    const newGrade = e.target.value as any;
                    setFilterGrade(newGrade);
                    const matchingClasses = newGrade === 'all' ? classes : classes.filter(c => c.grade === newGrade);
                    if (matchingClasses.length > 0 && !matchingClasses.some(c => c.id === selectedClassId)) {
                      setSelectedClassId(matchingClasses[0].id);
                    }
                  }}
                  className="h-7 px-2 py-0 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap shrink-0"
                >
                  <option value="all">Khối: Tất cả</option>
                  <option value="10">Khối 10</option>
                  <option value="11">Khối 11</option>
                  <option value="12">Khối 12</option>
                </select>

                {/* Cụm chuyển lớp: [◀] [Combobox Chọn Lớp] [▶] [Chỉ số 5/44] */}
                <div className="inline-flex items-center gap-0.5 bg-slate-50 p-0.5 rounded border border-slate-200 whitespace-nowrap shrink-0">
                  <button
                    type="button"
                    onClick={handlePrevClass}
                    disabled={!canGoPrevClass}
                    title={canGoPrevClass ? `Chuyển về lớp trước: ${filteredClasses[effectiveClassIdx - 1]?.name}` : 'Đang ở lớp đầu tiên'}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-xs font-bold text-slate-700 hover:bg-white hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-none hover:shadow-xs active:scale-95 shrink-0"
                    aria-label="Lớp trước"
                  >
                    ◀
                  </button>

                  <select
                    value={selectedClassId}
                    onChange={e => setSelectedClassId(e.target.value)}
                    className="h-6 px-2 py-0 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[160px] truncate whitespace-nowrap shrink-0"
                  >
                    {filteredClasses.map(c => (
                      <option key={c.id} value={c.id}>
                        Lớp {c.name} (Khối {c.grade})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleNextClass}
                    disabled={!canGoNextClass}
                    title={canGoNextClass ? `Chuyển sang lớp tiếp: ${filteredClasses[effectiveClassIdx + 1]?.name}` : 'Đang ở lớp cuối cùng'}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-xs font-bold text-slate-700 hover:bg-white hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-none hover:shadow-xs active:scale-95 shrink-0"
                    aria-label="Lớp sau"
                  >
                    ▶
                  </button>

                  <span
                    className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded whitespace-nowrap shrink-0 min-w-[42px] text-center"
                    title={`Lớp thứ ${filteredClasses.length > 0 ? effectiveClassIdx + 1 : 0} trên tổng số ${filteredClasses.length} lớp`}
                  >
                    {filteredClasses.length > 0 ? `${effectiveClassIdx + 1}/${filteredClasses.length}` : '0/0'}
                  </span>
                </div>

                {/* Badge [GVCN: ...] */}
                {currentClass && (
                  <span className="h-7 px-2.5 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap shrink-0">
                    GVCN: <strong className="ml-1 font-semibold text-slate-900">{currentClassHomeroomTeacher?.name || 'Chưa phân công'}</strong>
                  </span>
                )}

                {/* Badge tiến độ [Đã xếp / Tổng tiết cả tuần] */}
                {currentClass && (
                  <span
                    className={`h-7 px-2.5 py-0 inline-flex items-center text-xs font-semibold rounded whitespace-nowrap shrink-0 border ${
                      currentClassTotalPeriods === currentClassAssignedSubjectPeriods
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : currentClassTotalPeriods < currentClassAssignedSubjectPeriods
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-rose-50 text-rose-800 border-rose-300'
                    }`}
                    title={`Lớp ${currentClass.name}: Tổng số tiết cả tuần = ${currentClassAssignedSubjectPeriods} tiết (Chính khóa: ${currentClassDeclaredSummary.mainTotal}t, Trái buổi: ${currentClassDeclaredSummary.oppTotal}t). Đã xếp: ${currentClassTotalPeriods}/${currentClassAssignedSubjectPeriods} tiết.`}
                  >
                    {currentClassTotalPeriods}/{currentClassAssignedSubjectPeriods} tiết
                    <span className="ml-1">
                      ({Math.round((currentClassTotalPeriods / (currentClassAssignedSubjectPeriods || 1)) * 100)}% {currentClassTotalPeriods === currentClassAssignedSubjectPeriods ? '✓' : ''})
                    </span>
                  </span>
                )}
              </>
            )}

            {activeView === 'by_teacher' && (
              <>
                {/* Ô tìm kiếm nhanh với Dropdown gợi ý Autocomplete */}
                <div ref={teacherSearchRef} className="relative shrink-0">
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="🔍 Tìm GV..."
                      value={teacherSearch}
                      onChange={e => {
                        setTeacherSearch(e.target.value);
                        setIsTeacherSearchFocused(true);
                      }}
                      onFocus={() => setIsTeacherSearchFocused(true)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          setIsTeacherSearchFocused(false);
                        } else if (e.key === 'Enter' && teacherSearchSuggestions.length > 0) {
                          handleSelectTeacherFromSearch(teacherSearchSuggestions[0]);
                        }
                      }}
                      className="pl-7 pr-6 h-7 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32 bg-white shadow-2xs font-medium text-slate-800 placeholder:text-slate-400"
                    />
                    {teacherSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setTeacherSearch('');
                          setIsTeacherSearchFocused(false);
                        }}
                        className="absolute right-1 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                        title="Xóa tìm kiếm"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Dropdown gợi ý Autocomplete */}
                  {isTeacherSearchFocused && teacherSearch.trim().length > 0 && (
                    <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg border border-slate-200 shadow-xl z-50 overflow-hidden divide-y divide-slate-100 animate-in fade-in duration-100">
                      <div className="p-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-500 flex items-center justify-between">
                        <span>Gợi ý ({teacherSearchSuggestions.length} kết quả)</span>
                        <span className="text-[9px] text-slate-400">Nhấp để xem TKB</span>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {teacherSearchSuggestions.length > 0 ? (
                          teacherSearchSuggestions.map(t => {
                            const subj = getTeacherSubject(t);
                            const homeroomClass = classes.find(c => assignments.homeroomAssignments[c.id] === t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleSelectTeacherFromSearch(t)}
                                className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 transition hover:bg-indigo-50/80 cursor-pointer ${
                                  t.id === selectedTeacherId ? 'bg-indigo-50/50 font-bold text-indigo-900' : 'text-slate-800'
                                }`}
                              >
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs truncate font-medium">{t.name}</span>
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <span>{t.position || 'GV'}</span>
                                    {homeroomClass && (
                                      <span className="text-purple-700 font-semibold">• CN {homeroomClass.name}</span>
                                    )}
                                  </div>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100 shrink-0">
                                  {subj}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="p-3 text-xs text-slate-400 text-center">
                            Không tìm thấy giáo viên nào khớp với "{teacherSearch}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Dropdown Bộ môn */}
                <select
                  value={filterDepartment}
                  onChange={e => {
                    const newDept = e.target.value;
                    setFilterDepartment(newDept);
                    const matchingTeachers = newDept === 'all'
                      ? teachers
                      : teachers.filter(t => getTeacherSubject(t) === newDept);
                    if (matchingTeachers.length > 0 && !matchingTeachers.some(t => t.id === selectedTeacherId)) {
                      setSelectedTeacherId(matchingTeachers[0].id);
                    }
                  }}
                  className="h-7 px-2 py-0 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap shrink-0 max-w-[125px] truncate"
                  title="Lọc danh sách theo Tổ bộ môn"
                >
                  <option value="all">Môn: Tất cả ({teachers.length})</option>
                  {teacherDepartments.map(dept => {
                    const count = teachers.filter(t => getTeacherSubject(t) === dept).length;
                    return (
                      <option key={dept} value={dept}>
                        Môn: {dept} ({count})
                      </option>
                    );
                  })}
                </select>

                {/* Cụm chuyển giáo viên: [◀] [Combobox Chọn GV] [▶] [Chỉ số 1/101] */}
                <div className="inline-flex items-center gap-0.5 bg-slate-50 p-0.5 rounded border border-slate-200 whitespace-nowrap shrink-0">
                  <button
                    type="button"
                    onClick={handlePrevTeacher}
                    disabled={!canGoPrevTeacher}
                    title={canGoPrevTeacher ? `Chuyển về GV trước: ${filteredTeachers[effectiveTeacherIdx - 1]?.name}` : 'Đang ở giáo viên đầu tiên'}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-xs font-bold text-slate-700 hover:bg-white hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-none hover:shadow-xs active:scale-95 shrink-0"
                    aria-label="Giáo viên trước"
                  >
                    ◀
                  </button>

                  <select
                    value={selectedTeacherId}
                    onChange={e => setSelectedTeacherId(e.target.value)}
                    className="h-6 px-2 py-0 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[170px] truncate whitespace-nowrap shrink-0"
                  >
                    {filteredTeachers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({getTeacherSubject(t)} - {t.position || 'GV'})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleNextTeacher}
                    disabled={!canGoNextTeacher}
                    title={canGoNextTeacher ? `Chuyển sang GV tiếp: ${filteredTeachers[effectiveTeacherIdx + 1]?.name}` : 'Đang ở giáo viên cuối cùng'}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-xs font-bold text-slate-700 hover:bg-white hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-none hover:shadow-xs active:scale-95 shrink-0"
                    aria-label="Giáo viên sau"
                  >
                    ▶
                  </button>

                  <span
                    className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded whitespace-nowrap shrink-0 min-w-[46px] text-center"
                    title={`Giáo viên thứ ${filteredTeachers.length > 0 ? effectiveTeacherIdx + 1 : 0} trên tổng số ${filteredTeachers.length} giáo viên`}
                  >
                    {filteredTeachers.length > 0 ? `${effectiveTeacherIdx + 1}/${filteredTeachers.length}` : '0/0'}
                  </span>
                </div>

                {/* Thông tin nhanh của GV */}
                {currentTeacher && (
                  <>
                    <span className="h-7 px-2 py-0 inline-flex items-center text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-800 rounded whitespace-nowrap shrink-0">
                      Môn: <strong className="ml-1 font-semibold">{getTeacherSubject(currentTeacher)}</strong>
                    </span>
                    {currentTeacherHomeroomClass && (
                      <span className="h-7 px-2 py-0 inline-flex items-center text-xs font-medium bg-purple-50 border border-purple-200 text-purple-800 rounded whitespace-nowrap shrink-0">
                        GVCN: <strong className="ml-1 font-semibold text-purple-900">Lớp {currentTeacherHomeroomClass.name}</strong>
                      </span>
                    )}
                    <span className="h-7 px-2 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap shrink-0">
                      Tổng dạy: <strong className="ml-1 font-semibold text-slate-900">{currentTeacherStats.total} tiết</strong>
                    </span>
                    <span className={`h-7 px-2 py-0 inline-flex items-center text-xs font-semibold rounded whitespace-nowrap border shrink-0 ${
                      currentTeacherStats.gaps === 0
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      Tiết trống: <strong className="ml-1">{currentTeacherStats.gaps} tiết</strong>
                    </span>
                  </>
                )}
              </>
            )}

            {activeView === 'matrix_class' && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Lọc nhanh theo Khối */}
                <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setMatrixClassGradeFilter('all')}
                    className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      matrixClassGradeFilter === 'all' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tất cả ({classes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixClassGradeFilter('10')}
                    className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      matrixClassGradeFilter === '10' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Khối 10 ({classes.filter(c => c.grade === '10').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixClassGradeFilter('11')}
                    className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      matrixClassGradeFilter === '11' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Khối 11 ({classes.filter(c => c.grade === '11').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixClassGradeFilter('12')}
                    className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      matrixClassGradeFilter === '12' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Khối 12 ({classes.filter(c => c.grade === '12').length})
                  </button>
                </div>

                {/* Input tìm nhanh tên lớp */}
                <div className="relative shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={matrixClassSearch}
                    onChange={e => setMatrixClassSearch(e.target.value)}
                    placeholder="🔍 Tìm lớp, GVCN..."
                    className="w-36 sm:w-44 pl-7 pr-6 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                  {matrixClassSearch && (
                    <button
                      type="button"
                      onClick={() => setMatrixClassSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <span className="h-7 px-2 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap shrink-0">
                  Hiển thị: <strong className="ml-1 font-semibold text-slate-900">{filteredMatrixClasses.length}/{classes.length} lớp</strong>
                </span>
              </div>
            )}

            {activeView === 'matrix_teacher' && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Dropdown lọc Tổ bộ môn */}
                <select
                  value={matrixTeacherDepartmentFilter}
                  onChange={e => setMatrixTeacherDepartmentFilter(e.target.value)}
                  className="h-7 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 shrink-0"
                >
                  <option value="all">Tổ bộ môn: Tất cả ({teachers.length})</option>
                  {matrixTeacherDepartments.map(item => (
                    <option key={item.dept} value={item.dept}>
                      {item.dept} ({item.count})
                    </option>
                  ))}
                </select>

                {/* Input tìm GV */}
                <div className="relative shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={matrixTeacherSearch}
                    onChange={e => setMatrixTeacherSearch(e.target.value)}
                    placeholder="🔍 Tìm tên GV..."
                    className="w-36 sm:w-44 pl-7 pr-6 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                  />
                  {matrixTeacherSearch && (
                    <button
                      type="button"
                      onClick={() => setMatrixTeacherSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Toggle điểm nóng: Tiết trống lủng */}
                <button
                  type="button"
                  onClick={() => setMatrixTeacherOnlyGaps(prev => !prev)}
                  className={`h-7 px-2.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                    matrixTeacherOnlyGaps
                      ? 'bg-amber-500 text-white border-amber-600 shadow-2xs font-bold'
                      : teachersWithGapsCount > 0
                      ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                  }`}
                  title="Chỉ hiển thị các giáo viên bị dính tiết trống lủng giữa buổi"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Trống lủng ({teachersWithGapsCount})</span>
                </button>

                <span className="h-7 px-2 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap shrink-0">
                  Hiển thị: <strong className="ml-1 font-semibold text-slate-900">{filteredMatrixTeachers.length}/{teachers.length} GV</strong>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* HÀNG 2: Chế độ xem & Lọc ca học (Được tách riêng, luôn hiển thị đầy đủ không bị che khuất) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
          {/* Bên trái: Nhóm nút chuyển chế độ xem */}
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs shadow-2xs shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('by_class')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                activeView === 'by_class'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <School className="w-3.5 h-3.5" />
              <span>Từng Lớp</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('by_teacher')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                activeView === 'by_teacher'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Từng GV</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('matrix_class')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                activeView === 'matrix_class'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Ma trận Lớp</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('matrix_teacher')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                activeView === 'matrix_teacher'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Ma trận GV</span>
            </button>
          </div>

          {/* Bên phải: Bộ chọn Ca học (Sáng | Chiều | Cả ngày) */}
          {sessionMode === 'double' && (
            <div className="inline-flex items-center p-0.5 bg-amber-50/90 border border-amber-200 rounded-lg text-xs shadow-2xs shrink-0">
              <span className="text-[11px] font-bold text-amber-900 px-1.5 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-700" /> Ca học:
              </span>
              <button
                type="button"
                onClick={() => setSessionFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'all'
                    ? 'bg-amber-600 text-white shadow-2xs font-bold'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Cả ngày
              </button>
              <button
                type="button"
                onClick={() => setSessionFilter('morning')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'morning'
                    ? 'bg-amber-600 text-white shadow-2xs font-bold'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Sáng
              </button>
              <button
                type="button"
                onClick={() => setSessionFilter('afternoon')}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'afternoon'
                    ? 'bg-amber-600 text-white shadow-2xs font-bold'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Chiều
              </button>
            </div>
          )}
        </div>
      </div>

      {/* VIEW 1: BY CLASS */}
      {activeView === 'by_class' && (
        <div className="space-y-2 mt-0" style={{ marginTop: '0px' }}>
          {/* Timetable Grid for Class (Compact Grid) */}
          <div className="bg-white rounded-xl border border-slate-300 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-center" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-xs text-slate-700">
                    <th className="py-2 px-2 w-20 text-center font-bold bg-slate-100/90" style={{ border: '1px solid #cbd5e1' }}>
                      <span className="text-[11px] font-bold tracking-wider text-slate-700 uppercase">Tiết</span>
                    </th>
                    {DAYS_CONFIG.map(d => (
                      <th key={d.day} className="py-2 px-2 text-center font-bold" style={{ border: '1px solid #cbd5e1' }}>
                        <div className="text-xs font-semibold text-slate-800">{d.label}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {displayedPeriods.map(p => {
                    const sessionPeriodNumber = p.period > 5 ? p.period - 5 : p.period;

                    return (
                      <React.Fragment key={p.period}>
                        {sessionMode === 'double' && sessionFilter === 'all' && p.period === 1 && (
                          <tr key="morning-header" className="bg-sky-50 text-sky-900 border-y border-sky-200">
                            <td colSpan={7} className="py-1 px-3 text-left font-bold text-xs" style={{ border: '1px solid #cbd5e1' }}>
                              <span className="flex items-center gap-1.5">
                                <Sunrise className="w-3.5 h-3.5 text-sky-600" />
                                BUỔI SÁNG (Tiết 1 - Tiết 5)
                              </span>
                            </td>
                          </tr>
                        )}
                        {sessionMode === 'double' && sessionFilter === 'all' && p.period === 6 && (
                          <tr key="afternoon-header" className="bg-amber-50 text-amber-900 border-t-2 border-b border-amber-300">
                            <td colSpan={7} className="py-1 px-3 text-left font-bold text-xs" style={{ border: '1px solid #cbd5e1' }}>
                              <span className="flex items-center gap-1.5">
                                <Sunset className="w-3.5 h-3.5 text-amber-600" />
                                BUỔI CHIỀU (Tiết 1 - Tiết {afternoonPeriodsCount})
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          {/* Period Column */}
                          <td 
                            className="text-center align-middle bg-slate-50 font-bold select-none"
                            style={{ 
                              border: '1px solid #cbd5e1',
                              height: '44px',
                              minHeight: '40px',
                              maxHeight: '46px',
                              width: '60px'
                            }}
                          >
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-200/70 text-slate-800 text-xs font-bold">
                              {sessionPeriodNumber}
                            </span>
                          </td>

                          {/* Day Columns */}
                          {DAYS_CONFIG.map(d => {
                            const lessonKey = `${d.day}_${p.period}`;
                            const lesson = currentClassLessons.get(lessonKey);
                            const isSelected = selectedCell?.day === d.day && selectedCell?.period === p.period;
                            const lockInfo = getClassSlotLockInfo(currentClass.id, d.day, p.period);
                            const isLocked = lockInfo.isLocked;
                            const colors = lesson ? getSubjectColorClass(lesson.subject) : null;

                            return (
                              <td
                                key={d.day}
                                onClick={() => handleCellClick(currentClass.id, d.day, p.period)}
                                className={`transition-all cursor-pointer select-none relative ${
                                  isSelected
                                    ? "ring-2 ring-indigo-600 bg-indigo-50 z-10"
                                    : isLocked
                                    ? "bg-[#fef9c3] hover:bg-yellow-200/80"
                                    : colors
                                    ? colors.bg
                                    : "hover:bg-slate-50"
                                }`}
                                style={{ 
                                  border: '1px solid #cbd5e1',
                                  height: '44px',
                                  minHeight: '40px',
                                  maxHeight: '46px',
                                  padding: '2px 4px',
                                  verticalAlign: 'middle'
                                }}
                              >
                                {isLocked && (
                                  <div 
                                    className="absolute top-1 right-1 p-0.5 rounded bg-amber-200/80 text-amber-800 z-10 shadow-2xs"
                                    title={
                                      lockInfo.reason === 'global' ? 'Khóa toàn trường (Bấm để mở)' :
                                      lockInfo.reason === 'grade' ? `Khóa Khối ${currentClass.grade} (Bấm để mở)` : 'Khóa lớp (Bấm để mở)'
                                    }
                                  >
                                    <Lock className="w-3 h-3" />
                                  </div>
                                )}

                                {lesson ? (
                                  <div className="flex flex-col items-center justify-center text-center px-1" style={{ lineHeight: 1.15 }}>
                                    <div 
                                      className="font-semibold text-slate-900 truncate max-w-full"
                                      style={{ fontSize: '0.85rem', fontWeight: 600 }}
                                      title={lesson.subject}
                                    >
                                      {lesson.subject}
                                      {lesson.isFixed && (
                                        <span className="ml-1 text-[9px] font-bold text-red-600" title={lesson.fixedReason || 'Cố định'}>*</span>
                                      )}
                                    </div>
                                    <div 
                                      className="truncate max-w-full mt-0.5"
                                      style={{ fontSize: '0.75rem', fontWeight: 400, color: '#475569' }}
                                      title={lesson.teacherName}
                                    >
                                      {lesson.teacherName}
                                    </div>
                                  </div>
                                ) : isLocked ? (
                                  <div className="flex flex-col items-center justify-center text-center" style={{ lineHeight: 1.15 }}>
                                    <span className="text-[11px] font-semibold text-amber-800">(Đã khóa)</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center text-center">
                                    {isLockModeActive ? (
                                      <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                                        <Lock className="w-3 h-3" /> Khóa
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-light">—</span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: BY TEACHER (VỊ TRÍ 3 TƯƠNG ĐỒNG: margin-top: 0px, padding-top: 7px) */}
      {activeView === 'by_teacher' && (
        <div className="space-y-2 mt-0" style={{ marginTop: '0px' }}>
          {/* Timetable Grid for Teacher (Compact Grid) */}
          <div className="bg-white rounded-xl border border-slate-300 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-center" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-xs text-slate-700">
                    <th className="py-2 px-2 w-20 text-center font-bold bg-slate-100/90" style={{ border: '1px solid #cbd5e1' }}>
                      <span className="text-[11px] font-bold tracking-wider text-slate-700 uppercase">Tiết</span>
                    </th>
                    {DAYS_CONFIG.map(d => (
                      <th key={d.day} className="py-2 px-2 text-center font-bold" style={{ border: '1px solid #cbd5e1' }}>
                        <div className="text-xs font-semibold text-slate-800">{d.label}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {displayedPeriods.map(p => {
                    const sessionPeriodNumber = p.period > 5 ? p.period - 5 : p.period;

                    return (
                      <React.Fragment key={p.period}>
                        {sessionMode === 'double' && sessionFilter === 'all' && p.period === 1 && (
                          <tr key="morning-header-teacher" className="bg-sky-50 text-sky-900 border-y border-sky-200">
                            <td colSpan={7} className="py-1 px-3 text-left font-bold text-xs" style={{ border: '1px solid #cbd5e1' }}>
                              <span className="flex items-center gap-1.5">
                                <Sunrise className="w-3.5 h-3.5 text-sky-600" />
                                BUỔI SÁNG (Tiết 1 - Tiết 5)
                              </span>
                            </td>
                          </tr>
                        )}
                        {sessionMode === 'double' && sessionFilter === 'all' && p.period === 6 && (
                          <tr key="afternoon-header-teacher" className="bg-amber-50 text-amber-900 border-t-2 border-b border-amber-300">
                            <td colSpan={7} className="py-1 px-3 text-left font-bold text-xs" style={{ border: '1px solid #cbd5e1' }}>
                              <span className="flex items-center gap-1.5">
                                <Sunset className="w-3.5 h-3.5 text-amber-600" />
                                BUỔI CHIỀU (Tiết 1 - Tiết {afternoonPeriodsCount})
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr key={p.period} className="hover:bg-slate-50/50 transition-colors">
                          <td 
                            className="text-center align-middle bg-slate-50 font-bold select-none"
                            style={{ 
                              border: '1px solid #cbd5e1',
                              height: '44px',
                              minHeight: '40px',
                              maxHeight: '46px',
                              width: '60px'
                            }}
                          >
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-200/70 text-slate-800 text-xs font-bold">
                              {sessionPeriodNumber}
                            </span>
                          </td>

                          {DAYS_CONFIG.map(d => {
                            const lessonKey = `${d.day}_${p.period}`;
                            const lesson = currentTeacherLessons.get(lessonKey);
                            const isTeacherLocked = isTeacherSlotLocked(currentTeacher.id, d.day, p.period);
                            const colors = lesson ? getSubjectColorClass(lesson.subject) : null;

                            return (
                              <td
                                key={d.day}
                                onClick={() => handleTeacherCellClick(currentTeacher.id, d.day, p.period)}
                                className={`transition-all cursor-pointer select-none relative ${
                                  isTeacherLocked
                                    ? "bg-rose-50/80 hover:bg-rose-100"
                                    : colors
                                    ? colors.bg
                                    : "hover:bg-slate-50"
                                }`}
                                style={{ 
                                  border: '1px solid #cbd5e1',
                                  height: '44px',
                                  minHeight: '40px',
                                  maxHeight: '46px',
                                  padding: '2px 4px',
                                  verticalAlign: 'middle'
                                }}
                              >
                                {isTeacherLocked && (
                                  <div 
                                    className="absolute top-1 right-1 p-0.5 rounded bg-rose-200/80 text-rose-800 z-10 shadow-2xs"
                                    title="Tiết bận - GV không dạy (Bấm để mở khóa)"
                                  >
                                    <Ban className="w-3 h-3" />
                                  </div>
                                )}

                                {lesson ? (
                                  <div className="flex flex-col items-center justify-center text-center px-1" style={{ lineHeight: 1.15 }}>
                                    <div 
                                      className="font-semibold text-slate-900 truncate max-w-full"
                                      style={{ fontSize: '0.85rem', fontWeight: 600 }}
                                      title={lesson.subject}
                                    >
                                      {lesson.subject}
                                    </div>
                                    <div 
                                      className="truncate max-w-full mt-0.5"
                                      style={{ fontSize: '0.75rem', fontWeight: 500, color: '#4338ca' }}
                                      title={`Lớp ${lesson.className}`}
                                    >
                                      Lớp {lesson.className}
                                    </div>
                                  </div>
                                ) : isTeacherLocked ? (
                                  <div className="flex flex-col items-center justify-center text-center" style={{ lineHeight: 1.15 }}>
                                    <span className="text-[11px] font-semibold text-rose-700">(Bận)</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center text-center">
                                    {isLockModeActive ? (
                                      <span className="text-[10px] text-rose-600 flex items-center gap-0.5">
                                        <Ban className="w-3 h-3" /> Khóa bận
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-light">—</span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: MATRIX OVERVIEW BY CLASS */}
      {activeView === 'matrix_class' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
          {/* Header & Bộ lọc nhanh Ma trận Lớp */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800 text-sm">
                  Ma trận Thời khóa biểu Toàn trường theo Từng lớp
                </h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {filteredMatrixClasses.length}/{classes.length} lớp
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Cố định cột Lớp, GVCN & Tiết khi cuộn • Di chuột để bật thước ngắm chéo (Crosshair) • Nhấp tên lớp để mở TKB chi tiết
              </p>
            </div>

            {/* Thanh lọc & tìm kiếm */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Lọc Khối */}
              <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setMatrixClassGradeFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    matrixClassGradeFilter === 'all' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tất cả ({classes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixClassGradeFilter('10')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    matrixClassGradeFilter === '10' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khối 10 ({classes.filter(c => c.grade === '10').length})
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixClassGradeFilter('11')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    matrixClassGradeFilter === '11' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khối 11 ({classes.filter(c => c.grade === '11').length})
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixClassGradeFilter('12')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    matrixClassGradeFilter === '12' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khối 12 ({classes.filter(c => c.grade === '12').length})
                </button>
              </div>

              {/* Ô tìm kiếm nhanh lớp */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={matrixClassSearch}
                  onChange={e => setMatrixClassSearch(e.target.value)}
                  placeholder="🔍 Tìm tên lớp, GVCN..."
                  className="w-40 sm:w-48 pl-7 pr-6 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                />
                {matrixClassSearch && (
                  <button
                    type="button"
                    onClick={() => setMatrixClassSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bảng Ma trận Lớp cố định 2 chiều (Double-axis Freeze Panes) */}
          <div
            className="relative overflow-auto max-h-[640px] border border-slate-300 rounded-xl shadow-xs bg-white"
            onMouseLeave={() => {
              setMatrixHoveredRow(null);
              setMatrixHoveredCol(null);
            }}
          >
            <table className="w-full border-separate border-spacing-0 text-xs text-left">
              <thead className="bg-slate-100 sticky top-0 z-30 shadow-xs select-none">
                <tr>
                  {/* Cột 1: Lớp (Freeze Pane góc trái trên z-40) */}
                  <th
                    className={`p-2 border-b-2 border-r border-slate-300 font-bold min-w-[75px] max-w-[75px] w-[75px] sticky top-0 left-0 z-40 text-center transition-colors ${
                      matrixHoveredRow ? 'bg-slate-200 text-indigo-900' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    Lớp
                  </th>
                  {/* Cột 2: GVCN (Freeze Pane góc trái trên z-40 với đổ bóng phân cách) */}
                  <th
                    className={`p-2 border-b-2 border-r-2 border-slate-300 font-bold min-w-[115px] max-w-[115px] w-[115px] sticky top-0 left-[75px] z-40 text-left px-2 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.15)] transition-colors ${
                      matrixHoveredRow ? 'bg-slate-200 text-indigo-900' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    GVCN
                  </th>
                  {/* Các cột Thứ - Tiết (Freeze Pane trên cùng z-30) */}
                  {DAYS_CONFIG.map(d =>
                    displayedPeriods.map(p => {
                      const colKey = `${d.day}_${p.period}`;
                      const isColHovered = matrixHoveredCol === colKey;

                      return (
                        <th
                          key={colKey}
                          className={`p-1.5 border-b-2 border-r border-slate-200 text-center font-semibold min-w-[80px] max-w-[88px] sticky top-0 z-30 transition-colors ${
                            isColHovered
                              ? 'bg-indigo-200 text-indigo-950 ring-2 ring-indigo-400 font-bold shadow-xs'
                              : p.period === 6
                              ? 'border-l-4 border-l-amber-400 bg-amber-50/90 text-amber-900'
                              : p.period === 1
                              ? 'border-l-2 border-l-slate-400 bg-slate-100 text-slate-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="font-bold">{d.shortLabel}-{p.shortLabel}</div>
                          <div className={`text-[9px] font-normal ${isColHovered ? 'text-indigo-800 font-semibold' : 'text-slate-500'}`}>
                            {p.session === 'afternoon' ? 'Chiều' : 'Sáng'}
                          </div>
                        </th>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredMatrixClasses.length === 0 ? (
                  <tr>
                    <td colSpan={2 + displayedPeriods.length * DAYS_CONFIG.length} className="text-center py-10 text-slate-400">
                      Không tìm thấy lớp học nào khớp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredMatrixClasses.map(cls => {
                    const hrId = assignments.homeroomAssignments[cls.id];
                    const hrTeacher = hrId ? teacherMap.get(hrId) : undefined;
                    const cLessons = lessonsByClass.get(cls.id);
                    const isRowHovered = matrixHoveredRow === cls.id;

                    return (
                      <tr key={cls.id} className="transition-colors">
                        {/* Cột 1: Tên Lớp (Freeze Pane bên trái z-20, nhấp để xem chi tiết) */}
                        <td
                          onClick={() => {
                            setSelectedClassId(cls.id);
                            setActiveView('by_class');
                          }}
                          className={`p-2 border-b border-r border-slate-200 font-bold text-center sticky left-0 z-20 cursor-pointer transition-colors ${
                            isRowHovered
                              ? 'bg-indigo-100 text-indigo-900 font-extrabold'
                              : 'bg-white text-slate-900 hover:bg-slate-100'
                          }`}
                          title={`Nhấp để xem Thời khóa biểu chi tiết Lớp ${cls.name}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {cls.name}
                          </span>
                        </td>
                        {/* Cột 2: GVCN (Freeze Pane bên trái z-20) */}
                        <td
                          className={`p-2 border-b border-r-2 border-slate-300 truncate max-w-[115px] sticky left-[75px] z-20 text-left px-2 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.15)] transition-colors ${
                            isRowHovered
                              ? 'bg-indigo-100 text-indigo-950 font-medium'
                              : 'bg-white text-slate-700'
                          }`}
                          title={hrTeacher ? `GVCN: ${hrTeacher.name}` : 'Chưa phân công GVCN'}
                        >
                          {hrTeacher?.name || '—'}
                        </td>
                        {/* Các ô ma trận theo Thứ và Tiết */}
                        {DAYS_CONFIG.map(d =>
                          displayedPeriods.map(p => {
                            const colKey = `${d.day}_${p.period}`;
                            const l = cLessons?.get(colKey);
                            const lockInfo = getClassSlotLockInfo(cls.id, d.day, p.period);
                            const isLocked = lockInfo.isLocked;
                            const colors = l ? getSubjectColorClass(l.subject) : null;
                            const isColHovered = matrixHoveredCol === colKey;
                            const isCellHovered = isRowHovered && isColHovered;

                            return (
                              <td
                                key={colKey}
                                onMouseEnter={() => {
                                  setMatrixHoveredRow(cls.id);
                                  setMatrixHoveredCol(colKey);
                                }}
                                className={`p-1 border-b border-r border-slate-200 text-center min-w-[80px] max-w-[88px] transition-all relative ${
                                  p.period === 6
                                    ? 'border-l-4 border-l-amber-400'
                                    : p.period === 1
                                    ? 'border-l-2 border-l-slate-300'
                                    : ''
                                } ${
                                  isCellHovered
                                    ? 'ring-2 ring-indigo-600 shadow-md z-10 scale-[1.02] bg-indigo-50 font-semibold'
                                    : isRowHovered
                                    ? isColHovered
                                      ? 'bg-indigo-100/90'
                                      : 'bg-indigo-50/60'
                                    : isColHovered
                                    ? 'bg-indigo-50/40 ring-1 ring-indigo-200'
                                    : isLocked
                                    ? 'bg-amber-50/70 border-dashed'
                                    : colors
                                    ? colors.bg
                                    : 'bg-white'
                                }`}
                              >
                                {isLocked ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[9px] text-amber-800 font-bold bg-amber-100/90 px-1 py-0.5 rounded border border-amber-300 shadow-2xs"
                                    title={
                                      lockInfo.reason === 'global'
                                        ? 'Khóa toàn trường'
                                        : lockInfo.reason === 'grade'
                                        ? `Khóa theo Khối ${cls.grade}`
                                        : 'Khóa theo lớp'
                                    }
                                  >
                                    <Lock className="w-2.5 h-2.5" />
                                    {lockInfo.reason === 'grade' ? `K${cls.grade}` : lockInfo.reason === 'global' ? 'Chung' : 'Khóa'}
                                  </span>
                                ) : l ? (
                                  <div className="leading-tight">
                                    <div
                                      className="font-bold text-[11px] text-slate-900 truncate"
                                      title={l.subject}
                                    >
                                      {l.subject}
                                    </div>
                                    <div
                                      className="text-[10px] text-slate-600 truncate mt-0.5 font-medium"
                                      title={l.teacherName}
                                    >
                                      {l.teacherName}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 select-none font-light">—</span>
                                )}
                              </td>
                            );
                          })
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Chú thích màu sắc môn học */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-500 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-700">Màu pastel bộ môn:</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" /> Chào cờ</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> SHL / CN</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" /> Toán / Tin</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" /> Ngữ văn</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-violet-100 border border-violet-300" /> Ngoại ngữ</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-cyan-100 border border-cyan-300" /> Lý / Hóa / Sinh</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" /> Sử / Địa / GD</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> GDTC / QP</span>
            </div>
            <div className="text-[11px] text-slate-400">
              💡 Nhấp vào ô hoặc tên lớp để xem chi tiết
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: MATRIX OVERVIEW BY TEACHER */}
      {activeView === 'matrix_teacher' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
          {/* Header & Bộ lọc nhanh Ma trận Giáo viên */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800 text-sm">
                  Ma trận Thời khóa biểu Toàn trường theo Từng Giáo viên
                </h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {filteredMatrixTeachers.length}/{teachers.length} GV
                </span>
                {teachersWithGapsCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                    {teachersWithGapsCount} GV có tiết lủng
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Cố định cột Giáo viên, Môn, Tiết khi cuộn • Tự động cảnh báo tiết trống lủng giữa buổi • Nhấp tên GV để mở TKB chi tiết
              </p>
            </div>

            {/* Thanh lọc & tìm kiếm giáo viên */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Dropdown Lọc Tổ bộ môn */}
              <select
                value={matrixTeacherDepartmentFilter}
                onChange={e => setMatrixTeacherDepartmentFilter(e.target.value)}
                className="text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">Tất cả Bộ môn ({teachers.length})</option>
                {matrixTeacherDepartments.map(item => (
                  <option key={item.dept} value={item.dept}>
                    {item.dept} ({item.count})
                  </option>
                ))}
              </select>

              {/* Ô tìm kiếm nhanh GV */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={matrixTeacherSearch}
                  onChange={e => setMatrixTeacherSearch(e.target.value)}
                  placeholder="🔍 Tìm tên giáo viên..."
                  className="w-40 sm:w-48 pl-7 pr-6 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                />
                {matrixTeacherSearch && (
                  <button
                    type="button"
                    onClick={() => setMatrixTeacherSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Nút lọc điểm nóng: Chỉ hiện GV có tiết trống lủng */}
              <button
                type="button"
                onClick={() => setMatrixTeacherOnlyGaps(prev => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border ${
                  matrixTeacherOnlyGaps
                    ? 'bg-amber-500 text-white border-amber-600 shadow-2xs font-bold'
                    : teachersWithGapsCount > 0
                    ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
                title="Lọc nhanh danh sách các giáo viên bị trống tiết lủng giữa buổi"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>Trống lủng ({teachersWithGapsCount})</span>
              </button>
            </div>
          </div>

          {/* Bảng Ma trận Giáo viên cố định 2 chiều (Double-axis Freeze Panes) */}
          <div
            className="relative overflow-auto max-h-[640px] border border-slate-300 rounded-xl shadow-xs bg-white"
            onMouseLeave={() => {
              setMatrixHoveredRow(null);
              setMatrixHoveredCol(null);
            }}
          >
            <table className="w-full border-separate border-spacing-0 text-xs text-left">
              <thead className="bg-slate-100 sticky top-0 z-30 shadow-xs select-none">
                <tr>
                  {/* Cột 1: Giáo viên (Freeze Pane góc trái trên z-40) */}
                  <th
                    className={`p-2 border-b-2 border-r border-slate-300 font-bold min-w-[140px] max-w-[140px] w-[140px] sticky top-0 left-0 z-40 text-left px-2.5 transition-colors ${
                      matrixHoveredRow ? 'bg-slate-200 text-indigo-900' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    Giáo viên
                  </th>
                  {/* Cột 2: Môn (Freeze Pane góc trái trên z-40) */}
                  <th
                    className={`p-2 border-b-2 border-r border-slate-300 font-bold min-w-[65px] max-w-[65px] w-[65px] sticky top-0 left-[140px] z-40 text-center transition-colors ${
                      matrixHoveredRow ? 'bg-slate-200 text-indigo-900' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    Môn
                  </th>
                  {/* Cột 3: Tiết (Freeze Pane góc trái trên z-40 với đổ bóng phân cách) */}
                  <th
                    className={`p-2 border-b-2 border-r-2 border-slate-300 font-bold min-w-[55px] max-w-[55px] w-[55px] sticky top-0 left-[205px] z-40 text-center shadow-[3px_0_5px_-2px_rgba(0,0,0,0.15)] transition-colors ${
                      matrixHoveredRow ? 'bg-slate-200 text-indigo-900' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    Tiết
                  </th>
                  {/* Các cột Thứ - Tiết (Freeze Pane trên cùng z-30) */}
                  {DAYS_CONFIG.map(d =>
                    displayedPeriods.map(p => {
                      const colKey = `${d.day}_${p.period}`;
                      const isColHovered = matrixHoveredCol === colKey;

                      return (
                        <th
                          key={colKey}
                          className={`p-1.5 border-b-2 border-r border-slate-200 text-center font-semibold min-w-[75px] max-w-[82px] sticky top-0 z-30 transition-colors ${
                            isColHovered
                              ? 'bg-indigo-200 text-indigo-950 ring-2 ring-indigo-400 font-bold shadow-xs'
                              : p.period === 6
                              ? 'border-l-4 border-l-amber-400 bg-amber-50/90 text-amber-900'
                              : p.period === 1
                              ? 'border-l-2 border-l-slate-400 bg-slate-100 text-slate-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="font-bold">{d.shortLabel}-{p.shortLabel}</div>
                          <div className={`text-[9px] font-normal ${isColHovered ? 'text-indigo-800 font-semibold' : 'text-slate-500'}`}>
                            {p.session === 'afternoon' ? 'Chiều' : 'Sáng'}
                          </div>
                        </th>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredMatrixTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={3 + displayedPeriods.length * DAYS_CONFIG.length} className="text-center py-10 text-slate-400">
                      Không tìm thấy giáo viên nào khớp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredMatrixTeachers.map(t => {
                    const tLessons = lessonsByTeacher.get(t.id);
                    const totalTaught = tLessons ? tLessons.size : 0;
                    const isRowHovered = matrixHoveredRow === t.id;
                    const teacherGaps = teacherGapCellsMap.get(t.id);
                    const gapCount = teacherGaps ? teacherGaps.size : 0;

                    return (
                      <tr key={t.id} className="transition-colors">
                        {/* Cột 1: Tên GV (Freeze Pane bên trái z-20, nhấp để xem chi tiết) */}
                        <td
                          onClick={() => {
                            setSelectedTeacherId(t.id);
                            setActiveView('by_teacher');
                          }}
                          className={`p-2 border-b border-r border-slate-200 font-bold truncate max-w-[140px] sticky left-0 z-20 cursor-pointer transition-colors px-2.5 ${
                            isRowHovered
                              ? 'bg-indigo-100 text-indigo-900 font-extrabold'
                              : 'bg-white text-slate-900 hover:bg-slate-100'
                          }`}
                          title={`Nhấp để xem Thời khóa biểu chi tiết của ${t.name}`}
                        >
                          {t.name}
                        </td>
                        {/* Cột 2: Môn học (Freeze Pane bên trái z-20) */}
                        <td
                          className={`p-2 border-b border-r border-slate-200 text-center truncate max-w-[65px] sticky left-[140px] z-20 font-medium transition-colors ${
                            isRowHovered
                              ? 'bg-indigo-100 text-indigo-950 font-semibold'
                              : 'bg-white text-slate-600'
                          }`}
                          title={`Bộ môn: ${getTeacherSubject(t)}`}
                        >
                          {getTeacherSubject(t)}
                        </td>
                        {/* Cột 3: Tổng tiết dạy & Cảnh báo tiết lủng (Freeze Pane z-20) */}
                        <td
                          className={`p-2 border-b border-r-2 border-slate-300 text-center sticky left-[205px] z-20 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.15)] transition-colors ${
                            isRowHovered
                              ? 'bg-indigo-100 text-indigo-950 font-bold'
                              : 'bg-white'
                          }`}
                        >
                          {gapCount > 0 ? (
                            <div className="leading-tight">
                              <span className="font-bold text-slate-900">{totalTaught}</span>
                              <div className="mt-0.5">
                                <span
                                  className="px-1 py-0.2 text-[9px] font-bold bg-amber-100 text-amber-800 rounded border border-amber-300"
                                  title={`Giáo viên có ${gapCount} tiết trống lủng giữa buổi`}
                                >
                                  ⚠️{gapCount}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="font-bold text-slate-700">{totalTaught}</span>
                          )}
                        </td>
                        {/* Các ô ma trận theo Thứ và Tiết */}
                        {DAYS_CONFIG.map(d =>
                          displayedPeriods.map(p => {
                            const colKey = `${d.day}_${p.period}`;
                            const l = tLessons?.get(colKey);
                            const isTeacherLocked = isTeacherSlotLocked(t.id, d.day, p.period);
                            const colors = l ? getSubjectColorClass(l.subject) : null;
                            const isColHovered = matrixHoveredCol === colKey;
                            const isCellHovered = isRowHovered && isColHovered;
                            const isGap = teacherGaps?.has(colKey);

                            return (
                              <td
                                key={colKey}
                                onMouseEnter={() => {
                                  setMatrixHoveredRow(t.id);
                                  setMatrixHoveredCol(colKey);
                                }}
                                className={`p-1 border-b border-r border-slate-200 text-center min-w-[75px] max-w-[82px] transition-all relative ${
                                  p.period === 6
                                    ? 'border-l-4 border-l-amber-400'
                                    : p.period === 1
                                    ? 'border-l-2 border-l-slate-300'
                                    : ''
                                } ${
                                  isCellHovered
                                    ? 'ring-2 ring-indigo-600 shadow-md z-10 scale-[1.02] bg-indigo-50 font-semibold'
                                    : isGap
                                    ? 'bg-amber-100/90 border-2 border-amber-500 font-bold text-amber-900 shadow-2xs'
                                    : isRowHovered
                                    ? isColHovered
                                      ? 'bg-indigo-100/90'
                                      : 'bg-indigo-50/60'
                                    : isColHovered
                                    ? 'bg-indigo-50/40 ring-1 ring-indigo-200'
                                    : isTeacherLocked
                                    ? 'bg-rose-50/70 border-dashed'
                                    : colors
                                    ? colors.bg
                                    : 'bg-white'
                                }`}
                              >
                                {isGap ? (
                                  <div
                                    className="flex flex-col items-center justify-center py-0.5 leading-none"
                                    title={`Tiết trống lủng giữa ca học của GV ${t.name}`}
                                  >
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-800 bg-amber-200/90 px-1 py-0.5 rounded border border-amber-400 shadow-2xs">
                                      <AlertTriangle className="w-2.5 h-2.5 text-amber-700" /> Trống
                                    </span>
                                  </div>
                                ) : isTeacherLocked ? (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] text-rose-800 font-bold bg-rose-100/90 px-1 py-0.5 rounded border border-rose-300 shadow-2xs">
                                    <Ban className="w-2.5 h-2.5" /> Bận
                                  </span>
                                ) : l ? (
                                  <div className="leading-tight">
                                    <div
                                      className="font-bold text-[10px] text-slate-900 truncate"
                                      title={l.subject}
                                    >
                                      {l.subject}
                                    </div>
                                    <div
                                      className="text-[10px] font-bold text-indigo-700 bg-indigo-100/60 rounded px-1 truncate inline-block mt-0.5"
                                      title={`Lớp ${l.className}`}
                                    >
                                      {l.className}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 select-none font-light">—</span>
                                )}
                              </td>
                            );
                          })
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Chú thích màu sắc & điểm nóng */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-500 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-700">Ký hiệu & Điểm nóng:</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300" /> Ô có tiết dạy [Môn - Lớp]</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-amber-200 border-2 border-amber-500" /> ⚠️ Tiết trống lủng giữa buổi</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300" /> 🚫 Tiết bận (Khóa GV)</span>
              <span className="inline-flex items-center gap-1 text-[11px]"><span className="w-3 h-3 rounded bg-white border border-slate-300" /> — Tiết trống bình thường</span>
            </div>
            <div className="text-[11px] text-slate-400">
              💡 Nhấp vào tên giáo viên để mở Thời khóa biểu cá nhân
            </div>
          </div>
        </div>
      )}

      {/* MODAL: QUẢN LÝ CẤU HÌNH KHÓA VỊ TRÍ TIẾT */}
      {isLockManagerOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Cấu hình Khóa vị trí trên Thời khóa biểu
                  </h3>
                  <p className="text-xs text-slate-500">
                    Các vị trí bị khóa sẽ tuyệt đối không được sắp tiết dạy khi xếp lịch tự động.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLockManagerOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub Tabs */}
            <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex gap-2 overflow-x-auto">
              <button
                onClick={() => setLockManagerTab('global')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  lockManagerTab === 'global' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Toàn trường ({lockedSlots.global?.length || 0})
              </button>
              <button
                onClick={() => setLockManagerTab('grade')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                  lockManagerTab === 'grade' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Theo Khối ({Object.values(lockedSlots.byGrade || {}).reduce((s, a) => s + a.length, 0)} ô)
              </button>
              <button
                onClick={() => setLockManagerTab('class')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  lockManagerTab === 'class' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Theo từng Lớp ({Object.values(lockedSlots.byClass || {}).reduce((s, a) => s + a.length, 0)})
              </button>
              <button
                onClick={() => setLockManagerTab('teacher')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  lockManagerTab === 'teacher' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Theo Giáo viên ({Object.values(lockedSlots.byTeacher || {}).reduce((s, a) => s + a.length, 0)})
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Tab 1: Global */}
              {lockManagerTab === 'global' && (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs">
                    <p className="font-semibold">Khóa tiết học chung cho tất cả các lớp toàn trường:</p>
                    <p className="text-blue-700 mt-0.5">
                      Bấm vào các ô bên dưới để khóa không cho xếp bất kỳ môn nào vào các tiết đó cho toàn bộ các lớp (ví dụ: nghỉ chiều Thứ 7 hoặc tiết chuyên đề chung).
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2 border-r border-slate-200 w-20">Tiết \ Thứ</th>
                          {DAYS_CONFIG.map(d => (
                            <th key={d.day} className="p-2 border-r border-slate-200 last:border-r-0">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {periodsConfig.map(p => (
                          <tr key={p.period}>
                            <td className="p-2 font-bold bg-slate-50 border-r border-slate-200">{p.label}</td>
                            {DAYS_CONFIG.map(d => {
                              const key = `${d.day}_${p.period}`;
                              const isLocked = (lockedSlots.global || []).includes(key);
                              return (
                                <td
                                  key={d.day}
                                  onClick={() => toggleGlobalSlotLock(d.day, p.period)}
                                  className={`p-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${
                                    isLocked ? 'bg-amber-100 hover:bg-amber-200 font-bold text-amber-900' : 'hover:bg-slate-50 text-slate-400'
                                  }`}
                                >
                                  {isLocked ? (
                                    <div className="flex items-center justify-center gap-1 text-amber-800">
                                      <Lock className="w-3.5 h-3.5" />
                                      <span>Khóa</span>
                                    </div>
                                  ) : (
                                    <span>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 2: Theo Khối (NEW) */}
              {lockManagerTab === 'grade' && (
                <div className="space-y-3.5">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                    <p className="font-semibold flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-amber-700" />
                      Khóa tiết học đồng loạt theo Khối lớp (Khối 10, 11, 12):
                    </p>
                    <p className="text-amber-700 mt-1">
                      Khi khóa một vị trí trong khối, <strong>tất cả các lớp thuộc khối đó</strong> sẽ không được xếp tiết dạy vào ô này khi chạy xếp TKB tự động. Rất thuận tiện để khóa chiều Thứ 7 cho khối 10, khóa tiết 5 cho khối 12 ôn thi, hoặc lịch học phụ đạo/chuyên đề riêng theo khối.
                    </p>
                  </div>

                  {/* Grade Selector & Quick Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-700 mr-1">Chọn khối:</span>
                      {(['10', '11', '12'] as const).map(gr => {
                        const countInGr = lockedSlots.byGrade?.[gr]?.length || 0;
                        const classCount = classes.filter(c => c.grade === gr).length;
                        return (
                          <button
                            key={gr}
                            onClick={() => setLockManagerGrade(gr)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                              lockManagerGrade === gr
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            <span>Khối {gr}</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                              lockManagerGrade === gr ? 'bg-indigo-800 text-white' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {countInGr} ô ({classCount} lớp)
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick batch buttons for current grade */}
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        onClick={() => batchLockGradeSlots(lockManagerGrade, ['7_4', '7_5'])}
                        className="px-2 py-1 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 rounded-md font-medium transition cursor-pointer"
                        title="Khóa tiết 4 và 5 ngày Thứ 7 cho cả khối"
                      >
                        + Khóa Chiều T7
                      </button>
                      <button
                        onClick={() => batchLockGradeSlots(lockManagerGrade, ['2_5', '3_5', '4_5', '5_5', '6_5', '7_5'])}
                        className="px-2 py-1 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 rounded-md font-medium transition cursor-pointer"
                        title="Khóa tiết 5 từ Thứ 2 đến Thứ 7 cho cả khối"
                      >
                        + Khóa Tiết 5 cả tuần
                      </button>
                      {(lockedSlots.byGrade?.[lockManagerGrade]?.length || 0) > 0 && (
                        <button
                          onClick={() => clearGradeSlots(lockManagerGrade)}
                          className="px-2 py-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md font-medium transition cursor-pointer"
                          title="Xóa toàn bộ ô khóa của khối này"
                        >
                          Xóa khóa khối
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Grid for Grade */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2 border-r border-slate-200 w-20">Tiết \ Thứ</th>
                          {DAYS_CONFIG.map(d => (
                            <th key={d.day} className="p-2 border-r border-slate-200 last:border-r-0">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {periodsConfig.map(p => (
                          <tr key={p.period}>
                            <td className="p-2 font-bold bg-slate-50 border-r border-slate-200">{p.label}</td>
                            {DAYS_CONFIG.map(d => {
                              const key = `${d.day}_${p.period}`;
                              const isGloballyLocked = (lockedSlots.global || []).includes(key);
                              const isGradeLocked = isGradeSlotLocked(lockManagerGrade, d.day, p.period);

                              if (isGloballyLocked) {
                                return (
                                  <td
                                    key={d.day}
                                    className="p-2 border-r border-slate-200 last:border-r-0 bg-slate-100 text-slate-400 select-none cursor-not-allowed"
                                    title="Ô này đã bị khóa chung cho Toàn trường"
                                  >
                                    <div className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-slate-500 font-medium">
                                      <Lock className="w-3 h-3 text-slate-400" />
                                      <span>Khóa toàn trường</span>
                                    </div>
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={d.day}
                                  onClick={() => toggleGradeSlotLock(lockManagerGrade, d.day, p.period)}
                                  className={`p-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${
                                    isGradeLocked
                                      ? 'bg-amber-100 hover:bg-amber-200 font-bold text-amber-900'
                                      : 'hover:bg-slate-50 text-slate-400'
                                  }`}
                                >
                                  {isGradeLocked ? (
                                    <div className="flex flex-col items-center justify-center gap-0.5 text-amber-800">
                                      <div className="flex items-center gap-1">
                                        <Lock className="w-3.5 h-3.5" />
                                        <span>Khóa</span>
                                      </div>
                                      <span className="text-[10px] font-normal text-amber-700">
                                        Khối {lockManagerGrade}
                                      </span>
                                    </div>
                                  ) : (
                                    <span>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-slate-500 italic">
                    * Nhấp vào từng ô để Bật / Tắt khóa cho Khối {lockManagerGrade}. Áp dụng cho {classes.filter(c => c.grade === lockManagerGrade).length} lớp: {classes.filter(c => c.grade === lockManagerGrade).map(c => c.name).join(', ')}.
                  </p>
                </div>
              )}

              {/* Tab 3: Theo từng Lớp */}
              {lockManagerTab === 'class' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">Chọn lớp:</span>
                      <select
                        value={lockManagerClassId}
                        onChange={e => setLockManagerClassId(e.target.value)}
                        className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800"
                      >
                        {classes.map(c => {
                          const directCount = getClassOffSlots(c).length;
                          const gradeCount = lockedSlots.byGrade?.[c.grade]?.length || 0;
                          return (
                            <option key={c.id} value={c.id}>
                              Lớp {c.name} (Khối {c.grade}) — {directCount} ô riêng {gradeCount > 0 ? `+ ${gradeCount} ô khối` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Notice for current selected class */}
                    {(() => {
                      const selCls = classMap.get(lockManagerClassId);
                      const grCount = selCls ? (lockedSlots.byGrade?.[selCls.grade]?.length || 0) : 0;
                      return grCount > 0 ? (
                        <span className="text-[11px] text-amber-800 bg-amber-50 px-2 py-1 rounded-md border border-amber-200 font-medium">
                          Khối {selCls?.grade} đang khóa {grCount} ô đồng loạt
                        </span>
                      ) : null;
                    })()}
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2 border-r border-slate-200 w-20">Tiết \ Thứ</th>
                          {DAYS_CONFIG.map(d => (
                            <th key={d.day} className="p-2 border-r border-slate-200 last:border-r-0">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {periodsConfig.map(p => (
                          <tr key={p.period}>
                            <td className="p-2 font-bold bg-slate-50 border-r border-slate-200">{p.label}</td>
                            {DAYS_CONFIG.map(d => {
                              const selCls = classMap.get(lockManagerClassId);
                              const key = `${d.day}_${p.period}`;
                              const isGlobal = (lockedSlots.global || []).includes(key);
                              const isGrade = selCls && (lockedSlots.byGrade?.[selCls.grade] || []).includes(key);
                              const isException = selCls ? isClassBreakException(selCls, lockManagerClassId, key) : false;
                              const isClass = getClassOffSlots(selCls, lockManagerClassId).includes(key);

                              if (isGlobal) {
                                return (
                                  <td
                                    key={d.day}
                                    onClick={() => alert(`🔒 Tiết Thứ ${d.day}, Tiết ${p.period} đang bị khóa chung cho Toàn trường. Để mở khóa, vui lòng sang tab "Toàn trường".`)}
                                    className="p-2 border-r border-slate-200 last:border-r-0 bg-slate-100 text-slate-400 select-none cursor-pointer"
                                    title="Khóa theo Toàn trường (nhấp để xem thông tin)"
                                  >
                                    <div className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-slate-500 font-medium">
                                      <Lock className="w-3 h-3 text-slate-400" />
                                      <span>Toàn trường</span>
                                    </div>
                                  </td>
                                );
                              }

                              if (isGrade) {
                                if (isException) {
                                  return (
                                    <td
                                      key={d.day}
                                      onClick={() => {
                                        toggleClassBreakException(lockManagerClassId, d.day, p.period);
                                        if (onNotification) onNotification(`🔒 Đã hủy ngoại lệ: Thứ ${d.day}, Tiết ${p.period} của lớp ${selCls?.name} trở lại nghỉ theo Khối ${selCls?.grade}.`);
                                      }}
                                      className="p-2 border-r border-slate-200 last:border-r-0 bg-emerald-50 text-emerald-800 select-none cursor-pointer hover:bg-emerald-100 transition"
                                      title={`✨ Tiết này vốn thuộc Khối ${selCls?.grade}, nhưng lớp ${selCls?.name} đã MỞ LẠI học bình thường. Nhấp để đóng lại thành nghỉ theo Khối.`}
                                    >
                                      <div className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-emerald-800 font-semibold">
                                        <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Mở lại</span>
                                        <span className="text-[9px] font-normal text-emerald-600">(Đang học)</span>
                                      </div>
                                    </td>
                                  );
                                }

                                return (
                                  <td
                                    key={d.day}
                                    onClick={() => {
                                      toggleClassBreakException(lockManagerClassId, d.day, p.period);
                                      if (onNotification) onNotification(`✨ Đã mở lại Thứ ${d.day}, Tiết ${p.period} cho lớp ${selCls?.name} (ghi đè lịch Khối ${selCls?.grade})!`);
                                    }}
                                    className="p-2 border-r border-slate-200 last:border-r-0 bg-amber-50 text-amber-800 select-none cursor-pointer hover:bg-emerald-50 hover:text-emerald-800 transition group"
                                    title={`🔒 Khóa theo Khối ${selCls?.grade}. Nhấp để MỞ LẠI cho riêng lớp ${selCls?.name} học bình thường (Ghi đè ngoại lệ).`}
                                  >
                                    <div className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-amber-800 group-hover:text-emerald-700 font-semibold">
                                      <Lock className="w-3.5 h-3.5 text-amber-700 group-hover:hidden" />
                                      <Unlock className="w-3.5 h-3.5 text-emerald-600 hidden group-hover:block" />
                                      <span>Khối {selCls?.grade}</span>
                                      <span className="text-[9px] font-normal text-amber-600 group-hover:text-emerald-600">(Click để mở)</span>
                                    </div>
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={d.day}
                                  onClick={() => toggleClassSlotLock(lockManagerClassId, d.day, p.period)}
                                  className={`p-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${
                                    isClass ? 'bg-amber-100 hover:bg-amber-200 font-bold text-amber-900' : 'hover:bg-slate-50 text-slate-400'
                                  }`}
                                >
                                  {isClass ? (
                                    <div className="flex flex-col items-center justify-center gap-0.5 text-amber-800">
                                      <div className="flex items-center gap-1">
                                        <Lock className="w-3.5 h-3.5" />
                                        <span>Khóa</span>
                                      </div>
                                      <span className="text-[10px] font-normal text-amber-700">Riêng lớp</span>
                                    </div>
                                  ) : (
                                    <span>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 3: Teacher */}
              {lockManagerTab === 'teacher' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Chọn giáo viên:</span>
                    <select
                      value={lockManagerTeacherId}
                      onChange={e => setLockManagerTeacherId(e.target.value)}
                      className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800"
                    >
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({getTeacherSubject(t)} - {lockedSlots.byTeacher?.[t.id]?.length || 0} tiết bận)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2 border-r border-slate-200 w-20">Tiết \ Thứ</th>
                          {DAYS_CONFIG.map(d => (
                            <th key={d.day} className="p-2 border-r border-slate-200 last:border-r-0">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {periodsConfig.map(p => (
                          <tr key={p.period}>
                            <td className="p-2 font-bold bg-slate-50 border-r border-slate-200">{p.label}</td>
                            {DAYS_CONFIG.map(d => {
                              const isLocked = isTeacherSlotLocked(lockManagerTeacherId, d.day, p.period);
                              return (
                                <td
                                  key={d.day}
                                  onClick={() => toggleTeacherSlotLock(lockManagerTeacherId, d.day, p.period)}
                                  className={`p-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${
                                    isLocked ? 'bg-rose-100 hover:bg-rose-200 font-bold text-rose-900' : 'hover:bg-slate-50 text-slate-400'
                                  }`}
                                >
                                  {isLocked ? (
                                    <div className="flex items-center justify-center gap-1 text-rose-800">
                                      <Ban className="w-3.5 h-3.5" />
                                      <span>Bận</span>
                                    </div>
                                  ) : (
                                    <span>—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={handleClearAllLocks}
                className="text-xs text-rose-600 hover:text-rose-800 hover:underline font-semibold cursor-pointer"
              >
                Mở khóa tất cả vị trí (Xóa bộ lọc khóa)
              </button>
              <button
                onClick={() => setIsLockManagerOpen(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Hoàn tất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CẤU HÌNH RÀNG BUỘC THƯỜNG DÙNG */}
      {isCommonConstraintsOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-7xl w-full overflow-hidden flex flex-col h-[96vh] max-h-[960px]">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-5 h-5 text-yellow-300" />
                <div>
                  <h3 className="font-bold text-base">Thiết lập Ràng buộc</h3>
                  <p className="text-xs text-blue-100">Cấu hình các điều kiện ràng buộc bổ trợ cho bộ giải tự động OR-Tools CP-SAT</p>
                </div>
              </div>
              <button
                onClick={() => setIsCommonConstraintsOpen(false)}
                className="p-1 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Section: Sidebar + Tab Content */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar */}
              <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
                <div className="p-3 border-b border-slate-200 bg-slate-100/50">
                  {/* Bỏ dòng chữ DANH SÁCH RÀNG BUỘC theo yêu cầu */}
                </div>
                <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                  <div className="pb-1.5 mb-1">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider pl-3 block">Ràng buộc thường dùng</span>
                  </div>
                  <button
                    onClick={() => setActiveConstraintTab('fixed_slots')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'fixed_slots' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Tạo tiết cố định</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('class_off')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'class_off' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Ban className="w-4 h-4 shrink-0" />
                    <span>Tạo tiết nghỉ của lớp</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('teacher_busy')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'teacher_busy' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>Tạo thời gian bận GV</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('teacher_days')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'teacher_days' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Calendar className="w-4 h-4 shrink-0" />
                    <span>Số ngày dạy của GV</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('teacher_sessions')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'teacher_sessions' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4 shrink-0" />
                    <span>Số buổi dạy tối đa GV</span>
                  </button>
                  <div className="pt-2 pb-1 border-t border-slate-200 mt-2">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider pl-3 block">Ràng buộc Nâng cao</span>
                  </div>
                  <button
                    onClick={() => setActiveConstraintTab('teacher_rules')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'teacher_rules' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Users className="w-4 h-4 shrink-0 text-indigo-500" />
                    <span>Ràng buộc Giáo viên</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('lesson_rules')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'lesson_rules' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Layers className="w-4 h-4 shrink-0 text-violet-500" />
                    <span>Ràng buộc Tiết giảng</span>
                  </button>
                  <button
                    onClick={() => setActiveConstraintTab('subject_rules')}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition cursor-pointer ${
                      activeConstraintTab === 'subject_rules' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <BookOpen className="w-4 h-4 shrink-0 text-sky-500" />
                    <span>Ràng buộc Môn học</span>
                  </button>
                </div>
              </div>

              {/* Tab Content Panel */}
              <div className="flex-1 p-3.5 overflow-y-auto bg-white flex flex-col">
                {/* a-Tạo tiết cố định: Hợp nhất 1 bảng ma trận duy nhất */}
                {activeConstraintTab === 'fixed_slots' && (
                  <FixedSlotConstraintModal
                    classes={classes}
                    teachers={teachers}
                    assignments={assignments}
                    subjectsConfig={subjectsConfig}
                    classSubjectPeriods={classSubjectPeriods}
                    customFixedSlots={customFixedSlots}
                    setCustomFixedSlots={setCustomFixedSlots}
                    currentAcademicYear={currentAcademicYear}
                    isCurrentTermLocked={isCurrentTermLocked}
                    currentTermKey={currentTermKey}
                    sessionMode={sessionMode}
                    afternoonPeriodsCount={afternoonPeriodsCount}
                    periodsConfig={periodsConfig}
                    getSubjectPeriod={getSubjectPeriod}
                    getNormalizedAssignedTeacherId={getNormalizedAssignedTeacherId}
                    onNotification={onNotification}
                  />
                )}

                {/* b-Tạo tiết nghỉ của lớp */}
                {activeConstraintTab === 'class_off' && (() => {
                  const isAllScope = selectedOffClassId === 'all';
                  const isGradeScope = selectedOffClassId.startsWith('grade_');
                  const currentGrade = isGradeScope ? (selectedOffClassId.replace('grade_', '') as '10' | '11' | '12') : null;
                  const currentClass = (!isAllScope && !isGradeScope)
                    ? (classMap.get(selectedOffClassId) || classes.find(c =>
                        c.id === selectedOffClassId ||
                        c.name.trim().toLowerCase() === selectedOffClassId.trim().toLowerCase() ||
                        c.id.replace(/^c_/, '').toLowerCase() === selectedOffClassId.replace(/^c_/, '').toLowerCase()
                      ) || null)
                    : null;

                  // Lấy toàn bộ tiết nghỉ riêng của lớp (kiểm tra mọi alias id/name)
                  const currentClassOffSlots = currentClass ? getClassOffSlots(currentClass, selectedOffClassId) : [];

                  // Tính toán số tiết nghỉ hiện tại của phạm vi đang xem
                  let scopeOffCount = 0;
                  let inheritedCount = 0;
                  let overriddenCount = 0;
                  if (isAllScope) {
                    scopeOffCount = (lockedSlots.global || []).length;
                  } else if (isGradeScope && currentGrade) {
                    scopeOffCount = (lockedSlots.byGrade?.[currentGrade] || []).length;
                    inheritedCount = (lockedSlots.global || []).length;
                  } else if (currentClass) {
                    scopeOffCount = currentClassOffSlots.length;
                    const gradeLocks = lockedSlots.byGrade?.[currentClass.grade] || [];
                    const globalLocks = lockedSlots.global || [];
                    const classExceptions = new Set(getClassBreakExceptions(currentClass, selectedOffClassId));
                    overriddenCount = classExceptions.size;
                    const rawInherited = new Set([...gradeLocks, ...globalLocks]);
                    // Các tiết khối đã mở lại không còn tính là bị khóa kế thừa nữa
                    inheritedCount = Array.from(rawInherited).filter(s => !classExceptions.has(s)).length;
                  }

                  // Lấy danh sách tiết nghỉ của phạm vi nguồn để chuẩn bị sao chép
                  const getSourceOffSlots = (): string[] => {
                    if (isAllScope) {
                      return [...(lockedSlots.global || [])];
                    }
                    if (isGradeScope && currentGrade) {
                      return Array.from(new Set([
                        ...(lockedSlots.byGrade?.[currentGrade] || []),
                        ...(lockedSlots.global || [])
                      ]));
                    }
                    if (currentClass) {
                      return Array.from(new Set([
                        ...currentClassOffSlots,
                        ...(lockedSlots.byGrade?.[currentClass.grade] || []),
                        ...(lockedSlots.global || [])
                      ]));
                    }
                    return [];
                  };

                  // Xử lý xóa tất cả tiết nghỉ của phạm vi đang chọn (không dùng window.confirm để tránh kẹt trong iframe)
                  const handleClearScopeLocks = () => {
                    if (isCurrentTermLocked) {
                      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                      if (onNotification) onNotification(msg); else alert(msg);
                      return;
                    }

                    if (isAllScope) {
                      setLockedSlots(prev => {
                        const updated = { ...prev, global: [] };
                        try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                        return updated;
                      });
                      if (onNotification) onNotification('🗑️ Đã xóa toàn bộ các tiết nghỉ chung của TOÀN TRƯỜNG!');
                    } else if (isGradeScope && currentGrade) {
                      setLockedSlots(prev => {
                        const updated = {
                          ...prev,
                          byGrade: {
                            ...(prev.byGrade || {}),
                            [currentGrade]: []
                          }
                        };
                        try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                        return updated;
                      });
                      if (onNotification) onNotification(`🗑️ Đã xóa toàn bộ tiết nghỉ của KHỐI ${currentGrade}!`);
                    } else if (currentClass) {
                      setLockedSlots(prev => {
                        const nextByClass = { ...(prev.byClass || {}) };
                        // Xóa sạch tất cả các key alias liên quan đến lớp này
                        Object.keys(nextByClass).forEach(k => {
                          if (isClassKeyMatch(k, currentClass, selectedOffClassId)) {
                            delete nextByClass[k];
                          }
                        });
                        nextByClass[currentClass.id] = [];
                        const updated = {
                          ...prev,
                          byClass: nextByClass
                        };
                        try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                        return updated;
                      });
                      if (onNotification) onNotification(`🗑️ Đã xóa sạch toàn bộ (${scopeOffCount}) tiết nghỉ riêng của LỚP ${currentClass.name}!`);
                    }
                  };

                  // Xử lý thực hiện sao chép tiết nghỉ sang các phạm vi đích
                  const handleExecuteCopy = () => {
                    if (isCurrentTermLocked) {
                      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                      if (onNotification) onNotification(msg); else alert(msg);
                      return;
                    }

                    if (copyOffTargets.size === 0) {
                      const msg = '⚠️ Vui lòng chọn ít nhất một mục tiêu để sao chép!';
                      if (onNotification) onNotification(msg); else alert(msg);
                      return;
                    }

                    const sourceSlots = getSourceOffSlots();
                    if (sourceSlots.length === 0) {
                      const msg = '⚠️ Phạm vi hiện tại chưa có tiết nghỉ nào để sao chép!';
                      if (onNotification) onNotification(msg); else alert(msg);
                      return;
                    }

                    setLockedSlots(prev => {
                      const nextGlobal = new Set(prev.global || []);
                      const nextByGrade = { ...(prev.byGrade || {}) };
                      const nextByClass = { ...(prev.byClass || {}) };

                      copyOffTargets.forEach(target => {
                        if (target === 'all') {
                          sourceSlots.forEach(s => nextGlobal.add(s));
                        } else if (target.startsWith('grade_')) {
                          const gr = target.replace('grade_', '') as '10' | '11' | '12';
                          const setGr = new Set(nextByGrade[gr] || []);
                          sourceSlots.forEach(s => setGr.add(s));
                          nextByGrade[gr] = Array.from(setGr);
                        } else {
                          // Class target
                          const targetCls = classMap.get(target) || classes.find(c => c.id === target || c.name === target);
                          const targetId = targetCls?.id || target;
                          const setCls = new Set(nextByClass[targetId] || []);
                          sourceSlots.forEach(s => setCls.add(s));
                          nextByClass[targetId] = Array.from(setCls);
                        }
                      });

                      const updated: LockedSlotsConfig = {
                        ...prev,
                        global: Array.from(nextGlobal),
                        byGrade: nextByGrade,
                        byClass: nextByClass
                      };

                      try {
                        localStorage.setItem(lockedStorageKey, JSON.stringify(updated));
                      } catch {}

                      return updated;
                    });

                    // Xóa bài giảng bị xung đột nếu có timetableData
                    if (timetableData) {
                      const sourceSlotsSet = new Set(sourceSlots);
                      setTimetableData(prev => {
                        if (!prev) return null;
                        return {
                          ...prev,
                          lessons: prev.lessons.filter(l => {
                            if (l.isFixed) return true;
                            const slotKey = `${l.day}_${l.period}`;
                            if (!sourceSlotsSet.has(slotKey)) return true;

                            // Kiểm tra lớp có thuộc các target vừa copy không
                            if (copyOffTargets.has('all')) return false;
                            const cls = classMap.get(l.classId);
                            if (cls && copyOffTargets.has(`grade_${cls.grade}`)) return false;
                            if (copyOffTargets.has(l.classId)) return false;
                            return true;
                          })
                        };
                      });
                    }

                    setIsCopyOffModalOpen(false);
                    setCopyOffTargets(new Set());
                    const successMsg = `📋 Đã sao chép thành công ${sourceSlots.length} tiết nghỉ sang ${copyOffTargets.size} phạm vi đã chọn!`;
                    if (onNotification) onNotification(successMsg); else alert(successMsg);
                  };

                  return (
                    <div className="space-y-3 flex-1 flex flex-col">
                      {/* Tiêu đề & Hướng dẫn */}
                      <div className="shrink-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <h4 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                            <Ban className="w-4 h-4 text-amber-600" />
                            <span>Tạo tiết nghỉ của lớp (Toàn trường, Theo Khối & Từng lớp)</span>
                          </h4>
                          {/* Badge thống kê tiết nghỉ */}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5 flex-wrap">
                              {isAllScope && `Toàn trường: ${scopeOffCount} tiết nghỉ`}
                              {isGradeScope && `Khối ${currentGrade}: ${scopeOffCount} tiết riêng ${inheritedCount > 0 ? `(+${inheritedCount} tiết toàn trường)` : ''}`}
                              {currentClass && (
                                <>
                                  <span>Lớp {currentClass.name}: {scopeOffCount} tiết riêng</span>
                                  {inheritedCount > 0 && <span>(+{inheritedCount} tiết chung)</span>}
                                  {overriddenCount > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[10px]">
                                      ✨ Đã mở lại: {overriddenCount} tiết
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Tạo khung giờ trống bắt buộc nghỉ (không xếp môn). Nhấp vào ô bất kỳ để đặt tiết nghỉ hoặc mở lại học bình thường.
                        </p>
                      </div>

                      {/* Thanh công cụ: Chọn phạm vi, Nút Sao chép & Xóa */}
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2.5 shadow-2xs shrink-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Phạm vi áp dụng:</span>
                          </span>
                          <select
                            value={selectedOffClassId}
                            onChange={(e) => setSelectedOffClassId(e.target.value)}
                            className="text-xs border border-slate-300 rounded-lg px-3 py-1 bg-white text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer min-w-[260px]"
                          >
                            <optgroup label="🌐 Áp dụng phạm vi rộng">
                              <option value="all">🌐 Áp dụng Toàn trường (Tất cả các lớp)</option>
                              <option value="grade_10">🏫 Áp dụng toàn bộ Khối 10</option>
                              <option value="grade_11">🏫 Áp dụng toàn bộ Khối 11</option>
                              <option value="grade_12">🏫 Áp dụng toàn bộ Khối 12</option>
                            </optgroup>
                            <optgroup label="🏫 Từng lớp học cụ thể">
                              {classes.map(c => (
                                <option key={c.id} value={c.id}>
                                  Lớp {c.name} (Khối {c.grade})
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>

                        {/* Các nút thao tác bổ trợ */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              const slots = getSourceOffSlots();
                              if (slots.length === 0) {
                                const msg = 'Phạm vi hiện tại chưa có tiết nghỉ nào để sao chép. Vui lòng click chọn ít nhất một ô nghỉ trên bảng trước!';
                                if (onNotification) onNotification(msg); else alert(msg);
                                return;
                              }
                              setCopyOffTargets(new Set());
                              setIsCopyOffModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                            title="Sao chép danh sách tiết nghỉ này sang các Khối hoặc Lớp khác"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Sao chép sang...</span>
                          </button>

                          {currentClass && overriddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) {
                                  const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                                  if (onNotification) onNotification(msg); else alert(msg);
                                  return;
                                }
                                setLockedSlots(prev => {
                                  const nextExceptions = { ...(prev.classBreakExceptions || {}) };
                                  Object.keys(nextExceptions).forEach(k => {
                                    if (isClassKeyMatch(k, currentClass, selectedOffClassId)) {
                                      delete nextExceptions[k];
                                    }
                                  });
                                  nextExceptions[currentClass.id] = [];
                                  const updated = { ...prev, classBreakExceptions: nextExceptions };
                                  try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                                  return updated;
                                });
                                if (onNotification) onNotification(`🔄 Đã khôi phục ${overriddenCount} tiết mở lại của lớp ${currentClass.name} về theo lịch Khối.`);
                              }}
                              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer animate-in fade-in"
                              title="Khôi phục lại tất cả các tiết đã mở lại về nghỉ theo Khối"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Khôi phục lịch Khối ({overriddenCount})</span>
                            </button>
                          )}

                          {scopeOffCount > 0 && (
                            <button
                              type="button"
                              onClick={handleClearScopeLocks}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 hover:border-rose-400 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer animate-in fade-in"
                              title="Xóa tất cả các tiết nghỉ riêng của lớp đang chọn"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                              <span>Xóa hết ({scopeOffCount})</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Chú giải trực quan về các loại tiết nghỉ */}
                      <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-slate-600 shrink-0">
                        <span className="font-semibold text-slate-700">Chú giải:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded bg-purple-100 border border-purple-300 inline-block"></span>
                          <span>🔒 Nghỉ chung (Toàn trường)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded bg-indigo-100 border border-indigo-300 inline-block"></span>
                          <span>🔒 Nghỉ (Khối học)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded bg-emerald-100 border border-emerald-300 inline-block"></span>
                          <span>✨ Mở lại (Ghi đè Khối)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded bg-amber-100 border border-amber-300 inline-block"></span>
                          <span>🚫 Nghỉ riêng của lớp</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-3.5 rounded bg-white border border-slate-300 inline-block"></span>
                          <span>— Học bình thường (Click để đặt nghỉ)</span>
                        </div>
                      </div>

                      {/* Lưới Ma trận Thời gian (Đầy đủ từ Tiết 1 đến Tiết 10) */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs flex-1 min-h-[360px] overflow-y-auto">
                        <table className="w-full text-center text-xs border-collapse">
                          <thead className="bg-[#b4e7ff]/70 text-[#0f547c] font-bold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                            <tr>
                              <th className="py-1.5 px-2 border-r border-slate-200 w-24">Tiết \ Thứ</th>
                              {DAYS_CONFIG.map(d => (
                                <th key={d.day} className="py-1.5 px-2 border-r border-slate-200 last:border-r-0 font-bold">
                                  {d.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {periodsConfig.map(p => {
                              const isFirstAfternoon = p.period === 6;
                              return (
                                <React.Fragment key={p.period}>
                                  {isFirstAfternoon && (
                                    <tr className="bg-sky-50/90 border-y border-sky-200">
                                      <td colSpan={DAYS_CONFIG.length + 1} className="py-1 px-3 text-left font-bold text-sky-800 text-[11px] tracking-wide">
                                        ☀️ CA CHIỀU (Tiết 6 – Tiết {periodsConfig.length})
                                      </td>
                                    </tr>
                                  )}
                                  <tr className="hover:bg-slate-50/60 transition">
                                    <td className="py-1.5 px-2 font-bold bg-slate-50 border-r border-slate-200 text-slate-700 text-xs">
                                      {p.label}
                                    </td>
                                    {DAYS_CONFIG.map(d => {
                                      const key = `${d.day}_${p.period}`;
                                      const isGlobalLocked = (lockedSlots.global || []).includes(key);

                                      let isGradeLocked = false;
                                      let gradeLabel = '';
                                      if (isGradeScope && currentGrade) {
                                        isGradeLocked = (lockedSlots.byGrade?.[currentGrade] || []).includes(key);
                                        gradeLabel = currentGrade;
                                      } else if (currentClass) {
                                        isGradeLocked = (lockedSlots.byGrade?.[currentClass.grade] || []).includes(key);
                                        gradeLabel = currentClass.grade;
                                      }

                                      const isClassLocked = currentClass 
                                        ? currentClassOffSlots.includes(key)
                                        : false;
                                      const isException = currentClass
                                        ? isClassBreakException(currentClass, selectedOffClassId, key)
                                        : false;

                                      // Xử lý click trên ô dựa theo phạm vi đang chọn
                                      const handleCellClick = () => {
                                        if (isCurrentTermLocked) {
                                          const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                                          if (onNotification) onNotification(msg); else alert(msg);
                                          return;
                                        }

                                        // Trường hợp 1: Đang ở chế độ Toàn trường
                                        if (isAllScope) {
                                          toggleGlobalSlotLock(d.day, p.period);
                                          const msg = isGlobalLocked
                                            ? `🔓 Đã mở lại Thứ ${d.day}, Tiết ${p.period} cho TOÀN TRƯỜNG.`
                                            : `🔒 Đã đặt tiết nghỉ Thứ ${d.day}, Tiết ${p.period} cho TOÀN TRƯỜNG!`;
                                          if (onNotification) onNotification(msg);
                                          return;
                                        }

                                        // Trường hợp 2: Đang ở chế độ Khối học
                                        if (isGradeScope && currentGrade) {
                                          if (isGlobalLocked) {
                                            const msg = `ℹ️ Thứ ${d.day}, Tiết ${p.period} đang là tiết nghỉ chung của TOÀN TRƯỜNG. Để điều chỉnh, vui lòng chuyển phạm vi sang "🌐 Áp dụng Toàn trường".`;
                                            if (onNotification) onNotification(msg); else alert(msg);
                                            return;
                                          }
                                          toggleGradeSlotLock(currentGrade, d.day, p.period);
                                          const msg = isGradeLocked
                                            ? `🔓 Đã mở lại Thứ ${d.day}, Tiết ${p.period} cho KHỐI ${currentGrade}.`
                                            : `🔒 Đã đặt tiết nghỉ Thứ ${d.day}, Tiết ${p.period} cho toàn bộ KHỐI ${currentGrade}!`;
                                          if (onNotification) onNotification(msg);
                                          return;
                                        }

                                        // Trường hợp 3: Đang ở chế độ Từng lớp cụ thể
                                        if (currentClass) {
                                          // 3.1: Nếu ô này ĐANG LÀ TIẾT NGHỈ RIÊNG CỦA LỚP -> NGAY LẬP TỨC MỞ LẠI (TOGGLE OFF)
                                          if (isClassLocked) {
                                            setLockedSlots(prev => {
                                              const nextByClass = { ...(prev.byClass || {}) };
                                              Object.keys(nextByClass).forEach(k => {
                                                if (isClassKeyMatch(k, currentClass, selectedOffClassId) && Array.isArray(nextByClass[k])) {
                                                  nextByClass[k] = nextByClass[k].filter(s => s !== key);
                                                }
                                              });
                                              nextByClass[currentClass.id] = (nextByClass[currentClass.id] || []).filter(s => s !== key);
                                              const updated = { ...prev, byClass: nextByClass };
                                              try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                                              return updated;
                                            });
                                            if (onNotification) onNotification(`✅ Đã mở lại Thứ ${d.day}, Tiết ${p.period} cho lớp ${currentClass.name}.`);
                                            return;
                                          }

                                          // 3.2: Nếu chưa là tiết nghỉ riêng, kiểm tra xem có bị trùng với tiết nghỉ chung không
                                          if (isGlobalLocked) {
                                            const msg = `ℹ️ Thứ ${d.day}, Tiết ${p.period} đang là tiết nghỉ chung của TOÀN TRƯỜNG. Để điều chỉnh, vui lòng chuyển phạm vi sang "🌐 Áp dụng Toàn trường".`;
                                            if (onNotification) onNotification(msg); else alert(msg);
                                            return;
                                          }
                                          // 3.3: Nếu ô này là TIẾT NGHỈ THEO KHỐI -> CHO PHÉP GHI ĐÈ NGOẠI LỆ ĐỂ MỞ LẠI HỌC BÌNH THƯỜNG!
                                          if (isGradeLocked) {
                                            toggleClassBreakException(selectedOffClassId, d.day, p.period);
                                            if (isException) {
                                              if (onNotification) onNotification(`🔒 Đã hủy ngoại lệ: Thứ ${d.day}, Tiết ${p.period} của lớp ${currentClass.name} trở lại nghỉ theo Khối ${gradeLabel}.`);
                                            } else {
                                              if (onNotification) onNotification(`✨ Đã mở lại Thứ ${d.day}, Tiết ${p.period} cho lớp ${currentClass.name} (ghi đè lịch nghỉ Khối ${gradeLabel})!`);
                                            }
                                            return;
                                          }

                                          // 3.3: Bật tiết nghỉ riêng (TOGGLE ON)
                                          setLockedSlots(prev => {
                                            const nextByClass = { ...(prev.byClass || {}) };
                                            const setCls = new Set<string>();
                                            Object.keys(nextByClass).forEach(k => {
                                              if (isClassKeyMatch(k, currentClass, selectedOffClassId) && Array.isArray(nextByClass[k])) {
                                                nextByClass[k].forEach(s => setCls.add(s));
                                                delete nextByClass[k];
                                              }
                                            });
                                            setCls.add(key);
                                            nextByClass[currentClass.id] = Array.from(setCls);
                                            const updated = { ...prev, byClass: nextByClass };
                                            try { localStorage.setItem(lockedStorageKey, JSON.stringify(updated)); } catch {}
                                            return updated;
                                          });

                                          if (timetableData) {
                                            setTimetableData(prev => {
                                              if (!prev) return null;
                                              return {
                                                ...prev,
                                                lessons: prev.lessons.filter(l => {
                                                  const matches = isClassKeyMatch(l.classId, currentClass, selectedOffClassId);
                                                  return !(matches && l.day === d.day && l.period === p.period && !l.isFixed);
                                                })
                                              };
                                            });
                                          }

                                          if (onNotification) onNotification(`🚫 Đã đặt tiết nghỉ riêng Thứ ${d.day}, Tiết ${p.period} cho lớp ${currentClass.name}!`);
                                          return;
                                        }
                                      };

                                      // Phân nhánh hiển thị nội dung và màu sắc theo chuẩn yêu cầu
                                      let cellContent = <span>—</span>;
                                      let cellClass = 'hover:bg-slate-50 text-slate-400';
                                      let cellTitle = `Thứ ${d.day}, Tiết ${p.period}: Click để đặt tiết nghỉ`;

                                      if (isAllScope) {
                                        if (isGlobalLocked) {
                                          cellClass = 'bg-purple-100 hover:bg-purple-200 border-purple-300 text-purple-900 font-bold';
                                          cellTitle = `🔒 Tiết nghỉ chung toàn trường (Thứ ${d.day}, Tiết ${p.period}). Click để mở lại.`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-purple-800">
                                              <Lock className="w-3.5 h-3.5 text-purple-700" />
                                              <span className="font-bold text-[11px]">Nghỉ chung</span>
                                            </div>
                                          );
                                        }
                                      } else if (isGradeScope) {
                                        if (isGlobalLocked) {
                                          cellClass = 'bg-purple-50 text-purple-800 border-purple-200 font-bold';
                                          cellTitle = `🔒 Tiết nghỉ chung toàn trường (Kế thừa từ Toàn trường). Chọn "Áp dụng Toàn trường" để thay đổi.`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-purple-700">
                                              <Lock className="w-3.5 h-3.5 text-purple-600" />
                                              <span className="font-semibold text-[11px]">Nghỉ chung</span>
                                            </div>
                                          );
                                        } else if (isGradeLocked) {
                                          cellClass = 'bg-indigo-100 hover:bg-indigo-200 border-indigo-300 text-indigo-900 font-bold';
                                          cellTitle = `🔒 Tiết nghỉ của Khối ${currentGrade} (Thứ ${d.day}, Tiết ${p.period}). Click để mở lại.`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-indigo-800">
                                              <Lock className="w-3.5 h-3.5 text-indigo-700" />
                                              <span className="font-bold text-[11px]">Nghỉ (Khối {currentGrade})</span>
                                            </div>
                                          );
                                        }
                                      } else if (currentClass) {
                                        // Ưu tiên hiển thị: Tiết nghỉ riêng của lớp luôn nổi bật nhất và dễ click hủy
                                        if (isClassLocked) {
                                          cellClass = 'bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-900 font-bold';
                                          cellTitle = `🚫 Tiết nghỉ riêng của lớp ${currentClass.name} (Thứ ${d.day}, Tiết ${p.period}). Click để mở lại tiết này.`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-amber-800">
                                              <Ban className="w-3.5 h-3.5 text-amber-600" />
                                              <span className="font-bold text-[11px]">🚫 Nghỉ riêng</span>
                                            </div>
                                          );
                                        } else if (isGlobalLocked) {
                                          cellClass = 'bg-purple-50 text-purple-800 border-purple-200 font-bold';
                                          cellTitle = `🔒 Tiết nghỉ chung toàn trường (Áp dụng cho tất cả các lớp).`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-purple-700">
                                              <Lock className="w-3.5 h-3.5 text-purple-600" />
                                              <span className="font-semibold text-[11px]">Nghỉ chung</span>
                                            </div>
                                          );
                                        } else if (isGradeLocked && isException) {
                                          // Ô vốn là nghỉ của Khối nhưng lớp này ĐÃ MỞ LẠI để học bình thường
                                          cellClass = 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-800 font-bold';
                                          cellTitle = `✨ Tiết này vốn là lịch nghỉ của Khối ${gradeLabel}, nhưng lớp ${currentClass.name} đã MỞ LẠI học bình thường. Click để quay lại nghỉ theo Khối.`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-emerald-800">
                                              <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                                              <span className="font-bold text-[11px]">Mở lại (Đang học)</span>
                                            </div>
                                          );
                                        } else if (isGradeLocked) {
                                          cellClass = 'bg-indigo-50 hover:bg-emerald-50 border-indigo-200 font-bold cursor-pointer group';
                                          cellTitle = `🔒 Tiết nghỉ theo Khối ${gradeLabel}. Click để MỞ LẠI cho riêng lớp ${currentClass.name} học bình thường (Ghi đè ngoại lệ).`;
                                          cellContent = (
                                            <div className="flex items-center justify-center gap-1 text-indigo-700 group-hover:text-emerald-700">
                                              <Lock className="w-3.5 h-3.5 text-indigo-600 group-hover:hidden" />
                                              <Unlock className="w-3.5 h-3.5 text-emerald-600 hidden group-hover:inline-block" />
                                              <span className="font-semibold text-[11px] group-hover:hidden">Nghỉ (Khối {gradeLabel})</span>
                                              <span className="font-semibold text-[11px] hidden group-hover:inline-block">Mở lại học</span>
                                            </div>
                                          );
                                        }
                                      }

                                      return (
                                        <td
                                          key={d.day}
                                          onClick={handleCellClick}
                                          className={`py-1.5 px-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${cellClass}`}
                                          title={cellTitle}
                                        >
                                          {cellContent}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Modal Sao chép tiết nghỉ sang các phạm vi khác */}
                      {isCopyOffModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
                          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
                            <div className="p-4 border-b border-slate-200 bg-indigo-50/60 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Copy className="w-5 h-5 text-indigo-600" />
                                <div>
                                  <h3 className="font-bold text-sm text-slate-800">Sao chép tiết nghỉ</h3>
                                  <p className="text-xs text-slate-500">
                                    Nguồn: <strong>
                                      {isAllScope && 'Toàn trường'}
                                      {isGradeScope && `Khối ${currentGrade}`}
                                      {currentClass && `Lớp ${currentClass.name}`}
                                    </strong> ({getSourceOffSlots().length} tiết nghỉ)
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsCopyOffModalOpen(false)}
                                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="p-4 space-y-3 overflow-y-auto flex-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-700">Chọn các phạm vi đích cần áp dụng:</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const allT = new Set<string>(['grade_10', 'grade_11', 'grade_12', ...classes.map(c => c.id)]);
                                      setCopyOffTargets(allT);
                                    }}
                                    className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                                  >
                                    Chọn tất cả
                                  </button>
                                  <span>•</span>
                                  <button
                                    type="button"
                                    onClick={() => setCopyOffTargets(new Set())}
                                    className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                                  >
                                    Bỏ chọn
                                  </button>
                                </div>
                              </div>

                              {/* Danh sách mục tiêu cấp Toàn trường & Khối */}
                              <div className="space-y-1.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                  Phạm vi Khối & Toàn trường
                                </span>
                                <label className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer font-bold text-xs text-indigo-900 transition">
                                  <input
                                    type="checkbox"
                                    checked={copyOffTargets.has('all')}
                                    onChange={(e) => {
                                      const next = new Set(copyOffTargets);
                                      if (e.target.checked) next.add('all');
                                      else next.delete('all');
                                      setCopyOffTargets(next);
                                    }}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span>🌐 Áp dụng Toàn trường (Tất cả 44 lớp)</span>
                                </label>
                                {(['10', '11', '12'] as const).map(gr => (
                                  <label key={gr} className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer font-semibold text-xs text-slate-800 transition">
                                    <input
                                      type="checkbox"
                                      checked={copyOffTargets.has(`grade_${gr}`)}
                                      onChange={(e) => {
                                        const next = new Set(copyOffTargets);
                                        if (e.target.checked) next.add(`grade_${gr}`);
                                        else next.delete(`grade_${gr}`);
                                        setCopyOffTargets(next);
                                      }}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span>🏫 Toàn bộ Khối {gr} ({classes.filter(c => c.grade === gr).length} lớp)</span>
                                  </label>
                                ))}
                              </div>

                              {/* Danh sách từng lớp cụ thể */}
                              <div className="space-y-2">
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                                  Từng lớp học cụ thể ({classes.length} lớp)
                                </span>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-1 border border-slate-200 rounded-lg">
                                  {classes.map(c => {
                                    const isChecked = copyOffTargets.has(c.id);
                                    return (
                                      <label
                                        key={c.id}
                                        className={`flex items-center gap-1.5 p-1.5 rounded border text-xs cursor-pointer transition ${
                                          isChecked
                                            ? 'bg-indigo-50 border-indigo-300 font-bold text-indigo-900'
                                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            const next = new Set(copyOffTargets);
                                            if (e.target.checked) next.add(c.id);
                                            else next.delete(c.id);
                                            setCopyOffTargets(next);
                                          }}
                                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span>Lớp {c.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>

                            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setIsCopyOffModalOpen(false)}
                                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 cursor-pointer"
                              >
                                Hủy bỏ
                              </button>
                              <button
                                type="button"
                                onClick={handleExecuteCopy}
                                disabled={copyOffTargets.size === 0}
                                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Xác nhận sao chép ({copyOffTargets.size} mục tiêu)</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* c-Tạo thời gian bận GV */}
                {activeConstraintTab === 'teacher_busy' && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1">Tạo thời gian bận Giáo viên</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Chỉ định khung thời gian bận (không được xếp lịch dạy) cho một giáo viên do việc cá nhân, đi công tác hoặc kiêm nhiệm.
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-semibold text-slate-700">Chọn giáo viên:</span>
                      <select
                        value={selectedBusyTeacherId}
                        onChange={(e) => setSelectedBusyTeacherId(e.target.value)}
                        className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800 font-bold"
                      >
                        {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({getTeacherSubject(t)})</option>)}
                      </select>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-center text-xs border-collapse">
                        <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-2 border-r border-slate-200 w-20">Tiết \ Thứ</th>
                            {DAYS_CONFIG.map(d => (
                              <th key={d.day} className="p-2 border-r border-slate-200 last:border-r-0">{d.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {periodsConfig.map(p => (
                            <tr key={p.period}>
                              <td className="p-2 font-bold bg-slate-50 border-r border-slate-200">{p.label}</td>
                              {DAYS_CONFIG.map(d => {
                                const isLocked = isTeacherSlotLocked(selectedBusyTeacherId, d.day, p.period);
                                return (
                                  <td
                                    key={d.day}
                                    onClick={() => toggleTeacherSlotLock(selectedBusyTeacherId, d.day, p.period)}
                                    className={`p-2 border-r border-slate-200 last:border-r-0 cursor-pointer transition select-none ${
                                      isLocked ? 'bg-rose-100 hover:bg-rose-200 font-bold text-rose-900' : 'hover:bg-slate-50 text-slate-400'
                                    }`}
                                  >
                                    {isLocked ? (
                                      <div className="flex items-center justify-center gap-1 text-rose-800">
                                        <Ban className="w-3.5 h-3.5" />
                                        <span className="font-semibold">Bận dạy</span>
                                      </div>
                                    ) : (
                                      <span>—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* d-Số ngày dạy của GV */}
                {activeConstraintTab === 'teacher_days' && (() => {
                  const isDaysConfigured = (t: Teacher) => {
                    const val = teacherConstraints[t.id]?.maxDays;
                    return val !== undefined && val !== null && Number(val) > 0;
                  };

                  const totalDaysConfigured = teachers.filter(isDaysConfigured).length;

                  const filteredDaysTeachers = teachers.filter(t => {
                    if (!matchesTeacherSearch(t, teacherDaysSearch)) return false;
                    if (teacherDaysDept !== 'all' && getTeacherSubject(t) !== teacherDaysDept) return false;
                    if (teacherDaysStatus === 'configured' && !isDaysConfigured(t)) return false;
                    return true;
                  });

                  const displayedDaysConfigured = filteredDaysTeachers.filter(isDaysConfigured).length;
                  const isDaysFilterActive = teacherDaysSearch !== '' || teacherDaysDept !== 'all' || teacherDaysStatus !== 'all';

                  const handleResetDaysFilters = () => {
                    setTeacherDaysSearch('');
                    setTeacherDaysDept('all');
                    setTeacherDaysStatus('all');
                  };

                  return (
                    <div className="space-y-3.5 flex flex-col h-full">
                      {/* Tiêu đề & Hướng dẫn */}
                      <div className="shrink-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <h4 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-indigo-600" />
                            <span>Số ngày dạy của Giáo viên</span>
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {totalDaysConfigured > 0 ? `${totalDaysConfigured}/${teachers.length} GV đã đặt số ngày` : `Chưa có GV nào bị giới hạn ngày`}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Thiết lập số ngày tối đa được phân công dạy trong tuần của giáo viên để nén lịch biểu, giúp giáo viên không bị rải rác tiết dạy ở quá nhiều ngày.
                        </p>
                      </div>

                      {/* THANH CÔNG CỤ TÌM KIẾM & BỘ LỌC */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 shadow-2xs shrink-0">
                        <div className="flex flex-wrap items-center gap-2.5 justify-between">
                          {/* Left: Input search & Department dropdown */}
                          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
                            {/* Ô tìm kiếm theo tên giáo viên */}
                            <div className="relative flex-1 min-w-[220px] max-w-sm">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                value={teacherDaysSearch}
                                onChange={(e) => setTeacherDaysSearch(e.target.value)}
                                placeholder="🔍 Tìm kiếm theo tên giáo viên..."
                                className="w-full text-xs pl-8 pr-7 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-2xs"
                              />
                              {teacherDaysSearch && (
                                <button
                                  type="button"
                                  onClick={() => setTeacherDaysSearch('')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                                  title="Xóa từ khóa tìm kiếm"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Dropdown Bộ môn */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Filter className="w-3.5 h-3.5 text-slate-400" />
                              <select
                                value={teacherDaysDept}
                                onChange={(e) => setTeacherDaysDept(e.target.value)}
                                className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer min-w-[150px]"
                              >
                                <option value="all">Tất cả bộ môn ({teachers.length})</option>
                                {teacherSpecializations.map(s => {
                                  const count = teachers.filter(t => getTeacherSubject(t) === s).length;
                                  return <option key={s} value={s}>{s} ({count})</option>;
                                })}
                              </select>
                            </div>
                          </div>

                          {/* Right: Nút chuyển nhanh trạng thái (Toggle / Filter Tag) */}
                          <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 shrink-0">
                            <button
                              type="button"
                              onClick={() => setTeacherDaysStatus('all')}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                                teacherDaysStatus === 'all'
                                  ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                              }`}
                            >
                              Tất cả GV ({teachers.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setTeacherDaysStatus('configured')}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                                teacherDaysStatus === 'configured'
                                  ? 'bg-amber-600 text-white shadow-2xs font-bold'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                              }`}
                            >
                              <span>Đã thiết lập</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                teacherDaysStatus === 'configured'
                                  ? 'bg-amber-800 text-white'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {totalDaysConfigured}
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Dòng trạng thái số lượng & nút Xóa bộ lọc */}
                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/60">
                          <div className="flex items-center gap-2">
                            <span>
                              Hiển thị: <strong className="font-bold text-slate-800">{filteredDaysTeachers.length}</strong>/{teachers.length} giáo viên
                              {displayedDaysConfigured > 0 && (
                                <span className="ml-1 text-amber-700 font-semibold">
                                  ({displayedDaysConfigured} đã thiết lập)
                                </span>
                              )}
                            </span>
                          </div>

                          {isDaysFilterActive && (
                            <button
                              type="button"
                              onClick={handleResetDaysFilters}
                              className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 hover:underline cursor-pointer transition"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Xóa bộ lọc</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* BẢNG DANH SÁCH GIÁO VIÊN */}
                      <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl min-h-[360px] max-h-[520px] shadow-2xs">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead className="bg-[#b4e7ff]/70 text-[#0f547c] font-bold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                            <tr>
                              <th className="py-2.5 px-3 pl-4 w-12 text-center text-slate-500">STT</th>
                              <th className="py-2.5 px-3">Giáo viên</th>
                              <th className="py-2.5 px-3">Bộ môn</th>
                              <th className="py-2.5 px-3 text-center">Số ngày tối đa (Thứ 2 - 7)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredDaysTeachers.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-12 text-center text-slate-400">
                                  <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                                  <p className="font-semibold text-slate-600">Không tìm thấy giáo viên nào phù hợp</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">Thử thay đổi từ khóa tìm kiếm hoặc chọn "Tất cả bộ môn"</p>
                                  {isDaysFilterActive && (
                                    <button
                                      type="button"
                                      onClick={handleResetDaysFilters}
                                      className="mt-3 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold cursor-pointer transition"
                                    >
                                      Xóa bộ lọc để hiển thị tất cả
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ) : (
                              filteredDaysTeachers.map((t, idx) => {
                                const currentLimit = teacherConstraints[t.id]?.maxDays || '';
                                const isConfigured = currentLimit !== '' && Number(currentLimit) > 0;
                                return (
                                  <tr
                                    key={t.id}
                                    className={`hover:bg-slate-50/80 transition ${
                                      isConfigured ? 'bg-amber-50/40' : ''
                                    }`}
                                  >
                                    <td className="py-2 px-3 pl-4 text-center font-mono text-slate-400 text-[11px]">
                                      {idx + 1}
                                    </td>
                                    <td className="py-2 px-3 font-semibold text-slate-800">
                                      <div className="flex items-center gap-1.5">
                                        <span>{t.name}</span>
                                        {isConfigured && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                            Tối đa {currentLimit} ngày
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 text-slate-600 font-medium">{getTeacherSubject(t)}</td>
                                    <td className="py-2 px-3 text-center">
                                      <select
                                        value={currentLimit}
                                        onChange={(e) => {
                                          if (isCurrentTermLocked) {
                                            const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                                            if (onNotification) onNotification(msg); else alert(msg);
                                            return;
                                          }
                                          const val = e.target.value ? Number(e.target.value) : undefined;
                                          setTeacherConstraints(prev => ({
                                            ...prev,
                                            [t.id]: {
                                              ...(prev[t.id] || {}),
                                              maxDays: val
                                            }
                                          }));
                                        }}
                                        className={`border rounded px-2.5 py-1 text-xs font-bold cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs ${
                                          isConfigured
                                            ? 'border-amber-400 bg-amber-50 text-amber-900 ring-1 ring-amber-300'
                                            : 'border-slate-300 bg-white text-slate-700'
                                        }`}
                                      >
                                        <option value="">Không giới hạn</option>
                                        <option value="2">Tối đa 2 ngày</option>
                                        <option value="3">Tối đa 3 ngày</option>
                                        <option value="4">Tối đa 4 ngày</option>
                                        <option value="5">Tối đa 5 ngày</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* e-Số buổi dạy tối đa của GV */}
                {activeConstraintTab === 'teacher_sessions' && (() => {
                  const isSessionsConfigured = (t: Teacher) => {
                    const val = teacherConstraints[t.id]?.maxSessions;
                    return val !== undefined && val !== null && Number(val) > 0;
                  };

                  const totalSessionsConfigured = teachers.filter(isSessionsConfigured).length;

                  const filteredSessionsTeachers = teachers.filter(t => {
                    if (!matchesTeacherSearch(t, teacherSessionsSearch)) return false;
                    if (teacherSessionsDept !== 'all' && getTeacherSubject(t) !== teacherSessionsDept) return false;
                    if (teacherSessionsStatus === 'configured' && !isSessionsConfigured(t)) return false;
                    return true;
                  });

                  const displayedSessionsConfigured = filteredSessionsTeachers.filter(isSessionsConfigured).length;
                  const isSessionsFilterActive = teacherSessionsSearch !== '' || teacherSessionsDept !== 'all' || teacherSessionsStatus !== 'all';

                  const handleResetSessionsFilters = () => {
                    setTeacherSessionsSearch('');
                    setTeacherSessionsDept('all');
                    setTeacherSessionsStatus('all');
                  };

                  return (
                    <div className="space-y-3.5 flex flex-col h-full">
                      {/* Tiêu đề & Hướng dẫn */}
                      <div className="shrink-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <h4 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                            <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
                            <span>Số buổi dạy tối đa của Giáo viên</span>
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {totalSessionsConfigured > 0 ? `${totalSessionsConfigured}/${teachers.length} GV đã đặt số buổi` : `Chưa có GV nào bị giới hạn buổi`}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Khống chế số lượng buổi dạy tối đa trong tuần (buổi sáng hoặc buổi chiều tùy theo ca học) giúp giáo viên giảm tần suất di chuyển đến trường.
                        </p>
                      </div>

                      {/* THANH CÔNG CỤ TÌM KIẾM & BỘ LỌC */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 shadow-2xs shrink-0">
                        <div className="flex flex-wrap items-center gap-2.5 justify-between">
                          {/* Left: Input search & Department dropdown */}
                          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
                            {/* Ô tìm kiếm theo tên giáo viên */}
                            <div className="relative flex-1 min-w-[220px] max-w-sm">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                value={teacherSessionsSearch}
                                onChange={(e) => setTeacherSessionsSearch(e.target.value)}
                                placeholder="🔍 Tìm kiếm theo tên giáo viên..."
                                className="w-full text-xs pl-8 pr-7 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-2xs"
                              />
                              {teacherSessionsSearch && (
                                <button
                                  type="button"
                                  onClick={() => setTeacherSessionsSearch('')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                                  title="Xóa từ khóa tìm kiếm"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Dropdown Bộ môn */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Filter className="w-3.5 h-3.5 text-slate-400" />
                              <select
                                value={teacherSessionsDept}
                                onChange={(e) => setTeacherSessionsDept(e.target.value)}
                                className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer min-w-[150px]"
                              >
                                <option value="all">Tất cả bộ môn ({teachers.length})</option>
                                {teacherSpecializations.map(s => {
                                  const count = teachers.filter(t => getTeacherSubject(t) === s).length;
                                  return <option key={s} value={s}>{s} ({count})</option>;
                                })}
                              </select>
                            </div>
                          </div>

                          {/* Right: Nút chuyển nhanh trạng thái (Toggle / Filter Tag) */}
                          <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 shrink-0">
                            <button
                              type="button"
                              onClick={() => setTeacherSessionsStatus('all')}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                                teacherSessionsStatus === 'all'
                                  ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                              }`}
                            >
                              Tất cả GV ({teachers.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setTeacherSessionsStatus('configured')}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                                teacherSessionsStatus === 'configured'
                                  ? 'bg-amber-600 text-white shadow-2xs font-bold'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                              }`}
                            >
                              <span>Đã thiết lập</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                teacherSessionsStatus === 'configured'
                                  ? 'bg-amber-800 text-white'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {totalSessionsConfigured}
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Dòng trạng thái số lượng & nút Xóa bộ lọc */}
                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/60">
                          <div className="flex items-center gap-2">
                            <span>
                              Hiển thị: <strong className="font-bold text-slate-800">{filteredSessionsTeachers.length}</strong>/{teachers.length} giáo viên
                              {displayedSessionsConfigured > 0 && (
                                <span className="ml-1 text-amber-700 font-semibold">
                                  ({displayedSessionsConfigured} đã thiết lập)
                                </span>
                              )}
                            </span>
                          </div>

                          {isSessionsFilterActive && (
                            <button
                              type="button"
                              onClick={handleResetSessionsFilters}
                              className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 hover:underline cursor-pointer transition"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Xóa bộ lọc</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* BẢNG DANH SÁCH GIÁO VIÊN */}
                      <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl min-h-[360px] max-h-[520px] shadow-2xs">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead className="bg-[#b4e7ff]/70 text-[#0f547c] font-bold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                            <tr>
                              <th className="py-2.5 px-3 pl-4 w-12 text-center text-slate-500">STT</th>
                              <th className="py-2.5 px-3">Giáo viên</th>
                              <th className="py-2.5 px-3">Bộ môn</th>
                              <th className="py-2.5 px-3 text-center">Số buổi dạy tối đa / tuần</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredSessionsTeachers.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-12 text-center text-slate-400">
                                  <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                                  <p className="font-semibold text-slate-600">Không tìm thấy giáo viên nào phù hợp</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">Thử thay đổi từ khóa tìm kiếm hoặc chọn "Tất cả bộ môn"</p>
                                  {isSessionsFilterActive && (
                                    <button
                                      type="button"
                                      onClick={handleResetSessionsFilters}
                                      className="mt-3 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold cursor-pointer transition"
                                    >
                                      Xóa bộ lọc để hiển thị tất cả
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ) : (
                              filteredSessionsTeachers.map((t, idx) => {
                                const currentLimit = teacherConstraints[t.id]?.maxSessions || '';
                                const isConfigured = currentLimit !== '' && Number(currentLimit) > 0;
                                return (
                                  <tr
                                    key={t.id}
                                    className={`hover:bg-slate-50/80 transition ${
                                      isConfigured ? 'bg-amber-50/40' : ''
                                    }`}
                                  >
                                    <td className="py-2 px-3 pl-4 text-center font-mono text-slate-400 text-[11px]">
                                      {idx + 1}
                                    </td>
                                    <td className="py-2 px-3 font-semibold text-slate-800">
                                      <div className="flex items-center gap-1.5">
                                        <span>{t.name}</span>
                                        {isConfigured && (
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                            Tối đa {currentLimit} buổi
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 text-slate-600 font-medium">{getTeacherSubject(t)}</td>
                                    <td className="py-2 px-3 text-center">
                                      <select
                                        value={currentLimit}
                                        onChange={(e) => {
                                          if (isCurrentTermLocked) {
                                            const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
                                            if (onNotification) onNotification(msg); else alert(msg);
                                            return;
                                          }
                                          const val = e.target.value ? Number(e.target.value) : undefined;
                                          setTeacherConstraints(prev => ({
                                            ...prev,
                                            [t.id]: {
                                              ...(prev[t.id] || {}),
                                              maxSessions: val
                                            }
                                          }));
                                        }}
                                        className={`border rounded px-2.5 py-1 text-xs font-bold cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs ${
                                          isConfigured
                                            ? 'border-amber-400 bg-amber-50 text-amber-900 ring-1 ring-amber-300'
                                            : 'border-slate-300 bg-white text-slate-700'
                                        }`}
                                      >
                                        <option value="">Không giới hạn</option>
                                        <option value="1">Tối đa 1 buổi</option>
                                        <option value="2">Tối đa 2 buổi</option>
                                        <option value="3">Tối đa 3 buổi</option>
                                        <option value="4">Tối đa 4 buổi</option>
                                        <option value="5">Tối đa 5 buổi</option>
                                        <option value="6">Tối đa 6 buổi</option>
                                        <option value="7">Tối đa 7 buổi</option>
                                        <option value="8">Tối đa 8 buổi</option>
                                        <option value="9">Tối đa 9 buổi</option>
                                        <option value="10">Tối đa 10 buổi</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* f-Ràng buộc Giáo viên */}
                {activeConstraintTab === 'teacher_rules' && (
                  <div className="space-y-5">
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1">Ràng buộc phân bổ lịch giảng dạy cho Giáo viên</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Cấu hình các chỉ số nén lịch, khống chế số tiết trống lắt léo, hoặc cài đặt lịch họp hội đồng sư phạm cho giáo viên.
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 text-xs">
                      {/* Gaps & Consecutive */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="font-semibold text-slate-700 block">Số tiết trống lắt léo (tiết lửng) tối đa trong ngày:</label>
                          <p className="text-[10px] text-slate-400">Giới hạn số tiết trống giữa các tiết giảng dạy trong ngày.</p>
                          <select
                            value={advancedConstraints.teacherMaxGaps}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, teacherMaxGaps: Number(e.target.value) }));
                            }}
                            className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="0">0 tiết (Nén lịch tối đa, không có tiết trống)</option>
                            <option value="1">Tối đa 1 tiết trống</option>
                            <option value="2">Tối đa 2 tiết trống</option>
                            <option value="3">Tối đa 3 tiết trống</option>
                            <option value="99">Không giới hạn</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="font-semibold text-slate-700 block">Số tiết dạy liên tục tối đa:</label>
                          <p className="text-[10px] text-slate-400">Tránh vắt kiệt sức khỏe giáo viên khi xếp quá nhiều tiết liên tiếp.</p>
                          <select
                            value={advancedConstraints.teacherMaxConsecutive}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, teacherMaxConsecutive: Number(e.target.value) }));
                            }}
                            className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="2">Tối đa 2 tiết liên tục</option>
                            <option value="3">Tối đa 3 tiết liên tục</option>
                            <option value="4">Tối đa 4 tiết liên tục</option>
                            <option value="5">Tối đa 5 tiết liên tục</option>
                            <option value="99">Không giới hạn</option>
                          </select>
                        </div>
                      </div>

                      {/* Sessions & Min periods per session */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200/60">
                        <div className="space-y-1">
                          <label className="font-semibold text-slate-700 block">Số tiết tối thiểu cho mỗi buổi có lịch dạy:</label>
                          <p className="text-[10px] text-slate-400">Đảm bảo giáo viên đi dạy thì phải dạy ít nhất số tiết quy định.</p>
                          <select
                            value={advancedConstraints.teacherMinPeriodsPerSession}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, teacherMinPeriodsPerSession: Number(e.target.value) }));
                            }}
                            className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="1">Ít nhất 1 tiết / buổi</option>
                            <option value="2">Ít nhất 2 tiết / buổi</option>
                            <option value="3">Ít nhất 3 tiết / buổi</option>
                          </select>
                        </div>

                        <div className="space-y-1.5 flex flex-col justify-end">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="teacherOnlyOneSession"
                              checked={advancedConstraints.teacherOnlyOneSession}
                              onChange={(e) => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({ ...prev, teacherOnlyOneSession: e.target.checked }));
                              }}
                              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                            />
                            <label htmlFor="teacherOnlyOneSession" className="font-semibold text-slate-700 cursor-pointer select-none">
                              Chỉ xếp dạy 1 buổi trong ngày (Sáng hoặc Chiều)
                            </label>
                          </div>
                          <p className="text-[10px] text-slate-400 pl-6">Nghiêm cấm xếp lịch của cùng một giáo viên ở cả ca sáng và ca chiều trong cùng một ngày.</p>
                        </div>
                      </div>

                      {/* No First Period */}
                      <div className="pt-2 border-t border-slate-200/60 flex items-start gap-2">
                        <input
                          type="checkbox"
                          id="teacherNoFirstPeriod"
                          checked={advancedConstraints.teacherNoFirstPeriod}
                          onChange={(e) => {
                            if (isCurrentTermLocked) return;
                            setAdvancedConstraints(prev => ({ ...prev, teacherNoFirstPeriod: e.target.checked }));
                          }}
                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <label htmlFor="teacherNoFirstPeriod" className="font-semibold text-slate-700 cursor-pointer select-none">
                            Ưu tiên tránh xếp Tiết 1 đầu giờ cho giáo viên
                          </label>
                          <p className="text-[10px] text-slate-400">Bộ giải sẽ cố gắng không xếp tiết 1 đầu ngày cho GV (ngoại trừ Chào cờ hoặc trường hợp bất khả kháng).</p>
                        </div>
                      </div>

                      {/* Council & Department Meeting */}
                      <div className="pt-3 border-t border-slate-200/70 space-y-3">
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="font-bold text-slate-800 text-xs block">
                              Ngày sinh hoạt hội đồng / sinh hoạt tổ chuyên môn:
                            </label>
                            <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200/50">
                              Khóa lịch sinh hoạt chuyên môn
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Khi chọn ngày sinh hoạt cho một môn học cụ thể (hoặc toàn trường), tất cả giáo viên môn đó sẽ không có tiết dạy vào ngày/buổi tương ứng để tham gia sinh hoạt tổ chuyên môn.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                          {/* Subject Selector */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 block">
                              Môn học / Tổ chuyên môn:
                            </label>
                            <select
                              value={advancedConstraints.teacherMeetingSubject || ''}
                              onChange={(e) => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({ ...prev, teacherMeetingSubject: e.target.value }));
                              }}
                              className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500 hover:border-slate-400 transition"
                            >
                              <option value="">Tất cả môn (Hội đồng toàn trường)</option>
                              {subjectsConfig.map(s => (
                                <option key={s.id} value={s.id}>
                                  Môn {s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Meeting Day Selector */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 block">
                              Ngày sinh hoạt:
                            </label>
                            <select
                              value={advancedConstraints.teacherMeetingDay}
                              onChange={(e) => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({ ...prev, teacherMeetingDay: Number(e.target.value) }));
                              }}
                              className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500 hover:border-slate-400 transition"
                            >
                              <option value="0">Không có ngày sinh hoạt chung</option>
                              <option value="2">Thứ Hai</option>
                              <option value="3">Thứ Ba</option>
                              <option value="4">Thứ Tư</option>
                              <option value="5">Thứ Năm</option>
                              <option value="6">Thứ Sáu</option>
                              <option value="7">Thứ Bảy</option>
                            </select>
                          </div>

                          {/* Meeting Session Selector */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 block">
                              Buổi sinh hoạt:
                            </label>
                            <select
                              value={advancedConstraints.teacherMeetingSession}
                              onChange={(e) => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({ ...prev, teacherMeetingSession: e.target.value as any }));
                              }}
                              className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500 hover:border-slate-400 transition"
                            >
                              <option value="all">Khóa cả ngày</option>
                              <option value="morning">Chỉ khóa buổi Sáng</option>
                              <option value="afternoon">Chỉ khóa buổi Chiều</option>
                            </select>
                          </div>
                        </div>

                        {/* Status notification tag for current selection */}
                        {advancedConstraints.teacherMeetingDay > 0 && (
                          <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-[11px]">
                            <span className="font-semibold shrink-0">
                              📌 Đang áp dụng:
                            </span>
                            <span>
                              {advancedConstraints.teacherMeetingSubject
                                ? `Tất cả giáo viên môn ${advancedConstraints.teacherMeetingSubject}`
                                : 'Toàn bộ giáo viên toàn trường'}{' '}
                              nghỉ dạy vào{' '}
                              <strong className="font-bold underline">
                                {advancedConstraints.teacherMeetingDay === 2 ? 'Thứ Hai' :
                                 advancedConstraints.teacherMeetingDay === 3 ? 'Thứ Ba' :
                                 advancedConstraints.teacherMeetingDay === 4 ? 'Thứ Tư' :
                                 advancedConstraints.teacherMeetingDay === 5 ? 'Thứ Năm' :
                                 advancedConstraints.teacherMeetingDay === 6 ? 'Thứ Sáu' : 'Thứ Bảy'}
                              </strong>{' '}
                              ({advancedConstraints.teacherMeetingSession === 'all' ? 'Cả ngày' :
                                advancedConstraints.teacherMeetingSession === 'morning' ? 'Buổi Sáng' : 'Buổi Chiều'}) để sinh hoạt chuyên môn (TKB không sắp vào thời gian này).
                            </span>
                          </div>
                        )}

                        {/* Additional Multi-Subject Rules Section */}
                        <div className="pt-2 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-semibold text-slate-700">
                              Lịch sinh hoạt chuyên môn theo các tổ bộ môn khác ({advancedConstraints.teacherMeetingRules?.length || 0}):
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                const defaultSub = subjectsConfig[0]?.id || 'Toán';
                                const newRule = {
                                  id: `rule_${Date.now()}`,
                                  subject: defaultSub,
                                  day: 5,
                                  session: 'afternoon' as const
                                };
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  teacherMeetingRules: [...(prev.teacherMeetingRules || []), newRule]
                                }));
                              }}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-0.5 rounded transition inline-flex items-center gap-1 border border-indigo-200"
                            >
                              + Thêm lịch cho tổ bộ môn khác
                            </button>
                          </div>

                          {advancedConstraints.teacherMeetingRules && advancedConstraints.teacherMeetingRules.length > 0 && (
                            <div className="space-y-2">
                              {advancedConstraints.teacherMeetingRules.map((rule, idx) => (
                                <div key={rule.id || idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
                                  <div>
                                    <label className="text-[10px] text-slate-400 block sm:hidden">Môn học:</label>
                                    <select
                                      value={rule.subject}
                                      onChange={(e) => {
                                        if (isCurrentTermLocked) return;
                                        const updated = [...(advancedConstraints.teacherMeetingRules || [])];
                                        updated[idx] = { ...updated[idx], subject: e.target.value };
                                        setAdvancedConstraints(prev => ({ ...prev, teacherMeetingRules: updated }));
                                      }}
                                      className="w-full border border-slate-300 rounded px-2 py-1 bg-white text-xs font-semibold text-slate-800"
                                    >
                                      {subjectsConfig.map(s => (
                                        <option key={s.id} value={s.id}>Môn {s.id}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-slate-400 block sm:hidden">Ngày sinh hoạt:</label>
                                    <select
                                      value={rule.day}
                                      onChange={(e) => {
                                        if (isCurrentTermLocked) return;
                                        const updated = [...(advancedConstraints.teacherMeetingRules || [])];
                                        updated[idx] = { ...updated[idx], day: Number(e.target.value) };
                                        setAdvancedConstraints(prev => ({ ...prev, teacherMeetingRules: updated }));
                                      }}
                                      className="w-full border border-slate-300 rounded px-2 py-1 bg-white text-xs font-semibold text-slate-800"
                                    >
                                      <option value="2">Thứ Hai</option>
                                      <option value="3">Thứ Ba</option>
                                      <option value="4">Thứ Tư</option>
                                      <option value="5">Thứ Năm</option>
                                      <option value="6">Thứ Sáu</option>
                                      <option value="7">Thứ Bảy</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-slate-400 block sm:hidden">Buổi sinh hoạt:</label>
                                    <select
                                      value={rule.session}
                                      onChange={(e) => {
                                        if (isCurrentTermLocked) return;
                                        const updated = [...(advancedConstraints.teacherMeetingRules || [])];
                                        updated[idx] = { ...updated[idx], session: e.target.value as any };
                                        setAdvancedConstraints(prev => ({ ...prev, teacherMeetingRules: updated }));
                                      }}
                                      className="w-full border border-slate-300 rounded px-2 py-1 bg-white text-xs font-semibold text-slate-800"
                                    >
                                      <option value="all">Khóa cả ngày</option>
                                      <option value="morning">Chỉ buổi Sáng</option>
                                      <option value="afternoon">Chỉ buổi Chiều</option>
                                    </select>
                                  </div>
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isCurrentTermLocked) return;
                                        setAdvancedConstraints(prev => ({
                                          ...prev,
                                          teacherMeetingRules: (prev.teacherMeetingRules || []).filter((_, i) => i !== idx)
                                        }));
                                      }}
                                      className="text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-1 rounded text-xs font-semibold transition inline-flex items-center gap-1 border border-rose-200"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* g-Ràng buộc Tiết giảng */}
                {activeConstraintTab === 'lesson_rules' && (
                  <div className="space-y-5 flex flex-col h-full">
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1">Ràng buộc cấu trúc Tiết giảng & Phân bổ môn học</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Quy định các vị trí tiết bắt buộc, quy tắc tiết đôi/tiết cặp, và tính giãn cách phân bổ đều các ngày trong tuần.
                      </p>
                    </div>

                    {/* PRESET BANNER: RÀNG BUỘC CHUẨN TRÁI BUỔI GDPT 2018 */}
                    <div className="bg-gradient-to-r from-indigo-50 via-sky-50 to-emerald-50 border border-indigo-200/80 rounded-xl p-3.5 shadow-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                            <span className="font-bold text-xs text-indigo-950">
                              Cấu hình chuẩn Trái buổi (GDTC, GDĐP, GDQPAN)
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                              Khuyên dùng
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-relaxed">
                            • <strong>2 tiết GDTC</strong> học trọn vẹn 1 buổi riêng (xếp liền nhau).<br />
                            • <strong>1 tiết GDĐP và 1 tiết GDQPAN</strong> học chung 1 buổi riêng (xếp liền kề nhau: GDĐP rồi GDQPAN hoặc ngược lại).<br />
                            • <strong>GDTC và GDQPAN/GDĐP KHÔNG học chung buổi</strong> (tách riêng 2 buổi khác nhau trong tuần, không dồn 3-4 tiết vào 1 buổi).
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentTermLocked) return;
                            setAdvancedConstraints(prev => ({
                              ...prev,
                              lessonConsecutiveSubjects: Array.from(new Set([...(prev.lessonConsecutiveSubjects || []), 'GDTC'])),
                              lessonSameSessionSubjects: Array.from(new Set([...(prev.lessonSameSessionSubjects || []), 'GDTC'])),
                              lessonNotSameSessionSubjects: (prev.lessonNotSameSessionSubjects || []).filter(s => s !== 'GDTC'),
                              lessonConsecutivePairs: [
                                { id: 'pair_gddp_gdqpan', subject1: 'GDĐP', subject2: 'GDQPAN', enabled: true }
                              ],
                              lessonNotSameSessionPairs: [
                                { id: 'pair_gdtc_gdqpan', subject1: 'GDTC', subject2: 'GDQPAN', enabled: true },
                                { id: 'pair_gdtc_gddp', subject1: 'GDTC', subject2: 'GDĐP', enabled: true }
                              ]
                            }));
                            if (onNotification) {
                              onNotification('✅ Đã kích hoạt cấu hình chuẩn Trái buổi: 2 tiết GDTC riêng 1 buổi, GDĐP + GDQPAN ghép 1 buổi liền kề!');
                            }
                          }}
                          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shrink-0 shadow-xs flex items-center gap-1.5 transition cursor-pointer self-start sm:self-center"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Áp dụng cấu hình chuẩn này</span>
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 text-xs">
                      {/* Checkbox rules */}
                      <div className="space-y-3">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id="lessonDoubleNoSpanRecess"
                            checked={advancedConstraints.lessonDoubleNoSpanRecess}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, lessonDoubleNoSpanRecess: e.target.checked }));
                            }}
                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <label htmlFor="lessonDoubleNoSpanRecess" className="font-semibold text-slate-700 cursor-pointer select-none">
                              Tiết đôi KHÔNG được vắt ngang qua giờ ra chơi hoặc giờ nghỉ trưa
                            </label>
                            <p className="text-[10px] text-slate-400">Đảm bảo 2 tiết đôi phải liền mạch (Ví dụ: học Tiết 1-2 hoặc Tiết 3-4, tránh học Tiết 2-3 gây ngắt quãng giữa giờ nghỉ giải lao).</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="lessonSpacingDays"
                            checked={advancedConstraints.lessonSpacingDays}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, lessonSpacingDays: e.target.checked }));
                            }}
                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <label htmlFor="lessonSpacingDays" className="font-semibold text-slate-700 cursor-pointer select-none">
                              Ưu tiên phân bổ đều các ngày trong tuần (giãn cách môn)
                            </label>
                            <p className="text-[10px] text-slate-400">Tránh dồn ép quá nhiều tiết của một môn vào cùng 1 ngày, xếp cách xa nhau ít nhất 1-2 ngày nếu tổng số tiết lớn.</p>
                          </div>
                        </div>
                      </div>

                      {/* Lesson Starts Only & Ends Only Setup */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-200/60">
                        {/* Lesson Starts Only */}
                        <div className="space-y-2">
                          <label className="font-bold text-slate-700 block text-[11px] uppercase tracking-wide">Môn chỉ được xếp ở tiết đầu buổi (Tiết 1 / 6):</label>
                          <p className="text-[10px] text-slate-400 mb-1">Ví dụ: Chào cờ, Giáo dục Địa phương...</p>
                          <div className="border border-slate-200 rounded-lg p-2 bg-white max-h-36 overflow-y-auto space-y-1.5 shadow-2xs">
                            {subjectsConfig.map(s => {
                              const isSelected = advancedConstraints.lessonStartsOnly.includes(s.id);
                              return (
                                <label key={s.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 px-1 rounded transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (isCurrentTermLocked) return;
                                      const next = e.target.checked
                                        ? [...advancedConstraints.lessonStartsOnly, s.id]
                                        : advancedConstraints.lessonStartsOnly.filter(id => id !== s.id);
                                      setAdvancedConstraints(prev => ({ ...prev, lessonStartsOnly: next }));
                                    }}
                                    className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                  />
                                  <span className="font-medium text-slate-700">{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Lesson Ends Only */}
                        <div className="space-y-2">
                          <label className="font-bold text-slate-700 block text-[11px] uppercase tracking-wide">Môn chỉ được xếp ở tiết cuối buổi (Tiết 5 / 9 / 10):</label>
                          <p className="text-[10px] text-slate-400 mb-1">Ví dụ: Sinh hoạt lớp, Giáo dục ngoài giờ...</p>
                          <div className="border border-slate-200 rounded-lg p-2 bg-white max-h-36 overflow-y-auto space-y-1.5 shadow-2xs">
                            {subjectsConfig.map(s => {
                              const isSelected = advancedConstraints.lessonEndsOnly.includes(s.id);
                              return (
                                <label key={s.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 px-1 rounded transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (isCurrentTermLocked) return;
                                      const next = e.target.checked
                                        ? [...advancedConstraints.lessonEndsOnly, s.id]
                                        : advancedConstraints.lessonEndsOnly.filter(id => id !== s.id);
                                      setAdvancedConstraints(prev => ({ ...prev, lessonEndsOnly: next }));
                                    }}
                                    className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                  />
                                  <span className="font-medium text-slate-700">{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* 1. RÀNG BUỘC: 2 TIẾT GIẢNG XẾP LIỀN NHAU */}
                      <div className="pt-4 border-t border-slate-200/80 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                              <Link2 className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 text-xs">
                                2 tiết giảng xếp liền nhau
                              </span>
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                {advancedConstraints.lessonConsecutiveSubjects.length} môn đang áp dụng
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonConsecutiveSubjects: subjectsConfig.map(s => s.id)
                                }));
                              }}
                              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium hover:underline cursor-pointer"
                            >
                              Chọn tất cả
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonConsecutiveSubjects: []
                                }));
                              }}
                              className="text-[11px] text-slate-500 hover:text-slate-700 font-medium hover:underline cursor-pointer"
                            >
                              Bỏ chọn
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Khi một lớp học 2 tiết của môn này trong cùng một ngày/buổi, bộ giải thuật bắt buộc phải xếp 2 tiết đó <strong>liền kề nhau liên tiếp</strong> (ví dụ: Tiết 1-2, 2-3, 3-4, 4-5 hoặc 6-7, 7-8, 8-9), tuyệt đối không để xảy ra ngắt quãng hay xen kẽ môn khác ở giữa.
                        </p>
                        <div className="border border-slate-200 rounded-lg p-2.5 bg-white max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 shadow-2xs">
                          {subjectsConfig.map(s => {
                            const isSelected = advancedConstraints.lessonConsecutiveSubjects.includes(s.id);
                            return (
                              <label
                                key={s.id}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition select-none border ${
                                  isSelected
                                    ? 'bg-indigo-50/80 border-indigo-300 text-indigo-900 font-semibold'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (isCurrentTermLocked) return;
                                    const next = e.target.checked
                                      ? [...advancedConstraints.lessonConsecutiveSubjects, s.id]
                                      : advancedConstraints.lessonConsecutiveSubjects.filter(id => id !== s.id);
                                    setAdvancedConstraints(prev => ({ ...prev, lessonConsecutiveSubjects: next }));
                                  }}
                                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer shrink-0"
                                />
                                <span className="truncate" title={s.name || s.id}>{s.id}</span>
                              </label>
                            );
                          })}
                        </div>
                        {advancedConstraints.lessonConsecutiveSubjects.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pt-1">
                            <span className="text-[10px] text-slate-400 font-medium">Đang chọn:</span>
                            {advancedConstraints.lessonConsecutiveSubjects.map(id => (
                              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-indigo-100/70 text-indigo-800 font-medium">
                                {id}
                                {!isCurrentTermLocked && (
                                  <button
                                    type="button"
                                    onClick={() => setAdvancedConstraints(prev => ({
                                      ...prev,
                                      lessonConsecutiveSubjects: prev.lessonConsecutiveSubjects.filter(x => x !== id)
                                    }))}
                                    className="hover:text-indigo-950 cursor-pointer ml-0.5"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 2. RÀNG BUỘC: CÁC TIẾT GIẢNG HỌC CÙNG BUỔI */}
                      <div className="pt-4 border-t border-slate-200/80 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                              <CalendarCheck className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 text-xs">
                                Các tiết giảng học cùng buổi
                              </span>
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {advancedConstraints.lessonSameSessionSubjects.length} môn đang áp dụng
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonSameSessionSubjects: subjectsConfig.map(s => s.id)
                                }));
                              }}
                              className="text-[11px] text-emerald-600 hover:text-emerald-800 font-medium hover:underline cursor-pointer"
                            >
                              Chọn tất cả
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonSameSessionSubjects: []
                                }));
                              }}
                              className="text-[11px] text-slate-500 hover:text-slate-700 font-medium hover:underline cursor-pointer"
                            >
                              Bỏ chọn
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Toàn bộ số tiết của môn học trong tuần đối với mỗi lớp phải được <strong>gom học trọn vẹn vào CÙNG MỘT BUỔI</strong> (không xếp rải rác ra nhiều ngày/buổi khác nhau trong tuần. Rất phù hợp cho các môn như Tin học, Mỹ thuật, Âm nhạc, Hoạt động trải nghiệm, GDĐP...).
                        </p>
                        <div className="border border-slate-200 rounded-lg p-2.5 bg-white max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 shadow-2xs">
                          {subjectsConfig.map(s => {
                            const isSelected = advancedConstraints.lessonSameSessionSubjects.includes(s.id);
                            return (
                              <label
                                key={s.id}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition select-none border ${
                                  isSelected
                                    ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 font-semibold'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (isCurrentTermLocked) return;
                                    const next = e.target.checked
                                      ? [...advancedConstraints.lessonSameSessionSubjects, s.id]
                                      : advancedConstraints.lessonSameSessionSubjects.filter(id => id !== s.id);
                                    setAdvancedConstraints(prev => ({ ...prev, lessonSameSessionSubjects: next }));
                                  }}
                                  className="w-3.5 h-3.5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer shrink-0"
                                />
                                <span className="truncate" title={s.name || s.id}>{s.id}</span>
                              </label>
                            );
                          })}
                        </div>
                        {advancedConstraints.lessonSameSessionSubjects.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pt-1">
                            <span className="text-[10px] text-slate-400 font-medium">Đang chọn:</span>
                            {advancedConstraints.lessonSameSessionSubjects.map(id => (
                              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-100/70 text-emerald-800 font-medium">
                                {id}
                                {!isCurrentTermLocked && (
                                  <button
                                    type="button"
                                    onClick={() => setAdvancedConstraints(prev => ({
                                      ...prev,
                                      lessonSameSessionSubjects: prev.lessonSameSessionSubjects.filter(x => x !== id)
                                    }))}
                                    className="hover:text-emerald-950 cursor-pointer ml-0.5"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 3. RÀNG BUỘC: CÁC TIẾT GIẢNG KHÔNG HỌC CHUNG BUỔI */}
                      <div className="pt-4 border-t border-slate-200/80 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                              <CalendarX className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 text-xs">
                                Các tiết giảng không học chung buổi
                              </span>
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                {advancedConstraints.lessonNotSameSessionSubjects.length} môn đang áp dụng
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonNotSameSessionSubjects: subjectsConfig.map(s => s.id)
                                }));
                              }}
                              className="text-[11px] text-rose-600 hover:text-rose-800 font-medium hover:underline cursor-pointer"
                            >
                              Chọn tất cả
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (isCurrentTermLocked) return;
                                setAdvancedConstraints(prev => ({
                                  ...prev,
                                  lessonNotSameSessionSubjects: []
                                }));
                              }}
                              className="text-[11px] text-slate-500 hover:text-slate-700 font-medium hover:underline cursor-pointer"
                            >
                              Bỏ chọn
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Các tiết giảng của môn học <strong>KHÔNG ĐƯỢC học chung trong cùng một buổi</strong> (mỗi buổi lớp chỉ học tối đa 1 tiết của môn đó, bắt buộc phải rải sang các buổi/ngày khác nhau trong tuần. Đặc biệt hữu ích cho môn Thể dục/GDTC để học sinh không bị quá tải thể lực, hoặc môn GDCD).
                        </p>
                        <div className="border border-slate-200 rounded-lg p-2.5 bg-white max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 shadow-2xs">
                          {subjectsConfig.map(s => {
                            const isSelected = advancedConstraints.lessonNotSameSessionSubjects.includes(s.id);
                            return (
                              <label
                                key={s.id}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition select-none border ${
                                  isSelected
                                    ? 'bg-rose-50/80 border-rose-300 text-rose-900 font-semibold'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (isCurrentTermLocked) return;
                                    const next = e.target.checked
                                      ? [...advancedConstraints.lessonNotSameSessionSubjects, s.id]
                                      : advancedConstraints.lessonNotSameSessionSubjects.filter(id => id !== s.id);
                                    setAdvancedConstraints(prev => ({ ...prev, lessonNotSameSessionSubjects: next }));
                                  }}
                                  className="w-3.5 h-3.5 text-rose-600 border-slate-300 rounded focus:ring-rose-500 cursor-pointer shrink-0"
                                />
                                <span className="truncate" title={s.name || s.id}>{s.id}</span>
                              </label>
                            );
                          })}
                        </div>
                        {advancedConstraints.lessonNotSameSessionSubjects.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pt-1">
                            <span className="text-[10px] text-slate-400 font-medium">Đang chọn:</span>
                            {advancedConstraints.lessonNotSameSessionSubjects.map(id => (
                              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-100/70 text-rose-800 font-medium">
                                {id}
                                {!isCurrentTermLocked && (
                                  <button
                                    type="button"
                                    onClick={() => setAdvancedConstraints(prev => ({
                                      ...prev,
                                      lessonNotSameSessionSubjects: prev.lessonNotSameSessionSubjects.filter(x => x !== id)
                                    }))}
                                    className="hover:text-rose-950 cursor-pointer ml-0.5"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 4. RÀNG BUỘC: GHÉP CẶP 2 MÔN HỌC CHUNG 1 BUỔI & XẾP LIỀN KỀ NHAU */}
                      <div className="pt-4 border-t border-slate-200/80 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                              <Link2 className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 text-xs">
                                Ghép cặp 2 môn học chung 1 buổi & xếp liền kề nhau
                              </span>
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                {(advancedConstraints.lessonConsecutivePairs || []).filter(p => p.enabled).length} cặp đang áp dụng
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Khi một lớp học cả 2 môn này trong tuần, thuật toán bắt buộc phải <strong>gom 2 môn vào CÙNG MỘT BUỔI</strong> và <strong>xếp liền kề liên tiếp nhau</strong> (ví dụ: GDĐP và GDQPAN học chung buổi Chiều/Sáng, Tiết 6 GDĐP và Tiết 7 GDQPAN hoặc ngược lại). Tuyệt đối không để tách rời ra các buổi khác nhau.
                        </p>

                        {/* List of consecutive pairs */}
                        <div className="space-y-2">
                          {(advancedConstraints.lessonConsecutivePairs || []).map(pair => (
                            <div
                              key={pair.id}
                              className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition ${
                                pair.enabled
                                  ? 'bg-purple-50/60 border-purple-200 text-purple-950'
                                  : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold px-2 py-0.5 rounded bg-white border border-purple-300 text-purple-800 shadow-2xs">
                                  {pair.subject1}
                                </span>
                                <span className="text-purple-600 font-bold">+</span>
                                <span className="font-bold px-2 py-0.5 rounded bg-white border border-purple-300 text-purple-800 shadow-2xs">
                                  {pair.subject2}
                                </span>
                                <span className="text-[11px] text-slate-500 ml-1">
                                  (Học chung 1 buổi, xếp liền kề)
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 select-none">
                                  <input
                                    type="checkbox"
                                    checked={pair.enabled}
                                    disabled={isCurrentTermLocked}
                                    onChange={(e) => {
                                      if (isCurrentTermLocked) return;
                                      setAdvancedConstraints(prev => ({
                                        ...prev,
                                        lessonConsecutivePairs: (prev.lessonConsecutivePairs || []).map(p =>
                                          p.id === pair.id ? { ...p, enabled: e.target.checked } : p
                                        )
                                      }));
                                    }}
                                    className="w-3.5 h-3.5 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                                  />
                                  <span>{pair.enabled ? 'Đang bật' : 'Tắt'}</span>
                                </label>
                                {!isCurrentTermLocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAdvancedConstraints(prev => ({
                                        ...prev,
                                        lessonConsecutivePairs: (prev.lessonConsecutivePairs || []).filter(p => p.id !== pair.id)
                                      }));
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-white transition cursor-pointer"
                                    title="Xóa cặp ràng buộc này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* Add pair form */}
                          {!isCurrentTermLocked && (
                            <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-white border border-dashed border-purple-300 text-xs">
                              <span className="text-[11px] font-bold text-slate-600 shrink-0">Thêm cặp:</span>
                              <select
                                value={newConsecutivePairSub1}
                                onChange={(e) => setNewConsecutivePairSub1(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 bg-white focus:ring-1 focus:ring-purple-500"
                              >
                                {subjectsConfig.map(s => (
                                  <option key={s.id} value={s.id}>{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</option>
                                ))}
                              </select>
                              <span className="text-purple-600 font-bold">+</span>
                              <select
                                value={newConsecutivePairSub2}
                                onChange={(e) => setNewConsecutivePairSub2(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 bg-white focus:ring-1 focus:ring-purple-500"
                              >
                                {subjectsConfig.map(s => (
                                  <option key={s.id} value={s.id}>{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  if (newConsecutivePairSub1 === newConsecutivePairSub2) {
                                    alert('Vui lòng chọn 2 môn học khác nhau để ghép cặp!');
                                    return;
                                  }
                                  const exists = (advancedConstraints.lessonConsecutivePairs || []).some(
                                    p => (p.subject1 === newConsecutivePairSub1 && p.subject2 === newConsecutivePairSub2) ||
                                         (p.subject1 === newConsecutivePairSub2 && p.subject2 === newConsecutivePairSub1)
                                  );
                                  if (exists) {
                                    alert('Cặp môn này đã tồn tại trong danh sách!');
                                    return;
                                  }
                                  const newPair = {
                                    id: `pair_${Date.now()}`,
                                    subject1: newConsecutivePairSub1,
                                    subject2: newConsecutivePairSub2,
                                    enabled: true
                                  };
                                  setAdvancedConstraints(prev => ({
                                    ...prev,
                                    lessonConsecutivePairs: [...(prev.lessonConsecutivePairs || []), newPair]
                                  }));
                                }}
                                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold flex items-center gap-1 shadow-2xs transition cursor-pointer ml-auto"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Thêm cặp ghép</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 5. RÀNG BUỘC: CẶP MÔN KHÔNG ĐƯỢC HỌC CHUNG BUỔI */}
                      <div className="pt-4 border-t border-slate-200/80 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                              <Split className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 text-xs">
                                Cặp môn KHÔNG được học chung một buổi
                              </span>
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                {(advancedConstraints.lessonNotSameSessionPairs || []).filter(p => p.enabled).length} cặp đang áp dụng
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Quy định 2 môn học <strong>TUYỆT ĐỐI KHÔNG ĐƯỢC PHÉP học chung trong cùng một buổi</strong> (ví dụ: GDTC và GDQPAN không được xếp chung buổi; GDTC và GDĐP không được xếp chung buổi. Nhờ đó, 2 tiết GDTC sẽ ở 1 buổi riêng, và cặp GDĐP + GDQPAN sẽ ở 1 buổi riêng khác, không bị dồn 3-4 tiết vào 1 buổi).
                        </p>

                        {/* List of disjoint pairs */}
                        <div className="space-y-2">
                          {(advancedConstraints.lessonNotSameSessionPairs || []).map(pair => (
                            <div
                              key={pair.id}
                              className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition ${
                                pair.enabled
                                  ? 'bg-amber-50/60 border-amber-200 text-amber-950'
                                  : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-800 shadow-2xs">
                                  {pair.subject1}
                                </span>
                                <span className="text-rose-500 font-bold">⚡ KHÔNG CHUNG BUỔI ⚡</span>
                                <span className="font-bold px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-800 shadow-2xs">
                                  {pair.subject2}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 select-none">
                                  <input
                                    type="checkbox"
                                    checked={pair.enabled}
                                    disabled={isCurrentTermLocked}
                                    onChange={(e) => {
                                      if (isCurrentTermLocked) return;
                                      setAdvancedConstraints(prev => ({
                                        ...prev,
                                        lessonNotSameSessionPairs: (prev.lessonNotSameSessionPairs || []).map(p =>
                                          p.id === pair.id ? { ...p, enabled: e.target.checked } : p
                                        )
                                      }));
                                    }}
                                    className="w-3.5 h-3.5 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                                  />
                                  <span>{pair.enabled ? 'Đang bật' : 'Tắt'}</span>
                                </label>
                                {!isCurrentTermLocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAdvancedConstraints(prev => ({
                                        ...prev,
                                        lessonNotSameSessionPairs: (prev.lessonNotSameSessionPairs || []).filter(p => p.id !== pair.id)
                                      }));
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-white transition cursor-pointer"
                                    title="Xóa cặp tách buổi này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* Add pair form */}
                          {!isCurrentTermLocked && (
                            <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-white border border-dashed border-amber-300 text-xs">
                              <span className="text-[11px] font-bold text-slate-600 shrink-0">Thêm cặp cấm chung buổi:</span>
                              <select
                                value={newNotSamePairSub1}
                                onChange={(e) => setNewNotSamePairSub1(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 bg-white focus:ring-1 focus:ring-amber-500"
                              >
                                {subjectsConfig.map(s => (
                                  <option key={s.id} value={s.id}>{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</option>
                                ))}
                              </select>
                              <span className="text-rose-500 font-bold">≠</span>
                              <select
                                value={newNotSamePairSub2}
                                onChange={(e) => setNewNotSamePairSub2(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 bg-white focus:ring-1 focus:ring-amber-500"
                              >
                                {subjectsConfig.map(s => (
                                  <option key={s.id} value={s.id}>{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  if (newNotSamePairSub1 === newNotSamePairSub2) {
                                    alert('Vui lòng chọn 2 môn học khác nhau!');
                                    return;
                                  }
                                  const exists = (advancedConstraints.lessonNotSameSessionPairs || []).some(
                                    p => (p.subject1 === newNotSamePairSub1 && p.subject2 === newNotSamePairSub2) ||
                                         (p.subject1 === newNotSamePairSub2 && p.subject2 === newNotSamePairSub1)
                                  );
                                  if (exists) {
                                    alert('Cặp môn này đã tồn tại trong danh sách cấm chung buổi!');
                                    return;
                                  }
                                  const newPair = {
                                    id: `pair_dis_${Date.now()}`,
                                    subject1: newNotSamePairSub1,
                                    subject2: newNotSamePairSub2,
                                    enabled: true
                                  };
                                  setAdvancedConstraints(prev => ({
                                    ...prev,
                                    lessonNotSameSessionPairs: [...(prev.lessonNotSameSessionPairs || []), newPair]
                                  }));
                                }}
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold flex items-center gap-1 shadow-2xs transition cursor-pointer ml-auto"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Thêm cặp tách buổi</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* h-Ràng buộc Môn học */}
                {activeConstraintTab === 'subject_rules' && (
                  <div className="space-y-5 flex flex-col h-full">
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 mb-1">Ràng buộc đặc thù cho các Môn học</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Điều chỉnh số lượng môn học tối đa trong ngày/buổi để giảm tải áp lực tâm lý học tập cho học sinh.
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 text-xs">
                      {/* Max subjects & Max periods of same subject per session */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="font-semibold text-slate-700 block">Số môn học tối đa trong một buổi của lớp:</label>
                          <p className="text-[10px] text-slate-400">Học sinh không phải chuẩn bị quá nhiều sách vở trong 1 buổi học.</p>
                          <select
                            value={advancedConstraints.subjectMaxPerSession}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, subjectMaxPerSession: Number(e.target.value) }));
                            }}
                            className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="2">Tối đa 2 môn / buổi</option>
                            <option value="3">Tối đa 3 môn / buổi</option>
                            <option value="4">Tối đa 4 môn / buổi</option>
                            <option value="5">Tối đa 5 môn / buổi</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="font-semibold text-slate-700 block">Số tiết tối đa của một môn học trong 1 buổi:</label>
                          <p className="text-[10px] text-slate-400">Hạn chế tối đa học dồn dập 3-4 tiết một môn trong cùng nửa ngày.</p>
                          <select
                            value={advancedConstraints.subjectMaxPeriodsPerSession}
                            onChange={(e) => {
                              if (isCurrentTermLocked) return;
                              setAdvancedConstraints(prev => ({ ...prev, subjectMaxPeriodsPerSession: Number(e.target.value) }));
                            }}
                            className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="1">Tối đa 1 tiết / môn / buổi (Nghiêm cấm tiết đôi)</option>
                            <option value="2">Tối đa 2 tiết / môn / buổi (Cho phép học tiết đôi)</option>
                            <option value="3">Tối đa 3 tiết / môn / buổi</option>
                            <option value="4">Tối đa 4 tiết / môn / buổi</option>
                          </select>
                        </div>
                      </div>

                      {/* Subject No Room (Moving subjects) */}
                      <div className="space-y-2 pt-3 border-t border-slate-200/60">
                        <label className="font-bold text-slate-700 block text-[11px] uppercase tracking-wide">Môn học đặc thù không yêu cầu phòng học lý thuyết (Không lo kẹt phòng):</label>
                        <p className="text-[10px] text-slate-400 mb-1">Ví dụ: Thể dục (Học sân bãi), GDQPAN (Học bãi tập), Sinh hoạt tập thể ngoài trời...</p>
                        <div className="border border-slate-200 rounded-lg p-2.5 bg-white max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 shadow-2xs">
                          {subjectsConfig.map(s => {
                            const isSelected = advancedConstraints.subjectNoRoom.includes(s.id);
                            return (
                              <label key={s.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 px-1 rounded transition select-none">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (isCurrentTermLocked) return;
                                    const next = e.target.checked
                                      ? [...advancedConstraints.subjectNoRoom, s.id]
                                      : advancedConstraints.subjectNoRoom.filter(id => id !== s.id);
                                    setAdvancedConstraints(prev => ({ ...prev, subjectNoRoom: next }));
                                  }}
                                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                />
                                <span className="font-medium text-slate-700">{s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
              <button
                onClick={() => {
                  if (window.confirm('Bạn có chắc chắn muốn thiết lập lại toàn bộ ràng buộc bổ sung về mặc định không?')) {
                    setCustomFixedSlots([]);
                    setTeacherConstraints({});
                    alert('Đã thiết lập lại các ràng buộc.');
                  }
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold cursor-pointer mr-auto border border-rose-100 px-3 py-1.5 rounded-lg hover:bg-rose-50"
              >
                Đặt lại toàn bộ ràng buộc
              </button>
              <button
                onClick={() => setIsCommonConstraintsOpen(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
              >
                Hoàn tất cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CẤU HÌNH DẠY 2 BUỔI / NGÀY */}
      {isSessionConfigModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs">
                  <Sunset className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    Cấu hình Dạy 2 buổi / ngày (Sáng & Chiều)
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      GDPT 2018
                    </span>
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Thiết lập khung giờ học 1 buổi hoặc 2 buổi/ngày cho toàn trường và phân bổ ca học theo lớp.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSessionConfigModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-5 text-sm flex-1">
              {/* Chế độ buổi học */}
              <div className="space-y-3">
                <label className="font-bold text-slate-800 text-xs uppercase tracking-wider block">
                  1. Chế độ buổi học của nhà trường:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option 1: 1 buổi / ngày */}
                  <div
                    onClick={() => {
                      if (isCurrentTermLocked) return;
                      setSessionMode('single');
                    }}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sessionMode === 'single'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-2 ring-indigo-200'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Sunrise className={`w-5 h-5 ${sessionMode === 'single' ? 'text-indigo-600' : 'text-slate-400'}`} />
                        <span className="font-bold text-sm text-slate-800">Dạy 1 buổi / ngày</span>
                      </div>
                      <input
                        type="radio"
                        checked={sessionMode === 'single'}
                        onChange={() => {}}
                        className="mt-0.5 accent-indigo-600"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      Chỉ dạy <strong>Buổi Sáng (5 tiết/ngày)</strong> từ Thứ 2 đến Thứ 7. Tổng số tiết tối đa trong tuần là <strong>30 tiết</strong>.
                    </p>
                    <div className="mt-3 text-[11px] font-semibold text-slate-600 bg-slate-100/80 px-2.5 py-1 rounded-md inline-block">
                      ⏰ 07:00 — 11:15 (Tiết 1 - 5)
                    </div>
                  </div>

                  {/* Option 2: 2 buổi / ngày */}
                  <div
                    onClick={() => {
                      if (isCurrentTermLocked) return;
                      setSessionMode('double');
                    }}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      sessionMode === 'double'
                        ? 'border-amber-500 bg-amber-50/60 shadow-xs ring-2 ring-amber-200'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Sunset className={`w-5 h-5 ${sessionMode === 'double' ? 'text-amber-600' : 'text-slate-400'}`} />
                        <span className="font-bold text-sm text-slate-800">Dạy 2 buổi / ngày</span>
                      </div>
                      <input
                        type="radio"
                        checked={sessionMode === 'double'}
                        onChange={() => {}}
                        className="mt-0.5 accent-amber-600"
                      />
                    </div>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      Dạy cả <strong>Buổi Sáng & Buổi Chiều</strong>. Thích hợp các trường tổ chức dạy học 2 buổi/ngày theo CT GDPT 2018 (tối đa <strong>54 - 60 tiết/tuần</strong>).
                    </p>
                    <div className="mt-3 text-[11px] font-semibold text-amber-800 bg-amber-100/80 px-2.5 py-1 rounded-md inline-block">
                      ⏰ Sáng 07:00-11:15 | Chiều 13:00-16:30/17:15
                    </div>
                  </div>
                </div>
              </div>

              {/* Cấu hình tiết chiều (Khi chọn 2 buổi/ngày) */}
              {sessionMode === 'double' && (
                <div className="space-y-4 pt-3 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div>
                    <label className="font-bold text-slate-800 text-xs uppercase tracking-wider block mb-2">
                      2. Số tiết học buổi chiều mỗi ngày:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setAfternoonPeriodsCount(4)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          afternoonPeriodsCount === 4
                            ? 'border-amber-500 bg-amber-50 font-bold text-amber-900 ring-2 ring-amber-300'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm">4 tiết chiều (Tổng 9 tiết/ngày)</span>
                          {afternoonPeriodsCount === 4 && <Check className="w-4 h-4 text-amber-600" />}
                        </div>
                        <div className="text-xs text-slate-500 font-normal mt-1">
                          13:00 — 16:30 (Khung chuẩn phổ biến THPT, tối đa 54 tiết/tuần)
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAfternoonPeriodsCount(5)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          afternoonPeriodsCount === 5
                            ? 'border-amber-500 bg-amber-50 font-bold text-amber-900 ring-2 ring-amber-300'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm">5 tiết chiều (Tổng 10 tiết/ngày)</span>
                          {afternoonPeriodsCount === 5 && <Check className="w-4 h-4 text-amber-600" />}
                        </div>
                        <div className="text-xs text-slate-500 font-normal mt-1">
                          13:00 — 17:15 (Tối đa 60 tiết/tuần)
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Bảng chi tiết khung giờ */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      Chi tiết phân bố thời gian từng buổi trong ngày:
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
                        <div className="font-bold text-sky-800 flex items-center gap-1 pb-1 border-b border-slate-100">
                          <Sunrise className="w-3.5 h-3.5 text-sky-600" /> Buổi Sáng (5 tiết)
                        </div>
                        <div className="text-slate-600 space-y-0.5 pt-1">
                          <div className="flex justify-between"><span>Tiết 1:</span> <span className="font-mono font-medium">07:00 - 07:45</span></div>
                          <div className="flex justify-between"><span>Tiết 2:</span> <span className="font-mono font-medium">07:50 - 08:35</span></div>
                          <div className="flex justify-between text-slate-400 italic"><span>Ra chơi:</span> <span className="font-mono">08:35 - 08:55 (20p)</span></div>
                          <div className="flex justify-between"><span>Tiết 3:</span> <span className="font-mono font-medium">08:55 - 09:40</span></div>
                          <div className="flex justify-between"><span>Tiết 4:</span> <span className="font-mono font-medium">09:45 - 10:30</span></div>
                          <div className="flex justify-between"><span>Tiết 5:</span> <span className="font-mono font-medium">10:35 - 11:15</span></div>
                        </div>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
                        <div className="font-bold text-amber-800 flex items-center gap-1 pb-1 border-b border-slate-100">
                          <Sunset className="w-3.5 h-3.5 text-amber-600" /> Buổi Chiều ({afternoonPeriodsCount} tiết)
                        </div>
                        <div className="text-slate-600 space-y-0.5 pt-1">
                          <div className="flex justify-between text-slate-400 italic"><span>Nghỉ trưa:</span> <span className="font-mono">11:15 - 13:00 (105p)</span></div>
                          <div className="flex justify-between"><span>Tiết 1 (P6):</span> <span className="font-mono font-medium">13:00 - 13:45</span></div>
                          <div className="flex justify-between"><span>Tiết 2 (P7):</span> <span className="font-mono font-medium">13:50 - 14:35</span></div>
                          <div className="flex justify-between text-slate-400 italic"><span>Ra chơi chiều:</span> <span className="font-mono">14:35 - 14:55 (20p)</span></div>
                          <div className="flex justify-between"><span>Tiết 3 (P8):</span> <span className="font-mono font-medium">14:55 - 15:40</span></div>
                          <div className="flex justify-between"><span>Tiết 4 (P9):</span> <span className="font-mono font-medium">15:45 - 16:30</span></div>
                          {afternoonPeriodsCount === 5 && (
                            <div className="flex justify-between text-amber-700"><span>Tiết 5 (P10):</span> <span className="font-mono font-medium">16:35 - 17:15</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Phân ca học theo lớp (Tùy chọn) */}
                  <div className="space-y-2 pt-2">
                    <label className="font-bold text-slate-800 text-xs uppercase tracking-wider block">
                      3. Phân ca học theo từng lớp (Tùy chọn):
                    </label>
                    <p className="text-xs text-slate-500">
                      Mặc định, tất cả các lớp học <strong>Cả 2 buổi (Sáng & Chiều)</strong>. Nếu có lớp chỉ học 1 ca, bạn có thể thiết lập tại đây:
                    </p>
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                          <tr>
                            <th className="p-2 pl-3">Lớp học</th>
                            <th className="p-2">Khối</th>
                            <th className="p-2 text-right pr-3">Ca học</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {classes.map(c => {
                            const rawShift = classShifts[c.id] || 'morning_main';
                            const currentShift = rawShift === 'both' ? 'morning_main' : rawShift;
                            return (
                              <tr key={c.id} className="hover:bg-slate-50/60">
                                <td className="p-2 pl-3 font-semibold text-slate-800">{c.name}</td>
                                <td className="p-2 text-slate-500">Khối {c.grade}</td>
                                <td className="p-2 text-right pr-3">
                                  <select
                                    value={currentShift}
                                    onChange={(e) => {
                                      const val = e.target.value as 'morning' | 'afternoon' | 'morning_main' | 'afternoon_main';
                                      handleUpdateClassShift(c.id, val);
                                    }}
                                    className="border border-slate-300 rounded px-2 py-1 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                                  >
                                    <option value="morning_main">Chính khóa Sáng - Trái buổi Chiều 🌅</option>
                                    <option value="afternoon_main">Chính khóa Chiều - Trái buổi Sáng 🌇</option>
                                    <option value="morning">Chỉ học Buổi Sáng ☀️</option>
                                    <option value="afternoon">Chỉ học Buổi Chiều 🌙</option>
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">
                {sessionMode === 'double'
                  ? `Đang bật: 2 buổi/ngày (${5 + afternoonPeriodsCount} tiết/ngày, tối đa ${(5 + afternoonPeriodsCount) * 6} tiết/tuần)`
                  : 'Đang bật: 1 buổi/ngày (5 tiết/ngày, tối đa 30 tiết/tuần)'}
              </span>
              <button
                onClick={() => {
                  setIsSessionConfigModalOpen(false);
                  if (onNotification) {
                    onNotification(
                      sessionMode === 'double'
                        ? `Đã thiết lập Thời khóa biểu 2 buổi/ngày (${5 + afternoonPeriodsCount} tiết/ngày: 5 tiết sáng + ${afternoonPeriodsCount} tiết chiều).`
                        : `Đã thiết lập Thời khóa biểu 1 buổi/ngày (5 tiết sáng/ngày).`
                    );
                  }
                }}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition"
              >
                Áp dụng cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL XUẤT DỮ LIỆU & IN THỜI KHÓA BIỂU */}
      <TimetableExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        classes={classes}
        teachers={teachers}
        subjectsConfig={subjectsConfig}
        assignments={assignments}
        timetableData={timetableData}
        lessonsByClass={lessonsByClass}
        lessonsByTeacher={lessonsByTeacher}
        currentAcademicYear={currentAcademicYear}
        currentSemester={currentSemester}
        sessionMode={sessionMode}
        afternoonPeriodsCount={afternoonPeriodsCount}
        schoolName="TRƯỜNG THPT NGUYỄN BỈNH KHIÊM"
        onNotification={onNotification}
      />
    </div>
  );
};
