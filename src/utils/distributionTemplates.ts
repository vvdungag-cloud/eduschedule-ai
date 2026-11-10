import { Teacher, ClassModel } from './assignmentSolver';
import { TimetableData, TimetableLesson, DAYS_CONFIG } from './timetableTypes';
import { SchoolInfo } from './exportUtils';

export interface TeacherAssignmentSummary {
  classes: { className: string; subject: string; periods: number }[];
  totalPeriods: number;
  homeroomClass: string | null;
  position: string;
  quota: number;
}

/**
 * Trích xuất tổng hợp phân công của 1 giáo viên
 */
export function getTeacherAssignmentSummary(
  teacher: Teacher,
  classes: ClassModel[],
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  },
  classSubjectPeriods?: Record<string, Record<string, any>>,
  subjectsConfig?: { id: string; grade10Periods: number; grade11Periods: number; grade12Periods: number }[]
): TeacherAssignmentSummary {
  const teacherId = teacher.id;
  const teacherClasses: { className: string; subject: string; periods: number }[] = [];

  // Tìm lớp chủ nhiệm
  let homeroomClass: string | null = null;
  Object.entries(assignments.homeroomAssignments || {}).forEach(([cId, tId]) => {
    if (tId === teacherId) {
      const cls = classes.find(c => c.id === cId);
      homeroomClass = cls ? cls.name : cId;
    }
  });

  // Tìm các môn và lớp được phân công
  Object.entries(assignments.subjectAssignments || {}).forEach(([cId, subMap]) => {
    const cls = classes.find(c => c.id === cId);
    const className = cls ? cls.name : cId;
    const grade = cls?.grade || '10';

    Object.entries(subMap || {}).forEach(([subjectId, tId]) => {
      if (tId === teacherId) {
        // Xác định số tiết
        let periods = 0;
        if (classSubjectPeriods?.[cId]?.[subjectId] !== undefined) {
          periods = Number(classSubjectPeriods[cId][subjectId]) || 0;
        } else {
          const cfg = subjectsConfig?.find(s => s.id === subjectId);
          if (cfg) {
            periods = grade === '12' ? cfg.grade12Periods : (grade === '11' ? cfg.grade11Periods : cfg.grade10Periods);
          }
        }
        teacherClasses.push({
          className,
          subject: subjectId,
          periods
        });
      }
    });
  });

  const totalPeriods = teacherClasses.reduce((sum, item) => sum + item.periods, 0) + (homeroomClass ? 4 : 0);

  return {
    classes: teacherClasses,
    totalPeriods,
    homeroomClass,
    position: teacher.position || 'Giáo viên',
    quota: teacher.maxPeriods || 17
  };
}

/**
 * Tạo ma trận lưới TKB của 1 giáo viên
 */
export function getTeacherTimetableGrid(teacherId: string, timetableData: TimetableData | null) {
  // Lấy danh sách tiết dạy của GV
  const lessons = timetableData?.lessons?.filter(l => l.teacherId === teacherId) || [];
  
  // Kiểm tra xem có tiết buổi chiều không
  const hasAfternoon = lessons.some(l => l.period > 5) || timetableData?.sessionMode === 'double';
  const maxPeriod = hasAfternoon ? 10 : 5;

  const grid: Record<number, Record<number, TimetableLesson | null>> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    grid[p] = {};
    for (let d = 2; d <= 7; d++) {
      grid[p][d] = null;
    }
  }

  lessons.forEach(l => {
    if (grid[l.period] && grid[l.period][l.day] !== undefined) {
      grid[l.period][l.day] = l;
    }
  });

  return { grid, hasAfternoon, maxPeriod, totalLessons: lessons.length };
}

/**
 * Tạo ma trận lưới TKB của 1 lớp
 */
export function getClassTimetableGrid(classIdOrName: string, timetableData: TimetableData | null) {
  const lessons = timetableData?.lessons?.filter(l => l.classId === classIdOrName || l.className === classIdOrName) || [];
  const hasAfternoon = lessons.some(l => l.period > 5) || timetableData?.sessionMode === 'double';
  const maxPeriod = hasAfternoon ? 10 : 5;

  const grid: Record<number, Record<number, TimetableLesson | null>> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    grid[p] = {};
    for (let d = 2; d <= 7; d++) {
      grid[p][d] = null;
    }
  }

  lessons.forEach(l => {
    if (grid[l.period] && grid[l.period][l.day] !== undefined) {
      grid[l.period][l.day] = l;
    }
  });

  return { grid, hasAfternoon, maxPeriod, totalLessons: lessons.length };
}

