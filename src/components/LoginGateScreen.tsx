import React, { useState } from 'react';
import { Lock, User, Eye, EyeOff, AlertCircle, ShieldCheck, LogIn } from 'lucide-react';
import { useAuth } from '../utils/authContext';
import { SchoolLogo } from './SchoolLogo';

interface LoginGateScreenProps {
  customLogo?: string | null;
  schoolName?: string;
  departmentName?: string;
}

export const LoginGateScreen: React.FC<LoginGateScreenProps> = ({
  customLogo,
  schoolName,
  departmentName
}) => {
  const { login, authNotice, clearAuthNotice, currentSchoolName } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resolvedSchoolName = (
    schoolName ||
    currentSchoolName ||
    'TRƯỜNG THPT NGUYỄN BỈNH KHIÊM'
  ).toUpperCase();

  const resolvedDeptName = (
    departmentName ||
    'SỞ GIÁO DỤC VÀ ĐÀO TẠO AN GIANG'
  ).toUpperCase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (authNotice) clearAuthNotice();

    if (!username.trim()) {
      setErrorMessage('Vui lòng nhập Tên đăng nhập / Email.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Vui lòng nhập Mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = login(password, username);
      if (!res.success) {
        setErrorMessage(res.message || 'Tên đăng nhập / Email hoặc mật khẩu không chính xác.');
      } else {
        setUsername('');
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden select-none"
      style={{
        background: 'linear-gradient(135deg, #071933 0%, #0b2447 45%, #122e5c 100%)'
      }}
    >
      {/* Subtle geometric radial accents */}
      <div
        className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #10b981 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }}
      />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden">
          {/* School Identity Header */}
          <div
            className="px-6 pt-7 pb-6 text-center text-white relative"
            style={{
              background: 'linear-gradient(135deg, #0b2447 0%, #19376d 60%, #0f2f5f 100%)',
              borderBottom: '3px solid #10b981'
            }}
          >
            <div className="mx-auto w-20 h-20 rounded-full bg-white p-1 border-2 border-amber-300 shadow-lg flex items-center justify-center overflow-hidden mb-3.5">
              <SchoolLogo
                customLogo={customLogo}
                alt={`Logo ${resolvedSchoolName}`}
                className="w-full h-full rounded-full object-contain"
              />
            </div>

            <p className="text-[10.5px] font-semibold tracking-widest text-emerald-300 uppercase">
              {resolvedDeptName}
            </p>
            <h1 className="text-base sm:text-lg font-extrabold tracking-wide text-white mt-0.5 leading-snug">
              {resolvedSchoolName}
            </h1>

            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-semibold text-emerald-100">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>EduSchedule AI • Cổng Đăng Nhập Bảo Mật</span>
            </div>
          </div>

          {/* Login Form */}
          <div className="p-6 sm:p-7 space-y-4">
            {/* Notice from single-session kick or idle auto-logout */}
            {authNotice && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5 shadow-2xs"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="font-semibold leading-relaxed">{authNotice.message}</div>
              </div>
            )}

            {/* Login Error Alert */}
            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 shadow-2xs"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="font-semibold leading-relaxed">{errorMessage}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  Tên đăng nhập / Email
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="Nhập tên đăng nhập hoặc email..."
                    className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="Nhập mật khẩu..."
                    className="w-full pl-9 pr-11 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-md transition cursor-pointer"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 active:scale-[0.99] text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Đang xác thực...' : 'Đăng nhập hệ thống'}</span>
              </button>
            </form>

            <div className="pt-3 border-t border-slate-100 text-center text-[11px] text-slate-500">
              Vui lòng liên hệ Quản trị viên nhà trường nếu cần cấp hoặc khôi phục tài khoản.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginGateScreen;
