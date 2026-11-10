import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = "{/* TAB 1: MAIN ASSIGNMENT GRID */}\n          {activeTab === 'board' && (\n            <div className={`flex-1 flex flex-col min-h-0 ${isBoardFullscreen ? 'h-full' : 'p-3 md:p-5'}`}>"
end_marker = "                </table>\n              </div>\n            </div>"

new_block = '''{/* TAB 1: MAIN ASSIGNMENT GRID */}
          {activeTab === 'board' && (
            <div className={`flex-1 flex flex-col min-h-0 ${isBoardFullscreen ? 'h-full' : 'p-2.5 md:p-3'}`}>
              {/* TẦNG 1: TIÊU ĐỀ VÀ CỤM NÚT TÁC VỤ (1 HÀNG DUY NHẤT) */}
              <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 min-h-[38px] max-h-none lg:max-h-[42px] mb-1.5 shrink-0">
                {/* Trái: Tiêu đề + badge lớp + badge năm học + badge trạng thái Khóa/Mở khóa */}
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <div className="p-1 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600 shrink-0">
                    <School className="w-4 h-4" />
                  </div>
                  <h2 className="text-[1.05rem] font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap leading-none">
                    <span>Bảng phân công giảng dạy & Chủ nhiệm</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                      {classes.length} Lớp
                    </span>
                  </h2>

                  <span className="text-[10px] md:text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                    {currentSemester} • {currentAcademicYear}
                  </span>

                  {/* Badge trạng thái Khóa / Mở khóa */}
                  <button
                    type="button"
                    onClick={() => handleToggleLockYear(currentAcademicYear)}
                    className={`inline-flex items-center gap-1 text-[11px] md:text-xs font-bold px-2.5 py-0.5 rounded-full border transition cursor-pointer shrink-0 ${
                      isCurrentTermLocked
                        ? 'bg-rose-100 hover:bg-rose-200 text-rose-800 border-rose-300 shadow-2xs'
                        : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border-emerald-300'
                    }`}
                    title={
                      isCurrentTermLocked
                        ? `Dữ liệu năm học ${currentAcademicYear} đang KHÓA (chống sửa đổi). Nhấp để mở khóa.`
                        : `Dữ liệu năm học ${currentAcademicYear} đang MỞ (cho phép chỉnh sửa). Nhấp để khóa bảo vệ dữ liệu.`
                    }
                  >
                    {isCurrentTermLocked ? (
                      <>
                        <Lock className="w-3 h-3 text-rose-600" />
                        <span>Đã khóa dữ liệu</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3 h-3 text-emerald-600" />
                        <span>Đang mở chỉnh sửa</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Phải: Gom các nút thành 1 hàng ngang phẳng gọn (padding: 4px 8px, font-size: 0.8rem) */}
                <div className="flex items-center flex-nowrap gap-1.5 shrink-0 overflow-x-auto">
                  {/* AI Phân công tự động - Chỉ Admin */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrentTermLocked) {
                          showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Hãy bấm "Mở khóa" trên thanh tiêu đề nếu muốn phân công AI.`);
                          return;
                        }
                        setIsAiOptimizeModalOpen(true);
                      }}
                      disabled={isAiOptimizing}
                      className={`h-8 px-2.5 py-1 text-xs font-semibold rounded-lg border transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                        isCurrentTermLocked
                          ? 'opacity-60 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-60'
                      }`}
                      title={isCurrentTermLocked ? `Dữ liệu năm học ${currentAcademicYear} đang khóa. Hãy mở khóa để dùng tính năng này.` : 'AI phân công tự động'}
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isCurrentTermLocked ? 'text-slate-400' : 'text-indigo-500'} ${isAiOptimizing ? 'animate-spin' : ''}`} />
                      <span>{isAiOptimizing ? 'AI đang xếp...' : '✨ AI phân công tự động'}</span>
                    </button>
                  )}

                  {/* Nhập phân công bằng AI - Chỉ Admin */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrentTermLocked) {
                          showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                          return;
                        }
                        setNlImportType('assignments');
                        setIsNlImportOpen(true);
                      }}
                      className="h-8 px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-50 text-indigo-700 border border-slate-300 rounded-lg shadow-2xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                      title="Nhập phân công giảng dạy & chủ nhiệm bằng ngôn ngữ tự nhiên AI"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Nhập bằng AI</span>
                    </button>
                  )}

                  {/* Lưu đám mây - Chỉ Admin */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await syncToCloud();
                        showTermNotification(res.message);
                      }}
                      disabled={isSyncing}
                      className="h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                      title="Đồng bộ toàn bộ bảng phân công và thời khóa biểu mới nhất lên Cloud Firestore"
                    >
                      <Cloud className={`w-3.5 h-3.5 text-slate-500 ${isSyncing ? 'animate-spin text-indigo-600' : ''}`} />
                      <span>{isSyncing ? 'Đang lưu...' : 'Lưu đám mây'}</span>
                    </button>
                  )}

                  {/* In / Xuất báo cáo */}
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                    title="Mở bảng in và xuất báo cáo (PDF, Word, Excel)"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-500" />
                    <span>In/Xuất</span>
                  </button>

                  {/* Sao lưu / Phục hồi - Chỉ Admin */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setIsSettingsModalOpen(true)}
                      className="h-8 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                      title="Sao lưu & Phục hồi dữ liệu (toàn bộ hoặc năm hiện tại)"
                    >
                      <FolderArchive className="w-3.5 h-3.5 text-slate-500" />
                      <span>Sao lưu/Phục hồi</span>
                    </button>
                  )}

                  {/* Toggle AI Consultant */}
                  <button
                    type="button"
                    onClick={() => setIsAiSidebarOpen(prev => !prev)}
                    className={`h-8 px-2.5 py-1 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                      isAiSidebarOpen
                        ? 'bg-indigo-600 text-white border-indigo-700 font-semibold'
                        : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                    }`}
                    title="Bật/Tắt khung Trợ lý Phân công AI"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{isAiSidebarOpen ? 'Đóng AI' : 'Trợ lý AI'}</span>
                  </button>

                  {/* Toggle Fullscreen */}
                  <button
                    type="button"
                    onClick={() => setIsBoardFullscreen(prev => !prev)}
                    className={`h-8 px-2.5 py-1 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                      isBoardFullscreen
                        ? 'bg-blue-600 text-white border-blue-700 font-semibold'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                    title={isBoardFullscreen ? "Thu nhỏ lại kích thước chuẩn (hoặc bấm Esc)" : "Mở rộng toàn màn hình"}
                  >
                    {isBoardFullscreen ? (
                      <>
                        <Minimize2 className="w-3.5 h-3.5 text-white" />
                        <span>Thu gọn</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                        <span>Toàn màn hình</span>
                      </>
                    )}
                  </button>

                  {/* Xóa phân công - Chỉ Admin */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleClearAssignments}
                      disabled={isCurrentTermLocked}
                      className={`h-8 px-2.5 py-1 text-xs font-medium rounded-lg border transition flex items-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                        isCurrentTermLocked
                          ? 'opacity-60 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'border-slate-300 bg-white text-slate-600 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
                      }`}
                      title={isCurrentTermLocked ? `Dữ liệu năm học ${currentAcademicYear} đang khóa` : 'Xóa phân công để làm lại'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa</span>
                    </button>
                  )}

                  {/* Viewer login unlock button */}
                  {!isAdmin && (
                    <button
                      type="button"
                      onClick={openLoginModal}
                      className="h-8 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg shadow-2xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                      title="Đăng nhập Quản trị viên để phân công giáo viên"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                      <span>Mở khóa sửa</span>
                    </button>
                  )}
                </div>
              </div>

              {/* TẦNG 2: DẢI CHỈ SỐ THỐNG KÊ SIÊU GỌN (COMPACT STRIP - CAO ~30px) */}
              <div className="h-7 md:h-8 px-3 bg-slate-50 border border-slate-200/90 rounded-md flex items-center justify-between text-[11px] md:text-xs text-slate-600 overflow-x-auto whitespace-nowrap mb-1.5 gap-2 shrink-0">
                <div className="flex items-center gap-2 flex-nowrap shrink-0">
                  <span><strong className="font-bold text-slate-900">{statsCount.classesCount}</strong> Lớp</span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span><strong className="font-bold text-slate-900">{statsCount.assignedTeachersCount}/{statsCount.teachersCount}</strong> GV</span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span>Chủ nhiệm: <strong className={`font-bold ${statsCount.homeroomAssigned === statsCount.classesCount ? 'text-emerald-700' : 'text-slate-900'}`}>{statsCount.homeroomAssigned}/{statsCount.classesCount}</strong></span>
                  <span className="text-slate-300 font-bold">•</span>
                  <span>Đã phân công: <strong className="font-bold text-slate-900">{statsCount.totalPeriodsAssigned}/{statsCount.totalRequiredPeriods}</strong> tiết</span>
                  <span className="text-slate-300 font-bold">•</span>
                  {conflictsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                      <AlertTriangle className="w-3 h-3 text-rose-500 inline shrink-0" />
                      Xung đột: {conflictsCount} cảnh báo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <CheckCircle className="w-3 h-3 text-emerald-600 inline shrink-0" />
                      0 Xung đột ✓
                    </span>
                  )}
                </div>
              </div>

              {aiExplanation && (
                <div className="mb-2 bg-indigo-50 border border-indigo-200/80 p-2.5 rounded-lg text-xs text-indigo-950 shrink-0">
                  <div className="flex items-center gap-2 mb-1 font-semibold text-indigo-950">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Lưu ý về phương án AI phân công:</span>
                  </div>
                  <p className="italic text-slate-700 leading-relaxed text-xs">{aiExplanation}</p>
                </div>
              )}

              {/* HIGH-DENSITY TABLE GRID */}
              <div className={`overflow-x-auto overflow-y-auto border border-slate-300 rounded-lg shadow-2xs bg-white ${
                isBoardFullscreen ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-210px)] min-h-[460px]'
              }`}>
                <table className="w-full text-left border-collapse min-w-[1100px] text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs">
                    <tr className="bg-slate-100 border-b border-slate-300 text-xs">
                      <th className="py-1.5 px-2 sticky left-0 top-0 bg-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-30 w-20 text-center font-bold text-blue-900 border border-slate-300">
                        Lớp
                      </th>
                      <th className="py-1.5 px-2 bg-blue-50/80 w-48 text-blue-900 font-bold text-center border border-slate-300">
                        GVCN
                      </th>
                      <th className="py-1.5 px-1.5 text-center w-20 bg-sky-50 text-blue-900 font-bold border border-slate-300">
                        Tổng
                      </th>
                      {SUBJECTS.map(sub => {
                        const headerLabel = 
                          sub.id === 'GD' || sub.id === 'GDKTPL' ? 'GDKTPL' :
                          sub.id === 'CN (Công nghiệp)' || sub.id === 'CNCN' ? (sub.name || 'CN') :
                          normalizeSubjectName(sub.id) === 'GDQPAN' ? 'GDQPAN' :
                          sub.name || sub.id;

                        return (
                          <th key={sub.id} className="py-1.5 px-1.5 font-bold text-blue-900 text-center min-w-[95px] border border-slate-300" title={sub.name}>
                            {headerLabel}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map(cls => {
                      const homeroomId = assignments.homeroomAssignments[cls.id];
                      const homeroomTeacher = teachers.find(t => t.id === homeroomId);
                      const totalAssignedPeriods = SUBJECTS.reduce((sum, sub) => {
                        const teacherId = getAssignedTeacherId(cls.id, sub.id);
                        return teacherId ? sum + getSubjectPeriod(sub.id, cls.grade, cls.id) : sum;
                      }, 0);

                      return (
                        <tr key={cls.id} className="hover:bg-slate-50/80 transition-colors h-[34px]">
                          {/* Class cell (Sticky) */}
                          <td className="py-1 px-2 font-bold text-slate-900 sticky left-0 bg-white hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 text-center border border-slate-300 text-xs">
                            <span>{cls.name}</span>
                          </td>

                          {/* Homeroom cell */}
                          <td 
                            onClick={() => {
                              if (!isAdmin) {
                                showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để can thiệp dữ liệu phân công!');
                                openLoginModal();
                                return;
                              }
                              if (isCurrentTermLocked) {
                                showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần thay đổi.`);
                                return;
                              }
                              setSelectedHomeroomCell({ classId: cls.id, currentTeacherId: homeroomId || '' });
                            }}
                            className={`py-1 px-2 border border-slate-300 transition-colors text-left text-xs ${
                              !isAdmin || isCurrentTermLocked
                                ? 'bg-slate-50/50 cursor-not-allowed'
                                : 'cursor-pointer bg-blue-50/20 hover:bg-blue-100/50'
                            }`}
                            title={!isAdmin ? 'Chế độ Chỉ xem.' : (isCurrentTermLocked ? `Dữ liệu đang khóa. GVCN: ${homeroomTeacher?.name}` : 'Bấm để phân công hoặc đổi GVCN')}
                          >
                            {homeroomTeacher ? (
                              <div className="flex items-center justify-between gap-1 leading-tight">
                                <div className="truncate min-w-0">
                                  <span className="truncate block font-semibold text-slate-900 text-xs">{homeroomTeacher.name}</span>
                                  <span className="text-[10px] text-blue-700 font-medium block" title={`Tổng số tiết dạy của ${homeroomTeacher.name}: ${teacherStatsMap[homeroomTeacher.id]?.assignedPeriods || 0} tiết`}>
                                    Tổng: {teacherStatsMap[homeroomTeacher.id]?.assignedPeriods || 0}t
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-normal shrink-0">({homeroomTeacher.experienceYears}N)</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 font-normal text-xs italic flex items-center gap-1 justify-center">
                                <UserPlus className="w-3 h-3" /> Chưa phân công
                              </span>
                            )}
                          </td>

                          {/* Total assigned periods cell */}
                          <td className="py-1 px-1.5 text-center bg-sky-50/30 border border-slate-300 align-middle">
                            <span className={`inline-flex items-center justify-center px-1.5 py-0.2 rounded font-bold text-[11px] ${
                              totalAssignedPeriods > 0 
                                ? 'bg-sky-100 text-sky-900' 
                                : 'bg-slate-100 text-slate-400'
                            }`}>
                              {totalAssignedPeriods}t
                            </span>
                          </td>

                          {/* Subject cells */}
                          {SUBJECTS.map(sub => {
                            const teacherId = getAssignedTeacherId(cls.id, sub.id);
                            const teacher = teachers.find(t => t.id === teacherId);
                            const period = getSubjectPeriod(sub.id, cls.grade, cls.id);
                            const isZeroPeriod = period === 0;
                            const teacherStat = teacher ? teacherStatsMap[teacher.id] : null;
                            const teacherTotal = teacherStat?.assignedPeriods ?? 0;
                            const isOverloaded = teacherStat ? teacherTotal > teacherStat.maxAllowed : false;

                            // Nếu lớp không học môn này (0 tiết)
                            if (isZeroPeriod) {
                              if (teacher) {
                                return (
                                  <td
                                    key={sub.id}
                                    onClick={() => {
                                      if (isCurrentTermLocked) {
                                        showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                                        return;
                                      }
                                      setSelectedCell({ classId: cls.id, subject: sub.id, currentTeacherId: teacherId || '' });
                                    }}
                                    className={`py-1 px-1 text-center border border-slate-300 transition-all opacity-60 hover:opacity-100 align-middle ${
                                      isCurrentTermLocked ? 'bg-slate-100/50 cursor-not-allowed' : 'cursor-pointer bg-slate-100/70 hover:bg-rose-50'
                                    }`}
                                    title={isCurrentTermLocked ? `Dữ liệu đang khóa. GV: ${teacher.name}` : `Lớp ${cls.name} không học môn này (0 tiết) nhưng đang có GV: ${teacher.name}. Bấm để bỏ phân công.`}
                                  >
                                    <div className="text-slate-500 line-through text-[11px] truncate max-w-[100px] mx-auto font-medium">
                                      {teacher.name.replace('Thầy ', '').replace('Cô ', '')}
                                    </div>
                                    <span className="text-[9px] text-rose-500 font-semibold block leading-none mt-0.5">0t (Gỡ)</span>
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={sub.id}
                                  onClick={() => {
                                    if (isCurrentTermLocked) {
                                      showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                                      return;
                                    }
                                    setSelectedCell({ classId: cls.id, subject: sub.id, currentTeacherId: '' });
                                  }}
                                  className={`py-1 px-1 text-center border border-slate-300 transition-all align-middle ${
                                    isCurrentTermLocked ? 'bg-slate-50/50 cursor-not-allowed' : 'cursor-pointer bg-slate-50/60 hover:bg-sky-50'
                                  }`}
                                  title={`Lớp ${cls.name} - Môn ${sub.name}: Hiện 0 tiết. Bấm để điều chỉnh số tiết hoặc phân công giáo viên.`}
                                >
                                  <span className="text-slate-400 group-hover/zero:text-blue-600 font-semibold text-[11px] select-none block leading-none">0t</span>
                                </td>
                              );
                            }

                            return (
                              <td 
                                key={sub.id}
                                onClick={() => {
                                  if (!isAdmin) {
                                    showTermNotification('⚠️ Bạn đang ở chế độ Chỉ xem. Vui lòng bấm "Đăng nhập Quản trị" để can thiệp dữ liệu phân công!');
                                    openLoginModal();
                                    return;
                                  }
                                  if (isCurrentTermLocked) {
                                    showTermNotification(`⚠️ Dữ liệu năm học ${currentAcademicYear} đang KHÓA để bảo vệ. Bấm nút "Mở khóa" trên thanh tiêu đề nếu cần chỉnh sửa.`);
                                    return;
                                  }
                                  setSelectedCell({ classId: cls.id, subject: sub.id, currentTeacherId: teacherId || '' });
                                }}
                                className={`py-1 px-1 text-center border border-slate-300 transition-all align-middle ${
                                  !isAdmin || isCurrentTermLocked 
                                    ? 'cursor-not-allowed hover:bg-slate-50' 
                                    : 'cursor-pointer hover:bg-slate-100/80'
                                }`}
                                title={!isAdmin ? 'Chế độ Chỉ xem. Bấm Đăng nhập Quản trị để thay đổi giáo viên.' : (isCurrentTermLocked ? `Dữ liệu năm học ${currentAcademicYear} đang khóa. Bấm "Mở khóa" nếu cần sửa.` : undefined)}
                              >
                                {teacher ? (
                                  <div className="inline-block w-full text-center px-0.5">
                                    <div className="font-semibold text-slate-900 truncate leading-tight text-xs" title={teacher.name}>
                                      {teacher.name.replace('Thầy ', '').replace('Cô ', '')}
                                    </div>
                                    <div className="flex items-center justify-center gap-1 mt-0.5 leading-none">
                                      <span 
                                        className={`font-semibold px-1 py-0.2 rounded text-[10px] whitespace-nowrap ${
                                          isOverloaded 
                                            ? 'bg-rose-100 text-rose-700' 
                                            : 'bg-blue-50 text-blue-700'
                                        }`}
                                        title={`GV ${teacher.name}: Tổng ${teacherTotal}t / định mức ${teacherStat?.maxAllowed || teacher.maxPeriods}t`}
                                      >
                                        {teacherTotal}t
                                      </span>
                                      <span className="text-slate-400 font-mono text-[9px]" title={`Số tiết môn này của lớp ${cls.name}: ${period} tiết`}>
                                        ({period}t)
                                      </span>
                                    </div>
                                    {normalizeSubjectName(teacher.specialization) !== normalizeSubjectName(sub.id) && !['GDĐP', 'TNHN1', 'TNHN2'].includes(sub.id) && (
                                      <div className="mt-0.5">
                                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-medium inline-block leading-none" title="Dạy trái chuyên môn">
                                          ⚠️ Sai môn
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-[11px] italic font-normal block text-center leading-none">
                                    {period}t trống
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 font-bold text-xs">
                    <tr className="bg-slate-100 text-slate-900 shadow-[0_-2px_5px_-2px_rgba(0,0,0,0.1)]">
                      <td className="py-1.5 px-2 sticky left-0 bottom-0 bg-slate-100 border border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-30 font-bold text-blue-900 text-center">
                        Tổng cộng
                      </td>
                      <td className="py-1.5 px-2 text-xs text-blue-950 border border-slate-300 font-semibold sticky bottom-0 bg-blue-50/90 z-20 text-center">
                        {statsCount.homeroomAssigned}/{classes.length} lớp có GVCN
                      </td>
                      <td className="py-1.5 px-1.5 text-center font-bold text-blue-800 bg-sky-100/90 border border-slate-300 sticky bottom-0 z-20" title="Tổng số tiết đã phân công toàn trường">
                        {classes.reduce((acc, c) => acc + SUBJECTS.reduce((s, sub) => {
                          const tId = getAssignedTeacherId(c.id, sub.id);
                          return tId ? s + getSubjectPeriod(sub.id, c.grade, c.id) : s;
                        }, 0), 0)} tiết
                      </td>
                      {SUBJECTS.map(sub => {
                        const subjectAssignedPeriods = classes.reduce((sum, c) => {
                          const tId = getAssignedTeacherId(c.id, sub.id);
                          return tId ? sum + getSubjectPeriod(sub.id, c.grade, c.id) : sum;
                        }, 0);
                        return (
                          <td key={sub.id} className="py-1.5 px-1 text-center text-xs text-blue-800 font-bold border border-slate-300 sticky bottom-0 bg-slate-100 z-20" title={`Đã phân công ${subjectAssignedPeriods} tiết môn ${sub.name}`}>
                            {subjectAssignedPeriods}t
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>'''

if start_marker in content and end_marker in content:
    start_pos = content.find(start_marker)
    end_pos = content.find(end_marker, start_pos) + len(end_marker)
    content = content[:start_pos] + new_block + content[end_pos:]
    with open('src/App.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS")
else:
    print(f"FAILED: start_marker in content = {start_marker in content}, end_marker in content = {end_marker in content}")
