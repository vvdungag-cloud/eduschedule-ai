import React, { useState } from 'react';
import { 
  KeyRound, ShieldCheck, Lock, Unlock, Eye, EyeOff, AlertCircle, 
  CheckCircle, X, Users, UserPlus, Settings, Cloud, Database, 
  Trash2, Edit2, ShieldAlert, School, RefreshCw, Check, ArrowRight, Upload
} from 'lucide-react';
import { useAuth, UserAccount, AppRole, normalizeRole } from '../utils/authContext';
import { slugifySchoolId, resizeImageToBase64, saveSchoolCustomLogo } from '../utils/firebaseSync';
import { SchoolLogo, getSafeSchoolLogo, DEFAULT_SCHOOL_LOGO_DATA_URI } from './SchoolLogo';

interface AdminAuthModalProps {
  onOpenUserManagement?: () => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({ onOpenUserManagement }) => {
  const { 
    user,
    role,
    isAdmin, 
    isHeadOfDepartment,
    isTeacher,
    isGuest,
    loginModalOpen, 
    closeLoginModal, 
    login, 
    logout, 
    changeAdminPassword,
    usersList,
    addUserAccount,
    updateUserAccount,
    deleteUserAccount,
    currentUser,
    cloudConfig,
    updateCloudConfig,
    syncToCloud,
    fetchFromCloud,
    lastSyncedAt,
    isSyncing,
    currentSchoolId,
    setCurrentSchoolId,
    currentSchoolName,
    setCurrentSchoolName,
    cloudConnectionStatus,
    availableSchools,
    refreshAvailableSchools
  } = useAuth();

    const [localCustomLogo, setLocalCustomLogo] = useState<string | null>(() => {
    try {
      return localStorage.getItem("custom_school_logo");
    } catch {
      return null;
    }
  });
  const [isUpdatingLogo, setIsUpdatingLogo] = useState(false);

  React.useEffect(() => {
    const handler = (e: any) => {
      setLocalCustomLogo(e.detail || null);
    };
    window.addEventListener("school_logo_updated", handler);
    return () => window.removeEventListener("school_logo_updated", handler);
  }, []);

  const [activeTab, setActiveTab] = useState<'login' | 'schools' | 'accounts' | 'security' | 'cloud'>('login');
  const [passwordInput, setPasswordInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Password change state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Sub-account management state
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormData, setUserFormData] = useState<{
    username: string;
    displayName: string;
    role: AppRole;
    department: string;
    passwordHash: string;
    notes: string;
  }>({
    username: '',
    displayName: '',
    role: 'TEACHER',
    department: 'Tổ Chuyên môn',
    passwordHash: '',
    notes: ''
  });

  // School tenant switch state
  const [newSchoolNameInput, setNewSchoolNameInput] = useState('');
  const [newSchoolIdInput, setNewSchoolIdInput] = useState('');
  const [isCreatingSchool, setIsCreatingSchool] = useState(false);

  if (!loginModalOpen) return null;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!passwordInput.trim()) {
      setErrorMessage('Vui lòng nhập mật khẩu Quản trị viên!');
      return;
    }

    const res = login(passwordInput, usernameInput || undefined);
    if (res.success) {
      setPasswordInput('');
      setUsernameInput('');
      setSuccessMessage('Đăng nhập Quản trị viên thành công!');
      setTimeout(() => {
        closeLoginModal();
        setSuccessMessage(null);
      }, 700);
    } else {
      setErrorMessage(res.message || 'Mật khẩu quản trị không chính xác.');
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!oldPassword.trim()) {
      setErrorMessage('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Mật khẩu mới và xác nhận mật khẩu không trùng khớp.');
      return;
    }
    if (newPassword.length < 4) {
      setErrorMessage('Mật khẩu mới phải từ 4 ký tự trở lên.');
      return;
    }