/**
 * Tạo Responsive HTML Email Template cho Giáo viên
 */
export function generateTeacherEmailHtml(params: {
  teacher: Teacher;
  summary: TeacherAssignmentSummary;
  timetableData: TimetableData | null;
  schoolInfo?: Partial<SchoolInfo>;
}): string {
  const { teacher, summary, timetableData, schoolInfo } = params;
  const schoolName = schoolInfo?.schoolName || 'TRƯỜNG THPT CHUYÊN SỐ 1';
  const academicYear = timetableData?.academicYear || schoolInfo?.academicYear || '2024 - 2025';
  const semester = timetableData?.semester || schoolInfo?.semester || 'Học kỳ I';
  const { grid, maxPeriod } = getTeacherTimetableGrid(teacher.id, timetableData);

  const days = [
    { day: 2, label: 'Thứ 2' },
    { day: 3, label: 'Thứ 3' },
    { day: 4, label: 'Thứ 4' },
    { day: 5, label: 'Thứ 5' },
    { day: 6, label: 'Thứ 6' },
    { day: 7, label: 'Thứ 7' },
  ];

  let timetableRowsHtml = '';
  for (let p = 1; p <= maxPeriod; p++) {
    const isMorningBoundary = p === 5;
    const isAfternoonStart = p === 6;
    
    if (isAfternoonStart) {
      timetableRowsHtml += `
        <tr>
          <td colspan="7" style="background-color: #f1f5f9; padding: 6px 12px; font-weight: bold; font-size: 11px; text-transform: uppercase; color: #475569; text-align: left; border: 1px solid #cbd5e1;">
            Buổi Chiều
          </td>
        </tr>
      `;
    }

    timetableRowsHtml += `<tr>`;
    timetableRowsHtml += `<td style="background-color: #f8fafc; font-weight: 600; text-align: center; padding: 8px 4px; border: 1px solid #cbd5e1; font-size: 12px; color: #334155;">Tiết ${p > 5 ? p - 5 + ' (C)' : p}</td>`;

    days.forEach(d => {
      const lesson = grid[p]?.[d.day];
      if (lesson) {
        const isHomeroomOrFixed = lesson.isFixed || lesson.subject === 'Chào cờ' || lesson.subject === 'Sinh hoạt lớp';
        const bg = isHomeroomOrFixed ? '#fef3c7' : '#eff6ff';
        const textColor = isHomeroomOrFixed ? '#92400e' : '#1e40af';
        const borderBadge = isHomeroomOrFixed ? '#fde68a' : '#bfdbfe';

        timetableRowsHtml += `
          <td style="background-color: ${bg}; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center; vertical-align: middle;">
            <div style="font-weight: 700; color: ${textColor}; font-size: 13px;">${lesson.className}</div>
            <div style="font-size: 11px; color: #475569; margin-top: 2px;">${lesson.subject}</div>
          </td>
        `;
      } else {
        timetableRowsHtml += `
          <td style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 6px 4px; text-align: center; color: #cbd5e1; font-size: 11px;">
            -
          </td>
        `;
      }
    });

    timetableRowsHtml += `</tr>`;
  }

  // Bảng phân công chi tiết
  const assignmentRowsHtml = summary.classes.length > 0 
    ? summary.classes.map((c, idx) => `
        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px; color: #64748b;">${idx + 1}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; font-size: 13px; color: #1e293b;">${c.className}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${c.subject}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; font-size: 13px; color: #2563eb;">${c.periods} tiết/tuần</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="padding: 12px; text-align: center; color: #94a3b8; font-style: italic; border: 1px solid #e2e8f0;">Chưa có phân công bộ môn</td></tr>`;

  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thông báo Thời khóa biểu & Phân công chuyên môn</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px 10px; color: #1e293b; line-height: 1.5;">
  <div style="max-width: 720px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    
    <!-- HEADER -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 28px 24px; color: #ffffff; text-align: center;">
      <div style="font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">
        ${schoolName}
      </div>
      <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.3px;">
        THỜI KHÓA BIỂU & PHÂN CÔNG GIẢNG DẠY
      </h1>
      <div style="margin-top: 6px; font-size: 13px; opacity: 0.95; font-weight: 500;">
        ${semester} • Năm học ${academicYear}
      </div>
    </div>

    <!-- RECIPIENT CARD -->
    <div style="padding: 24px; border-bottom: 1px solid #f1f5f9; background-color: #fafbfc;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
        <div>
          <div style="font-size: 12px; color: #64748b; font-weight: 500; text-transform: uppercase;">Kính gửi Thầy/Cô:</div>
          <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px;">
            ${teacher.name}
          </div>
          <div style="font-size: 13px; color: #475569; margin-top: 4px;">
            <span style="font-weight: 600; color: #2563eb;">${teacher.specialization || 'Chuyên môn'}</span> • 
            Chức vụ: <strong>${summary.position}</strong>
            ${teacher.department ? ` • Tổ: ${teacher.department}` : ''}
          </div>
        </div>
        <div style="margin-top: 10px; background: #e0f2fe; padding: 10px 16px; border-radius: 8px; border: 1px solid #bae6fd; text-align: right;">
          <div style="font-size: 11px; color: #0369a1; font-weight: 600; text-transform: uppercase;">Tổng số tiết / Định mức</div>
          <div style="font-size: 18px; font-weight: 800; color: #0284c7; margin-top: 2px;">
            ${summary.totalPeriods} <span style="font-size: 13px; font-weight: 500; color: #0369a1;">/ ${summary.quota} tiết</span>
          </div>
          ${summary.homeroomClass ? `<div style="font-size: 11px; color: #047857; font-weight: 700; margin-top: 2px;">★ Chủ nhiệm lớp ${summary.homeroomClass}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- MAIN BODY -->
    <div style="padding: 24px;">

      <!-- PHẦN 1: BẢNG LƯỚI TKB -->
      <div style="margin-bottom: 28px;">
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: #1e293b;">
            📅 Thời khóa biểu cá nhân theo tuần
          </h2>
        </div>

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: center; border: 1px solid #cbd5e1;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #334155;">
                <th style="padding: 10px 4px; border: 1px solid #cbd5e1; width: 64px; font-size: 12px; font-weight: 700;">Tiết</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 2</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 3</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 4</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 5</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 6</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 7</th>
              </tr>
            </thead>
            <tbody>
              ${timetableRowsHtml}
            </tbody>
          </table>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: #64748b; font-style: italic;">
          * Ghi chú: Thầy/cô vui lòng có mặt trước giờ vào lớp ít nhất 5 phút để bảo đảm nề nếp giảng dạy.
        </div>
      </div>

      <!-- PHẦN 2: BẢNG TỔNG HỢP PHÂN CÔNG CHUYÊN MÔN -->
      <div>
        <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #1e293b;">
          📋 Danh mục phân công giảng dạy chi tiết
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background-color: #f8fafc; color: #475569;">
              <th style="padding: 8px 12px; border: 1px solid #e2e8f0; width: 44px; text-align: center;">STT</th>
              <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left;">Lớp giảng dạy</th>
              <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left;">Phân môn</th>
              <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">Số tiết/tuần</th>
            </tr>
          </thead>
          <tbody>
            ${assignmentRowsHtml}
            ${summary.homeroomClass ? `
              <tr style="background-color: #fefce8; font-weight: 600;">
                <td style="padding: 8px 12px; border: 1px solid #fef08a; text-align: center; color: #854d0e;">★</td>
                <td style="padding: 8px 12px; border: 1px solid #fef08a; color: #854d0e;">Lớp ${summary.homeroomClass}</td>
                <td style="padding: 8px 12px; border: 1px solid #fef08a; color: #854d0e;">Chủ nhiệm & Sinh hoạt</td>
                <td style="padding: 8px 12px; border: 1px solid #fef08a; text-align: center; color: #854d0e;">4 tiết (Quy đổi)</td>
              </tr>
            ` : ''}
          </tbody>
        </table>
      </div>

    </div>

    <!-- FOOTER -->
    <div style="background-color: #f8fafc; padding: 20px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
      <div style="font-weight: 600; color: #334155;">BAN GIÁM HIỆU & BAN CHUYÊN MÔN NHÀ TRƯỜNG</div>
      <div style="margin-top: 4px;">Email này được gửi tự động từ Hệ thống Quản trị & Phân công Thời khóa biểu EduSchedule AI.</div>
      <div style="margin-top: 4px; color: #94a3b8;">Mọi thắc mắc hoặc đề nghị điều chỉnh, xin liên hệ bộ phận Học vụ.</div>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/**
 * Tạo nội dung văn bản thuần (Plain Text) cho tin nhắn Zalo gửi Giáo viên
 */
export function generateTeacherPlainText(params: {
  teacher: Teacher;
  summary: TeacherAssignmentSummary;
  timetableData: TimetableData | null;
  schoolInfo?: Partial<SchoolInfo>;
}): string {
  const { teacher, summary, timetableData, schoolInfo } = params;
  const schoolName = schoolInfo?.schoolName || 'TRƯỜNG THPT';
  const academicYear = timetableData?.academicYear || '2024 - 2025';
  const semester = timetableData?.semester || 'Học kỳ I';
  const { grid, maxPeriod } = getTeacherTimetableGrid(teacher.id, timetableData);

  let text = `📢 THÔNG BÁO TKB & PHÂN CÔNG CHUYÊN MÔN\n`;
  text += `🏫 ${schoolName}\n`;
  text += `📌 ${semester} - Năm học ${academicYear}\n\n`;
  text += `Kính gửi: Thầy/Cô ${teacher.name}\n`;
  text += `• Chuyên môn: ${teacher.specialization || ''} | Chức vụ: ${summary.position}\n`;
  text += `• Định mức: ${summary.totalPeriods}/${summary.quota} tiết/tuần\n`;
  if (summary.homeroomClass) {
    text += `• Chủ nhiệm: Lớp ${summary.homeroomClass}\n`;
  }
  text += `\n📋 CÁC LỚP PHÂN CÔNG:\n`;
  summary.classes.forEach((c, idx) => {
    text += ` ${idx + 1}. Lớp ${c.className} (${c.subject}): ${c.periods} tiết/tuần\n`;
  });

  text += `\n📅 LỊCH DẠY TRONG TUẦN:\n`;
  const days = [
    { day: 2, label: 'Thứ 2' },
    { day: 3, label: 'Thứ 3' },
    { day: 4, label: 'Thứ 4' },
    { day: 5, label: 'Thứ 5' },
    { day: 6, label: 'Thứ 6' },
    { day: 7, label: 'Thứ 7' },
  ];

  let hasAnyLesson = false;
  days.forEach(d => {
    const dayLessons: string[] = [];
    for (let p = 1; p <= maxPeriod; p++) {
      const lesson = grid[p]?.[d.day];
      if (lesson) {
        dayLessons.push(`T${p > 5 ? p - 5 + '(C)' : p}: ${lesson.className} (${lesson.subject})`);
      }
    }
    if (dayLessons.length > 0) {
      hasAnyLesson = true;
      text += `• ${d.label}: ${dayLessons.join(' | ')}\n`;
    }
  });

  if (!hasAnyLesson) {
    text += `(Chưa có tiết trên lưới TKB)\n`;
  }

  text += `\nKính chúc Thầy/Cô một học kỳ giảng dạy hiệu quả và thành công!`;
  return text;
}

/**
 * Tạo Responsive HTML Email Template cho Học sinh / Phụ huynh Lớp
 */
export function generateClassEmailHtml(params: {
  classItem: ClassModel;
  homeroomTeacher: Teacher | null;
  subjectTeachers: { subject: string; teacherName: string; phone?: string; periods: number }[];
  timetableData: TimetableData | null;
  schoolInfo?: Partial<SchoolInfo>;
}): string {
  const { classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo } = params;
  const schoolName = schoolInfo?.schoolName || 'TRƯỜNG THPT CHUYÊN SỐ 1';
  const academicYear = timetableData?.academicYear || schoolInfo?.academicYear || '2024 - 2025';
  const semester = timetableData?.semester || schoolInfo?.semester || 'Học kỳ I';
  const { grid, maxPeriod } = getClassTimetableGrid(classItem.id, timetableData);

  const days = [
    { day: 2, label: 'Thứ 2' },
    { day: 3, label: 'Thứ 3' },
    { day: 4, label: 'Thứ 4' },
    { day: 5, label: 'Thứ 5' },
    { day: 6, label: 'Thứ 6' },
    { day: 7, label: 'Thứ 7' },
  ];

  let timetableRowsHtml = '';
  for (let p = 1; p <= maxPeriod; p++) {
    const isAfternoonStart = p === 6;
    if (isAfternoonStart) {
      timetableRowsHtml += `
        <tr>
          <td colspan="7" style="background-color: #f1f5f9; padding: 6px 12px; font-weight: bold; font-size: 11px; text-transform: uppercase; color: #475569; text-align: left; border: 1px solid #cbd5e1;">
            Buổi Chiều
          </td>
        </tr>
      `;
    }

    timetableRowsHtml += `<tr>`;
    timetableRowsHtml += `<td style="background-color: #f8fafc; font-weight: 600; text-align: center; padding: 8px 4px; border: 1px solid #cbd5e1; font-size: 12px; color: #334155;">Tiết ${p > 5 ? p - 5 + ' (C)' : p}</td>`;

    days.forEach(d => {
      const lesson = grid[p]?.[d.day];
      if (lesson) {
        const isSpecial = lesson.isFixed || lesson.subject === 'Chào cờ' || lesson.subject === 'Sinh hoạt lớp';
        const bg = isSpecial ? '#fef3c7' : '#f0fdf4';
        const textColor = isSpecial ? '#92400e' : '#166534';

        timetableRowsHtml += `
          <td style="background-color: ${bg}; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center; vertical-align: middle;">
            <div style="font-weight: 700; color: ${textColor}; font-size: 13px;">${lesson.subject}</div>
            <div style="font-size: 11px; color: #475569; margin-top: 2px;">${lesson.teacherName || 'GVBM'}</div>
          </td>
        `;
      } else {
        timetableRowsHtml += `
          <td style="background-color: #ffffff; border: 1px solid #e2e8f0; padding: 6px 4px; text-align: center; color: #cbd5e1; font-size: 11px;">
            -
          </td>
        `;
      }
    });

    timetableRowsHtml += `</tr>`;
  }

  // Danh sách Giáo viên bộ môn
  const teacherRowsHtml = subjectTeachers.map((st, idx) => `
    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px; color: #64748b;">${idx + 1}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600; font-size: 13px; color: #1e293b;">${st.subject}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; font-size: 13px; color: #0f172a;">${st.teacherName}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px; color: #2563eb;">${st.periods} tiết</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 13px; color: #64748b; text-align: center;">${st.phone || '-'}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thời khóa biểu Lớp ${classItem.name}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px 10px; color: #1e293b; line-height: 1.5;">
  <div style="max-width: 720px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    
    <!-- HEADER -->
    <div style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 28px 24px; color: #ffffff; text-align: center;">
      <div style="font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">
        ${schoolName}
      </div>
      <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.3px;">
        THỜI KHÓA BIỂU HỌC TẬP - LỚP ${classItem.name}
      </h1>
      <div style="margin-top: 6px; font-size: 13px; opacity: 0.95; font-weight: 500;">
        ${semester} • Năm học ${academicYear}
      </div>
    </div>

    <!-- HOMEROOM TEACHER CARD -->
    <div style="padding: 20px 24px; border-bottom: 1px solid #f1f5f9; background-color: #f0fdf4;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
        <div>
          <div style="font-size: 12px; color: #166534; font-weight: 600; text-transform: uppercase;">Giáo viên Chủ nhiệm Lớp:</div>
          <div style="font-size: 18px; font-weight: 800; color: #14532d; margin-top: 2px;">
            ${homeroomTeacher ? homeroomTeacher.name : 'Chưa phân công'}
          </div>
          <div style="font-size: 13px; color: #365314; margin-top: 2px;">
            ${homeroomTeacher?.phone ? `📞 Số điện thoại: <strong>${homeroomTeacher.phone}</strong>` : ''}
            ${homeroomTeacher?.email ? ` • ✉️ Email: ${homeroomTeacher.email}` : ''}
          </div>
        </div>
        <div style="margin-top: 10px; background: #ffffff; padding: 8px 14px; border-radius: 8px; border: 1px solid #bbf7d0; text-align: right;">
          <div style="font-size: 11px; color: #166534; font-weight: 600;">Khối lớp: <strong>Khối ${classItem.grade}</strong></div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Sĩ số & Danh mục môn: ${subjectTeachers.length} môn</div>
        </div>
      </div>
    </div>

    <!-- MAIN BODY -->
    <div style="padding: 24px;">

      <!-- LƯỚI TKB -->
      <div style="margin-bottom: 28px;">
        <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #1e293b;">
          📅 Lịch học trong tuần (Thứ 2 - Thứ 7)
        </h2>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: center; border: 1px solid #cbd5e1;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #334155;">
                <th style="padding: 10px 4px; border: 1px solid #cbd5e1; width: 64px; font-size: 12px; font-weight: 700;">Tiết</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 2</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 3</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 4</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 5</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 6</th>
                <th style="padding: 10px 6px; border: 1px solid #cbd5e1; font-weight: 700;">Thứ 7</th>
              </tr>
            </thead>
            <tbody>
              ${timetableRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- DANH SÁCH GIÁO VIÊN BỘ MÔN -->
      <div>
        <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #1e293b;">
          👥 Danh sách Thầy/Cô Giáo viên Bộ môn
        </h2>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background-color: #f8fafc; color: #475569;">
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; width: 44px; text-align: center;">STT</th>
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left;">Môn học</th>
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left;">Giáo viên giảng dạy</th>
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">Số tiết</th>
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">Điện thoại liên hệ</th>
              </tr>
            </thead>
            <tbody>
              ${teacherRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- FOOTER -->
    <div style="background-color: #f8fafc; padding: 20px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
      <div style="font-weight: 600; color: #334155;">BAN GIÁM HIỆU & GIÁO VIÊN CHỦ NHIỆM</div>
      <div style="margin-top: 4px;">Kính chúc các em học sinh một học kỳ học tập chăm chỉ và đạt thành tích cao!</div>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/**
 * Tạo nội dung Plain Text gửi Lớp / Phụ huynh qua Zalo
 */
export function generateClassPlainText(params: {
  classItem: ClassModel;
  homeroomTeacher: Teacher | null;
  subjectTeachers: { subject: string; teacherName: string; phone?: string; periods: number }[];
  timetableData: TimetableData | null;
  schoolInfo?: Partial<SchoolInfo>;
}): string {
  const { classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo } = params;
  const schoolName = schoolInfo?.schoolName || 'TRƯỜNG THPT';
  const academicYear = timetableData?.academicYear || '2024 - 2025';
  const semester = timetableData?.semester || 'Học kỳ I';
  const { grid, maxPeriod } = getClassTimetableGrid(classItem.id, timetableData);

  let text = `📢 THỜI KHÓA BIỂU HỌC TẬP - LỚP ${classItem.name}\n`;
  text += `🏫 ${schoolName}\n`;
  text += `📌 ${semester} - Năm học ${academicYear}\n\n`;
  text += `• GVCN: ${homeroomTeacher ? homeroomTeacher.name : 'Chưa phân công'}`;
  if (homeroomTeacher?.phone) text += ` (SĐT: ${homeroomTeacher.phone})`;
  text += `\n\n📅 THỜI KHÓA BIỂU TRONG TUẦN:\n`;

  const days = [
    { day: 2, label: 'Thứ 2' },
    { day: 3, label: 'Thứ 3' },
    { day: 4, label: 'Thứ 4' },
    { day: 5, label: 'Thứ 5' },
    { day: 6, label: 'Thứ 6' },
    { day: 7, label: 'Thứ 7' },
  ];

  let hasLessons = false;
  days.forEach(d => {
    const dayLessons: string[] = [];
    for (let p = 1; p <= maxPeriod; p++) {
      const lesson = grid[p]?.[d.day];
      if (lesson) {
        dayLessons.push(`T${p > 5 ? p - 5 + '(C)' : p}: ${lesson.subject}`);
      }
    }
    if (dayLessons.length > 0) {
      hasLessons = true;
      text += `• ${d.label}: ${dayLessons.join(' | ')}\n`;
    }
  });

  if (!hasLessons) {
    text += `(Chưa có tiết trên lưới TKB)\n`;
  }

  text += `\nKính chúc các em học sinh học tập tốt và rèn luyện chăm chỉ!`;
  return text;
}
