import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Send, Mail, MessageSquare, CheckCircle, AlertTriangle, AlertCircle,
  X, Search, Filter, RefreshCw, Eye, Download, FileSpreadsheet,
  Check, Play, Pause, Square, ExternalLink, Settings, ShieldCheck,
  User, Users, Sparkles, Smartphone, ChevronRight, Copy, ArrowRight,
  Clock, Edit2, Save, Printer
} from 'lucide-react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { Teacher, ClassModel } from '../utils/assignmentSolver';
import { TimetableData } from '../utils/timetableTypes';
import { SchoolInfo } from '../utils/exportUtils';
import {
  getTeacherAssignmentSummary,
  generateTeacherEmailHtml,
  generateTeacherPlainText,
  generateClassEmailHtml,
  generateClassPlainText
} from '../utils/distributionTemplates';

export interface SendScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  teachers: Teacher[];
  classes: ClassModel[];
  assignments: {
    homeroomAssignments: Record<string, string>;
    subjectAssignments: Record<string, Record<string, string>>;
  };
  timetableData: TimetableData | null;
  schoolInfo?: Partial<SchoolInfo>;
  subjectsConfig?: { id: string; grade10Periods: number; grade11Periods: number; grade12Periods: number }[];
  classSubjectPeriods?: Record<string, Record<string, any>>;
  onUpdateTeacherContact?: (teacherId: string, email?: string, phone?: string) => void;
  onUpdateClassContact?: (classId: string, email?: string, phone?: string) => void;
  isAdmin?: boolean;
}

export type RecipientStatus = 'idle' | 'sending' | 'success' | 'error' | 'skipped';

export interface RecipientItem {
  id: string;
  code: string;
  name: string;
  type: 'teacher' | 'class';
  email: string;
  phone: string;
  roleOrHomeroom: string;
  departmentOrGrade: string;
  status: RecipientStatus;
  statusMessage?: string;
  sentAt?: string;
  channelResults?: {
    email?: { success: boolean; message: string; simulated?: boolean };
    zalo?: { success: boolean; message: string; simulated?: boolean };
  };
}

