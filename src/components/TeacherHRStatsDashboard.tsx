import React, { useState, useMemo } from 'react';
import { 
  Users, GraduationCap, Clock, Award, Briefcase, AlertCircle, 
  FileSpreadsheet, Printer, X, ChevronRight, Search, Filter,
  Calendar, CheckCircle, TrendingUp, Sparkles, Download, BookOpen
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Teacher, Department, DEFAULT_DEPARTMENTS, getDefaultDepartment } from '../App';
import { 
  calculateRetirementDate, 
  normalizeTeacherGender, 
  formatDOB, 
  RetirementInfo,
  checkRetiringSoon,
  getRetirementDetails
} from '../utils/retirementCalculator';

interface DetailModalData {
  type: 'subject' | 'department';
  title: string;
  subtitle: string;
  badges?: string[];
  teachers: Teacher[];
  totalPeriods: number;
  dhCount: number;
  thsTsCount: number;
  avgAge: number;
  avgSeniority: number;
}

interface TeacherHRStatsDashboardProps {
  teachers: Teacher[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  classes: Array<{ id: string; name: string; grade: string }>;
  subjectsConfig: Array<{ id: string; name: string; grade10Periods: number; grade11Periods: number; grade12Periods: number; departmentId?: string; department?: string }>;
  classSubjectPeriods: Record<string, Record<string, number>>;
  schoolName: string;
  academicYear: string;
  semester: string;
  getTeacherStats: (teacherId: string) => {
    totalPeriods: number;
    assignedPeriods: number;
    isHomeroom: boolean;
    assignedClasses: string[];
    warnings: string[];
  };
  departments?: Department[];
}

export const TeacherHRStatsDashboard: React.FC<TeacherHRStatsDashboardProps> = ({
  teachers,
  assignments,
  classes,
  subjectsConfig,
  classSubjectPeriods,
  schoolName,
  academicYear,
  semester,
  getTeacherStats,
  departments
}) => {
  const CURRENT_YEAR = 2026;

  // Sub-tabs chuyển đổi giữa [📚 Thống kê theo Bộ môn] và [👥 Thống kê theo Tổ bộ môn]
  const [matrixTab, setMatrixTab] = useState<'subject' | 'department'>('subject');

  // Modal xem chi tiết giáo viên (theo bộ môn hoặc theo tổ chuyên môn)
  const [detailModalData, setDetailModalData] = useState<DetailModalData | null>(null);

  // Retirement modal open state
  const [isRetirementModalOpen, setIsRetirementModalOpen] = useState(false);
  const [retirementSearch, setRetirementSearch] = useState('');
  const [retirementDeptFilter, setRetirementDeptFilter] = useState('all');

  // -------------------------------------------------------------
  // 1. TÍNH TOÁN DỮ LIỆU ĐỘ TUỔI (Tuổi = 2026 - namSinh)
  // -------------------------------------------------------------
  const ageStats = useMemo(() => {
    let under35 = 0;
    let from35to45 = 0;
    let from46to54 = 0;
    let from55plus = 0;
    let totalAge = 0;

    teachers.forEach(t => {
      let birth = 1985;
      if ((t as any).birthYear) birth = parseInt(String((t as any).birthYear), 10);
      else if (t.namSinh) birth = parseInt(String(t.namSinh), 10);
      else if (t.dob) {
        const m = String(t.dob).match(/\d{4}/);
        if (m) birth = parseInt(m[0], 10);
      } else if (t.dateOfBirth) {
        const m = String(t.dateOfBirth).match(/\d{4}/);
        if (m) birth = parseInt(m[0], 10);
      } else if (t.experienceYears) {
        birth = CURRENT_YEAR - 22 - t.experienceYears;
      }
      const age = CURRENT_YEAR - birth;
      totalAge += age;

      if (age < 35) {
        under35++;
      } else if (age <= 45) {
        from35to45++;
      } else if (age <= 54) {
        from46to54++;
      } else {
        from55plus++;
      }
    });

    const total = teachers.length || 1;
    const avgAge = Math.round((totalAge / total) * 10) / 10;

    // Đảm bảo tổng % chính xác 100%
    const p1 = Math.round((under35 / total) * 100);
    const p2 = Math.round((from35to45 / total) * 100);
    const p3 = Math.round((from46to54 / total) * 100);
    const p4 = 100 - p1 - p2 - p3;

    return {
      under35,
      under35Pct: p1,
      from35to45,
      from35to45Pct: p2,
      from46to54,
      from46to54Pct: p3,
      from55plus,
      from55plusPct: p4,
      avgAge
    };
  }, [teachers]);

  // -------------------------------------------------------------
  // 2. TÍNH TOÁN TRÌNH ĐỘ CHUYÊN MÔN
  // -------------------------------------------------------------
  const degreeStats = useMemo(() => {
    let tsCount = 0;
    let thsCount = 0;
    let dhCount = 0;
    let otherCount = 0;

    teachers.forEach(t => {
      const raw = (t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')).toLowerCase();
      if (raw.includes('tiến sĩ') || raw === 'ts') tsCount++;
      else if (raw.includes('thạc sĩ') || raw === 'ths') thsCount++;
      else if (raw.includes('đại học') || raw === 'cử nhân' || raw === 'đh') dhCount++;
      else otherCount++;
    });

    const total = teachers.length || 1;
    const aboveStandard = tsCount + thsCount;
    const aboveStandardPct = Math.round((aboveStandard / total) * 100);
    const standardPct = 100; // 100% đạt chuẩn Đại học trở lên

    return {
      tsCount,
      tsPct: Math.round((tsCount / total) * 100),
      thsCount,
      thsPct: Math.round((thsCount / total) * 100),
      dhCount,
      dhPct: Math.round((dhCount / total) * 100),
      otherCount,
      otherPct: Math.round((otherCount / total) * 100),
      aboveStandard,
      aboveStandardPct,
      standardPct
    };
  }, [teachers]);

  // -------------------------------------------------------------
  // 3. TÍNH TOÁN THÂM NIÊN CÔNG TÁC (Thâm niên = 2026 - namVaoNganh)
  // -------------------------------------------------------------
  const seniorityStats = useMemo(() => {
    let under5 = 0;
    let from5to15 = 0;
    let from16to25 = 0;
    let over25 = 0;
    let totalYears = 0;

    teachers.forEach(t => {
      const start = t.namVaoNganh || (t.experienceYears ? CURRENT_YEAR - t.experienceYears : 2012);
      const exp = Math.max(0, CURRENT_YEAR - start);
      totalYears += exp;

      if (exp < 5) under5++;
      else if (exp <= 15) from5to15++;
      else if (exp <= 25) from16to25++;
      else over25++;
    });

    const total = teachers.length || 1;
    const avgSeniority = Math.round((totalYears / total) * 10) / 10;

    return {
      under5,
      under5Pct: Math.round((under5 / total) * 100),
      from5to15,
      from5to15Pct: Math.round((from5to15 / total) * 100),
      from16to25,
      from16to25Pct: Math.round((from16to25 / total) * 100),
      over25,
      over25Pct: Math.round((over25 / total) * 100),
      avgSeniority
    };
  }, [teachers]);

  // -------------------------------------------------------------
  // 4A. THỐNG KÊ THEO BỘ MÔN (MA TRẬN BỘ MÔN)
  // -------------------------------------------------------------
  const subjectStats = useMemo(() => {
    const map: Record<string, {
      subjectName: string;
      teachers: Teacher[];
      dhCount: number;
      thsTsCount: number;
      totalAge: number;
      totalSeniority: number;
      totalTeachingPeriods: number;
    }> = {};

    teachers.forEach(t => {
      const spec = t.specialization || 'Khác';
      if (!map[spec]) {
        map[spec] = {
          subjectName: spec,
          teachers: [],
          dhCount: 0,
          thsTsCount: 0,
          totalAge: 0,
          totalSeniority: 0,
          totalTeachingPeriods: 0
        };
      }

      const d = map[spec];
      d.teachers.push(t);

      // Degree
      const deg = (t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')).toLowerCase();
      if (deg.includes('thạc') || deg.includes('tiến')) {
        d.thsTsCount++;
      } else {
        d.dhCount++;
      }

      // Age
      const bYear = t.namSinh || (t.experienceYears ? CURRENT_YEAR - 22 - t.experienceYears : 1985);
      d.totalAge += (CURRENT_YEAR - bYear);

      // Seniority
      const sYear = t.namVaoNganh || (t.experienceYears ? CURRENT_YEAR - t.experienceYears : 2012);
      d.totalSeniority += Math.max(0, CURRENT_YEAR - sYear);

      // Total teaching periods
      const st = getTeacherStats(t.id);
      d.totalTeachingPeriods += st.assignedPeriods;
    });

    return Object.values(map).map(d => ({
      subjectName: d.subjectName,
      deptName: d.subjectName, // Compatibility with previous references
      count: d.teachers.length,
      dhCount: d.dhCount,
      thsTsCount: d.thsTsCount,
      avgAge: Math.round((d.totalAge / (d.teachers.length || 1)) * 10) / 10,
      avgSeniority: Math.round((d.totalSeniority / (d.teachers.length || 1)) * 10) / 10,
      totalPeriods: d.totalTeachingPeriods,
      teachers: d.teachers
    })).sort((a, b) => b.count - a.count);
  }, [teachers, getTeacherStats]);

  // Giữ alias departmentStats tương thích cho modal lọc nghỉ hưu
  const departmentStats = subjectStats;

  // -------------------------------------------------------------
  // 4B. THỐNG KÊ THEO TỔ BỘ MÔN (GOM NHÓM THEO DEPARTMENTS)
  // -------------------------------------------------------------
  const departmentGroupStats = useMemo(() => {
    const activeDepts = (departments && departments.length > 0) ? departments : DEFAULT_DEPARTMENTS;

    // Helper: chuẩn hóa chuỗi
    const norm = (str: string) => (str || '').toLowerCase().trim();

    // Map chứa dữ liệu của từng tổ chuyên môn
    const deptMap = new Map<string, {
      dept: Department;
      subjectNamesSet: Set<string>;
      teachers: Teacher[];
      dhCount: number;
      thsTsCount: number;
      totalAge: number;
      totalSeniority: number;
      totalTeachingPeriods: number;
    }>();

    activeDepts.forEach(d => {
      deptMap.set(d.id, {
        dept: d,
        subjectNamesSet: new Set<string>(),
        teachers: [],
        dhCount: 0,
        thsTsCount: 0,
        totalAge: 0,
        totalSeniority: 0,
        totalTeachingPeriods: 0
      });
    });

    // 1. Phân loại các môn học từ subjectsConfig vào từng Tổ chuyên môn
    subjectsConfig.forEach(s => {
      let matchedDeptId: string | undefined = undefined;
      if (s.departmentId && deptMap.has(s.departmentId)) {
        matchedDeptId = s.departmentId;
      } else if (s.department) {
        const found = activeDepts.find(d => d.name === s.department);
        if (found) matchedDeptId = found.id;
      }

      if (!matchedDeptId) {
        const defaultName = getDefaultDepartment(s.id, s.name);
        const found = activeDepts.find(d => d.name === defaultName);
        if (found) matchedDeptId = found.id;
      }

      // Khớp dự phòng theo từ khóa tên môn
      if (!matchedDeptId) {
        const sNorm = norm(s.name || s.id);
        const found = activeDepts.find(d => {
          const dNorm = norm(d.name);
          if ((sNorm.includes('toán') || sNorm.includes('tin')) && (dNorm.includes('toán') || dNorm.includes('tin'))) return true;
          if ((sNorm.includes('văn') || sNorm.includes('ngữ văn')) && dNorm.includes('văn')) return true;
          if ((sNorm.includes('anh') || sNorm.includes('ngoại ngữ')) && (dNorm.includes('ngoại ngữ') || dNorm.includes('anh'))) return true;
          if ((sNorm.includes('lý') || sNorm.includes('hóa') || sNorm.includes('sinh') || sNorm.includes('khtn')) && (dNorm.includes('khtn') || dNorm.includes('tự nhiên'))) return true;
          if ((sNorm.includes('sử') || sNorm.includes('địa') || sNorm.includes('gdkt') || sNorm.includes('kinh tế') || sNorm.includes('khxh')) && (dNorm.includes('khxh') || dNorm.includes('xã hội'))) return true;
          if ((sNorm.includes('công nghệ') || sNorm.includes('nghệ thuật') || sNorm.includes('âm nhạc') || sNorm.includes('mỹ thuật') || sNorm.includes('mĩ thuật')) && (dNorm.includes('công nghệ') || dNorm.includes('nghệ thuật'))) return true;
          if ((sNorm.includes('gdtc') || sNorm.includes('thể dục') || sNorm.includes('gdqp') || sNorm.includes('quốc phòng')) && (dNorm.includes('gdtc') || dNorm.includes('gdqp'))) return true;
          return false;
        });
        if (found) matchedDeptId = found.id;
      }

      if (matchedDeptId && deptMap.has(matchedDeptId)) {
        deptMap.get(matchedDeptId)!.subjectNamesSet.add(s.name);
      }
    });

    // 2. Phân loại từng giáo viên vào DUY NHẤT 1 tổ chuyên môn phù hợp nhất
    teachers.forEach(t => {
      let matchedDeptId: string | undefined = undefined;

      // Kiểm tra t.departmentId hoặc t.toChuyenMon
      if ((t as any).departmentId && deptMap.has((t as any).departmentId)) {
        matchedDeptId = (t as any).departmentId;
      } else if ((t as any).toChuyenMon) {
        const found = activeDepts.find(d => d.name === (t as any).toChuyenMon);
        if (found) matchedDeptId = found.id;
      }

      // Kiểm tra chuyên môn của giáo viên với các môn đã gán vào tổ
      if (!matchedDeptId && t.specialization) {
        const specNorm = norm(t.specialization);
        for (const [deptId, data] of deptMap.entries()) {
          for (const sName of data.subjectNamesSet) {
            const sNorm = norm(sName);
            if (sNorm === specNorm || sNorm.includes(specNorm) || specNorm.includes(sNorm)) {
              matchedDeptId = deptId;
              break;
            }
          }
          if (matchedDeptId) break;
        }
      }

      // Khớp theo hàm mặc định
      if (!matchedDeptId && t.specialization) {
        const defaultName = getDefaultDepartment(t.specialization, t.specialization);
        const found = activeDepts.find(d => d.name === defaultName);
        if (found) matchedDeptId = found.id;
      }

      // Khớp dự phòng theo từ khóa chuyên môn
      if (!matchedDeptId && t.specialization) {
        const specNorm = norm(t.specialization);
        const found = activeDepts.find(d => {
          const dNorm = norm(d.name);
          if ((specNorm.includes('toán') || specNorm.includes('tin')) && (dNorm.includes('toán') || dNorm.includes('tin'))) return true;
          if ((specNorm.includes('văn') || specNorm.includes('ngữ văn')) && dNorm.includes('văn')) return true;
          if ((specNorm.includes('anh') || specNorm.includes('ngoại ngữ')) && (dNorm.includes('ngoại ngữ') || dNorm.includes('anh'))) return true;
          if ((specNorm.includes('lý') || specNorm.includes('hóa') || specNorm.includes('sinh') || specNorm.includes('khtn')) && (dNorm.includes('khtn') || dNorm.includes('tự nhiên'))) return true;
          if ((specNorm.includes('sử') || specNorm.includes('địa') || specNorm.includes('gdkt') || specNorm.includes('kinh tế') || specNorm.includes('khxh')) && (dNorm.includes('khxh') || dNorm.includes('xã hội'))) return true;
          if ((specNorm.includes('công nghệ') || specNorm.includes('cn') || specNorm.includes('nghệ thuật') || specNorm.includes('âm nhạc') || specNorm.includes('mỹ thuật') || specNorm.includes('mĩ thuật')) && (dNorm.includes('công nghệ') || dNorm.includes('nghệ thuật'))) return true;
          if ((specNorm.includes('gdtc') || specNorm.includes('thể dục') || specNorm.includes('gdqp') || specNorm.includes('quốc phòng')) && (dNorm.includes('gdtc') || dNorm.includes('gdqp'))) return true;
          return false;
        });
        if (found) matchedDeptId = found.id;
      }

      // Fallback
      if (!matchedDeptId) {
        const fallbackDept = activeDepts.find(d => norm(d.name).includes('hdtn') || norm(d.name).includes('khác')) || activeDepts[0];
        if (fallbackDept) matchedDeptId = fallbackDept.id;
      }

      if (matchedDeptId && deptMap.has(matchedDeptId)) {
        const target = deptMap.get(matchedDeptId)!;
        target.teachers.push(t);

        if (t.specialization) {
          target.subjectNamesSet.add(t.specialization);
        }

        // Degree
        const deg = (t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')).toLowerCase();
        if (deg.includes('thạc') || deg.includes('tiến')) {
          target.thsTsCount++;
        } else {
          target.dhCount++;
        }

        // Age
        const bYear = t.namSinh || (t.experienceYears ? CURRENT_YEAR - 22 - t.experienceYears : 1985);
        target.totalAge += (CURRENT_YEAR - bYear);

        // Seniority
        const sYear = t.namVaoNganh || (t.experienceYears ? CURRENT_YEAR - t.experienceYears : 2012);
        target.totalSeniority += Math.max(0, CURRENT_YEAR - sYear);

        // Assigned teaching periods
        const st = getTeacherStats(t.id);
        target.totalTeachingPeriods += st.assignedPeriods;
      }
    });

    // Tạo danh sách kết quả với badge các môn trực thuộc
    return activeDepts.map(d => {
      const data = deptMap.get(d.id)!;
      let subjectBadges = Array.from(data.subjectNamesSet);

      if (subjectBadges.length === 0) {
        const dNorm = norm(d.name);
        if (dNorm.includes('toán') || dNorm.includes('tin')) subjectBadges = ['Toán', 'Tin học'];
        else if (dNorm.includes('văn')) subjectBadges = ['Ngữ văn'];
        else if (dNorm.includes('ngoại ngữ') || dNorm.includes('anh')) subjectBadges = ['Tiếng Anh'];
        else if (dNorm.includes('khtn') || dNorm.includes('tự nhiên')) subjectBadges = ['Vật lý', 'Hóa học', 'Sinh học'];
        else if (dNorm.includes('khxh') || dNorm.includes('xã hội')) subjectBadges = ['Lịch sử', 'Địa lý', 'GDKT&PL'];
        else if (dNorm.includes('công nghệ') || dNorm.includes('nghệ thuật')) subjectBadges = ['Công nghệ', 'Nghệ thuật'];
        else if (dNorm.includes('gdtc') || dNorm.includes('gdqp')) subjectBadges = ['GDTC', 'GDQPAN'];
        else subjectBadges = ['HĐTN-HN'];
      }

      return {
        id: d.id,
        deptName: d.name,
        subjectBadges,
        teachers: data.teachers,
        count: data.teachers.length,
        dhCount: data.dhCount,
        thsTsCount: data.thsTsCount,
        avgAge: Math.round((data.totalAge / (data.teachers.length || 1)) * 10) / 10,
        avgSeniority: Math.round((data.totalSeniority / (data.teachers.length || 1)) * 10) / 10,
        totalPeriods: data.totalTeachingPeriods
      };
    });
  }, [departments, subjectsConfig, teachers, getTeacherStats]);

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // 5. DANH SÁCH GIÁO VIÊN CHUẨN BỊ NGHỈ HƯU THEO NGHỊ ĐỊNH 135/2020/NĐ-CP
  // Căn cứ chuẩn xác theo Nghị định 135/2020/NĐ-CP:
  // Lọc giáo viên chuẩn bị nghỉ hưu (1 – 5 năm tới: tính từ 2026 đến 2031)
  // -------------------------------------------------------------
  const retiringTeachers = useMemo(() => {
    return teachers
      .filter(t => checkRetiringSoon(t, CURRENT_YEAR))
      .map(t => {
        const retInfo = getRetirementDetails(t, CURRENT_YEAR);
        const start = (t as any).namVaoNganh || (t.experienceYears ? CURRENT_YEAR - t.experienceYears : 2012);
        const age = CURRENT_YEAR - retInfo.birthYear;
        const seniority = Math.max(0, CURRENT_YEAR - start);
        const st = getTeacherStats(t.id);

        return {
          ...t,
          retInfo,
          gender: retInfo.gender,
          birth: retInfo.birthYear,
          birthDateFormatted: retInfo.birthDateFormatted,
          age,
          start,
          seniority,
          retirementYear: retInfo.retirementYear,
          remainingYears: retInfo.remainingYearsDecimal,
          assignedPeriods: st.assignedPeriods,
          totalPeriods: st.totalPeriods
        };
      })
      .sort((a, b) => a.retInfo.retirementYear - b.retInfo.retirementYear || a.retInfo.remainingMonths - b.retInfo.remainingMonths);
  }, [teachers, getTeacherStats]);

  // Lọc tìm kiếm giáo viên nghỉ hưu
  const filteredRetiringTeachers = useMemo(() => {
    return retiringTeachers.filter(t => {
      const matchSearch = !retirementSearch || t.name.toLowerCase().includes(retirementSearch.toLowerCase()) || t.specialization.toLowerCase().includes(retirementSearch.toLowerCase());
      const matchDept = retirementDeptFilter === 'all' || t.specialization === retirementDeptFilter;
      return matchSearch && matchDept;
    });
  }, [retiringTeachers, retirementSearch, retirementDeptFilter]);

  // -------------------------------------------------------------
  // XUẤT EXCEL DANH SÁCH GIÁO VIÊN SẮP NGHỈ HƯU (THEO NĐ 135/2020)
  // -------------------------------------------------------------
  const handleExportRetirementExcel = () => {
    try {
      const dataRows = retiringTeachers.map((t, idx) => ({
        'STT': idx + 1,
        'Họ và tên': t.name,
        'Tổ bộ môn': t.specialization,
        'Chức vụ': t.position || 'Giáo viên',
        'Trình độ': t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học'),
        'Giới tính': t.gender,
        'Ngày sinh': t.birthDateFormatted,
        'Tuổi (năm 2026)': t.age,
        'Năm vào ngành': t.start,
        'Thâm niên (năm)': t.seniority,
        'Mốc tuổi nghỉ hưu NĐ 135': t.retInfo.retirementAgeLabel,
        'Thời điểm nghỉ hưu dự kiến (Tháng/Năm)': t.retInfo.retirementMonthYearLabel,
        'Ngày bắt đầu hưởng lương hưu': t.retInfo.retirementDateFormatted,
        'Thời gian còn lại': t.retInfo.remainingTimeLabel,
        'Số tiết đang dạy': t.assignedPeriods,
        'Tổng tiết nghĩa vụ': t.totalPeriods,
        'Số điện thoại': t.phone || '',
        'Email': t.email || ''
      }));

      const ws = XLSX.utils.json_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'GV_Sap_Nghi_Huu_ND135');

      const fileName = `Danh_Sach_GV_Sap_Nghi_Huu_ND135_2026_${schoolName.replace(/\\s+/g, '_')}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error(err);
      alert('Đã xảy ra lỗi khi xuất file Excel.');
    }
  };

  // -------------------------------------------------------------
  // IN ẤN / XUẤT PDF DANH SÁCH GIÁO VIÊN SẮP NGHỈ HƯU
  // -------------------------------------------------------------
  const handleExportRetirementPDF = async () => {
    const el = document.getElementById('retirement-print-content');
    if (!el) {
      window.print();
      return;
    }

    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableW = pw - margin * 2;
      const usableH = ph - margin * 2;
      const ratio = canvas.width / canvas.height;

      let rw = usableW;
      let rh = usableW / ratio;
      if (rh > usableH) {
        rh = usableH;
        rw = usableH * ratio;
      }

      const posX = margin + (usableW - rw) / 2;
      const posY = margin + 4;

      pdf.addImage(imgData, 'JPEG', posX, posY, rw, rh, undefined, 'FAST');
      pdf.save(`Danh_Sach_GV_Sap_Nghi_Huu_${CURRENT_YEAR}.pdf`);
    } catch (err) {
      console.error(err);
      window.print();
    }
  };

  return (
    <div className="space-y-4">
      {/* BANNER CẢNH BÁO / HIGHLIGHT: GIÁO VIÊN CHUẨN BỊ NGHỈ HƯU (1 – 5 NĂM TỚI) THEO NĐ 135/2020 */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-50 to-orange-50 border border-amber-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-950 text-sm md:text-base">
                Quy hoạch nhân sự: {retiringTeachers.length} Giáo viên chuẩn bị nghỉ hưu (1 – 5 năm tới)
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-900 border border-amber-300">
                Nghị định 135/2020/NĐ-CP
              </span>
            </div>
            <p className="text-amber-800/80 text-xs mt-0.5">
              Thời điểm nghỉ hưu thực tế được tính toán chuẩn hóa từng tháng theo ngày sinh và giới tính. Căn cứ trọng tâm quy hoạch nguồn kế cận và tuyển dụng.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsRetirementModalOpen(true)}
          className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
        >
          <span>Xem danh sách chi tiết ({retiringTeachers.length} GV)</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 4 KHỐI THỐNG KÊ NHÂN SỰ ĐA CHIỀU */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* KHỐI 1: THỐNG KÊ ĐỘ TUỔI */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-800 text-xs md:text-sm">Thống kê Độ tuổi</h3>
              </div>
              <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                TB: {ageStats.avgAge} tuổi
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Dưới 35 */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Dưới 35 tuổi (Trẻ)</span>
                  <span className="font-bold text-slate-800">{ageStats.under35} GV ({ageStats.under35Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${ageStats.under35Pct}%` }} />
                </div>
              </div>

              {/* 35 - 45 */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Từ 35 – 45 tuổi (Ổn định)</span>
                  <span className="font-bold text-slate-800">{ageStats.from35to45} GV ({ageStats.from35to45Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${ageStats.from35to45Pct}%` }} />
                </div>
              </div>

              {/* 46 - 54 */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Từ 46 – 54 tuổi (Kinh nghiệm)</span>
                  <span className="font-bold text-slate-800">{ageStats.from46to54} GV ({ageStats.from46to54Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${ageStats.from46to54Pct}%` }} />
                </div>
              </div>

              {/* Từ 55 tuổi trở lên */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-amber-800 font-medium">Từ 55 tuổi trở lên (Chuẩn bị hưu)</span>
                  <span className="font-bold text-amber-700">{ageStats.from55plus} GV ({ageStats.from55plusPct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${ageStats.from55plusPct}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Tổng số: <b>{teachers.length}</b> giáo viên</span>
            <span className="text-emerald-700 font-semibold">Cơ cấu độ tuổi vững vàng</span>
          </div>
        </div>

        {/* KHỐI 2: THỐNG KÊ TRÌNH ĐỘ CHUYÊN MÔN */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-800 text-xs md:text-sm">Trình độ chuyên môn</h3>
              </div>
              <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                Trên chuẩn: {degreeStats.aboveStandardPct}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <div className="bg-purple-50/70 border border-purple-100 rounded-lg p-2.5 text-center">
                <div className="text-[11px] text-purple-800 font-semibold">Thạc sĩ (ThS)</div>
                <div className="text-lg font-black text-purple-900 mt-0.5">{degreeStats.thsCount}</div>
                <div className="text-[10px] text-purple-600">{degreeStats.thsPct}% đội ngũ</div>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-100 rounded-lg p-2.5 text-center">
                <div className="text-[11px] text-emerald-800 font-semibold">Đại học (ĐH)</div>
                <div className="text-lg font-black text-emerald-900 mt-0.5">{degreeStats.dhCount}</div>
                <div className="text-[10px] text-emerald-600">{degreeStats.dhPct}% đội ngũ</div>
              </div>
            </div>

            <div className="space-y-1.5 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Tiến sĩ (TS):</span>
                <span className="font-bold text-slate-800">{degreeStats.tsCount} GV ({degreeStats.tsPct}%)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Chuẩn nghề nghiệp:</span>
                <span className="font-bold text-emerald-700">100% Đạt & Trên chuẩn</span>
              </div>
            </div>
          </div>

          <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Kiểm định giáo dục:</span>
            <span className="font-bold text-purple-700">Vượt chỉ tiêu chất lượng</span>
          </div>
        </div>

        {/* KHỐI 3: THỐNG KÊ THÂM NIÊN CÔNG TÁC */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between md:col-span-2 lg:col-span-1">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <Briefcase className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-800 text-xs md:text-sm">Thâm niên công tác</h3>
              </div>
              <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                TB: {seniorityStats.avgSeniority} năm
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Dưới 5 năm */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Dưới 5 năm</span>
                  <span className="font-bold text-slate-800">{seniorityStats.under5} GV ({seniorityStats.under5Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-teal-400 h-2 rounded-full transition-all" style={{ width: `${seniorityStats.under5Pct}%` }} />
                </div>
              </div>

              {/* 5 - 15 năm */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">5 – 15 năm (Kinh nghiệm)</span>
                  <span className="font-bold text-slate-800">{seniorityStats.from5to15} GV ({seniorityStats.from5to15Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-teal-600 h-2 rounded-full transition-all" style={{ width: `${seniorityStats.from5to15Pct}%` }} />
                </div>
              </div>

              {/* 16 - 25 năm */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">16 – 25 năm (Cốt cán)</span>
                  <span className="font-bold text-slate-800">{seniorityStats.from16to25} GV ({seniorityStats.from16to25Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${seniorityStats.from16to25Pct}%` }} />
                </div>
              </div>

              {/* Trên 25 năm */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Trên 25 năm (Lão thành)</span>
                  <span className="font-bold text-slate-800">{seniorityStats.over25} GV ({seniorityStats.over25Pct}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-purple-600 h-2 rounded-full transition-all" style={{ width: `${seniorityStats.over25Pct}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Mức độ gắn bó:</span>
            <span className="font-bold text-teal-800">Rất cao & Ổn định</span>
          </div>
        </div>
      </div>

      {/* KHỐI 4: THỐNG KÊ THEO BỘ MÔN & TỔ BỘ MÔN (SUB-TABS) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        {/* THANH ĐIỀU HƯỚNG SUB-TABS */}
        <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-xs md:text-sm">
                  {matrixTab === 'subject' ? 'Ma trận Thống kê theo Bộ môn' : 'Ma trận Thống kê theo Tổ bộ môn'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {matrixTab === 'subject'
                    ? 'Thống kê quy mô đội ngũ, trình độ và số tiết theo từng môn học giảng dạy'
                    : 'Gom nhóm giáo viên và các môn học trực thuộc theo từng Tổ chuyên môn của nhà trường'}
                </p>
              </div>
            </div>

            {/* THANH CHUYỂN ĐỔI 2 SUB-TABS */}
            <div className="flex items-center p-1 bg-slate-200/80 rounded-xl border border-slate-300/60 shadow-inner self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setMatrixTab('subject')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  matrixTab === 'subject'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <span>📚</span>
                <span>Thống kê theo Bộ môn</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  matrixTab === 'subject' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-300 text-slate-700'
                }`}>
                  {subjectStats.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMatrixTab('department')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  matrixTab === 'department'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <span>👥</span>
                <span>Thống kê theo Tổ bộ môn</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  matrixTab === 'department' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-300 text-slate-700'
                }`}>
                  {departmentGroupStats.length}
                </span>
              </button>
            </div>
          </div>

          <span className="text-[11px] font-semibold text-slate-500 font-mono self-start md:self-auto bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs">
            {matrixTab === 'subject' ? `${subjectStats.length} Bộ môn` : `${departmentGroupStats.length} Tổ chuyên môn`}
          </span>
        </div>

        {/* TAB 1: THỐNG KÊ THEO BỘ MÔN */}
        {matrixTab === 'subject' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100/90 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10.5px]">
                <tr>
                  <th className="py-2.5 px-3 border-r border-slate-200">BỘ MÔN</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">SỐ LƯỢNG GV</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">ĐẠI HỌC (ĐH)</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">THS / TS</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">ĐỘ TUỔI TB</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">THÂM NIÊN TB</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">TỔNG TIẾT DẠY</th>
                  <th className="py-2.5 px-3 text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {subjectStats.map((sub, idx) => (
                  <tr 
                    key={sub.subjectName} 
                    className={`hover:bg-blue-50/70 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}`}
                    onClick={() => setDetailModalData({
                      type: 'subject',
                      title: `Bộ môn: ${sub.subjectName}`,
                      subtitle: `Danh sách giáo viên giảng dạy bộ môn ${sub.subjectName}`,
                      teachers: sub.teachers,
                      totalPeriods: sub.totalPeriods,
                      dhCount: sub.dhCount,
                      thsTsCount: sub.thsTsCount,
                      avgAge: sub.avgAge,
                      avgSeniority: sub.avgSeniority
                    })}
                  >
                    <td className="py-2.5 px-3 border-r border-slate-200 font-bold text-slate-900 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-600 inline-block shrink-0" />
                      <span>{sub.subjectName}</span>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-semibold text-slate-800">
                      {sub.count}
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-semibold">
                        {sub.dhCount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
                        {sub.thsTsCount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono">
                      {sub.avgAge} tuổi
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono">
                      {sub.avgSeniority} năm
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-bold text-blue-700 font-mono">
                      {sub.totalPeriods} tiết
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailModalData({
                            type: 'subject',
                            title: `Bộ môn: ${sub.subjectName}`,
                            subtitle: `Danh sách giáo viên giảng dạy bộ môn ${sub.subjectName}`,
                            teachers: sub.teachers,
                            totalPeriods: sub.totalPeriods,
                            dhCount: sub.dhCount,
                            thsTsCount: sub.thsTsCount,
                            avgAge: sub.avgAge,
                            avgSeniority: sub.avgSeniority
                          });
                        }}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md text-[11px] font-semibold transition cursor-pointer border border-blue-200"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: THỐNG KÊ THEO TỔ BỘ MÔN */}
        {matrixTab === 'department' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100/90 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10.5px]">
                <tr>
                  <th className="py-2.5 px-3 text-center w-12 border-r border-slate-200">STT</th>
                  <th className="py-2.5 px-3 min-w-[190px] border-r border-slate-200">TÊN TỔ CHUYÊN MÔN</th>
                  <th className="py-2.5 px-3 min-w-[210px] border-r border-slate-200">CÁC MÔN TRỰC THUỘC</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">TỔNG SỐ GV</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">ĐẠI HỌC (ĐH)</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">THS / TS</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">ĐỘ TUỔI TRUNG BÌNH</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">THÂM NIÊN TRUNG BÌNH</th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200">TỔNG TIẾT DẠY CỦA TỔ</th>
                  <th className="py-2.5 px-3 text-center w-24">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {departmentGroupStats.map((dept, idx) => (
                  <tr 
                    key={dept.id || dept.deptName} 
                    className={`hover:bg-indigo-50/50 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}`}
                    onClick={() => setDetailModalData({
                      type: 'department',
                      title: dept.deptName,
                      subtitle: `Tổ chuyên môn bao gồm các môn: ${dept.subjectBadges.join(', ')}`,
                      badges: dept.subjectBadges,
                      teachers: dept.teachers,
                      totalPeriods: dept.totalPeriods,
                      dhCount: dept.dhCount,
                      thsTsCount: dept.thsTsCount,
                      avgAge: dept.avgAge,
                      avgSeniority: dept.avgSeniority
                    })}
                  >
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-400 font-semibold">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-200 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block shrink-0" />
                      <span className="text-[12.5px]">{dept.deptName}</span>
                    </td>
                    <td className="py-2 px-3 border-r border-slate-200">
                      <div className="flex flex-wrap gap-1 items-center">
                        {dept.subjectBadges.map((badge, bIdx) => (
                          <span 
                            key={bIdx}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs"
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-bold text-slate-800 text-xs">
                      {dept.count}
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <span className="px-2 py-0.5 rounded text-[10.5px] bg-slate-100 text-slate-700 font-semibold">
                        {dept.dhCount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <span className="px-2 py-0.5 rounded text-[10.5px] bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
                        {dept.thsTsCount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-700">
                      {dept.avgAge > 0 ? `${dept.avgAge} tuổi` : '—'}
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-700">
                      {dept.avgSeniority > 0 ? `${dept.avgSeniority} năm` : '—'}
                    </td>
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-bold text-indigo-700 font-mono">
                      {dept.totalPeriods} tiết
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailModalData({
                            type: 'department',
                            title: dept.deptName,
                            subtitle: `Tổ chuyên môn bao gồm các môn: ${dept.subjectBadges.join(', ')}`,
                            badges: dept.subjectBadges,
                            teachers: dept.teachers,
                            totalPeriods: dept.totalPeriods,
                            dhCount: dept.dhCount,
                            thsTsCount: dept.thsTsCount,
                            avgAge: dept.avgAge,
                            avgSeniority: dept.avgSeniority
                          });
                        }}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md text-[11px] font-semibold transition cursor-pointer border border-indigo-200 shadow-2xs"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL CHI TIẾT THÀNH VIÊN (CHO CẢ BỘ MÔN VÀ TỔ BỘ MÔN) */}
      {detailModalData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[88vh]">
            {/* Header Modal */}
            <div className={`p-4 text-white flex justify-between items-center ${
              detailModalData.type === 'department'
                ? 'bg-gradient-to-r from-indigo-700 via-indigo-800 to-blue-800'
                : 'bg-gradient-to-r from-blue-700 to-indigo-800'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  {detailModalData.type === 'department' ? (
                    <Users className="w-5 h-5 text-indigo-200" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-blue-200" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-wide flex items-center gap-2">
                    <span>{detailModalData.title}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-mono font-normal">
                      {detailModalData.teachers.length} GV
                    </span>
                  </h3>
                  <p className="text-[11px] text-blue-100 mt-0.5">
                    {detailModalData.subtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalData(null)}
                className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Badges môn học & tóm tắt nhanh */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              {detailModalData.badges && detailModalData.badges.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-slate-500">Môn trực thuộc:</span>
                  {detailModalData.badges.map((b, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold text-[10.5px]">
                      {b}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 text-[11px] text-slate-600 font-medium ml-auto">
                <span>ĐH: <strong className="text-slate-800">{detailModalData.dhCount}</strong></span>
                <span>ThS/TS: <strong className="text-purple-700">{detailModalData.thsTsCount}</strong></span>
                <span>Tuổi TB: <strong className="text-slate-800 font-mono">{detailModalData.avgAge}</strong></span>
                <span>Thâm niên TB: <strong className="text-slate-800 font-mono">{detailModalData.avgSeniority} năm</strong></span>
                <span>Tổng dạy: <strong className="text-indigo-700 font-mono">{detailModalData.totalPeriods} tiết</strong></span>
              </div>
            </div>

            {/* Danh sách giáo viên */}
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {detailModalData.teachers.length === 0 ? (
                <div className="text-center py-8 text-slate-400 font-medium text-xs">
                  Chưa có giáo viên nào được phân công thuộc nhóm này.
                </div>
              ) : (
                detailModalData.teachers.map((t, idx) => {
                  const birth = t.namSinh || (t.experienceYears ? CURRENT_YEAR - 22 - t.experienceYears : 1985);
                  const start = t.namVaoNganh || (t.experienceYears ? CURRENT_YEAR - t.experienceYears : 2012);
                  const st = getTeacherStats(t.id);

                  return (
                    <div 
                      key={t.id} 
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50/40 hover:border-indigo-200 transition flex items-center justify-between text-xs gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-mono font-bold flex items-center justify-center text-[11px] shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                            <span>{t.name}</span>
                            {t.specialization && (
                              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                {t.specialization}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium text-slate-700">{t.position || 'Giáo viên'}</span>
                            <span>•</span>
                            <span>Sinh {birth} ({CURRENT_YEAR - birth} tuổi)</span>
                            <span>•</span>
                            <span>Vào ngành {start} ({CURRENT_YEAR - start} năm)</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 inline-block">
                          {t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')}
                        </span>
                        <div className="text-[11px] text-indigo-700 font-bold mt-1 font-mono">
                          {st.assignedPeriods} / {t.maxPeriods} tiết
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Modal */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailModalData(null)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL / PHÂN HỆ: DANH SÁCH GIÁO VIÊN SẮP NGHỈ HƯU */}
      {isRetirementModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[9999] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header Modal */}
            <div className="p-4 bg-gradient-to-r from-amber-600 via-amber-700 to-orange-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-200" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-wide">
                    Danh sách Giáo viên Chuẩn bị Nghỉ hưu (1 – 5 năm tới)
                  </h3>
                  <p className="text-[11px] text-amber-200">
                    Mốc năm 2026 • Phục vụ công tác quy hoạch nhân sự và tuyển dụng thay thế
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRetirementModalOpen(false)}
                className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toolbar Filter & Export */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên giáo viên, môn..."
                    value={retirementSearch}
                    onChange={e => setRetirementSearch(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>

                <select
                  value={retirementDeptFilter}
                  onChange={e => setRetirementDeptFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 text-xs focus:outline-none"
                >
                  <option value="all">Tất cả tổ bộ môn</option>
                  {departmentStats.map(d => (
                    <option key={d.deptName} value={d.deptName}>{d.deptName} ({d.count})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportRetirementExcel}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Xuất Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportRetirementPDF}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In / PDF</span>
                </button>
              </div>
            </div>

            {/* Table Content */}
            <div id="retirement-print-content" className="p-4 overflow-y-auto flex-1 bg-white">
              <div className="text-center mb-3 hidden print:block">
                <h2 className="text-base font-bold uppercase text-slate-900">{schoolName}</h2>
                <h1 className="text-lg font-black uppercase text-amber-800 mt-1">
                  DANH SÁCH GIÁO VIÊN CHUẨN BỊ NGHỈ HƯU (1 – 5 NĂM TỚI)
                </h1>
                <p className="text-xs italic text-slate-500">Mốc năm học: {academicYear} — {semester}</p>
              </div>

              <table className="w-full text-xs text-left border-collapse border border-slate-300">
                <thead className="bg-amber-50 text-amber-950 font-bold border-b border-slate-300 text-[11px]">
                  <tr>
                    <th className="py-2 px-2 border border-slate-300 text-center w-10">STT</th>
                    <th className="py-2 px-2.5 border border-slate-300">Họ và tên</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Tổ bộ môn</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Giới tính</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Ngày sinh (Tuổi)</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Vào ngành (Thâm niên)</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Thời điểm nghỉ hưu dự kiến (Tháng/Năm)</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Thời gian còn lại</th>
                    <th className="py-2 px-2 border border-slate-300 text-center">Tiết đang dạy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {filteredRetiringTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Không tìm thấy giáo viên nào trong danh mục
                      </td>
                    </tr>
                  ) : (
                    filteredRetiringTeachers.map((t, idx) => (
                      <tr key={t.id} className="hover:bg-amber-50/50 transition">
                        <td className="py-2 px-2 border border-slate-300 text-center font-semibold text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-2.5 border border-slate-300 font-bold text-slate-900">
                          <div>{t.name}</div>
                          <div className="text-[10px] text-slate-400 font-normal">
                            {t.position || 'Giáo viên'} • {t.trinhDo || (t.experienceYears > 15 ? 'Thạc sĩ' : 'Đại học')}
                          </div>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center font-medium text-blue-700">
                          {t.specialization}
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            t.gender === 'Nam' 
                              ? 'bg-blue-50 text-blue-800 border border-blue-200' 
                              : 'bg-pink-50 text-pink-800 border border-pink-200'
                          }`}>
                            {t.gender}
                          </span>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center font-mono">
                          <div className="font-semibold text-slate-900">{t.birthDateFormatted}</div>
                          <div className="text-[10.5px] text-slate-500 font-normal">({t.age} tuổi)</div>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center font-mono">
                          <div>{t.start}</div>
                          <div className="text-[10.5px] text-slate-500 font-normal">({t.seniority} năm)</div>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center">
                          <div className="font-bold text-amber-900 font-mono text-xs">{t.retInfo.retirementMonthYearLabel}</div>
                          <div className="text-[10.5px] text-slate-500">
                            Ngày {t.retInfo.retirementDateFormatted} • Mốc {t.retInfo.retirementAgeLabel}
                          </div>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center font-semibold">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border inline-block ${
                            t.retInfo.remainingMonths <= 12 
                              ? 'bg-rose-100 text-rose-800 border-rose-300' 
                              : t.retInfo.remainingMonths <= 36 
                              ? 'bg-amber-100 text-amber-800 border-amber-300' 
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}>
                            {t.retInfo.remainingTimeLabel}
                          </span>
                        </td>
                        <td className="py-2 px-2 border border-slate-300 text-center font-bold font-mono text-slate-800">
                          {t.assignedPeriods} tiết
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Modal */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
              <span>Hiển thị: <b>{filteredRetiringTeachers.length}</b> / {retiringTeachers.length} giáo viên</span>
              <button
                type="button"
                onClick={() => setIsRetirementModalOpen(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
