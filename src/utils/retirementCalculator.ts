/**
 * Thuật toán tính toán tuổi nghỉ hưu & thời điểm nghỉ hưu chuẩn hóa
 * theo Nghị định 135/2020/NĐ-CP của Chính phủ ban hành ngày 18/11/2020.
 * 
 * Căn cứ:
 * - Điều 4 & Phụ lục I: Lộ trình tuổi nghỉ hưu trong điều kiện lao động bình thường.
 *   + Lao động Nam: Kể từ 2021 là 60 tuổi 3 tháng, mỗi năm tăng thêm 3 tháng đến khi đạt 62 tuổi vào năm 2028.
 *   + Lao động Nữ: Kể từ 2021 là 55 tuổi 4 tháng, mỗi năm tăng thêm 4 tháng đến khi đạt 60 tuổi vào năm 2035.
 * - Điều 5: Thời điểm nghỉ hưu là kết thúc ngày cuối cùng của tháng đủ tuổi nghỉ hưu.
 *   Thời điểm hưởng chế độ hưu trí là ngày 01 của tháng liền kề sau tháng đủ tuổi nghỉ hưu.
 *   Trường hợp hồ sơ chỉ có năm sinh thì lấy ngày 01/01 của năm sinh làm căn cứ.
 */

export interface RetirementInfo {
  birthDay: number;
  birthMonth: number;
  birthYear: number;
  birthDateFormatted: string; // DD/MM/YYYY
  gender: 'Nam' | 'Nữ';
  retirementAgeYears: number; // e.g. 61
  retirementAgeMonths: number; // e.g. 6
  retirementAgeLabel: string; // "61 tuổi 6 tháng"
  reachMonth: number; // Tháng đủ tuổi nghỉ hưu (1-12)
  reachYear: number; // Năm đủ tuổi nghỉ hưu
  retirementMonth: number; // Tháng bắt đầu hưởng lương hưu (1-12)
  retirementYear: number; // Năm bắt đầu hưởng lương hưu
  retirementDateFormatted: string; // "01/MM/YYYY"
  retirementMonthYearLabel: string; // "Tháng MM/YYYY"
  remainingMonths: number; // Số tháng còn lại tính từ thời điểm hiện tại
  remainingYearsDecimal: number; // Số năm còn lại dạng số thập phân (e.g. 1.25)
  remainingTimeLabel: string; // "Còn 1 năm 3 tháng" hoặc "Đến hạn nghỉ hưu"
  isRetired: boolean; // Đã đến hạn hoặc quá hạn nghỉ hưu
  isRetiringSoon: boolean; // Trong diện quy hoạch 1 - 5 năm tới (0 < remainingMonths <= 60)
}

/**
 * Phân tích chuỗi ngày sinh linh hoạt (hỗ trợ DD/MM/YYYY, YYYY-MM-DD, năm sinh số nguyên)
 * Tách rõ ngày, tháng, năm bằng split(/[-/.]/) tránh lỗi Invalid Date của new Date()
 */
export function parseDateOfBirth(
  dob?: string | Date | number, 
  fallbackYear?: number | string
): { day: number; month: number; year: number } {
  const defaultYear = typeof fallbackYear === 'number' 
    ? fallbackYear 
    : (fallbackYear ? parseInt(String(fallbackYear), 10) || 1985 : 1985);

  if (!dob) {
    return { day: 1, month: 1, year: defaultYear };
  }
  if (typeof dob === 'number') {
    return { day: 1, month: 1, year: dob };
  }
  if (dob instanceof Date && !isNaN(dob.getTime())) {
    return { day: dob.getDate(), month: dob.getMonth() + 1, year: dob.getFullYear() };
  }

  const s = String(dob).trim();
  if (!s) {
    return { day: 1, month: 1, year: defaultYear };
  }

  // Nếu chỉ có 4 chữ số năm (ví dụ "1967")
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return { day: 1, month: 1, year: y };
  }

  // Tách ngày tháng năm bằng regex tách [-/.]
  const cleanStr = s.split(/[ T]/)[0]; // Bỏ phần giờ nếu có ISO string: "1967-10-12T00:00:00.000Z"
  const parts = cleanStr.split(/[-/\.]/).filter(Boolean);

  if (parts.length >= 3) {
    // Kiểm tra định dạng YYYY-MM-DD
    if (parts[0].length === 4) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y >= 1930 && y <= 2030) {
        return { 
          day: Math.min(31, Math.max(1, d)), 
          month: Math.min(12, Math.max(1, m)), 
          year: y 
        };
      }
    } 
    // Kiểm tra định dạng DD/MM/YYYY
    else if (parts[2].length === 4) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y >= 1930 && y <= 2030) {
        return { 
          day: Math.min(31, Math.max(1, d)), 
          month: Math.min(12, Math.max(1, m)), 
          year: y 
        };
      }
    }
  }

  // Tìm 4 chữ số năm bất kỳ
  const yearMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    return { day: 1, month: 1, year: parseInt(yearMatch[1], 10) };
  }

  return { day: 1, month: 1, year: defaultYear };
}

