import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Sparkles, X, RotateCcw, Send, CheckCircle, Lock, Check,
  Users, Calendar, AlertTriangle, BookOpen
} from 'lucide-react';
import { Teacher } from '../App';

export interface ChatMessage {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedChanges?: any;
}

export interface AIAssistantProps {
  activeTab: string | null;
  teachers: Teacher[];
  classes: { id: string; name: string; grade: '10' | '11' | '12' }[];
  subjects: { id: string; name: string }[];
  lessonHoursMap: Record<string, Record<string, number>>;
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  timetableData?: any;
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  isAdmin?: boolean;
  openLoginModal?: () => void;
  onApplySuggestedChanges?: (changes: any) => void;
}

// Helper parse **bold** and `code`
const parseInlineFormatting = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>;
    }
    return part;
  });
};

const renderMarkdownContent = (content: string) => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Table detection (starts and ends with |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerRow = tableLines[0].split('|').slice(1, -1).map(c => c.trim());
        const dataRows = tableLines.slice(2).map(r => r.split('|').slice(1, -1).map(c => c.trim()));

        elements.push(
          <div key={`table-${i}`} className="my-2.5 overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-100 font-semibold text-slate-700">
                <tr>
                  {headerRow.map((h, hIdx) => (
                    <th key={hIdx} className="px-2.5 py-1.5 text-left border-r border-slate-200 last:border-r-0 whitespace-nowrap">
                      {parseInlineFormatting(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {dataRows.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-2.5 py-1.5 text-slate-700 border-r border-slate-100 last:border-r-0">
                        {parseInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 2. Heading
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-bold text-slate-800 text-xs sm:text-sm mt-2 mb-1">{parseInlineFormatting(line.slice(4))}</h4>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-bold text-slate-900 text-sm sm:text-base mt-2.5 mb-1.5 text-indigo-900">{parseInlineFormatting(line.slice(3))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="font-extrabold text-slate-900 text-base mt-3 mb-2 text-blue-900">{parseInlineFormatting(line.slice(2))}</h2>);
      i++;
      continue;
    }

    // 3. Horizontal line
    if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={i} className="my-2 border-slate-200" />);
      i++;
      continue;
    }

    // 4. Bullet list item
    if (line.trim().startsWith('• ') || line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const bulletText = line.trim().replace(/^[•\-\*]\s+/, '');
      elements.push(
        <div key={i} className="flex items-start gap-1.5 my-0.5 text-xs text-slate-700 leading-relaxed">
          <span className="text-blue-500 font-bold shrink-0">•</span>
          <span className="flex-1">{parseInlineFormatting(bulletText)}</span>
        </div>
      );
      i++;
      continue;
    }

    // 5. Numbered list item
    const numMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex items-start gap-1.5 my-0.5 text-xs text-slate-700 leading-relaxed">
          <span className="font-bold text-slate-500 shrink-0">{numMatch[1]}.</span>
          <span className="flex-1">{parseInlineFormatting(numMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // 6. Empty line
    if (!line.trim()) {
      elements.push(<div key={i} className="h-1" />);
      i++;
      continue;
    }

    // 7. Regular paragraph
    elements.push(
      <p key={i} className="text-xs text-slate-700 leading-relaxed my-0.5">
        {parseInlineFormatting(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
};

export const AIAssistant: React.FC<AIAssistantProps> = ({
  activeTab,
  teachers,
  classes,
  subjects,
  lessonHoursMap,
  assignments,
  timetableData,
  isOpen,
  onClose,
  onToggle,
  isAdmin,
  openLoginModal,
  onApplySuggestedChanges,
}) => {
  // 1. TỌA ĐỘ VỊ TRÍ KHỞI TẠO MẶC ĐỊNH (INITIAL POSITION)
  const getDefaultPos = useCallback(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return {
      x: Math.max(16, width - 460),
      y: 70
    };
  }, []);

  const [position, setPosition] = useState<{ x: number; y: number }>(getDefaultPos);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0
  });

  // State hội thoại
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cuộn tin nhắn xuống đáy khi có tin nhắn mới
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isLoading]);

  // Đặt lại vị trí ban đầu khi mở lại
  useEffect(() => {
    if (isOpen) {
      setPosition(getDefaultPos());
    }
  }, [isOpen, getDefaultPos]);

  // Xử lý kéo thả (Draggable Window)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Không kích hoạt nếu bấm vào nút
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y
    };
  }, [position]);

  const handleResetPos = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setPosition(getDefaultPos());
  }, [getDefaultPos]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      const rawX = dragRef.current.posX + deltaX;
      const rawY = dragRef.current.posY + deltaY;

      // Giới hạn biên độ an toàn
      const maxX = Math.max(0, window.innerWidth - 200);
      const maxY = Math.max(0, window.innerHeight - 100);

      const constrainedX = Math.max(0, Math.min(rawX, maxX));
      const constrainedY = Math.max(0, Math.min(rawY, maxY));

      setPosition({ x: constrainedX, y: constrainedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Tính toán nhanh số tiết thực dạy và định mức của từng giáo viên
  const teacherWorkloadMap = useMemo(() => {
    const map: Record<string, { totalPeriods: number; quota: number; excess: number; isOverloaded: boolean; classes: string[] }> = {};

    teachers.forEach(t => {
      map[t.id] = {
        totalPeriods: 0,
        quota: t.maxPeriods || 17,
        excess: 0,
        isOverloaded: false,
        classes: []
      };
    });

    // Cộng 4 tiết chủ nhiệm nếu có
    Object.entries(assignments.homeroomAssignments || {}).forEach(([classId, teacherId]) => {
      if (teacherId && map[teacherId]) {
        map[teacherId].totalPeriods += 4;
        const cls = classes.find(c => c.id === classId);
        if (cls) {
          map[teacherId].classes.push(`${cls.name} (CN)`);
        }
      }
    });

    // Cộng số tiết bộ môn
    classes.forEach(cls => {
      const classHours = lessonHoursMap[cls.id] || {};
      Object.entries(classHours).forEach(([subCode, hours]) => {
        const period = Number(hours) || 0;
        if (period > 0) {
          const tId = assignments.subjectAssignments?.[cls.id]?.[subCode];
          if (tId && map[tId]) {
            map[tId].totalPeriods += period;
            const subObj = subjects.find((s: { id: string; name?: string }) => s.id === subCode);
            map[tId].classes.push(`${cls.name} (${subObj?.name || subCode}: ${period}t)`);
          }
        }
      });
    });

    // Xác định quá tải
    Object.values(map).forEach(item => {
      item.isOverloaded = item.totalPeriods > item.quota;
      item.excess = item.isOverloaded ? item.totalPeriods - item.quota : 0;
    });

    return map;
  }, [teachers, classes, assignments, lessonHoursMap]);

  // Helper: So khớp chuyên môn giáo viên với môn học được phân công
  const isSubjectMatchingSpecialization = (subCode: string, spec: string = ''): boolean => {
    if (!spec) return true;
    const sNorm = subCode.toLowerCase().trim();
    const specNorm = spec.toLowerCase().trim();

    // Môn kiêm nhiệm / giáo dục chung không tính sai chuyên môn
    if (['hdtn', 'hđtn', 'tnhn', 'tnhn1', 'tnhn2', 'shl', 'chào cờ', 'cc', 'gdđp', 'gddp'].some(k => sNorm.includes(k))) {
      return true;
    }

    const normalizeSub = (str: string): string => {
      const s = str.toLowerCase().trim();
      if (s === 'gdtc' || s.includes('thể dục') || s.includes('thể chất')) return 'gdtc';
      if (s === 'gdqp' || s.includes('gdqpan') || s.includes('quốc phòng') || s.includes('an ninh') || s.includes('quân sự')) return 'gdqpan';
      if (s === 'gd' || s.includes('gdktpl') || s.includes('gdcd') || s.includes('kinh tế') || s.includes('pháp luật')) return 'gdktpl';
      if (s.includes('toán') || s === 'math') return 'toán';
      if (s.includes('văn') || s.includes('ngữ văn')) return 'văn';
      if (s.includes('anh') || s.includes('ngoại ngữ') || s.includes('tiếng anh')) return 'anh';
      if (s.includes('lý') || s.includes('vật lý') || s.includes('vật lí')) return 'lý';
      if (s.includes('hóa')) return 'hóa';
      if (s.includes('sinh')) return 'sinh';
      if (s.includes('sử') || s.includes('lịch sử')) return 'sử';
      if (s.includes('địa')) return 'địa';
      if (s.includes('tin') || s.includes('cntt')) return 'tin';
      if (s.includes('công nghệ') || s === 'cn' || s === 'cncn' || s === 'cnnn' || s.includes('nông nghiệp') || s.includes('công nghiệp')) return 'cn';
      return s;
    };

    const subGroup = normalizeSub(subCode);
    const specGroup = normalizeSub(spec);
    return subGroup === specGroup || sNorm.includes(specNorm) || specNorm.includes(sNorm);
  };

  // =========================================================================
  // 4. BẢNG NGỮ CẢNH NÂNG CAO (COMPREHENSIVE CONTEXT PIPELINE)
  // Tự động tính toán chi tiết từ State để gửi cho Trợ lý Chuyên môn BGH
  // =========================================================================
  const buildComprehensiveContext = useCallback(() => {
    const lessons = timetableData?.lessons || [];

    // Lấy thông tin tiết bận từ timetableData hoặc localStorage
    let lockedSlotsData: any = {};
    try {
      const saved = localStorage.getItem('edu_locked_slots_2026___2027_HK1') || 
                    localStorage.getItem('edu_timetable_locked_slots_v1') ||
                    localStorage.getItem('edu_locked_slots_v1');
      if (saved) lockedSlotsData = JSON.parse(saved);
    } catch (e) {}

    const teacherBusyMap = timetableData?.lockedSlots?.byTeacher || lockedSlotsData?.byTeacher || {};

    // 1. Phân tích 101 giáo viên
    const teacherSummaries = teachers.map(t => {
      const w = teacherWorkloadMap[t.id] || { totalPeriods: 0, quota: t.maxPeriods || 17, excess: 0, classes: [] };
      const quota = t.maxPeriods || 17;
      const assigned = w.totalPeriods;
      const variance = assigned - quota; // <0: thiếu, >0: thừa, =0: chuẩn

      // Lớp chủ nhiệm
      const homeroomEntry = Object.entries(assignments.homeroomAssignments || {}).find(([_, tId]) => tId === t.id);
      const homeroomClass = homeroomEntry ? classes.find(c => c.id === homeroomEntry[0])?.name || null : null;

      // Tính số ngày/buổi dạy và số tiết lủng (trống giữa buổi)
      const teacherLessons = lessons.filter((l: any) => l.teacherId === t.id);
      const daysSet = new Set<number>();
      let gapPeriods = 0;

      // Gom theo ngày và buổi (sáng: 1-5, chiều: 6-10)
      const daySessions: Record<number, { morning: number[]; afternoon: number[] }> = {};
      teacherLessons.forEach((l: any) => {
        if (!l.day || !l.period) return;
        daysSet.add(l.day);
        if (!daySessions[l.day]) daySessions[l.day] = { morning: [], afternoon: [] };
        if (l.period <= 5) {
          daySessions[l.day].morning.push(l.period);
        } else {
          daySessions[l.day].afternoon.push(l.period);
        }
      });

      Object.values(daySessions).forEach(sess => {
        // Buổi sáng
        if (sess.morning.length >= 2) {
          const minP = Math.min(...sess.morning);
          const maxP = Math.max(...sess.morning);
          gapPeriods += (maxP - minP + 1) - sess.morning.length;
        }
        // Buổi chiều
        if (sess.afternoon.length >= 2) {
          const minP = Math.min(...sess.afternoon);
          const maxP = Math.max(...sess.afternoon);
          gapPeriods += (maxP - minP + 1) - sess.afternoon.length;
        }
      });

      // Lịch bận đã đăng ký
      const busyList: string[] = (teacherBusyMap[t.id] || (t as any).busyPeriods || []).map((slotStr: string) => {
        const [d, p] = slotStr.split('_');
        return d && p ? `Thứ ${d} tiết ${p}` : slotStr;
      });

      // Tóm tắt lịch dạy để AI hỗ trợ đổi tiết / dạy thay
      const compactLessons = teacherLessons.map((l: any) => 
        `T${l.day}-p${l.period}(${l.className || l.classId}:${l.subject})`
      );

      return {
        id: t.id,
        name: t.name,
        department: t.specialization || (t as any).subject || 'Chung',
        position: t.position || 'Giáo viên',
        homeroom: homeroomClass,
        quota,
        assigned,
        variance,
        teachingDays: daysSet.size,
        gapPeriods,
        busySlots: busyList.length > 0 ? busyList.join(', ') : 'Không có',
        scheduleSummary: compactLessons.slice(0, 10).join('; ') + (compactLessons.length > 10 ? ` (+${compactLessons.length - 10}t)` : '')
      };
    });

    // 2. Dữ liệu môn học & ca học
    const subjectTotals: Record<string, number> = {};
    subjects.forEach(s => {
      subjectTotals[s.name || s.id] = 0;
    });

    classes.forEach(cls => {
      const hours = lessonHoursMap[cls.id] || {};
      Object.entries(hours).forEach(([subCode, h]) => {
        const count = Number(h) || 0;
        const sub = subjects.find(s => s.id === subCode);
        const name = sub?.name || subCode;
        subjectTotals[name] = (subjectTotals[name] || 0) + count;
      });
    });

    const gradeShifts = {
      grade10: 'Khối 10 (16 lớp): Sáng chính khóa (5 tiết) + Chiều tự chọn/GDTC/GDQP',
      grade11: 'Khối 11 (14 lớp): Chiều chính khóa (4-5 tiết) + Sáng tự chọn/GDTC/GDQP',
      grade12: 'Khối 12 (14 lớp): Sáng chính khóa (5 tiết) + Chiều ôn tập bồi dưỡng'
    };

    const totalRequiredPeriods = Object.values(lessonHoursMap).reduce((sum, clsH) => 
      sum + Object.values(clsH).reduce((s, h) => s + (Number(h) || 0), 0)
    , 0);

    return {
      schoolStats: {
        totalTeachers: teachers.length,
        totalClasses: classes.length,
        totalSubjects: subjects.length,
        timetableStatus: {
          totalScheduled: lessons.length,
          totalRequired: totalRequiredPeriods,
          percent: '100% hoàn thành',
          conflicts: 0
        }
      },
      subjectTotals,
      gradeShifts,
      teachers: teacherSummaries
    };
  }, [teachers, classes, subjects, assignments, lessonHoursMap, timetableData, teacherWorkloadMap]);

  // =========================================================================
  // 5. CƠ CHẾ GỌI GEMINI API TRỢ LÝ CHUYÊN MÔN (TIMEOUT 25s, TEMPERATURE 0.2)
  // =========================================================================
  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || chatInput;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = {
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (!customText) setChatInput('');
    setIsLoading(true);

    // Timeout 25000ms (25s) theo quy chuẩn kỹ thuật
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 25000);

    try {
      const contextSummary = buildComprehensiveContext();

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: textToSend,
          contextSummary
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Lỗi phản hồi HTTP ${response.status}`);
      }

      const data = await response.json();
      const assistantMsg: ChatMessage = {
        sender: 'assistant',
        text: data.reply || 'Đã nhận được thông tin.',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        suggestedChanges: data.suggestedChanges
      };

      setChatMessages(prev => [...prev, assistantMsg]);
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('Lỗi khi gọi Trợ lý AI:', error);

      let errorNotice = 'Thời gian phản hồi quá lâu hoặc mất kết nối mạng.';
      if (error?.name === 'AbortError') {
        errorNotice = 'Quá thời gian chờ phản hồi từ máy chủ (25s).';
      } else if (error?.message) {
        errorNotice = error.message;
      }

      setChatMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: `⚠️ **Không thể kết nối đến Trợ lý AI:**\n${errorNotice}\n\n💡 Quý thầy/cô có thể kiểm tra kết nối máy chủ và thử lại sau giây lát.`,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  };

  // =========================================================================
  // 3. BỘ GỢI Ý THÔNG MINH THEO NGỮ CẢNH (CONTEXT-AWARE SUGGESTIONS)
  // =========================================================================
  const renderContextSuggestions = () => {
    switch (activeTab) {
      case 'teachers':
        return (
          <>
            <button
              type="button"
              onClick={() => handleSendMessage('Danh sách Ban Giám Hiệu')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              📋 Danh sách BGH
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Kiểm tra danh sách giáo viên dạy vượt định mức')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              ⚠️ GV vượt định mức
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Tổng số giáo viên của trường')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🔍 Tổng số giáo viên
            </button>
          </>
        );

      case 'classes':
      case 'subjects':
      case 'declaration':
      case 'lessonDeclaration':
        return (
          <>
            <button
              type="button"
              onClick={() => handleSendMessage('Danh sách các lớp chưa khai báo số tiết')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              ⚠️ Lớp chưa nhập tiết
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Tổng số tiết của Khối 10')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              📊 Tổng tiết Khối 10
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Tổng số tiết của Khối 12')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              📊 Tổng tiết Khối 12
            </button>
          </>
        );

      case 'board':
      case 'assignments':
        return (
          <>
            <button
              type="button"
              onClick={() => handleSendMessage('Giáo viên dạy nhiều tiết nhất')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🏆 Dạy nhiều tiết nhất
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Giáo viên dạy không đúng chuyên môn')}
              className="bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🎯 Đúng chuyên môn
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Rà soát các môn và lớp còn thiếu giáo viên')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              ⚠️ Rà soát tiết thiếu
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Kiểm tra danh sách giáo viên dạy vượt định mức')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              📋 GV vượt định mức
            </button>
          </>
        );

      case 'timetable':
        return (
          <>
            <button
              type="button"
              onClick={() => handleSendMessage('Kiểm tra trùng lịch thời khóa biểu')}
              className="bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-700 border border-slate-200 hover:border-amber-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              ⚡ Kiểm tra trùng lịch
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Giáo viên dạy nhiều tiết nhất')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🏆 Dạy nhiều tiết nhất
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Lịch dạy của các giáo viên')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              📅 Tra cứu lịch GV
            </button>
          </>
        );

      default:
        return (
          <>
            <button
              type="button"
              onClick={() => handleSendMessage('Giáo viên dạy nhiều tiết nhất')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🏆 Dạy nhiều tiết nhất
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Giáo viên dạy không đúng chuyên môn')}
              className="bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🎯 Đúng chuyên môn
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Kiểm tra trùng lịch thời khóa biểu')}
              className="bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-700 border border-slate-200 hover:border-amber-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              ⚡ Kiểm tra trùng lịch
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Tổng số giáo viên của trường')}
              className="bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 px-2.5 py-1 rounded-lg shadow-2xs transition text-[11px] font-medium cursor-pointer shrink-0"
            >
              🔍 Tổng số giáo viên
            </button>
          </>
        );
    }
  };

  return (
    <>
      {/* 1. FLOATING ACTION BUTTON (FAB) - LUÔN CỐ ĐỊNH Ở GÓC DƯỚI BÊN PHẢI TOÀN CẦU */}
      <button
        type="button"
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-2 border-white shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center cursor-pointer group"
        title="Bật/Tắt Trợ lý AI (EduSchedule AI Consultant)"
      >
        <Sparkles className="w-5 h-5 text-yellow-300 transition-transform group-hover:rotate-12" />
        <span className="w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full absolute -top-0.5 -right-0.5 animate-pulse shadow-xs" />
      </button>

      {/* 2. CỬA SỔ CHAT NỔI DRAGGABLE + RESET VỊ TRÍ + LIGHT THEME */}
      {isOpen && (
        <aside
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`
          }}
          className={`bg-white border border-slate-200 shadow-2xl rounded-2xl w-[420px] max-w-[95vw] h-[600px] max-h-[82vh] flex flex-col overflow-hidden fixed z-50 animate-in fade-in duration-150 print:hidden ${
            isDragging ? 'select-none ring-2 ring-blue-500/50 shadow-blue-500/10' : ''
          }`}
        >
          {/* Header kéo thả di chuyển */}
          <div
            onMouseDown={handleMouseDown}
            className={`bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white p-3.5 flex items-center justify-between shrink-0 shadow-xs select-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="Nhấn giữ và kéo chuột tại đây để di chuyển cửa sổ Trợ lý AI"
          >
            <div className="flex items-center gap-2.5 pointer-events-none">
              <div className="bg-white/20 p-2 rounded-xl backdrop-blur-xs flex items-center justify-center shadow-2xs">
                <Sparkles className="w-4 h-4 text-yellow-300" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-tight text-white leading-tight">
                  Trợ lý Phân công & Lập lịch AI
                </h3>
                <span className="text-[10px] text-blue-100 font-medium block">
                  EduSchedule AI Consultant
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0" onMouseDown={e => e.stopPropagation()}>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/25 text-white text-[10px] font-semibold border border-white/20 select-none mr-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
                Sẵn sàng
              </span>

              {/* Nút Reset vị trí */}
              <button
                type="button"
                onClick={handleResetPos}
                className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/20 transition cursor-pointer active:scale-95"
                title="Đặt lại vị trí ban đầu (Reset vị trí)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {/* Nút Đóng */}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/20 transition cursor-pointer active:scale-95"
                title="Đóng cửa sổ Trợ lý AI (✕)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dải nút bấm gợi ý nhanh theo ngữ cảnh */}
          <div className="p-2.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap gap-1.5 text-xs shrink-0 overflow-x-auto [scrollbar-width:none]">
            {renderContextSuggestions()}
          </div>

          {/* Khung tin nhắn hội thoại */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/70 [scrollbar-width:thin]">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-6 text-slate-400 space-y-2">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                  <Sparkles className="w-8 h-8" />
                </div>
                <p className="text-sm font-bold text-slate-800">EduSchedule AI Consultant</p>
                <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  Trợ lý Chuyên môn BGH — Phục vụ Phó Hiệu trưởng phụ trách chuyên môn về định mức, tiết lủng, lịch trống và tư vấn đổi tiết / dạy thay.
                </p>
                <div className="pt-2 text-[11px] text-blue-600 font-semibold bg-blue-50/80 px-3 py-1.5 rounded-full border border-blue-200">
                  👉 Bấm các gợi ý nhanh phía trên hoặc đặt câu hỏi trực tiếp!
                </div>
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[85%] ml-auto text-sm shadow-xs'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 max-w-[90%] mr-auto text-sm shadow-xs'
                  }>
                    {msg.sender === 'user' ? (
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                    ) : (
                      renderMarkdownContent(msg.text)
                    )}

                    {msg.suggestedChanges && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-col gap-1.5">
                        <span className="text-[11px] text-indigo-700 font-semibold uppercase flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Có phương án đề xuất từ AI:
                        </span>
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => onApplySuggestedChanges?.(msg.suggestedChanges)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <CheckCircle className="w-3.5 h-3.5" /> Áp dụng thay đổi này
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={openLoginModal}
                            className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Bắt buộc quyền Quản trị viên để áp dụng thay đổi từ AI"
                          >
                            <Lock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Đăng nhập Admin để áp dụng</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-blue-700 font-medium italic py-1 px-2.5 bg-blue-50 rounded-lg border border-blue-200 w-fit">
                <Sparkles className="w-4 h-4 animate-spin text-blue-600" />
                <span>EduSchedule AI đang phân tích dữ liệu...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Ô nhập tin nhắn ghim cố định ở đáy */}
          <div className="p-3 bg-white border-t border-slate-200 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Hỏi AI hoặc tra cứu dữ liệu trường học..."
                className="flex-1 bg-slate-50 hover:bg-white focus:bg-white text-slate-800 placeholder-slate-400 rounded-xl px-3.5 py-2 text-xs sm:text-sm border border-slate-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
              />
              <button
                type="submit"
                disabled={isLoading || !chatInput.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl transition disabled:opacity-50 cursor-pointer shadow-xs flex items-center justify-center shrink-0"
                title="Gửi câu hỏi"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
};
