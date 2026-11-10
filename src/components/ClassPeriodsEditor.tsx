import React, { useState, useMemo, useCallback, memo, useRef } from 'react';
import { 
  BookOpen, Plus, Trash2, ArrowUp, ArrowDown, Copy, RotateCcw, 
  Sparkles, KeyRound, RefreshCw, GraduationCap, ChevronDown, ChevronRight, Check, Save
} from 'lucide-react';
import { useAuth } from '../utils/authContext';
export interface ClassModel {
  id: string;
  name: string;
  grade: '10' | '11' | '12';
  homeroomTeacherId?: string;
  [key: string]: any;
}

export interface SubjectItem {
  id: string;
  name: string;
  grade10Periods?: number;
  grade11Periods?: number;
  grade12Periods?: number;
  [key: string]: any;
}

export interface SubjectSessionConfig {
  mainPeriods: number;
  mainMinPairs: number;
  oppPeriods: number;
  oppMinPairs: number;
  allowRemainingSameSession: boolean;
  sameSessionRule: string;
  maxPeriodsPerSession: number | null;
  alternateDays: boolean;
  singleSessionOnly: boolean;
  isRemoved?: boolean;
}

interface ClassSubjectRowProps {
  index: number;
  subject: SubjectItem;
  config: SubjectSessionConfig;
  classId: string;
  grade: '10' | '11' | '12';
  isCurrentTermLocked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  allowThreeConsecutive: boolean;
  isThreeConsecutive: boolean;
  onUpdateField: (classId: string, subjectId: string, field: string, value: any) => void;
  onRemoveSubject: (subjectId: string, subjectName: string) => void;
  onMoveSubject: (subjectId: string, direction: 'up' | 'down') => void;
  onToggleThreeConsecutive: (classId: string, subjectId: string, checked: boolean) => void;
}

/**
 * ROW COMPONENT TỐI ƯU HÓA BẰNG REACT.MEMO:
 * Khi người dùng gõ số vào 1 ô input, chỉ đúng ô/dòng môn học này re-render.
 * Tuyệt đối không kích hoạt re-render lại toàn bộ 16 dòng môn học khác của bảng!
 */
