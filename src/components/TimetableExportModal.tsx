import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  Printer,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Calendar,
  Users,
  GraduationCap,
  BookOpen,
  Search,
  Filter,
  Check,
  Loader2,
  Sparkles,
  School,
  FileCheck2,
  Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Teacher, ClassModel } from '../utils/assignmentSolver';
import {
  TimetableData,
  TimetableLesson,
  DAYS_CONFIG,
  SessionMode,
  PERIODS_CONFIG
} from '../utils/timetableTypes';

export type TimetableTemplateType = 'school_master' | 'by_class' | 'by_teacher' | 'by_subject';

// Helper rút gọn tên môn học dài chống tràn ô bảng
export const formatShortSubject = (subjectName: string): string => {
  if (!subjectName) return '';
  const s = subjectName.trim();
  const lower = s.toLowerCase();
  
  if (lower.includes('hoạt động trải nghiệm') || lower.includes('hướng nghiệp') || lower === 'hdtn' || lower.includes('hđtn')) return 'HĐTN';
  if ((lower.includes('kinh tế') && lower.includes('pháp luật')) || lower.includes('gdkt & pl') || lower.includes('gdkt&pl') || lower.includes('gdktpl')) return 'GDKTPL';
  if (lower.includes('quốc phòng') || lower.includes('an ninh') || lower.includes('gdqp')) return 'GDQP';
  if (lower.includes('thể chất') || lower.includes('thể dục') || lower.includes('gdtc')) return 'GDTC';
  if (lower.includes('địa phương') || lower.includes('gdđp') || lower.includes('gddp')) return 'GDĐP';
  if (lower.includes('khoa học tự nhiên') || lower.includes('khtn')) return 'KHTN';
  if (lower.includes('lịch sử & địa lí') || lower.includes('lịch sử và địa lý')) return 'LS-ĐL';
  
  return s;
};

interface TimetableExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: ClassModel[];
  teachers: Teacher[];
  subjectsConfig: { id: string; name?: string }[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  timetableData: TimetableData | null;
  lessonsByClass: Map<string, Map<string, TimetableLesson>>;
  lessonsByTeacher: Map<string, Map<string, TimetableLesson>>;
  currentAcademicYear: string;
  currentSemester: string;
  sessionMode?: SessionMode;
  afternoonPeriodsCount?: number;
  schoolName?: string;
  onNotification?: (msg: string) => void;
}

