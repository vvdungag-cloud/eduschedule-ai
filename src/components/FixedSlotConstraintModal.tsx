import React, { useState, useMemo, useEffect } from 'react';
import {
  Lock,
  Pin,
  Layers,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Trash2,
  Save,
  Search,
  AlertCircle,
  CheckCircle2,
  Info,
  Calendar,
  Sparkles,
  UserCheck,
  Sun,
  Sunset,
  Sunrise
} from 'lucide-react';
import {
  SessionMode,
  PeriodConfigItem,
  DAYS_CONFIG
} from '../utils/timetableTypes';
import { Teacher, ClassModel, normalizeSubjectName } from '../utils/assignmentSolver';

export interface FixedSlotItem {
  id: string;
  classId: string;
  subject: string;
  teacherId: string;
  day: number;
  period: number;
  createdAt?: string;
}

interface FixedSlotConstraintModalProps {
  classes: ClassModel[];
  teachers: Teacher[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  subjectsConfig: { id: string; name?: string; grade10Periods: number; grade11Periods: number; grade12Periods: number }[];
  classSubjectPeriods: Record<string, Record<string, any>>;
  customFixedSlots: FixedSlotItem[];
  setCustomFixedSlots: React.Dispatch<React.SetStateAction<FixedSlotItem[]>>;
  currentAcademicYear: string;
  isCurrentTermLocked: boolean;
  currentTermKey: string;
  sessionMode: SessionMode;
  afternoonPeriodsCount: number;
  periodsConfig: PeriodConfigItem[];
  getSubjectPeriod: (subject: string, grade: '10' | '11' | '12', classId: string) => number;
  getNormalizedAssignedTeacherId: (classId: string, subjectId: string) => string | undefined;
  onNotification?: (msg: string) => void;
}

export const FixedSlotConstraintModal: React.FC<FixedSlotConstraintModalProps> = ({
  classes,
  teachers,
  assignments,
  subjectsConfig,
  classSubjectPeriods,
  customFixedSlots,
  setCustomFixedSlots,
  currentAcademicYear,
  isCurrentTermLocked,
  currentTermKey,
  sessionMode,
  afternoonPeriodsCount,
  periodsConfig,
  getSubjectPeriod,
  getNormalizedAssignedTeacherId,
  onNotification
}) => {
  const customFixedStorageKey = `edu_custom_fixed_slots_${currentTermKey}`;

  // Maps
  const classMap = useMemo(() => {
    const map = new Map<string, ClassModel>();
    classes.forEach(c => {
      map.set(c.id, c);
      map.set(c.id.replace(/^c_/, ''), c);
      if (c.name) map.set(c.name, c);
    });
    return map;
  }, [classes]);

  const teacherMap = useMemo(() => {
    const map = new Map<string, Teacher>();
    teachers.forEach(t => map.set(t.id, t));
    return map;
  }, [teachers]);

  // Selected classes in Tree (left column)
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(() => {
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
      localStorage.setItem(`edu_batch_classes_${currentTermKey}`, JSON.stringify(Array.from(selectedClasses)));
    } catch {}
  }, [selectedClasses, currentTermKey]);

  // Tree state
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(() => new Set(['10', '11', '12']));
  const [classSearch, setClassSearch] = useState('');

  // Selected subject to pin
  const [selectedSubject, setSelectedSubject] = useState<string>(() => subjectsConfig[0]?.id || 'TNHN2');

  // Teacher override for single-class view
  const [teacherOverride, setTeacherOverride] = useState<string>('');

  // Matrix cell selection for batch actions
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  // Distinct grades available
  const gradesList = useMemo(() => {
    return Array.from(new Set(classes.map(c => c.grade))).sort();
  }, [classes]);

  // Single class selection check
  const isSingleClass = selectedClasses.size === 1;
  const singleClassId = isSingleClass ? Array.from(selectedClasses)[0] : null;
  const singleClass = singleClassId ? (classMap.get(singleClassId) || classes.find(c => c.id === singleClassId)) : null;

  // Auto assigned teacher for single-class mode
  const autoTeacherId = useMemo(() => {
    if (!singleClassId || !selectedSubject) return '';
    return getNormalizedAssignedTeacherId(singleClassId, selectedSubject) || '';
  }, [singleClassId, selectedSubject, getNormalizedAssignedTeacherId]);

  const activeSingleTeacherId = teacherOverride || autoTeacherId;
  const activeSingleTeacher = teacherMap.get(activeSingleTeacherId);

  // Quota for single class mode
  const singleClassSubjectQuota = useMemo(() => {
    if (!singleClass || !selectedSubject) return 0;
    return getSubjectPeriod(selectedSubject, singleClass.grade, singleClass.id);
  }, [singleClass, selectedSubject, getSubjectPeriod]);

  const singleClassFixedList = useMemo(() => {
    if (!singleClassId) return [];
    return customFixedSlots.filter(s => s.classId === singleClassId || s.classId === singleClassId.replace(/^c_/, ''));
  }, [singleClassId, customFixedSlots]);

