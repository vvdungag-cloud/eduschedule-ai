import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, validateFirestoreConnection } from './firebase';
import { 
  subscribeToAccounts, 
  saveAccountToFirestore, 
  deleteAccountFromFirestore, 
  saveTermToFirestore,
  fetchAvailableSchools,
  SchoolTenant,
  DEFAULT_SCHOOL_ID,
  DEFAULT_SCHOOL_NAME,
  CloudConnectionStatus,
  SCHOOL_DOC_REF,
  pushSchoolDataToCloud,
  pullSchoolDataFromCloud,
  removeUndefinedFields,
  sanitizeClassSubjectPeriods
} from './firebaseSync';

import { 
  ALL_PERMISSION_KEYS, 
  ROLE_PRESET_PERMISSIONS, 
  getRolePresetPermissions, 
  PERMISSION_CODES 
} from './permissionConstants';

export type AppRole = 'GUEST' | 'TEACHER' | 'HEAD_OF_DEPARTMENT' | 'ADMIN';
export type UserRole = AppRole | 'admin' | 'subadmin' | 'viewer';

export const normalizeRole = (r?: string | null): AppRole => {
  if (!r) return 'GUEST';
  const upper = String(r).toUpperCase().trim();
  if (upper === 'ADMIN') return 'ADMIN';
  if (upper === 'HEAD_OF_DEPARTMENT' || upper === 'SUBADMIN' || upper === 'TOTRUONG') return 'HEAD_OF_DEPARTMENT';
  if (upper === 'TEACHER' || upper === 'GIAOVIEN') return 'TEACHER';
  if (upper === 'VIEWER' || upper === 'GUEST') return 'GUEST';
  return 'GUEST';
};

export interface UserAccount {
  id: string;
  username: string;
  fullName?: string;
  displayName: string;
  role: AppRole | 'admin' | 'subadmin' | 'viewer';
  department?: string;
  passwordHash: string; // Plaintext or hash
  createdAt: string;
  notes?: string;
  teacherId?: string; // Optional link to specific teacher in teachers list
  isActive?: boolean; // Default true. False means temporarily locked
  permissions?: string[]; // Granular permission codes
}

export interface RolePermissions {
  canEdit: boolean;              // Quyền chỉnh sửa dữ liệu toàn trường
  canEditSchoolData: boolean;    // Quyền sửa danh mục, lớp, GV, môn học
  canRunAI: boolean;             // Quyền chạy AI xếp TKB & phân công
  canSendSchedule: boolean;      // Quyền phát hành & gửi TKB qua Zalo/Gmail
  canManageAssignments: boolean; // Quyền gán/xóa phân công chuyên môn
  canApproveWishes: boolean;     // Duyệt nguyện vọng tổ
  canRegisterWishes: boolean;    // Đăng ký tiết bận/tránh
  canExportPersonal: boolean;    // Tải TKB cá nhân
  canViewAll: boolean;           // Quyền xem (GUEST, TEACHER, HEAD_OF_DEPARTMENT, ADMIN)
}

export interface AuthContextType extends RolePermissions {
  user: UserAccount | null;      // Đại diện tài khoản hiện tại (alias currentUser)
  currentUser: UserAccount | null;
  role: AppRole;                 // Vai trò hiện tại: 'GUEST' | 'TEACHER' | 'HEAD_OF_DEPARTMENT' | 'ADMIN'
  isAdmin: boolean;              // true nếu role === 'ADMIN'
  isHeadOfDepartment: boolean;   // true nếu role === 'HEAD_OF_DEPARTMENT' hoặc 'ADMIN'
  isTeacher: boolean;            // true nếu role === 'TEACHER' hoặc 'HEAD_OF_DEPARTMENT' hoặc 'ADMIN'
  isGuest: boolean;              // true nếu role === 'GUEST'
  hasPermission: (permissionCode: string) => boolean; // Kiểm tra quyền chi tiết

  usersList: UserAccount[];
  loginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  login: (password: string, username?: string) => { success: boolean; message?: string; role?: AppRole };
  logout: () => void;
  changeAdminPassword: (oldPass: string, newPass: string) => Promise<{ success: boolean; message: string }>;
  addUserAccount: (user: Omit<UserAccount, 'id' | 'createdAt'>) => Promise<{ success: boolean; message: string }>;
  updateUserAccount: (id: string, updates: Partial<UserAccount>) => Promise<{ success: boolean; message: string }>;
  deleteUserAccount: (id: string) => Promise<{ success: boolean; message: string }>;
  cloudConfig: CloudSyncConfig;
  updateCloudConfig: (config: Partial<CloudSyncConfig>) => void;
  syncToCloud: () => Promise<{ success: boolean; message: string; timestamp?: string }>;
  fetchFromCloud: () => Promise<{ success: boolean; message: string; data?: any }>;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  
  // Multi-tenant & Real-time Cloud Firestore state
  currentSchoolId: string;
  setCurrentSchoolId: (id: string) => void;
  currentSchoolName: string;
  setCurrentSchoolName: (name: string) => void;
  cloudConnectionStatus: CloudConnectionStatus;
  availableSchools: SchoolTenant[];
  refreshAvailableSchools: () => Promise<void>;
}