export const TimetableExportModal: React.FC<TimetableExportModalProps> = ({
  isOpen,
  onClose,
  classes,
  teachers,
  subjectsConfig,
  assignments,
  timetableData,
  lessonsByClass,
  lessonsByTeacher,
  currentAcademicYear,
  currentSemester,
  sessionMode = 'morning' as any,
  afternoonPeriodsCount = 4,
  schoolName = 'TRƯỜNG THPT NGUYỄN BỈNH KHIÊM',
  onNotification
}) => {
  // --- FORM STATES ---
  const [template, setTemplate] = useState<TimetableTemplateType>('school_master');
  const [applyDate, setApplyDate] = useState('12/10/2026');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [classLayoutMode, setClassLayoutMode] = useState<'4_per_page' | 'detail'>('4_per_page');

  // Filters for "by_class"
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(() => new Set(classes.map(c => c.id)));
  const [classGradeFilter, setClassGradeFilter] = useState<'all' | '10' | '11' | '12'>('all');

  // Filters for "by_teacher"
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(() => new Set(teachers.map(t => t.id)));
  const [teacherDeptFilter, setTeacherDeptFilter] = useState<string>('all');
  const [teacherSearchTerm, setTeacherSearchTerm] = useState('');

  // Filters for "by_subject"
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() => subjectsConfig[0]?.id || 'Toán');

  // Master options
  const [masterGradeFilter, setMasterGradeFilter] = useState<'all' | '10' | '11' | '12'>('all');
  const [masterSessionFilter, setMasterSessionFilter] = useState<'all' | 'morning' | 'afternoon'>('all');

  // Processing state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgressText, setExportProgressText] = useState('');

  // Teacher & Class lookups
  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);

  // Unique departments for teachers
  const departments = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach(t => {
      if (t.specialization) set.add(t.specialization.trim());
    });
    return Array.from(set).sort();
  }, [teachers]);

  // When template changes, auto-suggest standard orientation
  const handleTemplateChange = (next: TimetableTemplateType) => {
    setTemplate(next);
    if (next === 'school_master') {
      setOrientation('landscape');
    } else if (next === 'by_class') {
      setOrientation(classLayoutMode === '4_per_page' ? 'portrait' : 'landscape');
    } else if (next === 'by_teacher') {
      setOrientation('portrait');
    } else if (next === 'by_subject') {
      setOrientation('landscape');
    }
  };

  // Quick class select helpers
  const handleQuickSelectClasses = (targetGrade: 'all' | '10' | '11' | '12') => {
    setClassGradeFilter(targetGrade);
    if (targetGrade === 'all') {
      setSelectedClassIds(new Set(classes.map(c => c.id)));
    } else {
      setSelectedClassIds(new Set(classes.filter(c => c.grade === targetGrade).map(c => c.id)));
    }
  };

  const toggleClassSelect = (classId: string) => {
    setSelectedClassIds(prev => {
      const next = new Set(prev);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  };

  const handleSelectAllClasses = () => {
    setSelectedClassIds(new Set(classes.map(c => c.id)));
  };

  const handleClearAllClasses = () => {
    setSelectedClassIds(new Set());
  };

  // Teacher filter helpers
  const filteredTeachersForSelection = useMemo(() => {
    return teachers.filter(t => {
      const matchDept = teacherDeptFilter === 'all' || t.specialization === teacherDeptFilter;
      const matchSearch = !teacherSearchTerm ||
        t.name.toLowerCase().includes(teacherSearchTerm.toLowerCase()) ||
        t.specialization.toLowerCase().includes(teacherSearchTerm.toLowerCase());
      return matchDept && matchSearch;
    });
  }, [teachers, teacherDeptFilter, teacherSearchTerm]);

  const toggleTeacherSelect = (teacherId: string) => {
    setSelectedTeacherIds(prev => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  };

  const handleSelectAllTeachers = () => {
    setSelectedTeacherIds(new Set(teachers.map(t => t.id)));
  };

  const handleClearAllTeachers = () => {
    setSelectedTeacherIds(new Set());
  };

  // Filtered classes based on master grade filter
  const targetMasterClasses = useMemo(() => {
    if (masterGradeFilter === 'all') return classes;
    return classes.filter(c => c.grade === masterGradeFilter);
  }, [classes, masterGradeFilter]);

  // Selected classes list for "by_class"
  const targetClassesList = useMemo(() => {
    return classes.filter(c => selectedClassIds.has(c.id));
  }, [classes, selectedClassIds]);

  // Selected teachers list for "by_teacher"
  const targetTeachersList = useMemo(() => {
    return teachers.filter(t => selectedTeacherIds.has(t.id));
  }, [teachers, selectedTeacherIds]);

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Helper chuẩn hóa tên tệp xuất theo quy định
  const getExportFileName = (extension: 'pdf' | 'xlsx') => {
    const safeDate = applyDate.replace(/[\/\\:]/g, '-');
    const safeYear = currentAcademicYear.replace(/\s+/g, '_');
    const safeSem = currentSemester.replace(/\s+/g, '_');

    if (template === 'school_master') {
      return `TKB_ToanTruong_${safeSem}_${safeYear}_${safeDate}.${extension}`;
    } else if (template === 'by_class') {
      if (selectedClassIds.size === 1) {
        const clsId = Array.from(selectedClassIds)[0];
        const clsName = classes.find(c => c.id === clsId)?.name || 'Lop';
        return `TKB_Lop_${clsName}_${safeSem}_${safeYear}_${safeDate}.${extension}`;
      }
      return `TKB_TheoLop_${safeSem}_${safeYear}_${safeDate}.${extension}`;
    } else if (template === 'by_teacher') {
      if (selectedTeacherIds.size === 1) {
        const tId = Array.from(selectedTeacherIds)[0];
        const tName = teachers.find(t => t.id === tId)?.name.replace(/\s+/g, '_') || 'GV';
        return `TKB_GV_${tName}_${safeSem}_${safeYear}.${extension}`;
      }
      return `TKB_GiaoVien_${safeSem}_${safeYear}_${safeDate}.${extension}`;
    } else if (template === 'by_subject') {
      const safeSub = selectedSubjectId.replace(/\s+/g, '_');
      return `TKB_To_${safeSub}_${safeSem}_${safeYear}_${safeDate}.${extension}`;
    }
    return `TKB_${template}_${safeSem}_${safeYear}_${safeDate}.${extension}`;
  };

  // -------------------------------------------------------------
  // 1. EXPORT TO EXCEL (.xlsx)
  // -------------------------------------------------------------
  const handleExportExcel = () => {
    if (!timetableData || !timetableData.lessons || timetableData.lessons.length === 0) {
      alert('Chưa có dữ liệu Thời khóa biểu để xuất Excel.');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      if (template === 'school_master') {
        // Sheet: TKB Toàn trường
        const masterRows: any[] = [];
        const masterMerges: any[] = [];
        const cList = targetMasterClasses;

        masterRows.push([`THỜI KHÓA BIỂU TỔNG HỢP TOÀN TRƯỜNG - HỌC KỲ ${currentSemester.toUpperCase()} - NĂM HỌC ${currentAcademicYear.toUpperCase()}`]);
        masterRows.push([`Đơn vị: ${schoolName} | Áp dụng từ ngày: ${applyDate}`]);
        masterRows.push([]);

        const masterHeader = ['Thứ', 'Buổi', 'Tiết', ...cList.map(c => c.name)];
        masterRows.push(masterHeader);

        const totalCols = 3 + cList.length;
        masterMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
        masterMerges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });

        let curRow = 4;
        const days = [2, 3, 4, 5, 6, 7];

        days.forEach(dayNum => {
          const dayStartRow = curRow;

          // Sáng
          if (masterSessionFilter === 'all' || masterSessionFilter === 'morning') {
            const morningStartRow = curRow;
            for (let p = 1; p <= 5; p++) {
              const row: any[] = [`Thứ ${dayNum}`, 'Sáng', `S${p}`];
              cList.forEach(cls => {
                const cLessons = lessonsByClass.get(cls.id);
                const l = cLessons?.get(`${dayNum}_${p}`);
                row.push(l ? `${l.subject} (${l.teacherName})` : '');
              });
              masterRows.push(row);
              curRow++;
            }
            masterMerges.push({ s: { r: morningStartRow, c: 1 }, e: { r: curRow - 1, c: 1 } });
          }

          // Chiều
          if (sessionMode === 'double' && (masterSessionFilter === 'all' || masterSessionFilter === 'afternoon')) {
            const afternoonStartRow = curRow;
            for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
              const row: any[] = [`Thứ ${dayNum}`, 'Chiều', `C${p - 5}`];
              cList.forEach(cls => {
                const cLessons = lessonsByClass.get(cls.id);
                const l = cLessons?.get(`${dayNum}_${p}`);
                row.push(l ? `${l.subject} (${l.teacherName})` : '');
              });
              masterRows.push(row);
              curRow++;
            }
            masterMerges.push({ s: { r: afternoonStartRow, c: 1 }, e: { r: curRow - 1, c: 1 } });
          }

          if (curRow > dayStartRow) {
            masterMerges.push({ s: { r: dayStartRow, c: 0 }, e: { r: curRow - 1, c: 0 } });
          }
        });

        const wsMaster = XLSX.utils.aoa_to_sheet(masterRows);
        wsMaster['!merges'] = masterMerges;
        wsMaster['!cols'] = [
          { wch: 10 },
          { wch: 9 },
          { wch: 7 },
          ...cList.map(() => ({ wch: 18 }))
        ];
        XLSX.utils.book_append_sheet(wb, wsMaster, 'TKB_Tong_Hop');

      } else if (template === 'by_class') {
        // Sheet: Từng Lớp
        const classRows: any[] = [];
        const classMerges: any[] = [];
        let curRow = 0;

        targetClassesList.forEach(cls => {
          const hrId = assignments.homeroomAssignments[cls.id];
          const hrName = hrId ? (teacherMap.get(hrId)?.name || '') : 'Chưa phân công';

          classRows.push([schoolName]);
          classRows.push([`THỜI KHÓA BIỂU LỚP: ${cls.name}`]);
          classRows.push([`Học kỳ ${currentSemester} - Năm học ${currentAcademicYear} | Áp dụng: ${applyDate}`]);
          classRows.push([`Giáo viên chủ nhiệm: ${hrName}`]);
          classRows.push([]);

          for (let offset = 0; offset < 4; offset++) {
            classMerges.push({ s: { r: curRow + offset, c: 0 }, e: { r: curRow + offset, c: 7 } });
          }
          curRow += 5;

          classRows.push(['Buổi', 'Tiết', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']);
          curRow++;

          // Sáng
          const morningStart = curRow;
          for (let p = 1; p <= 5; p++) {
            const row: any[] = ['SÁNG', `S${p}`];
            for (let day = 2; day <= 7; day++) {
              const l = lessonsByClass.get(cls.id)?.get(`${day}_${p}`);
              row.push(l ? l.subject : '');
            }
            classRows.push(row);
            curRow++;
          }
          classMerges.push({ s: { r: morningStart, c: 0 }, e: { r: curRow - 1, c: 0 } });

          // Chiều
          if (sessionMode === 'double' && afternoonPeriodsCount > 0) {
            const afternoonStart = curRow;
            for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
              const row: any[] = ['CHIỀU', `C${p - 5}`];
              for (let day = 2; day <= 7; day++) {
                const l = lessonsByClass.get(cls.id)?.get(`${day}_${p}`);
                row.push(l ? l.subject : '');
              }
              classRows.push(row);
              curRow++;
            }
            classMerges.push({ s: { r: afternoonStart, c: 0 }, e: { r: curRow - 1, c: 0 } });
          }

          classRows.push([]);
          classRows.push([]);
          curRow += 2;
        });

        const wsClasses = XLSX.utils.aoa_to_sheet(classRows);
        wsClasses['!merges'] = classMerges;
        wsClasses['!cols'] = [
          { wch: 10 },
          { wch: 8 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 }
        ];
        XLSX.utils.book_append_sheet(wb, wsClasses, 'TKB_Theo_Lop');

      } else if (template === 'by_teacher') {
        // Sheet: Giáo viên
        const teacherRows: any[] = [];
        teacherRows.push([`THỜI KHÓA BIỂU GIÁO VIÊN - NĂM HỌC ${currentAcademicYear} (${currentSemester})`]);
        teacherRows.push([`Đơn vị: ${schoolName} | Áp dụng từ ngày: ${applyDate}`]);
        teacherRows.push([]);

        const tHeader = ['Mã GV', 'Họ và tên', 'Tổ bộ môn', 'Chức vụ', 'Tổng tiết'];
        const periodsList = PERIODS_CONFIG.slice(0, sessionMode === 'double' ? 5 + afternoonPeriodsCount : 5);

        DAYS_CONFIG.forEach(d => {
          periodsList.forEach(p => {
            tHeader.push(`${d.shortLabel}-${p.label.split(' ')[0]}`);
          });
        });
        teacherRows.push(tHeader);

        targetTeachersList.forEach(t => {
          const tLessons = lessonsByTeacher.get(t.id);
          const totalPeriods = tLessons ? tLessons.size : 0;
          const row = [t.id, t.name, t.specialization, t.position || 'Giáo viên', totalPeriods];

          DAYS_CONFIG.forEach(d => {
            periodsList.forEach(p => {
              const l = tLessons?.get(`${d.day}_${p.period}`);
              row.push(l ? `${l.subject} (${l.className})` : '');
            });
          });
          teacherRows.push(row);
        });

        const wsTeachers = XLSX.utils.aoa_to_sheet(teacherRows);
        wsTeachers['!cols'] = [
          { wch: 10 },
          { wch: 22 },
          { wch: 16 },
          { wch: 14 },
          { wch: 10 },
          ...DAYS_CONFIG.flatMap(() => periodsList.map(() => ({ wch: 14 })))
        ];
        XLSX.utils.book_append_sheet(wb, wsTeachers, 'TKB_Giao_Vien');

      } else if (template === 'by_subject') {
        // Sheet: Tổ Bộ môn
        const subRows: any[] = [];
        subRows.push([`THỜI KHÓA BIỂU TỔ BỘ MÔN: ${selectedSubjectId.toUpperCase()}`]);
        subRows.push([`Học kỳ ${currentSemester} - Năm học ${currentAcademicYear} | Áp dụng từ: ${applyDate}`]);
        subRows.push([]);

        const subTeachers = teachers.filter(t => t.specialization.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(t.specialization.toLowerCase()));
        const header = ['Thứ', 'Buổi', 'Tiết', ...(subTeachers.length > 0 ? subTeachers : teachers).map(t => t.name)];
        subRows.push(header);

        const targetTList = subTeachers.length > 0 ? subTeachers : teachers;
        const days = [2, 3, 4, 5, 6, 7];

        days.forEach(d => {
          for (let p = 1; p <= (sessionMode === 'double' ? 5 + afternoonPeriodsCount : 5); p++) {
            const isMorning = p <= 5;
            const pLabel = isMorning ? `S${p}` : `C${p - 5}`;
            const row: any[] = [`Thứ ${d}`, isMorning ? 'Sáng' : 'Chiều', pLabel];

            targetTList.forEach(t => {
              const l = lessonsByTeacher.get(t.id)?.get(`${d}_${p}`);
              if (l && (l.subject.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(l.subject.toLowerCase()))) {
                row.push(l.className);
              } else {
                row.push('');
              }
            });
            subRows.push(row);
          }
        });

        const wsSub = XLSX.utils.aoa_to_sheet(subRows);
        wsSub['!cols'] = [
          { wch: 10 },
          { wch: 8 },
          { wch: 6 },
          ...targetTList.map(() => ({ wch: 14 }))
        ];
        XLSX.utils.book_append_sheet(wb, wsSub, `TKB_Mon_${selectedSubjectId}`);
      }

      const fileName = getExportFileName('xlsx');
      XLSX.writeFile(wb, fileName);

      if (onNotification) onNotification(`Đã xuất tệp Excel (${fileName}) thành công!`);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Đã xảy ra lỗi khi tạo tệp Excel.');
    }
  };

  // -------------------------------------------------------------
  // 2. EXPORT TO PDF (.pdf)
  // -------------------------------------------------------------
  const handleExportPDF = async () => {
    if (!timetableData || !timetableData.lessons || timetableData.lessons.length === 0) {
      alert('Chưa có dữ liệu Thời khóa biểu để xuất PDF.');
      return;
    }

    setIsExporting(true);
    setExportProgressText('Đang khởi tạo tài liệu PDF chất lượng cao...');

    // Container nằm ngoài viewport hiển thị nhưng giữ nguyên tọa độ dương để tránh html2canvas clipping
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '0px';
    tempContainer.style.top = '100000px';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.background = '#ffffff';
    tempContainer.style.color = '#0f172a';
    tempContainer.style.fontFamily = 'Arial, "Segoe UI", sans-serif';
    document.body.appendChild(tempContainer);

    try {
      const pdf = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: 'a4'
      });

      // Helper đưa phần tử HTML vào trang PDF với đúng tỉ lệ khung hình (Aspect Ratio), chiếm trọn 100% chiều rộng giấy, không bao giờ bị co cụm
      const renderPageToPdf = async (element: HTMLElement, pageNum: number, targetOrientation: 'portrait' | 'landscape') => {
        tempContainer.appendChild(element);

        // Chờ DOM tính toán layout font & width
        await new Promise(r => setTimeout(r, 80));

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: targetOrientation === 'landscape' ? 1400 : 980
        });

        tempContainer.removeChild(element);

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        // Margin theo chuẩn: landscape margin: 5mm 6mm, portrait margin: 4mm 5mm
        const marginX = targetOrientation === 'landscape' ? 6 : 5;
        const marginY = targetOrientation === 'landscape' ? 5 : 4;

        const usableWidth = pageWidth - marginX * 2;
        const usableHeight = pageHeight - marginY * 2;

        const fullRenderHeight = (canvas.height / canvas.width) * usableWidth;

        // Nếu bảng vừa khít trên 1 trang (fullRenderHeight <= usableHeight):
        if (fullRenderHeight <= usableHeight) {
          if (pageNum > 1) {
            pdf.addPage('a4', targetOrientation);
          }
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const posY = marginY + (usableHeight - fullRenderHeight) / 2;
          pdf.addImage(imgData, 'JPEG', marginX, posY, usableWidth, fullRenderHeight, undefined, 'FAST');
        } else {
          // Bảng dài hơn 1 trang: Slicing canvas đa trang mà VẪN GIỮ NGUYÊN 100% CHIỀU RỘNG!
          // Tuyệt đối KHÔNG thu nhỏ chiều rộng làm co cụm bảng!
          const pageCanvasHeight = (usableHeight / usableWidth) * canvas.width;
          let currentY = 0;
          let isFirstSlice = true;

          while (currentY < canvas.height) {
            if (pageNum > 1 || !isFirstSlice) {
              pdf.addPage('a4', targetOrientation);
            }
            isFirstSlice = false;

            const sliceHeight = Math.min(pageCanvasHeight, canvas.height - currentY);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = sliceHeight;
            const ctx = sliceCanvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
              ctx.drawImage(canvas, 0, currentY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
            }

            const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
            const sliceRenderHeight = (sliceHeight / canvas.width) * usableWidth;
            pdf.addImage(sliceImgData, 'JPEG', marginX, marginY, usableWidth, sliceRenderHeight, undefined, 'FAST');

            currentY += sliceHeight;
          }
        }
      };

      // ==============================================================
      // 1. TEMPLATE: THỜI KHÓA BIỂU TOÀN TRƯỜNG (A4 NGANG THEO TỪNG KHỐI)
      // ==============================================================
      if (template === 'school_master') {
        const gradeList = masterGradeFilter === 'all' ? ['10', '11', '12'] : [masterGradeFilter];
        const gradePages = gradeList.map(g => ({
          grade: g,
          classes: classes.filter(c => c.grade === g)
        })).filter(gp => gp.classes.length > 0);

        let currentPage = 1;

        for (let gIdx = 0; gIdx < gradePages.length; gIdx++) {
          const { grade, classes: gradeClasses } = gradePages[gIdx];
          setExportProgressText(`Đang kết xuất TKB Toàn trường - Khối ${grade} (${gradeClasses.length} lớp)...`);

          const pageEl = document.createElement('div');
          pageEl.className = 'print-container';
          pageEl.style.width = '1400px';
          pageEl.style.padding = '12px 14px';
          pageEl.style.background = '#ffffff';
          pageEl.style.boxSizing = 'border-box';

          const classColWidth = (88 / gradeClasses.length).toFixed(3);

          const classesHeaderCols = gradeClasses.map(c => `
            <th style="border: 1px solid #1e293b; padding: 4px 1px; font-weight: bold; text-align: center; background-color: #f1f5f9; font-size: 8.5px; color: #0f172a; width: ${classColWidth}%;">
              ${c.name}
            </th>
          `).join('');

          const days = [2, 3, 4, 5, 6, 7];
          let tableRowsHTML = '';

          days.forEach(dayNum => {
            const morningPeriods = (masterSessionFilter === 'all' || masterSessionFilter === 'morning') ? [1, 2, 3, 4, 5] : [];
            const afternoonPeriods = (sessionMode === 'double' && (masterSessionFilter === 'all' || masterSessionFilter === 'afternoon'))
              ? Array.from({ length: afternoonPeriodsCount }, (_, i) => 6 + i)
              : [];
            const totalForDay = morningPeriods.length + afternoonPeriods.length;

            morningPeriods.forEach((p, pIdx) => {
              const dayCell = pIdx === 0
                ? `<td rowspan="${totalForDay}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; vertical-align: middle; background-color: #f8fafc; font-size: 9.5px; width: 4.5%;">Thứ ${dayNum}</td>`
                : '';
              const sessionCell = pIdx === 0
                ? `<td rowspan="${morningPeriods.length}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; vertical-align: middle; background-color: #f8fafc; font-size: 9px; width: 4.5%;">Sáng</td>`
                : '';

              const cols = gradeClasses.map(cls => {
                const l = lessonsByClass.get(cls.id)?.get(`${dayNum}_${p}`);
                return `
                  <td class="schedule-cell" style="border: 1px solid #94a3b8; text-align: center; vertical-align: middle; min-height: 42px; height: auto; padding: 2px 1px; box-sizing: border-box; overflow: visible; width: ${classColWidth}%;">
                    <div style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; min-height: 38px; text-align: center;">
                      ${l ? `
                        <div style="font-size: 10.5px; font-weight: 700; color: #0f172a; text-align: center; line-height: 1.2; word-break: break-word;">
                          ${formatShortSubject(l.subject)}
                        </div>
                      ` : '<span style="color: #cbd5e1; font-size: 8px;">—</span>'}
                    </div>
                  </td>
                `;
              }).join('');

              tableRowsHTML += `
                <tr style="height: auto;">
                  ${dayCell}
                  ${sessionCell}
                  <td style="border: 1px solid #0f172a; text-align: center; vertical-align: middle; font-weight: bold; background-color: #fafafa; font-size: 8.5px; width: 3%;">S${p}</td>
                  ${cols}
                </tr>
              `;
            });

            afternoonPeriods.forEach((p, pIdx) => {
              const dayCell = (morningPeriods.length === 0 && pIdx === 0)
                ? `<td rowspan="${totalForDay}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; vertical-align: middle; background-color: #f8fafc; font-size: 9.5px; width: 4.5%;">Thứ ${dayNum}</td>`
                : '';
              const sessionCell = pIdx === 0
                ? `<td rowspan="${afternoonPeriods.length}" style="border: 1px solid #0f172a; font-weight: bold; text-align: center; vertical-align: middle; background-color: #fffbeb; font-size: 9px; width: 4.5%; color: #b45309;">Chiều</td>`
                : '';

              const cols = gradeClasses.map(cls => {
                const l = lessonsByClass.get(cls.id)?.get(`${dayNum}_${p}`);
                return `
                  <td class="schedule-cell" style="border: 1px solid #94a3b8; text-align: center; vertical-align: middle; min-height: 42px; height: auto; padding: 2px 1px; box-sizing: border-box; overflow: visible; background-color: #fffdfa; width: ${classColWidth}%;">
                    <div style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; min-height: 38px; text-align: center;">
                      ${l ? `
                        <div style="font-size: 10.5px; font-weight: 700; color: #0f172a; text-align: center; line-height: 1.2; word-break: break-word;">
                          ${formatShortSubject(l.subject)}
                        </div>
                      ` : '<span style="color: #cbd5e1; font-size: 8px;">—</span>'}
                    </div>
                  </td>
                `;
              }).join('');

              tableRowsHTML += `
                <tr style="height: auto;">
                  ${dayCell}
                  ${sessionCell}
                  <td style="border: 1px solid #0f172a; text-align: center; vertical-align: middle; font-weight: bold; background-color: #fffdf5; font-size: 8.5px; width: 3%;">C${p - 5}</td>
                  ${cols}
                </tr>
              `;
            });
          });

          pageEl.innerHTML = `
            <div>
              <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #334155; padding-bottom: 5px; margin-bottom: 6px;">
                <div style="line-height: 1.25;">
                  <div style="font-size: 9.5px; text-transform: uppercase; color: #64748b; font-weight: bold;">SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG</div>
                  <div style="font-size: 12px; font-weight: 900; text-transform: uppercase; color: #0f172a;">${schoolName}</div>
                </div>
                <div style="text-align: right; line-height: 1.25;">
                  <div style="font-size: 10px; font-weight: bold; color: #0f172a;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                  <div style="font-size: 9px; font-style: italic; color: #64748b;">Độc lập - Tự do - Hạnh phúc</div>
                </div>
              </div>

              <div style="text-align: center; margin-bottom: 8px;">
                <h1 style="font-size: 15px; font-weight: 900; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.5px;">
                  THỜI KHÓA BIỂU TOÀN TRƯỜNG - KHỐI ${grade} (${gradeClasses.length} LỚP)
                </h1>
                <h2 style="font-size: 11px; font-weight: bold; margin: 3px 0 0 0; color: #334155;">
                  HỌC KỲ ${currentSemester.toUpperCase()} - NĂM HỌC ${currentAcademicYear.toUpperCase()}
                </h2>
                <p style="font-size: 9px; font-style: italic; margin: 2px 0 0 0; color: #64748b;">
                  Áp dụng từ ngày: ${applyDate}
                </p>
              </div>

              <table class="print-table" style="width: 100%; border-collapse: collapse; font-size: 8.5px; border: 1.5px solid #0f172a; table-layout: fixed; margin: 0 auto;">
                <colgroup>
                  <col style="width: 4.5%;" />
                  <col style="width: 4.5%;" />
                  <col style="width: 3%;" />
                  ${gradeClasses.map(() => `<col style="width: ${classColWidth}%;" />`).join('')}
                </colgroup>
                <thead>
                  <tr style="background-color: #f1f5f9; color: #0f172a;">
                    <th style="border: 1px solid #334155; padding: 4px 1px; font-weight: bold; text-align: center; width: 4.5%;">Thứ</th>
                    <th style="border: 1px solid #334155; padding: 4px 1px; font-weight: bold; text-align: center; width: 4.5%;">Buổi</th>
                    <th style="border: 1px solid #334155; padding: 4px 1px; font-weight: bold; text-align: center; width: 3%;">Tiết</th>
                    ${classesHeaderCols}
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHTML}
                </tbody>
              </table>
            </div>
          `;

          await renderPageToPdf(pageEl, currentPage++, 'landscape');
        }
      }

      // ==============================================================
      // 2. TEMPLATE: THỜI KHÓA BIỂU THEO LỚP (MẪU PHÁT HS - 4 LỚP / TRANG A4)
      // ==============================================================
      else if (template === 'by_class') {
        setExportProgressText('Đang dựng phiếu TKB từng lớp học...');
        const cList = targetClassesList;
        const chunkSize = classLayoutMode === '4_per_page' ? 4 : 1;
        let currentPage = 1;

        for (let i = 0; i < cList.length; i += chunkSize) {
          const chunk = cList.slice(i, i + chunkSize);
          setExportProgressText(`Đang xử lý trang TKB lớp ${chunk.map(c => c.name).join(', ')}...`);

          const pageEl = document.createElement('div');
          pageEl.className = 'print-container';
          pageEl.style.width = classLayoutMode === '4_per_page' ? '980px' : (orientation === 'landscape' ? '1400px' : '980px');
          pageEl.style.padding = '12px';
          pageEl.style.background = '#ffffff';
          pageEl.style.boxSizing = 'border-box';
          pageEl.style.display = 'grid';
          pageEl.style.gridTemplateColumns = classLayoutMode === '4_per_page' ? 'repeat(2, 1fr)' : '1fr';
          pageEl.style.gap = '12px';

          chunk.forEach(cls => {
            const hrId = assignments.homeroomAssignments[cls.id];
            const hrName = hrId ? (teacherMap.get(hrId)?.name || '') : 'Chưa phân công';

            let classTbodyHTML = '';
            for (let p = 1; p <= 5; p++) {
              const sessionTD = p === 1 ? `<td rowspan="5" style="border: 1px solid #1e293b; text-align: center; vertical-align: middle; font-weight: bold; background-color: #f8fafc; font-size: 9px; width: 14%;">SÁNG</td>` : '';
              const daysTD = [2, 3, 4, 5, 6, 7].map(d => {
                const l = lessonsByClass.get(cls.id)?.get(`${d}_${p}`);
                return `
                  <td class="schedule-cell" style="border: 1px solid #cbd5e1; text-align: center; vertical-align: middle; min-height: 38px; height: auto; padding: 2px 1px; box-sizing: border-box; overflow: visible; width: 12.66%;">
                    <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; width: 100%; min-height: 32px; overflow: visible;">
                      ${l ? `
                        <div style="font-size: 9.8px; font-weight: 600; color: #0f172a; text-align: center; line-height: 1.2; word-break: break-word;">
                          ${formatShortSubject(l.subject)}
                        </div>
                      ` : '<span style="color: #cbd5e1; font-size: 8px;">—</span>'}
                    </div>
                  </td>
                `;
              }).join('');

              classTbodyHTML += `
                <tr style="height: auto;">
                  ${sessionTD}
                  <td style="border: 1px solid #475569; text-align: center; vertical-align: middle; font-weight: bold; background-color: #f8fafc; font-size: 8.5px; width: 10%;">S${p}</td>
                  ${daysTD}
                </tr>
              `;
            }

            if (sessionMode === 'double' && afternoonPeriodsCount > 0) {
              for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
                const sessionTD = p === 6 ? `<td rowspan="${afternoonPeriodsCount}" style="border: 1px solid #1e293b; text-align: center; vertical-align: middle; font-weight: bold; background-color: #fffbeb; color: #b45309; font-size: 9px; width: 14%;">CHIỀU</td>` : '';
                const daysTD = [2, 3, 4, 5, 6, 7].map(d => {
                  const l = lessonsByClass.get(cls.id)?.get(`${d}_${p}`);
                  return `
                    <td class="schedule-cell" style="border: 1px solid #cbd5e1; text-align: center; vertical-align: middle; min-height: 38px; height: auto; padding: 2px 1px; box-sizing: border-box; overflow: visible; background-color: #fffdfa; width: 12.66%;">
                      <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; width: 100%; min-height: 32px; overflow: visible;">
                        ${l ? `
                          <div style="font-size: 9.8px; font-weight: 600; color: #0f172a; text-align: center; line-height: 1.2; word-break: break-word;">
                            ${formatShortSubject(l.subject)}
                          </div>
                        ` : '<span style="color: #cbd5e1; font-size: 8px;">—</span>'}
                      </div>
                    </td>
                  `;
                }).join('');

                classTbodyHTML += `
                  <tr style="height: auto;">
                    ${sessionTD}
                    <td style="border: 1px solid #475569; text-align: center; vertical-align: middle; font-weight: bold; background-color: #fffdf5; font-size: 8.5px; width: 10%;">C${p - 5}</td>
                    ${daysTD}
                  </tr>
                `;
              }
            }

            const cardHTML = `
              <div style="border: 1.5px solid #1e293b; border-radius: 8px; padding: 8px 10px; background: #ffffff; box-sizing: border-box; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px;">
                  <div style="font-size: 13px; font-weight: 900; color: #0f172a;">Lớp: ${cls.name}</div>
                  <div style="font-size: 10px; font-weight: 700; color: #334155;">GVCN: ${hrName}</div>
                </div>

                <table class="print-table" style="width: 100%; border-collapse: collapse; font-size: 8.5px; border: 1.2px solid #1e293b; table-layout: fixed; margin: 0 auto;">
                  <colgroup>
                    <col style="width: 14%;" />
                    <col style="width: 10%;" />
                    <col style="width: 12.66%;" />
                    <col style="width: 12.66%;" />
                    <col style="width: 12.66%;" />
                    <col style="width: 12.66%;" />
                    <col style="width: 12.66%;" />
                    <col style="width: 12.66%;" />
                  </colgroup>
                  <thead>
                    <tr style="background-color: #4338ca; color: #ffffff;">
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 14%;">Buổi</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 10%;">Tiết</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T2</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T3</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T4</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T5</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T6</th>
                      <th style="border: 1px solid #4338ca; padding: 3px; font-weight: bold; text-align: center; width: 12.66%;">T7</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${classTbodyHTML}
                  </tbody>
                </table>
              </div>
            `;

            pageEl.innerHTML += cardHTML;
          });

          await renderPageToPdf(pageEl, currentPage++, classLayoutMode === '4_per_page' ? 'portrait' : orientation);
        }
      }

      // ==============================================================
      // 3. TEMPLATE: THỜI KHÓA BIỂU GIÁO VIÊN (PHIẾU CẮT 8 GV / TRANG A4)
      // ==============================================================
      else if (template === 'by_teacher') {
        setExportProgressText('Đang tạo phiếu cắt TKB giáo viên (8 GV/trang)...');
        const tList = targetTeachersList;
        const chunkSize = 8;
        let currentPage = 1;

        for (let i = 0; i < tList.length; i += chunkSize) {
          const chunk = tList.slice(i, i + chunkSize);
          setExportProgressText(`Đang xử lý phiếu cắt trang ${currentPage}...`);

          const pageEl = document.createElement('div');
          pageEl.className = 'print-container';
          pageEl.style.width = '980px';
          pageEl.style.padding = '12px';
          pageEl.style.background = '#ffffff';
          pageEl.style.display = 'grid';
          pageEl.style.gridTemplateColumns = 'repeat(2, 1fr)';
          pageEl.style.gap = '10px';
          pageEl.style.boxSizing = 'border-box';

          chunk.forEach(teacher => {
            const tLessons = lessonsByTeacher.get(teacher.id);
            const total = tLessons ? tLessons.size : 0;

            let rowsHTML = '';
            for (let p = 1; p <= 5; p++) {
              const daysTD = [2, 3, 4, 5, 6, 7].map(d => {
                const l = tLessons?.get(`${d}_${p}`);
                return `
                  <td class="teacher-schedule-cell" style="border: 1px solid #cbd5e1; vertical-align: middle; text-align: center; height: 38px; padding: 0; box-sizing: border-box;">
                    <div class="class-name-badge" style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; margin: 0 auto; font-size: 10.5px; font-weight: 700; color: #0f172a; line-height: 1; text-align: center;">
                      ${l ? l.className : ''}
                    </div>
                  </td>
                `;
              }).join('');

              rowsHTML += `
                <tr style="height: 38px;">
                  <td style="border: 1px solid #475569; text-align: center; vertical-align: middle; font-weight: bold; background-color: #f8fafc; font-size: 8px;">S${p}</td>
                  ${daysTD}
                </tr>
              `;
            }

            if (sessionMode === 'double' && afternoonPeriodsCount > 0) {
              for (let p = 6; p <= 5 + afternoonPeriodsCount; p++) {
                const daysTD = [2, 3, 4, 5, 6, 7].map(d => {
                  const l = tLessons?.get(`${d}_${p}`);
                  return `
                    <td class="teacher-schedule-cell" style="border: 1px solid #cbd5e1; vertical-align: middle; text-align: center; height: 38px; padding: 0; box-sizing: border-box; background-color: #fffdfa;">
                      <div class="class-name-badge" style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; margin: 0 auto; font-size: 10.5px; font-weight: 700; color: #0f172a; line-height: 1; text-align: center;">
                        ${l ? l.className : ''}
                      </div>
                    </td>
                  `;
                }).join('');

                rowsHTML += `
                  <tr style="height: 38px;">
                    <td style="border: 1px solid #475569; text-align: center; vertical-align: middle; font-weight: bold; background-color: #fffdf5; font-size: 8px;">C${p - 5}</td>
                    ${daysTD}
                  </tr>
                `;
              }
            }

            const cardHTML = `
              <div style="border: 1px dashed #475569; border-radius: 6px; padding: 8px; background: #ffffff; box-sizing: border-box; width: 100%;">
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 4px;">
                  <div style="line-height: 1.15;">
                    <div style="font-size: 8px; color: #64748b; font-weight: 600;">${schoolName}</div>
                    <div style="font-size: 11px; font-weight: 900; color: #0f172a;">${teacher.name}</div>
                  </div>
                  <div style="text-align: right; line-height: 1.15;">
                    <div style="font-size: 8px; color: #64748b;">${teacher.specialization} | <b>${total} tiết</b></div>
                    <div style="font-size: 8px; color: #4338ca; font-weight: bold;">Áp dụng: ${applyDate}</div>
                  </div>
                </div>

                <table class="print-table" style="width: 100%; border-collapse: collapse; font-size: 8px; border: 1px solid #334155; table-layout: fixed; margin: 0 auto;">
                  <colgroup>
                    <col style="width: 24px;" />
                    <col style="width: 16%;" />
                    <col style="width: 16%;" />
                    <col style="width: 16%;" />
                    <col style="width: 16%;" />
                    <col style="width: 16%;" />
                    <col style="width: 16%;" />
                  </colgroup>
                  <thead>
                    <tr style="background-color: #0284c7; color: #ffffff;">
                      <th style="border: 1px solid #0284c7; padding: 2px; font-weight: bold;">Tiết</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T2</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T3</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T4</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T5</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T6</th>
                      <th style="border: 1px solid #0284c7; padding: 2px;">T7</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHTML}
                  </tbody>
                </table>
              </div>
            `;

            pageEl.innerHTML += cardHTML;
          });

          await renderPageToPdf(pageEl, currentPage++, 'portrait');
        }
      }

      // ==============================================================
      // 4. TEMPLATE: THỜI KHÓA BIỂU THEO TỔ BỘ MÔN (LƯỚI DÀN TRẢI 100% CHIỀU NGANG)
      // ==============================================================
      else if (template === 'by_subject') {
        setExportProgressText('Đang dựng ma trận phân tiết tổ bộ môn...');
        const pageEl = document.createElement('div');
        pageEl.className = 'print-container';
        pageEl.style.width = '1400px';
        pageEl.style.padding = '12px 14px';
        pageEl.style.background = '#ffffff';
        pageEl.style.boxSizing = 'border-box';

        const subTeachers = teachers.filter(t => t.specialization.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(t.specialization.toLowerCase()));
        const targetTList = subTeachers.length > 0 ? subTeachers : teachers;

        // Cột Giáo viên: ~13.5%, Cột Buổi: ~4.5%.
        // 6 ngày x 5 tiết = 30 cột. Mỗi cột = 82% / 30 = 2.733%.
        const days = [2, 3, 4, 5, 6, 7];

        let teacherRowsHTML = '';
        targetTList.forEach(t => {
          // Dòng 1: Buổi Sáng (T1 -> T5 sáng, p = 1..5)
          let morningCellsHTML = '';
          days.forEach(d => {
            for (let p = 1; p <= 5; p++) {
              const l = lessonsByTeacher.get(t.id)?.get(`${d}_${p}`);
              const isSubjectLesson = l && (l.subject.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(l.subject.toLowerCase()));
              const cellText = isSubjectLesson ? l.className : (l ? `(${l.className})` : '');

              morningCellsHTML += `
                <td class="subject-matrix-cell" style="width: 2.733%; border: 1px solid #94a3b8; text-align: center; vertical-align: middle; height: 27px; padding: 0; box-sizing: border-box;">
                  <div style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center;">
                    ${cellText ? `
                      <span style="font-size: 8.8px; font-weight: 700; color: ${isSubjectLesson ? '#0f172a' : '#64748b'}; line-height: 1; text-align: center;">
                        ${cellText}
                      </span>
                    ` : '<span style="color: #cbd5e1; font-size: 7.5px;">—</span>'}
                  </div>
                </td>
              `;
            }
          });

          // Dòng 2: Buổi Chiều (T1 -> T5 chiều, p = 6..10)
          let afternoonCellsHTML = '';
          days.forEach(d => {
            for (let colIdx = 1; colIdx <= 5; colIdx++) {
              const p = 5 + colIdx; // p = 6, 7, 8, 9, 10
              const l = lessonsByTeacher.get(t.id)?.get(`${d}_${p}`);
              const isSubjectLesson = l && (l.subject.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(l.subject.toLowerCase()));
              const cellText = isSubjectLesson ? l.className : (l ? `(${l.className})` : '');

              afternoonCellsHTML += `
                <td class="subject-matrix-cell" style="width: 2.733%; border: 1px solid #94a3b8; text-align: center; vertical-align: middle; height: 27px; padding: 0; box-sizing: border-box; background-color: #fffdfa;">
                  <div style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center;">
                    ${cellText ? `
                      <span style="font-size: 8.8px; font-weight: 700; color: ${isSubjectLesson ? '#0f172a' : '#64748b'}; line-height: 1; text-align: center;">
                        ${cellText}
                      </span>
                    ` : '<span style="color: #cbd5e1; font-size: 7.5px;">—</span>'}
                  </div>
                </td>
              `;
            }
          });

          teacherRowsHTML += `
            <tr style="height: 27px;">
              <td rowspan="2" style="width: 13.5%; vertical-align: middle; padding: 4px 6px; font-size: 9px; font-weight: bold; color: #0f172a; border: 1px solid #334155; background-color: #f8fafc; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${t.name}
              </td>
              <td style="width: 4.5%; vertical-align: middle; text-align: center; font-size: 8px; font-weight: 600; color: #475569; border: 1px solid #94a3b8; background-color: #f1f5f9; height: 27px;">
                Sáng
              </td>
              ${morningCellsHTML}
            </tr>
            <tr style="height: 27px;">
              <td style="width: 4.5%; vertical-align: middle; text-align: center; font-size: 8px; font-weight: 600; color: #b45309; border: 1px solid #94a3b8; background-color: #fffbeb; height: 27px;">
                Chiều
              </td>
              ${afternoonCellsHTML}
            </tr>
          `;
        });

        pageEl.innerHTML = `
          <div>
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #334155; padding-bottom: 5px; margin-bottom: 6px;">
              <div style="line-height: 1.25;">
                <div style="font-size: 9.5px; text-transform: uppercase; color: #64748b; font-weight: bold;">SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG</div>
                <div style="font-size: 12px; font-weight: 900; text-transform: uppercase; color: #0f172a;">${schoolName}</div>
              </div>
              <div style="text-align: right; line-height: 1.25;">
                <div style="font-size: 10px; font-weight: bold; color: #0f172a;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                <div style="font-size: 9px; font-style: italic; color: #64748b;">Độc lập - Tự do - Hạnh phúc</div>
              </div>
            </div>

            <div style="text-align: center; margin-bottom: 8px;">
              <h1 style="font-size: 15px; font-weight: 900; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: 0.5px;">
                THỜI KHÓA BIỂU THEO TỔ BỘ MÔN: ${selectedSubjectId.toUpperCase()}
              </h1>
              <h2 style="font-size: 11px; font-weight: bold; margin: 3px 0 0 0; color: #334155;">
                HỌC KỲ ${currentSemester.toUpperCase()} - NĂM HỌC ${currentAcademicYear.toUpperCase()}
              </h2>
              <p style="font-size: 9px; font-style: italic; margin: 2px 0 0 0; color: #64748b;">
                Áp dụng từ ngày: ${applyDate}
              </p>
            </div>

            <table class="print-table" style="width: 100%; border-collapse: collapse; font-size: 8.5px; border: 1.5px solid #0f172a; table-layout: fixed; margin: 0 auto;">
              <colgroup>
                <col style="width: 13.5%;" />
                <col style="width: 4.5%;" />
                ${Array.from({ length: 30 }).map(() => '<col style="width: 2.733%;" />').join('')}
              </colgroup>
              <thead>
                <tr style="background-color: #f1f5f9; color: #0f172a;">
                  <th rowspan="2" style="border: 1px solid #334155; padding: 4px; width: 13.5%; font-weight: bold; text-align: center; vertical-align: middle;">
                    GIÁO VIÊN
                  </th>
                  <th rowspan="2" style="border: 1px solid #334155; padding: 4px; width: 4.5%; font-weight: bold; text-align: center; vertical-align: middle;">
                    BUỔI
                  </th>
                  ${days.map(d => `
                    <th colspan="5" style="border: 1px solid #334155; padding: 4px; width: 13.666%; font-weight: bold; text-align: center; background-color: #e2e8f0;">
                      THỨ ${d}
                    </th>
                  `).join('')}
                </tr>
                <tr style="background-color: #f8fafc; color: #0f172a;">
                  ${days.flatMap(() => [1, 2, 3, 4, 5].map(p => `
                    <th style="border: 1px solid #334155; padding: 2px; width: 2.733%; font-size: 8px; font-weight: 600; text-align: center;">
                      T${p}
                    </th>
                  `)).join('')}
                </tr>
              </thead>
              <tbody>
                ${teacherRowsHTML}
              </tbody>
            </table>
          </div>
        `;

        await renderPageToPdf(pageEl, 1, 'landscape');
      }
      const fileName = getExportFileName('pdf');
      pdf.save(fileName);

      if (onNotification) onNotification(`Đã xuất tệp PDF (${fileName}) thành công!`);
      onClose();
    } catch (err) {
      console.error('Lỗi khi xuất PDF:', err);
      alert('Đã xảy ra lỗi khi tạo tệp PDF.');
    } finally {
      if (tempContainer.parentNode) {
        document.body.removeChild(tempContainer);
      }
      setIsExporting(false);
      setExportProgressText('');
    }
  };

  // -------------------------------------------------------------
  // 3. PRINT (IN ẤN TRỰC TIẾP)
  // -------------------------------------------------------------
  const handlePrint = () => {
    try {
      const isLandscape = orientation === 'landscape';
      const printStyle = document.createElement('style');
      printStyle.id = 'timetable-print-style';
      printStyle.innerHTML = `
        @page {
          size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'};
          margin: ${isLandscape ? '5mm 6mm' : '4mm 5mm'};
        }
        @media print {
          body * {
            visibility: hidden !important;
          }
          #timetable-printable-container,
          #timetable-printable-container *,
          .print-container,
          .print-container * {
            visibility: visible !important;
          }
          #timetable-printable-container,
          .print-container {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border: none !important;
            z-index: 999999 !important;
          }
          .page-break {
            page-break-after: always !important;
            break-after: page !important;
          }
          table.tkb-table,
          table.print-table {
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            margin: 0 auto !important;
          }
          td.schedule-cell {
            min-height: 42px !important;
            height: auto !important;
            overflow: visible !important;
            padding: 2px 1px !important;
            box-sizing: border-box !important;
            vertical-align: middle !important;
          }
          td.schedule-cell .cell-inner,
          td.schedule-cell > div {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 38px !important;
            overflow: visible !important;
          }
          td.schedule-cell .subject-name {
            font-size: 10.5px !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
            color: #0f172a !important;
            word-break: break-word !important;
            text-align: center !important;
          }
          td.teacher-schedule-cell {
            vertical-align: middle !important;
            text-align: center !important;
            height: 38px !important;
            padding: 0 !important;
            box-sizing: border-box !important;
          }
          td.subject-matrix-cell {
            height: 27px !important;
            padding: 0 !important;
            vertical-align: middle !important;
            text-align: center !important;
            box-sizing: border-box !important;
          }
          td.subject-matrix-cell > div {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 100% !important;
            width: 100% !important;
            margin: 0 auto !important;
            text-align: center !important;
          }
          td.subject-matrix-cell span {
            font-size: 8.8px !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            line-height: 1 !important;
            text-align: center !important;
          }
          td.teacher-schedule-cell .class-name-badge,
          td.teacher-schedule-cell > div {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 100% !important;
            width: 100% !important;
            margin: 0 auto !important;
            font-size: 10.5px !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            line-height: 1 !important;
            text-align: center !important;
          }
        }
      `;
      document.head.appendChild(printStyle);

      setTimeout(() => {
        window.print();
        setTimeout(() => {
          const s = document.getElementById('timetable-print-style');
          if (s) s.remove();
        }, 1000);
      }, 100);
    } catch (err) {
      console.error(err);
      window.print();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[680px] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
        }}
      >
        {/* MODAL HEADER */}
        <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[1.15rem] font-bold text-slate-900 leading-tight">
                Xuất dữ liệu & In Thời khóa biểu
              </h2>
              <p className="text-[0.75rem] text-slate-500 mt-0.5">
                Tùy chọn mẫu báo cáo, bộ lọc phạm vi và định dạng trang in ấn
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            title="Đóng cửa sổ (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY (SCROLLABLE) */}
        <div className="p-5 overflow-y-auto space-y-4.5 text-xs text-slate-700 flex-1">
          {/* PHẦN 1: CHỌN MẪU XUẤT (4 Thẻ Radio Card hiện đại - Grid 2x2) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[0.82rem] font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[9px] font-bold">1</span>
                <span>Chọn mẫu xuất & in ấn</span>
              </label>
              <span className="text-[0.72rem] text-slate-400">4 mẫu định dạng chuẩn</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* [1] TKB Toàn trường */}
              <div
                onClick={() => handleTemplateChange('school_master')}
                className={`p-3 rounded-xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                  template === 'school_master'
                    ? 'border-2 border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${template === 'school_master' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <School className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-[0.84rem] text-slate-900 leading-snug">
                        TKB Toàn trường
                      </div>
                      <div className="text-[0.72rem] text-slate-500 font-medium">
                        Tổng hợp theo Lớp - Khổ A4 Ngang
                      </div>
                    </div>
                  </div>
                  {template === 'school_master' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  )}
                </div>
                <p className="text-[0.7rem] text-slate-500 mt-2 line-clamp-1">
                  Ma trận toàn trường đầy đủ các lớp và buổi học
                </p>
              </div>

              {/* [2] TKB Theo Lớp */}
              <div
                onClick={() => handleTemplateChange('by_class')}
                className={`p-3 rounded-xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                  template === 'by_class'
                    ? 'border-2 border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${template === 'by_class' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <GraduationCap className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-[0.84rem] text-slate-900 leading-snug">
                        TKB Theo Lớp
                      </div>
                      <div className="text-[0.72rem] text-slate-500 font-medium">
                        Mẫu phát HS: 4 lớp / trang A4
                      </div>
                    </div>
                  </div>
                  {template === 'by_class' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  )}
                </div>
                <p className="text-[0.7rem] text-slate-500 mt-2 line-clamp-1">
                  Thẻ TKB riêng từng lớp có GVCN, tiện cắt phát
                </p>
              </div>

              {/* [3] TKB Giáo viên */}
              <div
                onClick={() => handleTemplateChange('by_teacher')}
                className={`p-3 rounded-xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                  template === 'by_teacher'
                    ? 'border-2 border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${template === 'by_teacher' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <Users className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-[0.84rem] text-slate-900 leading-snug">
                        TKB Giáo viên
                      </div>
                      <div className="text-[0.72rem] text-slate-500 font-medium">
                        Mẫu phiếu cắt 8 GV / trang A4
                      </div>
                    </div>
                  </div>
                  {template === 'by_teacher' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  )}
                </div>
                <p className="text-[0.7rem] text-slate-500 mt-2 line-clamp-1">
                  Phiếu lịch dạy cá nhân GV phục vụ công tác giảng dạy
                </p>
              </div>

              {/* [4] TKB Theo Tổ Bộ môn */}
              <div
                onClick={() => handleTemplateChange('by_subject')}
                className={`p-3 rounded-xl cursor-pointer transition-all border relative flex flex-col justify-between ${
                  template === 'by_subject'
                    ? 'border-2 border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${template === 'by_subject' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <BookOpen className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-[0.84rem] text-slate-900 leading-snug">
                        TKB Theo Tổ Bộ môn
                      </div>
                      <div className="text-[0.72rem] text-slate-500 font-medium">
                        Lưới phân tiết theo môn
                      </div>
                    </div>
                  </div>
                  {template === 'by_subject' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  )}
                </div>
                <p className="text-[0.7rem] text-slate-500 mt-2 line-clamp-1">
                  Lưới phân tiết chi tiết theo bộ môn chuyên môn
                </p>
              </div>
            </div>
          </div>

          {/* SECTION 2: BỘ LỌC PHẠM VI XUẤT DỮ LIỆU */}
          <div className="p-5 border-b border-slate-200/80 bg-slate-50/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">
                  2
                </span>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                  Bộ lọc phạm vi xuất dữ liệu
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {template === 'school_master' && `${classes.length} lớp học`}
                {template === 'by_class' && `${selectedClassIds.size} / ${classes.length} lớp được chọn`}
                {template === 'by_teacher' && `${selectedTeacherIds.size} / ${teachers.length} giáo viên`}
                {template === 'by_subject' && `Môn ${selectedSubjectId}`}
              </span>
            </div>

            {/* Filter cho school_master */}
            {template === 'school_master' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Khối lớp:
                  </label>
                  <select
                    value={masterGradeFilter}
                    onChange={(e) => setMasterGradeFilter(e.target.value as any)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="all">Tất cả khối (Toàn trường)</option>
                    <option value="10">Chỉ Khối 10</option>
                    <option value="11">Chỉ Khối 11</option>
                    <option value="12">Chỉ Khối 12</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Buổi học:
                  </label>
                  <select
                    value={masterSessionFilter}
                    onChange={(e) => setMasterSessionFilter(e.target.value as any)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="all">Cả ngày (Sáng & Chiều)</option>
                    <option value="morning">Chỉ buổi Sáng</option>
                    <option value="afternoon">Chỉ buổi Chiều</option>
                  </select>
                </div>
              </div>
            )}

            {/* Filter cho by_class */}
            {template === 'by_class' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600 font-medium">Lọc khối:</span>
                    {(['all', '10', '11', '12'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleQuickSelectClasses(g)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                          classGradeFilter === g
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {g === 'all' ? 'Tất cả' : `Khối ${g}`}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      className="text-indigo-600 hover:underline font-semibold"
                    >
                      Chọn tất cả
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearAllClasses}
                      className="text-slate-500 hover:underline"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="max-h-32 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200 grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {classes.map((cls) => {
                    const isSelected = selectedClassIds.has(cls.id);
                    return (
                      <label
                        key={cls.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer select-none transition ${
                          isSelected
                            ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleClassSelect(cls.id)}
                          className="w-3 h-3 text-indigo-600 rounded"
                        />
                        <span>{cls.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filter cho by_teacher */}
            {template === 'by_teacher' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={teacherDeptFilter}
                      onChange={(e) => setTeacherDeptFilter(e.target.value)}
                      className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
                    >
                      <option value="all">Tất cả tổ chuyên môn</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>
                          Tổ {d}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Tìm tên giáo viên..."
                      value={teacherSearchTerm}
                      onChange={(e) => setTeacherSearchTerm(e.target.value)}
                      className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 w-36"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedTeacherIds(new Set(teachers.map(t => t.id)))}
                      className="text-indigo-600 hover:underline font-semibold"
                    >
                      Chọn tất cả
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedTeacherIds(new Set())}
                      className="text-slate-500 hover:underline"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="max-h-32 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {teachers
                    .filter((t) => {
                      if (teacherDeptFilter !== 'all' && t.specialization !== teacherDeptFilter) return false;
                      if (teacherSearchTerm && !t.name.toLowerCase().includes(teacherSearchTerm.toLowerCase())) return false;
                      return true;
                    })
                    .map((t) => {
                      const isSelected = selectedTeacherIds.has(t.id);
                      return (
                        <label
                          key={t.id}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer select-none truncate transition ${
                            isSelected
                              ? 'bg-indigo-50 text-indigo-700 font-bold border border-indigo-200'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedTeacherIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.id)) next.delete(t.id);
                                else next.add(t.id);
                                return next;
                              });
                            }}
                            className="w-3 h-3 text-indigo-600 rounded shrink-0"
                          />
                          <span className="truncate">{t.name}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Filter cho by_subject */}
            {template === 'by_subject' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Chọn môn học chuyên môn:
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {subjectsConfig.map((s) => (
                    <option key={s.id} value={s.id}>
                      Môn {s.name || s.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* SECTION 3: THIẾT LẬP BỔ SUNG & TRANG IN */}
          <div className="p-5 border-b border-slate-200/80 bg-white">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">
                3
              </span>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                Thiết lập bổ sung & Trang in
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ngày áp dụng TKB:
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={applyDate}
                    onChange={(e) => setApplyDate(e.target.value)}
                    placeholder="dd/mm/yyyy"
                    className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Định dạng trang in (Khổ A4):
                </label>
                <div className="flex items-center gap-4 h-9">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="orientation"
                      checked={orientation === 'landscape'}
                      onChange={() => setOrientation('landscape')}
                      className="text-indigo-600"
                    />
                    <span>A4 Khổ Ngang</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="orientation"
                      checked={orientation === 'portrait'}
                      onChange={() => setOrientation('portrait')}
                      className="text-indigo-600"
                    />
                    <span>A4 Khổ Đứng</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* MODAL FOOTER */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="h-8 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            >
              Hủy
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExporting}
                className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Xuất Excel</span>
              </button>

              <button
                type="button"
                onClick={handleExportPDF}
                disabled={isExporting}
                className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang xuất...</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3.5 h-3.5" />
                    <span>Xuất PDF</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handlePrint}
                disabled={isExporting}
                className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
                title="Mở hộp thoại in ấn trực tiếp từ trình duyệt"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>In ấn ngay</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KHUNG TÀI LIỆU IN ẤN ẨN TRÊN MÀN HÌNH - CHỈ KÍCH HOẠT KHI IN (PRINT CONTAINER) */}
      <div id="timetable-printable-container" className="hidden print:block print-container w-full">
        {template === 'school_master' && (
          <div className="w-full">
            {(masterGradeFilter === 'all' ? ['10', '11', '12'] : [masterGradeFilter]).map((grade, gIdx, gArr) => {
              const gradeClasses = classes.filter(c => c.grade === grade);
              if (gradeClasses.length === 0) return null;
              const isLastPage = gIdx === gArr.length - 1;
              const classColWidth = `${(88 / gradeClasses.length).toFixed(3)}%`;

              return (
                <div key={grade} className={`p-4 bg-white text-slate-900 print-container w-full ${!isLastPage ? 'page-break' : ''}`}>
                  {/* Tiêu đề Quốc hiệu & Trường học */}
                  <div className="flex justify-between border-b-2 border-slate-700 pb-1.5 mb-2 text-xs">
                    <div className="leading-tight">
                      <div className="text-[10px] uppercase font-bold text-slate-600">SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG</div>
                      <div className="text-[12px] uppercase font-black text-slate-900">{schoolName}</div>
                    </div>
                    <div className="text-right leading-tight">
                      <div className="text-[11px] font-bold text-slate-900">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                      <div className="text-[9.5px] italic text-slate-600">Độc lập - Tự do - Hạnh phúc</div>
                    </div>
                  </div>

                  {/* Tiêu đề Thời khóa biểu */}
                  <div className="text-center mb-2.5">
                    <h1 className="text-base font-black uppercase text-slate-900 tracking-wide">
                      THỜI KHÓA BIỂU TOÀN TRƯỜNG - KHỐI {grade} ({gradeClasses.length} LỚP)
                    </h1>
                    <h2 className="text-xs font-bold text-slate-700 mt-0.5">
                      HỌC KỲ {currentSemester.toUpperCase()} - NĂM HỌC {currentAcademicYear.toUpperCase()}
                    </h2>
                    <p className="text-[10px] italic text-slate-500 mt-0.5">
                      Áp dụng từ ngày: {applyDate}
                    </p>
                  </div>

                  {/* Bảng Thời khóa biểu Khối */}
                  <table className="tkb-table print-table w-full border-collapse border border-slate-900 text-[8.5px] table-fixed">
                    <colgroup>
                      <col style={{ width: '4.5%' }} />
                      <col style={{ width: '4.5%' }} />
                      <col style={{ width: '3%' }} />
                      {gradeClasses.map(c => (
                        <col key={c.id} style={{ width: classColWidth }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 text-slate-900 font-bold">
                        <th className="border border-slate-700 py-1 px-0.5 text-center" style={{ width: '4.5%' }}>Thứ</th>
                        <th className="border border-slate-700 py-1 px-0.5 text-center" style={{ width: '4.5%' }}>Buổi</th>
                        <th className="border border-slate-700 py-1 px-0.5 text-center" style={{ width: '3%' }}>Tiết</th>
                        {gradeClasses.map(c => (
                          <th key={c.id} className="border border-slate-700 py-1 px-0.5 text-center bg-slate-100 font-bold" style={{ width: classColWidth }}>
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[2, 3, 4, 5, 6, 7].map(dayNum => {
                        const morningPeriods = (masterSessionFilter === 'all' || masterSessionFilter === 'morning') ? [1, 2, 3, 4, 5] : [];
                        const afternoonPeriods = (sessionMode === 'double' && (masterSessionFilter === 'all' || masterSessionFilter === 'afternoon'))
                          ? Array.from({ length: afternoonPeriodsCount }, (_, i) => 6 + i)
                          : [];
                        const totalForDay = morningPeriods.length + afternoonPeriods.length;

                        return (
                          <React.Fragment key={dayNum}>
                            {morningPeriods.map((p, pIdx) => (
                              <tr key={`m_${dayNum}_${p}`} className="h-auto">
                                {pIdx === 0 && (
                                  <td rowSpan={totalForDay} className="border border-slate-900 font-bold text-center align-middle bg-slate-50 text-[9.5px]" style={{ width: '4.5%' }}>
                                    Thứ {dayNum}
                                  </td>
                                )}
                                {pIdx === 0 && (
                                  <td rowSpan={morningPeriods.length} className="border border-slate-900 font-bold text-center align-middle bg-slate-50 text-[9px]" style={{ width: '4.5%' }}>
                                    Sáng
                                  </td>
                                )}
                                <td className="border border-slate-900 text-center align-middle font-semibold bg-slate-50/50 text-[8.5px]" style={{ width: '3%' }}>
                                  S{p}
                                </td>
                                {gradeClasses.map(cls => {
                                  const l = lessonsByClass.get(cls.id)?.get(`${dayNum}_${p}`);
                                  return (
                                    <td key={cls.id} className="schedule-cell border border-slate-300 text-center align-middle min-h-[42px] h-auto p-[2px_1px] box-border overflow-visible" style={{ width: classColWidth }}>
                                      <div className="cell-inner flex items-center justify-center text-center w-full h-full min-h-[38px] overflow-visible">
                                        {l ? (
                                          <div className="subject-name text-[10.5px] font-bold leading-[1.2] text-slate-900 break-words text-center">
                                            {formatShortSubject(l.subject)}
                                          </div>
                                        ) : (
                                          <span className="text-slate-300 text-[8px]">—</span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}

                            {afternoonPeriods.map((p, pIdx) => (
                              <tr key={`a_${dayNum}_${p}`} className="h-auto">
                                {morningPeriods.length === 0 && pIdx === 0 && (
                                  <td rowSpan={totalForDay} className="border border-slate-900 font-bold text-center align-middle bg-slate-50 text-[9.5px]" style={{ width: '4.5%' }}>
                                    Thứ {dayNum}
                                  </td>
                                )}
                                {pIdx === 0 && (
                                  <td rowSpan={afternoonPeriods.length} className="border border-slate-900 font-bold text-center align-middle bg-amber-50 text-amber-800 text-[9px]" style={{ width: '4.5%' }}>
                                    Chiều
                                  </td>
                                )}
                                <td className="border border-slate-900 text-center align-middle font-semibold bg-amber-50/40 text-[8.5px]" style={{ width: '3%' }}>
                                  C{p - 5}
                                </td>
                                {gradeClasses.map(cls => {
                                  const l = lessonsByClass.get(cls.id)?.get(`${dayNum}_${p}`);
                                  return (
                                    <td key={cls.id} className="schedule-cell border border-slate-300 text-center align-middle min-h-[42px] h-auto p-[2px_1px] box-border overflow-visible bg-amber-50/20" style={{ width: classColWidth }}>
                                      <div className="cell-inner flex items-center justify-center text-center w-full h-full min-h-[38px] overflow-visible">
                                        {l ? (
                                          <div className="subject-name text-[10.5px] font-bold leading-[1.2] text-slate-900 break-words text-center">
                                            {formatShortSubject(l.subject)}
                                          </div>
                                        ) : (
                                          <span className="text-slate-300 text-[8px]">—</span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {template === 'by_class' && (
          <div className="p-4 bg-white text-slate-900 print-container w-full">
            {Array.from({ length: Math.ceil(targetClassesList.length / 4) }, (_, pageIndex) => {
              const chunk = targetClassesList.slice(pageIndex * 4, pageIndex * 4 + 4);
              const isLastPage = (pageIndex + 1) * 4 >= targetClassesList.length;

              return (
                <div key={pageIndex} className={`w-full ${!isLastPage ? 'page-break' : ''} mb-6`}>
                  <div className="grid grid-cols-2 gap-3 w-full">
                    {chunk.map(cls => {
                      const hrId = assignments.homeroomAssignments[cls.id];
                      const hrName = hrId ? (teacherMap.get(hrId)?.name || '') : 'Chưa phân công';

                      return (
                        <div key={cls.id} className="border border-slate-800 rounded-lg p-2.5 bg-white box-border w-full">
                          <div className="flex justify-between items-center border-b border-slate-300 pb-1 mb-1.5">
                            <div className="text-[13px] font-black text-slate-900">Lớp: {cls.name}</div>
                            <div className="text-[10px] font-bold text-slate-700">GVCN: {hrName}</div>
                          </div>

                          <table className="tkb-table print-table w-full border-collapse border border-slate-700 text-[8.5px] table-fixed">
                            <colgroup>
                              <col style={{ width: '14%' }} />
                              <col style={{ width: '10%' }} />
                              <col style={{ width: '12.66%' }} />
                              <col style={{ width: '12.66%' }} />
                              <col style={{ width: '12.66%' }} />
                              <col style={{ width: '12.66%' }} />
                              <col style={{ width: '12.66%' }} />
                              <col style={{ width: '12.66%' }} />
                            </colgroup>
                            <thead>
                              <tr className="bg-indigo-700 text-white font-bold">
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '14%' }}>Buổi</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '10%' }}>Tiết</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T2</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T3</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T4</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T5</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T6</th>
                                <th className="border border-indigo-700 py-1 text-center" style={{ width: '12.66%' }}>T7</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[1, 2, 3, 4, 5].map((p, pIdx) => (
                                <tr key={`m_${p}`} className="h-auto">
                                  {pIdx === 0 && (
                                    <td rowSpan={5} className="border border-slate-700 text-center align-middle font-bold bg-slate-50 text-[9px]" style={{ width: '14%' }}>
                                      SÁNG
                                    </td>
                                  )}
                                  <td className="border border-slate-700 text-center align-middle font-semibold bg-slate-50 text-[8.5px]" style={{ width: '10%' }}>
                                    S{p}
                                  </td>
                                  {[2, 3, 4, 5, 6, 7].map(d => {
                                    const l = lessonsByClass.get(cls.id)?.get(`${d}_${p}`);
                                    return (
                                      <td key={d} className="schedule-cell border border-slate-300 text-center align-middle min-h-[38px] h-auto p-[2px_1px] box-border overflow-visible" style={{ width: '12.66%' }}>
                                        <div className="cell-inner flex flex-col justify-center items-center text-center w-full min-h-[32px] overflow-visible">
                                          {l ? (
                                            <div className="subject-name text-[9.8px] font-semibold leading-[1.2] text-slate-900 break-words text-center">
                                              {formatShortSubject(l.subject)}
                                            </div>
                                          ) : (
                                            <span className="text-slate-300 text-[8px]">—</span>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}

                              {sessionMode === 'double' && afternoonPeriodsCount > 0 && Array.from({ length: afternoonPeriodsCount }, (_, i) => 6 + i).map((p, pIdx) => (
                                <tr key={`a_${p}`} className="h-auto">
                                  {pIdx === 0 && (
                                    <td rowSpan={afternoonPeriodsCount} className="border border-slate-700 text-center align-middle font-bold bg-amber-50 text-amber-800 text-[9px]" style={{ width: '14%' }}>
                                      CHIỀU
                                    </td>
                                  )}
                                  <td className="border border-slate-700 text-center align-middle font-semibold bg-amber-50 text-[8.5px]" style={{ width: '10%' }}>
                                    C{p - 5}
                                  </td>
                                  {[2, 3, 4, 5, 6, 7].map(d => {
                                    const l = lessonsByClass.get(cls.id)?.get(`${d}_${p}`);
                                    return (
                                      <td key={d} className="schedule-cell border border-slate-300 text-center align-middle min-h-[38px] h-auto p-[2px_1px] box-border overflow-visible bg-amber-50/20" style={{ width: '12.66%' }}>
                                        <div className="cell-inner flex flex-col justify-center items-center text-center w-full min-h-[32px] overflow-visible">
                                          {l ? (
                                            <div className="subject-name text-[9.8px] font-semibold leading-[1.2] text-slate-900 break-words text-center">
                                              {formatShortSubject(l.subject)}
                                            </div>
                                          ) : (
                                            <span className="text-slate-300 text-[8px]">—</span>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {template === 'by_teacher' && (
          <div className="p-4 bg-white text-slate-900 print-container w-full grid grid-cols-2 gap-3">
            {targetTeachersList.map((teacher, tIdx) => {
              const tLessons = lessonsByTeacher.get(teacher.id);
              const total = tLessons ? tLessons.size : 0;
              const isPageBreak = (tIdx + 1) % 8 === 0;

              return (
                <div key={teacher.id} className={`border border-dashed border-slate-700 rounded p-2 bg-white ${isPageBreak ? 'page-break' : ''}`}>
                  <div className="flex justify-between items-center border-b border-slate-300 pb-1 mb-1">
                    <div>
                      <div className="text-[8px] text-slate-500 font-semibold">{schoolName}</div>
                      <div className="text-[11px] font-bold text-slate-900">{teacher.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[8px] text-slate-500">{teacher.specialization} | {total} tiết</div>
                      <div className="text-[8px] font-semibold text-indigo-700">Áp dụng: {applyDate}</div>
                    </div>
                  </div>

                  <table className="tkb-table print-table w-full border-collapse border border-slate-700 text-[8px] table-fixed">
                    <thead>
                      <tr className="bg-sky-700 text-white font-bold">
                        <th className="border border-sky-700 py-0.5 text-center w-[22px]">Tiết</th>
                        <th className="border border-sky-700 py-0.5 text-center">T2</th>
                        <th className="border border-sky-700 py-0.5 text-center">T3</th>
                        <th className="border border-sky-700 py-0.5 text-center">T4</th>
                        <th className="border border-sky-700 py-0.5 text-center">T5</th>
                        <th className="border border-sky-700 py-0.5 text-center">T6</th>
                        <th className="border border-sky-700 py-0.5 text-center">T7</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5].map(p => (
                        <tr key={`m_${p}`} className="h-[38px]">
                          <td className="border border-slate-700 text-center font-bold bg-slate-50 text-[8px] align-middle">S{p}</td>
                          {[2, 3, 4, 5, 6, 7].map(d => {
                            const l = tLessons?.get(`${d}_${p}`);
                            return (
                              <td key={d} className="teacher-schedule-cell border border-slate-300 text-center align-middle h-[38px] p-0 box-border">
                                <div className="class-name-badge flex items-center justify-center h-full w-full m-auto text-[10.5px] font-bold text-slate-900 leading-none text-center">
                                  {l ? l.className : ''}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      {sessionMode === 'double' && Array.from({ length: afternoonPeriodsCount }, (_, i) => 6 + i).map(p => (
                        <tr key={`a_${p}`} className="h-[38px]">
                          <td className="border border-slate-700 text-center font-bold bg-amber-50 text-[8px] align-middle">C{p - 5}</td>
                          {[2, 3, 4, 5, 6, 7].map(d => {
                            const l = tLessons?.get(`${d}_${p}`);
                            return (
                              <td key={d} className="teacher-schedule-cell border border-slate-300 text-center align-middle h-[38px] p-0 box-border bg-amber-50/20">
                                <div className="class-name-badge flex items-center justify-center h-full w-full m-auto text-[10.5px] font-bold text-slate-900 leading-none text-center">
                                  {l ? l.className : ''}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {template === 'by_subject' && (
          <div className="p-4 bg-white text-slate-900 print-container w-full">
            <div className="text-center mb-3">
              <h1 className="text-sm font-bold uppercase text-slate-900">
                THỜI KHÓA BIỂU THEO TỔ BỘ MÔN: {selectedSubjectId.toUpperCase()}
              </h1>
              <p className="text-[9px] italic text-slate-500">
                {schoolName} | Học kỳ {currentSemester} | Áp dụng từ ngày: {applyDate}
              </p>
            </div>

            {(() => {
              const subTeachers = teachers.filter(t => t.specialization.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(t.specialization.toLowerCase()));
              const targetTList = subTeachers.length > 0 ? subTeachers : teachers;
              const days = [2, 3, 4, 5, 6, 7];

              return (
                <table className="tkb-table print-table w-full border-collapse border border-slate-900 text-[8.5px] table-fixed">
                  <colgroup>
                    <col style={{ width: '13.5%' }} />
                    <col style={{ width: '4.5%' }} />
                    {Array.from({ length: 30 }).map((_, i) => (
                      <col key={i} style={{ width: '2.733%' }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-100 text-slate-900 font-bold">
                      <th rowSpan={2} className="border border-slate-700 py-1 px-1.5 text-center align-middle font-bold" style={{ width: '13.5%' }}>
                        GIÁO VIÊN
                      </th>
                      <th rowSpan={2} className="border border-slate-700 py-1 px-1 text-center align-middle font-bold" style={{ width: '4.5%' }}>
                        BUỔI
                      </th>
                      {days.map(d => (
                        <th key={d} colSpan={5} className="border border-slate-700 py-1 text-center font-bold bg-slate-200" style={{ width: '13.666%' }}>
                          THỨ {d}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50 text-slate-900">
                      {days.flatMap(d => [1, 2, 3, 4, 5].map(p => (
                        <th key={`${d}_${p}`} className="border border-slate-700 py-0.5 text-center text-[8px] font-semibold" style={{ width: '2.733%' }}>
                          T{p}
                        </th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {targetTList.map(t => (
                      <React.Fragment key={t.id}>
                        {/* Dòng 1: Buổi Sáng (T1 -> T5 sáng, p = 1..5) */}
                        <tr className="h-[27px]">
                          <td rowSpan={2} className="border border-slate-700 py-1 px-1.5 font-bold text-[9px] text-slate-900 bg-slate-50 text-left align-middle truncate" style={{ width: '13.5%' }}>
                            {t.name}
                          </td>
                          <td className="border border-slate-700 py-1 px-0.5 text-center align-middle text-[8px] font-semibold text-slate-600 bg-slate-100" style={{ width: '4.5%' }}>
                            Sáng
                          </td>
                          {days.flatMap(d => [1, 2, 3, 4, 5].map(p => {
                            const l = lessonsByTeacher.get(t.id)?.get(`${d}_${p}`);
                            const isSubjectLesson = l && (l.subject.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(l.subject.toLowerCase()));
                            const cellText = isSubjectLesson ? l.className : (l ? `(${l.className})` : '');

                            return (
                              <td key={`m_${d}_${p}`} className="subject-matrix-cell border border-slate-300 text-center align-middle h-[27px] p-0 box-border overflow-visible" style={{ width: '2.733%' }}>
                                <div className="flex items-center justify-center text-center w-full h-full">
                                  {cellText ? (
                                    <span className={`text-[8.8px] font-bold text-center leading-none ${isSubjectLesson ? 'text-slate-900' : 'text-slate-500'}`}>
                                      {cellText}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 text-[7.5px]">—</span>
                                  )}
                                </div>
                              </td>
                            );
                          }))}
                        </tr>

                        {/* Dòng 2: Buổi Chiều (T1 -> T5 chiều, p = 6..10) */}
                        <tr className="h-[27px]">
                          <td className="border border-slate-700 py-1 px-0.5 text-center align-middle text-[8px] font-semibold text-amber-800 bg-amber-50" style={{ width: '4.5%' }}>
                            Chiều
                          </td>
                          {days.flatMap(d => [1, 2, 3, 4, 5].map(colIdx => {
                            const p = 5 + colIdx; // p = 6, 7, 8, 9, 10
                            const l = lessonsByTeacher.get(t.id)?.get(`${d}_${p}`);
                            const isSubjectLesson = l && (l.subject.toLowerCase().includes(selectedSubjectId.toLowerCase()) || selectedSubjectId.toLowerCase().includes(l.subject.toLowerCase()));
                            const cellText = isSubjectLesson ? l.className : (l ? `(${l.className})` : '');

                            return (
                              <td key={`a_${d}_${colIdx}`} className="subject-matrix-cell border border-slate-300 text-center align-middle h-[27px] p-0 box-border overflow-visible bg-amber-50/20" style={{ width: '2.733%' }}>
                                <div className="flex items-center justify-center text-center w-full h-full">
                                  {cellText ? (
                                    <span className={`text-[8.8px] font-bold text-center leading-none ${isSubjectLesson ? 'text-slate-900' : 'text-slate-500'}`}>
                                      {cellText}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 text-[7.5px]">—</span>
                                  )}
                                </div>
                              </td>
                            );
                          }))}
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
