import React from 'react';

/**
 * LOGO CHUẨN MỚI: TRƯỜNG THPT NGUYỄN BỈNH KHIÊM (CHÂU THÀNH - AN GIANG)
 * Thiết kế chính thống: Huy hiệu tròn màu Xanh hoàng gia (Royal Blue) & Vàng kim loại cao cấp
 * Tuyệt đối không dùng nền/viền xanh lá cây cũ.
 * Chứa ngọn đuốc tri thức rực rỡ, cuốn sách mở, ngòi bút vàng và năm thành lập 1983.
 */
export const DEFAULT_SCHOOL_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
  <defs>
    <!-- Vòng tròn chữ trên -->
    <path id="upperArc" d="M 62,250 A 188,188 0 1,1 438,250" fill="none" />
    <!-- Vòng tròn chữ dưới -->
    <path id="lowerArc" d="M 438,250 A 188,188 0 0,1 62,250" fill="none" />
    
    <!-- Gradient Xanh Hoàng Gia (Royal Navy Blue) -->
    <linearGradient id="royalBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E3A8A" />
      <stop offset="50%" stop-color="#1E40AF" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>

    <!-- Gradient Vàng Ánh Kim (Pure Gold) -->
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047" />
      <stop offset="40%" stop-color="#F59E0B" />
      <stop offset="80%" stop-color="#D97706" />
      <stop offset="100%" stop-color="#B45309" />
    </linearGradient>

    <!-- Gradient Ngọn Lửa Tri Thức -->
    <linearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#DC2626" />
      <stop offset="50%" stop-color="#EA580C" />
      <stop offset="100%" stop-color="#FACC15" />
    </linearGradient>

    <!-- Gradient Mặt Trời Ban Mai -->
    <radialGradient id="sunGrad" cx="50%" cy="100%" r="100%">
      <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.95" />
      <stop offset="60%" stop-color="#FBBF24" stop-opacity="0.4" />
      <stop offset="100%" stop-color="#F59E0B" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- VÒNG NGOÀI CÙNG: VIỀN XANH HOÀNG GIA VÀ VIỀN CHỈ VÀNG -->
  <circle cx="250" cy="250" r="244" fill="url(#royalBlueGrad)" stroke="url(#goldGrad)" stroke-width="10" />
  <circle cx="250" cy="250" r="236" fill="none" stroke="#FDE047" stroke-width="2" stroke-dasharray="5,3" />

  <!-- VIỀN TRONG: NỀN TRẮNG TINH KHÔI CHO TÂM HUY HIỆU -->
  <circle cx="250" cy="250" r="148" fill="#FFFFFF" stroke="url(#goldGrad)" stroke-width="6" />

  <!-- DÒNG CHỮ TRÊN: TRƯỜNG THPT NGUYỄN BỈNH KHIÊM -->
  <text font-family="'Inter', 'Arial', sans-serif" font-size="24.5" font-weight="900" fill="#FFFFFF" letter-spacing="2.6">
    <textPath href="#upperArc" startOffset="50%" text-anchor="middle">
      TRƯỜNG THPT NGUYỄN BỈNH KHIÊM
    </textPath>
  </text>

  <!-- DÒNG CHỮ DƯỚI: CHÂU THÀNH — AN GIANG -->
  <text font-family="'Inter', 'Arial', sans-serif" font-size="23" font-weight="800" fill="#FDE047" letter-spacing="3.2">
    <textPath href="#lowerArc" startOffset="50%" text-anchor="middle">
      CHÂU THÀNH — AN GIANG
    </textPath>
  </text>

  <!-- HAI NGÔI SAO VÀNG PHÂN TÁCH HAI BÊN -->
  <g fill="#FDE047" stroke="#D97706" stroke-width="0.8">
    <!-- Sao trái -->
    <polygon points="56,250 61,240 71,240 63,247 66,257 58,251 50,257 53,247 45,240 55,240" transform="translate(6, -2)" />
    <!-- Sao phải -->
    <polygon points="444,250 449,240 459,240 451,247 454,257 446,251 438,257 441,247 433,240 443,240" transform="translate(-6, -2)" />
  </g>

  <!-- TRUNG TÂM HUY HIỆU (Bên trong r=145) -->
  <g id="centerEmblem">
    <clipPath id="centerClip">
      <circle cx="250" cy="250" r="144" />
    </clipPath>
    
    <g clip-path="url(#centerClip)">
      <!-- Nền mây trời / Hào quang tri thức -->
      <rect x="100" y="100" width="300" height="300" fill="#F8FAFC" />
      <circle cx="250" cy="265" r="130" fill="url(#sunGrad)" />

      <!-- Tia sáng mặt trời tri thức -->
      <g stroke="#F59E0B" stroke-width="2" opacity="0.6">
        <line x1="250" y1="250" x2="250" y2="120" />
        <line x1="250" y1="250" x2="200" y2="130" />
        <line x1="250" y1="250" x2="300" y2="130" />
        <line x1="250" y1="250" x2="160" y2="155" />
        <line x1="250" y1="250" x2="340" y2="155" />
        <line x1="250" y1="250" x2="130" y2="195" />
        <line x1="250" y1="250" x2="370" y2="195" />
      </g>

      <!-- Nửa vầng thái dương đỏ hồng -->
      <circle cx="250" cy="255" r="50" fill="#EF4444" opacity="0.9" />

      <!-- Ngọn đuốc tri thức vươn cao -->
      <!-- Thân đuốc xanh đậm kết hợp vàng -->
      <path d="M 242,240 L 258,240 L 254,295 L 246,295 Z" fill="#1E3A8A" stroke="#172554" stroke-width="2" />
      <rect x="238" y="235" width="24" height="6" rx="2" fill="url(#goldGrad)" />
      
      <!-- Ngọn lửa đuốc nghệ thuật 3 lớp -->
      <path d="M 250,148 C 235,178 230,205 238,235 C 248,235 253,220 256,220 C 260,220 264,228 270,235 C 278,215 275,190 262,175 C 265,190 258,200 254,198 C 250,185 258,165 250,148 Z" fill="url(#flameGrad)" />
      <path d="M 250,172 C 242,190 240,210 245,232 C 252,232 255,224 257,224 C 260,224 262,228 266,232 C 270,218 266,200 258,188 C 259,198 255,204 253,202 C 250,194 255,182 250,172 Z" fill="#FEF08A" />

      <!-- Bút chì và Ngòi bút máy hai bên -->
      <g transform="translate(-18, 10)">
        <path d="M 235,270 L 235,320 L 225,320 L 225,270 L 230,260 Z" fill="#FFFFFF" stroke="#1E3A8A" stroke-width="2" />
        <path d="M 228,272 L 232,272 L 232,318 L 228,318 Z" fill="#EF4444" />
      </g>
      <g transform="translate(18, 5)">
        <path d="M 265,270 C 265,255 275,248 275,248 C 275,248 285,255 285,270 L 285,320 L 265,320 Z" fill="#FFFFFF" stroke="#1E3A8A" stroke-width="2" />
        <circle cx="275" cy="275" r="3.5" fill="#1E3A8A" />
        <line x1="275" y1="278" x2="275" y2="300" stroke="#1E3A8A" stroke-width="2" />
      </g>

      <!-- CUỐN SÁCH MỞ RỘNG (Học vấn & Tri thức) -->
      <g id="openBook" transform="translate(0, 15)">
        <!-- Bìa sách xanh hoàng gia và viền vàng -->
        <path d="M 250,294 C 215,286 175,291 152,304 L 152,342 C 175,329 215,324 250,332 C 285,324 325,329 348,342 L 348,304 C 325,291 285,286 250,294 Z" fill="url(#goldGrad)" stroke="#92400E" stroke-width="2" />
        <!-- Các trang giấy trắng mở ra -->
        <path d="M 250,290 C 217,282 180,287 156,299 L 156,336 C 180,324 217,319 250,327 C 283,319 320,324 344,336 L 344,299 C 320,287 283,282 250,290 Z" fill="#FFFFFF" stroke="#1E3A8A" stroke-width="1.8" />
        <!-- Gáy sách trung tâm -->
        <line x1="250" y1="290" x2="250" y2="330" stroke="#1E3A8A" stroke-width="2.5" />
        <!-- Các dòng kẻ tượng trưng trên trang sách -->
        <line x1="175" y1="305" x2="235" y2="300" stroke="#93C5FD" stroke-width="2" stroke-linecap="round" />
        <line x1="175" y1="315" x2="235" y2="310" stroke="#93C5FD" stroke-width="2" stroke-linecap="round" />
        <line x1="265" y1="300" x2="325" y2="305" stroke="#93C5FD" stroke-width="2" stroke-linecap="round" />
        <line x1="265" y1="310" x2="325" y2="315" stroke="#93C5FD" stroke-width="2" stroke-linecap="round" />
      </g>

      <!-- DẢI BĂNG RÔN NĂM THÀNH LẬP 1983 -->
      <g id="yearBanner" transform="translate(0, 18)">
        <!-- Đuôi dải băng -->
        <path d="M 185,360 L 175,375 L 195,372 Z" fill="#B45309" />
        <path d="M 315,360 L 325,375 L 305,372 Z" fill="#B45309" />
        <!-- Thân dải băng đỏ thắm viền vàng -->
        <path d="M 185,350 Q 250,364 315,350 L 318,368 Q 250,384 182,368 Z" fill="#DC2626" stroke="#FDE047" stroke-width="2" />
        <text x="250" y="365" font-family="'Inter', 'Arial', sans-serif" font-size="14.5" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="3.5">
          1983
        </text>
      </g>
    </g>
  </g>
