import React, { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, CheckCircle, HelpCircle, Loader2, ArrowRight, Mic, Check } from 'lucide-react';
import { Teacher, ClassModel } from '../utils/assignmentSolver';

interface SubjectConfig {
  id: string;
  name: string;
  grade10Periods: number;
  grade11Periods: number;
  grade12Periods: number;
}

export type NlImportType = 'teachers' | 'classes' | 'subjects' | 'assignment' | 'lessonHours' | 'assignments';

interface NaturalLanguageImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: NlImportType;
  teachers?: Teacher[];
  classes?: ClassModel[];
  subjectsConfig?: SubjectConfig[];
  onImportTeachers: (parsed: any[]) => void;
  onImportClasses: (parsed: any[]) => void;
  onImportSubjects: (parsed: any[]) => void;
  onImportLessonHours?: (parsed: any[]) => void;
  onImportAssignments: (parsed: any[]) => void;
  onNotification?: (msg: string) => void;
}

export const NaturalLanguageImportModal: React.FC<NaturalLanguageImportModalProps> = ({
  isOpen,
  onClose,
  type,
  teachers = [],
  classes = [],
  subjectsConfig = [],
  onImportTeachers,
  onImportClasses,
  onImportSubjects,
  onImportLessonHours,
  onImportAssignments,
  onNotification
}) => {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedPreview, setParsedData] = useState<any[] | null>(null);
  const [isApplied, setIsApplied] = useState(false);
  const [progressStep, setProgressStep] = useState<string>('');

  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  // Safe checks for arrays
  const safeTeachers = Array.isArray(teachers) ? teachers : [];
  const safeClasses = Array.isArray(classes) ? classes : [];
  const safeSubjects = Array.isArray(subjectsConfig) ? subjectsConfig : [];

  useEffect(() => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'vi-VN';

        rec.onstart = () => {
          setIsListening(true);
        };

        rec.onresult = (event: any) => {
          try {
            const resultIndex = event.resultIndex;
            const transcript = event.results?.[resultIndex]?.[0]?.transcript || '';
            if (transcript) {
              setText(prev => {
                const trimmed = prev.trim();
                return trimmed ? `${trimmed} ${transcript}` : transcript;
              });
            }
          } catch (e) {
            console.error('Speech onresult error:', e);
          }
        };

        rec.onerror = (event: any) => {
          console.warn('Speech recognition warning:', event?.error);
          if (event?.error === 'not-allowed') {
            setError('⚠️ Không được phép truy cập Micro. Vui lòng cho phép quyền truy cập micro trong cài đặt trình duyệt.');
          } else {
            setError(`⚠️ Nhận diện giọng nói: ${event?.error || 'Không khả dụng'}`);
          }
          setIsListening(false);
        };

        rec.onend = () => {
          setIsListening(false);
        };

        setRecognition(rec);
      }
    } catch (e) {
      console.warn('Speech recognition not supported or initialization error:', e);
    }
  }, []);

  // Reset text/preview when modal opens or type changes
  useEffect(() => {
    if (isOpen) {
      setText('');
      setError(null);
      setParsedData(null);
      setIsApplied(false);
    }
  }, [isOpen, type]);

  const handleToggleListening = () => {
    if (!recognition) {
      alert('⚠️ Trình duyệt của bạn hiện không hỗ trợ tính năng Web Speech API. Vui lòng dùng trình duyệt Google Chrome hoặc gõ văn bản trực tiếp.');
      return;
    }

    if (isListening) {
      try {
        recognition.stop();
      } catch (err) {
        console.warn('Speech stop error:', err);
      }
      setIsListening(false);
    } else {
      setError(null);
      try {
        recognition.start();
      } catch (err) {
        console.warn('Speech start error:', err);
        setIsListening(false);
      }
    }
  };

  if (!isOpen) return null;

  // Cấu hình riêng biệt cho từng loại nghiệp vụ
  const getConfigForType = () => {
    switch (type) {
      case 'teachers':
        return {
          title: 'Nhập danh sách Giáo viên bằng AI',
          subtitle: 'Gõ hoặc dán văn bản mô tả thông tin giáo viên (họ tên, môn dạy, chức vụ, định mức tiết...) để AI tự động trích xuất và thêm vào Danh mục Giáo viên.',
          placeholder: 'Ví dụ: Thêm cô Nguyễn Hoa Lan dạy Toán, định mức 18 tiết là Tổ trưởng; thầy Lê Văn Nam dạy Anh Văn là giáo viên, cô Phạm Thị Tuyết dạy Văn làm Tổ phó...',
          exampleText: 'Thêm cô Nguyễn Hoa Lan dạy Toán, định mức 18 tiết là Tổ trưởng chuyên môn, thầy Lê Văn Nam dạy Anh Văn là Giáo viên, cô Phạm Thị Tuyết dạy Văn làm Tổ phó.',
          storageTargetName: 'Danh mục Giáo viên',
          systemPrompt: "Trích xuất thông tin giáo viên từ văn bản thành mảng JSON: [{ name: string, subject: string, role: string, quota: number }]. Nếu không đề cập chức vụ gán '', không đề cập định mức gán 0."
        };
      case 'classes':
        return {
          title: 'Nhập danh sách Lớp học bằng AI',
          subtitle: 'Gõ danh sách các lớp học và khối lớp để AI tự động tách và tạo nhanh các lớp học mới vào Danh mục Lớp học.',
          placeholder: 'Ví dụ: Thêm lớp 10A1, 10A2 thuộc Khối 10, lớp 11A1, 11A2 thuộc Khối 11, lớp 12A1 thuộc Khối 12...',
          exampleText: 'Thêm lớp 10A1, 10A2 thuộc Khối 10, lớp 11A1, 11A2 thuộc Khối 11, lớp 12A1, 12A2 và 12D1 thuộc Khối 12.',
          storageTargetName: 'Danh mục Lớp học',
          systemPrompt: "Trích xuất danh sách lớp học THPT từ văn bản thành mảng JSON: [{ name: string, grade: string }]. Ví dụ: 10A1 thì name='10A1', grade='10'. Chỉ trích xuất danh sách lớp."
        };
      case 'subjects':
        return {
          title: 'Nhập danh mục Môn học bằng AI',
          subtitle: 'Gõ danh sách tên môn học, mã viết tắt để AI tự động thêm các môn học mới vào Danh mục Môn học toàn trường.',
          placeholder: 'Ví dụ: Thêm môn CNCN (Công nghệ Công nghiệp), CNNN (Công nghệ Nông nghiệp), GDKTPL (Giáo dục kinh tế và pháp luật)...',
          exampleText: 'Thêm môn CNCN (Công nghệ Công nghiệp), CNNN (Công nghệ Nông nghiệp), GDKTPL (Giáo dục kinh tế và pháp luật), Tin học và Hoạt động trải nghiệm hướng nghiệp.',
          storageTargetName: 'Danh mục Môn học',
          systemPrompt: "Trích xuất danh mục môn học từ văn bản thành mảng JSON: [{ id: string, name: string }]. Ví dụ: id='CNCN', name='Công nghệ Công nghiệp'. Chỉ trích xuất danh mục môn học."
        };
      case 'lessonHours':
        return {
          title: 'Khai báo Số tiết môn học bằng AI',
          subtitle: 'Gõ phân bổ số tiết học của các môn học theo từng lớp hoặc từng khối lớp để AI tự động cập nhật vào Bảng khai báo số tiết.',
          placeholder: 'Ví dụ: Lớp 12A1 học Toán 4 tiết, Văn 4 tiết, CNCN 0 tiết, CNNN 2 tiết; Khối 10 môn Tin học 2 tiết...',
          exampleText: 'Lớp 12A1 học Toán 4 tiết, Văn 4 tiết, CNCN 0 tiết, CNNN 2 tiết. Môn Toán khối 10 học 4 tiết, khối 11 học 4 tiết, khối 12 học 5 tiết. Môn Ngữ Văn cả 3 khối đều học 4 tiết.',
          storageTargetName: 'Bảng khai báo số tiết',
          systemPrompt: "Trích xuất khai báo số tiết môn học từ văn bản thành mảng JSON: [{ className: string, subjectId: string, periods: number, grade10?: number, grade11?: number, grade12?: number }]. Nếu nêu theo lớp ghi rõ className, subjectId, periods. Nếu nêu theo khối ghi subjectId, grade10, grade11, grade12."
        };
      case 'assignment':
      case 'assignments':
      default:
        return {
          title: 'Phân công giảng dạy & Chủ nhiệm bằng AI',
          subtitle: 'Gõ phân công chủ nhiệm và phân công bộ môn cho các giáo viên và lớp học để AI tự động điền vào Bảng phân công giảng dạy.',
          placeholder: 'Ví dụ: Phân công cô Thu Trang dạy Toán 10A1 4 tiết; thầy Tuấn chủ nhiệm 11A1 và dạy Văn 11A1 4 tiết...',
          exampleText: 'Phân công cô Thu Trang dạy Toán 10A1 4 tiết. Thầy Trần Trung Hiếu dạy Lý lớp 10A1, 10A2. Cô Nguyễn Thị Mai chủ nhiệm lớp 10A1 và dạy Toán lớp 10A1.',
          storageTargetName: 'Bảng phân công giảng dạy',
          systemPrompt: `Trích xuất phân công giáo viên sang JSON: [{ className: string, subjectCode: string, teacherName: string, lessons: number }]. Nếu là chủ nhiệm lớp đặt subjectCode='GVCN'. Số tiết lessons mặc định 0 nếu không nhắc.`
        };
    }
  };

  const { title, subtitle, placeholder, exampleText, storageTargetName, systemPrompt } = getConfigForType();

  const handleQuickExample = () => {
    setText(exampleText);
    setParsedData(null);
    setError(null);
    setIsApplied(false);
  };

  // Helper to extract JSON safely from text
  const safeExtractJSON = (rawStr: string): any[] => {
    let clean = rawStr.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.data)) return parsed.data;
      if (Array.isArray(parsed.items)) return parsed.items;
      if (Array.isArray(parsed.assignments)) return parsed.assignments;
      return [parsed];
    }
    return [];
  };

  // Áp dụng dữ liệu vào đúng state nghiệp vụ
  const applyDataToState = (data: any[]) => {
    if (type === 'teachers') {
      onImportTeachers(data);
    } else if (type === 'classes') {
      onImportClasses(data);
    } else if (type === 'subjects') {
      onImportSubjects(data);
    } else if (type === 'lessonHours') {
      if (onImportLessonHours) {
        onImportLessonHours(data);
      } else {
        onImportSubjects(data);
      }
    } else if (type === 'assignment' || type === 'assignments') {
      onImportAssignments(data);
    }
  };

  const handleProcessAI = async () => {
    const trimmedInput = text.trim();
    if (!trimmedInput) {
      alert('Vui lòng nhập nội dung văn bản trước khi bắt đầu.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setParsedData(null);
    setIsApplied(false);
    setProgressStep('AI đang phân tích câu lệnh...');

    try {
      // 1. Kiểm tra API Key theo chuẩn Vite an toàn, không ném lỗi
      let apiKey = '';
      try {
        apiKey = (import.meta as any)?.env?.VITE_GEMINI_API_KEY || (window as any)?.__GEMINI_API_KEY__ || '';
      } catch {
        apiKey = '';
      }

      let extractedData: any[] = [];
      let success = false;

      // 2. Phương thức 1: Nếu có VITE_GEMINI_API_KEY, gọi trực tiếp REST endpoint với thinkingBudget: 0 và temperature: 0.1
      if (apiKey && apiKey.trim() !== '') {
        try {
          const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash'];
          for (const modelName of modelsToTry) {
            try {
              const restRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey.trim()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [
                    {
                      role: 'user',
                      parts: [
                        { text: `${systemPrompt}\n\nVăn bản: "${trimmedInput}"` }
                      ]
                    }
                  ],
                  generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                    thinkingConfig: {
                      thinkingBudget: 0
                    }
                  }
                })
              });

              if (restRes.ok) {
                const jsonResp = await restRes.json();
                const rawText = jsonResp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (rawText) {
                  extractedData = safeExtractJSON(rawText);
                  if (Array.isArray(extractedData) && extractedData.length > 0) {
                    success = true;
                    break;
                  }
                }
              }
            } catch (err) {
              console.warn(`Direct model ${modelName} error:`, err);
            }
          }
        } catch (restErr) {
          console.warn('Direct Gemini REST call fallback to proxy:', restErr);
        }
      }

      // 3. Phương thức 2: Fallback an toàn qua máy chủ backend proxy (/api/natural-language-import)
      if (!success) {
        const proxyRes = await fetch('/api/natural-language-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: trimmedInput,
            type,
            compactSubjects: (type === 'assignment' || type === 'assignments') ? safeSubjects.map(s => s.id).join(', ') : ''
          })
        });

        if (!proxyRes.ok) {
          throw new Error('Máy chủ phản hồi không thành công (Status: ' + proxyRes.status + ')');
        }

        const result = await proxyRes.json();
        if (result && result.success && Array.isArray(result.data)) {
          extractedData = result.data;
          success = true;
        } else if (Array.isArray(result)) {
          extractedData = result;
          success = true;
        } else {
          throw new Error('Không thể phân tích dữ liệu JSON hợp lệ từ câu lệnh.');
        }
      }

      // Kiểm tra dữ liệu an toàn
      if (success && Array.isArray(extractedData) && extractedData.length > 0) {
        setParsedData(extractedData);

        // Tự động áp dụng dữ liệu vào đúng State ngay khi nhận kết quả JSON hợp lệ
        try {
          applyDataToState(extractedData);
          setIsApplied(true);
          const notifyMsg = `Dữ liệu đã lưu vào ${storageTargetName}`;
          if (onNotification) onNotification(notifyMsg);
        } catch (applyErr: any) {
          console.error('Error applying imported data:', applyErr);
          alert(`⚠️ Đã trích xuất dữ liệu thành công nhưng có cảnh báo khi cập nhật: ${applyErr?.message || 'Vui lòng kiểm tra lại'}`);
        }
      } else {
        throw new Error('AI không nhận diện được dữ liệu phù hợp trong câu lệnh.');
      }
    } catch (err: any) {
      console.error('Safe AI Process Error:', err);
      const msg = err?.message || 'Có lỗi xảy ra khi gọi AI. Vui lòng thử lại với câu lệnh ngắn gọn hơn.';
      setError(msg);
      alert(`⚠️ ${msg}`);
    } finally {
      setIsLoading(false);
      setProgressStep('');
    }
  };

  const handleApplyImport = () => {
    if (!parsedPreview || !Array.isArray(parsedPreview) || parsedPreview.length === 0) {
      alert('Chưa có dữ liệu để áp dụng.');
      return;
    }

    try {
      applyDataToState(parsedPreview);
      setIsApplied(true);
      const notifyMsg = `Dữ liệu đã lưu vào ${storageTargetName}`;
      if (onNotification) onNotification(notifyMsg);
      onClose();
    } catch (e: any) {
      console.error('Apply import error:', e);
      alert(`⚠️ Lỗi khi áp dụng dữ liệu: ${e?.message || 'Vui lòng kiểm tra lại'}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2">
                {title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gemini 3.1 Flash Lite • Phản hồi siêu tốc & Tự động lưu vào {storageTargetName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors cursor-pointer"
            title="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1">
            <p className="font-semibold text-slate-800 text-xs flex items-center gap-1">
              <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" /> Hướng dẫn nhập liệu:
            </p>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              {subtitle} Hệ thống AI xử lý siêu tốc, tự động trích xuất JSON và áp dụng trực tiếp vào <strong>{storageTargetName}</strong> mà không cần reload trang.
            </p>
            <button
              type="button"
              onClick={handleQuickExample}
              className="text-blue-600 hover:text-blue-800 font-bold underline mt-1 cursor-pointer block text-left"
            >
              👉 Nhấp để điền mẫu văn bản ví dụ
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700 text-xs">
                Nội dung văn bản tiếng Việt tự nhiên:
              </label>
              <button
                type="button"
                onClick={handleToggleListening}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition duration-200 cursor-pointer ${
                  isListening
                    ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
                title={isListening ? 'Đang lắng nghe giọng nói... Bấm để dừng' : 'Nhập dữ liệu bằng Giọng nói (Tiếng Việt)'}
              >
                {isListening ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-ping shrink-0" />
                    <Mic className="w-3.5 h-3.5 text-rose-600 animate-bounce" />
                    <span>Đang nghe... Dừng 🛑</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>Ghi âm giọng nói 🎙️</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={placeholder}
              rows={5}
              className="w-full border border-slate-300 rounded-xl p-3 text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-medium leading-relaxed"
            />
          </div>

          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-medium text-[11px] leading-relaxed">{error}</span>
            </div>
          )}

          {/* Visual Progress / Spinner */}
          {isLoading && (
            <div className="p-4 bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-blue-200 rounded-xl space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="font-bold text-slate-800 text-xs">
                    {progressStep || 'AI đang phân tích câu lệnh...'}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full animate-pulse">
                  Flash Lite • Tức thì
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 h-1.5 rounded-full w-3/4 animate-[pulse_1s_ease-in-out_infinite]" />
              </div>
              <p className="text-[11px] text-slate-500">
                Đang trích xuất dữ liệu và chuẩn bị lưu vào {storageTargetName}...
              </p>
            </div>
          )}

          {/* Success auto-applied notice */}
          {isApplied && Array.isArray(parsedPreview) && parsedPreview.length > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold text-xs">
                  🎉 Đã tự động phân tích và lưu thành công {parsedPreview.length} mục vào {storageTargetName} (không cần reload)!
                </span>
              </div>
              <span className="text-[10px] bg-emerald-200 text-emerald-800 font-bold px-2 py-0.5 rounded shrink-0">
                Đã lưu vào {storageTargetName} ✓
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleProcessAI}
              disabled={isLoading || !text.trim()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-xs"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>AI đang phân tích câu lệnh...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Phân tích & Tự động lưu vào {storageTargetName} ✨</span>
                </>
              )}
            </button>
          </div>

          {/* Preview of Parsed Data with 100% null/undefined safety */}
          {Array.isArray(parsedPreview) && parsedPreview.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <h4 className="font-bold text-slate-800 flex items-center gap-1 text-xs text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                Đã trích xuất và áp dụng thành công {parsedPreview.length} bản ghi vào {storageTargetName}:
              </h4>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  {/* TEACHERS TABLE */}
                  {type === 'teachers' && (
                    <>
                      <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Họ và tên</th>
                          <th className="p-2 text-center">Chức vụ</th>
                          <th className="p-2 text-center">Chuyên môn</th>
                          <th className="p-2 text-center">Định mức</th>
                          <th className="p-2 pr-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {parsedPreview.map((item, idx) => {
                          if (!item || typeof item !== 'object') return null;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2 pl-3 font-semibold text-slate-900">{item.name || 'Chưa rõ họ tên'}</td>
                              <td className="p-2 text-center text-slate-600 font-medium text-[11px]">{item.role || item.position || 'Giáo viên'}</td>
                              <td className="p-2 text-center">
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 font-bold text-[10px]">
                                  {item.subject || item.specialization || 'Toán'}
                                </span>
                              </td>
                              <td className="p-2 text-center font-mono font-semibold">
                                {Number(item.quota) > 0 ? `${item.quota} tiết` : 'Theo chức vụ (17t)'}
                              </td>
                              <td className="p-2 pr-3 text-center">
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">✓ Đã lưu GV</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </>
                  )}

                  {/* CLASSES TABLE */}
                  {type === 'classes' && (
                    <>
                      <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Tên lớp học</th>
                          <th className="p-2 text-center">Khối lớp</th>
                          <th className="p-2 pr-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {parsedPreview.map((item, idx) => {
                          if (!item || typeof item !== 'object') return null;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2 pl-3 font-semibold text-slate-900">Lớp {item.name || 'Mới'}</td>
                              <td className="p-2 text-center font-medium text-slate-500">Khối {item.grade || '10'}</td>
                              <td className="p-2 pr-3 text-center">
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">✓ Đã thêm lớp</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </>
                  )}

                  {/* SUBJECTS CATALOG TABLE */}
                  {type === 'subjects' && (
                    <>
                      <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Mã môn học</th>
                          <th className="p-2">Tên môn học</th>
                          <th className="p-2 pr-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {parsedPreview.map((item, idx) => {
                          if (!item || typeof item !== 'object') return null;
                          const code = item.id || item.subjectId || item.name || '';
                          const name = item.name || item.id || code;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2 pl-3 font-mono font-bold text-indigo-700">{code}</td>
                              <td className="p-2 font-semibold text-slate-900">{name}</td>
                              <td className="p-2 pr-3 text-center">
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">✓ Đã lưu môn</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </>
                  )}

                  {/* LESSON HOURS TABLE */}
                  {type === 'lessonHours' && (
                    <>
                      <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Đối tượng</th>
                          <th className="p-2">Môn học</th>
                          <th className="p-2 text-center">Số tiết</th>
                          <th className="p-2 pr-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {parsedPreview.map((item, idx) => {
                          if (!item || typeof item !== 'object') return null;
                          const targetLabel = item.className ? `Lớp ${item.className}` : 'Phân bổ theo khối';
                          const subId = item.subjectId || item.id || item.name || 'Môn học';
                          const periodsInfo = item.periods !== undefined 
                            ? `${item.periods} tiết` 
                            : [
                                item.grade10 !== undefined ? `K10: ${item.grade10}t` : '',
                                item.grade11 !== undefined ? `K11: ${item.grade11}t` : '',
                                item.grade12 !== undefined ? `K12: ${item.grade12}t` : ''
                              ].filter(Boolean).join(', ') || '—';

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2 pl-3 font-bold text-slate-900">{targetLabel}</td>
                              <td className="p-2 font-semibold text-indigo-700">{subId}</td>
                              <td className="p-2 text-center font-mono font-bold text-blue-700">{periodsInfo}</td>
                              <td className="p-2 pr-3 text-center">
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">✓ Đã cập nhật tiết</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </>
                  )}

                  {/* ASSIGNMENTS TABLE */}
                  {(type === 'assignment' || type === 'assignments') && (
                    <>
                      <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Lớp học</th>
                          <th className="p-2">Phân công</th>
                          <th className="p-2">Giáo viên</th>
                          <th className="p-2 text-center">Số tiết</th>
                          <th className="p-2 pr-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {parsedPreview.map((item, idx) => {
                          if (!item || typeof item !== 'object') return null;

                          const code = String(item.subjectCode || item.subject || '').trim();
                          const isHr = item.role === 'homeroom' || 
                            code.toUpperCase() === 'GVCN' || 
                            code.toLowerCase().includes('chủ nhiệm') || 
                            code.toLowerCase().includes('chu nhiem');

                          const rawTName = String(item.teacherName || '').trim();
                          const cleanTName = rawTName.toLowerCase().replace(/^(thầy|cô|gv|thay|co)\s+/i, '');
                          
                          const matchedTeacher = cleanTName ? safeTeachers.find(t => 
                            t && (
                              (item.teacherId && t.id === item.teacherId) ||
                              (t.name && t.name.toLowerCase() === rawTName.toLowerCase()) ||
                              (t.name && t.name.toLowerCase() === cleanTName) ||
                              (t.name && t.name.toLowerCase().includes(cleanTName)) ||
                              (t.name && cleanTName.includes(t.name.toLowerCase()))
                            )
                          ) : undefined;

                          const rawCName = String(item.className || '').trim();
                          const cleanCName = rawCName.replace(/^c_/i, '').trim().toLowerCase();
                          
                          const matchedClass = cleanCName ? safeClasses.find(c => 
                            c && (
                              (c.id && c.id.toLowerCase() === rawCName.toLowerCase()) ||
                              (c.id && c.id.toLowerCase() === `c_${cleanCName}`) ||
                              (c.name && c.name.toLowerCase() === cleanCName)
                            )
                          ) : undefined;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2 pl-3 font-bold text-slate-900">
                                <span>{rawCName || 'Chưa rõ'}</span>
                                {matchedClass && <span className="text-[10px] text-slate-400 font-normal ml-1">(Khối {matchedClass.grade})</span>}
                              </td>
                              <td className="p-2 font-medium">
                                {isHr ? (
                                  <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-bold text-[10px]">
                                    Chủ nhiệm (GVCN)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[10px]">
                                    Môn {code || 'Chuyên môn'}
                                  </span>
                                )}
                              </td>
                              <td className="p-2">
                                <div className="font-semibold text-slate-900">{rawTName || 'Chưa rõ giáo viên'}</div>
                                {matchedTeacher ? (
                                  <div className="text-[10px] text-emerald-600 font-medium">✓ Khớp: {matchedTeacher.name} ({matchedTeacher.specialization})</div>
                                ) : (
                                  <div className="text-[10px] text-amber-600 font-medium">⚠️ Chưa khớp chính xác với GV trong danh bạ</div>
                                )}
                              </td>
                              <td className="p-2 text-center font-mono font-medium text-slate-600">
                                {item.lessons ? `${item.lessons} tiết` : '—'}
                              </td>
                              <td className="p-2 pr-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  ✓ Đã phân công
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2.5 shrink-0">
          <div className="text-[11px] text-slate-500 font-medium">
            {isApplied && Array.isArray(parsedPreview) && parsedPreview.length > 0 && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Dữ liệu đã lưu vào {storageTargetName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Đóng
            </button>
            {isApplied ? (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5 transition"
              >
                <Check className="w-4 h-4" /> Hoàn tất
              </button>
            ) : (
              <button
                onClick={handleApplyImport}
                disabled={!Array.isArray(parsedPreview) || parsedPreview.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1 transition"
              >
                Nhập dữ liệu vào {storageTargetName} <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