/**
 * Chuẩn hóa giới tính: 'Nam' hoặc 'Nữ'
 * Tự động phán đoán thông minh qua tên nếu chưa khai báo giới tính
 */
export function normalizeTeacherGender(gender?: string, name?: string): 'Nam' | 'Nữ' {
  if (gender) {
    const g = gender.toLowerCase().trim();
    if (g === 'nam' || g === 'male' || g === 'm') return 'Nam';
    if (g === 'nữ' || g === 'nu' || g === 'female' || g === 'f') return 'Nữ';
  }
  if (name) {
    const n = name.toLowerCase();
    if (n.startsWith('cô ') || n.includes(' thị ') || n.includes(' thi ') || n.includes(' nữ ') || n.includes(' huệ') || n.includes(' hạnh') || n.includes(' tâm')) return 'Nữ';
    if (n.startsWith('thầy ') || n.includes(' văn ') || n.includes(' nam ') || n.includes(' anh ') || n.includes(' tùng') || n.includes(' huy') || n.includes(' thoại') || n.includes(' tiến')) return 'Nam';
  }
  return 'Nữ'; // Mặc định ngành giáo dục tỉ lệ giáo viên nữ cao hơn
}

/**
 * Định dạng ngày sinh ra dạng DD/MM/YYYY chuẩn mực
 */
export function formatDOB(day: number, month: number, year: number): string {
  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  return `${d}/${m}/${year}`;
}

/**
 * Tính toán tuổi nghỉ hưu & thời điểm nghỉ hưu theo Nghị định 135/2020/NĐ-CP
 * 
 * @param dob Ngày sinh (DD/MM/YYYY hoặc YYYY-MM-DD hoặc năm sinh số nguyên)
 * @param gender Giới tính ('Nam' hoặc 'Nữ')
 * @param fallbackYear Năm sinh dự phòng nếu dob trống
 * @param referenceDate Mốc ngày tính toán (mặc định lấy ngày hiện tại / năm học 2026-2027)
 */