  const singleClassSubjectFixedCount = useMemo(() => {
    return singleClassFixedList.filter(s =>
      s.subject === selectedSubject || normalizeSubjectName(s.subject) === normalizeSubjectName(selectedSubject)
    ).length;
  }, [singleClassFixedList, selectedSubject]);

  // Filtered classes for tree based on search
  const filteredTreeClasses = useMemo(() => {
    if (!classSearch.trim()) return classes;
    const q = classSearch.trim().toLowerCase();
    return classes.filter(c => c.name.toLowerCase().includes(q) || c.grade.includes(q));
  }, [classes, classSearch]);

  // Handle grade toggle in tree
  const handleToggleGrade = (grade: string) => {
    const gradeClasses = classes.filter(c => c.grade === grade);
    const allSelected = gradeClasses.every(c => selectedClasses.has(c.id));
    const next = new Set(selectedClasses);
    if (allSelected) {
      gradeClasses.forEach(c => next.delete(c.id));
    } else {
      gradeClasses.forEach(c => next.add(c.id));
    }
    setSelectedClasses(next);
  };

  // Quick select only one class (Exception mode)
  const handleSelectOnlyClass = (classId: string) => {
    setSelectedClasses(new Set([classId]));
    setTeacherOverride('');
    setSelectedSlots(new Set());
    const c = classMap.get(classId);
    if (onNotification && c) {
      onNotification(`🎯 Đang chọn riêng lớp ${c.name} để thiết lập ngoại lệ.`);
    }
  };