export const SendScheduleModal: React.FC<SendScheduleModalProps> = ({
  isOpen,
  onClose,
  teachers,
  classes,
  assignments,
  timetableData,
  schoolInfo,
  subjectsConfig,
  classSubjectPeriods,
  onUpdateTeacherContact,
  onUpdateClassContact,
  isAdmin = true
}) => {
  // Tabs: 'teachers' (101 GV) | 'classes' (44 Lớp)
  const [activeTab, setActiveTab] = useState<'teachers' | 'classes'>('teachers');

  // Selected recipient IDs
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [missingContactFilter, setMissingContactFilter] = useState<'all' | 'missing_email' | 'missing_phone' | 'has_all'>('all');

  // Channels
  const [sendEmail, setSendEmail] = useState(true);
  const [sendZalo, setSendZalo] = useState(true);
  const [attachImage, setAttachImage] = useState(false);
  const [sendDelayMs, setSendDelayMs] = useState(500); // 500ms delay between dispatches

  // Batch execution state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);

  // Recipient statuses dictionary: recipientId -> status info
  const [recipientStatuses, setRecipientStatuses] = useState<Record<string, {
    status: RecipientStatus;
    message?: string;
    sentAt?: string;
    results?: any;
  }>>({});

  // Preview Drawer/Modal
  const [previewRecipientId, setPreviewRecipientId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'email' | 'zalo'>('email');
  const [copiedZaloText, setCopiedZaloText] = useState(false);

  // Floating Toast notification
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'warning' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'warning' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(prev => prev?.text === text ? null : prev);
    }, 4500);
  };

  // Warning modal for unconfigured batch sending
  const [unconfiguredAlert, setUnconfiguredAlert] = useState<string | null>(null);

  // Quick edit modal for missing contact
  const [editingContact, setEditingContact] = useState<{
    id: string;
    type: 'teacher' | 'class';
    name: string;
    email: string;
    phone: string;
  } | null>(null);

  // Server distribution service status
  const [serverConfig, setServerConfig] = useState<{
    emailConfigured: boolean;
    zaloConfigured: boolean;
    smtpUser?: string;
    hasWebhook?: boolean;
  }>({ emailConfigured: false, zaloConfigured: false });

  // Config modal
  const [showConfigInfo, setShowConfigInfo] = useState(false);

  // Hidden container ref for rendering snapshot
  const hiddenSnapshotRef = useRef<HTMLDivElement>(null);

  // Fetch backend distribution config on open
  useEffect(() => {
    if (isOpen) {
      fetch('/api/distribution/config')
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setServerConfig({
              emailConfigured: Boolean(data.email?.isConfigured),
              zaloConfigured: Boolean(data.zalo?.isConfigured),
              smtpUser: data.email?.user || undefined,
              hasWebhook: Boolean(data.zalo?.hasWebhook)
            });
          }
        })
        .catch(err => {
          console.warn('[Distribution] Could not fetch server config:', err);
        });
    }
  }, [isOpen]);

  // Build Teacher Recipients (101 teachers)
  const teacherRecipients = useMemo<RecipientItem[]>(() => {
    return teachers.map(t => {
      // Find homeroom
      let homeroomName = '';
      Object.entries(assignments.homeroomAssignments || {}).forEach(([cId, tId]) => {
        if (tId === t.id) {
          const cls = classes.find(c => c.id === cId);
          homeroomName = cls ? `CN ${cls.name}` : `CN ${cId}`;
        }
      });

      const roleDisplay = homeroomName ? `${t.position || 'Giáo viên'} • ${homeroomName}` : (t.position || 'Giáo viên');
      const savedStatus = recipientStatuses[t.id];

      // Default fallback email if empty
      const cleanEmail = (t.email || '').trim();
      const cleanPhone = (t.phone || '').trim();

      return {
        id: t.id,
        code: t.id,
        name: t.name,
        type: 'teacher',
        email: cleanEmail,
        phone: cleanPhone,
        roleOrHomeroom: roleDisplay,
        departmentOrGrade: t.department || t.specialization || 'Chưa phân tổ',
        status: savedStatus?.status || 'idle',
        statusMessage: savedStatus?.message,
        sentAt: savedStatus?.sentAt,
        channelResults: savedStatus?.results
      };
    });
  }, [teachers, classes, assignments, recipientStatuses]);

  // Build Class Recipients (44 classes)
  const classRecipients = useMemo<RecipientItem[]>(() => {
    return classes.map(c => {
      const homeroomTeacherId = assignments.homeroomAssignments?.[c.id];
      const homeroomTeacher = teachers.find(t => t.id === homeroomTeacherId);
      const savedStatus = recipientStatuses[c.id];

      // Class contact: default to homeroom teacher phone or class email
      const defaultEmail = homeroomTeacher?.email || `lop_${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@thpt.edu.vn`;
      const defaultPhone = homeroomTeacher?.phone || '';

      return {
        id: c.id,
        code: c.name,
        name: `Lớp ${c.name}`,
        type: 'class',
        email: defaultEmail,
        phone: defaultPhone,
        roleOrHomeroom: homeroomTeacher ? `GVCN: ${homeroomTeacher.name}` : 'Chưa có GVCN',
        departmentOrGrade: `Khối ${c.grade}`,
        status: savedStatus?.status || 'idle',
        statusMessage: savedStatus?.message,
        sentAt: savedStatus?.sentAt,
        channelResults: savedStatus?.results
      };
    });
  }, [classes, teachers, assignments, recipientStatuses]);

  // All departments for filter
  const departmentsList = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach(t => {
      if (t.department) set.add(t.department);
      else if (t.specialization) set.add(t.specialization);
    });
    return Array.from(set).sort();
  }, [teachers]);

  // Current active list based on active tab
  const currentList = activeTab === 'teachers' ? teacherRecipients : classRecipients;

  // Filtered list
  const filteredList = useMemo(() => {
    return currentList.filter(item => {
      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchCode = item.code.toLowerCase().includes(q);
        const matchEmail = item.email.toLowerCase().includes(q);
        const matchPhone = item.phone.toLowerCase().includes(q);
        const matchRole = item.roleOrHomeroom.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchEmail && !matchPhone && !matchRole) return false;
      }

      // Department filter (if teachers)
      if (activeTab === 'teachers' && deptFilter !== 'all') {
        if (item.departmentOrGrade !== deptFilter) return false;
      }

      // Grade filter (if classes)
      if (activeTab === 'classes' && gradeFilter !== 'all') {
        if (item.departmentOrGrade !== `Khối ${gradeFilter}`) return false;
      }

      // Missing contact filter
      if (missingContactFilter === 'missing_email') {
        if (item.email) return false;
      } else if (missingContactFilter === 'missing_phone') {
        if (item.phone) return false;
      } else if (missingContactFilter === 'has_all') {
        if (!item.email || !item.phone) return false;
      }

      return true;
    });
  }, [currentList, activeTab, searchQuery, deptFilter, gradeFilter, missingContactFilter]);

  // Initialize all selected by default when opened
  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, boolean> = {};
      teacherRecipients.forEach(t => { initial[t.id] = true; });
      classRecipients.forEach(c => { initial[c.id] = true; });
      setSelectedIds(initial);
    }
  }, [isOpen, teacherRecipients.length, classRecipients.length]);

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Select all in current tab
  const handleSelectAllInTab = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = { ...prev };
      filteredList.forEach(item => {
        next[item.id] = checked;
      });
      return next;
    });
  };

  // Selected count in current tab
  const selectedCountInTab = useMemo(() => {
    return filteredList.filter(item => selectedIds[item.id]).length;
  }, [filteredList, selectedIds]);

  const allSelectedInTab = filteredList.length > 0 && selectedCountInTab === filteredList.length;

  // Status counters
  const stats = useMemo(() => {
    let success = 0;
    let error = 0;
    let sending = 0;
    let idle = 0;

    currentList.forEach(item => {
      if (item.status === 'success') success++;
      else if (item.status === 'error') error++;
      else if (item.status === 'sending') sending++;
      else idle++;
    });

    return { success, error, sending, idle, total: currentList.length };
  }, [currentList]);

  // Generate payload for a single recipient
  const buildRecipientPayload = async (item: RecipientItem) => {
    let subject = '';
    let htmlContent = '';
    let plainText = '';

    if (item.type === 'teacher') {
      const teacher = teachers.find(t => t.id === item.id);
      if (!teacher) throw new Error('Không tìm thấy giáo viên');
      const summary = getTeacherAssignmentSummary(teacher, classes, assignments, classSubjectPeriods, subjectsConfig);
      subject = `[EduSchedule] Bảng Phân công & Thời khóa biểu - ${teacher.name}`;
      htmlContent = generateTeacherEmailHtml({ teacher, summary, timetableData, schoolInfo });
      plainText = generateTeacherPlainText({ teacher, summary, timetableData, schoolInfo });
    } else {
      const classItem = classes.find(c => c.id === item.id);
      if (!classItem) throw new Error('Không tìm thấy lớp học');
      const homeroomTeacherId = assignments.homeroomAssignments?.[classItem.id];
      const homeroomTeacher = teachers.find(t => t.id === homeroomTeacherId) || null;

      // Map subject teachers
      const subMap = assignments.subjectAssignments?.[classItem.id] || {};
      const subjectTeachers: { subject: string; teacherName: string; phone?: string; periods: number }[] = [];

      Object.entries(subMap).forEach(([subId, tId]) => {
        const t = teachers.find(teach => teach.id === tId);
        let periods = 0;
        if (classSubjectPeriods?.[classItem.id]?.[subId] !== undefined) {
          periods = Number(classSubjectPeriods[classItem.id][subId]) || 0;
        } else {
          const cfg = subjectsConfig?.find(s => s.id === subId);
          if (cfg) {
            periods = classItem.grade === '12' ? cfg.grade12Periods : (classItem.grade === '11' ? cfg.grade11Periods : cfg.grade10Periods);
          }
        }
        subjectTeachers.push({
          subject: subId,
          teacherName: t ? t.name : tId,
          phone: t?.phone,
          periods
        });
      });

      subject = `[EduSchedule] Thời khóa biểu học tập - Lớp ${classItem.name}`;
      htmlContent = generateClassEmailHtml({ classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo });
      plainText = generateClassPlainText({ classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo });
    }

    return { subject, htmlContent, plainText };
  };

  // 1-Click Fast Send via Zalo (Client-side)
  const handleQuickSendZalo = async (item: RecipientItem) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }

    if (!item.phone || !item.phone.trim()) {
      showToast(`Chưa có số điện thoại Zalo cho ${item.name}. Vui lòng bấm "Sửa" để bổ sung!`, 'warning');
      setEditingContact({
        id: item.id,
        type: item.type,
        name: item.name,
        email: item.email || '',
        phone: ''
      });
      return;
    }

    try {
      const { plainText } = await buildRecipientPayload(item);
      
      // 1. Copy full teaching assignment & schedule plain text to Clipboard
      try {
        await navigator.clipboard.writeText(plainText);
      } catch (err) {
        const textArea = document.createElement("textarea");
        textArea.value = plainText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      // 2. Format phone: replace leading 0 with 84
      const digits = item.phone.replace(/[^0-9]/g, '');
      const cleanPhone = digits.replace(/^0/, '84');

      // 3. Open personal Zalo chat URL
      window.open(`https://zalo.me/${cleanPhone}`, '_blank');

      // 4. Show notification toast
      showToast('Đã sao chép TKB! Hãy dán (Ctrl+V) vào khung chat Zalo vừa mở.', 'success');

      // 5. Update recipient status
      setRecipientStatuses(prev => ({
        ...prev,
        [item.id]: {
          status: 'success',
          message: `Đã mở chat Zalo (84***) & sao chép TKB vào Clipboard`,
          sentAt: new Date().toLocaleTimeString('vi-VN')
        }
      }));
    } catch (err: any) {
      console.error('Lỗi chuẩn bị dữ liệu Zalo:', err);
      showToast('Không thể chuẩn bị nội dung TKB: ' + (err.message || 'Lỗi không xác định'), 'warning');
    }
  };

  // 1-Click Fast Send via Gmail Compose (Client-side)
  const handleQuickSendGmail = async (item: RecipientItem) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }

    if (!item.email || !item.email.trim()) {
      showToast(`Chưa có Email cho ${item.name}. Vui lòng bấm "Sửa" để bổ sung!`, 'warning');
      setEditingContact({
        id: item.id,
        type: item.type,
        name: item.name,
        email: '',
        phone: item.phone || ''
      });
      return;
    }

    try {
      const { subject, plainText } = await buildRecipientPayload(item);
      const mailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(item.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
      window.open(mailUrl, '_blank');

      showToast(`Đã mở trình soạn thư Gmail cho ${item.name}!`, 'info');

      setRecipientStatuses(prev => ({
        ...prev,
        [item.id]: {
          status: 'success',
          message: `Đã mở trình soạn thư Gmail (${item.email})`,
          sentAt: new Date().toLocaleTimeString('vi-VN')
        }
      }));
    } catch (err: any) {
      console.error('Lỗi mở Gmail:', err);
      showToast('Không thể tạo liên kết Gmail: ' + (err.message || 'Lỗi không xác định'), 'warning');
    }
  };

  // Copy All Selected Schedules to Clipboard
  const handleCopyAllSelected = async () => {
    const items = filteredList.filter(item => selectedIds[item.id]);
    if (items.length === 0) {
      showToast('Chưa chọn đối tượng nào để sao chép!', 'warning');
      return;
    }

    try {
      const divider = '\n\n' + '════════════════════════════════════════════════════════════\n\n';
      const pieces: string[] = [];

      for (const item of items) {
        const { plainText } = await buildRecipientPayload(item);
        pieces.push(plainText);
      }

      const combinedText = pieces.join(divider);

      try {
        await navigator.clipboard.writeText(combinedText);
      } catch (err) {
        const textArea = document.createElement("textarea");
        textArea.value = combinedText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      showToast(`Đã sao chép toàn bộ TKB của ${items.length} đối tượng vào Clipboard!`, 'success');
    } catch (err: any) {
      console.error('Lỗi sao chép toàn bộ:', err);
      showToast('Lỗi khi chuẩn bị dữ liệu sao chép.', 'warning');
    }
  };

  // Send single recipient via server
  const sendSingleRecipient = async (item: RecipientItem, isBatch = false) => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }

    const channel = sendEmail && sendZalo ? 'both' : (sendEmail ? 'email' : (sendZalo ? 'zalo' : 'none'));
    if (channel === 'none') {
      showToast('Vui lòng chọn ít nhất một kênh gửi (Gmail hoặc Zalo)!', 'warning');
      return;
    }

    setRecipientStatuses(prev => ({
      ...prev,
      [item.id]: {
        status: 'sending',
        message: 'Đang gửi thông báo...'
      }
    }));

    try {
      const { subject, htmlContent, plainText } = await buildRecipientPayload(item);

      const res = await fetch('/api/distribution/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: {
            id: item.id,
            code: item.code,
            name: item.name,
            email: item.email,
            phone: item.phone,
            type: item.type
          },
          channel,
          subject,
          htmlContent,
          plainText,
          simulated: false
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRecipientStatuses(prev => ({
          ...prev,
          [item.id]: {
            status: 'success',
            message: 'Đã gửi thành công qua máy chủ!',
            sentAt: new Date().toLocaleTimeString('vi-VN'),
            results: data.results
          }
        }));
      } else {
        const isUnconfigured = data.results?.email?.unconfigured || data.unconfigured;
        const errorDetail = 
          data.results?.email?.message || 
          data.results?.zalo?.message || 
          data.error || 
          'Không thể hoàn tất gửi';

        setRecipientStatuses(prev => ({
          ...prev,
          [item.id]: {
            status: 'error',
            message: errorDetail,
            results: data.results
          }
        }));

        if (isUnconfigured && !isBatch) {
          setUnconfiguredAlert(errorDetail);
        }
      }
    } catch (err: any) {
      console.error('Send error:', err);
      setRecipientStatuses(prev => ({
        ...prev,
        [item.id]: {
          status: 'error',
          message: err.message || 'Lỗi kết nối máy chủ'
        }
      }));
    }
  };

  // Start Batch Send (with unconfigured alert check)
  const handleStartBatch = async () => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }

    const channel = sendEmail && sendZalo ? 'both' : (sendEmail ? 'email' : (sendZalo ? 'zalo' : 'none'));
    if (channel === 'none') {
      showToast('Vui lòng chọn ít nhất một kênh gửi (Gmail hoặc Zalo)!', 'warning');
      return;
    }

    const itemsToSend = filteredList.filter(item => selectedIds[item.id]);
    if (itemsToSend.length === 0) {
      showToast('Vui lòng chọn ít nhất một đối tượng nhận từ danh sách!', 'warning');
      return;
    }

    // Check whether backend is configured with actual SMTP / Zalo credentials
    const needsEmail = channel === 'email' || channel === 'both';
    const needsZalo = channel === 'zalo' || channel === 'both';
    const emailUnready = needsEmail && !serverConfig.emailConfigured;
    const zaloUnready = needsZalo && !serverConfig.zaloConfigured;

    if (emailUnready || zaloUnready) {
      setUnconfiguredAlert(
        'Máy chủ chưa được cấu hình tài khoản gửi tự động ngầm (SMTP Gmail / Zalo OA). Hệ thống tuân thủ nguyên tắc không báo "Thành công" giả lập.'
      );
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;

    for (let i = 0; i < itemsToSend.length; i++) {
      if (stopRequestedRef.current) {
        break;
      }

      // Check pause
      while (pauseRequestedRef.current) {
        await new Promise(resolve => setTimeout(resolve, 300));
        if (stopRequestedRef.current) break;
      }
      if (stopRequestedRef.current) break;

      const item = itemsToSend[i];
      await sendSingleRecipient(item, true);

      // Delay between sends
      if (i < itemsToSend.length - 1 && sendDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, sendDelayMs));
      }
    }

    setIsProcessing(false);
    setIsPaused(false);
  };

  const handlePauseBatch = () => {
    pauseRequestedRef.current = !pauseRequestedRef.current;
    setIsPaused(pauseRequestedRef.current);
  };

  const handleStopBatch = () => {
    stopRequestedRef.current = true;
    pauseRequestedRef.current = false;
    setIsProcessing(false);
    setIsPaused(false);
  };

  // Open Preview for item
  const handleOpenPreview = (item: RecipientItem) => {
    setPreviewRecipientId(item.id);
  };

  // Copy Zalo Text to clipboard
  const handleCopyZaloText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedZaloText(true);
    setTimeout(() => setCopiedZaloText(false), 2500);
    showToast('Đã sao chép văn bản TKB!', 'success');
  };

  // Quick Open Zalo Chat (zalo.me link)
  const handleOpenZaloChat = (phone: string, textToCopy?: string) => {
    if (!phone) {
      showToast('Chưa có số điện thoại để mở Zalo.', 'warning');
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '').replace(/^0/, '84');
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      showToast('Đã sao chép TKB! Hãy dán (Ctrl+V) vào khung chat Zalo vừa mở.', 'success');
    }
    window.open(`https://zalo.me/${cleanPhone}`, '_blank');
  };

  // Export report to Excel
  const handleExportReport = () => {
    const rows = currentList.map((item, idx) => ({
      'STT': idx + 1,
      'Mã': item.code,
      'Họ tên / Lớp': item.name,
      'Đối tượng': item.type === 'teacher' ? 'Giáo viên' : 'Lớp học',
      'Đơn vị / Khối': item.departmentOrGrade,
      'Chức vụ / GVCN': item.roleOrHomeroom,
      'Email': item.email || '(Thiếu)',
      'Số điện thoại Zalo': item.phone || '(Thiếu)',
      'Trạng thái gửi': 
        item.status === 'success' ? 'Thành công' : 
        item.status === 'error' ? 'Thất bại' : 
        item.status === 'sending' ? 'Đang gửi' : 'Chưa gửi',
      'Thời gian gửi': item.sentAt || '',
      'Chi tiết phản hồi': item.statusMessage || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo gửi TKB');

    const fileName = `Bao_cao_gui_TKB_${activeTab === 'teachers' ? 'GiaoVien' : 'LopHoc'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Save quick edited contact
  const handleSaveQuickContact = () => {
    if (!isAdmin) {
      alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
      return;
    }
    if (!editingContact) return;

    if (editingContact.type === 'teacher') {
      onUpdateTeacherContact?.(editingContact.id, editingContact.email, editingContact.phone);
    } else {
      onUpdateClassContact?.(editingContact.id, editingContact.email, editingContact.phone);
    }

    setEditingContact(null);
  };

  // Preview data generator for the active previewed recipient
  const activePreviewData = useMemo(() => {
    if (!previewRecipientId) return null;

    const teacher = teachers.find(t => t.id === previewRecipientId);
    if (teacher) {
      const summary = getTeacherAssignmentSummary(teacher, classes, assignments, classSubjectPeriods, subjectsConfig);
      const emailHtml = generateTeacherEmailHtml({ teacher, summary, timetableData, schoolInfo });
      const plainText = generateTeacherPlainText({ teacher, summary, timetableData, schoolInfo });
      return {
        name: teacher.name,
        type: 'teacher' as const,
        email: teacher.email,
        phone: teacher.phone,
        emailHtml,
        plainText
      };
    }

    const classItem = classes.find(c => c.id === previewRecipientId);
    if (classItem) {
      const homeroomTeacherId = assignments.homeroomAssignments?.[classItem.id];
      const homeroomTeacher = teachers.find(t => t.id === homeroomTeacherId) || null;
      const subMap = assignments.subjectAssignments?.[classItem.id] || {};
      const subjectTeachers: { subject: string; teacherName: string; phone?: string; periods: number }[] = [];

      Object.entries(subMap).forEach(([subId, tId]) => {
        const t = teachers.find(teach => teach.id === tId);
        let periods = 0;
        if (classSubjectPeriods?.[classItem.id]?.[subId] !== undefined) {
          periods = Number(classSubjectPeriods[classItem.id][subId]) || 0;
        } else {
          const cfg = subjectsConfig?.find(s => s.id === subId);
          if (cfg) {
            periods = classItem.grade === '12' ? cfg.grade12Periods : (classItem.grade === '11' ? cfg.grade11Periods : cfg.grade10Periods);
          }
        }
        subjectTeachers.push({
          subject: subId,
          teacherName: t ? t.name : tId,
          phone: t?.phone,
          periods
        });
      });

      const emailHtml = generateClassEmailHtml({ classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo });
      const plainText = generateClassPlainText({ classItem, homeroomTeacher, subjectTeachers, timetableData, schoolInfo });

      return {
        name: `Lớp ${classItem.name}`,
        type: 'class' as const,
        email: homeroomTeacher?.email,
        phone: homeroomTeacher?.phone,
        emailHtml,
        plainText
      };
    }

    return null;
  }, [previewRecipientId, teachers, classes, assignments, classSubjectPeriods, subjectsConfig, timetableData, schoolInfo]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-hidden animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        
        {/* MODAL HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 bg-linear-to-r from-blue-900 via-indigo-900 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center shadow-inner">
              <Send className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  Trung tâm Gửi TKB & Phân công Chuyên môn
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 border border-blue-400/30">
                    Distribution Hub
                  </span>
                </h2>
              </div>
              <p className="text-xs text-blue-200/80 mt-0.5">
                Xuất bản và gửi tự động Thời khóa biểu & Quyết định phân công cá nhân hóa qua Gmail và Zalo
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Connection Status Badges */}
            <button
              onClick={() => setShowConfigInfo(!showConfigInfo)}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-slate-200 transition-all border border-white/15"
              title="Xem trạng thái kết nối máy chủ"
            >
              <Settings className="w-3.5 h-3.5 text-blue-300" />
              <span>Cấu hình kết nối</span>
              <span className={`w-2 h-2 rounded-full ${serverConfig.emailConfigured || serverConfig.zaloConfigured ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CONNECTION CONFIG ACCORDION / INFO BANNER */}
        {showConfigInfo && (
          <div className="bg-slate-50 border-b border-slate-200 p-4 shrink-0 text-xs">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1 text-sm">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Trạng thái tích hợp Kênh Gửi (Gmail & Zalo)
                </h4>
                <p className="text-slate-600">
                  Hệ thống tự động phát hiện cấu hình từ tệp <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800 font-mono">.env</code>. Khi chưa nhập tài khoản thật, hệ thống hỗ trợ chế độ xem trước, mở Zalo 1-chạm và chạy giả lập an toàn để kiểm thử toàn diện.
                </p>
              </div>
              <button 
                onClick={() => setShowConfigInfo(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-rose-500" /> Kênh Gmail (SMTP)
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${serverConfig.emailConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {serverConfig.emailConfigured ? '✓ Sẵn sàng gửi thật' : '⚡ Chế độ Kiểm thử / Mô phỏng'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {serverConfig.smtpUser ? `Tài khoản: ${serverConfig.smtpUser}` : 'Chưa nhập SMTP_USER / SMTP_PASS trong file .env. Hệ thống sẽ mô phỏng gửi thành công khi thử nghiệm.'}
                </div>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-blue-600" /> Kênh Zalo (Webhook / Chat 1-chạm)
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${serverConfig.zaloConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                    {serverConfig.zaloConfigured ? '✓ Đã kết nối Webhook' : '✓ Hỗ trợ mở Chat 1-chạm & Nhóm'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {serverConfig.hasWebhook ? 'Webhook đang hoạt động để đẩy tin nhắn tự động.' : 'Có thể mở nhanh Zalo cá nhân qua nút bấm, sao chép nội dung TKB hoặc cấu hình ZALO_WEBHOOK_URL.'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TABS & CONTROLS ROW */}
        <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Target Tabs */}
          <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('teachers')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'teachers'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Toàn bộ Giáo viên</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                {teachers.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('classes')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'classes'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Toàn bộ Lớp học</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                {classes.length}
              </span>
            </button>
          </div>

          {/* Delivery Channels Toggle */}
          <div className="flex items-center space-x-4 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <span className="text-xs font-semibold text-slate-600">Kênh gửi:</span>
            
            <label className="flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={sendEmail}
                onChange={e => {
                  if (!isAdmin) return;
                  setSendEmail(e.target.checked);
                }}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 disabled:cursor-not-allowed"
              />
              <span className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-rose-500" /> Gmail
              </span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={sendZalo}
                onChange={e => {
                  if (!isAdmin) return;
                  setSendZalo(e.target.checked);
                }}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 disabled:cursor-not-allowed"
              />
              <span className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-blue-600" /> Zalo
              </span>
            </label>
          </div>

          {/* Rate limit delay */}
          <div className="flex items-center space-x-2 text-xs text-slate-600">
            <span>Giãn cách gửi:</span>
            <select
              value={sendDelayMs}
              disabled={!isAdmin}
              onChange={e => {
                if (!isAdmin) return;
                setSendDelayMs(Number(e.target.value));
              }}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <option value={300}>300ms (Nhanh)</option>
              <option value={500}>500ms (Khuyên dùng)</option>
              <option value={1000}>1 giây (An toàn chống spam)</option>
              <option value={2000}>2 giây</option>
            </select>
          </div>
        </div>

        {/* FILTER & SEARCH BAR */}
        <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2 flex-1 min-w-[240px] max-w-md">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={activeTab === 'teachers' ? 'Tìm theo tên giáo viên, môn, chức vụ, SĐT, email...' : 'Tìm theo tên lớp, GVCN, SĐT...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap">
            {/* Department filter for teachers */}
            {activeTab === 'teachers' && (
              <select
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">Tất cả Tổ chuyên môn ({teachers.length})</option>
                {departmentsList.map(d => (
                  <option key={d} value={d}>Tổ {d}</option>
                ))}
              </select>
            )}

            {/* Grade filter for classes */}
            {activeTab === 'classes' && (
              <select
                value={gradeFilter}
                onChange={e => setGradeFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">Tất cả các Khối (44 Lớp)</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>
            )}

            {/* Missing contact filter */}
            <select
              value={missingContactFilter}
              onChange={e => setMissingContactFilter(e.target.value as any)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả liên hệ</option>
              <option value="missing_email">⚠️ Thiếu Email</option>
              <option value="missing_phone">⚠️ Thiếu SĐT / Zalo</option>
              <option value="has_all">✓ Đầy đủ Email & SĐT</option>
            </select>

            {/* Select All Checkbox & Count */}
            <button
              onClick={() => {
                if (!isAdmin) return;
                handleSelectAllInTab(!allSelectedInTab);
              }}
              disabled={!isAdmin}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={!isAdmin ? "Chế độ Chỉ xem" : undefined}
            >
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={allSelectedInTab}
                onChange={() => {}}
                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-0 cursor-pointer pointer-events-none disabled:cursor-not-allowed"
              />
              <span>Đã chọn: <strong className="text-blue-700">{selectedCountInTab}</strong>/{filteredList.length}</span>
            </button>
          </div>
        </div>

        {/* PROGRESS BAR & STATS ROW (WHEN SENDING OR COMPLETED) */}
        {(isProcessing || stats.success > 0 || stats.error > 0) && (
          <div className="px-6 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center justify-between shrink-0 text-xs">
            <div className="flex items-center space-x-4 flex-1">
              <div className="flex items-center space-x-2">
                {isProcessing ? (
                  <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                )}
                <span className="font-semibold text-slate-800">
                  {isProcessing ? (isPaused ? 'Đã tạm dừng hàng đợi gửi...' : 'Đang xử lý gửi hàng loạt...') : 'Hoàn tất chu kỳ gửi thông báo'}
                </span>
              </div>

              <div className="flex-1 max-w-xs bg-slate-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-linear-to-r from-blue-600 to-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${filteredList.length ? Math.min(100, Math.round(((stats.success + stats.error) / filteredList.length) * 100)) : 0}%`
                  }}
                />
              </div>

              <span className="font-bold text-slate-700">
                {stats.success + stats.error} / {filteredList.length} ({filteredList.length ? Math.round(((stats.success + stats.error) / filteredList.length) * 100) : 0}%)
              </span>
            </div>

            <div className="flex items-center space-x-3">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <CheckCircle className="w-3.5 h-3.5" /> Thành công: {stats.success}
              </span>
              {stats.error > 0 && (
                <span className="flex items-center gap-1 text-rose-700 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" /> Thất bại: {stats.error}
                </span>
              )}
            </div>
          </div>
        )}

        {/* TABLE OF RECIPIENTS */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    disabled={!isAdmin}
                    checked={allSelectedInTab}
                    onChange={e => {
                      if (!isAdmin) return;
                      handleSelectAllInTab(e.target.checked);
                    }}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                </th>
                <th className="py-2.5 px-3 w-16 text-center">Mã</th>
                <th className="py-2.5 px-3">{activeTab === 'teachers' ? 'Họ và tên Giáo viên' : 'Lớp học'}</th>
                <th className="py-2.5 px-3">{activeTab === 'teachers' ? 'Chức vụ / Chủ nhiệm' : 'Giáo viên Chủ nhiệm'}</th>
                <th className="py-2.5 px-3">Địa chỉ Email</th>
                <th className="py-2.5 px-3">Số điện thoại / Zalo</th>
                <th className="py-2.5 px-3 text-center">Trạng thái gửi</th>
                <th className="py-2.5 px-4 text-center w-36">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Không tìm thấy đối tượng nào phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredList.map((item, idx) => {
                  const isChecked = Boolean(selectedIds[item.id]);
                  const hasEmail = Boolean(item.email);
                  const hasPhone = Boolean(item.phone);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-blue-50/40 transition-colors ${
                        isChecked ? 'bg-white' : 'bg-slate-50/50 opacity-70'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 px-4 text-center">
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={isChecked}
                          onChange={() => {
                            if (!isAdmin) return;
                            toggleSelect(item.id);
                          }}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Code */}
                      <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-500">
                        {item.code}
                      </td>

                      {/* Name & Department */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          {item.name}
                          {item.type === 'teacher' && (
                            <span className="text-[10px] font-normal px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                              {item.departmentOrGrade}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Role / Homeroom */}
                      <td className="py-2.5 px-3 text-slate-600">
                        <div className="font-medium truncate max-w-[200px]" title={item.roleOrHomeroom}>
                          {item.roleOrHomeroom}
                        </div>
                      </td>

                      {/* Email */}
                      <td className="py-2.5 px-3">
                        {hasEmail ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="font-mono text-slate-700 flex items-center gap-1 text-[11px] truncate max-w-[155px]" title={item.email}>
                              <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                              {item.email}
                            </span>
                            <button
                              disabled={!isAdmin}
                              onClick={() => {
                                if (!isAdmin) {
                                  alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                  return;
                                }
                                handleQuickSendGmail(item);
                              }}
                              title={!isAdmin ? "Chế độ Chỉ xem" : `Mở trình soạn thư Gmail cho ${item.name}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              Gmail
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                return;
                              }
                              setEditingContact({
                                id: item.id,
                                type: item.type,
                                name: item.name,
                                email: '',
                                phone: item.phone
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Thiếu Email (Bấm thêm)
                          </button>
                        )}
                      </td>

                      {/* Phone / Zalo */}
                      <td className="py-2.5 px-3">
                        {hasPhone ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="font-mono text-slate-700 flex items-center gap-1 text-[11px] shrink-0">
                              <Smartphone className="w-3 h-3 text-blue-500 shrink-0" />
                              {item.phone}
                            </span>
                            <button
                              disabled={!isAdmin}
                              onClick={() => {
                                if (!isAdmin) {
                                  alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                  return;
                                }
                                handleQuickSendZalo(item);
                              }}
                              title={!isAdmin ? "Chế độ Chỉ xem" : `Tự động copy TKB và mở Zalo chat với ${item.name}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              Zalo 1-chạm
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                return;
                              }
                              setEditingContact({
                                id: item.id,
                                type: item.type,
                                name: item.name,
                                email: item.email,
                                phone: ''
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Thiếu SĐT (Bấm thêm)
                          </button>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center">
                        {item.status === 'idle' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            <Clock className="w-3 h-3" /> Chờ gửi
                          </span>
                        )}
                        {item.status === 'sending' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Đang gửi...
                          </span>
                        )}
                        {item.status === 'success' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800" title={item.statusMessage}>
                            <CheckCircle className="w-3 h-3 text-emerald-600" /> Thành công
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800" title={item.statusMessage}>
                            <AlertTriangle className="w-3 h-3 text-rose-600" /> Thất bại
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                return;
                              }
                              handleQuickSendZalo(item);
                            }}
                            title={!isAdmin ? "Chế độ Chỉ xem" : "Sao chép TKB & Mở chat Zalo cá nhân"}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <MessageSquare className="w-3 h-3 text-blue-600" />
                            <span>Zalo</span>
                          </button>

                          <button
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                return;
                              }
                              handleQuickSendGmail(item);
                            }}
                            title={!isAdmin ? "Chế độ Chỉ xem" : "Mở trình soạn thư Gmail có sẵn TKB"}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Mail className="w-3 h-3 text-emerald-600" />
                            <span>Gmail</span>
                          </button>

                          <button
                            onClick={() => handleOpenPreview(item)}
                            title="Xem trước nội dung mẫu gửi"
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            disabled={!isAdmin}
                            onClick={() => {
                              if (!isAdmin) {
                                alert("Bạn đang ở chế độ xem. Vui lòng đăng nhập tài khoản Quản trị để thực hiện thao tác này!");
                                return;
                              }
                              setEditingContact({
                                id: item.id,
                                type: item.type,
                                name: item.name,
                                email: item.email,
                                phone: item.phone
                              });
                            }}
                            title={!isAdmin ? "Chế độ Chỉ xem" : "Sửa thông tin liên hệ"}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* FOOTER ACTIONS BAR */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportReport}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Xuất báo cáo (Excel)</span>
            </button>

            <button
              onClick={handleCopyAllSelected}
              disabled={selectedCountInTab === 0}
              title="Sao chép toàn bộ nội dung TKB của các đối tượng đã chọn vào bộ nhớ tạm để dán vào Zalo"
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors shadow-2xs disabled:opacity-40"
            >
              <Copy className="w-4 h-4 text-blue-600" />
              <span>Sao chép TKB đã chọn ({selectedCountInTab})</span>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            {/* Batch Controls */}
            {isProcessing ? (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handlePauseBatch}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors shadow-2xs"
                >
                  <Pause className="w-4 h-4" />
                  <span>{isPaused ? 'Tiếp tục gửi' : 'Tạm dừng'}</span>
                </button>

                <button
                  onClick={handleStopBatch}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-300 text-rose-800 hover:bg-rose-100 transition-colors shadow-2xs"
                >
                  <Square className="w-4 h-4" />
                  <span>Dừng hẳn</span>
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    const first = filteredList[0];
                    if (first) handleOpenPreview(first);
                  }}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-blue-600" />
                  <span>Xem trước nội dung (Preview)</span>
                </button>

                <button
                  onClick={handleStartBatch}
                  disabled={!isAdmin || selectedCountInTab === 0}
                  className="flex items-center space-x-2 px-6 py-2 rounded-xl text-xs font-bold text-white bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  title={!isAdmin ? "Chế độ Chỉ xem - Vui lòng đăng nhập Quản trị để gửi" : undefined}
                >
                  <Send className="w-4 h-4" />
                  <span>Bắt đầu gửi hàng loạt ({selectedCountInTab})</span>
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* PREVIEW DRAWER / MODAL */}
      {previewRecipientId && activePreviewData && (
        <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-xs flex items-center justify-end p-2 md:p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl h-full flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-600" />
                  Xem trước: {activePreviewData.name}
                </h3>
                <div className="text-xs text-slate-500 mt-0.5">
                  Email: {activePreviewData.email || 'Chưa có'} • SĐT: {activePreviewData.phone || 'Chưa có'}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Switch Email / Zalo preview */}
                <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    onClick={() => setPreviewTab('email')}
                    className={`px-3 py-1 rounded-md transition-all ${previewTab === 'email' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'}`}
                  >
                    Email (HTML)
                  </button>
                  <button
                    onClick={() => setPreviewTab('zalo')}
                    className={`px-3 py-1 rounded-md transition-all ${previewTab === 'zalo' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'}`}
                  >
                    Zalo (Tin nhắn)
                  </button>
                </div>

                <button
                  onClick={() => setPreviewRecipientId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-100">
              {previewTab === 'email' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-xl border border-slate-200">
                    <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-emerald-600" />
                      Mẫu thư HTML gửi qua Gmail
                    </span>
                    {activePreviewData.email && (
                      <button
                        onClick={() => {
                          const activeItem = currentList.find(it => it.id === previewRecipientId);
                          if (activeItem) handleQuickSendGmail(activeItem);
                        }}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Mở soạn Gmail gửi ngay</span>
                      </button>
                    )}
                  </div>
                  <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                    <iframe
                      title="Email Preview"
                      srcDoc={activePreviewData.emailHtml}
                      className="w-full h-[620px] border-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-blue-600" /> Định dạng tin nhắn gửi Zalo
                    </span>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleCopyZaloText(activePreviewData.plainText)}
                        className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                      >
                        {copiedZaloText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedZaloText ? 'Đã sao chép!' : 'Sao chép văn bản'}</span>
                      </button>

                      {activePreviewData.phone && (
                        <button
                          onClick={() => {
                            const activeItem = currentList.find(it => it.id === previewRecipientId);
                            if (activeItem) {
                              handleQuickSendZalo(activeItem);
                            } else {
                              handleOpenZaloChat(activePreviewData.phone!, activePreviewData.plainText);
                            }
                          }}
                          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Mở Zalo & Dán (1-chạm)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <pre className="font-sans text-xs text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200 select-all">
                    {activePreviewData.plainText}
                  </pre>
                </div>
              )}
            </div>

            {/* Preview Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Giao diện hiển thị trực quan giống 100% người nhận thực tế.
              </span>
              <button
                onClick={() => setPreviewRecipientId(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Đóng xem trước
              </button>
            </div>

          </div>
        </div>
      )}

      {/* QUICK EDIT CONTACT MODAL */}
      {editingContact && (
        <div className="fixed inset-0 z-70 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-600" />
                Cập nhật liên hệ: {editingContact.name}
              </h3>
              <button
                onClick={() => setEditingContact(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Địa chỉ Email (Nhận TKB qua Gmail):
                </label>
                <input
                  type="email"
                  placeholder="vi_du@thpt.edu.vn"
                  value={editingContact.email}
                  onChange={e => setEditingContact({ ...editingContact, email: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Số điện thoại Zalo:
                </label>
                <input
                  type="tel"
                  placeholder="0912345678"
                  value={editingContact.phone}
                  onChange={e => setEditingContact({ ...editingContact, phone: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-[11px] text-blue-800">
                Thông tin được lưu tự động vào bộ nhớ ứng dụng và dùng để gửi thời khóa biểu cá nhân hóa.
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end space-x-2">
              <button
                onClick={() => setEditingContact(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveQuickContact}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 shadow-xs"
              >
                <Save className="w-3.5 h-3.5" />
                Lưu liên hệ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-80 max-w-md animate-in slide-in-from-bottom-5 duration-200">
          <div className={`p-4 rounded-xl shadow-2xl border flex items-start gap-3 ${
            toastMessage.type === 'success' ? 'bg-emerald-900 text-white border-emerald-700' :
            toastMessage.type === 'warning' ? 'bg-amber-900 text-white border-amber-700' :
            'bg-slate-900 text-white border-slate-700'
          }`}>
            {toastMessage.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
            {toastMessage.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
            {toastMessage.type === 'info' && <Mail className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />}
            <div className="text-xs leading-relaxed flex-1 font-medium">
              {toastMessage.text}
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-white/60 hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* UNCONFIGURED SERVER ALERT MODAL */}
      {unconfiguredAlert && (
        <div className="fixed inset-0 z-80 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-900">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <h3 className="font-bold text-sm">Chưa thiết lập máy chủ gửi tự động ngầm</h3>
              </div>
              <button
                onClick={() => setUnconfiguredAlert(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-amber-900 leading-relaxed">
                {unconfiguredAlert}
                <div className="mt-1.5 font-semibold text-slate-800">
                  Hệ thống cam kết tính xác thực: Không giả lập trạng thái "Thành công" khi chưa gửi thực tế.
                </div>
              </div>

              <div>
                <p className="font-bold text-slate-900 mb-2">Bạn có thể chọn 1 trong 3 cách gửi thực tế sau:</p>
                <ul className="space-y-2.5">
                  <li className="flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="font-bold text-blue-600 shrink-0">1.</span>
                    <div>
                      <strong className="text-slate-900">Gửi 1-chạm từng người:</strong> Bấm biểu tượng <strong className="text-blue-600">💬 Zalo</strong> (tự sao chép TKB & mở Zalo cá nhân) hoặc <strong className="text-emerald-600">✉️ Gmail</strong> (mở sẵn khung soạn thư có TKB điền sẵn).
                    </div>
                  </li>
                  <li className="flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="font-bold text-blue-600 shrink-0">2.</span>
                    <div>
                      <strong className="text-slate-900">Sao chép TKB hàng loạt:</strong> Bấm nút <strong>"Sao chép TKB đã chọn"</strong> ở chân trang để copy tất cả TKB vào Clipboard và dán vào nhóm Zalo chung của trường / hội đồng GV.
                    </div>
                  </li>
                  <li className="flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="font-bold text-blue-600 shrink-0">3.</span>
                    <div>
                      <strong className="text-slate-900">Cấu hình máy chủ tự động:</strong> Mở file <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px] font-mono">.env</code> và điền <code className="text-blue-700">SMTP_USER</code>, <code className="text-blue-700">SMTP_PASS</code> (Mật khẩu ứng dụng Gmail 16 ký tự).
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => {
                  setUnconfiguredAlert(null);
                  handleCopyAllSelected();
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Sao chép TKB đã chọn ngay
              </button>

              <button
                onClick={() => setUnconfiguredAlert(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                Đã hiểu & Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
