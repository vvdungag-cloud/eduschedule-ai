import { 
  collection, doc, getDoc, setDoc, deleteDoc, 
  onSnapshot, getDocs, Unsubscribe, serverTimestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { UserAccount } from './authContext';

export type CloudConnectionStatus = 'connected' | 'syncing' | 'error' | 'offline';

export interface SchoolTenant {
  id: string;
  name: string;
  departmentName: string;
  updatedAt?: string;
}

export const DEFAULT_SCHOOL_ID = 'thpt-nguyen-binh-khiem';
export const DEFAULT_SCHOOL_NAME = 'TRƯỜNG THPT NGUYỄN BỈNH KHIÊM';
export const DEFAULT_DEPARTMENT_NAME = 'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG';

/**
 * 1. ĐƯỜNG DẪN LƯU TRỮ CỐ ĐỊNH CHUẨN TRÊN FIRESTORE
 * Document chuẩn: schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1
 * Kèm document fallback: eduschedule_data/thpt_nguyen_binh_khiem
 */
export const TARGET_SCHOOL_ID = 'thpt-nguyen-binh-khiem';
export const TARGET_TERM_KEY = '2026___2027_HK1';
export const TARGET_TERM_DOC_REF = doc(db, 'schools', TARGET_SCHOOL_ID, 'terms', TARGET_TERM_KEY);
export const SCHOOL_DOC_REF = doc(db, 'eduschedule_data', 'thpt_nguyen_binh_khiem');
export const PARENT_SCHOOL_DOC_REF = doc(db, 'schools', TARGET_SCHOOL_ID);

/**
 * Làm sạch dữ liệu đệ quy (sanitize/clean object) trước khi gọi setDoc()
 * để loại bỏ hoàn toàn mọi giá trị undefined trong toàn bộ object, mảng và lồng nhau
 */
export function removeUndefinedFields(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  // Bảo lưu Date instances
  if (obj instanceof Date) {
    return obj;
  }
  // Bảo lưu Firestore FieldValue (như serverTimestamp(), arrayUnion(), deleteField())
  if (typeof obj.isEqual === 'function' || obj._methodName) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => item === undefined ? null : removeUndefinedFields(item));
  }
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefinedFields(v)])
  );
}

/**
 * Chuẩn hóa và làm sạch cấu hình số tiết classSubjectPeriods:
 * Đảm bảo trường maxPeriodsPerSession luôn là null hoặc number, tuyệt đối không mang undefined
 */
export function sanitizeClassSubjectPeriods(csp: any): Record<string, Record<string, any>> {
  if (!csp || typeof csp !== 'object') return {};
  const cleaned: Record<string, Record<string, any>> = {};
  for (const [classKey, subjectsObj] of Object.entries(csp)) {
    if (!subjectsObj || typeof subjectsObj !== 'object') continue;
    cleaned[classKey] = {};
    for (const [subKey, val] of Object.entries(subjectsObj as Record<string, any>)) {
      if (typeof val === 'object' && val !== null) {
        const periodObj = val as any;
        cleaned[classKey][subKey] = {
          ...periodObj,
          mainPeriods: periodObj.mainPeriods ?? 0,
          mainMinPairs: periodObj.mainMinPairs ?? 0,
          oppPeriods: periodObj.oppPeriods ?? 0,
          oppMinPairs: periodObj.oppMinPairs ?? 0,
          allowRemainingSameSession: periodObj.allowRemainingSameSession ?? false,
          sameSessionRule: periodObj.sameSessionRule ?? '',
          maxPeriodsPerSession: (periodObj.maxPeriodsPerSession === undefined || periodObj.maxPeriodsPerSession === '' || periodObj.maxPeriodsPerSession === null)
            ? null
            : (isNaN(Number(periodObj.maxPeriodsPerSession)) ? null : Number(periodObj.maxPeriodsPerSession)),
          alternateDays: periodObj.alternateDays ?? false,
          singleSessionOnly: periodObj.singleSessionOnly ?? false,
          isRemoved: !!periodObj.isRemoved
        };
      } else {
        cleaned[classKey][subKey] = val;
      }
    }
  }
  return cleaned;
}

