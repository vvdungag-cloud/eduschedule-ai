import React, { useState, useEffect } from 'react';
import { 
  X, BookOpen, Layers, Keyboard, AlertTriangle, Info, CheckCircle2, 
  Sparkles, Calendar, Users, FileSpreadsheet, Lock, Search, 
  Clock, ArrowRight, ShieldCheck, Printer, MousePointer, HelpCircle,
  FolderArchive, Zap
} from 'lucide-react';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserGuideModal: React.FC<UserGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'steps' | 'shortcuts' | 'troubleshooting' | 'about'>('steps');
  const [searchQuery, setSearchQuery] = useState('');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER - High-tech Blue Gradient */}
        <div 
          style={{
            background: 'linear-gradient(90deg, #0b2447 0%, #19376d 50%, #0b2447 100%)',
            borderBottom: '1px solid rgba(6, 182, 212, 0.3)',
            boxShadow: '0 4px 16px -2px rgba(11, 36, 71, 0.4)'
          }}
          className="px-6 py-4.5 text-white flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-emerald-400 shadow-inner shrink-0">
              <BookOpen className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                  <span>Hướng dẫn sử dụng & Phím tắt</span>
                  <span className="bg-emerald-500/20 text-emerald-300 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-400/30">
                    EduSchedule AI
                  </span>
                </h2>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                Cẩm nang thao tác nhanh và quy chuẩn vận hành xếp TKB Trường THPT Nguyễn Bỉnh Khiêm
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition cursor-pointer border border-white/10"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL NAVIGATION TABS */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('steps')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'steps'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>1. Quy trình 5 bước</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('shortcuts')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'shortcuts'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>2. Phím tắt & Mẹo thao tác</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('troubleshooting')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'troubleshooting'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>3. Lưu ý & Xử lý lỗi</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('about')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'about'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>4. Thông tin hệ thống</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm nhanh mẹo, chức năng..."
              className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 w-48 sm:w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* MODAL CONTENT BODY - Scrollable */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700 text-sm">
          
          {/* TAB 1: QUY TRÌNH 5 BƯỚC */}
          {activeTab === 'steps' && (
            <div className="space-y-6">
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">Quy tắc vàng: </span>
                  Để tạo được Thời khóa biểu hoàn chỉnh, hệ thống khuyến nghị thực hiện tuần tự từ 
                  <span className="font-semibold text-emerald-800"> Bước 1</span> đến 
                  <span className="font-semibold text-emerald-800"> Bước 5</span>. Dữ liệu các bước trước sẽ là đầu vào trực tiếp cho các thuật toán tự động ở bước sau.
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Bước 1 */}
                <div className="border border-slate-200 rounded-xl p-4.5 bg-white hover:border-blue-300 transition shadow-xs">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-sm shrink-0">
                      1
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>Danh mục Môn học toàn trường</span>
                        <span className="text-[11px] font-normal text-slate-500">(Tab: Danh mục Môn học)</span>
                      </h4>
                      <p className="text-xs text-slate-500">Thiết lập 16 môn học chuẩn, tổ bộ môn phụ trách và định mức số tiết/tuần theo khối.</p>
                    </div>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 ml-11 list-disc list-outside">
                    <li>Kiểm tra đầy đủ mã môn (Toán, Văn, Anh, Tin, GDQP-AN...).</li>
                    <li>Gán chính xác <b>Tổ bộ môn phụ trách</b> (Toán, Tin học, Ngữ văn, KHTN, KHXH...).</li>
                    <li>Cài đặt <b>Định mức tiết chuẩn</b> cho từng khối 10, 11, 12 để làm căn cứ khai báo lớp.</li>
                  </ul>
                </div>

                {/* Bước 2 */}
                <div className="border border-slate-200 rounded-xl p-4.5 bg-white hover:border-blue-300 transition shadow-xs">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm shrink-0">
                      2
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>Quản lý Danh sách Giáo viên</span>
                        <span className="text-[11px] font-normal text-slate-500">(Tab: Giáo viên)</span>
                      </h4>
                      <p className="text-xs text-slate-500">Hồ sơ 61 cán bộ giáo viên, phân tổ, định mức giờ dạy và chế độ giảm tiết.</p>
                    </div>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 ml-11 list-disc list-outside">
                    <li>Khai báo <b>Định mức tiết/tuần</b> (Chuẩn 17 tiết/tuần; tổ trưởng giảm 3 tiết, kiêm nhiệm giảm theo quy định).</li>
                    <li>Tích chọn <b>Khả năng Chủ nhiệm</b> (CN) để phục vụ phân công giáo viên chủ nhiệm lớp.</li>
                    <li>Cập nhật ngày sinh để tự động dự báo thời điểm nghỉ hưu theo <b>Nghị định 135/2020/NĐ-CP</b>.</li>
                    <li>Có thể nhập khẩu nhanh danh sách từ file Excel (hỗ trợ nhập cả cột thông tin kiêm nhiệm).</li>
                  </ul>
                </div>

                {/* Bước 3 */}
                <div className="border border-slate-200 rounded-xl p-4.5 bg-white hover:border-blue-300 transition shadow-xs">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-800 font-bold flex items-center justify-center text-sm shrink-0">
                      3
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>Khai báo số tiết theo lớp</span>
                        <span className="text-[11px] font-normal text-slate-500">(Tab: Khai báo số tiết theo lớp)</span>
                      </h4>
                      <p className="text-xs text-slate-500">Phân bổ chi tiết số tiết từng môn cho từng lớp theo tổ hợp chuyên sâu K10, K11, K12.</p>
                    </div>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 ml-11 list-disc list-outside">
                    <li>Nhập số tiết giảng dạy mỗi tuần cho từng lớp (lớp KHTN nhiều tiết Lý/Hóa/Sinh, lớp KHXH nhiều tiết Sử/Địa).</li>
                    <li>Cài đặt <b>Số cặp tiết tối thiểu</b> (tiết đôi liên tiếp) đối với các môn cần học liền mạch (Văn, Toán, Tin học thực hành).</li>
                    <li>Giới hạn <b>Số tiết tối đa/buổi</b> để tránh học sinh bị học quá tải 1 môn trong 1 buổi học.</li>
                  </ul>
                </div>

                {/* Bước 4 */}
                <div className="border border-slate-200 rounded-xl p-4.5 bg-white hover:border-blue-300 transition shadow-xs">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-bold flex items-center justify-center text-sm shrink-0">
                      4
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>Phân công chuyên môn giảng dạy</span>
                        <span className="text-[11px] font-normal text-slate-500">(Tab: Phân công CM)</span>
                      </h4>
                      <p className="text-xs text-slate-500">Gán giáo viên phụ trách từng môn theo từng lớp hoặc dùng công nghệ phân công AI.</p>
                    </div>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 ml-11 list-disc list-outside">
                    <li>Bấm nút <b>"Tự động phân công AI"</b>: Thuật toán tự cân đối số tiết của từng thầy cô tiệm cận với định mức chuẩn, tránh người quá tải người thiếu tiết.</li>
                    <li>Chỉnh sửa thủ công trực tiếp bằng cách chọn tên giáo viên trên lưới phân công.</li>
                    <li>Quan sát thanh chỉ số <b>Tổng số tiết phân công / Định mức</b> để bảo đảm công bằng, chính xác.</li>
                  </ul>
                </div>

                {/* Bước 5 */}
                <div className="border border-slate-200 rounded-xl p-4.5 bg-white hover:border-blue-300 transition shadow-xs">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-sm shrink-0">
                      5
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span>Xếp Thời khóa biểu & Xuất báo cáo</span>
                        <span className="text-[11px] font-normal text-slate-500">(Tab: Thời khóa biểu)</span>
                      </h4>
                      <p className="text-xs text-slate-500">Thuật toán sinh TKB tối ưu, giải quyết triệt để trùng phòng, trùng tiết giáo viên.</p>
                    </div>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 ml-11 list-disc list-outside">
                    <li>Nhấn <b>"Tự động xếp TKB"</b>: Giải thuật tối ưu hóa lịch trình sẽ chạy và xếp tất cả các tiết vào bảng 5 buổi sáng/chiều.</li>
                    <li><b>Kéo & Thả (Drag & Drop)</b>: Tự do hoán đổi 2 tiết học trên bảng TKB để phù hợp nguyện vọng giáo viên.</li>
                    <li>Xuất báo cáo đa định dạng: TKB toàn trường, TKB từng lớp (gửi phụ huynh/học sinh), TKB từng giáo viên (gửi cá nhân) ra Excel, PDF hoặc Word.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PHÍM TẮT & MẸO THAO TÁC */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-blue-600" />
                  <span>Bảng phím tắt ứng dụng</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-xs text-slate-900 block">Mở Hướng dẫn sử dụng</span>
                      <span className="text-[11px] text-slate-500">Bật nhanh cửa sổ trợ giúp này ở bất kỳ đâu</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">F1</kbd>
                      <span className="text-xs text-slate-400">hoặc</span>
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">?</kbd>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-xs text-slate-900 block">Đóng cửa sổ / Thoát Modal</span>
                      <span className="text-[11px] text-slate-500">Đóng popup cài đặt, đăng nhập, hướng dẫn</span>
                    </div>
                    <kbd className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">Esc</kbd>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-xs text-slate-900 block">In ấn nhanh (Print)</span>
                      <span className="text-[11px] text-slate-500">In trực tiếp Thời khóa biểu hoặc Bảng phân công</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">Ctrl</kbd>
                      <span className="text-xs text-slate-400">+</span>
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">P</kbd>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-xs text-slate-900 block">Tìm kiếm trên bảng</span>
                      <span className="text-[11px] text-slate-500">Tìm tên giáo viên, môn học hoặc lớp</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">Ctrl</kbd>
                      <span className="text-xs text-slate-400">+</span>
                      <kbd className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 shadow-2xs">F</kbd>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                  <MousePointer className="w-4 h-4 text-emerald-600" />
                  <span>Mẹo thao tác chuột & Tính năng thông minh</span>
                </h3>
                <div className="space-y-3">
                  <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl text-xs space-y-1.5">
                    <div className="font-bold text-blue-900 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-blue-600" />
                      <span>Kéo thả trực tiếp trên Bảng Thời khóa biểu (Drag & Drop):</span>
                    </div>
                    <p className="text-blue-800 leading-relaxed">
                      Trên màn hình Thời khóa biểu, bạn có thể nhấn giữ chuột vào một ô tiết học bất kỳ và kéo thả vào ô khác. Hệ thống sẽ tự động hoán đổi vị trí và kiểm tra tức thời xem có làm giáo viên bị trùng tiết ở lớp khác hay không.
                    </p>
                  </div>

                  <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl text-xs space-y-1.5">
                    <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Bảo vệ dữ liệu bằng nút Khóa / Mở (Lock):</span>
                    </div>
                    <p className="text-emerald-800 leading-relaxed">
                      Tại thanh Header, nút <b>[Mở / Khóa]</b> cạnh năm học cho phép bạn đóng băng học kỳ sau khi thời khóa biểu đã được ban hành chính thức. Khi ở trạng thái "Khóa", hệ thống sẽ ngăn mọi thao tác xóa nhầm hoặc sửa đổi ngoài ý muốn.
                    </p>
                  </div>

                  <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl text-xs space-y-1.5">
                    <div className="font-bold text-amber-900 flex items-center gap-1.5">
                      <FolderArchive className="w-3.5 h-3.5 text-amber-600" />
                      <span>Quản lý độc lập nhiều Năm học & Học kỳ:</span>
                    </div>
                    <p className="text-amber-800 leading-relaxed">
                      Bạn có thể tạo mới các năm học (VD: <i>2026 – 2027</i>, <i>2027 – 2028</i>) và chọn Học kỳ 1 hoặc Học kỳ 2. Mỗi kỳ là một kho dữ liệu hoàn toàn độc lập, không làm ảnh hưởng đến dữ liệu lịch sử của các năm cũ.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LƯU Ý & XỬ LÝ LỖI */}
          {activeTab === 'troubleshooting' && (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-xs">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-2 mb-2 text-rose-700">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  <span>1. Khi chạy Xếp tự động TKB báo có xung đột hoặc không xếp hết tiết:</span>
                </h4>
                <div className="text-xs text-slate-600 space-y-2 leading-relaxed pl-6">
                  <p>
                    <b>Nguyên nhân:</b> Do giáo viên bị gán số tiết vượt quá số buổi có thể dạy trong tuần, hoặc quá nhiều giáo viên cùng xin tránh dạy một buổi nhất định, hoặc các ràng buộc cặp tiết quá ngặt nghèo.
                  </p>
                  <p>
                    <b>Cách xử lý:</b>
                  </p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-700">
                    <li>Chuyển qua tab <b>Phân công CM</b>, kiểm tra xem có giáo viên nào bị vượt quá 19–20 tiết/tuần hay không.</li>
                    <li>Ở tab <b>Khai báo số tiết theo lớp</b>, nới lỏng cột "Số cặp tối thiểu" về mức hợp lý (1 hoặc 0).</li>
                    <li>Nhấn lại nút <b>"Tự động xếp TKB"</b> với số lần thử (iterations) cao hơn để thuật toán tìm đường tối ưu mới.</li>
                  </ol>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-xs">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-2 mb-2 text-blue-700">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>2. Đèn LED góc trên Header báo trạng thái Cloud Firestore:</span>
                </h4>
                <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed pl-6">
                  <p>
                    • <b>Đèn xanh lá nhấp nháy (Online):</b> Ứng dụng đã kết nối trực tiếp với Cloud Firestore. Mọi thay đổi của bạn đều được tự động lưu trữ và đồng bộ tức thời.
                  </p>
                  <p>
                    • <b>Chế độ ngoại tuyến (Offline):</b> Nếu mất kết nối Internet, ứng dụng tự động lưu vào bộ nhớ trình duyệt (LocalStorage). Khi có mạng trở lại, hệ thống sẽ tự động đồng bộ lên máy chủ.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-xs">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-2 mb-2 text-amber-700">
                  <FolderArchive className="w-4 h-4 text-amber-600" />
                  <span>3. Khuyến nghị Sao lưu định kỳ (Backup JSON):</span>
                </h4>
                <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed pl-6">
                  <p>
                    Trước mỗi lần ban hành hoặc điều chỉnh lớn thời khóa biểu, Ban giám hiệu / Quản trị viên nên bấm vào nút <b>Cài đặt &gt; Sao lưu tất cả các năm (.json)</b> để tải tệp dự phòng về máy tính cá nhân. Khi cần có thể phục hồi lại 100% dữ liệu chỉ với 1 cú click.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: THÔNG TIN HỆ THỐNG */}
          {activeTab === 'about' && (
            <div className="space-y-4">
              <div className="p-5 bg-gradient-to-br from-slate-900 to-blue-950 text-white rounded-2xl shadow-md border border-slate-800">
                <div className="flex items-center gap-3.5 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shadow-lg">
                    <img 
                      src="/vite.svg" 
                      alt="Logo" 
                      className="w-8 h-8 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                      <span>EduSchedule AI</span>
                      <span className="text-xs font-semibold bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-md">
                        v2.5 Pro
                      </span>
                    </h3>
                    <p className="text-xs text-emerald-300 font-medium">Hệ thống Xếp Thời khóa biểu & Quản trị Nhân sự THPT Chuyên sâu</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-3 border-t border-white/10">
                  <div>
                    <span className="text-slate-400 block">Đơn vị triển khai:</span>
                    <span className="font-bold text-white text-sm">Trường THPT Nguyễn Bỉnh Khiêm</span>
                    <span className="text-slate-300 block text-[11px]">Huyện Châu Thành, Tỉnh An Giang</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Quy chuẩn áp dụng:</span>
                    <span className="font-semibold text-white">Chương trình GDPT 2018 (Bộ GD&ĐT)</span>
                    <span className="text-slate-300 block text-[11px]">Nghị định 135/2020/NĐ-CP (Tuổi nghỉ hưu)</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xs text-slate-500">Quy mô trường học</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">36 Lớp • 61 Giáo viên</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xs text-slate-500">Thuật toán xếp TKB</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">Constraint Solver AI</div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-xs text-slate-500">Cơ sở dữ liệu</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">Google Cloud Firestore</div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono font-bold text-slate-600">F1</kbd>
            <span>để mở nhanh lại bảng hướng dẫn bất kỳ lúc nào</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs"
          >
            Đã hiểu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
