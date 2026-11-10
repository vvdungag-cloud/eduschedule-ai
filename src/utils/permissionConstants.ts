// Granular Permission Constants & Role Presets for EduSchedule AI

export const PERMISSION_CODES = {
  // Nhóm 1: Khai báo số tiết theo lớp
  DECLARATION_VIEW: 'DECLARATION_VIEW',
  DECLARATION_EDIT: 'DECLARATION_EDIT',
  DECLARATION_COPY_RESET: 'DECLARATION_COPY_RESET',
  DECLARATION_SAVE: 'DECLARATION_SAVE',

  // Nhóm 2: Bảng phân công chuyên môn
  ASSIGNMENT_VIEW: 'ASSIGNMENT_VIEW',
  ASSIGNMENT_ASSIGN: 'ASSIGNMENT_ASSIGN',
  ASSIGNMENT_AUTO_CLEAR: 'ASSIGNMENT_AUTO_CLEAR',
  ASSIGNMENT_SAVE: 'ASSIGNMENT_SAVE',

  // Nhóm 3: Xếp & Điều chỉnh Thời khóa biểu
  TIMETABLE_VIEW: 'TIMETABLE_VIEW',
  TIMETABLE_REQUEST_BUSY: 'TIMETABLE_REQUEST_BUSY',
  TIMETABLE_APPROVE_WISHES: 'TIMETABLE_APPROVE_WISHES',
  TIMETABLE_EDIT_GRID: 'TIMETABLE_EDIT_GRID',
  TIMETABLE_RUN_AI: 'TIMETABLE_RUN_AI',

  // Nhóm 4: Gửi phân công và TKB
  SEND_DOWNLOAD_PERSONAL: 'SEND_DOWNLOAD_PERSONAL',
  SEND_PUBLISH_SCHOOL: 'SEND_PUBLISH_SCHOOL',
  SEND_NOTIFY_ZALO_EMAIL: 'SEND_NOTIFY_ZALO_EMAIL',

  // Nhóm 5: Quản trị Danh mục & Hệ thống
  SETTINGS_MANAGE_CATALOG: 'SETTINGS_MANAGE_CATALOG',
  SETTINGS_MANAGE_SYSTEM: 'SETTINGS_MANAGE_SYSTEM',
} as const;

export type PermissionCode = typeof PERMISSION_CODES[keyof typeof PERMISSION_CODES];

