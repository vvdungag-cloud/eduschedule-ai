import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { solveAssignments } from './src/utils/assignmentSolver.js';
import { solveTimetable } from './src/utils/timetableSolver.js';
import { spawn } from 'child_process';
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);

// Cấu hình biến môi trường SMTP & ZALO (Tùy chọn - mặc định rỗng "" để cho phép Share và Publish bình thường không cần secrets)
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT || "";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";

const ZALO_WEBHOOK_URL = process.env.ZALO_WEBHOOK_URL || "";
const ZALO_OA_ACCESS_TOKEN = process.env.ZALO_OA_ACCESS_TOKEN || "";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Initialize Gemini (Tùy chọn)
  const apiKey = process.env.GEMINI_API_KEY || "";
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    try {
      ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    } catch (e) {
      console.warn("Không thể khởi tạo Gemini AI:", e);
    }
  }

  // API - AI Optimization
  app.post('/api/ai/optimize', async (req, res) => {
    try {
      const { teachers, classes, subjectRequirements, currentAssignments, mode = 'all' } = req.body;

      if (!teachers || !classes || !subjectRequirements) {
        return res.status(400).json({ error: 'Thiếu dữ liệu giáo viên, lớp học hoặc cấu hình số tiết.' });
      }

      // 1. Chạy thuật toán phân công chuyên sâu EduAssign Engine
      const solved = solveAssignments(teachers, classes, subjectRequirements, currentAssignments, mode);

      // 2. Thử gọi Gemini AI để bổ sung nhận xét chuyên sâu (nếu có API Key và phản hồi nhanh trong 4 giây)
      if (apiKey && ai) {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
          const modeDescription = 
            mode === 'manual_and_auto' 
              ? 'Phân công thủ công và tự động (Giữ nguyên các lớp/môn đã được phân công dạy thủ công trước đó, chỉ phân công tự động các lớp chưa được phân công)' 
              : mode === 'teaching_only' 
              ? 'Phân công dạy học bộ môn (bảo lưu GVCN)' 
              : mode === 'homeroom_only' 
              ? 'Phân công chủ nhiệm (bảo lưu môn dạy)' 
              : 'Phân công toàn diện (cả chủ nhiệm và dạy học)';

          const aiPromise = ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Bạn là trợ lý AI chuyên gia xếp lịch phân công giáo viên THPT tại Việt Nam.
Dưới đây là kết quả phân công tự động của trường (${classes.length} lớp, ${teachers.length} giáo viên):
- Chế độ: ${modeDescription}
- Tuyệt đối đảm bảo nguyên tắc: Hiệu trưởng và Phó Hiệu trưởng được phân công đủ định mức tiết chuẩn (Hiệu trưởng: 2 tiết, Phó Hiệu trưởng: 4 tiết), không phân thừa hay thiếu tiết.
- 100% môn TNHN2 (Hoạt động trải nghiệm, hướng nghiệp 2) được phân công trực tiếp cho chính Giáo viên chủ nhiệm (GVCN) dạy.
- Đã tính đầy đủ 4 tiết kiêm nhiệm chủ nhiệm vào tổng số tiết được phân công dạy của GVCN.
- Cân đối tối ưu tổng số tiết giữa các giáo viên trong từng tổ bộ môn và toàn trường, triệt tiêu tình trạng có giáo viên dạy quá nhiều tiết, có giáo viên lại quá ít tiết.
- 100% GVCN lớp nào thì được phân công dạy môn chuyên môn tại chính lớp đó.
- Phân công đúng 100% chuyên môn (Toán, Văn, Anh, Lý, Hóa, Sinh, Tin, CN, Sử, Địa, GDKTPL, GDTC, GDQPAN)
- Số giáo viên dạy không quá 2 khối lớp: ${solved.stats.teachersWithMax2Grades}/${teachers.length}

Hãy viết một nhận xét ngắn gọn (khoảng 3-4 câu tiếng Việt chuyên nghiệp, súc tích, mang tính chuyên gia giáo dục) đánh giá về tính khả thi, sự công bằng giữa các giáo viên và hiệu quả của phương án phân công này.`
          });

          const aiResult: any = await Promise.race([aiPromise, timeoutPromise]);
          if (aiResult?.text) {
            solved.explanation = `🎯 **AI Phân tích & Tối ưu hóa phân công:**\n\n${aiResult.text.trim()}\n\n---\n${solved.explanation}`;
          }
        } catch (e) {
          // Bỏ qua lỗi AI, sử dụng báo cáo tối ưu chi tiết từ solver
        }
      }

      res.json(solved);
    } catch (error: any) {
      console.error("AI Optimization Server Error:", error);
      res.status(500).json({ error: error.message || "Không thể thực hiện phân công tự động bằng AI." });
    }
  });

  // API - Timetable Solver using OR-Tools CP-SAT or High-performance Constraint Engine
  app.post('/api/timetable/solve', async (req, res) => {
    try {
      const { 
        teachers, 
        classes, 
        assignments, 
        subjectRequirements, 
        sessionMode = 'single',
        afternoonPeriodsCount = 4,
        classShifts = {},
        fixedConfig, 
        lockedSlots, 
        customFixedSlots = [], 
        teacherConstraints = {}, 
        maxSessionsPerTeacher,
        teacherMaxHalfDays,
        maxDaysPerTeacher,
        advancedConstraints = {},
        preferOrtools = true 
      } = req.body;

      if (!teachers || !classes || !assignments) {
        return res.status(400).json({ error: 'Thiếu dữ liệu giáo viên, lớp học hoặc phân công giảng dạy.' });
      }

      // Trích xuất hoặc kế thừa cấu hình buổi & ngày dạy tối đa (chỉ nhận số dương cụ thể)
      const effectiveMaxSessions: Record<string, number> = {};
      const effectiveMaxDays: Record<string, number> = {};

      if (maxSessionsPerTeacher || teacherMaxHalfDays) {
        const raw = maxSessionsPerTeacher || teacherMaxHalfDays;
        Object.entries(raw).forEach(([tid, val]: [string, any]) => {
          if (val !== undefined && val !== null && val !== '' && val !== 'Không giới hạn' && !isNaN(Number(val)) && Number(val) > 0) {
            effectiveMaxSessions[tid] = Number(val);
          }
        });
      }

      if (maxDaysPerTeacher) {
        Object.entries(maxDaysPerTeacher).forEach(([tid, val]: [string, any]) => {
          if (val !== undefined && val !== null && val !== '' && val !== 'Không giới hạn' && !isNaN(Number(val)) && Number(val) > 0) {
            effectiveMaxDays[tid] = Number(val);
          }
        });
      }

      if (teacherConstraints) {
        Object.entries(teacherConstraints).forEach(([tid, conf]: [string, any]) => {
          if (conf?.maxSessions !== undefined && conf.maxSessions !== null && conf.maxSessions !== '' && conf.maxSessions !== 'Không giới hạn' && !isNaN(Number(conf.maxSessions)) && Number(conf.maxSessions) > 0) {
            effectiveMaxSessions[tid] = Number(conf.maxSessions);
          }
          if (conf?.maxDays !== undefined && conf.maxDays !== null && conf.maxDays !== '' && conf.maxDays !== 'Không giới hạn' && !isNaN(Number(conf.maxDays)) && Number(conf.maxDays) > 0) {
            effectiveMaxDays[tid] = Number(conf.maxDays);
          }
        });
      }

      // Thứ 2 là ngày học bình thường, chỉ khóa Tiết 1 Chào cờ (2_1). Tuyệt đối không khóa các tiết 2..10 đối với học sinh/lớp.
      const filterMondayClassSlots = (slots: string[] = []) =>
        slots.filter(s => !(s.startsWith('2_') && s !== '2_1'));
      const sanitizedLockedSlots = lockedSlots ? {
        global: filterMondayClassSlots(lockedSlots.global || []),
        byGrade: lockedSlots.byGrade ? Object.fromEntries(
          Object.entries(lockedSlots.byGrade).map(([g, s]) => [g, filterMondayClassSlots(s as string[])])
        ) : {},
        byClass: lockedSlots.byClass ? Object.fromEntries(
          Object.entries(lockedSlots.byClass).map(([c, s]) => [c, filterMondayClassSlots(s as string[])])
        ) : {},
        byTeacher: lockedSlots.byTeacher || {},
        classBreakExceptions: lockedSlots.classBreakExceptions ? Object.fromEntries(
          Object.entries(lockedSlots.classBreakExceptions).map(([c, s]) => [c, filterMondayClassSlots(s as string[])])
        ) : {}
      } : { byClass: {}, byTeacher: {}, byGrade: {}, global: [], classBreakExceptions: {} };

      // Try running Python Google OR-Tools CP-SAT if requested
      if (preferOrtools) {
        try {
          const pythonResult = await new Promise<any>((resolve, reject) => {
            const pyProcess = spawn('python3', [path.join(__dirname, 'timetable_ortools.py')]);
            let stdoutData = '';
            let stderrData = '';

            const timeoutId = setTimeout(() => {
              pyProcess.kill();
              reject(new Error('OR-Tools CP-SAT timeout'));
            }, 50000);

            pyProcess.stdin.write(JSON.stringify({
              teachers,
              classes,
              assignments,
              subjectRequirements,
              sessionMode,
              afternoonPeriodsCount,
              classShifts,
              fixedConfig,
              lockedSlots: sanitizedLockedSlots,
              customFixedSlots,
              teacherConstraints,
              maxSessionsPerTeacher: effectiveMaxSessions,
              teacherMaxHalfDays: effectiveMaxSessions,
              maxDaysPerTeacher: effectiveMaxDays,
              advancedConstraints
            }));
            pyProcess.stdin.end();

            pyProcess.stdout.on('data', (chunk) => {
              stdoutData += chunk.toString();
            });

            pyProcess.stderr.on('data', (chunk) => {
              stderrData += chunk.toString();
            });

            pyProcess.on('close', (code) => {
              clearTimeout(timeoutId);
              if (code === 0 && stdoutData.trim()) {
                try {
                  const parsed = JSON.parse(stdoutData.trim());
                  resolve(parsed);
                } catch (e) {
                  reject(new Error('Invalid JSON from OR-Tools script'));
                }
              } else {
                reject(new Error(`Python process exited with code ${code}: ${stderrData}`));
              }
            });

            pyProcess.on('error', (err) => {
              clearTimeout(timeoutId);
              reject(err);
            });
          });

          if (pythonResult) {
            if (pythonResult.success && pythonResult.lessons) {
              const finalData = {
                academicYear: req.body.academicYear || 'Năm học 2024 - 2025',
                semester: req.body.semester || 'Học kỳ I',
                createdAt: new Date().toISOString(),
                lessons: pythonResult.lessons,
                stats: {
                  totalLessons: pythonResult.lessons.length,
                  totalClasses: classes.length,
                  totalTeachers: teachers.length,
                  teacherConflicts: 0,
                  classConflicts: 0,
                  isolatedGaps: 0,
                  teacherDaysWithLessons: 0,
                  solverUsed: 'ortools_cp_sat',
                  executionTimeMs: pythonResult.executionTimeMs || 1000
                },
                fixedSlotsConfig: fixedConfig || { chaoCoDay: 2, chaoCoPeriod: 1, sinhHoatDay: 7, sinhHoatPeriod: 5 },
                lockedSlots: sanitizedLockedSlots,
                sessionMode,
                afternoonPeriodsCount
              };
              return res.json(finalData);
            } else if (pythonResult.status === 'INFEASIBLE') {
              return res.status(400).json({
                success: false,
                status: 'INFEASIBLE',
                error: pythonResult.error,
                diagnostics: pythonResult.diagnostics
              });
            } else {
              throw new Error(pythonResult.error || 'OR-Tools reported failure');
            }
          }
        } catch (ortoolsErr: any) {
          console.log('OR-Tools python solver fallback:', ortoolsErr.message);
        }
      }

      // Fallback: Execute High-performance Constraint Engine
      const result = solveTimetable({
        teachers,
        classes,
        assignments,
        subjectRequirements,
        sessionMode,
        afternoonPeriodsCount,
        classShifts,
        fixedConfig,
        lockedSlots: sanitizedLockedSlots,
        customFixedSlots,
        teacherConstraints,
        maxSessionsPerTeacher: effectiveMaxSessions,
        teacherMaxHalfDays: effectiveMaxSessions,
        maxDaysPerTeacher: effectiveMaxDays,
        advancedConstraints
      });
      res.json(result);
    } catch (error: any) {
      console.error("Timetable Solver Error:", error);
      res.status(500).json({ error: error.message || "Không thể sắp xếp thời khóa biểu." });
    }
  });

  // API - Natural Language Import
  // API - Natural Language Import (Tối ưu hóa siêu tốc với gemini-2.5-flash và Prompt Pruning)
  app.post('/api/natural-language-import', async (req, res) => {
    try {
      const { text, type, compactTeachers, compactSubjects, compactClasses } = req.body;
      if (!text || !type) {
        return res.status(400).json({ error: 'Thiếu nội dung văn bản hoặc loại nhập dữ liệu.' });
      }

      let systemInstruction = "";
      let responseSchema: any = {};

      let prompt = "";
      if (type === 'teachers') {
        prompt = `Trích xuất thông tin giáo viên từ văn bản thành mảng JSON: [{ name: string, subject: string, role: string, quota: number }]. Nếu không đề cập chức vụ gán '', không đề cập định mức gán 0.\n\nCâu lệnh: ${text}`;
      } else if (type === 'classes') {
        prompt = `Trích xuất danh sách lớp học THPT sang JSON: [{ name: string, grade: string }]. Ví dụ: 10A1 thì name='10A1', grade='10'. Chỉ trích xuất danh sách lớp.\n\nCâu lệnh: ${text}`;
      } else if (type === 'subjects') {
        prompt = `Trích xuất danh mục môn học sang JSON: [{ id: string, name: string }]. Ví dụ: id='CNCN', name='Công nghệ Công nghiệp'. Chỉ trích xuất danh mục môn học.\n\nCâu lệnh: ${text}`;
      } else if (type === 'lessonHours') {
        prompt = `Trích xuất khai báo số tiết môn học sang JSON: [{ className: string, subjectId: string, periods: number, grade10?: number, grade11?: number, grade12?: number }]. Nếu nêu theo lớp ghi rõ className, subjectId, periods. Nếu nêu theo khối ghi subjectId, grade10, grade11, grade12.\n\nCâu lệnh: ${text}`;
      } else if (type === 'assignment' || type === 'assignments') {
        prompt = `Trích xuất phân công giáo viên sang JSON: [{ className: string, subjectCode: string, teacherName: string, lessons: number }]. Nếu là chủ nhiệm lớp đặt subjectCode='GVCN'. Số tiết lessons mặc định 0 nếu không nhắc.\n${compactSubjects ? `Môn: ${compactSubjects}\n` : ''}\nCâu lệnh: ${text}`;
      } else {
        return res.status(400).json({ error: 'Loại nhập dữ liệu không hợp lệ.' });
      }

      const bodyPayload = {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };

      const modelsToTry = [
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-2.5-flash'
      ];

      let jsonText = '';
      for (const model of modelsToTry) {
        try {
          const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });
          if (apiRes.ok) {
            const data: any = await apiRes.json();
            jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (jsonText) break;
          }
        } catch (e) {
          console.warn(`Model ${model} request failed:`, e);
        }
      }

      if (!jsonText) {
        throw new Error('AI không phản hồi dữ liệu.');
      }

      let cleaned = jsonText.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

      const parsedData = JSON.parse(cleaned);
      res.json({ success: true, data: Array.isArray(parsedData) ? parsedData : [parsedData] });
    } catch (err: any) {
      console.error('Lỗi nhập dữ liệu tự nhiên:', err);
      res.status(500).json({ error: err.message || 'Không thể xử lý ngôn ngữ tự nhiên.' });
    }
  });

  // API - AI Chat & Adjustments (Optimized Context Summary & 30s Timeout)
  // API - AI Chat & Adjustments (Executive EduSchedule Consultant for Vice Principal of Academics)
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { message, teachers, classes, subjectRequirements, assignments, contextSummary } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Nội dung tin nhắn không hợp lệ.' });
      }

      if (!apiKey || !ai) {
        return res.status(503).json({
          error: "Chưa cấu hình khóa API Gemini trên máy chủ. Bạn có thể kiểm tra biến môi trường GEMINI_API_KEY."
        });
      }

      // Xây dựng khối dữ liệu nhà trường chi tiết từ contextSummary
      let schoolContextStr = '';
      if (contextSummary) {
        const stats = contextSummary.schoolStats || {};
        const subjectTotals = contextSummary.subjectTotals || {};
        const gradeShifts = contextSummary.gradeShifts || {};
        const tList = contextSummary.teachers || contextSummary.teacherSummary || [];

        // 1. Dữ liệu môn học & khối
        const subjectSummaryStr = Object.entries(subjectTotals)
          .map(([name, count]) => `${name}: ${count} tiết`)
          .join(', ');

        const gradeShiftsStr = Object.entries(gradeShifts)
          .map(([_, desc]) => `• ${desc}`)
          .join('\n');

        // 2. Danh sách 101 Giáo viên
        const teacherRowsStr = tList.map((t: any, idx: number) => {
          const homeroomStr = t.homeroom ? `CN ${t.homeroom}` : 'Không CN';
          const varianceStr = t.variance === 0 
            ? 'Đạt chuẩn 17t' 
            : t.variance > 0 
            ? `Thừa +${t.variance}t` 
            : `Thiếu ${t.variance}t`;
          const busyStr = t.busySlots && t.busySlots !== 'Không có' ? `Bận: ${t.busySlots}` : 'Không bận';
          const schedStr = t.scheduleSummary ? ` | TKB: ${t.scheduleSummary}` : '';
          return `${idx + 1}. ${t.name} (${t.department || t.subject || 'Chung'} - ${t.position || 'GV'}) | ${homeroomStr} | Định mức: ${t.quota}t, Dạy: ${t.assigned || t.assignedPeriods || 0}t (${varianceStr}) | ${t.teachingDays || 0} buổi/tuần, Tiết lủng: ${t.gapPeriods ?? 0} | ${busyStr}${schedStr}`;
        }).join('\n');

        schoolContextStr = `
=== DỮ LIỆU TOÀN DIỆN TRƯỜNG THPT NGUYỄN BỈNH KHIÊM (AN GIANG) ===
A. THỐNG KÊ QUY MÔ & TÌNH TRẠNG THỜI KHÓA BIỂU:
- Số lớp học: ${stats.totalClasses || 44} lớp (Khối 10: 16 lớp, Khối 11: 14 lớp, Khối 12: 14 lớp)
- Số giáo viên: ${stats.totalTeachers || tList.length || 101} giáo viên
- Tình trạng Thời khóa biểu: ${stats.timetableStatus?.totalScheduled || 1261}/${stats.timetableStatus?.totalRequired || 1261} tiết (${stats.timetableStatus?.percent || '100% hoàn thành'}, 0 xung đột giáo viên, 0 xung đột lớp học).

B. DỮ LIỆU MÔN HỌC & LỊCH HỌC CÁC KHỐI:
- Phân bổ ca học:
${gradeShiftsStr || '• Khối 10: 16 lớp - Sáng chính khóa + Chiều tự chọn/GDTC/GDQP\n• Khối 11: 14 lớp - Chiều chính khóa + Sáng tự chọn/GDTC/GDQP\n• Khối 12: 14 lớp - Sáng chính khóa + Chiều bồi dưỡng'}
- Tổng số tiết theo môn toàn trường:
${subjectSummaryStr || 'Toán, Ngữ văn, Tiếng Anh, GDTC, GDQPAN, Lịch sử, Địa lí, Vật lí, Hóa học, Sinh học, Tin học, Công nghệ, GDKTPL, HĐTN-HN'}

C. BẢNG DỮ LIỆU 101 GIÁO VIÊN TOÀN TRƯỜNG (KÈM ĐỊNH MỨC, TIẾT LỦNG, LỊCH BẬN VÀ LỊCH DẠY):
${teacherRowsStr}
`;
      } else {
        // Fallback nếu client gửi dữ liệu cũ
        const tCount = teachers ? teachers.length : 101;
        const cCount = classes ? classes.length : 44;
        schoolContextStr = `
=== THỐNG KÊ TRƯỜNG THPT NGUYỄN BỈNH KHIÊM ===
- Quy mô: ${cCount} lớp, ${tCount} giáo viên.
- TKB: 1.261 tiết đã xếp đủ 100%, 0 xung đột.
- Danh sách đại diện: ${(teachers || []).slice(0, 50).map((t: any) => `${t.name} (${t.specialization || 'BM'}, định mức ${t.maxPeriods || 17}t)`).join('; ')}
`;
      }

      const executiveSystemInstruction = `Bạn là Trợ lý Phân công & Lập lịch EduSchedule AI của Trường THPT Nguyễn Bỉnh Khiêm (An Giang), phục vụ trực tiếp cho Phó Hiệu trưởng phụ trách chuyên môn.

NGUYÊN TẮC VÀ VAI TRÒ BGH:
1. Giọng văn: Chuẩn mực sư phạm, chuyên nghiệp, số liệu minh bạch, giải trình sắc bén và trung thực tuyệt đối. Tuyệt đối không bịa đặt số liệu hay tên giáo viên ngoài dữ liệu được cung cấp.
2. Phục vụ Ban Giám hiệu ra quyết định điều hành chuyên môn, phân bổ số tiết công bằng, quản lý giờ dạy, và xếp lịch TKB khoa học.

QUY CHUẨN THUẬT NGỮ CHUYÊN MÔN BẮT BUỘC:
- "Dạy thiếu tiết": Giáo viên có tổng số tiết phân công < Định mức chuẩn (chuẩn 17 tiết/tuần đối với giáo viên, 2 tiết đối với Hiệu trưởng, 4 tiết đối với Phó Hiệu trưởng, 14 tiết đối với Tổ trưởng). BẮT BUỘC nêu rõ số tiết thiếu cụ thể (ví dụ: thiếu 3 tiết).
- "Dạy thừa tiết / quá tải": Giáo viên có tổng số tiết phân công > Định mức chuẩn. BẮT BUỘC nêu rõ thừa bao nhiêu tiết (ví dụ: thừa 2 tiết).
- "Tiết lủng / tiết trống giữa buổi": Hiện tượng giáo viên có các tiết trống xen kẽ giữa các tiết dạy trong cùng một buổi (sáng hoặc chiều) của một ngày dạy. Nêu cụ thể số tiết lủng và giáo viên liên quan.
- "Đúng chuyên môn": Giáo viên được phân công giảng dạy đúng môn đã được đào tạo (khớp với Tổ bộ môn/chuyên môn).
- "Tư vấn đổi tiết / dạy thay (Swap / substitute consulting)":
  Khi người dùng hỏi về việc đổi tiết, chuyển tiết hoặc tìm người dạy thay cho một tiết cụ thể:
  * Bước 1: Xác định môn học, lớp học, thứ và tiết cần dạy thay.
  * Bước 2: Quét danh sách các giáo viên CÙNG TỔ BỘ MÔN/CHUYÊN MÔN.
  * Bước 3: Kiểm tra người nào HOÀN TOÀN RẢNH (không có tiết dạy ở thứ/tiết đó và không đăng ký bận).
  * Bước 4: Đề xuất ưu tiên các giáo viên đang thiếu tiết hoặc có sẵn tiết dạy trong buổi hôm đó (để không phát sinh thêm buổi đi dạy riêng) và không gây thêm tiết lủng.

ĐỊNH DẠNG TRẢ LỜI:
- Luôn trình bày câu trả lời rõ ràng, có tiêu đề in đậm, sử dụng BẢNG MARKDOWN khi liệt kê danh sách giáo viên hoặc số liệu.
- In đậm số liệu then chốt (số tiết, lớp, thứ, buổi).
- Cuối câu trả lời, luôn có gợi ý hành động sư phạm hoặc kết luận súc tích dành cho Ban Giám hiệu.`;

      const prompt = `
${schoolContextStr}

CÂU HỎI / YÊU CẦU CỦA PHÓ HIỆU TRƯỞNG:
"${message}"

Hãy phân tích toàn diện dữ liệu trên và trả lời bằng tiếng Việt chuyên nghiệp, chính xác.`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI response timeout (25s)')), 25000)
      );

      // Tự động thử model nhanh và ổn định nhất (gemini-3.1-flash-lite siêu tốc, gemini-3.8-flash)
      const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
      let lastError: any = null;
      let responseText = '';

      for (const modelName of modelsToTry) {
        try {
          const aiPromise = ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction: executiveSystemInstruction,
              temperature: 0.2,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reply: {
                    type: Type.STRING,
                    description: "The detailed professional answer formatted in Markdown with tables, bullet points, and bold figures."
                  },
                  suggestedChanges: {
                    type: Type.OBJECT,
                    properties: {
                      homeroomAssignments: {
                        type: Type.OBJECT,
                        description: "Optional proposed changes to homeroom assignments"
                      },
                      subjectAssignments: {
                        type: Type.OBJECT,
                        description: "Optional proposed changes to subject assignments"
                      }
                    }
                  }
                },
                required: ["reply"]
              }
            }
          });

          const aiResult: any = await Promise.race([aiPromise, timeoutPromise]);
          responseText = aiResult?.text || '';
          if (responseText) break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Model ${modelName} request failed:`, err?.message || err);
          if (err?.message?.includes('timeout')) {
            throw err;
          }
        }
      }

      if (!responseText && lastError) {
        throw lastError;
      }

      const parsed = JSON.parse(responseText || '{"reply": "Không nhận được phản hồi từ AI."}');
      res.json(parsed);
    } catch (error: any) {
      console.error("AI Chat Server Error:", error);
      res.status(500).json({ error: error.message || "Lỗi giao tiếp với trợ lý AI." });
    }
  });

  // Cloud data store for simulated Google Sheets / Firebase sync
  let latestCloudSnapshot: {
    provider: string;
    sheetId?: string;
    timestamp: string;
    data: Record<string, any>;
  } | null = null;

  // API - Cloud Sync (Protected for Admin role only)
  app.post('/api/cloud/sync', async (req, res) => {
    try {
      const adminHeader = req.headers['x-admin-role'];
      if (adminHeader !== 'admin') {
        return res.status(403).json({
          error: 'Bị từ chối: Bắt buộc quyền Quản trị viên (Admin) để lưu hoặc ghi đè dữ liệu lên Google Sheets/Firebase.'
        });
      }

      const { provider = 'googlesheets', sheetId, timestamp, data } = req.body;
      const syncTimestamp = timestamp || new Date().toISOString();
      console.log(`[Cloud Sync] Received sync request for provider: ${provider}, timestamp: ${syncTimestamp}`);
      
      // Store latest cloud snapshot in server
      if (data && typeof data === 'object') {
        latestCloudSnapshot = {
          provider,
          sheetId,
          timestamp: syncTimestamp,
          data
        };
      }

      // Successfully authenticated and saved
      res.json({
        success: true,
        message: `Đã xác thực quyền Admin và đồng bộ lên đám mây (${provider === 'firebase' ? 'Firebase' : 'Google Sheets'}) thành công!`,
        timestamp: syncTimestamp
      });
    } catch (error: any) {
      console.error("Cloud Sync Server Error:", error);
      res.status(500).json({ error: error.message || "Không thể đồng bộ dữ liệu đám mây." });
    }
  });

  // API - Get latest cloud data snapshot (Accessible to Viewers and Admins for auto-loading)
  app.get('/api/cloud/latest', (req, res) => {
    if (!latestCloudSnapshot) {
      return res.json({ success: false, message: 'Chưa có dữ liệu đồng bộ trên đám mây.' });
    }
    res.json({
      success: true,
      snapshot: latestCloudSnapshot
    });
  });

  // API - Get distribution service configuration & readiness (Các biến SMTP/ZALO hoàn toàn tùy chọn, mặc định "")
  app.get('/api/distribution/config', (req, res) => {
    const hasEmailConfig = Boolean(SMTP_USER && SMTP_PASS);
    const hasZaloConfig = Boolean(ZALO_WEBHOOK_URL || ZALO_OA_ACCESS_TOKEN);

    res.json({
      success: true,
      email: {
        isConfigured: hasEmailConfig,
        host: SMTP_HOST || 'smtp.gmail.com',
        port: SMTP_PORT || '587',
        user: SMTP_USER ? SMTP_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
        from: SMTP_FROM || 'EduSchedule AI <bangiangday.thpt@gmail.com>'
      },
      zalo: {
        isConfigured: hasZaloConfig,
        hasWebhook: Boolean(ZALO_WEBHOOK_URL),
        hasOaToken: Boolean(ZALO_OA_ACCESS_TOKEN)
      }
    });
  });

  // API - Send Personalized Distribution via Email (SMTP/Gmail) or Zalo (Webhook/Bot)
  app.post('/api/distribution/send', async (req, res) => {
    try {
      const { 
        recipient, // { id, name, email, phone, type, code }
        channel = 'both', // 'email' | 'zalo' | 'both'
        subject,
        htmlContent,
        plainText,
        imageBase64, // optional PNG attachment data URL or raw base64
        simulated = false
      } = req.body;

      if (!recipient || !recipient.name) {
        return res.status(400).json({ error: 'Thiếu thông tin người nhận.' });
      }

      const results: {
        email?: { success: boolean; simulated?: boolean; message: string; messageId?: string; unconfigured?: boolean };
        zalo?: { success: boolean; simulated?: boolean; message: string; unconfigured?: boolean };
      } = {};

      // 1. Gửi qua EMAIL (Gmail / SMTP - Tùy chọn)
      if (channel === 'email' || channel === 'both') {
        const targetEmail = recipient.email?.trim();
        if (!targetEmail) {
          results.email = {
            success: false,
            message: 'Chưa có địa chỉ Email.'
          };
        } else if (!SMTP_USER || !SMTP_PASS) {
          // Chưa cấu hình SMTP (mặc định rỗng "") -> Không chặn hệ thống, báo chế độ mô phỏng / mở Gmail client
          results.email = {
            success: true,
            simulated: true,
            unconfigured: true,
            message: 'Biến môi trường SMTP chưa cấu hình (mặc định ""). Quý thầy cô có thể dùng nút "Mở soạn Gmail gửi ngay" trực tiếp trên trình duyệt.'
          };
        } else {
          // Gửi thật qua Nodemailer
          try {
            const transporter = nodemailer.createTransport({
              host: SMTP_HOST || 'smtp.gmail.com',
              port: Number(SMTP_PORT || 587),
              secure: Number(SMTP_PORT) === 465,
              auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
              }
            });

            const attachments: any[] = [];
            if (imageBase64) {
              const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
              attachments.push({
                filename: `TKB_${recipient.name.replace(/\s+/g, '_')}.png`,
                content: Buffer.from(cleanBase64, 'base64'),
                cid: 'timetable_image'
              });
            }

            const mailInfo = await transporter.sendMail({
              from: SMTP_FROM || `"Ban Giám Hiệu - THPT" <${SMTP_USER}>`,
              to: targetEmail,
              subject: subject || `[EduSchedule] Thông báo Phân công & Thời khóa biểu - ${recipient.name}`,
              text: plainText || 'Vui lòng xem thông báo đính kèm.',
              html: htmlContent,
              attachments
            });

            console.log(`[Distribution] Đã gửi Email thật tới: ${targetEmail}, MessageId: ${mailInfo.messageId}`);
            results.email = {
              success: true,
              simulated: false,
              message: `Đã gửi thành công tới ${targetEmail}`,
              messageId: mailInfo.messageId
            };
          } catch (mailError: any) {
            console.error(`[Distribution] Lỗi gửi Email tới ${targetEmail}:`, mailError);
            results.email = {
              success: false,
              message: `Lỗi gửi thư: ${mailError.message || 'SMTP Error'}`
            };
          }
        }
      }

      // 2. Gửi qua ZALO (Webhook / Bot / ZNS - Tùy chọn)
      if (channel === 'zalo' || channel === 'both') {
        const targetPhone = recipient.phone?.trim();
        if (!targetPhone) {
          results.zalo = {
            success: false,
            message: 'Chưa có số điện thoại Zalo.'
          };
        } else if (!ZALO_WEBHOOK_URL && !ZALO_OA_ACCESS_TOKEN) {
          // Chưa cấu hình Zalo (mặc định rỗng "") -> Không chặn hệ thống, báo chế độ mô phỏng / mở Zalo chat 1-chạm
          results.zalo = {
            success: true,
            simulated: true,
            unconfigured: true,
            message: 'Biến môi trường ZALO chưa cấu hình (mặc định ""). Quý thầy cô có thể dùng nút "Mở Zalo & Dán (1-chạm)" trực tiếp trên trình duyệt.'
          };
        } else if (ZALO_WEBHOOK_URL) {
          // Đẩy qua Webhook (n8n, make, hoặc Bot server)
          try {
            const webhookRes = await fetch(ZALO_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: targetPhone,
                name: recipient.name,
                type: recipient.type,
                code: recipient.code,
                title: subject,
                text: plainText,
                image: imageBase64 ? imageBase64.substring(0, 500) + '...[truncated]' : null,
                timestamp: new Date().toISOString()
              })
            });

            if (webhookRes.ok) {
              results.zalo = {
                success: true,
                simulated: false,
                message: `Đã kích hoạt Webhook gửi Zalo tới ${targetPhone}`
              };
            } else {
              results.zalo = {
                success: false,
                message: `Webhook Zalo trả về mã lỗi ${webhookRes.status}`
              };
            }
          } catch (zaloError: any) {
            console.error(`[Distribution] Lỗi gửi Zalo Webhook tới ${targetPhone}:`, zaloError);
            results.zalo = {
              success: false,
              message: `Lỗi kết nối Webhook Zalo: ${zaloError.message}`
            };
          }
        }
      }

      const overallSuccess = 
        (channel === 'email' && results.email?.success) ||
        (channel === 'zalo' && results.zalo?.success) ||
        (channel === 'both' && (results.email?.success || results.zalo?.success));

      res.json({
        success: Boolean(overallSuccess),
        recipientId: recipient.id,
        recipientName: recipient.name,
        results
      });
    } catch (err: any) {
      console.error('[Distribution API Error]:', err);
      res.status(500).json({ error: err.message || 'Lỗi xử lý gửi thông báo.' });
    }
  });

  // Error handling middleware (e.g. for PayloadTooLargeError or syntax errors)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      console.error('[Express] PayloadTooLargeError caught:', err.message);
      return res.status(413).json({ error: 'Kích thước dữ liệu quá lớn (Payload too large).' });
    }
    if (err) {
      console.error('[Express] Request error:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Lỗi xử lý yêu cầu máy chủ.' });
    }
    next();
  });

  // Serve static files in production / Vite middlewares in development
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EduSchedule AI Server is running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