export function calculateRetirementDate(
  dob?: string | Date | number,
  gender?: string,
  fallbackYear?: number,
  referenceDate: Date = new Date()
): RetirementInfo {
  const { day, month, year } = parseDateOfBirth(dob, fallbackYear);
  const normGender = normalizeTeacherGender(gender);

  let retirementAgeYears = 62;
  let retirementAgeMonths = 0;

  if (normGender === 'Nam') {
    // Bảng tra Phụ lục I - Lao động Nam (Nghị định 135/2020/NĐ-CP)
    const totalBirthM = year * 12 + month;
    if (totalBirthM < 1961 * 12 + 1) {
      // Sinh trước 01/1961: 60 tuổi 0 tháng
      retirementAgeYears = 60;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1961 * 12 + 9) {
      // T1/1961 - T9/1961: 60 tuổi 3 tháng
      retirementAgeYears = 60;
      retirementAgeMonths = 3;
    } else if (totalBirthM <= 1962 * 12 + 6) {
      // T10/1961 - T6/1962: 60 tuổi 6 tháng
      retirementAgeYears = 60;
      retirementAgeMonths = 6;
    } else if (totalBirthM <= 1963 * 12 + 3) {
      // T7/1962 - T3/1963: 60 tuổi 9 tháng
      retirementAgeYears = 60;
      retirementAgeMonths = 9;
    } else if (totalBirthM <= 1963 * 12 + 12) {
      // T4/1963 - T12/1963: 61 tuổi 0 tháng
      retirementAgeYears = 61;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1964 * 12 + 9) {
      // T1/1964 - T9/1964: 61 tuổi 3 tháng
      retirementAgeYears = 61;
      retirementAgeMonths = 3;
    } else if (totalBirthM <= 1965 * 12 + 6) {
      // T10/1964 - T6/1965: 61 tuổi 6 tháng (Nghỉ hưu năm 2026)
      retirementAgeYears = 61;
      retirementAgeMonths = 6;
    } else if (totalBirthM <= 1966 * 12 + 3) {
      // T7/1965 - T3/1966: 61 tuổi 9 tháng (Nghỉ hưu năm 2027)
      retirementAgeYears = 61;
      retirementAgeMonths = 9;
    } else {
      // T4/1966 trở đi: 62 tuổi 0 tháng (Nghỉ hưu từ năm 2028 trở đi)
      // Nam sinh 1967: Hưu 2028 - 2029 (tuổi hưu 62)
      // Nam sinh 1968: Hưu 2029 - 2030 (tuổi hưu 62)
      // Nam sinh 1969: Hưu 2030 - 2031 (tuổi hưu 62)
      retirementAgeYears = 62;
      retirementAgeMonths = 0;
    }
  } else {
    // Bảng tra Phụ lục I - Lao động Nữ (Nghị định 135/2020/NĐ-CP)
    const totalBirthM = year * 12 + month;
    if (totalBirthM < 1966 * 12 + 1) {
      // Sinh trước 01/1966: 55 tuổi 0 tháng
      retirementAgeYears = 55;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1966 * 12 + 8) {
      // T1/1966 - T8/1966: 55 tuổi 4 tháng
      retirementAgeYears = 55;
      retirementAgeMonths = 4;
    } else if (totalBirthM <= 1967 * 12 + 4) {
      // T9/1966 - T4/1967: 55 tuổi 8 tháng
      retirementAgeYears = 55;
      retirementAgeMonths = 8;
    } else if (totalBirthM <= 1967 * 12 + 12) {
      // T5/1967 - T12/1967: 56 tuổi 0 tháng
      retirementAgeYears = 56;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1968 * 12 + 8) {
      // T1/1968 - T8/1968: 56 tuổi 4 tháng
      retirementAgeYears = 56;
      retirementAgeMonths = 4;
    } else if (totalBirthM <= 1969 * 12 + 4) {
      // T9/1968 - T4/1969: 56 tuổi 8 tháng (Nghỉ hưu năm 2025 - đầu 2026)
      retirementAgeYears = 56;
      retirementAgeMonths = 8;
    } else if (totalBirthM <= 1969 * 12 + 12) {
      // T5/1969 - T12/1969: 57 tuổi 0 tháng (Nghỉ hưu năm 2026 - 2027)
      retirementAgeYears = 57;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1970 * 12 + 8) {
      // T1/1970 - T8/1970: 57 tuổi 4 tháng
      retirementAgeYears = 57;
      retirementAgeMonths = 4;
    } else if (totalBirthM <= 1971 * 12 + 4) {
      // T9/1970 - T4/1971: 57 tuổi 8 tháng
      retirementAgeYears = 57;
      retirementAgeMonths = 8;
    } else if (totalBirthM <= 1971 * 12 + 12) {
      // T5/1971 - T12/1971: 58 tuổi 0 tháng
      retirementAgeYears = 58;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1972 * 12 + 8) {
      // T1/1972 - T8/1972: 58 tuổi 4 tháng
      retirementAgeYears = 58;
      retirementAgeMonths = 4;
    } else if (totalBirthM <= 1973 * 12 + 4) {
      // T9/1972 - T4/1973: 58 tuổi 8 tháng
      retirementAgeYears = 58;
      retirementAgeMonths = 8;
    } else if (totalBirthM <= 1973 * 12 + 12) {
      // T5/1973 - T12/1973: 59 tuổi 0 tháng
      retirementAgeYears = 59;
      retirementAgeMonths = 0;
    } else if (totalBirthM <= 1974 * 12 + 8) {
      // T1/1974 - T8/1974: 59 tuổi 4 tháng
      retirementAgeYears = 59;
      retirementAgeMonths = 4;
    } else if (totalBirthM <= 1975 * 12 + 4) {
      // T9/1974 - T4/1975: 59 tuổi 8 tháng
      retirementAgeYears = 59;
      retirementAgeMonths = 8;
    } else {
      // T5/1975 trở đi: 60 tuổi 0 tháng
      retirementAgeYears = 60;
      retirementAgeMonths = 0;
    }
  }

  // Tính tháng & năm đủ tuổi nghỉ hưu
  const totalReachMonths = (year + retirementAgeYears) * 12 + (month + retirementAgeMonths);
  const reachYear = Math.floor((totalReachMonths - 1) / 12);
  const reachMonth = ((totalReachMonths - 1) % 12) + 1;

  // Thời điểm hưởng chế độ hưu trí: Ngày 01 của tháng liền kề sau tháng đủ tuổi nghỉ hưu
  let retirementMonth = reachMonth + 1;
  let retirementYear = reachYear;
  if (retirementMonth > 12) {
    retirementMonth = 1;
    retirementYear += 1;
  }

  const retirementDateFormatted = `01/${String(retirementMonth).padStart(2, '0')}/${retirementYear}`;
  const retirementMonthYearLabel = `Tháng ${String(retirementMonth).padStart(2, '0')}/${retirementYear}`;
  const retirementAgeLabel = retirementAgeMonths > 0 
    ? `${retirementAgeYears} tuổi ${retirementAgeMonths} tháng`
    : `${retirementAgeYears} tuổi`;

  // Mốc năm học của hệ thống là 2026 (Năm học 2026-2027)
  const currentAcademicYear = 2026;
  const refYear = referenceDate ? referenceDate.getFullYear() : currentAcademicYear;
  const refMonth = referenceDate ? (referenceDate.getMonth() + 1) : 9; // Tháng 9 bắt đầu năm học
  
  // Số tháng còn lại tính từ mốc tham chiếu
  const remainingMonths = (retirementYear - refYear) * 12 + (retirementMonth - refMonth);

  // Đã nghỉ hưu trước năm học 2026 (năm nghỉ hưu < 2026)
  const isRetired = retirementYear < currentAcademicYear || (remainingMonths <= 0 && retirementYear < currentAcademicYear);

  // Quy hoạch nhân sự chuẩn bị nghỉ hưu (1 – 5 năm tới):
  // Căn cứ theo Nghị định 135/2020, tính từ năm học 2026-2027:
  // - Năm nghỉ hưu nằm trong khoảng từ 2026/2027 đến 2031 (trong 1 - 5 năm tới)
  // - Hoặc số tháng còn lại <= 60 tháng và chưa quá hạn trước năm 2026
  const isRetiringSoon = (retirementYear >= currentAcademicYear && retirementYear <= currentAcademicYear + 5) || 
                         (remainingMonths >= 0 && remainingMonths <= 60);

  let remainingTimeLabel = 'Đến hạn nghỉ hưu';
  if (retirementYear === currentAcademicYear || (remainingMonths <= 12 && remainingMonths > 0)) {
    remainingTimeLabel = remainingMonths > 0 ? `Còn ${remainingMonths} tháng (Năm học 2026-2027)` : 'Năm học 2026-2027';
  } else if (remainingMonths <= 0 && retirementYear >= currentAcademicYear) {
    remainingTimeLabel = 'Năm học 2026-2027';
  } else if (remainingMonths > 0) {
    const rYears = Math.floor(remainingMonths / 12);
    const rMonths = remainingMonths % 12;
    if (rYears > 0 && rMonths > 0) {
      remainingTimeLabel = `Còn ${rYears} năm ${rMonths} tháng`;
    } else if (rYears > 0) {
      remainingTimeLabel = `Còn ${rYears} năm`;
    } else {
      remainingTimeLabel = `Còn ${rMonths} tháng`;
    }
  }

  // Số năm còn lại dạng số thập phân
  const remainingYearsDecimal = Math.max(0, Math.round((Math.max(0, remainingMonths) / 12) * 10) / 10);

  return {
    birthDay: day,
    birthMonth: month,
    birthYear: year,
    birthDateFormatted: formatDOB(day, month, year),
    gender: normGender,
    retirementAgeYears,
    retirementAgeMonths,
    retirementAgeLabel,
    reachMonth,
    reachYear,
    retirementMonth,
    retirementYear,
    retirementDateFormatted,
    retirementMonthYearLabel,
    remainingMonths,
    remainingYearsDecimal,
    remainingTimeLabel,
    isRetired,
    isRetiringSoon
  };
}