    const res = await changeAdminPassword(oldPassword, newPassword);
    if (res.success) {
      setSuccessMessage(res.message);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setErrorMessage(res.message);
    }
  };

  const handleSaveSubUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!userFormData.username.trim() || !userFormData.passwordHash.trim()) {
      setErrorMessage('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }

    if (editingUserId) {
      const res = await updateUserAccount(editingUserId, userFormData);
      setSuccessMessage(res.message);
      setEditingUserId(null);
      setIsAddingUser(false);
    } else {
      const res = await addUserAccount(userFormData);
      if (res.success) {
        setSuccessMessage(res.message);
        setIsAddingUser(false);
        setUserFormData({
          username: '',
          displayName: '',
          role: 'HEAD_OF_DEPARTMENT',
          department: 'Tổ Chuyên môn',
          passwordHash: '',
          notes: ''
        });
      } else {
        setErrorMessage(res.message);
      }
    }
  };

  const handleDeleteSubUser = async (id: string) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa tài khoản này khỏi Cloud Firestore?')) {
      const res = await deleteUserAccount(id);
      if (res.success) setSuccessMessage(res.message);
      else setErrorMessage(res.message);
    }
  };

  const handleManualCloudSync = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const res = await syncToCloud();
    if (res.success) {
      setSuccessMessage(res.message);
    } else {
      setErrorMessage(res.message);
    }
  };

  const handleManualCloudFetch = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const res = await fetchFromCloud();
    if (res.success) {
      setSuccessMessage(res.message);
    } else {
      setErrorMessage(res.message);
    }
  };

  const handleSwitchSchoolTenant = (tenantId: string, tenantName?: string) => {
    setCurrentSchoolId(tenantId);
    if (tenantName) setCurrentSchoolName(tenantName);
    setSuccessMessage(`Đã chuyển đổi sang trường học: ${tenantName || tenantId}`);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 2000);
  };

  const handleCreateNewSchool = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = (newSchoolIdInput || slugifySchoolId(newSchoolNameInput)).trim();
    const cleanName = newSchoolNameInput.trim() || cleanId.toUpperCase();
    if (!cleanId) {
      setErrorMessage('Vui lòng nhập tên trường hoặc mã trường!');
      return;
    }

    setCurrentSchoolId(cleanId);
    setCurrentSchoolName(cleanName);
    setIsCreatingSchool(false);
    setNewSchoolNameInput('');
    setNewSchoolIdInput('');
    setSuccessMessage(`Đã khởi tạo phân vùng trường mới: "${cleanName}" (${cleanId})`);
    refreshAvailableSchools();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl sm:max-w-2xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2.5 bg-white/10 rounded-xl border border-white/20 shrink-0">
              <KeyRound className="w-5 h-5 text-yellow-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-base sm:text-lg text-white whitespace-nowrap flex-1 min-w-0">
                Hệ thống Quản trị & Phân quyền (RBAC)
              </h3>
              <p className="text-xs text-blue-100 flex items-center gap-1.5 mt-1 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>Trường: <strong>{currentSchoolName || 'TRƯỜNG THPT NGUYỄN BÌNH KHIÊM'}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center shrink-0">
            <div className="flex flex-col items-end justify-center gap-1.5 flex-shrink-0 pr-3">
              {role === 'ADMIN' ? (
                <>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500 text-white whitespace-nowrap shadow-sm">
                    <span>👑</span>
                    <span>Quản trị viên</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400 text-amber-950 whitespace-nowrap shadow-sm">
                    <span>🛡️</span>
                    <span>ADMIN ONLY</span>
                  </span>
                </>
              ) : (
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap shadow-sm ${
                  role === 'HEAD_OF_DEPARTMENT'
                    ? 'bg-purple-300 text-slate-950'
                    : role === 'TEACHER'
                    ? 'bg-emerald-300 text-slate-950'
                    : 'bg-amber-300 text-slate-950'
                }`}>
                  {role === 'HEAD_OF_DEPARTMENT' ? '🎖️ Tổ trưởng' : role === 'TEACHER' ? '👨‍🏫 Giáo viên' : '👁️ Khách (Chỉ xem)'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={closeLoginModal}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer shrink-0 ml-1"
              title="Đóng hộp thoại"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-3 pt-2 gap-1 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('login')}
            className={`px-3 py-2 border-b-2 rounded-t-lg transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'login'
                ? 'border-blue-600 text-blue-700 bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{currentUser ? 'Chuyển vai trò / Đăng nhập' : 'Đăng nhập'}</span>
          </button>

          <button
            onClick={() => setActiveTab('schools')}
            className={`px-3 py-2 border-b-2 rounded-t-lg transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'schools'
                ? 'border-blue-600 text-blue-700 bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <School className="w-3.5 h-3.5 text-blue-600" />
            <span>Đa trường học</span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('accounts')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'accounts'
                    ? 'border-blue-600 text-blue-700 bg-white shadow-2xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Tài khoản ({usersList.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={`px-3 py-2 border-b-2 rounded-t-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'security'
                    ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Đổi mật khẩu</span>
              </button>
            </>
          )}

          <button
            onClick={() => setActiveTab('cloud')}
            className={`px-3 py-2 border-b-2 rounded-t-lg transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'cloud'
                ? 'border-emerald-600 text-emerald-700 bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-emerald-600" />
            <span>Đám mây Firestore</span>
          </button>
        </div>

        {/* Status / Error Banner */}
        {errorMessage && (
          <div className="m-4 mb-0 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="m-4 mb-0 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successMessage}</span>
          </div>
        )}

        {/* TAB 1: LOGIN FORM & ROLE SELECTION MATRIX */}
        {activeTab === 'login' && (
          <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
            {/* Current user badge / status */}
            {currentUser ? (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-blue-600 font-bold uppercase">Đang đăng nhập:</span>
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 mt-0.5">
                    <span>{currentUser.displayName}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-semibold font-mono">
                      {role}
                    </span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5">Tài khoản: {currentUser.username} • {currentUser.department || 'Toàn trường'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setSuccessMessage('Đã đăng xuất về Chế độ Khách (Chỉ xem).');
                    setTimeout(() => setSuccessMessage(null), 1500);
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg font-bold text-xs transition cursor-pointer shadow-2xs"
                >
                  Đăng xuất (Về Khách)
                </button>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Chế độ hiện tại: Khách / Chưa đăng nhập (GUEST - Chỉ xem)</p>
                  <p className="mt-0.5 text-amber-800 leading-relaxed text-[11px]">
                    Toàn bộ phân hệ ở chế độ Chỉ xem. Hãy đăng nhập tài khoản theo đúng vai trò công tác bên dưới để mở khóa các tính năng tương ứng.
                  </p>
                </div>
              </div>
            )}

            {/* Role Selection Matrix (Ma trận 4 vai trò) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800">Ma trận Phân quyền & Chọn nhanh vai trò:</span>
                <span className="text-[11px] text-slate-400">Bấm để điền mẫu tài khoản</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* 1. ADMIN */}
                <button
                  type="button"
                  onClick={() => {
                    setUsernameInput('admin');
                    setPasswordInput('admin123');
                  }}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    usernameInput === 'admin' 
                      ? 'border-rose-400 bg-rose-50/70 ring-2 ring-rose-200' 
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      <span>👑</span> Quản trị viên
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-bold">
                      ADMIN
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 mt-1 line-clamp-2">
                    Toàn quyền: Thêm, Sửa, Xóa, Lưu, Chạy AI xếp TKB, Công bố & Gửi TKB.
                  </p>
                  <span className="text-[10px] text-rose-700 font-mono font-semibold block mt-1">
                    admin / admin123
                  </span>
                </button>

                {/* 2. HEAD_OF_DEPARTMENT */}
                <button
                  type="button"
                  onClick={() => {
                    setUsernameInput('totruong');
                    setPasswordInput('totruong123');
                  }}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    usernameInput === 'totruong' 
                      ? 'border-purple-400 bg-purple-50/70 ring-2 ring-purple-200' 
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      <span>🎖️</span> Tổ trưởng Chuyên môn
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold">
                      TỔ TRƯỞNG
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 mt-1 line-clamp-2">
                    Xem và duyệt nguyện vọng của tổ, xem phân công toàn trường.
                  </p>
                  <span className="text-[10px] text-purple-700 font-mono font-semibold block mt-1">
                    totruong / totruong123
                  </span>
                </button>

                {/* 3. TEACHER */}
                <button
                  type="button"
                  onClick={() => {
                    setUsernameInput('giaovien');
                    setPasswordInput('gv123');
                  }}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    usernameInput === 'giaovien' 
                      ? 'border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-200' 
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      <span>👨‍🏫</span> Giáo viên Bộ môn
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                      TEACHER
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 mt-1 line-clamp-2">
                    Xem TKB/phân công, tải file cá nhân, đăng ký tiết bận/tiết tránh.
                  </p>
                  <span className="text-[10px] text-emerald-700 font-mono font-semibold block mt-1">
                    giaovien / gv123
                  </span>
                </button>

                {/* 4. GUEST */}
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    closeLoginModal();
                  }}
                  className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      <span>👁️</span> Chế độ Khách
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-bold">
                      GUEST
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 mt-1 line-clamp-2">
                    Chỉ có quyền XEM (Read-only), không chỉnh sửa hoặc kích hoạt chức năng.
                  </p>
                  <span className="text-[10px] text-slate-600 font-mono font-semibold block mt-1">
                    Không cần đăng nhập
                  </span>
                </button>
              </div>
            </div>

            {/* Custom Login Form */}
            <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs bg-slate-50/70 p-3.5 rounded-xl border border-slate-200">
              <div className="font-bold text-slate-800">Đăng nhập tài khoản hệ thống:</div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tên đăng nhập (Username)</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                  placeholder="admin, totruong, giaovien..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mật khẩu *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    placeholder="Nhập mật khẩu..."
                    className="w-full p-2.5 pr-10 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={closeLoginModal}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold transition cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Xác nhận Đăng nhập</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 2: MULTI-TENANT SCHOOLS */}
        {activeTab === 'schools' && (
          <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh] text-xs">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-indigo-950">
              <div className="flex items-center gap-2">
                <School className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="font-bold text-sm">Kiến trúc Đa trường học (Multi-tenant)</span>
              </div>
              <p className="mt-1 text-indigo-800 leading-relaxed text-[11px]">
                Toàn bộ dữ liệu của mỗi trường được lưu độc lập tại path Firestore: 
                <code className="bg-white/80 px-1 py-0.5 rounded font-mono text-indigo-900 ml-1 font-semibold">/schools/{'{schoolId}'}/...</code>. 
                Các trường không bị trùng lặp hay ghi đè lịch của nhau.
              </p>
            </div>

            {/* Current Active School Banner */}
            <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Trường đang làm việc:</span>
                <h4 className="text-sm font-bold text-slate-900">{currentSchoolName}</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">Mã Tenant: {currentSchoolId}</p>
              </div>
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[10px] flex items-center gap-1">
                <Check className="w-3 h-3" /> Đang kích hoạt
              </span>
            </div>

            {/* Logo trường (Chỉ Admin) */}
            {isAdmin && (
              <div className="bg-gradient-to-r from-blue-50/80 via-indigo-50/60 to-slate-50 border border-indigo-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="w-13 h-13 rounded-full border-2 border-indigo-300 bg-white p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                    <SchoolLogo 
                      customLogo={localCustomLogo} 
                      alt="Logo THPT Nguyễn Bỉnh Khiêm (An Giang)" 
                      className="w-full h-full rounded-full object-contain"
                    />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <School className="w-3.5 h-3.5 text-blue-600" />
                      Logo thương hiệu trường ({currentSchoolName})
                    </h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Đồng bộ đám mây Firestore theo mã trường: <code className="font-mono text-indigo-700 bg-indigo-100/60 px-1 py-0.2 rounded font-semibold">{currentSchoolId}</code>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                  <label className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg cursor-pointer transition flex items-center gap-1.5 shadow-2xs">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isUpdatingLogo ? "Đang xử lý..." : "Đổi Logo"}</span>
                    <input 
                      type="file" 
                      accept="image/*" 
                      disabled={isUpdatingLogo}
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          setIsUpdatingLogo(true);
                          const base64Data = await resizeImageToBase64(file, 200);
                          setLocalCustomLogo(base64Data);
                          await saveSchoolCustomLogo(currentSchoolId, base64Data);
                          setSuccessMessage("Đã lưu và đồng bộ Logo mới lên Đám mây Firestore (" + currentSchoolId + ")!");
                          setTimeout(() => setSuccessMessage(null), 3000);
                        } catch (err: any) {
                          console.error("Error uploading logo:", err);
                          setErrorMessage("Lỗi tải ảnh logo: " + (err.message || "Không thể nén ảnh"));
                          setTimeout(() => setErrorMessage(null), 3500);
                        } finally {
                          setIsUpdatingLogo(false);
                          e.target.value = "";
                        }
                      }} 
                    />
                  </label>
                  {localCustomLogo && (
                    <button
                      type="button"
                      disabled={isUpdatingLogo}
                      onClick={async () => {
                        try {
                          setIsUpdatingLogo(true);
                          setLocalCustomLogo(null);
                          await saveSchoolCustomLogo(currentSchoolId, null);
                          setSuccessMessage("Đã khôi phục về Logo chuẩn mới của nhà trường và đồng bộ lên Đám mây!");
                          setTimeout(() => setSuccessMessage(null), 3000);
                        } catch (err: any) {
                          console.error("Error resetting logo:", err);
                          setErrorMessage("Lỗi khôi phục logo: " + (err.message || "Thử lại sau"));
                          setTimeout(() => setErrorMessage(null), 3500);
                        } finally {
                          setIsUpdatingLogo(false);
                        }
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer transition"
                      title="Khôi phục logo mặc định chuẩn của trường"
                    >
                      Khôi phục gốc
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Available Schools list from Firestore */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">Danh sách các trường trên Đám mây ({availableSchools.length}):</span>
                <button
                  type="button"
                  onClick={refreshAvailableSchools}
                  className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Làm mới
                </button>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {availableSchools.map(sch => (
                  <div 
                    key={sch.id}
                    className={`p-2.5 rounded-lg border transition flex items-center justify-between ${
                      sch.id === currentSchoolId 
                        ? 'bg-blue-50/60 border-blue-300 ring-1 ring-blue-300' 
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900">{sch.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{sch.id}</div>
                    </div>
                    {sch.id === currentSchoolId ? (
                      <span className="text-[11px] font-bold text-blue-700">Đang chọn</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSwitchSchoolTenant(sch.id, sch.name)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded text-[11px] font-semibold transition cursor-pointer"
                      >
                        Chuyển sang trường này
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Create new school tenant */}
            {isAdmin && (
              <div className="pt-2 border-t border-slate-200">
                {!isCreatingSchool ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingSchool(true)}
                    className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-dashed border-indigo-300 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <School className="w-4 h-4" />
                    <span>+ Đăng ký / Thêm trường học mới (Tenant)</span>
                  </button>
                ) : (
                  <form onSubmit={handleCreateNewSchool} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="font-bold text-slate-800">Thêm trường mới vào hệ thống</div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Tên trường đầy đủ *</label>
                      <input
                        type="text"
                        required
                        value={newSchoolNameInput}
                        onChange={e => {
                          setNewSchoolNameInput(e.target.value);
                          if (!newSchoolIdInput) {
                            setNewSchoolIdInput(slugifySchoolId(e.target.value));
                          }
                        }}
                        placeholder="Ví dụ: TRƯỜNG THPT CHUYÊN THOẠI NGỌC HẦU"
                        className="w-full p-2 border border-slate-300 rounded bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Mã định danh (School ID slug) *</label>
                      <input
                        type="text"
                        required
                        value={newSchoolIdInput}
                        onChange={e => setNewSchoolIdInput(slugifySchoolId(e.target.value))}
                        placeholder="thpt-chuyen-thoai-ngoc-hau"
                        className="w-full p-2 border border-slate-300 rounded bg-white font-mono text-xs"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsCreatingSchool(false)}
                        className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded font-semibold text-xs"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-xs transition"
                      >
                        Khởi tạo & Chọn trường này
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACCOUNTS MANAGEMENT */}
        {isAdmin && activeTab === 'accounts' && (
          <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh] text-xs">
            {/* Banner mở giao diện phân quyền chi tiết */}
            {onOpenUserManagement && (
              <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 rounded-xl p-3.5 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-white/10 rounded-lg border border-white/20 shrink-0">
                    <ShieldCheck className="w-4 h-4 text-yellow-300" />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-white">Bảng Quản lý tài khoản & Phân quyền nâng cao</h5>
                    <p className="text-[11px] text-blue-100 mt-0.5">
                      Bảng trực quan 18 quyền hạn, liên kết giáo viên trường, bảo vệ tài khoản gốc
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeLoginModal();
                    onOpenUserManagement();
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-blue-50 text-blue-800 font-bold rounded-lg text-xs transition cursor-pointer shadow-2xs whitespace-nowrap"
                >
                  Mở Bảng phân quyền chi tiết
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Danh sách tài khoản ({currentSchoolId})</h4>
                <p className="text-[11px] text-slate-500">Đồng bộ hai chiều theo thời gian thực qua Cloud Firestore</p>
              </div>
              {!isAddingUser && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingUserId(null);
                    setUserFormData({
                      username: '',
                      displayName: '',
                      role: 'HEAD_OF_DEPARTMENT',
                      department: 'Tổ Chuyên môn',
                      passwordHash: '',
                      notes: ''
                    });
                    setIsAddingUser(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Thêm tài khoản</span>
                </button>
              )}
            </div>

            {/* Form add/edit */}
            {isAddingUser && (
              <form onSubmit={handleSaveSubUser} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="font-bold text-slate-800">
                  {editingUserId ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản người dùng mới'}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tên đăng nhập *</label>
                    <input
                      type="text"
                      required
                      value={userFormData.username}
                      onChange={e => setUserFormData({ ...userFormData, username: e.target.value })}
                      placeholder="totruong_toan"
                      className="w-full p-2 border border-slate-300 rounded bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Họ tên hiển thị *</label>
                    <input
                      type="text"
                      required
                      value={userFormData.displayName}
                      onChange={e => setUserFormData({ ...userFormData, displayName: e.target.value })}
                      placeholder="Thầy Nguyễn Văn A"
                      className="w-full p-2 border border-slate-300 rounded bg-white text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Vai trò & Quyền hạn *</label>
                    <select
                      value={userFormData.role}
                      onChange={e => setUserFormData({ ...userFormData, role: normalizeRole(e.target.value) })}
                      className="w-full p-2 border border-slate-300 rounded bg-white font-semibold text-xs"
                    >
                      <option value="ADMIN">Ban Giám Hiệu (Toàn quyền Admin)</option>
                      <option value="HEAD_OF_DEPARTMENT">Tổ trưởng Chuyên môn (Xem & duyệt nguyện vọng tổ)</option>
                      <option value="TEACHER">Giáo viên Bộ môn (Xem TKB, tải file, đăng ký tiết bận)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Mật khẩu khởi tạo *</label>
                    <input
                      type="password"
                      required
                      value={userFormData.passwordHash}
                      onChange={e => setUserFormData({ ...userFormData, passwordHash: e.target.value })}
                      placeholder="Nhập mật khẩu..."
                      className="w-full p-2 border border-slate-300 rounded bg-white text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingUser(false);
                      setEditingUserId(null);
                    }}
                    className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 font-semibold text-xs cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs transition cursor-pointer shadow-2xs"
                  >
                    Lưu vào Cloud Firestore
                  </button>
                </div>
              </form>
            )}

            {/* Accounts list */}
            <div className="space-y-2">
              {usersList.map(u => {
                const uRole = normalizeRole(u.role);
                return (
                  <div key={u.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-900">{u.displayName}</strong>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          uRole === 'ADMIN' 
                            ? 'bg-rose-100 text-rose-800 border-rose-200' 
                            : uRole === 'HEAD_OF_DEPARTMENT'
                            ? 'bg-purple-100 text-purple-800 border-purple-200'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}>
                          {uRole === 'ADMIN' ? '👑 Quản trị viên' : uRole === 'HEAD_OF_DEPARTMENT' ? '🎖️ Tổ trưởng CM' : '👨‍🏫 Giáo viên'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Username: <strong>{u.username}</strong> • Tổ: {u.department || 'Toàn trường'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(u.id);
                          setUserFormData({
                            username: u.username,
                            displayName: u.displayName,
                            role: uRole,
                            department: u.department || '',
                            passwordHash: u.passwordHash,
                            notes: u.notes || ''
                          });
                          setIsAddingUser(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition cursor-pointer"
                        title="Sửa thông tin"
                      >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {u.id !== 'admin_root' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSubUser(u.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                        title="Xóa tài khoản"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: SECURITY (CHANGE ADMIN PASSWORD) */}
        {isAdmin && activeTab === 'security' && (
          <div className="p-5 space-y-4 text-xs">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-indigo-900">
              <p className="font-bold">Đổi Mật khẩu Quản trị viên (Admin)</p>
              <p className="mt-0.5 text-indigo-700">Mật khẩu mới sẽ được đồng bộ trực tiếp lên Cloud Firestore và áp dụng trên tất cả thiết bị.</p>
            </div>

            <form onSubmit={handleChangePasswordSubmit} className="space-y-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Mật khẩu hiện tại *</label>
                <input
                  type="password"
                  required
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  placeholder="Mật khẩu cũ (mặc định admin123)..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Xác nhận mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition"
                >
                  Cập nhật mật khẩu lên Đám mây
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 5: CLOUD FIRESTORE STATUS & CONFIG */}
        {activeTab === 'cloud' && (
          <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh] text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-950">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold text-sm">Trạng thái Kết nối Cloud Firestore</span>
              </div>
              <p className="mt-1 text-emerald-800 leading-relaxed text-[11px]">
                Ứng dụng đã kết nối với cơ sở dữ liệu thời gian thực Cloud Firestore (Dự án: <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold text-emerald-900">qlgd-tkb</code>).
                Dữ liệu tự động cập nhật đến tất cả các tab trình duyệt và thiết bị người dùng.
              </p>
            </div>

            {/* Connection Diagnostics Card */}
            <div className="space-y-3 bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-bold text-slate-800">Thông số kỹ thuật Cloud Firestore:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                  cloudConnectionStatus === 'connected' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : cloudConnectionStatus === 'syncing'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cloudConnectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                  {cloudConnectionStatus === 'connected' ? 'Đã kết nối' : cloudConnectionStatus === 'syncing' ? 'Đang đồng bộ' : 'Ngoại tuyến'}
                </span>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-600">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Firebase Project ID:</span>
                  <span className="font-mono font-bold text-slate-900">qlgd-tkb</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Auth Domain:</span>
                  <span className="font-mono text-slate-800">qlgd-tkb.firebaseapp.com</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Mã trường hiện tại (Tenant ID):</span>
                  <span className="font-mono font-bold text-blue-700">{currentSchoolId}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Đồng bộ thời gian thực:</span>
                  <span className="font-bold text-emerald-700">Bật (onSnapshot)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Lần lưu / đồng bộ gần nhất:</span>
                  <span className="font-semibold text-slate-800">{lastSyncedAt || 'Chưa thực hiện lưu'}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={handleManualCloudFetch}
                  disabled={isSyncing}
                  className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Tải lại từ Firestore</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleManualCloudSync}
                    disabled={isSyncing}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition text-xs flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Cloud className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>Lưu lên Cloud Firestore ngay</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs">
          <div className="text-slate-500 text-[11px] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Firestore: <strong>qlgd-tkb</strong> • Tenant: <strong>{currentSchoolId}</strong></span>
          </div>
          <button
            type="button"
            onClick={closeLoginModal}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-200 font-semibold transition"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
};
