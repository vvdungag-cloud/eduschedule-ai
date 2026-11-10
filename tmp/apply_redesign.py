import os

script_code = '''
with open('src/components/TimetableTab.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '      {/* COMPACT DASHBOARD TOP CONTROLS */}'
if start_marker not in content:
    start_marker = '      {/* Top Banner / Actions Bar - Card nội dung \"Sắp xếp Thời khóa biểu\" */}'

end_marker = '          {/* Timetable Grid for Class (Compact Grid) */}'

pos1 = content.find(start_marker)
pos2 = content.find(end_marker)

if pos1 == -1 or pos2 == -1:
    print('ERROR: markers not found', pos1, pos2)
    exit(1)

replacement_chunk_1 = """      {/* COMPACT DASHBOARD TOP CONTROLS */}
      {/* Tầng 1: Thanh tiêu đề và cụm nút tác vụ (1 hàng duy nhất, max-h 42px) */}
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 min-h-[38px] max-h-none lg:max-h-[42px] mb-1">
        {/* Bên trái: Tiêu đề + mini badge CP-SAT + info tooltip */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600 shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <h2 className="text-[1.1rem] font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap leading-none">
            <span>Sắp xếp Thời khóa biểu</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
              CP-SAT
            </span>
            <div className="relative group/tip cursor-pointer inline-flex items-center text-slate-400 hover:text-indigo-600 shrink-0 ml-0.5" title="Mẹo hoán đổi tiết">
              <Info className="w-3.5 h-3.5" />
              <div className="invisible group-hover/tip:visible opacity-0 group-hover/tip:opacity-100 transition-all duration-150 absolute left-0 top-full mt-1.5 w-72 p-2 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-50 pointer-events-none leading-relaxed font-normal">
                Mẹo: Bạn có thể nhấp chọn 2 ô trong bảng để hoán đổi tiết học thủ công (hệ thống tự kiểm tra chống trùng tiết).
              </div>
            </div>
          </h2>
        </div>

        {/* Bên phải: Toàn bộ nút lệnh trên cùng 1 hàng (flex-wrap: nowrap; gap: 6px) */}
        <div className="flex items-center flex-nowrap gap-1.5 shrink-0 overflow-x-auto">
          {/* Nút hành động chính: Sắp xếp TKB tự động */}
          <button
            onClick={handleSolveTimetable}
            disabled={isSolving || isCurrentTermLocked || !isAdmin}
            className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer whitespace-nowrap shrink-0 ${
              !isAdmin
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                : isSolving
                ? 'bg-indigo-400 text-white cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 shadow-indigo-100'
            }`}
            title={
              !isAdmin
                ? 'Vui lòng đăng nhập Quản trị viên để sắp xếp TKB.'
                : isCurrentTermLocked
                ? 'Dữ liệu đang khóa chống sửa đổi.'
                : 'Chạy thuật toán sắp xếp Thời khóa biểu tự động'
            }
          >
            <Sparkles className={`w-3.5 h-3.5 ${isSolving ? 'animate-spin' : ''}`} />
            <span>{isSolving ? 'Đang giải TKB...' : 'Sắp xếp TKB tự động'}</span>
            {!isAdmin && <Lock className="w-3 h-3 text-slate-400 ml-0.5" />}
          </button>

          {/* Sửa ràng buộc */}
          {isAdmin && (
            <button
              onClick={() => setIsCommonConstraintsOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              title="Thiết lập các ràng buộc: Tiết cố định, Tiết nghỉ lớp, Thời gian bận GV, Ghép cặp môn"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>Sửa ràng buộc</span>
            </button>
          )}

          {/* Dạy 2 buổi/ngày */}
          {isAdmin && (
            <button
              onClick={() => setIsSessionConfigModalOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              title="Cấu hình chế độ dạy học: 1 buổi/ngày (Sáng) hoặc 2 buổi/ngày (Sáng & Chiều)"
            >
              {sessionMode === 'double' ? (
                <Sunset className="w-3.5 h-3.5 text-indigo-600" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{sessionMode === 'double' ? 'Dạy 2 buổi / ngày' : 'Dạy 1 buổi / ngày'}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold bg-slate-100 text-slate-600 ml-0.5">
                {sessionMode === 'double' ? `${5 + afternoonPeriodsCount}t` : '5t'}
              </span>
            </button>
          )}

          {/* Khóa vị trí tiết (504) */}
          {isAdmin && (
            <div className="h-8 inline-flex items-center rounded-lg border border-slate-300 bg-white shadow-2xs overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setIsLockModeActive(prev => !prev)}
                className={`h-full inline-flex items-center gap-1.5 px-2.5 text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  isLockModeActive
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
                title="Bật/Tắt chế độ nhấp vào các ô trên bảng TKB để Khóa/Mở khóa vị trí"
              >
                <Lock className={`w-3.5 h-3.5 ${isLockModeActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{isLockModeActive ? 'Đang khóa' : 'Khóa vị trí'}</span>
                {totalLockedCount > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-0.5 ${
                    isLockModeActive ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {totalLockedCount}
                  </span>
                )}
              </button>
              {totalLockedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setIsLockManagerOpen(true)}
                  className={`h-full px-2 border-l border-slate-200 transition cursor-pointer flex items-center justify-center ${
                    isLockModeActive ? 'bg-slate-900 text-slate-300 hover:text-white' : 'hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Mở danh sách chi tiết các vị trí khóa"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Lưu đám mây */}
          {isAdmin && (
            <button
              onClick={async () => {
                const res = await syncToCloud();
                if (onNotification) onNotification(res.message);
              }}
              disabled={isSyncing}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Đồng bộ tự động cả Phân công giảng dạy và Thời khóa biểu lên Cloud Firestore"
            >
              <Cloud className={`w-3.5 h-3.5 text-slate-500 ${isSyncing ? 'animate-spin text-indigo-600' : ''}`} />
              <span>{isSyncing ? 'Đang lưu...' : 'Lưu đám mây'}</span>
            </button>
          )}

          {/* Viewer login unlock button */}
          {!isAdmin && (
            <button
              onClick={openLoginModal}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition shadow-2xs cursor-pointer whitespace-nowrap shrink-0"
              title="Đăng nhập Quản trị viên để chỉnh sửa và chạy thuật toán xếp TKB"
            >
              <KeyRound className="w-3.5 h-3.5 text-slate-500" />
              <span>Mở khóa chỉnh sửa</span>
            </button>
          )}

          {/* Xuất dữ liệu ▾ */}
          {timetableData && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsExportDropdownOpen(prev => !prev)}
                className="h-8 inline-flex items-center gap-1 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition cursor-pointer shadow-2xs whitespace-nowrap"
                title="Xuất bảng Thời khóa biểu"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Xuất dữ liệu</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
              {isExportDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportDropdownOpen(false)} />
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1">
                    <button
                      type="button"
                      onClick={() => {
                        handleExportExcel();
                        setIsExportDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-1.5 hover:bg-slate-50 text-xs text-slate-700 font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Xuất Excel (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleExportPDF();
                        setIsExportDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-1.5 hover:bg-slate-50 text-xs text-slate-700 font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-rose-600" />
                      <span>Xuất PDF (.pdf)</span>
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        handlePrint();
                        setIsExportDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-1.5 hover:bg-slate-50 text-xs text-slate-700 font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-slate-600" />
                      <span>In biểu mẫu TKB</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Xóa TKB */}
          {timetableData && isAdmin && (
            <button
              type="button"
              onClick={handleClearTimetable}
              disabled={isCurrentTermLocked}
              className="h-8 inline-flex items-center gap-1 px-2 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0"
              title="Xóa thời khóa biểu hiện tại để xếp lại từ đầu"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa TKB</span>
            </button>
          )}
        </div>
      </div>

      {/* Tầng 2: Dải chỉ số thống kê siêu gọn (Compact Stat Strip - height ~32px) */}
      <div className="h-7 md:h-8 px-3 bg-slate-50 border border-slate-200/90 rounded-md flex items-center justify-between text-[11px] md:text-xs text-slate-600 overflow-x-auto whitespace-nowrap mb-1 gap-2">
        <div className="flex items-center gap-2 flex-nowrap shrink-0">
          <span>Tổng số tiết: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.totalLessons.toLocaleString('vi-VN') : 0}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Lớp: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.totalClasses : classes.length}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Giáo viên: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.totalTeachers : teachers.length}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
            Trùng tiết: <CheckCircle className="w-3 h-3 text-emerald-600 inline" /> 0 (Tuyệt đối) ✓
          </span>
          <span className="text-slate-300 font-bold">•</span>
          <span>Tiết trống GV: <strong className="font-bold text-slate-900">{timetableData ? timetableData.stats.isolatedGaps : 0}</strong></span>
          <span className="text-slate-300 font-bold">•</span>
          <button
            type="button"
            onClick={() => setIsLockManagerOpen(true)}
            className="inline-flex items-center gap-1 hover:text-indigo-600 cursor-pointer"
            title="Bấm để xem danh sách vị trí đã khóa"
          >
            <Lock className="w-3 h-3 text-slate-400" />
            <span>Đã khóa: <strong className="font-bold text-slate-900">{totalLockedCount}</strong></span>
          </button>
        </div>
      </div>

      {/* Lock Mode Notice Banner (nếu đang bật) */}
      {isLockModeActive && (
        <div className="mb-1.5 p-2 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-amber-900 text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Chế độ Khóa vị trí tiết đang BẬT:</strong> Nhấp vào bất kỳ ô nào trên bảng TKB dưới đây để Khóa hoặc Mở khóa vị trí.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsLockModeActive(false)}
            className="px-2.5 py-1 bg-amber-800 hover:bg-amber-900 text-white rounded text-xs font-semibold cursor-pointer shrink-0"
          >
            Hoàn tất khóa
          </button>
        </div>
      )}

      {/* Solver Notice / Infeasible Diagnostics */}
      {solverNotice && (
        <div className="mb-1.5 p-2 bg-indigo-50 border border-indigo-200 rounded text-indigo-800 text-xs flex items-center justify-between">
          <span>{solverNotice}</span>
          <button onClick={() => setSolverNotice(null)} className="text-indigo-500 hover:text-indigo-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {infeasibleDiagnostics && infeasibleDiagnostics.length > 0 && (
        <div className="mb-2 p-3 bg-rose-50 border border-rose-200 rounded-lg animate-in fade-in text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-rose-900 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" /> Chi tiết xung đột kẹt lịch & phân công quá tải
            </span>
            <button onClick={() => setInfeasibleDiagnostics(null)} className="text-rose-500 hover:text-rose-800 font-semibold cursor-pointer">
              Đóng
            </button>
          </div>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
            {infeasibleDiagnostics.map((diag, idx) => (
              <div key={idx} className="bg-white border border-rose-100 p-2 rounded text-rose-900">
                <strong>{diag.message}</strong>
                {diag.details && <p className="text-slate-600 mt-0.5">{diag.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tầng 3: Thanh công cụ bộ lọc và chế độ xem (1 hàng phẳng, bỏ khung hộp to) */}
      <div 
        className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 border-b border-slate-200/80 min-h-[34px]"
        style={{ padding: '4px 0', marginBottom: '6px' }}
      >
        {/* Cụm bên trái: Bộ lọc & Thông tin */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {activeView === 'by_class' && (
            <>
              {/* Dropdown [Khối: 10/11/12/Tất cả] */}
              <select
                value={filterGrade}
                onChange={e => setFilterGrade(e.target.value as any)}
                className="h-7 px-2 py-0 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">Khối: Tất cả</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>

              {/* Dropdown [Chọn lớp: Lớp 10A1] */}
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                className="h-7 px-2.5 py-0 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[170px] truncate"
              >
                {filteredClasses.map(c => (
                  <option key={c.id} value={c.id}>
                    Lớp {c.name} (Khối {c.grade})
                  </option>
                ))}
              </select>

              {/* Badge nhẹ [GVCN: ...] */}
              {currentClass && (
                <span className="h-7 px-2.5 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap">
                  GVCN: <strong className="ml-1 font-semibold text-slate-900">{currentClassHomeroomTeacher?.name || 'Chưa phân công'}</strong>
                </span>
              )}

              {/* Badge tiến độ xanh [29/29 tiết (100% ✓)] */}
              {currentClass && (
                <span
                  className={`h-7 px-2.5 py-0 inline-flex items-center text-xs font-semibold rounded whitespace-nowrap border ${
                    currentClassTotalPeriods === currentClassAssignedSubjectPeriods
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : currentClassTotalPeriods < currentClassAssignedSubjectPeriods
                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                      : 'bg-rose-50 text-rose-800 border-rose-300'
                  }`}
                >
                  {currentClassTotalPeriods}/{currentClassAssignedSubjectPeriods} tiết
                  <span className="ml-1">
                    ({Math.round((currentClassTotalPeriods / (currentClassAssignedSubjectPeriods || 1)) * 100)}% {currentClassTotalPeriods === currentClassAssignedSubjectPeriods ? '✓' : ''})
                  </span>
                </span>
              )}
            </>
          )}

          {activeView === 'by_teacher' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                <input
                  type="text"
                  placeholder="Tìm giáo viên..."
                  value={teacherSearch}
                  onChange={e => setTeacherSearch(e.target.value)}
                  className="pl-7 pr-2 h-7 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 w-36 bg-white"
                />
              </div>
              <select
                value={selectedTeacherId}
                onChange={e => setSelectedTeacherId(e.target.value)}
                className="h-7 px-2.5 py-0 text-xs font-bold border border-slate-300 rounded bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[200px] truncate"
              >
                {filteredTeachers.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.specialization} - {t.position || 'GV'})
                  </option>
                ))}
              </select>
              {currentTeacher && (
                <>
                  <span className="h-7 px-2.5 py-0 inline-flex items-center text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-800 rounded whitespace-nowrap">
                    Môn: <strong className="ml-1 font-semibold">{currentTeacher.specialization}</strong>
                  </span>
                  <span className="h-7 px-2.5 py-0 inline-flex items-center text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700 rounded whitespace-nowrap">
                    Tổng dạy: <strong className="ml-1 font-semibold text-slate-900">{currentTeacherStats.total} tiết</strong>
                  </span>
                  <span className={`h-7 px-2.5 py-0 inline-flex items-center text-xs font-semibold rounded whitespace-nowrap border ${
                    currentTeacherStats.gaps === 0
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    Tiết trống: <strong className="ml-1">{currentTeacherStats.gaps} tiết</strong>
                  </span>
                </>
              )}
            </>
          )}

          {activeView === 'matrix_class' && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">Ma trận {classes.length} Lớp</span>
              <span className="text-slate-400">|</span>
              <span>Hiển thị: [Môn học - Giáo viên]</span>
            </div>
          )}

          {activeView === 'matrix_teacher' && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">Ma trận {teachers.length} Giáo viên</span>
              <span className="text-slate-400">|</span>
              <span>Hiển thị: [Môn học - Lớp]</span>
            </div>
          )}
        </div>

        {/* Cụm bên phải: Chế độ xem & Buổi */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Segmented button chế độ xem */}
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setActiveView('by_class')}
              className={`px-2 py-0.5 h-6 rounded text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                activeView === 'by_class'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <School className="w-3 h-3" />
              <span>Từng Lớp</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('by_teacher')}
              className={`px-2 py-0.5 h-6 rounded text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                activeView === 'by_teacher'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3 h-3" />
              <span>Từng GV</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('matrix_class')}
              className={`px-2 py-0.5 h-6 rounded text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                activeView === 'matrix_class'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Ma trận Lớp</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('matrix_teacher')}
              className={`px-2 py-0.5 h-6 rounded text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                activeView === 'matrix_teacher'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3 h-3" />
              <span>Ma trận GV</span>
            </button>
          </div>

          {/* Bộ chọn Buổi (Sáng | Chiều | Cả ngày) */}
          {sessionMode === 'double' && (
            <div className="inline-flex items-center p-0.5 bg-amber-50/90 border border-amber-200 rounded-md text-xs">
              <span className="text-[11px] font-bold text-amber-900 px-1 flex items-center gap-0.5">
                <Clock className="w-3 h-3 text-amber-700" /> Buổi:
              </span>
              <button
                type="button"
                onClick={() => setSessionFilter('all')}
                className={`px-1.5 py-0.5 h-6 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'all'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Cả ngày
              </button>
              <button
                type="button"
                onClick={() => setSessionFilter('morning')}
                className={`px-1.5 py-0.5 h-6 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'morning'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Sáng
              </button>
              <button
                type="button"
                onClick={() => setSessionFilter('afternoon')}
                className={`px-1.5 py-0.5 h-6 rounded text-[11px] font-semibold transition cursor-pointer ${
                  sessionFilter === 'afternoon'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                Chiều
              </button>
            </div>
          )}
        </div>
      </div>

      {/* VIEW 1: BY CLASS */}
      {activeView === 'by_class' && (
        <div className="space-y-2 mt-0" style={{ marginTop: '0px' }}>
"""

# Apply replacement 1
new_content = content[:pos1] + replacement_chunk_1 + content[pos2:]

# Now remove the duplicate teacher selector bar if still present
t_start = '          {/* Teacher Selector Bar */}'
t_end = '          {/* Timetable Grid for Teacher (Compact Grid) */}'

pos_t1 = new_content.find(t_start)
pos_t2 = new_content.find(t_end)

if pos_t1 != -1 and pos_t2 != -1:
    new_content = new_content[:pos_t1] + new_content[pos_t2:]
    print('Teacher selector bar removed successfully.')

with open('src/components/TimetableTab.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Updated TimetableTab.tsx successfully!')
'''

with open('/tmp/apply_redesign.py', 'w', encoding='utf-8') as f:
    f.write(script_code)