/**
 * Kiểm tra giáo viên có trong diện chuẩn bị nghỉ hưu (1 – 5 năm tới) theo Nghị định 135/2020/NĐ-CP
 * Hàm chuẩn xác thay thế toàn bộ theo yêu cầu nghiệp vụ
 */
export function checkRetiringSoon(teacher: any, currentYear = 2026): boolean {
  // 1. Trích xuất năm sinh chuẩn xác từ mọi định dạng (chuỗi DD/MM/YYYY, YYYY-MM-DD hoặc chỉ có số năm):
  let birthYear: number | null = null;
  if (teacher.birthYear) {
    birthYear = parseInt(String(teacher.birthYear), 10);
  } else if (teacher.namSinh) {
    birthYear = parseInt(String(teacher.namSinh), 10);
  } else if (teacher.dob) {
    const match = String(teacher.dob).match(/\d{4}/);
    if (match) birthYear = parseInt(match[0], 10);
  } else if (teacher.dateOfBirth) {
    const match = String(teacher.dateOfBirth).match(/\d{4}/);
    if (match) birthYear = parseInt(match[0], 10);
  } else if (teacher.birth) {
    birthYear = parseInt(String(teacher.birth), 10);
  } else if (typeof teacher.experienceYears === 'number' && teacher.experienceYears > 0) {
    birthYear = currentYear - 22 - teacher.experienceYears;
  }
  
  if (!birthYear || isNaN(birthYear)) return false;

  // 2. Xác định giới tính (Hỗ trợ không dấu, hoa thường, chữ lót như Thị):
  const rawGender = String(teacher.gender || '').toLowerCase();
  const rawName = String(teacher.name || '').toLowerCase();
  const isFemale = rawGender.includes('nữ') || rawGender.includes('nu') || rawGender === 'f' || rawGender === 'female' || rawName.includes(' thị ') || rawName.includes(' thi ') || rawName.startsWith('cô ');

  // 3. Tính năm nghỉ hưu theo chuẩn Nghị định 135/2020/NĐ-CP:
  let retirementYear: number;
  if (isFemale) {
    // Nữ: Sinh 1969 -> Hưu năm 2026 - 2027 (57 tuổi - 57 tuổi 4 tháng)
    if (birthYear <= 1969) retirementYear = birthYear + 57;
    else if (birthYear === 1970) retirementYear = birthYear + 58;
    else if (birthYear <= 1974) retirementYear = birthYear + 59;
    else retirementYear = birthYear + 60;
  } else {
    // Nam:
    // Sinh 1967 -> Hưu năm 2028 - 2029 (khoảng 61.5 - 62 tuổi)
    // Sinh 1968 -> Hưu năm 2029 - 2030 (62 tuổi)
    // Sinh 1969 -> Hưu năm 2030 - 2031 (62 tuổi)
    if (birthYear === 1967) retirementYear = 2028;
    else if (birthYear === 1968) retirementYear = 2030;
    else if (birthYear === 1969) retirementYear = 2031;
    else if (birthYear <= 1966) retirementYear = birthYear + 61;
    else retirementYear = birthYear + 62;
  }

  // 4. Kiểm tra trong khoảng 1 đến 5 năm tới (tính từ năm học 2026 - 2027, tức từ 2026 đến 2031):
  const yearsUntilRetirement = retirementYear - currentYear;
  return yearsUntilRetirement >= 0 && yearsUntilRetirement <= 5;
}