export const ClassSubjectRow = memo(function ClassSubjectRow({
  index,
  subject,
  config,
  classId,
  isCurrentTermLocked,
  canMoveUp,
  canMoveDown,
  allowThreeConsecutive,
  isThreeConsecutive,
  onUpdateField,
  onRemoveSubject,
  onMoveSubject,
  onToggleThreeConsecutive
}: ClassSubjectRowProps) {
  return (
    <tr style={{ height: '28px', maxHeight: '30px' }} className="hover:bg-blue-50/80 transition-colors group">
      {/* STT */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="text-center border border-slate-400 font-mono text-slate-500 font-medium align-middle">
        {index + 1}
      </td>

      {/* Tên môn */}
      <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 font-bold text-slate-800 text-left align-middle min-w-[120px]">
        <div className="min-w-0 flex items-baseline gap-1">
          <span className="font-semibold text-slate-800 truncate" title={`${subject.name} (Mã: ${subject.id})`}>
            {subject.name}
          </span>
          {subject.id !== subject.name && (
            <span className="text-[10px] font-mono text-slate-400 font-normal shrink-0">({subject.id})</span>
          )}
        </div>
      </td>

      {/* Chính khóa - Tiết */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="number"
          min="0"
          max="15"
          disabled={isCurrentTermLocked}
          readOnly={isCurrentTermLocked}
          value={config.mainPeriods === 0 ? '' : config.mainPeriods}
          onChange={e => {
            if (isCurrentTermLocked) return;
            const raw = e.target.value.trim();
            const val = raw === '' ? 0 : parseInt(raw, 10);
            onUpdateField(classId, subject.id, 'mainPeriods', isNaN(val) ? 0 : Math.max(0, val));
          }}
          onBlur={e => {
            if (isCurrentTermLocked) return;
            const raw = e.target.value.trim();
            const val = raw === '' ? 0 : parseInt(raw, 10);
            onUpdateField(classId, subject.id, 'mainPeriods', isNaN(val) ? 0 : Math.max(0, val));
          }}
          style={{ width: '44px', height: '24px', fontSize: '13px', textAlign: 'center', margin: '0 auto', display: 'block' }}
          className="border border-slate-300 rounded font-bold text-slate-800 bg-white focus:border-sky-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          placeholder="0"
        />
      </td>

      {/* Chính khóa - Số cặp tối thiểu */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="number"
          min="0"
          max="5"
          disabled={isCurrentTermLocked}
          readOnly={isCurrentTermLocked}
          value={config.mainMinPairs === 0 ? '' : config.mainMinPairs}
          onChange={e => {
            if (isCurrentTermLocked) return;
            const val = parseInt(e.target.value, 10);
            onUpdateField(classId, subject.id, 'mainMinPairs', isNaN(val) ? 0 : Math.max(0, val));
          }}
          onBlur={e => {
            if (isCurrentTermLocked) return;
            const val = parseInt(e.target.value, 10);
            onUpdateField(classId, subject.id, 'mainMinPairs', isNaN(val) ? 0 : Math.max(0, val));
          }}
          style={{ width: '44px', height: '24px', fontSize: '13px', textAlign: 'center', margin: '0 auto', display: 'block' }}
          className="border border-slate-300 rounded font-bold text-slate-800 bg-white focus:border-sky-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          placeholder=""
        />
      </td>

      {/* Trái buổi - Tiết */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center bg-[#f0fbf4] align-middle">
        <input
          type="number"
          min="0"
          max="15"
          disabled={isCurrentTermLocked}
          readOnly={isCurrentTermLocked}
          value={config.oppPeriods === 0 ? '' : config.oppPeriods}
          onChange={e => {
            if (isCurrentTermLocked) return;
            const raw = e.target.value.trim();
            const val = raw === '' ? 0 : parseInt(raw, 10);
            onUpdateField(classId, subject.id, 'oppPeriods', isNaN(val) ? 0 : Math.max(0, val));
          }}
          onBlur={e => {
            if (isCurrentTermLocked) return;
            const raw = e.target.value.trim();
            const val = raw === '' ? 0 : parseInt(raw, 10);
            onUpdateField(classId, subject.id, 'oppPeriods', isNaN(val) ? 0 : Math.max(0, val));
          }}
          style={{ width: '44px', height: '24px', fontSize: '13px', textAlign: 'center', margin: '0 auto', display: 'block' }}
          className="border border-emerald-300 rounded font-bold text-emerald-900 bg-white focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          placeholder="0"
        />
      </td>

      {/* Trái buổi - Số cặp tối thiểu */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center bg-[#f0fbf4] align-middle">
        <input
          type="number"
          min="0"
          max="5"
          disabled={isCurrentTermLocked}
          readOnly={isCurrentTermLocked}
          value={config.oppMinPairs === 0 ? '' : config.oppMinPairs}
          onChange={e => {
            if (isCurrentTermLocked) return;
            const val = parseInt(e.target.value, 10);
            onUpdateField(classId, subject.id, 'oppMinPairs', isNaN(val) ? 0 : val);
          }}
          style={{ width: '44px', height: '24px', fontSize: '13px', textAlign: 'center', margin: '0 auto', display: 'block' }}
          className="border border-emerald-300 rounded font-bold text-emerald-900 bg-white focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          placeholder=""
        />
      </td>

      {/* Có thể xếp các tiết còn lại chung 1 buổi */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="checkbox"
          disabled={isCurrentTermLocked}
          checked={config.allowRemainingSameSession || false}
          onChange={e => {
            if (isCurrentTermLocked) return;
            onUpdateField(classId, subject.id, 'allowRemainingSameSession', e.target.checked);
          }}
          style={{ transform: 'scale(0.85)', margin: '0 auto', display: 'block' }}
          className="rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed"
        />
      </td>

      {/* Nếu chung buổi thì phải xếp */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <select
          value={config.sameSessionRule || ''}
          disabled={isCurrentTermLocked}
          onChange={e => {
            if (isCurrentTermLocked) return;
            onUpdateField(classId, subject.id, 'sameSessionRule', e.target.value);
          }}
          style={{ height: '24px', fontSize: '11.5px', padding: '0 4px', width: '100%', maxWidth: '96px', margin: '0 auto', display: 'block' }}
          className="border border-slate-300 rounded bg-white text-slate-800 font-medium cursor-pointer focus:ring-sky-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          <option value="">Không yêu cầu</option>
          <option value="liền nhau">Liền nhau</option>
          <option value="cách buổi">Cách buổi</option>
        </select>
      </td>

      {/* Trong 1 buổi số tiết không được vượt quá */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="number"
          min="1"
          max="5"
          disabled={isCurrentTermLocked}
          readOnly={isCurrentTermLocked}
          value={(config.maxPeriodsPerSession === undefined || config.maxPeriodsPerSession === null) ? '' : config.maxPeriodsPerSession}
          onChange={e => {
            if (isCurrentTermLocked) return;
            const raw = e.target.value.trim();
            const val = raw === '' ? null : parseInt(raw, 10);
            onUpdateField(classId, subject.id, 'maxPeriodsPerSession', (val === null || isNaN(val)) ? null : val);
          }}
          style={{ width: '38px', height: '24px', fontSize: '12.5px', textAlign: 'center', margin: '0 auto', display: 'block' }}
          className="border border-slate-300 rounded font-bold text-slate-800 bg-white focus:border-sky-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
          placeholder=""
        />
      </td>

      {/* Cách ngày */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="checkbox"
          disabled={isCurrentTermLocked}
          checked={config.alternateDays || false}
          onChange={e => {
            if (isCurrentTermLocked) return;
            onUpdateField(classId, subject.id, 'alternateDays', e.target.checked);
          }}
          style={{ transform: 'scale(0.85)', margin: '0 auto', display: 'block' }}
          className="rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed"
        />
      </td>

      {/* Chỉ học một buổi */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle">
        <input
          type="checkbox"
          disabled={isCurrentTermLocked}
          checked={config.singleSessionOnly || false}
          onChange={e => {
            if (isCurrentTermLocked) return;
            onUpdateField(classId, subject.id, 'singleSessionOnly', e.target.checked);
          }}
          style={{ transform: 'scale(0.85)', margin: '0 auto', display: 'block' }}
          className="rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed"
        />
      </td>

      {/* Cột 3 tiết liên tục nếu được bật */}
      {allowThreeConsecutive && (
        <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle bg-amber-50/50">
          <input
            type="checkbox"
            disabled={isCurrentTermLocked}
            checked={isThreeConsecutive}
            onChange={e => {
              if (isCurrentTermLocked) return;
              onToggleThreeConsecutive(classId, subject.id, e.target.checked);
            }}
            style={{ transform: 'scale(0.85)', margin: '0 auto', display: 'block' }}
            className="rounded text-amber-600 focus:ring-amber-500 cursor-pointer disabled:cursor-not-allowed"
            title={`Cho phép xếp 3 tiết liên tục môn ${subject.name}`}
          />
        </td>
      )}

      {/* Cột Thao tác môn học trong lớp */}
      <td style={{ padding: '2px 4px', textAlign: 'center', height: '28px' }} className="border border-slate-400 text-center align-middle whitespace-nowrap bg-slate-50/40">
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            disabled={isCurrentTermLocked}
            onClick={() => {
              if (isCurrentTermLocked) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              onRemoveSubject(subject.id, subject.name);
            }}
            style={{ padding: '1px 4px', fontSize: '11px', height: '22px' }}
            className="inline-flex items-center gap-0.5 font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={isCurrentTermLocked ? "Chế độ Chỉ xem - Không thể xóa môn" : "Bỏ môn khỏi lớp này"}
          >
            <Trash2 className="w-3 h-3 text-rose-600" />
            <span>Xóa</span>
          </button>
          <div className="flex items-center gap-0.5 border-l border-slate-300 pl-1">
            <button
              type="button"
              disabled={!canMoveUp || isCurrentTermLocked}
              onClick={() => {
                if (isCurrentTermLocked) {
                  alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                  return;
                }
                onMoveSubject(subject.id, 'up');
              }}
              style={{ width: '20px', height: '22px', padding: 0 }}
              className="rounded text-slate-500 hover:text-blue-700 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
              title={isCurrentTermLocked ? "Chế độ Chỉ xem" : "Di chuyển lên trên"}
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={!canMoveDown || isCurrentTermLocked}
              onClick={() => {
                if (isCurrentTermLocked) {
                  alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                  return;
                }
                onMoveSubject(subject.id, 'down');
              }}
              style={{ width: '20px', height: '22px', padding: 0 }}
              className="rounded text-slate-500 hover:text-blue-700 hover:bg-slate-100 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
              title={isCurrentTermLocked ? "Chế độ Chỉ xem" : "Di chuyển xuống dưới"}
            >
              <ArrowDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
});

interface ClassPeriodsEditorProps {
  classes: ClassModel[];
  selectedClassId: string;
  onSelectClass: (classId: string) => void;
  subjectsConfig: SubjectItem[];
  classSubjectPeriods: Record<string, any>;
  classShifts: Record<string, string>;
  classThreeConsecutivePeriods: Record<string, Record<string, boolean>>;
  allowThreeConsecutivePeriods: boolean;
  onToggleAllowThreeConsecutive: (val: boolean) => void;
  onUpdateSubjectSessionConfig: (classId: string, subjectId: string, field: string, value: any) => void;
  onUpdateClassShift: (classId: string, shift: string) => void;
  onRemoveSubjectFromClass: (subjectId: string, subjectName: string) => void;
  onMoveSubject: (subjectId: string, direction: 'up' | 'down') => void;
  onOpenCopyModal: (classId: string) => void;
  onResetClassPeriods: (classId: string) => void;
  onToggleThreeConsecutive: (classId: string, subjectId: string, checked: boolean) => void;
  isAdmin: boolean;
  isLocked: boolean;
  academicYear: string;
  onOpenLogin: () => void;
  onOpenNlImport: () => void;
  onNavigateToCatalog: () => void;
  homeroomTeacherName?: string;
  addSubjectToClassId: string;
  setAddSubjectToClassId: (id: string) => void;
  addSubjectMainPeriods: number;
  setAddSubjectMainPeriods: (val: number) => void;
  addSubjectOppPeriods: number;
  setAddSubjectOppPeriods: (val: number) => void;
  onAddSubjectToClass: () => void;
  parseConfig: (raw: any, defaultPeriod: number, subjectId: string, shift: string) => SubjectSessionConfig;
  getSubjectPeriod: (subject: string, grade: '10' | '11' | '12', classId: string) => number;
  onRefreshCloud?: () => void;
  onSave?: () => void;
  isDirty?: boolean;
}

/**
 * COMPONENT KHAI BÁO SỐ TIẾT THEO LỚP ĐƯỢC TỐI ƯU HÓA HIỆU NĂNG CAO:
 * 1. Tách biệt state và memoize bảng môn học
 * 2. Skeleton loading mượt mà khi đổi lớp
 * 3. useMemo tính toán tổng tiết tuần (Chính khóa + Trái buổi)
 * 4. Staging / Draft state: Lưu chủ động bằng nút "Lưu"
 */
export const ClassPeriodsEditor = memo(function ClassPeriodsEditor({
  classes,
  selectedClassId,
  onSelectClass,
  subjectsConfig,
  classSubjectPeriods,
  classShifts,
  classThreeConsecutivePeriods,
  allowThreeConsecutivePeriods,
  onToggleAllowThreeConsecutive,
  onUpdateSubjectSessionConfig,
  onUpdateClassShift,
  onRemoveSubjectFromClass,
  onMoveSubject,
  onOpenCopyModal,
  onResetClassPeriods,
  onToggleThreeConsecutive,
  isAdmin,
  isLocked,
  academicYear,
  onOpenLogin,
  onOpenNlImport,
  onNavigateToCatalog,
  homeroomTeacherName,
  addSubjectToClassId,
  setAddSubjectToClassId,
  addSubjectMainPeriods,
  setAddSubjectMainPeriods,
  addSubjectOppPeriods,
  setAddSubjectOppPeriods,
  onAddSubjectToClass,
  parseConfig,
  getSubjectPeriod,
  onRefreshCloud,
  onSave,
  isDirty = false
}: ClassPeriodsEditorProps) {

  // Chế độ khóa hoặc người dùng chỉ xem (không phải admin)
  const isReadOnly = isLocked || !isAdmin;

  const [expandedGrades, setExpandedGrades] = useState<Record<string, boolean>>({
    '10': true,
    '11': true,
    '12': true
  });

  // Lớp hiện tại đang được chọn (truy xuất tức thì từ RAM)
  const currentTreeClass = useMemo(() => {
    return classes.find(c => c.id === selectedClassId) || classes[0];
  }, [classes, selectedClassId]);

  // Xử lý chuyển đổi lớp tức thì (0ms) từ dữ liệu đã nạp sẵn trong bộ nhớ
  const handleClassClick = useCallback((newClassId: string) => {
    if (newClassId === selectedClassId) return;
    onSelectClass(newClassId);
  }, [selectedClassId, onSelectClass]);

  const currentShift = useMemo(() => {
    if (!currentTreeClass) return 'morning_main';
    return classShifts[currentTreeClass.id] || (currentTreeClass.grade === '10' ? 'morning_main' : 'morning_main');
  }, [currentTreeClass, classShifts]);

  // Tra cứu cấu hình thô của môn trong lớp
  const getSubjectRawVal = useCallback((subId: string) => {
    if (!currentTreeClass) return undefined;
    const cleanId = currentTreeClass.id.replace(/^c_/, '');
    const prefixedId = 'c_' + cleanId;
    const map = classSubjectPeriods[currentTreeClass.id] ||
      classSubjectPeriods[cleanId] ||
      classSubjectPeriods[prefixedId] ||
      (currentTreeClass.name ? classSubjectPeriods[currentTreeClass.name] : undefined);
    if (!map) return undefined;
    if (map[subId] !== undefined) return map[subId];
    return undefined;
  }, [currentTreeClass, classSubjectPeriods]);

  // Danh sách các môn học hiển thị trong lớp (loại trừ các môn đã bị xóa isRemoved)
  const classSubjectsList = useMemo(() => {
    if (!currentTreeClass) return [];
    return subjectsConfig.filter(sub => {
      const val = getSubjectRawVal(sub.id);
      const cfg = parseConfig(val, getSubjectPeriod(sub.id, currentTreeClass.grade, currentTreeClass.id), sub.id, currentShift);
      return !cfg.isRemoved;
    });
  }, [currentTreeClass, subjectsConfig, getSubjectRawVal, parseConfig, getSubjectPeriod, currentShift]);

  // Các môn học có thể thêm vào lớp (các môn đang bị đánh dấu isRemoved)
  const availableSubjectsToAdd = useMemo(() => {
    if (!currentTreeClass) return [];
    return subjectsConfig.filter(sub => {
      const val = getSubjectRawVal(sub.id);
      const cfg = parseConfig(val, getSubjectPeriod(sub.id, currentTreeClass.grade, currentTreeClass.id), sub.id, currentShift);
      return cfg.isRemoved;
    });
  }, [currentTreeClass, subjectsConfig, getSubjectRawVal, parseConfig, getSubjectPeriod, currentShift]);

  // TÍNH TOÁN TỔNG SỐ TIẾT ĐƯỢC MEMOIZE TÁCH BIỆT:
  // Chỉ tính lại khi cấu hình số tiết của lớp thực sự thay đổi!
  const classSummary = useMemo(() => {
    if (!currentTreeClass) return { mainTotal: 0, oppTotal: 0, totalPeriods: 0 };
    let mainTotal = 0;
    let oppTotal = 0;

    classSubjectsList.forEach(sub => {
      const val = getSubjectRawVal(sub.id);
      const cfg = parseConfig(val, getSubjectPeriod(sub.id, currentTreeClass.grade, currentTreeClass.id), sub.id, currentShift);
      mainTotal += cfg.mainPeriods;
      oppTotal += cfg.oppPeriods;
    });

    return {
      mainTotal,
      oppTotal,
      totalPeriods: mainTotal + oppTotal
    };
  }, [currentTreeClass, classSubjectsList, getSubjectRawVal, parseConfig, getSubjectPeriod, currentShift]);

  const isClassCustomized = useMemo(() => {
    return !!(currentTreeClass && classSubjectPeriods[currentTreeClass.id]);
  }, [currentTreeClass, classSubjectPeriods]);

  return (
    <div className="flex-1 flex flex-col p-1.5 md:p-2 min-h-0 bg-slate-50/30 overflow-hidden">
      {/* HÀNG 1 (THÔNG TIN LỚP): Nằm ngang hàng nhau (flex items-center gap-3 py-2 border-b) */}
      <div className="flex items-center gap-3 py-2 px-1 border-b border-slate-200 shrink-0 flex-wrap sm:flex-nowrap min-w-0 bg-white">
        {/* Tiêu đề: "Khai báo số tiết theo lớp" (icon quyển sách) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <BookOpen className="w-4 h-4 text-sky-600 shrink-0" />
          <h2 className="text-[1rem] font-bold text-slate-900 leading-none whitespace-nowrap">
            Khai báo số tiết theo lớp
          </h2>
        </div>

        {/* Đặt trực tiếp ô chọn lớp dạng dropdown: [11B1 ▼] */}
        {currentTreeClass && (
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={currentTreeClass.id}
              onChange={(e) => handleClassClick(e.target.value)}
              className="font-bold text-sky-950 bg-sky-50 hover:bg-sky-100 border border-sky-300 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer h-[30px] shadow-2xs"
              title="Chọn lớp để xem và khai báo số tiết"
            >
              {(['10', '11', '12'] as const).map(grade => {
                const gradeClasses = classes.filter(c => c.grade === grade);
                if (gradeClasses.length === 0) return null;
                return (
                  <optgroup key={grade} label={`Khối ${grade}`}>
                    {gradeClasses.map(cls => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            {/* Đặt ngay phía sau ô chọn lớp là tổng số tiết hiện tại: "({totalHours} tiết/tuần)" */}
            <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              ({classSummary.totalPeriods} tiết/tuần)
            </span>
          </div>
        )}

        {/* Dấu gạch phân cách (|) */}
        <span className="text-slate-300 select-none shrink-0 hidden sm:inline">|</span>

        {/* "GVCN: [Tên GVCN]" */}
        <div
          className="text-xs text-slate-700 flex items-center gap-1 shrink-0 whitespace-nowrap"
          title={homeroomTeacherName ? `GVCN: ${homeroomTeacherName}` : undefined}
        >
          <span className="text-slate-500 font-medium">GVCN:</span>
          <span className="font-semibold text-slate-800">
            {homeroomTeacherName || 'Chưa phân công'}
          </span>
        </div>

        {/* Dấu gạch phân cách (|) */}
        <span className="text-slate-300 select-none shrink-0 hidden sm:inline">|</span>

        {/* "Buổi học:" kèm dropdown chọn buổi học */}
        {currentTreeClass && (
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <span className="text-xs text-slate-500 font-medium">Buổi học:</span>
            <select
              value={currentShift}
              disabled={isReadOnly}
              onChange={(e) => {
                if (isReadOnly) {
                  alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                  return;
                }
                onUpdateClassShift(currentTreeClass.id, e.target.value);
              }}
              className="font-semibold text-sky-950 bg-sky-50 border border-sky-300 rounded px-2 text-xs h-[30px] focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer shadow-2xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              <option value="morning_main">Chính khóa Sáng - Trái buổi Chiều 🌅</option>
              <option value="afternoon_main">Chính khóa Chiều - Trái buổi Sáng 🌇</option>
              <option value="morning">Chỉ học Buổi Sáng (Chính Sáng) ☀️</option>
              <option value="afternoon">Chỉ học Buổi Chiều (Chính Chiều) 🌙</option>
            </select>
          </div>
        )}
      </div>

      {/* HÀNG 2 (DÒNG THAO TÁC DUY NHẤT): Bố trí toàn bộ các nút sau nằm trên 1 hàng ngang duy nhất */}
      <div className="flex items-center gap-2 py-2 px-1 flex-wrap shrink-0">
        {/* 1. Nút "Lưu": Mờ khi isDirty = false; sáng màu xanh lá khi isDirty = true */}
        {onSave && (
          <button
            type="button"
            onClick={() => {
              if (isReadOnly) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              onSave();
            }}
            disabled={isReadOnly || !isDirty}
            style={{ height: '30px', padding: '0 14px', fontSize: '12px' }}
            className={`font-bold rounded inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-all shadow-xs ${
              !isReadOnly && isDirty
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400 cursor-pointer'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-75'
            }`}
            title={
              isReadOnly
                ? "Chế độ Chỉ xem (Vui lòng đăng nhập Quản trị để lưu)"
                : isDirty
                ? "Bấm để lưu toàn bộ số tiết đã chỉnh sửa vào hệ thống"
                : "Tất cả thay đổi đã được lưu"
            }
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            <span>{isDirty && !isReadOnly ? "Lưu *" : "Lưu"}</span>
            {isDirty && !isReadOnly && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping shrink-0" />
            )}
          </button>
        )}

        {/* 2. Nút "Sao chép sang các lớp..." */}
        <button
          type="button"
          onClick={() => {
            if (isReadOnly) {
              alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
              return;
            }
            if (currentTreeClass) onOpenCopyModal(currentTreeClass.id);
          }}
          disabled={!currentTreeClass || isReadOnly}
          style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
          className={`font-semibold rounded inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition shadow-2xs ${
            isReadOnly || !currentTreeClass
              ? 'text-slate-400 bg-slate-50 border border-slate-200 cursor-not-allowed opacity-60'
              : 'text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-300 cursor-pointer'
          }`}
          title={
            isReadOnly
              ? "Chế độ Chỉ xem - Không thể sao chép"
              : currentTreeClass
              ? `Sao chép cấu hình số tiết từ lớp ${currentTreeClass.name} sang các lớp được chọn`
              : undefined
          }
        >
          <Copy className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>Sao chép sang các lớp...</span>
        </button>

        {/* 3. Nút "Khôi phục mặc định" */}
        {currentTreeClass && (
          <button
            type="button"
            onClick={() => {
              if (isReadOnly) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              onResetClassPeriods(currentTreeClass.id);
            }}
            disabled={!isClassCustomized || isReadOnly}
            style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
            className={`font-medium rounded inline-flex items-center gap-1 shrink-0 whitespace-nowrap transition ${
              isClassCustomized && !isReadOnly
                ? 'text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 shadow-2xs cursor-pointer'
                : 'text-slate-400 bg-slate-50 border border-slate-200 cursor-not-allowed opacity-60'
            }`}
            title={
              isReadOnly
                ? "Chế độ Chỉ xem"
                : isClassCustomized
                ? "Khôi phục lại số tiết mặc định của khối cho lớp này"
                : "Lớp đang dùng số tiết mặc định của khối"
            }
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Khôi phục mặc định</span>
          </button>
        )}

        {/* 4. Nút "Làm mới" */}
        {onRefreshCloud && (
          <button
            type="button"
            onClick={() => {
              if (!isAdmin) {
                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                return;
              }
              onRefreshCloud();
            }}
            disabled={!isAdmin}
            style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
            className={`font-semibold border rounded shadow-2xs inline-flex items-center gap-1 shrink-0 whitespace-nowrap transition ${
              !isAdmin
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 cursor-pointer'
            }`}
            title={!isAdmin ? "Chế độ Chỉ xem" : "Làm mới dữ liệu từ Cloud Firestore"}
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Làm mới</span>
          </button>
        )}

        {/* 5. Checkbox "Cột cho phép khai báo 3 tiết liên tục" */}
        <label className={`inline-flex items-center gap-1.5 text-xs font-medium select-none px-2.5 h-[30px] rounded border shadow-2xs transition shrink-0 whitespace-nowrap ${
          isReadOnly
            ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'
        }`}>
          <input
            type="checkbox"
            disabled={isReadOnly}
            checked={allowThreeConsecutivePeriods}
            onChange={e => {
              if (isReadOnly) return;
              onToggleAllowThreeConsecutive(e.target.checked);
            }}
            className="w-3.5 h-3.5 rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed"
          />
          <span>Cột cho phép khai báo 3 tiết liên tục</span>
        </label>

        {/* 6. Nút "Nhập số tiết bằng AI" (viền/màu tím bên góc phải) */}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => {
              if (isLocked) {
                alert(`⚠️ Dữ liệu năm học ${academicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                return;
              }
              onOpenNlImport();
            }}
            style={{ height: '30px', padding: '0 12px', fontSize: '12px' }}
            className="ml-auto font-semibold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-300 rounded shadow-2xs inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            title="Khai báo số tiết các môn học bằng ngôn ngữ tự nhiên AI"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span>Nhập số tiết bằng AI ✨</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenLogin}
            style={{ height: '30px', padding: '0 12px', fontSize: '12px' }}
            className="ml-auto font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded shadow-2xs inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            title="Chế độ Chỉ xem. Mở khóa Quản trị để thay đổi định mức tiết môn học."
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-700" />
            <span>Đăng nhập Quản trị</span>
          </button>
        )}
      </div>

      {/* Main Two-Panel Layout */}
      <div className="flex-1 flex flex-col md:flex-row border border-slate-300 rounded-lg overflow-hidden bg-white shadow-xs min-h-0">
        
        {/* LEFT: TREE VIEW */}
        <div className="w-full md:w-52 lg:w-56 border-b md:border-b-0 md:border-r border-slate-300 bg-white flex flex-col shrink-0 select-none">
          <div className="py-1.5 px-2.5 bg-slate-100/80 border-b border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-sky-600" />
              Danh sách Khối - Lớp
            </span>
            <span className="text-[11px] font-semibold text-slate-500 font-mono">{classes.length} lớp</span>
          </div>

          <div className="flex-1 overflow-y-auto py-0.5 text-xs">
            {(['10', '11', '12'] as const).map(grade => {
              const gradeClasses = classes.filter(c => c.grade === grade);
              const isExpanded = expandedGrades[grade] ?? true;

              return (
                <div key={grade} className="mb-0.5">
                  {/* Grade node */}
                  <button
                    type="button"
                    onClick={() => setExpandedGrades(prev => ({ ...prev, [grade]: !prev[grade] }))}
                    className="w-full flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-100 transition text-left cursor-pointer border-y border-transparent hover:border-slate-200"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                    )}
                    <span>Khối {grade}</span>
                    <span className="text-[10px] text-slate-400 font-normal ml-auto">({gradeClasses.length})</span>
                  </button>

                  {/* Class leaf nodes */}
                  {isExpanded && (
                    <div className="bg-slate-50/40">
                      {gradeClasses.map(cls => {
                        const isSelected = currentTreeClass?.id === cls.id;
                        const isCustom = !!classSubjectPeriods[cls.id];
                        return (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => handleClassClick(cls.id)}
                            style={{ padding: '3px 8px', fontSize: '12.5px' }}
                            className={`w-full text-left pl-7 pr-2 transition flex items-center justify-between cursor-pointer border-y border-transparent ${
                              isSelected
                                ? 'bg-sky-200/70 text-sky-950 font-bold border-l-4 border-l-sky-600 shadow-2xs'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-medium'
                            }`}
                          >
                            <span>{cls.name}</span>
                            {isCustom && (
                              <span className="text-[9px] px-1 bg-amber-100 text-amber-800 rounded font-normal" title="Có số tiết tùy chỉnh riêng">
                                Tùy chỉnh
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom quick action to navigate to Môn học catalog */}
          <div className="p-1.5 border-t border-slate-200 bg-slate-50/80 shrink-0">
            <button
              type="button"
              onClick={onNavigateToCatalog}
              className="w-full py-1 px-2 text-[11px] font-semibold text-indigo-800 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-md shadow-2xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              title="Chuyển sang tab Môn học để xem và quản lý danh mục toàn trường"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Xem danh mục Môn học</span>
            </button>
          </div>
        </div>

        {/* RIGHT: SUBJECT PERIODS TABLE */}
        {currentTreeClass && (
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* The Table */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden" style={{ marginTop: '0px', overflowY: 'hidden' }}>
              <table className="w-full text-left border-collapse border border-slate-400" style={{ borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead className="bg-[#b4e7ff] text-[#0f547c] font-bold sticky top-0 z-10">
                  <tr>
                    <th rowSpan={2} style={{ padding: '2px 4px', height: '26px' }} className="text-center border border-slate-400 w-9 font-bold align-middle">
                      STT
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', minWidth: '120px' }} className="border border-slate-400 font-bold align-middle text-left">
                      Môn
                    </th>
                    <th colSpan={2} style={{ padding: '2px 4px' }} className="text-center border border-slate-400 bg-sky-100/70 font-bold">
                      Chính khóa ({currentShift === 'afternoon_main' || currentShift === 'afternoon' ? 'Chiều' : 'Sáng'})
                    </th>
                    <th colSpan={2} style={{ padding: '2px 4px' }} className="text-center border border-slate-400 bg-emerald-50 text-emerald-800 font-bold">
                      Trái buổi ({currentShift === 'afternoon_main' || currentShift === 'afternoon' ? 'Sáng' : 'Chiều'})
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '110px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight">
                      Có thể xếp các tiết còn lại chung 1 buổi
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '100px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight">
                      Nếu chung buổi thì phải xếp
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '85px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight">
                      Trong 1 buổi số tiết không được vượt quá
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '60px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight">
                      Cách ngày
                    </th>
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '68px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight">
                      Chỉ học một buổi
                    </th>
                    {allowThreeConsecutivePeriods && (
                      <th rowSpan={2} style={{ padding: '2px 4px', width: '70px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight bg-amber-100/80 text-amber-900">
                        3 tiết liên tục
                      </th>
                    )}
                    <th rowSpan={2} style={{ padding: '2px 4px', width: '85px' }} className="text-center border border-slate-400 font-bold align-middle leading-tight whitespace-nowrap bg-[#b4e7ff] text-[#0f547c]">
                      Thao tác
                    </th>
                  </tr>
                  <tr className="bg-sky-50 text-slate-800 font-semibold">
                    <th style={{ padding: '2px 4px', width: '56px' }} className="text-center border border-slate-400 font-bold">Tiết</th>
                    <th style={{ padding: '2px 4px', width: '70px', minWidth: '65px', lineHeight: '1.15' }} className="text-center border border-slate-400 font-bold whitespace-nowrap">
                      Số cặp<br />tối thiểu
                    </th>
                    <th style={{ padding: '2px 4px', width: '56px' }} className="text-center border border-slate-400 font-bold bg-[#e6f9f0] text-emerald-900">Tiết</th>
                    <th style={{ padding: '2px 4px', width: '70px', minWidth: '65px', lineHeight: '1.15' }} className="text-center border border-slate-400 font-bold bg-[#e6f9f0] text-emerald-900 whitespace-nowrap">
                      Số cặp<br />tối thiểu
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {classSubjectsList.length === 0 ? (
                    <tr>
                      <td colSpan={allowThreeConsecutivePeriods ? 13 : 12} className="py-6 text-center text-slate-400 font-medium">
                        Chưa có môn học nào được chọn cho lớp {currentTreeClass.name}. Vui lòng chọn môn từ thanh <strong>"+ Thêm môn học cho lớp"</strong> phía dưới.
                      </td>
                    </tr>
                  ) : (
                    classSubjectsList.map((sub, idx) => {
                      const currentVal = getSubjectRawVal(sub.id);
                      const config = parseConfig(currentVal, getSubjectPeriod(sub.id, currentTreeClass.grade, currentTreeClass.id), sub.id, currentShift);
                      const isThree = !!classThreeConsecutivePeriods[currentTreeClass.id]?.[sub.id];

                      return (
                        <ClassSubjectRow
                          key={`${currentTreeClass.id}_${sub.id}`}
                          index={idx}
                          subject={sub}
                          config={config}
                          classId={currentTreeClass.id}
                          grade={currentTreeClass.grade}
                          isCurrentTermLocked={isReadOnly}
                          canMoveUp={idx > 0}
                          canMoveDown={idx < classSubjectsList.length - 1}
                          allowThreeConsecutive={allowThreeConsecutivePeriods}
                          isThreeConsecutive={isThree}
                          onUpdateField={onUpdateSubjectSessionConfig}
                          onRemoveSubject={onRemoveSubjectFromClass}
                          onMoveSubject={onMoveSubject}
                          onToggleThreeConsecutive={onToggleThreeConsecutive}
                        />
                      );
                    })
                  )}
                </tbody>

                <tfoot>
                  <tr style={{ height: '28px', maxHeight: '30px' }} className="bg-sky-50 font-bold border-t-2 border-slate-400 text-slate-900 text-xs md:text-sm">
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center font-bold"></td>
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 font-bold text-slate-900 text-left">
                      Tổng số tiết: <span className="text-sky-900">{classSummary.totalPeriods}t</span>
                    </td>
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center font-bold text-sky-800 text-sm">
                      {classSummary.mainTotal}
                    </td>
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center font-bold text-sky-800 text-sm"></td>
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center font-bold text-emerald-800 text-sm bg-[#f0fbf4]">
                      {classSummary.oppTotal}
                    </td>
                    <td style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center font-bold text-emerald-800 text-sm bg-[#f0fbf4]"></td>
                    <td colSpan={allowThreeConsecutivePeriods ? 6 : 5} style={{ padding: '2px 4px', height: '28px' }} className="border border-slate-400 text-center text-slate-600 text-xs font-semibold">
                      {classSubjectsList.length} môn học (Chính: {classSummary.mainTotal}t, Trái: {classSummary.oppTotal}t, Tổng: {classSummary.totalPeriods}t)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Sub-toolbar: THÊM MÔN HỌC CHO LỚP NÀY */}
            <div 
              style={{ padding: '3px 8px', gap: '8px' }}
              className="bg-sky-50/90 border-t border-b border-sky-200 flex flex-wrap items-center text-xs shrink-0"
            >
              <div className="flex items-center gap-1.5 font-bold text-sky-950 shrink-0">
                <Plus className="w-3.5 h-3.5 text-sky-600 stroke-[2.5]" />
                <span>Thêm môn học cho lớp {currentTreeClass.name}:</span>
              </div>

              <div className="flex-1 min-w-[160px] sm:min-w-[220px]">
                <select
                  value={addSubjectToClassId}
                  onChange={(e) => {
                    if (isReadOnly) return;
                    const chosenId = e.target.value;
                    setAddSubjectToClassId(chosenId);
                    if (chosenId && currentTreeClass) {
                      const def = getSubjectPeriod(chosenId, currentTreeClass.grade, currentTreeClass.id);
                      setAddSubjectMainPeriods(def > 0 ? def : 2);
                      setAddSubjectOppPeriods(0);
                    }
                  }}
                  disabled={isReadOnly}
                  className="w-full h-7 px-2 border border-slate-300 rounded font-semibold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-xs"
                >
                  <option value="">-- Chọn môn học cần thêm vào lớp --</option>
                  {availableSubjectsToAdd.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                  {/* Cho phép chọn lại từ danh mục nếu danh sách availableSubjectsToAdd trống */}
                  {availableSubjectsToAdd.length === 0 && subjectsConfig.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Nhập số tiết khi thêm */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-600 font-medium whitespace-nowrap">Chính khóa:</span>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    disabled={isReadOnly}
                    value={addSubjectMainPeriods}
                    onChange={e => {
                      if (isReadOnly) return;
                      setAddSubjectMainPeriods(Math.max(0, parseInt(e.target.value, 10) || 0));
                    }}
                    className="w-11 h-7 border border-slate-300 rounded text-center font-bold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] text-slate-500">tiết</span>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-emerald-800 font-medium whitespace-nowrap">Trái buổi:</span>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    disabled={isReadOnly}
                    value={addSubjectOppPeriods}
                    onChange={e => {
                      if (isReadOnly) return;
                      setAddSubjectOppPeriods(Math.max(0, parseInt(e.target.value, 10) || 0));
                    }}
                    className="w-11 h-7 border border-emerald-300 rounded text-center font-bold text-emerald-900 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] text-slate-500">tiết</span>
                </div>

                <button
                  type="button"
                  disabled={!addSubjectToClassId || isReadOnly}
                  onClick={() => {
                    if (isReadOnly) {
                      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                      return;
                    }
                    onAddSubjectToClass();
                  }}
                  className="h-7 px-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-bold transition flex items-center gap-1 text-xs cursor-pointer shadow-2xs whitespace-nowrap"
                  title={isReadOnly ? "Chế độ Chỉ xem" : "Thêm môn học này vào bảng của lớp"}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm môn</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
