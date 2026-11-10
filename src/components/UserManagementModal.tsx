import React, { useState, useMemo } from 'react';
import { 
  Users, UserPlus, Shield, ShieldCheck, ShieldAlert, KeyRound, Lock, 
  Unlock, Check, X, Search, Trash2, Edit3, CheckSquare, Square, 
  AlertCircle, CheckCircle2, ChevronRight, UserCheck, RefreshCw, Eye, EyeOff
} from 'lucide-react';
import { useAuth, UserAccount, AppRole, normalizeRole } from '../utils/authContext';
import { 
  PERMISSION_GROUPS, 
  ALL_PERMISSION_KEYS, 
  ROLE_PRESET_PERMISSIONS, 
  getRolePresetPermissions,
  PERMISSION_CODES
} from '../utils/permissionConstants';

export interface TeacherOption {
  id: string;
  name: string;
  department?: string;
  subject?: string;
}

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  teachers?: TeacherOption[];
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  teachers = []
}) => {
  const { 
    currentUser, 
    isAdmin, 
    usersList, 
    addUserAccount, 
    updateUserAccount, 
    deleteUserAccount,
    currentSchoolId,
    currentSchoolName
  } = useAuth();

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | AppRole>('ALL');

  // Form modal state (Add / Edit)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // Form fields
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [department, setDepartment] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<AppRole>('TEACHER');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Password reset modal state
  const [resetModalUserId, setResetModalUserId] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Feedback notifications
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fallback teacher list from localStorage if not passed
  const availableTeachers: TeacherOption[] = useMemo(() => {
    if (teachers && teachers.length > 0) return teachers;
    try {
      const saved = localStorage.getItem('edu_teachers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((t: any) => ({
            id: t.id,
            name: t.name || t.fullName,
            department: t.department || t.toChuyenMon,
            subject: t.subject || t.monGiangDay
          }));
        }
      }
    } catch {}
    return [];
  }, [teachers]);

  // Filtered accounts list (MUST be declared at top with all hooks before any conditional return)
  const filteredUsers = useMemo(() => {
    return usersList.filter(u => {
      const uRole = normalizeRole(u.role);
      if (roleFilter !== 'ALL' && uRole !== roleFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const matchUser = u.username.toLowerCase().includes(q);
      const matchName = (u.fullName || u.displayName || '').toLowerCase().includes(q);
      const matchDept = (u.department || '').toLowerCase().includes(q);
      return matchUser || matchName || matchDept;
    });
  }, [usersList, roleFilter, searchQuery]);

  if (!isOpen) return null;

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 3500);
  };

  // Open Add modal with defaults
  const handleOpenAdd = () => {
    setEditingUserId(null);
    setUsername('');
    setFullName('');
    setSelectedTeacherId('');
    setDepartment('Tổ Toán - Tin');
    setPassword('123456');
    setRole('TEACHER');
    setIsActive(true);
    setSelectedPermissions(ROLE_PRESET_PERMISSIONS.TEACHER);
    setNotes('');
    setIsFormOpen(true);
  };

  // Open Edit modal populated with existing user data
  const handleOpenEdit = (user: UserAccount) => {
    setEditingUserId(user.id);
    setUsername(user.username);
    setFullName(user.fullName || user.displayName);
    setSelectedTeacherId(user.teacherId || '');
    setDepartment(user.department || '');
    setPassword(user.passwordHash || '');
    const userRole = normalizeRole(user.role);
    setRole(userRole);
    setIsActive(user.isActive !== false);
    
    // Fallback to role presets if permissions array is missing
    const userPerms = (user.permissions && user.permissions.length > 0)
      ? user.permissions
      : getRolePresetPermissions(userRole);
    setSelectedPermissions(userPerms);
    setNotes(user.notes || '');
    setIsFormOpen(true);
  };

  // When Role Preset is changed: automatically sync default permissions
  const handleRolePresetChange = (newRole: AppRole) => {
    setRole(newRole);
    const preset = getRolePresetPermissions(newRole);
    setSelectedPermissions(preset);
  };

  // When Teacher is selected from dropdown: auto-fill name & link teacherId
  const handleTeacherSelect = (teacherId: string) => {
    setSelectedTeacherId(teacherId);
    if (!teacherId) return;
    const found = availableTeachers.find(t => t.id === teacherId);
    if (found) {
      setFullName(found.name);
      if (found.department) {
        setDepartment(found.department);
      }
      if (!username) {
        // Auto-generate clean username: gv_nguyenvana
        const slug = found.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
        setUsername(`gv_${slug}`);
      }
    }
  };

  // Permission toggle helpers
  const togglePermission = (code: string) => {
    setSelectedPermissions(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const toggleGroupPermissions = (groupCodes: string[]) => {
    const allSelected = groupCodes.every(c => selectedPermissions.includes(c));
    if (allSelected) {
      setSelectedPermissions(prev => prev.filter(c => !groupCodes.includes(c)));
    } else {
      setSelectedPermissions(prev => Array.from(new Set([...prev, ...groupCodes])));
    }
  };

  const selectAllPermissions = () => {
    setSelectedPermissions([...ALL_PERMISSION_KEYS]);
  };

  const clearAllPermissions = () => {
    setSelectedPermissions([]);
  };

  // Form submit handler
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      showNotification('error', 'Vui lòng nhập Tên đăng nhập!');
      return;
    }
    if (!password.trim()) {
      showNotification('error', 'Vui lòng nhập Mật khẩu cho tài khoản!');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanName = fullName.trim() || username.trim();
      const payload = {
        username: username.trim(),
        fullName: cleanName,
        displayName: cleanName,
        role,
        department: department.trim() || 'Toàn trường',
        passwordHash: password.trim(),
        teacherId: selectedTeacherId || undefined,
        isActive,
        permissions: role === 'ADMIN' ? ALL_PERMISSION_KEYS : selectedPermissions,
        notes: notes.trim()
      };

      if (editingUserId) {
        const res = await updateUserAccount(editingUserId, payload);
        if (res.success) {
          showNotification('success', res.message);
          setIsFormOpen(false);
        } else {
          showNotification('error', res.message);
        }
      } else {
        const res = await addUserAccount(payload);
        if (res.success) {
          showNotification('success', res.message);
          setIsFormOpen(false);
        } else {
          showNotification('error', res.message);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick toggle active status
  const handleToggleUserActive = async (user: UserAccount) => {
    if (user.id === 'admin_root' || user.username.toLowerCase() === 'admin') {
      showNotification('error', 'Bảo vệ hệ thống: Không thể khóa tài khoản Quản trị viên gốc.');
      return;
    }
    const newStatus = user.isActive === false ? true : false;
    const res = await updateUserAccount(user.id, { isActive: newStatus });
    if (res.success) {
      showNotification('success', `Đã ${newStatus ? 'mở khóa' : 'tạm khóa'} tài khoản "${user.displayName}".`);
    } else {
      showNotification('error', res.message);
    }
  };

  // Quick password reset handler
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUserId || !newPasswordInput.trim()) {
      showNotification('error', 'Vui lòng nhập mật khẩu mới!');
      return;
    }
    const res = await updateUserAccount(resetModalUserId, { passwordHash: newPasswordInput.trim() });
    if (res.success) {
      showNotification('success', 'Đã đặt lại mật khẩu tài khoản thành công!');
      setResetModalUserId(null);
      setNewPasswordInput('');
    } else {
      showNotification('error', res.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* MODAL HEADER */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2.5 bg-white/10 rounded-xl border border-white/20 shadow-inner shrink-0">
              <ShieldCheck className="w-5 h-5 text-yellow-300" />
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
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500 text-white whitespace-nowrap shadow-sm">
                <span>👑</span>
                <span>Quản trị viên</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400 text-amber-950 whitespace-nowrap shadow-sm">
                <span>🛡️</span>
                <span>ADMIN ONLY</span>
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white p-2 rounded-xl hover:bg-white/10 transition cursor-pointer shrink-0 ml-1"
              title="Đóng (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NOTIFICATION BANNER */}
        {statusMessage && (
          <div className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 shrink-0 ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border-b border-rose-200'
          }`}>
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* TOOLBAR: SEARCH, ROLE FILTER & ADD BUTTON */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm theo username, họ tên giáo viên, tổ bộ môn..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-800 placeholder-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Role Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-1 text-xs">
              <button
                type="button"
                onClick={() => setRoleFilter('ALL')}
                className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                  roleFilter === 'ALL' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả ({usersList.length})
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('ADMIN')}
                className={`px-2 py-1 rounded font-medium transition cursor-pointer ${
                  roleFilter === 'ADMIN' ? 'bg-rose-600 text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('HEAD_OF_DEPARTMENT')}
                className={`px-2 py-1 rounded font-medium transition cursor-pointer ${
                  roleFilter === 'HEAD_OF_DEPARTMENT' ? 'bg-purple-600 text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tổ trưởng
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('TEACHER')}
                className={`px-2 py-1 rounded font-medium transition cursor-pointer ${
                  roleFilter === 'TEACHER' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Giáo viên
              </button>
            </div>
          </div>

          {/* Add user button */}
          <button
            type="button"
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-xs cursor-pointer active:scale-95 text-xs sm:text-sm shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Thêm tài khoản mới</span>
          </button>
        </div>

        {/* TABLE VIEW OF USER ACCOUNTS */}
        <div className="flex-1 overflow-auto p-4">
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <th className="py-3 px-3.5">Tên đăng nhập / Email</th>
                  <th className="py-3 px-3.5">Họ và tên giáo viên</th>
                  <th className="py-3 px-3.5 text-center">Vai trò mặc định</th>
                  <th className="py-3 px-3.5 text-center">Quyền tùy biến</th>
                  <th className="py-3 px-3.5 text-center">Trạng thái</th>
                  <th className="py-3 px-3.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                      Không tìm thấy tài khoản người dùng phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const uRole = normalizeRole(u.role);
                    const isRootAdmin = u.id === 'admin_root' || u.username.toLowerCase() === 'admin';
                    const isAccountActive = u.isActive !== false;
                    const permsCount = uRole === 'ADMIN' 
                      ? ALL_PERMISSION_KEYS.length 
                      : (u.permissions ? u.permissions.length : getRolePresetPermissions(uRole).length);

                    return (
                      <tr 
                        key={u.id} 
                        className={`hover:bg-slate-50/80 transition ${
                          !isAccountActive ? 'bg-slate-50/50 opacity-75' : ''
                        }`}
                      >
                        {/* 1. Tên đăng nhập */}
                        <td className="py-3 px-3.5 font-mono font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                              <Users className="w-3.5 h-3.5" />
                            </span>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span>{u.username}</span>
                                {isRootAdmin && (
                                  <span className="text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.2 rounded font-sans font-bold">
                                    Gốc
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-sans block">
                                Tạo: {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* 2. Họ và tên giáo viên */}
                        <td className="py-3 px-3.5 font-medium text-slate-900">
                          <div>
                            <span className="font-bold text-slate-800 text-[13px]">
                              {u.fullName || u.displayName}
                            </span>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <span>Tổ: {u.department || 'Toàn trường'}</span>
                              {u.teacherId && (
                                <>
                                  <span>•</span>
                                  <span className="text-blue-600 font-semibold">Mã GV: {u.teacherId}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 3. Vai trò */}
                        <td className="py-3 px-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                            uRole === 'ADMIN'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : uRole === 'HEAD_OF_DEPARTMENT'
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}>
                            {uRole === 'ADMIN' ? '👑 Admin' : uRole === 'HEAD_OF_DEPARTMENT' ? '🎖️ Tổ trưởng' : '👨‍🏫 Giáo viên'}
                          </span>
                        </td>

                        {/* 4. Số quyền tùy biến */}
                        <td className="py-3 px-3.5 text-center">
                          {uRole === 'ADMIN' ? (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-900 font-bold rounded-full text-[10.5px] border border-amber-200">
                              18/18 (Toàn quyền)
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded-full text-[10.5px] border border-slate-200">
                              {permsCount} / {ALL_PERMISSION_KEYS.length} quyền
                            </span>
                          )}
                        </td>

                        {/* 5. Trạng thái hoạt động */}
                        <td className="py-3 px-3.5 text-center">
                          {isRootAdmin ? (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Hoạt động (Cố định)
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleUserActive(u)}
                              className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full border transition cursor-pointer ${
                                isAccountActive
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                              }`}
                              title={isAccountActive ? 'Bấm để tạm khóa tài khoản' : 'Bấm để kích hoạt lại tài khoản'}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${isAccountActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                              <span>{isAccountActive ? 'Hoạt động' : 'Tạm khóa'}</span>
                            </button>
                          )}
                        </td>

                        {/* 6. Thao tác */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {/* Nút sửa quyền & thông tin */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(u)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                              title="Chỉnh sửa thông tin & cấu hình phân quyền chi tiết"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            {/* Nút đổi mật khẩu */}
                            <button
                              type="button"
                              onClick={() => {
                                setResetModalUserId(u.id);
                                setNewPasswordInput('');
                              }}
                              className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                              title="Đặt lại mật khẩu cho tài khoản này"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>

                            {/* Nút xóa tài khoản */}
                            {isRootAdmin ? (
                              <span 
                                className="p-1.5 text-slate-300 cursor-not-allowed" 
                                title="Bảo vệ hệ thống: Không thể xóa tài khoản Quản trị viên gốc"
                              >
                                <Trash2 className="w-4 h-4" />
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (confirm(`Thầy/cô có chắc chắn muốn xóa vĩnh viễn tài khoản "${u.displayName || u.username}"?`)) {
                                    const res = await deleteUserAccount(u.id);
                                    if (res.success) {
                                      showNotification('success', res.message);
                                    } else {
                                      showNotification('error', res.message);
                                    }
                                  }
                                }}
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                title="Xóa tài khoản này"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
            <span>Tổng cộng: <strong>{usersList.length}</strong> tài khoản đã đăng ký trên Cloud Firestore</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-100 font-semibold transition cursor-pointer"
          >
            Đóng
          </button>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* MODAL 2: THÊM MỚI / CHỈNH SỬA TÀI KHOẢN VỚI MA TRẬN PHÂN QUYỀN 2 CỘT */}
      {/* ========================================================================= */}
      {isFormOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            
            {/* Form Header */}
            <div className="bg-gradient-to-r from-indigo-700 to-blue-700 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-lg border border-white/20">
                  <Shield className="w-4 h-4 text-yellow-300" />
                </div>
                <div>
                  <h4 className="font-bold text-sm sm:text-base">
                    {editingUserId ? 'Chỉnh sửa tài khoản & Phân quyền' : 'Thêm tài khoản người dùng mới'}
                  </h4>
                  <p className="text-[11px] text-blue-100">
                    Thiết lập thông tin cá nhân và tích chọn quyền theo 5 nhóm nghiệp vụ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Content - 2 Columns */}
            <form onSubmit={handleSaveUser} className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                {/* CỘT TRÁI (4/12): THÔNG TIN CƠ BẢN & VAI TRÒ MẪU */}
                <div className="lg:col-span-4 space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-200">
                    <Users className="w-3.5 h-3.5 text-blue-600" />
                    <span>A. Thông tin tài khoản</span>
                  </h5>

                  {/* 1. Tên đăng nhập */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Tên đăng nhập (Username) *
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      disabled={editingUserId === 'admin_root' || username === 'admin'}
                      placeholder="gv_toan01"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-mono text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>

                  {/* 2. Chọn giáo viên liên kết */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Liên kết với Giáo viên trường:
                    </label>
                    <select
                      value={selectedTeacherId}
                      onChange={e => handleTeacherSelect(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-slate-900"
                    >
                      <option value="">-- Nhập tự do (Không liên kết) --</option>
                      {availableTeachers.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.department || t.subject || t.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 3. Họ và tên hiển thị */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Họ và tên giáo viên / cán bộ *
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="Thầy Nguyễn Văn A"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-slate-900"
                    />
                  </div>

                  {/* 4. Mật khẩu */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Mật khẩu *
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Nhập mật khẩu..."
                        className="w-full pl-2.5 pr-8 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* 5. Tổ chuyên môn */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Tổ chuyên môn:
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={e => setDepartment(e.target.value)}
                      placeholder="Tổ Toán - Tin"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-slate-900"
                    />
                  </div>

                  {/* 6. Chọn vai trò mẫu (Role Preset) */}
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Vai trò mẫu (Role Preset):
                    </label>
                    <div className="space-y-1.5">
                      {[
                        { 
                          key: 'ADMIN' as AppRole, 
                          label: '👑 Ban Giám Hiệu (Admin)', 
                          desc: 'Toàn quyền tất cả các phân hệ',
                          disabled: editingUserId === 'admin_root' ? false : false
                        },
                        { 
                          key: 'HEAD_OF_DEPARTMENT' as AppRole, 
                          label: '🎖️ Tổ trưởng chuyên môn', 
                          desc: 'Duyệt nguyện vọng tổ & xem phân công',
                          disabled: editingUserId === 'admin_root'
                        },
                        { 
                          key: 'TEACHER' as AppRole, 
                          label: '👨‍🏫 Giáo viên bộ môn', 
                          desc: 'Xem TKB, tải file, đăng ký lịch bận',
                          disabled: editingUserId === 'admin_root'
                        }
                      ].map(r => (
                        <label 
                          key={r.key}
                          className={`p-2 rounded-lg border flex items-start gap-2 cursor-pointer transition ${
                            role === r.key 
                              ? 'border-blue-500 bg-blue-50/80 ring-1 ring-blue-300' 
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          } ${r.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="rolePreset"
                            value={r.key}
                            checked={role === r.key}
                            disabled={r.disabled}
                            onChange={() => handleRolePresetChange(r.key)}
                            className="mt-0.5 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="text-[11px]">
                            <div className="font-bold text-slate-800">{r.label}</div>
                            <div className="text-[10px] text-slate-500">{r.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 7. Trạng thái hoạt động */}
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Trạng thái tài khoản:
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                        <input
                          type="radio"
                          name="accountActiveState"
                          checked={isActive === true}
                          disabled={editingUserId === 'admin_root'}
                          onChange={() => setIsActive(true)}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-semibold text-emerald-700">Đang hoạt động</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                        <input
                          type="radio"
                          name="accountActiveState"
                          checked={isActive === false}
                          disabled={editingUserId === 'admin_root'}
                          onChange={() => setIsActive(false)}
                          className="text-rose-600 focus:ring-rose-500"
                        />
                        <span className="font-semibold text-rose-700">Tạm khóa</span>
                      </label>
                    </div>
                  </div>

                </div>

                {/* CỘT PHẢI (8/12): DANH SÁCH TÍCH CHỌN QUYỀN CHI TIẾT (5 NHÓM) */}
                <div className="lg:col-span-8 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                    <div>
                      <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>B. Danh sách tích chọn quyền chi tiết</span>
                      </h5>
                      <span className="text-[11px] text-slate-500">
                        Đã chọn: <strong className="text-blue-700">{role === 'ADMIN' ? 18 : selectedPermissions.length} / 18 quyền</strong>
                      </span>
                    </div>

                    {role !== 'ADMIN' && (
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={selectAllPermissions}
                          className="px-2 py-0.5 text-blue-700 hover:bg-blue-50 border border-blue-200 rounded font-semibold cursor-pointer"
                        >
                          Chọn tất cả 18 quyền
                        </button>
                        <button
                          type="button"
                          onClick={clearAllPermissions}
                          className="px-2 py-0.5 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded font-semibold cursor-pointer"
                        >
                          Bỏ chọn tất cả
                        </button>
                      </div>
                    )}
                  </div>

                  {role === 'ADMIN' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <strong>Tài khoản Quản trị viên (Admin):</strong>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          Tài khoản này tự động sở hữu toàn bộ 18 quyền hạn trên hệ thống để thực hiện các tác vụ điều hành trường học.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 5 Functional Permission Groups */}
                  <div className="space-y-3.5">
                    {PERMISSION_GROUPS.map((group) => {
                      const groupCodes = group.permissions.map(p => p.code);
                      const isGroupAllSelected = role === 'ADMIN' || groupCodes.every(c => selectedPermissions.includes(c));
                      const selectedInGroup = role === 'ADMIN' 
                        ? groupCodes.length 
                        : groupCodes.filter(c => selectedPermissions.includes(c)).length;

                      return (
                        <div 
                          key={group.id} 
                          className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs"
                        >
                          {/* Group header */}
                          <div className="bg-slate-50/90 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-800">{group.title}</span>
                              <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-1.5 py-0.2 rounded">
                                {selectedInGroup} / {group.permissions.length}
                              </span>
                            </div>
                            {role !== 'ADMIN' && (
                              <button
                                type="button"
                                onClick={() => toggleGroupPermissions(groupCodes)}
                                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                              >
                                {isGroupAllSelected ? 'Bỏ chọn nhóm' : 'Chọn cả nhóm'}
                              </button>
                            )}
                          </div>

                          {/* Group permissions list */}
                          <div className="p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            {group.permissions.map((perm) => {
                              const isChecked = role === 'ADMIN' || selectedPermissions.includes(perm.code);

                              return (
                                <label
                                  key={perm.code}
                                  className={`p-2 rounded-lg border transition cursor-pointer flex items-start gap-2.5 ${
                                    isChecked
                                      ? 'border-blue-300 bg-blue-50/40 text-slate-900'
                                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                                  } ${role === 'ADMIN' ? 'cursor-default' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={role === 'ADMIN'}
                                    onChange={() => togglePermission(perm.code)}
                                    className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-default"
                                  />
                                  <div className="leading-tight">
                                    <div className="font-semibold text-slate-900 text-[11.5px]">
                                      {perm.label}
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
                                      {perm.description}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>

              </div>

              {/* Form Actions Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-100 font-semibold text-xs cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang lưu...' : (editingUserId ? 'Cập nhật tài khoản & Quyền' : 'Tạo mới tài khoản')}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ĐẶT LẠI MẬT KHẨU NHANH */}
      {/* ========================================================================= */}
      {resetModalUserId && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-sm w-full p-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-amber-600" />
                <span>Đặt lại mật khẩu</span>
              </h4>
              <button
                type="button"
                onClick={() => setResetModalUserId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu mới cho tài khoản:
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPasswordInput}
                    onChange={e => setNewPasswordInput(e.target.value)}
                    placeholder="Nhập mật khẩu mới..."
                    className="w-full pl-3 pr-8 py-2 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalUserId(null)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-xs cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition cursor-pointer shadow-xs"
                >
                  Xác nhận đổi mật khẩu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