export interface CloudSyncConfig {
  provider: 'googlesheets' | 'firebase' | 'local_cloud';
  sheetId?: string;
  sheetApiKey?: string;
  firebaseProjectId?: string;
  firebaseApiKey?: string;
  autoSync: boolean;
  lastSyncStatus?: 'idle' | 'success' | 'error';
}

const DEFAULT_ADMIN_PASSWORD = 'admin123';
const SESSION_AUTH_KEY = 'edu_session_auth_role';
const SESSION_USER_KEY = 'edu_session_auth_user';
const STORAGE_ADMIN_PASS_KEY = 'edu_admin_custom_password';
const STORAGE_SUB_USERS_KEY = 'edu_sub_users_accounts';
const STORAGE_CLOUD_CONFIG_KEY = 'edu_cloud_sync_config';
const STORAGE_CURRENT_SCHOOL_ID = 'edu_current_school_id';
const STORAGE_CURRENT_SCHOOL_NAME = 'edu_current_school_name';

const INITIAL_USERS: UserAccount[] = [
  {
    id: 'admin_root',
    username: 'admin',
    fullName: 'Ban Giám Hiệu',
    role: 'ADMIN',
    displayName: 'Quản trị viên',
    department: 'Ban Giám Hiệu',
    passwordHash: 'admin123',
    createdAt: new Date().toISOString(),
    notes: 'Toàn quyền Thêm, Sửa, Xóa, Lưu, Chạy AI xếp TKB, Công bố và Gửi TKB toàn trường',
    isActive: true,
    permissions: ALL_PERMISSION_KEYS
  },
  {
    id: 'sub_totruong',
    username: 'totruong',
    fullName: 'Trần Văn Tổ Trưởng',
    role: 'HEAD_OF_DEPARTMENT',
    displayName: 'Tổ trưởng Chuyên môn',
    department: 'Tổ Toán - Tin',
    passwordHash: 'totruong123',
    createdAt: new Date().toISOString(),
    notes: 'Xem và duyệt nguyện vọng của tổ, xem phân công toàn trường',
    isActive: true,
    permissions: ROLE_PRESET_PERMISSIONS.HEAD_OF_DEPARTMENT
  },
  {
    id: 'viewer_guest',
    username: 'giaovien',
    fullName: 'Nguyễn Văn Giáo Viên',
    role: 'TEACHER',
    displayName: 'Giáo viên bộ môn',
    department: 'Toàn trường',
    passwordHash: 'gv123',
    createdAt: new Date().toISOString(),
    notes: 'Xem TKB/phân công, tải file cá nhân, đăng ký tiết bận/tiết tránh',
    isActive: true,
    permissions: ROLE_PRESET_PERMISSIONS.TEACHER
  }
];

