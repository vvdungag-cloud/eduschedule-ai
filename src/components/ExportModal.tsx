import React, { useState, useRef, useMemo } from 'react';
import {
  Printer,
  FileSpreadsheet,
  FileText,
  X,
  Settings,
  CheckCircle2,
  Loader2,
  FileDown,
  Eye,
  Info,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Calendar,
  Layers,
  ArrowUpDown
} from 'lucide-react';
import {
  SchoolInfo,
  exportToExcel,
  exportToWord,
  exportToPdfFromElement,
  calculateMau04Rows,
  exportMau04ToExcel,
  exportMau04ToWord,
  ReportSortOption,
  sortTeachersList,
  getSemesterCode
} from '../utils/exportUtils';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  setSchoolInfo: React.Dispatch<React.SetStateAction<SchoolInfo>>;
  currentSemester?: string;
  currentAcademicYear?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  classes,
  teachers,
  subjects,
  assignments,
  getSubjectPeriod,
  getAssignedTeacherId,
  teacherStatsMap,
  schoolInfo,
  setSchoolInfo,
  currentSemester,
  currentAcademicYear
}) => {
  // Chọn mẫu báo cáo: Mẫu 04 (Thông tư 05/2025/TT-BGDĐT) là mặc định theo yêu cầu
  const [selectedTemplate, setSelectedTemplate] = useState<'mau04' | 'traditional'>('mau04');
  const [traditionalTab, setTraditionalTab] = useState<'all' | 'classes' | 'teachers'>('all');
  const [showConfig, setShowConfig] = useState(false);
  const [exportingType, setExportingType] = useState<'pdf' | 'docx' | 'xlsx' | 'print' | null>(null);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ReportSortOption>('default');
  const [paperSize, setPaperSize] = useState<'a4' | 'a3'>('a4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');

  // Xác định mã học kỳ chuẩn hóa (HKI hoặc HKII) tương ứng với học kỳ đang chọn
  const semCode = useMemo(() => {
    return getSemesterCode(schoolInfo.semester || currentSemester);
  }, [schoolInfo.semester, currentSemester]);

  const defaultWeeksForSemester = semCode === 'HKII' ? 17 : 18;
  const effectiveWeeks = schoolInfo.teachingWeeks || defaultWeeksForSemester;

  // Đồng bộ thông tin học kỳ và năm học tương ứng với trạng thái đang chọn khi mở modal
  React.useEffect(() => {
    if (isOpen) {
      setSchoolInfo(prev => {
        let changed = false;
        const updated = { ...prev };
        if (currentSemester && updated.semester !== currentSemester) {
          updated.semester = currentSemester;
          changed = true;
        }
        if (currentAcademicYear && updated.academicYear !== currentAcademicYear) {
          updated.academicYear = currentAcademicYear;
          changed = true;
        }
        const code = getSemesterCode(currentSemester || updated.semester);
        if (code === 'HKII' && (!updated.teachingWeeks || updated.teachingWeeks === 18)) {
          updated.teachingWeeks = 17;
          changed = true;
        } else if (code === 'HKI' && (!updated.teachingWeeks || updated.teachingWeeks === 17)) {
          updated.teachingWeeks = 18;
          changed = true;
        }
        if (!updated.principalName || updated.principalName.trim() === '' || updated.principalName === 'Hiệu trưởng') {
          updated.principalName = principalTeacher?.name || 'Ngô Thị Kiều Huệ';
          changed = true;
        }
        if (!updated.creatorName || updated.creatorName.trim() === '' || updated.creatorName === 'Bộ phận Chuyên môn' || updated.creatorName === 'Bộ phận chuyên môn') {
          updated.creatorName = 'Võ Việt Dũng';
          changed = true;
        }
        return changed ? updated : prev;
      });
    }
  }, [isOpen, currentSemester, currentAcademicYear, setSchoolInfo]);

  const printContainerRef = useRef<HTMLDivElement>(null);
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  // Danh sách giáo viên được sắp xếp theo tùy chọn
  const sortedTeachers = useMemo(() => {
    return sortTeachersList(teachers, sortBy);
  }, [teachers, sortBy]);

  // Tính dữ liệu Mẫu 04 theo Thông tư 05/2025/TT-BGDĐT
  const mau04Rows = useMemo(() => {
    return calculateMau04Rows({
      classes,
      teachers,
      subjects,
      assignments,
      getSubjectPeriod,
      getAssignedTeacherId,
      teacherStatsMap,
      schoolInfo,
      sortBy
    });
  }, [classes, teachers, subjects, assignments, getSubjectPeriod, getAssignedTeacherId, teacherStatsMap, schoolInfo, sortBy]);

  const principalTeacher = teachers.find(t => t.position?.trim().toLowerCase() === 'hiệu trưởng')
    || teachers.find(t => t.position?.includes('Hiệu trưởng') && !t.position?.includes('Phó'));
  const rawPrincipal = (schoolInfo.principalName || '').trim();
  const principalDisplayName = (rawPrincipal && rawPrincipal !== 'Hiệu trưởng' && rawPrincipal !== 'Hiệu trưởng nhà trường')
    ? rawPrincipal
    : (principalTeacher?.name || 'Ngô Thị Kiều Huệ');

  const rawCreator = (schoolInfo.creatorName || '').trim();
  const creatorDisplayName = (rawCreator && rawCreator !== 'Bộ phận Chuyên môn' && rawCreator !== 'Bộ phận chuyên môn')
    ? rawCreator
    : 'Võ Việt Dũng';

  const currentDateText = useMemo(() => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const schoolNameLower = (schoolInfo.schoolName || '').toLowerCase();
    const place = schoolNameLower.includes('nguyễn bỉnh khiêm') ? 'An Châu' : 'Ngày';
    return place === 'An Châu' 
      ? `An Châu, ngày ${day} tháng ${month} năm ${year}`
      : `Ngày ${day} tháng ${month} năm ${year}`;
  }, [schoolInfo.schoolName]);

  // Cấu hình kích thước preview theo khổ giấy & chiều giấy
  const previewWidth = useMemo(() => {
    if (paperSize === 'a3') {
      return orientation === 'landscape' ? '1800px' : '1250px';
    } else { // a4
      return orientation === 'landscape' ? '1250px' : '850px';
    }
  }, [paperSize, orientation]);

  if (!isOpen) return null;

  const showNotification = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage(null);
    }, 4500);
  };

  const exportData = {
    classes,
    teachers,
    subjects,
    assignments,
    getSubjectPeriod,
    getAssignedTeacherId,
    teacherStatsMap,
    schoolInfo,
    sortBy
  };

  // 1. Xuất file Excel (.xlsx)
  const handleExportExcel = () => {
    try {
      setExportingType('xlsx');
      if (selectedTemplate === 'mau04') {
        exportMau04ToExcel(exportData);
        showNotification('Đã xuất thành công file Excel Mẫu 04 (Thông tư 05/2025/TT-BGDĐT)!');
      } else {
        exportToExcel(exportData);
        showNotification('Đã xuất thành công file Excel bảng phân công tổng hợp!');
      }
    } catch (err) {
      console.error(err);
      alert('Có lỗi xảy ra khi tạo file Excel.');
    } finally {
      setExportingType(null);
    }
  };

  // 2. Xuất file Word (.docx)
  const handleExportWord = async () => {
    try {
      setExportingType('docx');
      if (selectedTemplate === 'mau04') {
        await exportMau04ToWord(exportData);
        showNotification('Đã xuất thành công file Word Mẫu 04 (Thông tư 05/2025/TT-BGDĐT)!');
      } else {
        await exportToWord(exportData);
        showNotification('Đã xuất thành công file Word bảng phân công tổng hợp!');
      }
    } catch (err) {
      console.error(err);
      alert('Có lỗi xảy ra khi tạo file Word.');
    } finally {
      setExportingType(null);
    }
  };

  // 3. Xuất file PDF (.pdf)
  const handleExportPdf = async () => {
    if (!printContainerRef.current) return;
    try {
      setExportingType('pdf');
      setPdfProgress(10);
      const safeYear = schoolInfo.academicYear.replace(/\s+/g, '').replace('/', '-');
      const safeSem = (schoolInfo.semester || 'HK1').replace(/\s+/g, '_');
      const filename = selectedTemplate === 'mau04'
        ? `Mau_04_Bang_Phan_Cong_Giang_Day_TT05_${safeYear}_${safeSem}.pdf`
        : `Bang_Phan_Cong_Chuyen_Mon_${safeYear}_${safeSem}.pdf`;

      await exportToPdfFromElement(
        printContainerRef.current,
        filename,
        (pct) => {
          setPdfProgress(pct);
        },
        paperSize,
        orientation
      );
      showNotification('Đã xuất thành công file PDF báo cáo chuẩn!');
    } catch (err) {
      console.error(err);
      showNotification('Đang mở hộp thoại In để lưu trực tiếp dưới dạng PDF chất lượng cao...');
      handleDirectPrint();
    } finally {
      setExportingType(null);
      setPdfProgress(0);
      setTimeout(() => setPdfProgress(0), 500);
    }
  };

  // 4. In ấn trực tiếp bằng phương thức in trang web tối ưu nhất
  const handleDirectPrint = () => {
    try {
      setExportingType('print');
      
      // Tạo style tag động để thiết lập kích thước trang in hệ thống theo lựa chọn của người dùng
      const style = document.createElement('style');
      style.id = 'dynamic-print-style';
      style.innerHTML = `
        @page { 
          size: ${paperSize.toUpperCase()} ${orientation}; 
          margin: 6mm 5mm 6mm 5mm; 
        }
      `;
      document.head.appendChild(style);

      // Kích hoạt In hệ thống của trình duyệt (với CSS @media print ẩn toàn bộ UI ứng dụng chỉ để lại báo cáo)
      setTimeout(() => {
        window.print();
        
        // Dọn dẹp style động sau khi hoàn tất hộp thoại in
        const dynamicStyle = document.getElementById('dynamic-print-style');
        if (dynamicStyle) {
          dynamicStyle.remove();
        }
        setExportingType(null);
      }, 100);

    } catch (err) {
      console.error('Lỗi khi in trực tiếp:', err);
      setExportingType(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-7xl max-h-[96vh] flex flex-col overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        
        {/* MODAL HEADER */}
        <div className="px-5 py-3 bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-lg border border-white/20">
              <Printer className="w-5 h-5 text-yellow-300" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold">In ấn & Xuất báo cáo phân công chuyên môn</h3>
              <p className="text-xs text-blue-100">
                Hỗ trợ mẫu chuẩn mới nhất <strong>Thông tư 05/2025/TT-BGDĐT</strong>, xuất PDF, Word, Excel và In ấn
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-blue-100 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STATUS NOTIFICATION */}
        {statusMessage && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-emerald-800 text-xs sm:text-sm font-medium flex items-center justify-between animate-in fade-in">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {statusMessage}
            </span>
            <button onClick={() => setStatusMessage(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* TEMPLATE SELECTOR BAR */}
        <div className="bg-blue-50/80 border-b border-blue-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Layers className="w-4 h-4 text-blue-600" /> Chọn mẫu báo cáo:
            </span>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs">
              <button
                onClick={() => setSelectedTemplate('mau04')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  selectedTemplate === 'mau04'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <FileCheck className="w-3.5 h-3.5 text-yellow-300" />
                <span>Mẫu 04: TT 05/2025/TT-BGDĐT</span>
                <span className="text-[10px] bg-yellow-400 text-slate-900 px-1.5 py-0.2 rounded font-bold">Mới</span>
              </button>
              <button
                onClick={() => setSelectedTemplate('traditional')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  selectedTemplate === 'traditional'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>Bảng phân công theo Lớp (Mẫu tổng hợp)</span>
              </button>
            </div>
          </div>

          {/* Quick toggle settings button */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500" />
            <span>Tùy chỉnh thông tin & tiêu đề</span>
            {showConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* CUSTOMIZE SETTINGS ACCORDION */}
        {showConfig && (
          <div className="bg-slate-50 border-b border-slate-200 p-4 shrink-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Đơn vị quản lý cấp trên</label>
              <input
                type="text"
                value={schoolInfo.departmentName}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, departmentName: e.target.value })}
                placeholder="VD: SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tên trường THPT</label>
              <input
                type="text"
                value={schoolInfo.schoolName}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, schoolName: e.target.value })}
                placeholder="VD: TRƯỜNG THPT NGUYỄN BỈNH KHIÊM"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Năm học</label>
              <input
                type="text"
                value={schoolInfo.academicYear}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, academicYear: e.target.value })}
                placeholder="VD: 2025 – 2026"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Học kỳ báo cáo</label>
              <select
                value={schoolInfo.semester || 'Học kỳ I'}
                onChange={(e) => {
                  const newSem = e.target.value;
                  const newCode = getSemesterCode(newSem);
                  setSchoolInfo({
                    ...schoolInfo,
                    semester: newSem,
                    teachingWeeks: newCode === 'HKII' ? (schoolInfo.teachingWeeks === 18 ? 17 : schoolInfo.teachingWeeks) : (schoolInfo.teachingWeeks === 17 ? 18 : schoolInfo.teachingWeeks)
                  });
                }}
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-medium"
              >
                <option value="Học kỳ I">Học kỳ I (HKI)</option>
                <option value="Học kỳ II">Học kỳ II (HKII)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Số tuần thực dạy {semCode}</label>
              <input
                type="number"
                value={effectiveWeeks}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, teachingWeeks: Number(e.target.value) || defaultWeeksForSemester })}
                placeholder={String(defaultWeeksForSemester)}
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày áp dụng</label>
              <input
                type="text"
                value={schoolInfo.applyDate || '08/9/2025'}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, applyDate: e.target.value })}
                placeholder="VD: 08/9/2025"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Căn cứ Thông tư</label>
              <input
                type="text"
                value={schoolInfo.circularNumber || 'Thực hiện theo Thông tư số 05/2025/TT-BGDĐT ngày 07/03/2025 của Bộ GDĐT'}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, circularNumber: e.target.value })}
                placeholder="Thông tư số 05/2025/TT-BGDĐT..."
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Người lập bảng</label>
              <input
                type="text"
                value={schoolInfo.creatorName || ''}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, creatorName: e.target.value })}
                placeholder="Họ tên người lập"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Hiệu trưởng duyệt</label>
              <input
                type="text"
                value={schoolInfo.principalName || ''}
                onChange={(e) => setSchoolInfo({ ...schoolInfo, principalName: e.target.value })}
                placeholder="Họ tên hiệu trưởng"
                className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* ACTION TOOLBAR & EXPORT BUTTONS */}
        <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. PDF */}
            <button
              onClick={handleExportPdf}
              disabled={exportingType !== null}
              className="px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Tải về file PDF chuẩn trang in A4 landscape"
            >
              {exportingType === 'pdf' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang tạo PDF {pdfProgress > 0 ? `(${pdfProgress}%)` : '...'}</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Tải file PDF (.pdf)</span>
                </>
              )}
            </button>

            {/* 2. Word (.docx) */}
            <button
              onClick={handleExportWord}
              disabled={exportingType !== null}
              className="px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Tải về file Word (.docx) chuẩn quy định"
            >
              {exportingType === 'docx' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang tạo Word...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  <span>Xuất Word (.docx)</span>
                </>
              )}
            </button>

            {/* 3. Excel (.xlsx) */}
            <button
              onClick={handleExportExcel}
              disabled={exportingType !== null}
              className="px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Tải về file Excel (.xlsx) với các bảng tính chi tiết"
            >
              {exportingType === 'xlsx' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang tạo Excel...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Xuất Excel (.xlsx)</span>
                </>
              )}
            </button>

            {/* 4. In ấn trực tiếp */}
            <button
              onClick={handleDirectPrint}
              disabled={exportingType !== null}
              className="px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Mở hộp thoại In hệ thống để chọn Máy in, số trang, số bản sao..."
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>In trực tiếp (Print)</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Tùy chọn sắp xếp danh sách giáo viên trong báo cáo */}
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <label htmlFor="report-sort-select" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                Sắp xếp:
              </label>
              <select
                id="report-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ReportSortOption)}
                className="text-xs py-1 px-2 rounded-md border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
                title="Chọn thứ tự sắp xếp danh sách giáo viên trên báo cáo"
              >
                <option value="default">Mặc định (Danh sách trường)</option>
                <option value="subject">Theo bộ môn giảng dạy</option>
                <option value="position">Theo chức vụ (BGH → TTCM → GV)</option>
                <option value="name_abc">Theo thứ tự ABC (Tên giáo viên)</option>
              </select>
            </div>

            {/* Tùy chọn khổ giấy */}
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-300">
              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Khổ giấy:</span>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as 'a4' | 'a3')}
                className="text-xs py-1 px-1.5 rounded-md border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer animate-none"
              >
                <option value="a4">A4</option>
                <option value="a3">A3</option>
              </select>
            </div>

            {/* Tùy chọn chiều giấy */}
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-300">
              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Chiều giấy:</span>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
                className="text-xs py-1 px-1.5 rounded-md border border-slate-300 bg-white font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer animate-none"
              >
                <option value="landscape">Xoay ngang</option>
                <option value="portrait">Xoay dọc</option>
              </select>
            </div>
          </div>
        </div>

        {/* SUB-TABS (IF TRADITIONAL IS SELECTED) */}
        {selectedTemplate === 'traditional' && (
          <div className="px-5 py-1.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2 text-xs shrink-0">
            <span className="font-semibold text-slate-500 mr-1">Chế độ xem:</span>
            <button
              onClick={() => setTraditionalTab('all')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                traditionalTab === 'all'
                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Văn bản đầy đủ
            </button>
            <button
              onClick={() => setTraditionalTab('classes')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                traditionalTab === 'classes'
                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Bảng phân công theo lớp
            </button>
            <button
              onClick={() => setTraditionalTab('teachers')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                traditionalTab === 'teachers'
                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Thống kê giáo viên
            </button>
          </div>
        )}

        {/* DOCUMENT PREVIEW CONTAINER */}
        <div className="flex-1 overflow-auto p-3 sm:p-5 bg-slate-200/80 flex justify-center">
          
          <div
            ref={printContainerRef}
            className={`printable-document bg-white text-slate-900 shadow-md p-5 sm:p-7 rounded-sm min-h-[650px] text-[11px] select-text transition-all duration-300 ${
              (exportingType === 'pdf' || exportingType === 'print') ? 'border-0 shadow-none' : 'border border-slate-300'
            }`}
            style={{ 
              fontFamily: '"Times New Roman", Times, serif',
              width: previewWidth,
              maxWidth: 'none'
            }}
          >
            {/* ========================================================= */}
            {/* TEMPLATE 1: MẪU 04 - THÔNG TƯ 05/2025/TT-BGDĐT (ĐÍNH KÈM) */}
            {/* ========================================================= */}
            {selectedTemplate === 'mau04' && (
              <div>
                {/* Header Row */}
                <div className="pb-2 mb-3">
                  <div className="flex items-center justify-between">
                    {/* Đơn vị ban hành (Góc trái) - đã canh giữa 2 dòng chữ này so với nhau */}
                    <div className="text-center shrink-0">
                      <p className="uppercase text-[11px] font-bold text-slate-800">
                        {schoolInfo.departmentName}
                      </p>
                      <div className="relative inline-block pb-1 mt-0.5">
                        <p className="uppercase text-xs font-bold text-slate-900">
                          {schoolInfo.schoolName}
                        </p>
                        {/* Đường gạch chân bằng 1/3 chiều dài, canh giữa */}
                        <div className="absolute bottom-0 left-[33%] right-[33%] h-[1.5px] bg-slate-800"></div>
                      </div>
                    </div>

                    {/* Quốc hiệu & Tiêu ngữ: 2 dòng canh chính giữa trang giấy */}
                    <div className="flex-1 text-center px-4">
                      <p className="uppercase text-[11px] font-bold text-slate-900 tracking-wide">
                        CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                      </p>
                      <p className="text-[11px] font-bold text-slate-800 mt-0.5">
                        <span className="border-b border-slate-800 pb-1 inline-block">
                          Độc lập - Tự do - Hạnh phúc
                        </span>
                      </p>
                    </div>

                    {/* Phần đối xứng bên phải giúp tiêu đề ở giữa trang hoàn toàn (đã bỏ chữ Mẫu 04) */}
                    <div className="text-center shrink-0 invisible pointer-events-none" aria-hidden="true">
                      <p className="uppercase text-[11px] font-bold">
                        {schoolInfo.departmentName}
                      </p>
                      <div className="relative inline-block pb-1 mt-0.5">
                        <p className="uppercase text-xs font-bold">
                          {schoolInfo.schoolName}
                        </p>
                        {/* Đường gạch chân đối xứng */}
                        <div className="absolute bottom-0 left-[33%] right-[33%] h-[1.5px] bg-slate-800"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tiêu đề & Thông tư */}
                <div className="text-center my-4">
                  <h1 className="text-sm sm:text-base font-bold text-slate-950 uppercase tracking-wide">
                    BẢNG PHÂN CÔNG GIẢNG DẠY {(schoolInfo.semester || 'Học kỳ I').toUpperCase()} NĂM HỌC {schoolInfo.academicYear}
                  </h1>
                  <p className="text-[11px] sm:text-xs text-slate-800 font-bold mt-1">
                    {schoolInfo.circularNumber || 'Thực hiện theo Thông tư số 05/2025/TT-BGDĐT ngày 07/03/2025 của Bộ GDĐT quy định về chế độ làm việc đối với giáo viên phổ thông, dự bị đại học'}
                  </p>
                </div>

                {/* Bảng Mẫu 04 - Cấu trúc 22 cột chuẩn như file ảnh */}
                <div className="overflow-x-auto border border-slate-800">
                  <table className="w-full border-collapse text-[9.5px] sm:text-[10px] leading-tight">
                    <thead>
                      {/* Dòng 1 Header */}
                      <tr className="bg-slate-100 font-bold text-center">
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-6">STT</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1.5 w-32">Họ và tên</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-16">Chuyên môn</th>
                        <th colSpan={2} className="border border-slate-700 py-1 px-1">Nhiệm vụ</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Môn dạy</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1.5 w-32">Các lớp giảng dạy</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Số tuần thực dạy {semCode}</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-14">Số tiết quy định/ tuần</th>
                        <th colSpan={3} className="border border-slate-700 py-1 px-1">Số tiết thực tế dạy/tuần</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Số tiết thừa/ tuần</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Số tiết thiếu/ tuần</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-14">Số tiết quy định/ {semCode}</th>
                        <th colSpan={3} className="border border-slate-700 py-1 px-1">Số tiết thực tế dạy/{semCode} ({effectiveWeeks} tuần)</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">BD HSG TN CĐ</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Số tiết thừa/ {semCode}</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-12">Số tiết thiếu/ {semCode}</th>
                        <th rowSpan={2} className="border border-slate-700 py-1 px-1 w-16">Ngày áp dụng</th>
                      </tr>

                      {/* Dòng 2 Header */}
                      <tr className="bg-slate-100 font-bold text-center">
                        <th className="border border-slate-700 py-1 px-1 w-10">Chính</th>
                        <th className="border border-slate-700 py-1 px-1 w-14">Kiêm nhiệm</th>
                        <th className="border border-slate-700 py-1 px-1 w-11">Thực dạy</th>
                        <th className="border border-slate-700 py-1 px-1 w-10">Kiêm</th>
                        <th className="border border-slate-700 py-1 px-1 w-10">Cộng</th>
                        <th className="border border-slate-700 py-1 px-1 w-11">Thực dạy</th>
                        <th className="border border-slate-700 py-1 px-1 w-10">Kiêm</th>
                        <th className="border border-slate-700 py-1 px-1 w-10">Cộng</th>
                      </tr>

                      {/* Dòng 3 Header: Ký hiệu cột và công thức toán học (A..G và 1..13) */}
                      <tr className="bg-slate-50 font-semibold text-center text-[8.5px] sm:text-[9px]">
                        <th className="border border-slate-600 py-0.5">A</th>
                        <th className="border border-slate-600 py-0.5">B</th>
                        <th className="border border-slate-600 py-0.5">C</th>
                        <th className="border border-slate-600 py-0.5">D</th>
                        <th className="border border-slate-600 py-0.5">E</th>
                        <th className="border border-slate-600 py-0.5">F</th>
                        <th className="border border-slate-600 py-0.5">G</th>
                        <th className="border border-slate-600 py-0.5"></th>
                        <th className="border border-slate-600 py-0.5">1</th>
                        <th className="border border-slate-600 py-0.5">2</th>
                        <th className="border border-slate-600 py-0.5">3</th>
                        <th className="border border-slate-600 py-0.5 bg-slate-200/60 font-bold">4=2+3</th>
                        <th className="border border-slate-600 py-0.5">5=4-1</th>
                        <th className="border border-slate-600 py-0.5">6=1-4</th>
                        <th className="border border-slate-600 py-0.5">7</th>
                        <th className="border border-slate-600 py-0.5">8</th>
                        <th className="border border-slate-600 py-0.5">9</th>
                        <th className="border border-slate-600 py-0.5 bg-slate-200/60 font-bold">10=8+9</th>
                        <th className="border border-slate-600 py-0.5">11</th>
                        <th className="border border-slate-600 py-0.5">12=10-7+11</th>
                        <th className="border border-slate-600 py-0.5">13=7-10+11</th>
                        <th className="border border-slate-600 py-0.5"></th>
                      </tr>
                    </thead>

                    <tbody>
                      {mau04Rows.map((r) => (
                        <tr key={r.stt} className="border-b border-slate-400 hover:bg-slate-50">
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium">{r.stt}</td>
                          <td className="border border-slate-400 text-left py-1 px-1.5 font-bold text-slate-900 whitespace-nowrap">{r.name}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.degree}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.mainDuty}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium text-blue-900">{r.concurrentDuty}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.subjectName}</td>
                          <td className="border border-slate-400 text-left py-1 px-1.5 whitespace-pre-line leading-tight text-[9px]">
                            {r.assignedClassesText}
                          </td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.weeks}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col1_standardWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium">{r.col2_teachingWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col3_concurrentWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-bold bg-slate-50">{r.col4_totalWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium text-emerald-700">{r.col5_overWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium text-rose-700">{r.col6_underWeekly}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col7_standardSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col8_teachingSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col9_concurrentSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-bold bg-slate-50">{r.col10_totalSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1">{r.col11_hsg}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium text-emerald-700">{r.col12_overSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 font-medium text-rose-700">{r.col13_underSemester}</td>
                          <td className="border border-slate-400 text-center py-1 px-1 whitespace-nowrap">{r.applyDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Chữ ký phê duyệt 2 cột */}
                <div 
                  className="flex justify-between items-start w-full pt-8 mt-6 text-center select-text"
                  style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                >
                  <div className="w-[45%]">
                    <p className="text-xs text-transparent mb-1" aria-hidden="true">Cân bằng</p>
                    <p className="font-bold text-xs uppercase text-slate-900">NGƯỜI LẬP BẢNG</p>
                    <p className="text-[10px] text-slate-500 italic">(Ký và ghi rõ họ tên)</p>
                    <div className="h-16"></div>
                    <p className="font-bold text-xs text-slate-900">{creatorDisplayName}</p>
                  </div>

                  <div className="w-[45%]">
                    <p className="text-xs italic text-slate-800 mb-1">{currentDateText}</p>
                    <p className="font-bold text-xs uppercase text-slate-900">HIỆU TRƯỞNG</p>
                    <p className="text-[10px] text-slate-500 italic">(Ký, ghi rõ họ tên & đóng dấu)</p>
                    <div className="h-16"></div>
                    <p className="font-bold text-xs text-slate-900">{principalDisplayName}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* TEMPLATE 2: MẪU PHÂN CÔNG TỔNG HỢP TRUYỀN THỐNG */}
            {/* ========================================================= */}
            {selectedTemplate === 'traditional' && (
              <div>
                <div className="pb-3 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="text-center shrink-0">
                      <p className="uppercase text-xs tracking-wider text-slate-700 font-medium">{schoolInfo.departmentName}</p>
                      <div className="relative inline-block pb-1 mt-0.5">
                        <p className="uppercase text-sm font-bold text-slate-900">
                          {schoolInfo.schoolName}
                        </p>
                        {/* Đường gạch chân bằng 1/3 chiều dài, canh giữa */}
                        <div className="absolute bottom-0 left-[33%] right-[33%] h-[1.5px] bg-slate-800"></div>
                      </div>
                    </div>
                    <div className="flex-1 text-center px-4">
                      <p className="uppercase text-xs font-bold text-slate-900 tracking-wider">
                        CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                      </p>
                      <p className="text-xs font-semibold text-slate-800 mt-0.5">
                        <span className="border-b border-slate-800 pb-1 inline-block">
                          Độc lập - Tự do - Hạnh phúc
                        </span>
                      </p>
                    </div>
                    <div className="text-center shrink-0 invisible pointer-events-none" aria-hidden="true">
                      <p className="uppercase text-xs font-medium">{schoolInfo.departmentName}</p>
                      <div className="relative inline-block pb-1 mt-0.5">
                        <p className="uppercase text-sm font-bold">
                          {schoolInfo.schoolName}
                        </p>
                        {/* Đường gạch chân đối xứng */}
                        <div className="absolute bottom-0 left-[33%] right-[33%] h-[1.5px] bg-slate-800"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center my-4">
                  <h1 className="text-base sm:text-lg font-bold text-slate-900 uppercase">BẢNG PHÂN CÔNG CHUYÊN MÔN VÀ CÔNG TÁC CHỦ NHIỆM</h1>
                  <p className="text-xs text-slate-700 italic mt-1">Năm học: {schoolInfo.academicYear} — {schoolInfo.semester}</p>
                </div>

                {(traditionalTab === 'all' || traditionalTab === 'classes') && (
                  <div className="mb-6">
                    <h2 className="text-xs font-bold text-slate-900 uppercase mb-2">I. BẢNG PHÂN CÔNG GIẢNG DẠY VÀ CHỦ NHIỆM THEO TỪNG LỚP</h2>
                    <div className="overflow-x-auto border border-slate-400">
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 font-bold border-b border-slate-400">
                            <th className="border-r border-slate-400 py-1.5 px-1 w-7 text-center">STT</th>
                            <th className="border-r border-slate-400 py-1.5 px-1 w-10 text-center">Khối</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 w-12 text-center">Lớp</th>
                            <th className="border-r border-slate-400 py-1.5 px-2 w-32 text-left">Giáo viên chủ nhiệm</th>
                            {subjects.map(s => (
                              <th key={s.id} className="border-r border-slate-400 py-1.5 px-1 text-center font-semibold">{s.name}</th>
                            ))}
                            <th className="py-1.5 px-1 w-12 text-center font-bold">Tổng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {classes.map((cls, idx) => {
                            const homeroomId = assignments.homeroomAssignments[cls.id];
                            const homeroomTeacher = homeroomId ? teacherMap.get(homeroomId) : null;
                            let classTotal = 0;

                            return (
                              <tr key={cls.id} className="border-b border-slate-300 hover:bg-slate-50">
                                <td className="border-r border-slate-300 py-1 px-1 text-center font-medium">{idx + 1}</td>
                                <td className="border-r border-slate-300 py-1 px-1 text-center">{cls.grade}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center font-bold text-blue-900">{cls.name}</td>
                                <td className="border-r border-slate-300 py-1 px-2 text-left">
                                  {homeroomTeacher ? (
                                    <span className="font-semibold text-slate-800">{homeroomTeacher.name}</span>
                                  ) : (
                                    <span className="text-slate-400 italic">Chưa phân công</span>
                                  )}
                                </td>
                                {subjects.map(sub => {
                                  const tId = getAssignedTeacherId(cls.id, sub.id);
                                  const teacher = tId ? teacherMap.get(tId) : null;
                                  const p = getSubjectPeriod(sub.id, cls.grade, cls.id);
                                  if (p > 0) classTotal += p;

                                  return (
                                    <td key={sub.id} className="border-r border-slate-300 py-1 px-1 text-center">
                                      {p > 0 ? (
                                        teacher ? (
                                          <div>
                                            <div className="font-medium text-slate-900 leading-tight">{teacher.name}</div>
                                            <span className="text-[9px] text-slate-500 font-mono">({p}t)</span>
                                          </div>
                                        ) : (
                                          <span className="text-rose-500 font-medium">({p}t)</span>
                                        )
                                      ) : (
                                        teacher ? <span className="text-slate-600">{teacher.name}</span> : <span className="text-slate-300">-</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="py-1 px-1 text-center font-bold text-slate-900 bg-slate-50/50">{classTotal}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(traditionalTab === 'all' || traditionalTab === 'teachers') && (
                  <div className="mb-6">
                    <h2 className="text-xs font-bold text-slate-900 uppercase mb-2">II. BẢNG TỔNG HỢP ĐỊNH MỨC TIẾT DẠY CỦA GIÁO VIÊN</h2>
                    <div className="overflow-x-auto border border-slate-400">
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 font-bold border-b border-slate-400">
                            <th className="border-r border-slate-400 py-1.5 px-1 w-8 text-center">STT</th>
                            <th className="border-r border-slate-400 py-1.5 px-2 text-left">Họ và tên</th>
                            <th className="border-r border-slate-400 py-1.5 px-2 text-left">Chức vụ</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Môn dạy</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Lớp CN</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Tiết CM</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Tiết CN</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Tổng tiết</th>
                            <th className="border-r border-slate-400 py-1.5 px-1.5 text-center">Định mức</th>
                            <th className="py-1.5 px-2 text-center">Đánh giá</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedTeachers.map((t, idx) => {
                            const stat = teacherStatsMap[t.id] || {
                              assignedPeriods: 0,
                              homeroomPeriods: 0,
                              totalPeriods: 0,
                              maxQuota: t.maxPeriods || 17,
                              isHomeroom: false,
                              homeroomClass: ''
                            };
                            const diff = stat.totalPeriods - stat.maxQuota;
                            let statusColor = 'text-emerald-700 bg-emerald-50';
                            let evalLabel = 'Đủ định mức';
                            if (diff > 0) {
                              statusColor = 'text-rose-700 bg-rose-50 font-semibold';
                              evalLabel = `Thừa (+${diff}t)`;
                            } else if (diff < 0) {
                              statusColor = 'text-amber-700 bg-amber-50';
                              evalLabel = `Thiếu (${diff}t)`;
                            }

                            return (
                              <tr key={t.id} className="border-b border-slate-300 hover:bg-slate-50">
                                <td className="border-r border-slate-300 py-1 px-1 text-center font-medium">{idx + 1}</td>
                                <td className="border-r border-slate-300 py-1 px-2 text-left font-semibold text-slate-800">{t.name}</td>
                                <td className="border-r border-slate-300 py-1 px-2 text-left">{t.position || 'Giáo viên'}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center">{t.specialization}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center font-medium text-blue-900">{stat.homeroomClass || '-'}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center">{stat.assignedPeriods}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center">{stat.homeroomPeriods}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center font-bold text-slate-900">{stat.totalPeriods}</td>
                                <td className="border-r border-slate-300 py-1 px-1.5 text-center">{stat.maxQuota}</td>
                                <td className={`py-1 px-2 text-center text-[10px] ${statusColor}`}>{evalLabel}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Chữ ký phê duyệt 2 cột cho Mẫu phân công theo lớp & Mẫu truyền thống */}
                <div 
                  className="flex justify-between items-start w-full pt-8 mt-6 text-center select-text"
                  style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                >
                  <div className="w-[45%]">
                    <p className="text-xs text-transparent mb-1" aria-hidden="true">Cân bằng</p>
                    <p className="font-bold text-xs uppercase text-slate-900">NGƯỜI LẬP BẢNG</p>
                    <p className="text-[10px] text-slate-500 italic">(Ký và ghi rõ họ tên)</p>
                    <div className="h-16"></div>
                    <p className="font-bold text-xs text-slate-900">{creatorDisplayName}</p>
                  </div>

                  <div className="w-[45%]">
                    <p className="text-xs italic text-slate-800 mb-1">{currentDateText}</p>
                    <p className="font-bold text-xs uppercase text-slate-900">HIỆU TRƯỞNG</p>
                    <p className="text-[10px] text-slate-500 italic">(Ký, ghi rõ họ tên & đóng dấu)</p>
                    <div className="h-16"></div>
                    <p className="font-bold text-xs text-slate-900">{principalDisplayName}</p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="px-5 py-3 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              {selectedTemplate === 'mau04'
                ? 'Đang xem trước Bảng phân công Mẫu 04 theo Thông tư số 05/2025/TT-BGDĐT. Xuất PDF, Word và Excel sẽ áp dụng chính xác cấu trúc này.'
                : 'Đang xem trước Bảng phân công theo Lớp và Thống kê giáo viên.'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
};