  // Cell click on matrix
  const handleToggleCellSelection = (day: number, period: number) => {
    const key = `${day}_${period}`;
    setSelectedSlots(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // SAVE PINNED SLOTS (Lưu tiết cố định)
  const handleSaveFixedSlots = () => {
    if (isCurrentTermLocked) {
      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    if (selectedClasses.size === 0) {
      const msg = '⚠️ Vui lòng chọn ít nhất một lớp học ở cây danh mục bên trái.';
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    if (selectedSlots.size === 0) {
      const msg = '⚠️ Vui lòng click chọn ít nhất một ô trên lưới ma trận để ghim!';
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    let successCount = 0;
    const quotaWarningClasses: string[] = [];
    const newSlotsToAppend: FixedSlotItem[] = [];

    // Process each target class
    classes.forEach(cls => {
      if (!selectedClasses.has(cls.id)) return;

      const subjectQuota = getSubjectPeriod(selectedSubject, cls.grade, cls.id);
      if (subjectQuota === 0) return;

      // Existing pinned for this class excluding currently selected slots
      const unaffectedFixedList = customFixedSlots.filter(s =>
        s.classId === cls.id && !selectedSlots.has(`${s.day}_${s.period}`)
      );

      const currentSubPinnedCount = unaffectedFixedList.filter(s =>
        s.subject === selectedSubject || normalizeSubjectName(s.subject) === normalizeSubjectName(selectedSubject)
      ).length;

      const teacherId = isSingleClass && activeSingleTeacherId
        ? activeSingleTeacherId
        : (getNormalizedAssignedTeacherId(cls.id, selectedSubject) || '');

      let classAdded = 0;
      selectedSlots.forEach(slotKey => {
        const [day, period] = slotKey.split('_').map(Number);

        if (currentSubPinnedCount + classAdded >= subjectQuota) {
          if (!quotaWarningClasses.includes(cls.name)) {
            quotaWarningClasses.push(cls.name);
          }
          return;
        }

        newSlotsToAppend.push({
          id: `custom_fixed_${Date.now()}_${cls.id}_${day}_${period}_${Math.random().toString(36).substr(2, 4)}`,
          classId: cls.id,
          subject: selectedSubject,
          teacherId,
          day,
          period,
          createdAt: new Date().toISOString()
        });

        classAdded++;
        successCount++;
      });
    });

    if (newSlotsToAppend.length > 0) {
      setCustomFixedSlots(prev => {
        const filtered = prev.filter(s => {
          const isTargetClass = selectedClasses.has(s.classId);
          const isTargetSlot = selectedSlots.has(`${s.day}_${s.period}`);
          return !(isTargetClass && isTargetSlot);
        });
        const updated = [...filtered, ...newSlotsToAppend];
        try {
          localStorage.setItem(customFixedStorageKey, JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }

    setSelectedSlots(new Set());

    let notifyMsg = `🎉 Đã ghim thành công ${successCount} tiết môn "${selectedSubject}" cho ${isSingleClass ? `lớp ${singleClass?.name}` : `${selectedClasses.size} lớp đã chọn`}!`;
    if (quotaWarningClasses.length > 0) {
      notifyMsg += ` (Lớp ${quotaWarningClasses.join(', ')} đã đủ định mức môn).`;
    }
    if (onNotification) onNotification(notifyMsg);
    else alert(notifyMsg);
  };

  // UNPIN SLOTS (Bỏ ghim các ô đã chọn)
  const handleUnpinSelectedSlots = () => {
    if (isCurrentTermLocked) {
      const msg = `⚠️ Năm học ${currentAcademicYear} đang KHÓA.`;
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    if (selectedClasses.size === 0) {
      const msg = '⚠️ Vui lòng chọn ít nhất một lớp học ở cây danh mục bên trái.';
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    if (selectedSlots.size === 0) {
      const msg = '⚠️ Vui lòng click chọn ít nhất một ô trên lưới để bỏ ghim.';
      if (onNotification) onNotification(msg);
      else alert(msg);
      return;
    }

    let unpinnedCount = 0;
    setCustomFixedSlots(prev => {
      const updated = prev.filter(s => {
        const isTargetClass = selectedClasses.has(s.classId);
        const isTargetSlot = selectedSlots.has(`${s.day}_${s.period}`);
        if (isTargetClass && isTargetSlot) unpinnedCount++;
        return !(isTargetClass && isTargetSlot);
      });
      try {
        localStorage.setItem(customFixedStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setSelectedSlots(new Set());

    const msg = `🗑️ Đã bỏ ghim thành công ${unpinnedCount} tiết cho ${isSingleClass ? `lớp ${singleClass?.name}` : `${selectedClasses.size} lớp đã chọn`}!`;
    if (onNotification) onNotification(msg);
    else alert(msg);
  };

  // QUICK UNPIN FOR SPECIFIC CELL (Direct click on X inside cell)
  const handleQuickUnpinCell = (day: number, period: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrentTermLocked) return;

    let count = 0;
    setCustomFixedSlots(prev => {
      const updated = prev.filter(s => {
        const isTarget = selectedClasses.has(s.classId) && s.day === day && s.period === period;
        if (isTarget) count++;
        return !isTarget;
      });
      try {
        localStorage.setItem(customFixedStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setSelectedSlots(prev => {
      const next = new Set(prev);
      next.delete(`${day}_${period}`);
      return next;
    });

    const msg = `🗑️ Đã gỡ ghim Thứ ${day}, Tiết ${period} cho ${isSingleClass ? `lớp ${singleClass?.name}` : `${count} lượt ghim`}!`;
    if (onNotification) onNotification(msg);
  };

  // UNPIN SPECIFIC SLOT BY ID (From summary badges)
  const handleUnpinSingleSlotById = (slotId: string) => {
    if (isCurrentTermLocked) return;
    setCustomFixedSlots(prev => {
      const updated = prev.filter(s => s.id !== slotId);
      try {
        localStorage.setItem(customFixedStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (onNotification) onNotification('🗑️ Đã xóa tiết cố định ngoại lệ thành công.');
  };

  // UNPIN GROUPED SLOTS (From summary badges when multiple classes)
  const handleUnpinGroupedSlot = (day: number, period: number, subject: string) => {
    if (isCurrentTermLocked) return;
    let count = 0;
    setCustomFixedSlots(prev => {
      const updated = prev.filter(s => {
        const isTarget = selectedClasses.has(s.classId) && s.day === day && s.period === period && s.subject === subject;
        if (isTarget) count++;
        return !isTarget;
      });
      try {
        localStorage.setItem(customFixedStorageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (onNotification) onNotification(`🗑️ Đã xóa ${count} tiết cố định môn ${subject} (Thứ ${day}, Tiết ${period}).`);
  };

  // CLEAR ALL FIXED SLOTS IN SCHOOL
  const handleClearAllFixedSlots = () => {
    if (customFixedSlots.length === 0) return;
    if (isCurrentTermLocked) {
      alert(`⚠️ Năm học ${currentAcademicYear} đang KHÓA.`);
      return;
    }
    if (window.confirm(`Bạn có chắc muốn xóa TOÀN BỘ ${customFixedSlots.length} tiết cố định của trường không?`)) {
      setCustomFixedSlots([]);
      try {
        localStorage.setItem(customFixedStorageKey, JSON.stringify([]));
      } catch {}
      setSelectedSlots(new Set());
      if (onNotification) onNotification('Đã xóa toàn bộ tiết cố định của trường.');
    }
  };

  // Group summary badges for selected classes
  const summaryBadges = useMemo(() => {
    const list = customFixedSlots.filter(s => selectedClasses.has(s.classId));
    if (isSingleClass) {
      return {
        type: 'single' as const,
        items: list.sort((a, b) => (a.day * 10 + a.period) - (b.day * 10 + b.period))
      };
    }

    // Group by day_period_subject
    const groupsMap = new Map<string, {
      day: number;
      period: number;
      subject: string;
      slots: FixedSlotItem[];
      isAll: boolean;
    }>();

    list.forEach(slot => {
      const groupKey = `${slot.day}_${slot.period}_${slot.subject}`;
      const existing = groupsMap.get(groupKey);
      if (existing) {
        existing.slots.push(slot);
      } else {
        groupsMap.set(groupKey, {
          day: slot.day,
          period: slot.period,
          subject: slot.subject,
          slots: [slot],
          isAll: false
        });
      }
    });

    groupsMap.forEach(g => {
      g.isAll = g.slots.length === selectedClasses.size;
    });

    const groupsArr = Array.from(groupsMap.values()).sort((a, b) => (a.day * 10 + a.period) - (b.day * 10 + b.period));
    return {
      type: 'multiple' as const,
      totalCount: list.length,
      groups: groupsArr
    };
  }, [customFixedSlots, selectedClasses, isSingleClass]);

  return (
    <div className="space-y-4">
      {/* 1. Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-base text-slate-800 flex items-center gap-2">
              <Pin className="w-5 h-5 text-indigo-600 fill-indigo-100" />
              <span>Thiết lập Tiết cố định (Ghim theo Khối & Ngoại lệ từng Lớp)</span>
            </h4>
            <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              Bảng ma trận hợp nhất
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Ghim hàng loạt cho cả Khối hoặc chọn từng lớp để ghi đè ngoại lệ. Tiết đã ghim được bảo toàn 100% khi xếp tự động.
          </p>
        </div>

        {customFixedSlots.length > 0 && (
          <button
            type="button"
            onClick={handleClearAllFixedSlots}
            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1"
            title="Xóa tất cả các tiết cố định trên toàn trường"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa hết tiết ghim toàn trường ({customFixedSlots.length})</span>
          </button>
        )}
      </div>

      {/* 2. Main 2-Column Workspace */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* ======================================================== */}
        {/* LEFT COLUMN: Cây Danh mục Khối & Lớp (Tree Hierarchy)   */}
        {/* ======================================================== */}
        <div className="lg:w-1/4 w-full min-w-[260px] max-w-[320px] border border-slate-200 rounded-xl p-3 bg-slate-50/70 flex flex-col shadow-2xs shrink-0">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2.5">
            <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Phạm vi ghim ({selectedClasses.size}/{classes.length} lớp)</span>
            </span>
            {isSingleClass && (
              <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded font-bold border border-amber-300">
                Ngoại lệ 1 lớp
              </span>
            )}
          </div>

          {/* Quick Select Buttons */}
          <div className="flex items-center justify-between gap-1 mb-2.5 text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedClasses(new Set(classes.map(c => c.id)))}
              className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-1.5 py-0.5 rounded font-bold transition cursor-pointer"
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              onClick={() => setSelectedClasses(new Set())}
              className="text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-1.5 py-0.5 rounded font-medium transition cursor-pointer"
            >
              Bỏ chọn tất cả
            </button>
          </div>

          {/* Search Box */}
          <div className="relative mb-2.5">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Tìm lớp..."
              value={classSearch}
              onChange={e => setClassSearch(e.target.value)}
              className="w-full text-xs pl-8 pr-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
            />
            {classSearch && (
              <button
                type="button"
                onClick={() => setClassSearch('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Tree List */}
          <div className="space-y-2 overflow-y-auto max-h-[500px] pr-1">
            {gradesList.map(grade => {
              const gradeClasses = filteredTreeClasses.filter(c => c.grade === grade);
              if (gradeClasses.length === 0) return null;

              const totalInGrade = classes.filter(c => c.grade === grade);
              const selectedInGrade = totalInGrade.filter(c => selectedClasses.has(c.id));
              const isAllInGrade = selectedInGrade.length === totalInGrade.length;
              const isSomeInGrade = selectedInGrade.length > 0 && !isAllInGrade;
              const isExpanded = expandedGrades.has(grade);

              // Fixed slots in this grade
              const gradeFixedCount = customFixedSlots.filter(s => {
                const cls = classMap.get(s.classId);
                return cls?.grade === grade;
              }).length;

              return (
                <div key={grade} className="space-y-1">
                  {/* Grade Row */}
                  <div className="flex items-center justify-between p-1.5 bg-white rounded-lg border border-slate-200 shadow-2xs hover:bg-indigo-50/40 transition">
                    <div
                      className="flex items-center gap-1.5 flex-1 cursor-pointer"
                      onClick={() => handleToggleGrade(grade)}
                    >
                      <input
                        type="checkbox"
                        ref={el => {
                          if (el) el.indeterminate = isSomeInGrade;
                        }}
                        checked={isAllInGrade}
                        onChange={() => handleToggleGrade(grade)}
                        onClick={e => e.stopPropagation()}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-3.5 h-3.5"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        Khối {grade}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        ({selectedInGrade.length}/{totalInGrade.length})
                      </span>
                      {gradeFixedCount > 0 && (
                        <span className="ml-auto mr-1 text-[9px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded font-bold border border-indigo-200">
                          📌 {gradeFixedCount}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setExpandedGrades(prev => {
                          const next = new Set(prev);
                          if (next.has(grade)) next.delete(grade);
                          else next.add(grade);
                          return next;
                        });
                      }}
                      className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
                      title={isExpanded ? 'Thu gọn' : 'Mở rộng'}
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Class Children */}
                  {isExpanded && (
                    <div className="pl-4 space-y-0.5 border-l-2 border-indigo-100 ml-3.5">
                      {gradeClasses.map(cls => {
                        const isChecked = selectedClasses.has(cls.id);
                        const isCurrentSingle = isSingleClass && selectedClasses.has(cls.id);
                        const classFixedCount = customFixedSlots.filter(s => s.classId === cls.id).length;

                        return (
                          <div
                            key={cls.id}
                            className={`flex items-center justify-between p-1 rounded-md text-xs transition group ${
                              isCurrentSingle
                                ? 'bg-indigo-100 text-indigo-900 font-bold border border-indigo-300'
                                : isChecked
                                ? 'bg-indigo-50/60 text-slate-800 font-semibold'
                                : 'hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            <label className="flex items-center gap-1.5 flex-1 cursor-pointer truncate">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedClasses(prev => {
                                    const next = new Set(prev);
                                    if (next.has(cls.id)) next.delete(cls.id);
                                    else next.add(cls.id);
                                    return next;
                                  });
                                }}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-3.5 h-3.5"
                              />
                              <span className="truncate">{cls.name}</span>
                              {classFixedCount > 0 && (
                                <span className="text-[9px] text-indigo-600 font-bold bg-white px-1 rounded border border-indigo-200">
                                  📌 {classFixedCount}
                                </span>
                              )}
                            </label>

                            {/* Quick "Chỉ chọn" button for exception editing */}
                            <button
                              type="button"
                              onClick={() => handleSelectOnlyClass(cls.id)}
                              className="opacity-0 group-hover:opacity-100 transition text-[10px] text-indigo-600 hover:text-indigo-800 font-bold bg-white hover:bg-indigo-50 border border-slate-200 px-1 py-0.2 rounded shadow-2xs ml-1 shrink-0 cursor-pointer"
                              title={`Chỉ chọn riêng lớp ${cls.name} để thiết lập ngoại lệ`}
                            >
                              Chỉ chọn
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: DUY NHẤT 1 BẢNG LƯỚI MA TRẬN CỐ ĐỊNH      */}
        {/* ======================================================== */}
        <div className="flex-1 w-full flex flex-col gap-3 min-w-0">
          {/* Top Control Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Select Subject */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 whitespace-nowrap">
                  Môn học cần ghim:
                </label>
                <select
                  value={selectedSubject}
                  onChange={e => setSelectedSubject(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 text-xs font-bold shadow-2xs focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {subjectsConfig.map(s => {
                    const quotaInfo = isSingleClass && singleClass
                      ? ` (${getSubjectPeriod(s.id, singleClass.grade, singleClass.id)} tiết/tuần)`
                      : '';
                    return (
                      <option key={s.id} value={s.id}>
                        {s.id} {s.name && s.name !== s.id ? `(${s.name})` : ''}{quotaInfo}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Single Class Mode Info & Teacher Override */}
              {isSingleClass && singleClass && (
                <div className="flex items-center gap-2 pl-2 border-l border-slate-300">
                  <span className="text-xs text-slate-700 font-semibold">
                    GV:
                  </span>
                  <select
                    value={activeSingleTeacherId}
                    onChange={e => setTeacherOverride(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-800 text-xs font-medium shadow-2xs focus:ring-2 focus:ring-indigo-500 max-w-[180px] truncate"
                  >
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.specialization || 'GV'}) {t.id === autoTeacherId ? '⭐' : ''}
                      </option>
                    ))}
                  </select>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-bold border ${
                    singleClassSubjectFixedCount === singleClassSubjectQuota && singleClassSubjectQuota > 0
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : singleClassSubjectFixedCount < singleClassSubjectQuota
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    Đã ghim: {singleClassSubjectFixedCount}/{singleClassSubjectQuota} tiết
                  </span>
                </div>
              )}

              {/* Multi-class summary banner */}
              {!isSingleClass && selectedClasses.size > 0 && (
                <div className="text-xs text-indigo-700 font-semibold bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                  Đang chọn: <strong>{selectedClasses.size} lớp</strong> (Ghim hàng loạt)
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveFixedSlots}
                disabled={selectedSlots.size === 0 || selectedClasses.size === 0}
                className="px-3.5 py-1.5 bg-[#21ba45] hover:bg-[#1fa33a] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer border border-[#1fa33a]/30"
                title="Lưu các ô đang chọn thành tiết cố định cho các lớp đã chọn"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Lưu tiết cố định ({selectedSlots.size} ô)</span>
              </button>

              <button
                type="button"
                onClick={handleUnpinSelectedSlots}
                disabled={selectedSlots.size === 0 || selectedClasses.size === 0}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer border border-rose-700/30"
                title="Bỏ ghim các ô thời gian đang chọn trên lưới cho các lớp được đánh dấu"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Bỏ ghim ({selectedSlots.size} ô)</span>
              </button>
            </div>
          </div>

          {/* Guide banner */}
          <div className="text-[11px] text-slate-600 bg-blue-50/70 border border-blue-200/80 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                {isSingleClass
                  ? <span>Đang chỉnh ngoại lệ cho <strong>Lớp {singleClass?.name}</strong>. Mọi thao tác ghim/bỏ ghim chỉ áp dụng riêng cho lớp này, bảo toàn các lớp khác.</span>
                  : <span>Click ô trên lưới để chọn (✓) rồi bấm <strong>Lưu tiết cố định</strong> hoặc <strong>Bỏ ghim</strong>. Hoặc bấm trực tiếp nút <strong>✕</strong> trong ô để gỡ ghim tức thì.</span>}
              </span>
            </div>
            {selectedSlots.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedSlots(new Set())}
                className="text-blue-700 hover:text-blue-900 font-bold hover:underline shrink-0 cursor-pointer"
              >
                Hủy chọn ô
              </button>
            )}
          </div>

          {/* Matrix Grid Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-300 shadow-xs bg-white">
            <table className="border-collapse text-center w-full text-xs min-w-[620px]">
              <thead>
                <tr className="bg-slate-100 text-slate-800 border-b border-slate-300">
                  <th className="p-2 border-r border-slate-300 w-16 font-bold text-xs">Buổi</th>
                  <th className="p-2 border-r border-slate-300 w-16 font-bold text-xs">Tiết</th>
                  {DAYS_CONFIG.map(d => (
                    <th key={d.day} className="p-2 border-r border-slate-300 last:border-r-0 font-bold text-xs text-slate-800">
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Morning Sessions (1..5) */}
                {[1, 2, 3, 4, 5].map((period, idx) => {
                  return (
                    <tr key={`m_${period}`} className="h-14 hover:bg-slate-50/50 transition">
                      {idx === 0 && (
                        <td rowSpan={5} className="bg-sky-50 text-sky-900 font-bold border-r border-b border-slate-300 align-middle text-xs p-1">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <Sunrise className="w-4 h-4 text-sky-600" />
                            <span>Sáng</span>
                          </div>
                        </td>
                      )}
                      <td className="bg-slate-50 text-slate-700 font-bold border-r border-b border-slate-300 align-middle text-xs">
                        Tiết {period}
                      </td>
                      {DAYS_CONFIG.map(d => renderMatrixCell(d.day, period))}
                    </tr>
                  );
                })}

                {/* Afternoon Sessions (6..10) */}
                {[6, 7, 8, 9, 10].slice(0, afternoonPeriodsCount || 5).map((period, idx) => {
                  return (
                    <tr key={`a_${period}`} className="h-14 hover:bg-slate-50/50 transition border-t-2 border-slate-300">
                      {idx === 0 && (
                        <td
                          rowSpan={afternoonPeriodsCount || 5}
                          className="bg-amber-50 text-amber-900 font-bold border-r border-b border-slate-300 align-middle text-xs p-1"
                        >
                          <div className="flex flex-col items-center justify-center gap-1">
                            <Sunset className="w-4 h-4 text-amber-600" />
                            <span>Chiều</span>
                          </div>
                        </td>
                      )}
                      <td className="bg-slate-50 text-slate-700 font-bold border-r border-b border-slate-300 align-middle text-xs">
                        Tiết {period}
                      </td>
                      {DAYS_CONFIG.map(d => renderMatrixCell(d.day, period))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ======================================================== */}
          {/* 3. KHU VỰC TÓM TẮT DƯỚI BẢNG (SUMMARY BADGES SECTION)   */}
          {/* ======================================================== */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Pin className="w-3.5 h-3.5 text-indigo-600" />
                {isSingleClass ? (
                  <span>Danh sách tiết cố định của <strong>Lớp {singleClass?.name}</strong> ({summaryBadges.items?.length || 0} tiết):</span>
                ) : (
                  <span>Tổng hợp tiết cố định của <strong>{selectedClasses.size} lớp đang chọn</strong> ({summaryBadges.totalCount || 0} lượt ghim):</span>
                )}
              </span>
              {selectedClasses.size > 0 && (
                <span className="text-[11px] text-slate-500 font-medium">
                  Bấm nút <strong>✕</strong> trên từng thẻ để xóa nhanh tiết ngoại lệ
                </span>
              )}
            </div>

            {/* Badges Container */}
            <div className="flex flex-wrap items-center gap-2 max-h-[160px] overflow-y-auto pt-1">
              {isSingleClass ? (
                // Single Class Badges
                (summaryBadges.items || []).length === 0 ? (
                  <span className="text-xs text-slate-400 italic">
                    Chưa có tiết cố định nào cho lớp {singleClass?.name}. Click vào các ô trên ma trận để ghim.
                  </span>
                ) : (
                  summaryBadges.items?.map(slot => {
                    const teacher = teacherMap.get(slot.teacherId);
                    return (
                      <span
                        key={slot.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-indigo-200 text-indigo-900 shadow-2xs hover:border-indigo-400 transition"
                      >
                        <Lock className="w-3 h-3 text-indigo-600 shrink-0" />
                        <span>Thứ {slot.day} - T{slot.period}:</span>
                        <strong className="text-indigo-950">{slot.subject}</strong>
                        <span className="text-slate-500 font-normal">({teacher?.name || 'GV'})</span>
                        <button
                          type="button"
                          onClick={() => handleUnpinSingleSlotById(slot.id)}
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-0.5 rounded ml-1 transition cursor-pointer font-bold"
                          title="Xóa tiết cố định này"
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })
                )
              ) : (
                // Multi-class Grouped Badges
                (summaryBadges.groups || []).length === 0 ? (
                  <span className="text-xs text-slate-400 italic">
                    Chưa có tiết cố định nào cho các lớp đang chọn. Click vào các ô trên ma trận để ghim hàng loạt.
                  </span>
                ) : (
                  summaryBadges.groups?.map(group => {
                    const isAll = group.isAll;
                    return (
                      <span
                        key={`${group.day}_${group.period}_${group.subject}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-2xs transition ${
                          isAll
                            ? 'bg-indigo-50 border border-indigo-200 text-indigo-900'
                            : 'bg-amber-50 border border-amber-200 text-amber-900'
                        }`}
                      >
                        <Lock className={`w-3 h-3 shrink-0 ${isAll ? 'text-indigo-600' : 'text-amber-600'}`} />
                        <span>Thứ {group.day} - T{group.period}:</span>
                        <strong className="text-slate-900">{group.subject}</strong>
                        <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-white border border-slate-200">
                          {isAll ? `${group.slots.length} lớp (Toàn bộ)` : `${group.slots.length}/${selectedClasses.size} lớp (Ngoại lệ)`}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUnpinGroupedSlot(group.day, group.period, group.subject)}
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-0.5 rounded ml-1 transition cursor-pointer font-bold"
                          title={`Gỡ ghim môn ${group.subject} (Thứ ${group.day}, Tiết ${group.period}) cho các lớp này`}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // RENDER INDIVIDUAL CELL ON MATRIX
  function renderMatrixCell(day: number, period: number) {
    const key = `${day}_${period}`;
    const isSelected = selectedSlots.has(key);

    // Matching pinned slots for the currently selected classes
    const matchingSlots = customFixedSlots.filter(
      s => selectedClasses.has(s.classId) && s.day === day && s.period === period
    );

    const pinnedCount = matchingSlots.length;
    const totalCount = selectedClasses.size;
    const isAllPinned = totalCount > 0 && pinnedCount === totalCount;
    const isSomePinned = pinnedCount > 0 && !isAllPinned;
    const isUnpinned = pinnedCount === 0;

    // Detailed hover tooltip
    let tooltipTitle = `Thứ ${day}, Tiết ${period}`;
    if (isSingleClass && singleClass) {
      if (matchingSlots.length > 0) {
        const slot = matchingSlots[0];
        const t = teacherMap.get(slot.teacherId);
        tooltipTitle = `🔒 Lớp ${singleClass.name}: Môn ${slot.subject} - GV: ${t?.name || 'GV'} (Click ô để chọn gỡ ghim hoặc bấm ✕)`;
      } else {
        tooltipTitle = `Thứ ${day}, Tiết ${period}: Trống - Bấm để chọn ghim môn ${selectedSubject} cho lớp ${singleClass.name}`;
      }
    } else {
      if (pinnedCount > 0) {
        const classesBySub: Record<string, string[]> = {};
        matchingSlots.forEach(s => {
          const cName = classMap.get(s.classId)?.name || s.classId;
          const tName = teacherMap.get(s.teacherId)?.name || 'GV';
          if (!classesBySub[s.subject]) classesBySub[s.subject] = [];
          classesBySub[s.subject].push(`${cName} (${tName})`);
        });

        const lines = Object.entries(classesBySub).map(([sub, arr]) => `• Môn ${sub} (${arr.length} lớp): ${arr.join(', ')}`);
        tooltipTitle = `🔒 Thứ ${day}, Tiết ${period} (${pinnedCount}/${totalCount} lớp đã ghim):\n` + lines.join('\n');

        if (isSomePinned) {
          const unpinned = classes
            .filter(c => selectedClasses.has(c.id) && !matchingSlots.some(s => s.classId === c.id))
            .map(c => c.name);
          tooltipTitle += `\nChưa ghim (${unpinned.length} lớp): ${unpinned.join(', ')}`;
        }
      } else {
        tooltipTitle = `Thứ ${day}, Tiết ${period}: Trống - Bấm để chọn ghim cho ${totalCount} lớp`;
      }
    }

    return (
      <td
        key={day}
        onClick={() => handleToggleCellSelection(day, period)}
        title={tooltipTitle}
        className={`p-1 border-r border-b border-slate-300 last:border-r-0 select-none cursor-pointer transition-all h-14 align-middle ${
          isSelected
            ? 'bg-indigo-50 border-2 border-indigo-600 shadow-inner'
            : isAllPinned
            ? 'bg-indigo-50/70 hover:bg-indigo-100/70'
            : isSomePinned
            ? 'bg-amber-50/70 hover:bg-amber-100/70'
            : 'bg-white hover:bg-slate-50'
        }`}
      >
        {/* State A: Single Class Mode */}
        {isSingleClass && (
          matchingSlots.length > 0 ? (
            // Single Class - Pinned Cell
            <div className={`h-full w-full rounded-lg p-1 flex flex-col items-center justify-center text-center shadow-2xs relative group transition ${
              isSelected ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}>
              <div className="flex items-center gap-1 font-bold text-[11px] truncate max-w-full">
                <Lock className="w-3 h-3 text-white fill-white shrink-0" />
                <span className="truncate">{matchingSlots[0].subject}</span>
              </div>
              <div className="text-[10px] text-indigo-100 truncate max-w-full font-medium">
                {teacherMap.get(matchingSlots[0].teacherId)?.name || 'GV'}
              </div>

              {/* Quick remove button */}
              <button
                type="button"
                onClick={e => handleQuickUnpinCell(day, period, e)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition p-0.5 rounded bg-black/20 hover:bg-rose-600 text-white cursor-pointer"
                title="Bỏ ghim ô này"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : isSelected ? (
            // Single Class - Selected for Pinned
            <div className="h-full w-full rounded-lg border-2 border-dashed border-indigo-600 bg-indigo-50/80 flex flex-col items-center justify-center text-indigo-700">
              <Check className="w-4 h-4 font-bold" />
              <span className="text-[10px] font-bold">Chờ ghim</span>
            </div>
          ) : (
            // Single Class - Empty
            <div className="h-full w-full rounded-lg border border-dashed border-slate-200 hover:border-indigo-400 text-slate-300 hover:text-indigo-600 flex flex-col items-center justify-center transition">
              <span className="text-xs font-bold leading-none">+</span>
              <span className="text-[9px] font-medium leading-none mt-0.5">Ghim</span>
            </div>
          )
        )}

        {/* State B: Multi-Class / Whole Grade Mode */}
        {!isSingleClass && (
          pinnedCount > 0 ? (
            // Multi-Class - Pinned Cell (All or Some)
            <div className={`h-full w-full rounded-lg p-1 flex flex-col items-center justify-center text-center shadow-2xs relative group transition ${
              isSelected
                ? 'bg-rose-50 border-2 border-rose-500 text-rose-950'
                : isAllPinned
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-amber-100 border border-amber-300 text-amber-950 hover:bg-amber-200'
            }`}>
              {/* Main Subject Label */}
              <div className="flex items-center gap-1 font-bold text-[11px] truncate max-w-full">
                <Lock className={`w-3 h-3 shrink-0 ${isAllPinned && !isSelected ? 'text-white fill-white' : isSelected ? 'text-rose-600' : 'text-amber-700'}`} />
                <span className="truncate">
                  {matchingSlots.length === 1 || matchingSlots.every(s => s.subject === matchingSlots[0].subject)
                    ? matchingSlots[0].subject
                    : 'Đa môn'}
                </span>
              </div>

              {/* Subline: Class Count */}
              <div className={`text-[10px] font-semibold truncate max-w-full ${
                isAllPinned && !isSelected ? 'text-indigo-100' : isSelected ? 'text-rose-700' : 'text-amber-800'
              }`}>
                {isAllPinned ? `(${pinnedCount} lớp)` : `(${pinnedCount}/${totalCount} lớp)`}
              </div>

              {/* Quick remove button */}
              <button
                type="button"
                onClick={e => handleQuickUnpinCell(day, period, e)}
                className={`absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition p-0.5 rounded cursor-pointer ${
                  isAllPinned && !isSelected ? 'bg-black/20 hover:bg-rose-600 text-white' : 'hover:bg-rose-200 text-rose-700'
                }`}
                title={`Bỏ ghim ô này cho ${pinnedCount} lớp`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : isSelected ? (
            // Multi-Class - Selected for Pinned
            <div className="h-full w-full rounded-lg border-2 border-dashed border-indigo-600 bg-indigo-50/80 flex flex-col items-center justify-center text-indigo-700">
              <Check className="w-4 h-4 font-bold" />
              <span className="text-[10px] font-bold">Chờ ghim</span>
            </div>
          ) : (
            // Multi-Class - Empty
            <div className="h-full w-full rounded-lg border border-dashed border-slate-200 hover:border-indigo-400 text-slate-300 hover:text-indigo-600 flex flex-col items-center justify-center transition">
              <span className="text-xs font-bold leading-none">+</span>
              <span className="text-[9px] font-medium leading-none mt-0.5">Ghim</span>
            </div>
          )
        )}
      </td>
    );
  }
};