export interface PermissionItem {
  code: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  id: string;
  title: string;
  shortTitle: string;
  iconName: string;
  color: string;
  permissions: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'declaration',
    title: 'Nhóm 1: Khai báo số tiết theo lớp',
    shortTitle: 'Khai báo số tiết',
    iconName: 'BookOpen',
    color: 'emerald',
    permissions: [
      {
        code: PERMISSION_CODES.DECLARATION_VIEW,
        label: 'Xem số tiết, số cặp, ràng buộc',
        description: 'Được quyền xem ma trận định mức số tiết các môn và các lớp.'
      },
      {
        code: PERMISSION_CODES.DECLARATION_EDIT,
        label: 'Chỉnh sửa số tiết, số cặp, ràng buộc',
        description: 'Thay đổi định mức số tiết/tuần, số cặp tiết liền nhau theo từng lớp.'
      },
      {
        code: PERMISSION_CODES.DECLARATION_COPY_RESET,
        label: 'Sao chép sang các lớp, Khôi phục mặc định',
        description: 'Nhân bản số tiết từ một lớp sang nhiều lớp hoặc hoàn tác mặc định chuẩn.'
      },
      {
        code: PERMISSION_CODES.DECLARATION_SAVE,
        label: 'Lưu cấu hình số tiết',
        description: 'Lưu thay đổi xuống bộ nhớ LocalStorage và đồng bộ Cloud Firestore.'
      }
    ]
  },
  {
    id: 'assignment',
    title: 'Nhóm 2: Bảng phân công chuyên môn',
    shortTitle: 'Phân công chuyên môn',
    iconName: 'Users',
    color: 'blue',
    permissions: [
      {
        code: PERMISSION_CODES.ASSIGNMENT_VIEW,
        label: 'Xem bảng phân công, tổng tiết giáo viên',
        description: 'Xem bảng ma trận phân công giáo viên giảng dạy từng môn từng lớp.'
      },
      {
        code: PERMISSION_CODES.ASSIGNMENT_ASSIGN,
        label: 'Phân công giáo viên (toàn trường hoặc trong tổ)',
        description: 'Chọn giáo viên đứng lớp, thay đổi phân công chuyên môn.'
      },
      {
        code: PERMISSION_CODES.ASSIGNMENT_AUTO_CLEAR,
        label: 'Chạy tự động phân công / Xóa phân công',
        description: 'Kích hoạt thuật toán tự động gán giáo viên hoặc xóa trắng phân công.'
      },
      {
        code: PERMISSION_CODES.ASSIGNMENT_SAVE,
        label: 'Lưu phân công chuyên môn',
        description: 'Lưu kết quả phân công lên đám mây và hệ thống.'
      }
    ]
  },
  {
    id: 'timetable',
    title: 'Nhóm 3: Xếp & Điều chỉnh Thời khóa biểu',
    shortTitle: 'Thời khóa biểu',
    iconName: 'Calendar',
    color: 'indigo',
    permissions: [
      {
        code: PERMISSION_CODES.TIMETABLE_VIEW,
        label: 'Xem lưới Thời khóa biểu toàn trường / lớp / giáo viên',
        description: 'Xem TKB theo từng lớp học, từng giáo viên và dạng tổng hợp.'
      },
      {
        code: PERMISSION_CODES.TIMETABLE_REQUEST_BUSY,
        label: 'Đăng ký lịch bận / Nguyện vọng cá nhân',
        description: 'Giáo viên tự đăng ký các buổi/tiết bận không thể giảng dạy.'
      },
      {
        code: PERMISSION_CODES.TIMETABLE_APPROVE_WISHES,
        label: 'Duyệt nguyện vọng lịch bận của giáo viên trong tổ',
        description: 'Tổ trưởng xem xét và phê duyệt các nguyện vọng lịch bận.'
      },
      {
        code: PERMISSION_CODES.TIMETABLE_EDIT_GRID,
        label: 'Kéo thả đổi tiết, chỉnh sửa TKB trực tiếp trên lưới',
        description: 'Thao tác tinh chỉnh thủ công, đổi tiết giáo viên trên lưới TKB.'
      },
      {
        code: PERMISSION_CODES.TIMETABLE_RUN_AI,
        label: 'Chạy thuật toán xếp TKB tự động (AI)',
        description: 'Khởi chạy giải thuật di truyền / backtracking xếp tự động toàn trường.'
      }
    ]
  },
  {
    id: 'send',
    title: 'Nhóm 4: Gửi phân công và TKB',
    shortTitle: 'Gửi phân công & TKB',
    iconName: 'Send',
    color: 'sky',
    permissions: [
      {
        code: PERMISSION_CODES.SEND_DOWNLOAD_PERSONAL,
        label: 'Tải bản TKB cá nhân / file PDF',
        description: 'Xuất file Excel hoặc in thời khóa biểu cá nhân của giáo viên.'
      },
      {
        code: PERMISSION_CODES.SEND_PUBLISH_SCHOOL,
        label: 'Công bố TKB chính thức toàn trường',
        description: 'Phê duyệt TKB chính thức áp dụng cho toàn thể giáo viên và học sinh.'
      },
      {
        code: PERMISSION_CODES.SEND_NOTIFY_ZALO_EMAIL,
        label: 'Gửi TKB qua Zalo / Email / Tin nhắn',
        description: 'Gửi tin nhắn thông báo TKB cá nhân đến từng thầy cô qua Gmail & Zalo.'
      }
    ]
  },
  {
    id: 'settings',
    title: 'Nhóm 5: Quản trị Danh mục & Hệ thống',
    shortTitle: 'Quản trị hệ thống',
    iconName: 'Settings',
    color: 'rose',
    permissions: [
      {
        code: PERMISSION_CODES.SETTINGS_MANAGE_CATALOG,
        label: 'Thêm / Sửa / Xóa danh mục Giáo viên, Lớp học, Phòng học',
        description: 'Quản lý thông tin hồ sơ cán bộ giáo viên, số lớp, tổ bộ môn.'
      },
      {
        code: PERMISSION_CODES.SETTINGS_MANAGE_SYSTEM,
        label: 'Quản trị phân quyền tài khoản & Cấu hình hệ thống',
        description: 'Tạo tài khoản, cấp quyền chi tiết, đổi mật khẩu và sao lưu hệ thống.'
      }
    ]
  }
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap(g => 
  g.permissions.map(p => p.code)
);

export const ROLE_PRESET_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ALL_PERMISSION_KEYS,
  HEAD_OF_DEPARTMENT: [
    PERMISSION_CODES.DECLARATION_VIEW,
    PERMISSION_CODES.ASSIGNMENT_VIEW,
    PERMISSION_CODES.ASSIGNMENT_ASSIGN,
    PERMISSION_CODES.TIMETABLE_VIEW,
    PERMISSION_CODES.TIMETABLE_REQUEST_BUSY,
    PERMISSION_CODES.TIMETABLE_APPROVE_WISHES,
    PERMISSION_CODES.SEND_DOWNLOAD_PERSONAL,
  ],
  TEACHER: [
    PERMISSION_CODES.DECLARATION_VIEW,
    PERMISSION_CODES.ASSIGNMENT_VIEW,
    PERMISSION_CODES.TIMETABLE_VIEW,
    PERMISSION_CODES.TIMETABLE_REQUEST_BUSY,
    PERMISSION_CODES.SEND_DOWNLOAD_PERSONAL,
  ],
  GUEST: [
    PERMISSION_CODES.DECLARATION_VIEW,
    PERMISSION_CODES.ASSIGNMENT_VIEW,
    PERMISSION_CODES.TIMETABLE_VIEW,
  ]
};

export const getRolePresetPermissions = (roleName: string): string[] => {
  const norm = String(roleName).toUpperCase().trim();
  if (norm === 'ADMIN') return ROLE_PRESET_PERMISSIONS.ADMIN;
  if (norm === 'HEAD_OF_DEPARTMENT' || norm === 'SUBADMIN' || norm === 'TOTRUONG') {
    return ROLE_PRESET_PERMISSIONS.HEAD_OF_DEPARTMENT;
  }
  if (norm === 'TEACHER' || norm === 'GIAOVIEN') {
    return ROLE_PRESET_PERMISSIONS.TEACHER;
  }
  return ROLE_PRESET_PERMISSIONS.GUEST;
};