const DEFAULT_CLOUD_CONFIG: CloudSyncConfig = {
  provider: 'firebase',
  sheetId: '',
  sheetApiKey: '',
  firebaseProjectId: 'qlgd-tkb',
  autoSync: true,
  lastSyncStatus: 'success'
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Session authentication state (resets on browser close as required)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_USER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed) {
          let displayName = parsed.displayName;
          if (displayName === 'Quản trị viên (Ban Giám Hiệu)') {
            displayName = 'Quản trị viên';
          }
          return { ...parsed, displayName, role: normalizeRole(parsed.role) };
        }
      }
    } catch {}
    return null;
  });

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      const savedUser = sessionStorage.getItem(SESSION_USER_KEY);
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        return normalizeRole(parsed?.role) === 'ADMIN';
      }
      const savedRole = sessionStorage.getItem(SESSION_AUTH_KEY);
      return normalizeRole(savedRole) === 'ADMIN';
    } catch {
      return false;
    }
  });

  // Multi-tenant School identifier
  const [currentSchoolId, setSchoolIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_CURRENT_SCHOOL_ID) || DEFAULT_SCHOOL_ID;
    } catch {
      return DEFAULT_SCHOOL_ID;
    }
  });

  const [currentSchoolName, setSchoolNameState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_CURRENT_SCHOOL_NAME) || DEFAULT_SCHOOL_NAME;
    } catch {
      return DEFAULT_SCHOOL_NAME;
    }
  });

  const [availableSchools, setAvailableSchools] = useState<SchoolTenant[]>([]);
  const [cloudConnectionStatus, setCloudConnectionStatus] = useState<CloudConnectionStatus>('syncing');

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem('edu_last_cloud_synced_at') || null;
    } catch {
      return null;
    }
  });

  // Sub-users / accounts list
  const [usersList, setUsersList] = useState<UserAccount[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SUB_USERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_USERS;
  });

  // Cloud config
  const [cloudConfig, setCloudConfig] = useState<CloudSyncConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CLOUD_CONFIG_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_CLOUD_CONFIG;
  });

  const setCurrentSchoolId = (id: string) => {
    setSchoolIdState(id);
    try {
      localStorage.setItem(STORAGE_CURRENT_SCHOOL_ID, id);
    } catch {}
  };

  const setCurrentSchoolName = (name: string) => {
    setSchoolNameState(name);
    try {
      localStorage.setItem(STORAGE_CURRENT_SCHOOL_NAME, name);
    } catch {}
  };

  const refreshAvailableSchools = useCallback(async () => {
    const list = await fetchAvailableSchools();
    if (list.length > 0) {
      setAvailableSchools(list);
    } else {
      setAvailableSchools([{
        id: currentSchoolId,
        name: currentSchoolName,
        departmentName: 'SỞ GIÁO DỤC VÀ ĐÀO TẠO'
      }]);
    }
  }, [currentSchoolId, currentSchoolName]);

  // Initial cloud connectivity check
  useEffect(() => {
    let isMounted = true;
    validateFirestoreConnection()
      .then((ok) => {
        if (!isMounted) return;
        setCloudConnectionStatus(ok ? 'connected' : 'offline');
      })
      .catch(() => {
        if (!isMounted) return;
        setCloudConnectionStatus('offline');
      });

    refreshAvailableSchools();
    return () => { isMounted = false; };
  }, [refreshAvailableSchools]);

  // Real-time synchronization for Accounts (onSnapshot for schools/{schoolId}/accounts)
  useEffect(() => {
    setCloudConnectionStatus('syncing');
    const unsubscribe = subscribeToAccounts(
      currentSchoolId,
      (remoteAccounts) => {
        if (remoteAccounts && remoteAccounts.length > 0) {
          setUsersList(remoteAccounts);
          try {
            localStorage.setItem(STORAGE_SUB_USERS_KEY, JSON.stringify(remoteAccounts));
          } catch {}
        } else {
          // TUYỆT ĐỐI KHÔNG TỰ ĐỘNG GHI (WRITE) LÊN FIREBASE KHI KHỞI ĐỘNG HOẶC RỖNG
          // Chỉ fallback sang INITIAL_USERS trong local state để người dùng có thể đăng nhập offline/read-only
          setUsersList(INITIAL_USERS);
        }
        setCloudConnectionStatus('connected');
      },
      (err) => {
        console.warn('[Firestore] Accounts sync warning:', err);
        setCloudConnectionStatus('error');
      }
    );

    return () => unsubscribe();
  }, [currentSchoolId]);

  // Save users list locally as fallback cache
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SUB_USERS_KEY, JSON.stringify(usersList));
    } catch {}
  }, [usersList]);

  // Save cloud config
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
    } catch {}
  }, [cloudConfig]);

  // Derived role and permission states
  const role: AppRole = currentUser ? normalizeRole(currentUser.role) : 'GUEST';
  const isCurrentAdmin = role === 'ADMIN';
  const isHeadOfDepartment = role === 'HEAD_OF_DEPARTMENT' || isCurrentAdmin;
  const isTeacher = role === 'TEACHER' || isHeadOfDepartment;
  const isGuest = role === 'GUEST';

  // Granular Permission Checker
  const hasPermission = useCallback((permissionCode: string): boolean => {
    // 1. Unauthenticated or GUEST mode: strictly read-only views
    if (!currentUser || role === 'GUEST') {
      return [
        PERMISSION_CODES.DECLARATION_VIEW,
        PERMISSION_CODES.ASSIGNMENT_VIEW,
        PERMISSION_CODES.TIMETABLE_VIEW
      ].includes(permissionCode as any);
    }

    // 2. Temporarily locked account: zero permissions
    if (currentUser.isActive === false) {
      return false;
    }

    // 3. Admin account: always has full permissions
    if (role === 'ADMIN' || normalizeRole(currentUser.role) === 'ADMIN') {
      return true;
    }

    // 4. Granular permissions array check
    if (Array.isArray(currentUser.permissions) && currentUser.permissions.length > 0) {
      return currentUser.permissions.includes(permissionCode);
    }

    // 5. Fallback to role presets
    const preset = getRolePresetPermissions(role);
    return preset.includes(permissionCode);
  }, [currentUser, role]);

  // Dynamic capabilities based on hasPermission
  const canEdit = hasPermission(PERMISSION_CODES.DECLARATION_EDIT) || 
                  hasPermission(PERMISSION_CODES.ASSIGNMENT_ASSIGN) || 
                  hasPermission(PERMISSION_CODES.TIMETABLE_EDIT_GRID);
  const canEditSchoolData = hasPermission(PERMISSION_CODES.SETTINGS_MANAGE_CATALOG);
  const canRunAI = hasPermission(PERMISSION_CODES.TIMETABLE_RUN_AI);
  const canSendSchedule = hasPermission(PERMISSION_CODES.SEND_PUBLISH_SCHOOL) || 
                          hasPermission(PERMISSION_CODES.SEND_NOTIFY_ZALO_EMAIL);
  const canManageAssignments = hasPermission(PERMISSION_CODES.ASSIGNMENT_ASSIGN);
  const canApproveWishes = hasPermission(PERMISSION_CODES.TIMETABLE_APPROVE_WISHES);
  const canRegisterWishes = hasPermission(PERMISSION_CODES.TIMETABLE_REQUEST_BUSY);
  const canExportPersonal = hasPermission(PERMISSION_CODES.SEND_DOWNLOAD_PERSONAL);
  const canViewAll = true;

  // Sync session storage
  const setAuthSession = (user: UserAccount | null) => {
    if (user) {
      const normRole = normalizeRole(user.role);
      let displayName = user.displayName;
      if (displayName === 'Quản trị viên (Ban Giám Hiệu)') {
        displayName = 'Quản trị viên';
      }
      const normalizedUser: UserAccount = { 
        ...user, 
        displayName, 
        role: normRole,
        isActive: user.isActive !== false,
        permissions: user.permissions || getRolePresetPermissions(normRole)
      };
      setCurrentUser(normalizedUser);
      setIsAdmin(normRole === 'ADMIN');
      try {
        sessionStorage.setItem(SESSION_AUTH_KEY, normRole);
        sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(normalizedUser));
      } catch {}
    } else {
      setCurrentUser(null);
      setIsAdmin(false);
      try {
        sessionStorage.removeItem(SESSION_AUTH_KEY);
        sessionStorage.removeItem(SESSION_USER_KEY);
      } catch {}
    }
  };

  const getAdminPassword = (): string => {
    try {
      const rootAcc = usersList.find(u => normalizeRole(u.role) === 'ADMIN');
      if (rootAcc?.passwordHash) return rootAcc.passwordHash;
      return localStorage.getItem(STORAGE_ADMIN_PASS_KEY) || DEFAULT_ADMIN_PASSWORD;
    } catch {
      return DEFAULT_ADMIN_PASSWORD;
    }
  };

  const login = (password: string, username?: string): { success: boolean; message?: string; role?: AppRole } => {
    const trimmedPass = password.trim();
    const adminPass = getAdminPassword();
    const trimmedUser = (username || '').trim().toLowerCase();

    // 1. Direct admin root password match (admin123 or custom)
    if ((!trimmedUser || trimmedUser === 'admin') && (trimmedPass === adminPass || trimmedPass === DEFAULT_ADMIN_PASSWORD)) {
      const adminAcc = usersList.find(u => normalizeRole(u.role) === 'ADMIN') || INITIAL_USERS[0];
      setAuthSession({ ...adminAcc, role: 'ADMIN', isActive: true });
      return { success: true, role: 'ADMIN', message: 'Đăng nhập thành công với vai trò Ban Giám Hiệu (Toàn quyền Admin)!' };
    }

    // 2. Check accounts list from Firestore/localStorage
    let foundUser: UserAccount | undefined;
    if (trimmedUser) {
      foundUser = usersList.find(u => u.username.toLowerCase() === trimmedUser);
    } else {
      foundUser = usersList.find(u => u.passwordHash === trimmedPass);
    }

    if (foundUser) {
      // Check if account is locked
      if (foundUser.isActive === false) {
        return { success: false, message: 'Tài khoản này hiện đang bị tạm khóa. Vui lòng liên hệ Quản trị viên.' };
      }

      if (foundUser.passwordHash === trimmedPass || (normalizeRole(foundUser.role) === 'ADMIN' && trimmedPass === adminPass)) {
        const normRole = normalizeRole(foundUser.role);
        setAuthSession({ ...foundUser, role: normRole });
        const roleDesc = normRole === 'ADMIN'
          ? 'Ban Giám Hiệu (Toàn quyền Admin)'
          : normRole === 'HEAD_OF_DEPARTMENT'
          ? 'Tổ trưởng Chuyên môn'
          : 'Giáo viên Bộ môn';
        return { 
          success: true, 
          role: normRole, 
          message: `Đăng nhập thành công với vai trò ${roleDesc}!` 
        };
      } else {
        return { success: false, message: 'Mật khẩu không chính xác.' };
      }
    }

    // Fallback: check admin password if username not found
    if (trimmedPass === adminPass || trimmedPass === DEFAULT_ADMIN_PASSWORD) {
      const adminAcc = usersList.find(u => normalizeRole(u.role) === 'ADMIN') || INITIAL_USERS[0];
      setAuthSession({ ...adminAcc, role: 'ADMIN', isActive: true });
      return { success: true, role: 'ADMIN', message: 'Đăng nhập Ban Giám Hiệu (Admin) thành công!' };
    }

    return { success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' };
  };

  const logout = () => {
    setAuthSession(null);
  };

  const changeAdminPassword = async (oldPass: string, newPass: string): Promise<{ success: boolean; message: string }> => {
    const currentPass = getAdminPassword();
    if (oldPass.trim() !== currentPass && oldPass.trim() !== DEFAULT_ADMIN_PASSWORD) {
      return { success: false, message: 'Mật khẩu hiện tại không đúng.' };
    }
    if (!newPass.trim() || newPass.trim().length < 4) {
      return { success: false, message: 'Mật khẩu mới phải có ít nhất 4 ký tự.' };
    }

    try {
      localStorage.setItem(STORAGE_ADMIN_PASS_KEY, newPass.trim());
      // Update in Firestore for admin_root
      const adminAcc = usersList.find(u => normalizeRole(u.role) === 'ADMIN') || INITIAL_USERS[0];
      const updatedAcc = { ...adminAcc, passwordHash: newPass.trim() };
      await saveAccountToFirestore(currentSchoolId, updatedAcc);
      setUsersList(prev => prev.map(u => normalizeRole(u.role) === 'ADMIN' ? updatedAcc : u));
      return { success: true, message: 'Đã đổi mật khẩu Quản trị viên trên Cloud Firestore thành công!' };
    } catch {
      return { success: false, message: 'Lỗi lưu trữ mật khẩu lên đám mây.' };
    }
  };

  const addUserAccount = async (user: Omit<UserAccount, 'id' | 'createdAt'>): Promise<{ success: boolean; message: string }> => {
    if (!user.username.trim()) {
      return { success: false, message: 'Tên đăng nhập không được để trống.' };
    }
    if (usersList.some(u => u.username.toLowerCase() === user.username.trim().toLowerCase())) {
      return { success: false, message: `Tên đăng nhập "${user.username}" đã tồn tại.` };
    }

    const normRole = normalizeRole(user.role);
    const assignedPermissions = (user.permissions && user.permissions.length > 0)
      ? user.permissions
      : getRolePresetPermissions(normRole);

    const newAcc: UserAccount = {
      ...user,
      id: 'usr_' + Date.now(),
      role: normRole,
      isActive: user.isActive !== false,
      permissions: assignedPermissions,
      createdAt: new Date().toISOString()
    };

    setUsersList(prev => [...prev, newAcc]);
    try {
      await saveAccountToFirestore(currentSchoolId, newAcc);
      return { success: true, message: `Đã tạo tài khoản "${user.displayName || user.username}" và lưu lên Cloud Firestore!` };
    } catch (e: any) {
      return { success: true, message: `Đã tạo tài khoản (lưu cục bộ): ${e.message}` };
    }
  };

  const updateUserAccount = async (id: string, updates: Partial<UserAccount>): Promise<{ success: boolean; message: string }> => {
    const target = usersList.find(u => u.id === id);
    if (!target) return { success: false, message: 'Không tìm thấy tài khoản.' };
    
    // Bảo vệ tài khoản Quản trị viên gốc (Root Admin)
    if (target.id === 'admin_root' || target.username.toLowerCase() === 'admin') {
      if (updates.role && normalizeRole(updates.role) !== 'ADMIN') {
        return { success: false, message: 'Bảo vệ hệ thống: Không thể thay đổi vai trò của tài khoản Quản trị viên gốc (Root Admin).' };
      }
      if (updates.isActive === false) {
        return { success: false, message: 'Bảo vệ hệ thống: Không thể khóa tài khoản Quản trị viên gốc.' };
      }
      updates.role = 'ADMIN';
      updates.isActive = true;
    }

    const updated: UserAccount = { 
      ...target, 
      ...updates,
      role: updates.role ? normalizeRole(updates.role) : target.role
    };

    setUsersList(prev => prev.map(u => u.id === id ? updated : u));

    // Update session if editing current logged-in user
    if (currentUser && currentUser.id === id) {
      setAuthSession(updated);
    }

    try {
      await saveAccountToFirestore(currentSchoolId, updated);
      return { success: true, message: `Đã cập nhật thông tin tài khoản "${updated.displayName}" thành công.` };
    } catch (e: any) {
      return { success: true, message: `Đã cập nhật thông tin tài khoản (lưu cục bộ).` };
    }
  };

  const deleteUserAccount = async (id: string): Promise<{ success: boolean; message: string }> => {
    const target = usersList.find(u => u.id === id);
    if (!target) return { success: false, message: 'Không tìm thấy tài khoản.' };

    // Bảo vệ tài khoản gốc:
    if (target.id === 'admin_root' || target.username.toLowerCase() === 'admin') {
      return { success: false, message: 'Bảo vệ hệ thống: Tuyệt đối không thể xóa tài khoản Quản trị viên gốc (Root Admin).' };
    }

    if (normalizeRole(target.role) === 'ADMIN' && usersList.filter(u => normalizeRole(u.role) === 'ADMIN').length <= 1) {
      return { success: false, message: 'Không thể xóa tài khoản Quản trị viên duy nhất còn lại.' };
    }

    setUsersList(prev => prev.filter(u => u.id !== id));
    try {
      await deleteAccountFromFirestore(currentSchoolId, id);
      return { success: true, message: `Đã xóa tài khoản "${target.displayName}" trên Cloud Firestore thành công.` };
    } catch {
      return { success: true, message: `Đã xóa tài khoản "${target.displayName}".` };
    }
  };

  const updateCloudConfig = (config: Partial<CloudSyncConfig>) => {
    setCloudConfig(prev => ({ ...prev, ...config }));
  };

  /**
   * Primary Cloud Sync Handler (saves active term & assignments to Cloud Firestore under schools/{schoolId}/terms/{termKey})
   */
  const syncToCloud = async (): Promise<{ success: boolean; message: string; timestamp?: string }> => {
    if (!isAdmin) {
      setLoginModalOpen(true);
      return {
        success: false,
        message: 'Bị từ chối: Cần đăng nhập Quản trị viên (Admin) để lưu hoặc ghi đè dữ liệu lên Google Sheets/Firebase.'
      };
    }

    setIsSyncing(true);
    setCloudConnectionStatus('syncing');

    try {
      // 1. Gather all current term state from localStorage
      const curYear = localStorage.getItem('edu_current_academic_year') || '2025 – 2026';
      const curSem = localStorage.getItem('edu_current_semester') || 'Học kỳ I';
      const cleanYear = curYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
      const semSuffix = curSem === 'Học kỳ II' ? 'HK2' : (curSem === 'Cả năm' ? 'CN' : 'HK1');
      const termKey = `${cleanYear}_${semSuffix}`;

      // Local storage data extraction
      let teachers: any[] = [];
      let classes: any[] = [];
      let subjectsConfig: any[] = [];
      let classSubjectPeriods: any = {};
      let classThreeConsecutivePeriods: any = {};
      let assignments: any = { homeroomAssignments: {}, subjectAssignments: {} };
      let timetableData: any = null;
      let schoolInfo: any = null;
      let subjectDistribution: Record<string, Record<string, number>> = {};
      const defaultPeriodsByGrade: Record<string, Record<string, number>> = {
        '10': { 'Toán': 3, 'Lý': 2, 'Hóa': 2, 'Sinh': 2, 'Tin': 2, 'CNCN': 1, 'Văn': 3, 'Sử': 2, 'Địa': 2, 'GDKTPL': 2, 'Anh': 3, 'GDTC': 2, 'GDQPAN': 1, 'GDĐP': 1, 'TNHN1': 1, 'TNHN2': 1 },
        '11': { 'Toán': 3, 'Lý': 2, 'Hóa': 2, 'Sinh': 2, 'Tin': 2, 'CNCN': 1, 'Văn': 3, 'Sử': 2, 'Địa': 2, 'GDKTPL': 2, 'Anh': 3, 'GDTC': 2, 'GDQPAN': 1, 'GDĐP': 1, 'TNHN1': 1, 'TNHN2': 1 },
        '12': { 'Toán': 3, 'Lý': 2, 'Hóa': 2, 'Sinh': 2, 'Tin': 2, 'CNCN': 1, 'Văn': 3, 'Sử': 2, 'Địa': 2, 'GDKTPL': 2, 'Anh': 3, 'GDTC': 2, 'GDQPAN': 1, 'GDĐP': 1, 'TNHN1': 1, 'TNHN2': 1 },
      };
      

      try {
        const tStr = localStorage.getItem('edu_teachers');
        if (tStr) teachers = JSON.parse(tStr);
        const cStr = localStorage.getItem('edu_classes_v3') || localStorage.getItem('edu_classes');
        if (cStr) classes = JSON.parse(cStr);
        const sStr = localStorage.getItem('edu_subjects_config');
        if (sStr) subjectsConfig = JSON.parse(sStr);
        const cspStr = localStorage.getItem('edu_class_subject_periods_v2') || localStorage.getItem(`edu_term_class_periods_${termKey}`);
        if (cspStr) classSubjectPeriods = JSON.parse(cspStr);
        const c3Str = localStorage.getItem('edu_class_three_consecutive_v2');
        if (c3Str) classThreeConsecutivePeriods = JSON.parse(c3Str);
        // Ưu tiên nạp bản ghi phân công có subjectAssignments đầy đủ (> 0 phân công bộ môn)
        let foundAssignments: any = null;
        const assignKeys = [
          'edu_assignments_v3',
          'edu_assignments',
          `edu_term_assignments_${termKey}`,
          'edu_term_assignments_2026___2027_HK1'
        ];
        for (const k of assignKeys) {
          try {
            const raw = localStorage.getItem(k);
            if (raw) {
              const p = JSON.parse(raw);
              const subCount = Object.values(p.subjectAssignments || {}).reduce(
                (sum: number, cls: any) => sum + Object.keys(cls || {}).length, 0
              );
              if (subCount > 0) {
                foundAssignments = p;
                break;
              } else if (!foundAssignments) {
                foundAssignments = p;
              }
            }
          } catch {}
        }
        if (foundAssignments) assignments = foundAssignments;
        const tkbStr = localStorage.getItem(`edu_timetable_${termKey}`);
        if (tkbStr) timetableData = JSON.parse(tkbStr);
        const scStr = localStorage.getItem(`edu_term_school_info_${termKey}`) || localStorage.getItem('edu_school_info_v1');
        if (scStr) schoolInfo = JSON.parse(scStr);
        // Build complete 44-class matrix of subject periods ensuring no zero wipes
        const fullCsp: Record<string, any> = { ...classSubjectPeriods };
        subjectDistribution = {};


        classes.forEach((cls: any) => {
          if (!fullCsp[cls.id]) fullCsp[cls.id] = {};
          subjectDistribution[cls.id] = {};
          const gradeDef = defaultPeriodsByGrade[cls.grade] || defaultPeriodsByGrade['10'];

          // Chỉ khởi tạo mặc định nếu lớp hoàn toàn chưa từng có dữ liệu cấu hình số tiết nào
          const hasExistingData = Object.keys(fullCsp[cls.id]).length > 0;
          if (!hasExistingData) {
            Object.keys(gradeDef).forEach(subId => {
              fullCsp[cls.id][subId] = gradeDef[subId];
            });
          }

          Object.entries(fullCsp[cls.id]).forEach(([subId, val]: [string, any]) => {
            if (typeof val === 'object' && val !== null) {
              subjectDistribution[cls.id][subId] = val.isRemoved ? 0 : ((val.mainPeriods ?? 0) + (val.oppPeriods ?? 0));
            } else if (typeof val === 'number') {
              subjectDistribution[cls.id][subId] = val;
            } else {
              subjectDistribution[cls.id][subId] = gradeDef[subId] ?? 0;
            }
          });
        });

        classSubjectPeriods = fullCsp;
        try {
          localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(fullCsp));
          localStorage.setItem(`edu_term_class_periods_${termKey}`, JSON.stringify(fullCsp));
          localStorage.setItem(`edu_term_subject_distribution_${termKey}`, JSON.stringify(subjectDistribution));
        } catch {}
      } catch (err) {
        console.warn('Error reading local cache before sync:', err);
      }

      // 2. Save directly to unified fixed document on Cloud Firestore (eduschedule_data/thpt_nguyen_binh_khiem)
      let classShiftsData = null;
      try {
        const sh = localStorage.getItem('edu_class_shifts');
        if (sh) classShiftsData = JSON.parse(sh);
      } catch {}

      const cleanedClassSubjectPeriods = sanitizeClassSubjectPeriods(classSubjectPeriods);

      const fixedPushRes = await pushSchoolDataToCloud({
        teachers,
        classes,
        subjects: subjectsConfig,
        assignments,
        schedules: timetableData,
        classSubjectPeriods: cleanedClassSubjectPeriods,
        classShifts: classShiftsData,
        schoolInfo,
        academicYear: curYear,
        semester: curSem
      });

      // Also backup to legacy multi-tenant collection as secondary copy
      try {
        await saveTermToFirestore(
          currentSchoolId,
          termKey,
          {
            academicYear: curYear,
            semester: curSem,
            teachers,
            classes,
            subjectsConfig,
            classSubjectPeriods: cleanedClassSubjectPeriods,
            subjectDistribution,
            curriculumRules: {
              standardGradeDefaults: defaultPeriodsByGrade,
              matrix: subjectDistribution
            },
            classThreeConsecutivePeriods,
            assignments,
            timetableData,
            schoolInfo
          },
          currentUser?.displayName || 'Admin'
        );
      } catch {}

      // 3. Keep server-side API sync backup
      try {
        const cloudPayload: Record<string, any> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('edu_') || k.startsWith('timetable_'))) {
            cloudPayload[k] = localStorage.getItem(k);
          }
        }

        await fetch('/api/cloud/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Role': 'admin'
          },
          body: JSON.stringify({
            provider: 'firebase',
            schoolId: currentSchoolId,
            timestamp: new Date().toISOString(),
            data: cloudPayload
          })
        });
      } catch (e) {
        // Non-blocking server proxy log
      }

      const now = fixedPushRes.timestamp || new Date().toLocaleString('vi-VN');
      localStorage.setItem('edu_last_cloud_synced_at', now);
      setLastSyncedAt(now);
      setCloudConnectionStatus('connected');
      refreshAvailableSchools();

      return {
        success: true,
        message: `Đã lưu thành công 101 GV, 44 Lớp và TKB lên Cloud Firestore lúc ${now}!`,
        timestamp: now
      };
    } catch (e: any) {
      setCloudConnectionStatus('error');
      return { 
        success: false, 
        message: 'Lỗi khi lưu lên Cloud Firestore: ' + (e.message || 'Không thể kết nối') 
      };
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Fetch latest data from Cloud Firestore for the current term and school
   */
  const fetchFromCloud = async (): Promise<{ success: boolean; message: string; data?: any }> => {
    setIsSyncing(true);
    setCloudConnectionStatus('syncing');

    try {
      const curYear = localStorage.getItem('edu_current_academic_year') || '2026 – 2027';
      const curSem = localStorage.getItem('edu_current_semester') || 'Học kỳ I';
      const cleanYear = curYear.replace(/[^0-9]/g, '_').replace(/^_+|_+$/g, '');
      const semSuffix = curSem === 'Học kỳ II' ? 'HK2' : (curSem === 'Cả năm' ? 'CN' : 'HK1');
      const termKey = `${cleanYear}_${semSuffix}`;

      // 1. Read from unified fixed document (eduschedule_data/thpt_nguyen_binh_khiem)
      const pullResult = await pullSchoolDataFromCloud();
      if (pullResult.success && pullResult.data) {
        const cloudData = pullResult.data;
        const now = cloudData.lastUpdatedText || new Date().toLocaleString('vi-VN');

        // Cache to localStorage
        if (cloudData.teachers) localStorage.setItem('edu_teachers', JSON.stringify(cloudData.teachers));
        if (cloudData.classes) localStorage.setItem('edu_classes_v3', JSON.stringify(cloudData.classes));
        if (cloudData.subjects) localStorage.setItem('edu_subjects_config', JSON.stringify(cloudData.subjects));
        if (cloudData.assignments) {
          localStorage.setItem('edu_assignments_v3', JSON.stringify(cloudData.assignments));
          localStorage.setItem(`edu_term_assignments_${termKey}`, JSON.stringify(cloudData.assignments));
        }
        if (cloudData.schedules) {
          localStorage.setItem(`edu_timetable_${termKey}`, JSON.stringify(cloudData.schedules));
          localStorage.setItem('edu_timetable_active', JSON.stringify(cloudData.schedules));
        }
        if (cloudData.classSubjectPeriods) localStorage.setItem('edu_class_subject_periods_v2', JSON.stringify(cloudData.classSubjectPeriods));
        if (cloudData.classShifts) localStorage.setItem('edu_class_shifts', JSON.stringify(cloudData.classShifts));
        if (cloudData.schoolInfo) localStorage.setItem('edu_school_info_v1', JSON.stringify(cloudData.schoolInfo));

        localStorage.setItem('edu_last_cloud_synced_at', now);
        setLastSyncedAt(now);
        setCloudConnectionStatus('connected');

        // Broadcast event so active views immediately re-render
        window.dispatchEvent(new CustomEvent('cloud-data-pulled', { detail: cloudData }));

        return {
          success: true,
          message: `Đã nạp toàn bộ 101 GV, 44 Lớp và TKB từ Cloud Firestore lúc ${now}!`,
          data: cloudData
        };
      }

      // 2. Fallback to legacy term document if unified document was not found
      const termDocRef = doc(db, 'schools', currentSchoolId, 'terms', termKey);
      const termSnap = await getDoc(termDocRef);

      if (termSnap.exists()) {
        const termData = termSnap.data();
        const now = termData.updatedAt ? new Date(termData.updatedAt).toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN');
        
        // Cache to localStorage
        if (termData.teachers) localStorage.setItem('edu_teachers', JSON.stringify(termData.teachers));
        if (termData.classes) localStorage.setItem('edu_classes_v3', JSON.stringify(termData.classes));
        if (termData.subjectsConfig) localStorage.setItem('edu_subjects_config', JSON.stringify(termData.subjectsConfig));
        if (termData.assignments) localStorage.setItem(`edu_term_assignments_${termKey}`, JSON.stringify(termData.assignments));
        if (termData.classSubjectPeriods) localStorage.setItem(`edu_term_class_periods_${termKey}`, JSON.stringify(termData.classSubjectPeriods));
        if (termData.timetableData) localStorage.setItem(`edu_timetable_${termKey}`, JSON.stringify(termData.timetableData));
        if (termData.schoolInfo) localStorage.setItem('edu_school_info_v1', JSON.stringify(termData.schoolInfo));

        localStorage.setItem('edu_last_cloud_synced_at', now);
        setLastSyncedAt(now);
        setCloudConnectionStatus('connected');

        window.dispatchEvent(new CustomEvent('cloud-data-pulled', { detail: termData }));

        return {
          success: true,
          message: `Đã nạp dữ liệu từ Cloud Firestore (${currentSchoolId}) lúc ${now}!`,
          data: termData
        };
      }

      // 2. Fallback to server snapshot if term document isn't in Firestore yet
      const response = await fetch('/api/cloud/latest');
      if (response.ok) {
        const resData = await response.json();
        if (resData.success && resData.snapshot?.data) {
          const dataObj = resData.snapshot.data;
          Object.keys(dataObj).forEach(k => {
            if (dataObj[k] && typeof dataObj[k] === 'string') {
              localStorage.setItem(k, dataObj[k]);
            }
          });
          const timestamp = resData.snapshot.timestamp ? new Date(resData.snapshot.timestamp).toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN');
          setLastSyncedAt(timestamp);
          setCloudConnectionStatus('connected');
          return {
            success: true,
            message: `Nạp dữ liệu từ Cloud Firestore thành công lúc ${timestamp}!`,
            data: dataObj
          };
        }
      }

      setCloudConnectionStatus('connected');
      return { 
        success: false, 
        message: `Chưa có bản lưu nào trên Cloud Firestore cho trường ${currentSchoolId} (${curYear}).` 
      };
    } catch (e: any) {
      setCloudConnectionStatus('error');
      return { success: false, message: 'Lỗi tải từ Cloud Firestore: ' + e.message };
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        currentUser,
        role,
        isAdmin: isCurrentAdmin,
        isHeadOfDepartment,
        isTeacher,
        isGuest,
        canEdit,
        canEditSchoolData,
        canRunAI,
        canSendSchedule,
        canManageAssignments,
        canApproveWishes,
        canRegisterWishes,
        canExportPersonal,
        canViewAll,
        hasPermission,
        usersList,
        loginModalOpen,
        openLoginModal: () => setLoginModalOpen(true),
        closeLoginModal: () => setLoginModalOpen(false),
        login,
        logout,
        changeAdminPassword,
        addUserAccount,
        updateUserAccount,
        deleteUserAccount,
        cloudConfig,
        updateCloudConfig,
        syncToCloud,
        fetchFromCloud,
        isSyncing,
        lastSyncedAt,
        currentSchoolId,
        setCurrentSchoolId,
        currentSchoolName,
        setCurrentSchoolName,
        cloudConnectionStatus,
        availableSchools,
        refreshAvailableSchools
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