</svg>`;

export const LOGO_CACHE_VERSION = '3.0';
export const OFFICIAL_SCHOOL_LOGO_URL = `/logo_nbk.svg?v=${LOGO_CACHE_VERSION}`;

/**
 * Data URI dạng SVG mã hóa chuẩn để dùng trực tiếp cho thẻ <img src={DEFAULT_SCHOOL_LOGO_DATA_URI} />
 * Độc lập 100% với mạng/ổ đĩa, không bao giờ bị lỗi hiển thị hoặc bị cache cũ làm sai lệch.
 */
export const DEFAULT_SCHOOL_LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_SCHOOL_LOGO_SVG)}`;

/**
 * Lọc logo an toàn & cơ chế chống cache (Cache Busting):
 * - Loại bỏ hoàn toàn mọi tàn dư logo cũ:
 *   + Logo tròn viền vàng / xanh lá cũ (#greenBg / gold_green)
 *   + Logo Vĩnh Long / image_13.png / logo_nbk_wiki
 * - Tự động gắn query string cache busting (?v=3.0)
 * - Trả về LOGO MỚI CHUẨN của THPT Nguyễn Bỉnh Khiêm (Châu Thành - An Giang)
 */
export function getSafeSchoolLogo(customLogo?: string | null): string {
  if (!customLogo) {
    return OFFICIAL_SCHOOL_LOGO_URL;
  }
  
  // Kiểm tra chuỗi dữ liệu nhận dạng
  const lower = customLogo.toLowerCase().trim();
  if (
    lower.includes('vinh_long') || 
    lower.includes('vinh long') || 
    lower.includes('vĩnh long') ||
    lower.includes('image_13') ||
    lower === '/image_13.png' ||
    lower.includes('logo_nbk_wiki') ||
    lower.includes('gold_green') ||
    lower.includes('greenbg') ||
    lower.includes('16a34a') ||
    lower.includes('logo_nbk_an_giang_gold_green') ||
    lower === 'logo_nbk_an_giang_gold_green'
  ) {
    return OFFICIAL_SCHOOL_LOGO_URL;
  }

  // Nếu là Data URI base64 người dùng vừa tải lên hợp lệ
  if (customLogo.startsWith('data:image/')) {
    // Kiểm tra xem bên trong data URI có chứa chuỗi logo xanh lá cũ không
    if (lower.includes('greenbg') || lower.includes('gold_green') || lower.includes('vinh_long')) {
      return OFFICIAL_SCHOOL_LOGO_URL;
    }
    return customLogo;
  }

  // Nếu là đường dẫn URL, đảm bảo có đuôi chống cache trình duyệt
  if (customLogo.startsWith('http://') || customLogo.startsWith('https://') || customLogo.startsWith('/')) {
    if (!customLogo.includes('v=')) {
      const separator = customLogo.includes('?') ? '&' : '?';
      return `${customLogo}${separator}v=${LOGO_CACHE_VERSION}`;
    }
    return customLogo;
  }

  return OFFICIAL_SCHOOL_LOGO_URL;
}

interface SchoolLogoProps {
  className?: string;
  size?: number | string;
  alt?: string;
  customLogo?: string | null;
  style?: React.CSSProperties;
  title?: string;
  onClick?: () => void;
}

export const SchoolLogo: React.FC<SchoolLogoProps> = ({
  className = 'w-full h-full object-contain',
  alt = 'Logo Trường THPT Nguyễn Bỉnh Khiêm (An Giang)',
  customLogo,
  style,
  title,
  onClick
}) => {
  const safeSrc = getSafeSchoolLogo(customLogo);

  return (
    <img
      src={safeSrc}
      alt={alt}
      title={title}
      style={style}
      onClick={onClick}
      className={className}
      onError={(e) => {
        // Fallback tức thì về logo SVG mới chuẩn nếu bất kỳ sự cố mạng nào xảy ra
        if (e.currentTarget.src !== DEFAULT_SCHOOL_LOGO_DATA_URI) {
          e.currentTarget.src = DEFAULT_SCHOOL_LOGO_DATA_URI;
        }
      }}
    />
  );
};

export default SchoolLogo;