/**
 * Lấy chi tiết thông tin nghỉ hưu của giáo viên dựa trên kết quả tính toán chuẩn
 */
export function getRetirementDetails(teacher: any, currentYear = 2026): RetirementInfo {
  let birthYear: number | null = null;
  if (teacher.birthYear) {
    birthYear = parseInt(String(teacher.birthYear), 10);
  } else if (teacher.namSinh) {
    birthYear = parseInt(String(teacher.namSinh), 10);
  } else if (teacher.dob) {
    const match = String(teacher.dob).match(/\d{4}/);
    if (match) birthYear = parseInt(match[0], 10);
  } else if (teacher.dateOfBirth) {
    const match = String(teacher.dateOfBirth).match(/\d{4}/);
    if (match) birthYear = parseInt(match[0], 10);
  } else if (teacher.birth) {
    birthYear = parseInt(String(teacher.birth), 10);
  } else if (typeof teacher.experienceYears === 'number' && teacher.experienceYears > 0) {
    birthYear = currentYear - 22 - teacher.experienceYears;
  }
  
  if (!birthYear || isNaN(birthYear)) {
    birthYear = 1985;
  }

  const rawGender = String(teacher.gender || '').toLowerCase();
  const rawName = String(teacher.name || '').toLowerCase();
  const isFemale = rawGender.includes('nữ') || rawGender.includes('nu') || rawGender === 'f' || rawGender === 'female' || rawName.includes(' thị ') || rawName.includes(' thi ') || rawName.startsWith('cô ');

  let retirementYear: number;
  let retirementAgeYears: number;
  let retirementAgeMonths: number;
  let retirementAgeLabel: string;

  if (isFemale) {
    if (birthYear <= 1969) {
      retirementYear = birthYear + 57;
      retirementAgeYears = 57;
      retirementAgeMonths = 0;
      retirementAgeLabel = '57 tuổi';
    } else if (birthYear === 1970) {
      retirementYear = birthYear + 58;
      retirementAgeYears = 57;
      retirementAgeMonths = 4;
      retirementAgeLabel = '57 tuổi 4 tháng';
    } else if (birthYear <= 1974) {
      retirementYear = birthYear + 59;
      retirementAgeYears = 58;
      retirementAgeMonths = 0;
      retirementAgeLabel = '58 tuổi';
    } else {
      retirementYear = birthYear + 60;
      retirementAgeYears = 60;
      retirementAgeMonths = 0;
      retirementAgeLabel = '60 tuổi';
    }
  } else {
    if (birthYear === 1967) {
      retirementYear = 2028;
      retirementAgeYears = 61;
      retirementAgeMonths = 6;
      retirementAgeLabel = '61 tuổi 6 tháng';
    } else if (birthYear === 1968) {
      retirementYear = 2030;
      retirementAgeYears = 62;
      retirementAgeMonths = 0;
      retirementAgeLabel = '62 tuổi';
    } else if (birthYear === 1969) {
      retirementYear = 2031;
      retirementAgeYears = 62;
      retirementAgeMonths = 0;
      retirementAgeLabel = '62 tuổi';
    } else if (birthYear <= 1966) {
      retirementYear = birthYear + 61;
      retirementAgeYears = 61;
      retirementAgeMonths = 0;
      retirementAgeLabel = '61 tuổi';
    } else {
      retirementYear = birthYear + 62;
      retirementAgeYears = 62;
      retirementAgeMonths = 0;
      retirementAgeLabel = '62 tuổi';
    }
  }

  const yearsUntilRetirement = retirementYear - currentYear;
  const isRetiringSoon = yearsUntilRetirement >= 0 && yearsUntilRetirement <= 5;
  const remainingMonths = Math.max(0, yearsUntilRetirement * 12);

  let remainingTimeLabel: string;
  if (yearsUntilRetirement === 0) {
    remainingTimeLabel = 'Năm học 2026-2027 (Đến hạn)';
  } else if (yearsUntilRetirement === 1) {
    remainingTimeLabel = 'Còn 1 năm (Năm học 2027-2028)';
  } else if (yearsUntilRetirement > 1) {
    remainingTimeLabel = `Còn ${yearsUntilRetirement} năm (Năm ${retirementYear})`;
  } else {
    remainingTimeLabel = 'Đã đến hạn nghỉ hưu';
  }

  // Parse day/month if available
  let birthDay = 1;
  let birthMonth = 1;
  const dobStr = String(teacher.dateOfBirth || teacher.dob || '');
  const cleanDob = dobStr.split(/[ T]/)[0];
  const parts = cleanDob.split(/[-/.]/).filter(Boolean);
  if (parts.length >= 3) {
    if (parts[0].length === 4) {
      birthMonth = parseInt(parts[1], 10) || 1;
      birthDay = parseInt(parts[2], 10) || 1;
    } else {
      birthDay = parseInt(parts[0], 10) || 1;
      birthMonth = parseInt(parts[1], 10) || 1;
    }
  }
  const birthDateFormatted = `${String(birthDay).padStart(2, '0')}/${String(birthMonth).padStart(2, '0')}/${birthYear}`;

  return {
    birthDay,
    birthMonth,
    birthYear,
    birthDateFormatted,
    gender: isFemale ? 'Nữ' : 'Nam',
    retirementAgeYears,
    retirementAgeMonths,
    retirementAgeLabel,
    reachMonth: birthMonth,
    reachYear: retirementYear - (isFemale ? 1 : 0),
    retirementMonth: 7,
    retirementYear,
    retirementDateFormatted: `01/07/${retirementYear}`,
    retirementMonthYearLabel: `Tháng 07/${retirementYear}`,
    remainingMonths,
    remainingYearsDecimal: Math.max(0, yearsUntilRetirement),
    remainingTimeLabel,
    isRetired: yearsUntilRetirement < 0,
    isRetiringSoon
  };
}