/**
 * Ghi toàn bộ dữ liệu (101 GV, 44 Lớp, Phân công đầy đủ cả homeroomAssignments & subjectAssignments, TKB) lên Firestore
 * Ghi chính xác vào document: "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"
 */
export async function pushSchoolDataToCloud(payload: {
  teachers: any[];
  classes: any[];
  subjects?: any[];
  departments?: any[];
  assignments?: any;
  schedules?: any;
  schoolInfo?: any;
  classSubjectPeriods?: any;
  classShifts?: any;
  academicYear?: string;
  semester?: string;
}): Promise<{ success: boolean; message: string; timestamp: string }> {
  const formattedTime = new Date().toLocaleString('vi-VN');
  try {
    // Đảm bảo đóng gói đầy đủ: homeroomAssignments và subjectAssignments
    let homeroomAssignments = payload.assignments?.homeroomAssignments || {};
    let subjectAssignments = payload.assignments?.subjectAssignments || {};

    // Nếu subjectAssignments bị rỗng trong payload, tra cứu ngay từ localStorage
    if (!subjectAssignments || Object.keys(subjectAssignments).length === 0) {
      try {
        const a3 = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
        if (a3) {
          const p = JSON.parse(a3);
          if (p.subjectAssignments && Object.keys(p.subjectAssignments).length > 0) {
            subjectAssignments = p.subjectAssignments;
            if (!homeroomAssignments || Object.keys(homeroomAssignments).length === 0) {
              homeroomAssignments = p.homeroomAssignments || {};
            }
          }
        }
      } catch {}
    }

    const NEW_SCHOOL_LOGO_ID = 'logo_nbk_an_giang_official_2026';
    const NEW_SCHOOL_LOGO_URL = '/logo_nbk.svg?v=3.0';
    const NEW_SCHOOL_LOGO_TYPE = 'svg_vector_official';

    const schoolInfoToSave = {
      schoolName: payload.schoolInfo?.schoolName || DEFAULT_SCHOOL_NAME,
      departmentName: payload.schoolInfo?.departmentName || DEFAULT_DEPARTMENT_NAME,
      schoolId: TARGET_SCHOOL_ID,
      logoId: NEW_SCHOOL_LOGO_ID,
      logoUrl: NEW_SCHOOL_LOGO_URL,
      logoType: NEW_SCHOOL_LOGO_TYPE,
      address: 'Hoa Long 3, TT. An Châu, Châu Thành, An Giang',
      updatedAt: new Date().toISOString(),
      ...(payload.schoolInfo || {})
    };
    // Luôn ghi đè bằng logo mới với query version chống cache
    schoolInfoToSave.logoId = NEW_SCHOOL_LOGO_ID;
    schoolInfoToSave.logoUrl = NEW_SCHOOL_LOGO_URL;
    schoolInfoToSave.logoType = NEW_SCHOOL_LOGO_TYPE;

    const sanitizedClassSubjectPeriods = sanitizeClassSubjectPeriods(payload.classSubjectPeriods);

    const dataToSave = {
      termKey: TARGET_TERM_KEY,
      academicYear: payload.academicYear || 'Năm học 2026 – 2027',
      semester: payload.semester || 'Học kỳ I',
      teachers: payload.teachers || [],
      classes: payload.classes || [],
      subjects: payload.subjects || [],
      departments: payload.departments || null,
      assignments: {
        homeroomAssignments: { ...homeroomAssignments },
        subjectAssignments: { ...subjectAssignments } // BẮT BUỘC serialize toàn bộ phân công bộ môn hiện tại, tuyệt đối không để rỗng {} hay null
      },
      schedules: payload.schedules || null,
      timetableData: payload.schedules || null,
      classSubjectPeriods: sanitizedClassSubjectPeriods || null,
      classShifts: payload.classShifts || null,
      schoolInfo: schoolInfoToSave,
      lastUpdated: serverTimestamp(),
      lastUpdatedText: formattedTime,
      updatedAt: new Date().toISOString()
    };

    const cleanedData = removeUndefinedFields(dataToSave);

    // 1. Ghi đúng document chuẩn: "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"
    await setDoc(TARGET_TERM_DOC_REF, cleanedData, { merge: true });

    // 2. Ghi song song vào fallback document: "eduschedule_data/thpt_nguyen_binh_khiem"
    await setDoc(SCHOOL_DOC_REF, cleanedData, { merge: true });

    // 3. Cập nhật parent school document "schools/thpt-nguyen-binh-khiem"
    await setDoc(PARENT_SCHOOL_DOC_REF, removeUndefinedFields({
      id: TARGET_SCHOOL_ID,
      name: schoolInfoToSave.schoolName,
      departmentName: schoolInfoToSave.departmentName,
      logoId: NEW_SCHOOL_LOGO_ID,
      logoUrl: NEW_SCHOOL_LOGO_URL,
      logoType: NEW_SCHOOL_LOGO_TYPE,
      currentAcademicYear: dataToSave.academicYear,
      currentSemester: dataToSave.semester,
      updatedAt: new Date().toISOString()
    }), { merge: true });

    const subCount = Object.values(subjectAssignments).reduce(
      (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
    );

    // Cập nhật bộ nhớ đệm in-memory ngay sau khi lưu thành công
    setCachedTermData(TARGET_TERM_KEY, cleanedData);

    return {
      success: true,
      message: `Đã lưu thành công dữ liệu (101 GV, 44 Lớp, ${subCount} phân công môn học, TKB) lên Cloud Firestore lúc ${formattedTime}!`,
      timestamp: formattedTime
    };
  } catch (error: any) {
    console.error('[Firestore] pushSchoolDataToCloud error:', error?.message || error);
    return {
      success: false,
      message: 'Lỗi khi lưu lên Cloud Firestore: ' + (error.message || 'Không thể kết nối'),
      timestamp: formattedTime
    };
  }
}

/**
 * BỘ NHỚ ĐỆM TẠM TRONG PHIÊN LÀM VIỆC (In-Memory Cache):
 * Tránh gửi trùng lặp request lên Firestore nếu dữ liệu đã được tải một lần.
 */
interface CacheEntry {
  data: any;
  cachedAt: number;
}
const termMemoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

export function getCachedTermData(key: string): any | null {
  const entry = termMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    termMemoryCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedTermData(key: string, data: any): void {
  if (!key || !data) return;
  termMemoryCache.set(key, { data, cachedAt: Date.now() });
}

export function invalidateTermCache(key?: string): void {
  if (key) {
    termMemoryCache.delete(key);
  } else {
    termMemoryCache.clear();
  }
}

/**
 * Tải toàn bộ dữ liệu từ document chuẩn "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1" trên Firestore về
 * Có tích hợp bộ nhớ đệm in-memory (In-memory caching) chống trùng lặp request
 */
export async function pullSchoolDataFromCloud(forceRefresh = false): Promise<{
  success: boolean;
  data?: any;
  message: string;
  fromCache?: boolean;
}> {
  try {
    // 1. Kiểm tra bộ nhớ đệm tạm trong phiên làm việc nếu không yêu cầu ép buộc làm mới
    if (!forceRefresh) {
      const cached = getCachedTermData(TARGET_TERM_KEY);
      if (cached) {
        return {
          success: true,
          data: cached,
          message: 'Dữ liệu nạp tức thì từ bộ nhớ đệm phiên làm việc (In-memory cache).',
          fromCache: true
        };
      }
    }

    // 2. Ưu tiên đọc document chuẩn: "schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1"
    let snap = await getDoc(TARGET_TERM_DOC_REF);
    let sourceDoc = 'schools/thpt-nguyen-binh-khiem/terms/2026___2027_HK1';

    // 3. Fallback nếu term doc chưa có dữ liệu, đọc từ document chung "eduschedule_data/thpt_nguyen_binh_khiem"
    if (!snap.exists()) {
      snap = await getDoc(SCHOOL_DOC_REF);
      sourceDoc = 'eduschedule_data/thpt_nguyen_binh_khiem';
    }

    if (snap.exists()) {
      const data = snap.data();
      const updatedTime = data.lastUpdatedText || (data.lastUpdated?.toDate ? data.lastUpdated.toDate().toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN'));
      
      // Lưu vào bộ nhớ đệm tạm
      setCachedTermData(TARGET_TERM_KEY, data);

      return {
        success: true,
        data,
        message: `Đã nạp dữ liệu từ Cloud Firestore (${sourceDoc}) thành công (cập nhật lúc ${updatedTime})!`,
        fromCache: false
      };
    } else {
      return {
        success: false,
        message: 'Chưa tìm thấy dữ liệu trên Cloud Firestore.'
      };
    }
  } catch (error: any) {
    console.error('[Firestore] pullSchoolDataFromCloud error:', error?.message || error);
    return {
      success: false,
      message: 'Lỗi tải từ Cloud Firestore: ' + (error.message || 'Không thể kết nối')
    };
  }
}

/**
 * TẢI LƯỜI / BÓC TÁCH THEO NHU CẦU (Lazy Loading / On-demand Fetching):
 * Chỉ trích xuất hoặc nạp số tiết của ĐÚNG LỚP người dùng đang chọn (ví dụ 11A1)
 */
export function getLazyClassSubjectPeriods(
  classId: string, 
  allPeriodsMap?: Record<string, any>
): Record<string, any> {
  const cleanId = classId.replace(/^c_/, '');
  const prefixedId = 'c_' + cleanId;
  const cacheKey = `class_periods_${classId}`;

  // Kiểm tra cache lớp trước
  const cached = getCachedTermData(cacheKey);
  if (cached) return cached;

  const source = allPeriodsMap || getCachedTermData(TARGET_TERM_KEY)?.classSubjectPeriods || {};
  const classData = source[classId] || source[cleanId] || source[prefixedId] || {};

  setCachedTermData(cacheKey, classData);
  return classData;
}

/**
 * Lắng nghe thay đổi thời gian thực từ Firestore document chuẩn
 */
export function subscribeToSchoolDoc(
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    TARGET_TERM_DOC_REF,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data());
      } else {
        // Fallback đọc từ SCHOOL_DOC_REF nếu TARGET_TERM_DOC_REF chưa có
        getDoc(SCHOOL_DOC_REF).then(altSnap => {
          if (altSnap.exists()) {
            onData(altSnap.data());
          } else {
            onData(null);
          }
        }).catch(() => onData(null));
      }
    },
    (error) => {
      console.warn('[Firestore] Error subscribing to TARGET_TERM_DOC_REF:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Creates a URL-friendly, lowercase slug identifier for a school name
 */
export function slugifySchoolId(name: string): string {
  if (!name || !name.trim()) return DEFAULT_SCHOOL_ID;
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_SCHOOL_ID;
}

/**
 * Real-time listener for school metadata & global settings
 */
export function subscribeToSchool(
  schoolId: string, 
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const schoolRef = doc(db, 'schools', schoolId);
  return onSnapshot(
    schoolRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data());
      } else {
        onData(null);
      }
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to school ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Real-time listener for school accounts list
 */
export function subscribeToAccounts(
  schoolId: string,
  onData: (accounts: UserAccount[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const accountsCol = collection(db, 'schools', schoolId, 'accounts');
  return onSnapshot(
    accountsCol,
    (snapshot) => {
      const accounts: UserAccount[] = [];
      snapshot.forEach((d) => {
        accounts.push({ id: d.id, ...d.data() } as UserAccount);
      });
      onData(accounts);
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to accounts for ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Real-time listener for an academic term's timetable and assignment data
 */
export function subscribeToTerm(
  schoolId: string,
  termKey: string,
  onData: (data: any) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const termRef = doc(db, 'schools', schoolId, 'terms', termKey);
  return onSnapshot(
    termRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data());
      } else {
        onData(null);
      }
    },
    (error) => {
      console.warn(`[Firestore] Error subscribing to term ${termKey} for ${schoolId}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * Fetch all schools currently available in Firestore for multi-tenant switching
 */
export async function fetchAvailableSchools(): Promise<SchoolTenant[]> {
  try {
    const colRef = collection(db, 'schools');
    const snap = await getDocs(colRef);
    const schools: SchoolTenant[] = [];
    snap.forEach((d) => {
      const data = d.data();
      schools.push({
        id: d.id,
        name: data.name || data.schoolName || d.id,
        departmentName: data.departmentName || '',
        updatedAt: data.updatedAt
      });
    });
    return schools;
  } catch (err) {
    console.warn('[Firestore] Error fetching available schools:', err);
    return [];
  }
}

/**
 * Save / Update school tenant metadata in Firestore
 */
export async function saveSchoolToFirestore(
  schoolId: string, 
  schoolData: Record<string, any>, 
  author?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const schoolRef = doc(db, 'schools', schoolId);
    const payload = {
      ...schoolData,
      id: schoolId,
      updatedAt: new Date().toISOString(),
      lastUpdatedBy: author || 'Admin'
    };
    await setDoc(schoolRef, payload, { merge: true });
    return { success: true, message: 'Đã lưu thông tin trường học lên Cloud Firestore!' };
  } catch (error: any) {
    console.error('[Firestore] Error saving school:', error);
    return { success: false, message: error.message || 'Lỗi lưu trường học lên Firestore.' };
  }
}

/**
 * Save user account to school's accounts subcollection
 */
export async function saveAccountToFirestore(
  schoolId: string,
  account: UserAccount
): Promise<{ success: boolean; message: string }> {
  try {
    const accRef = doc(db, 'schools', schoolId, 'accounts', account.id);
    await setDoc(accRef, removeUndefinedFields({
      ...account,
      updatedAt: new Date().toISOString()
    }), { merge: true });
    return { success: true, message: `Đã lưu tài khoản ${account.displayName} lên Cloud Firestore!` };
  } catch (error: any) {
    console.error('[Firestore] Error saving account:', error);
    return { success: false, message: error.message || 'Lỗi lưu tài khoản lên Firestore.' };
  }
}

/**
 * Delete account from school's accounts subcollection
 */
export async function deleteAccountFromFirestore(
  schoolId: string,
  accountId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const accRef = doc(db, 'schools', schoolId, 'accounts', accountId);
    await deleteDoc(accRef);
    return { success: true, message: 'Đã xóa tài khoản trên Cloud Firestore!' };
  } catch (error: any) {
    console.error('[Firestore] Error deleting account:', error);
    return { success: false, message: error.message || 'Lỗi xóa tài khoản trên Firestore.' };
  }
}

/**
 * Save entire term data (teachers, classes, assignments, timetable) to Firestore
 */
export async function saveTermToFirestore(
  schoolId: string,
  termKey: string,
  termPayload: {
    academicYear: string;
    semester: string;
    teachers?: any[];
    classes?: any[];
    subjectsConfig?: any[];
    departments?: any[];
    classSubjectPeriods?: any;
    subjectDistribution?: any;
    curriculumRules?: any;
    classThreeConsecutivePeriods?: any;
    assignments?: any;
    timetableData?: any;
    timetableLockedSlots?: any;
    sessionMode?: string;
    afternoonPeriodsCount?: number;
    schoolInfo?: any;
  },
  author?: string
): Promise<{ success: boolean; message: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  const formattedTime = new Date().toLocaleString('vi-VN');

  try {
    let assignmentsToSave = termPayload.assignments || {};
    let subAssignments = assignmentsToSave.subjectAssignments || {};
    let hrAssignments = assignmentsToSave.homeroomAssignments || {};

    if (!subAssignments || Object.keys(subAssignments).length === 0) {
      try {
        const a3 = localStorage.getItem('edu_assignments_v3') || localStorage.getItem('edu_assignments');
        if (a3) {
          const p = JSON.parse(a3);
          if (p.subjectAssignments && Object.keys(p.subjectAssignments).length > 0) {
            subAssignments = p.subjectAssignments;
            if (!hrAssignments || Object.keys(hrAssignments).length === 0) {
              hrAssignments = p.homeroomAssignments || {};
            }
          }
        }
      } catch {}
    }

    assignmentsToSave = {
      homeroomAssignments: { ...hrAssignments },
      subjectAssignments: { ...subAssignments }
    };

    const sanitizedClassSubjectPeriods = sanitizeClassSubjectPeriods(termPayload.classSubjectPeriods);

    const termRef = doc(db, 'schools', schoolId, 'terms', termKey);
    const completePayload = {
      termKey,
      ...termPayload,
      classSubjectPeriods: sanitizedClassSubjectPeriods,
      assignments: assignmentsToSave,
      updatedAt: timestamp,
      lastUpdatedBy: author || 'Admin'
    };

    const cleanedPayload = removeUndefinedFields(completePayload);

    await setDoc(termRef, cleanedPayload, { merge: true });

    // Cập nhật song song cả TARGET_TERM_DOC_REF nếu schoolId hoặc termKey tương ứng
    if (termKey !== TARGET_TERM_KEY || schoolId !== TARGET_SCHOOL_ID) {
      try {
        await setDoc(TARGET_TERM_DOC_REF, cleanedPayload, { merge: true });
      } catch {}
    }

    // Also update parent school document's last activity
    const schoolRef = doc(db, 'schools', schoolId);
    await setDoc(schoolRef, removeUndefinedFields({
      id: schoolId,
      name: termPayload.schoolInfo?.schoolName || DEFAULT_SCHOOL_NAME,
      departmentName: termPayload.schoolInfo?.departmentName || DEFAULT_DEPARTMENT_NAME,
      logoId: 'logo_nbk_an_giang_official_2026',
      logoUrl: '/logo_nbk.svg?v=3.0',
      logoType: 'svg_vector_official',
      currentAcademicYear: termPayload.academicYear,
      currentSemester: termPayload.semester,
      updatedAt: timestamp,
      lastUpdatedBy: author || 'Admin'
    }), { merge: true });

    return { 
      success: true, 
      message: `Đồng bộ lên Cloud Firestore (${schoolId}) thành công lúc ${formattedTime}!`,
      timestamp: formattedTime
    };
  } catch (error: any) {
    console.error('[Firestore] Error saving term:', error);
    return { 
      success: false, 
      message: 'Lỗi ghi dữ liệu lên Cloud Firestore: ' + (error.message || 'Không thể kết nối'),
      timestamp: formattedTime
    };
  }
}

/**
 * Tối ưu nén ảnh về kích thước chuẩn ~200x200px Base64
 * Giúp nhẹ dữ liệu, tải tức thì và không làm phình document Firestore
 */
export async function resizeImageToBase64(file: File, maxDim = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/png", 0.9);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Không thể tải file ảnh để nén"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Không thể đọc file ảnh"));
    reader.readAsDataURL(file);
  });
}

/**
 * Đồng bộ Logo thương hiệu nhà trường lên Firestore theo đúng Tenant ID
 * Path: schools/${schoolId} (cụ thể: schools/thpt-nguyen-binh-khiem)
 * Field: customLogo: base64Data, updatedAt: ISOString
 * Khi base64Data = null: khôi phục về logo gốc chuẩn mới
 */
export async function saveSchoolCustomLogo(schoolId: string, base64Data: string | null): Promise<void> {
  const targetId = schoolId || TARGET_SCHOOL_ID;
  const schoolRef = doc(db, "schools", targetId);
  const now = new Date().toISOString();

  if (base64Data) {
    await setDoc(schoolRef, {
      customLogo: base64Data,
      logoId: "custom_logo_" + Date.now(),
      logoUrl: base64Data,
      updatedAt: now
    }, { merge: true });
    try {
      localStorage.setItem("custom_school_logo", base64Data);
    } catch {}
  } else {
    // Khôi phục gốc: xóa customLogo và ghi đè logo chuẩn mới
    await setDoc(schoolRef, {
      customLogo: null,
      logoId: "logo_nbk_an_giang_official_2026",
      logoUrl: "/logo_nbk.svg?v=3.0",
      logoType: "svg_vector_official",
      updatedAt: now
    }, { merge: true });
    try {
      localStorage.removeItem("custom_school_logo");
    } catch {}
  }

  // Phát tín hiệu đồng bộ tức thì cho toàn bộ các component đang mở
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("school_logo_updated", { detail: base64Data }));
  }
}
