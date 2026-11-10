#!/usr/bin/env python3
"""
EduAssign Timetable Solver using Google OR-Tools CP-SAT
KIẾN TRÚC 5 MODULE RÀNG BUỘC CỐ ĐỊNH (CHUẨN VIETSCHOOL & GDPT 2018):
  - MODULE 1: BẢO ĐẢM TỔNG SỐ TIẾT (100% TIẾT PHẢI ĐƯỢC XẾP - UNASSIGNED = 0)
  - MODULE 2: PHÂN BỔ BUỔI HỌC (CHÍNH KHÓA & TRÁI BUỔI)
  - MODULE 3: GIỚI HẠN TỐI ĐA SỐ TIẾT CỦA 1 MÔN TRONG 1 BUỔI (TRẦN SƯ PHẠM <= 2 TIẾT)
  - MODULE 4: RÀNG BUỘC TIẾT CẶP (TIẾT ĐÔI CÙNG MÔN & SIÊU KHỐI GDQPAN + GDĐP)
  - MODULE 5: TRÁNH TRÙNG LỊCH TUYỆT ĐỐI & RÀNG BUỘC KHÓA/HỌP/TÁCH BUỔI
"""

import sys
import json
import time
import math

def normalize_subject_name(name):
    if not name:
        return ""
    n = str(name).strip()
    nl = n.lower()
    if nl in ['toán', 'toán học', 'toan']:
        return 'Toán'
    if nl in ['ngữ văn', 'văn', 'van', 'ngu van']:
        return 'Văn'
    if nl in ['ngoại ngữ', 'tiếng anh', 'anh', 'tieng anh']:
        return 'Anh'
    if nl in ['vật lí', 'vật lý', 'lý', 'ly', 'vat ly', 'vat li']:
        return 'Lý'
    if nl in ['hóa học', 'hóa', 'hoa', 'hoa hoc']:
        return 'Hóa'
    if nl in ['sinh học', 'sinh', 'sinh hoc']:
        return 'Sinh'
    if nl in ['lịch sử', 'sử', 'su', 'lich su']:
        return 'Sử'
    if nl in ['địa lí', 'địa lý', 'địa', 'dia', 'dia ly', 'dia li']:
        return 'Địa'
    if nl in ['tin học', 'tin', 'tin hoc']:
        return 'Tin'
    if nl in ['công nghệ', 'cn', 'cncn', 'cn (công nghiệp)', 'cn (công nghệ)']:
        return 'CNCN'
    if nl in ['gdktpl', 'gdcd', 'gd', 'giáo dục kinh tế và pháp luật']:
        return 'GDKTPL'
    if nl in ['gdtc', 'thể dục', 'the duc', 'gd thể chất']:
        return 'GDTC'
    if nl in ['gdqpan', 'gd qp-an', 'gdqp', 'qpan', 'quân sự']:
        return 'GDQPAN'
    if nl in ['gdđp', 'gddp', 'giáo dục địa phương']:
        return 'GDĐP'
    if nl in ['tnhn1', 'hđtn1', 'hdtn1', 'tnhn']:
        return 'TNHN1'
    if nl in ['tnhn2', 'hđtn2', 'hdtn2']:
        return 'TNHN2'
    if nl in ['chào cờ', 'cc', 'chao co']:
        return 'Chào cờ'
    if nl in ['sinh hoạt lớp', 'shl', 'sinh hoat lop', 'sinh hoạt']:
        return 'Sinh hoạt lớp'
    return n

def is_sub_in_filter(norm_name, raw_name, norm_set, raw_set):
    if not norm_set and not raw_set:
        return False
    if norm_name in norm_set:
        return True
    r = str(raw_name).strip().lower()
    if r in raw_set:
        return True
    for s in raw_set:
        if s and (s == r or s in r or r in s):
            return True
    return False

# =============================================================================
# MODULE 1 - BẢO ĐẢM TỔNG SỐ TIẾT (100% TIẾT PHẢI ĐƯỢC XẾP):
# - Mọi tiết học đã khai báo cho mỗi lớp BẮT BUỘC phải được gán vào đúng 1 ô (slot).
# - Tổng số tiết chưa xếp (unassigned) bắt buộc = 0.
# =============================================================================
def apply_module_1_ensure_total_periods(model, items, super_blocks, x, block_x, days, periods):
    """
    MODULE 1: Bảo đảm 100% tiết đã khai báo được gán chính xác vào thời khóa biểu.
    - Với mỗi item: sum(x) == item["periods"]
    - Với mỗi Super Block (GDQPAN + GDĐP): sum(block_x) == 1
    """
    for i_idx, item in enumerate(items):
        vars_for_item = [
            x[(i_idx, d, p)]
            for d in days for p in periods
            if (i_idx, d, p) in x
        ]
        # RÀNG BUỘC CỨNG TUYỆT ĐỐI: 100% tiết được xếp, unassigned = 0
        model.Add(sum(vars_for_item) == item["periods"])

    for b_idx, block in enumerate(super_blocks):
        block_slots = [
            block_x[(b_idx, d, t)]
            for (b, d, t) in block_x
            if b == b_idx
        ]
        if block_slots:
            # Khối liên môn (Block_GDQP_GDDP) BẮT BUỘC xuất hiện đúng 1 lần trong tuần
            model.Add(sum(block_slots) == 1)

# =============================================================================
# MODULE 2 - PHÂN BỔ BUỔI HỌC (CHÍNH KHÓA & TRÁI BUỔI):
# - Đọc thuộc tính buoiHoc từ Khai báo số tiết:
#   + Môn chính khóa: Lớp sáng học sáng, lớp chiều học chiều.
#   + Môn trái buổi (GDTC, cặp GDQPAN + GDĐP, môn tăng cường...):
#     * Khối 10 (chính khóa Chiều): BẮT BUỘC chỉ được xếp vào Buổi Sáng.
#     * Khối 11, 12 (chính khóa Sáng): BẮT BUỘC chỉ được xếp vào Buổi Chiều.
#   + TUYỆT ĐỐI KHÔNG xếp môn trái buổi lấn sang buổi chính khóa và ngược lại.
# =============================================================================
def apply_module_2_session_allocation(model, items, super_blocks, x, block_x, days, periods, class_shifts, class_grade_dict):
    """
    MODULE 2: Phân bổ đúng buổi học theo phân ca:
    - Khối 10: Chính Chiều (Tiết 6..10), Trái Sáng (Tiết 1..5).
    - Khối 11 & 12: Chính Sáng (Tiết 1..5), Trái Chiều (Tiết 6..10).
    - Cấm tuyệt đối lấn ca giữa môn chính khóa và môn trái buổi.
    """
    for (i_idx, d, p), var in x.items():
        item = items[i_idx]
        cid = item["class_id"]
        c_grade = class_grade_dict.get(cid, "")
        default_shift = "afternoon_main" if c_grade == "10" else "morning_main"
        raw_shift = class_shifts.get(cid, default_shift)
        shift = "afternoon_main" if (raw_shift in ["afternoon_main", "afternoon"] or c_grade == "10") else "morning_main"
        target_session = item.get("target_session")

        if target_session == "main":
            main_is_morning = (shift == "morning_main")
            if main_is_morning and p >= 6:
                model.Add(var == 0)
            elif (not main_is_morning) and p <= 5:
                model.Add(var == 0)
        elif target_session == "opp":
            opp_is_afternoon = (shift == "morning_main")
            if opp_is_afternoon and p <= 5:
                model.Add(var == 0)
            elif (not opp_is_afternoon) and p >= 6:
                model.Add(var == 0)

    for (b_idx, d, t), var in block_x.items():
        block = super_blocks[b_idx]
        cid = block["class_id"]
        c_grade = class_grade_dict.get(cid, "")
        default_shift = "afternoon_main" if c_grade == "10" else "morning_main"
        raw_shift = class_shifts.get(cid, default_shift)
        shift = "afternoon_main" if (raw_shift in ["afternoon_main", "afternoon"] or c_grade == "10") else "morning_main"

        if shift == "morning_main":
            # Khối 11, 12: Chính Sáng -> Block GDQPAN+GDĐP trái buổi BẮT BUỘC học Chiều (t >= 6)
            if t <= 5 or (t + 1) <= 5:
                model.Add(var == 0)
        else:
            # Khối 10: Chính Chiều -> Block GDQPAN+GDĐP trái buổi BẮT BUỘC học Sáng (t in 1..4)
            if t >= 6 or (t + 1) >= 6:
                model.Add(var == 0)

# =============================================================================
# MODULE 3 - GIỚI HẠN TỐI ĐA SỐ TIẾT CỦA 1 MÔN TRONG 1 BUỔI (TRẦN SƯ PHẠM <= 2 TIẾT):
# - Với MỌI môn học văn hóa (Toán, Văn, Anh, Lý, Hóa, Sinh, Sử, Địa, Tin, GDKTPL, Công nghệ...):
#   Số tiết của môn trong 1 buổi <= 2 tiết.
# - Nghiêm cấm 3 hoặc 4 tiết cùng môn trong 1 buổi.
# =============================================================================
def apply_module_3_max_periods_per_session(model, items, super_blocks, x, block_x, days, periods, class_list, fixed_lessons):
    """
    MODULE 3: Giới hạn tối đa số tiết của 1 môn trong 1 buổi (Trần sư phạm <= 2 tiết).
    Tuyệt đối cấm tình trạng 3 hoặc 4 tiết cùng một môn văn hóa trong 1 buổi sáng hoặc chiều.
    """
    for cid in class_list:
        c_items_by_sub = {}
        for idx, item in enumerate(items):
            if item["class_id"] == cid:
                sub = item["norm_subject"]
                if sub not in c_items_by_sub:
                    c_items_by_sub[sub] = []
                c_items_by_sub[sub].append(idx)

        c_blocks = [(b_idx, b) for b_idx, b in enumerate(super_blocks) if b["class_id"] == cid]
        all_subs = set(c_items_by_sub.keys())
        for _, b in c_blocks:
            all_subs.add(b["norm_subject1"])
            all_subs.add(b["norm_subject2"])

        for norm_s in all_subs:
            idxs = c_items_by_sub.get(norm_s, [])

            for d in days:
                # 1. BUỔI SÁNG (Tiết 1 đến 5):
                m_item_vars = [x[(idx, d, p)] for idx in idxs for p in [1, 2, 3, 4, 5] if (idx, d, p) in x]
                for b_idx, b in c_blocks:
                    for t in [1, 2, 3, 4]:
                        if (b_idx, d, t) in block_x:
                            if b["norm_subject1"] == norm_s:
                                m_item_vars.append(block_x[(b_idx, d, t)])
                            if b["norm_subject2"] == norm_s and (t + 1) <= 5:
                                m_item_vars.append(block_x[(b_idx, d, t)])

                m_fixed = sum(1 for fl in fixed_lessons if fl["classId"] == cid and fl["day"] == d and fl["period"] <= 5 and normalize_subject_name(fl["subject"]) == norm_s)
                if m_item_vars:
                    # TRẦN SƯ PHẠM: Tối đa 2 tiết trong một buổi sáng (CẤM 3 hoặc 4 tiết)
                    model.Add(sum(m_item_vars) + m_fixed <= 2)

                # 2. BUỔI CHIỀU (Tiết 6 đến 10):
                a_item_vars = [x[(idx, d, p)] for idx in idxs for p in [6, 7, 8, 9, 10] if (idx, d, p) in x]
                for b_idx, b in c_blocks:
                    for t in [6, 7, 8, 9]:
                        if (b_idx, d, t) in block_x:
                            if b["norm_subject1"] == norm_s:
                                a_item_vars.append(block_x[(b_idx, d, t)])
                            if b["norm_subject2"] == norm_s and (t + 1) <= 10:
                                a_item_vars.append(block_x[(b_idx, d, t)])

                a_fixed = sum(1 for fl in fixed_lessons if fl["classId"] == cid and fl["day"] == d and fl["period"] >= 6 and normalize_subject_name(fl["subject"]) == norm_s)
                if a_item_vars:
                    # TRẦN SƯ PHẠM: Tối đa 2 tiết trong một buổi chiều (CẤM 3 hoặc 4 tiết)
                    model.Add(sum(a_item_vars) + a_fixed <= 2)

# =============================================================================
# MODULE 4 - RÀNG BUỘC TIẾT CẶP:
# - Tiết cặp cùng môn phải ở 2 tiết liền nhau t và t+1 trong cùng 1 buổi.
# - Cặp liên môn GDQPAN + GDĐP bắt buộc ghép thành khối 2 tiết liền nhau trong cùng 1 buổi trái buổi, không tách sang 2 ngày.
# =============================================================================
def apply_module_4_paired_and_super_blocks(model, items, super_blocks, x, block_x, days, periods,
                                           lesson_consecutive_subs, lesson_consecutive_subs_raw,
                                           lesson_consecutive_pairs, lesson_same_session_subs,
                                           lesson_same_session_subs_raw, lesson_not_same_session_subs,
                                           lesson_not_same_session_subs_raw, lesson_double_no_span_recess,
                                           has_afternoon_needed, class_list):
    """
    MODULE 4: Tiết cặp và Siêu khối liên môn:
    - Tiết cặp cùng môn phải ở 2 tiết liền nhau (t, t+1) không vắt qua giờ nghỉ trưa.
    - Cặp liên môn GDQPAN + GDĐP ghép thành khối 2 tiết liền nhau trong cùng buổi trái buổi.
    """
    if lesson_double_no_span_recess:
        valid_pair_starts = [1, 3, 4]
        if has_afternoon_needed:
            valid_pair_starts += [6, 8, 9]
    else:
        valid_pair_starts = [1, 2, 3, 4]
        if has_afternoon_needed:
            valid_pair_starts += [6 + i for i in range(len(periods) - 5 - 1)]

    pair_bonuses = []
    two_period_pair_bonuses = []
    deficit_penalties = []
    for i_idx, item in enumerate(items):
        min_pairs = item.get("min_pairs", 0)
        item_pair_vars = []
        is_2p_sub = (item["periods"] == 2)
        if item["periods"] >= 2:
            for d in days:
                for p in valid_pair_starts:
                    if (i_idx, d, p) in x and (i_idx, d, p + 1) in x:
                        pair_var = model.NewBoolVar(f"pair_{i_idx}_{d}_{p}")
                        model.Add(pair_var <= x[(i_idx, d, p)])
                        model.Add(pair_var <= x[(i_idx, d, p + 1)])
                        pair_bonuses.append(pair_var)
                        item_pair_vars.append(pair_var)
                        if is_2p_sub:
                            two_period_pair_bonuses.append(pair_var)

            if min_pairs > 0 and len(item_pair_vars) > 0:
                deficit_var = model.NewIntVar(0, min_pairs, f"pair_deficit_{i_idx}")
                model.Add(sum(item_pair_vars) + deficit_var >= min_pairs)
                deficit_penalties.append(deficit_var)

    # Ràng buộc tiết liền nhau cho môn có quy định (lesson_consecutive_subs)
    items_by_class_subject = {}
    for i_idx, item in enumerate(items):
        cs_key = (item["class_id"], item["norm_subject"])
        if cs_key not in items_by_class_subject:
            items_by_class_subject[cs_key] = []
        items_by_class_subject[cs_key].append(i_idx)

    for (cid, norm_s), item_indices in items_by_class_subject.items():
        first_item = items[item_indices[0]]
        raw_s = first_item["subject"]
        if is_sub_in_filter(norm_s, raw_s, lesson_consecutive_subs, lesson_consecutive_subs_raw):
            for d in days:
                for sess_periods in [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]:
                    for p_idx in range(len(sess_periods) - 2):
                        p_curr = sess_periods[p_idx]
                        p_next = sess_periods[p_idx + 1]
                        curr_vars = [x[(idx, d, p_curr)] for idx in item_indices if (idx, d, p_curr) in x]
                        next_vars = [x[(idx, d, p_next)] for idx in item_indices if (idx, d, p_next) in x]
                        if curr_vars and next_vars:
                            curr_v = curr_vars[0]
                            next_v = next_vars[0]
                            for k_idx in range(p_idx + 2, len(sess_periods)):
                                p_k = sess_periods[k_idx]
                                k_vars = [x[(idx, d, p_k)] for idx in item_indices if (idx, d, p_k) in x]
                                if k_vars:
                                    model.Add(curr_v - next_v + k_vars[0] <= 1)

    # GDTC 2 tiết học 1 buổi và liền nhau
    for cid in class_list:
        gdtc_indices = items_by_class_subject.get((cid, "GDTC"), [])
        if gdtc_indices:
            gdtc_total = sum(items[idx]["periods"] for idx in gdtc_indices)
            if gdtc_total == 2:
                gdtc_sess_presences = []
                for d in days:
                    for sess_name, sess_periods in [("m", [1, 2, 3, 4, 5]), ("a", [6, 7, 8, 9, 10])]:
                        g_vars = [x[(idx, d, p)] for idx in gdtc_indices for p in sess_periods if (idx, d, p) in x]
                        if g_vars:
                            has_g = model.NewBoolVar(f"gdtc_sess_{cid}_{d}_{sess_name}")
                            model.Add(sum(g_vars) <= len(g_vars) * has_g)
                            gdtc_sess_presences.append(has_g)
                            for p in sess_periods:
                                p_vars = [x[(idx, d, p)] for idx in gdtc_indices if (idx, d, p) in x]
                                if p_vars:
                                    adj_p = [ap for ap in [p - 1, p + 1] if ap in sess_periods]
                                    adj_vars = [x[(idx, d, ap)] for idx in gdtc_indices for ap in adj_p if (idx, d, ap) in x]
                                    if adj_vars:
                                        model.Add(sum(p_vars) <= sum(adj_vars))
                if gdtc_sess_presences:
                    model.Add(sum(gdtc_sess_presences) <= 1)

    return pair_bonuses, two_period_pair_bonuses, deficit_penalties

# =============================================================================
# MODULE 5 - TRÁNH TRÙNG LỊCH TUYỆT ĐỐI & RÀNG BUỘC PHÒNG/KHÓA/HỌP:
# - 1 GV dạy tối đa 1 lớp/tiết.
# - 1 lớp học tối đa 1 môn/tiết.
# - Tôn trọng ô khóa cứng Chào cờ/Sinh hoạt/khóa tùy biến.
# - Họp tổ chuyên môn / sinh hoạt hội đồng.
# - Tách buổi GDTC với GDQPAN + GDĐP.
# =============================================================================
def apply_module_5_conflict_free_and_special_rules(model, items, super_blocks, x, block_x,
                                                   days, periods, class_list, teachers,
                                                   fixed_lessons, fixed_teacher_slots,
                                                   teacher_constraints_input, advanced_constraints,
                                                   active_meeting_rules, lesson_not_same_session_pairs,
                                                   teacher_meeting_blocked_slots,
                                                   max_sessions_input=None, max_days_input=None):
    """
    MODULE 5: Tránh trùng lịch tuyệt đối và các ràng buộc đặc thù:
    - Trùng lịch lớp: tối đa 1 tiết/slot.
    - Trùng lịch giáo viên: tối đa 1 lớp/slot.
    - Khóa lịch cố định & Sinh hoạt tổ chuyên môn.
    - Tách buổi GDTC với GDQPAN + GDĐP (không học chung buổi).
    """
    all_tids = set(t["id"] for t in teachers)

    # 1. Class conflict - at most 1 lesson per slot (Hard Constraint)
    for cid in class_list:
        class_item_indices = [idx for idx, item in enumerate(items) if item["class_id"] == cid]
        class_block_indices = [b_idx for b_idx, block in enumerate(super_blocks) if block["class_id"] == cid]
        for d in days:
            for p in periods:
                slot_vars = [
                    x[(idx, d, p)]
                    for idx in class_item_indices
                    if (idx, d, p) in x
                ]
                for b_idx in class_block_indices:
                    if (b_idx, d, p) in block_x:
                        slot_vars.append(block_x[(b_idx, d, p)])
                    if (b_idx, d, p - 1) in block_x:
                        slot_vars.append(block_x[(b_idx, d, p - 1)])
                if slot_vars:
                    model.Add(sum(slot_vars) <= 1)

    # 2. Teacher conflict - at most 1 lesson per slot across all classes (Hard Constraint)
    for tid in all_tids:
        t_item_indices = [idx for idx, item in enumerate(items) if item["teacher_id"] == tid]
        t1_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id1"] == tid]
        t2_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id2"] == tid]

        for d in days:
            for p in periods:
                is_fixed_busy = (d, p) in fixed_teacher_slots.get(tid, set())
                slot_vars = [
                    x[(idx, d, p)]
                    for idx in t_item_indices
                    if (idx, d, p) in x
                ]
                for b_idx in t1_blocks:
                    if (b_idx, d, p) in block_x:
                        slot_vars.append(block_x[(b_idx, d, p)])
                for b_idx in t2_blocks:
                    if (b_idx, d, p - 1) in block_x:
                        slot_vars.append(block_x[(b_idx, d, p - 1)])

                if slot_vars:
                    if is_fixed_busy:
                        model.Add(sum(slot_vars) == 0)
                    else:
                        model.Add(sum(slot_vars) <= 1)

    # 3. Teacher Meeting Day / Sinh hoạt tổ chuyên môn
    for tid in all_tids:
        t_item_indices = [idx for idx, item in enumerate(items) if item["teacher_id"] == tid]
        for (b_tid, b_d, b_p) in teacher_meeting_blocked_slots:
            if b_tid == tid:
                slot_vars = [x[(idx, b_d, b_p)] for idx in t_item_indices if (idx, b_d, b_p) in x]
                for sv in slot_vars:
                    model.Add(sv == 0)

    # 4. Tách buổi GDTC với (GDQPAN + GDĐP) - Disjoint session constraint
    items_by_class_subject = {}
    for i_idx, item in enumerate(items):
        cs_key = (item["class_id"], item["norm_subject"])
        if cs_key not in items_by_class_subject:
            items_by_class_subject[cs_key] = []
        items_by_class_subject[cs_key].append(i_idx)

    for cid in class_list:
        c_blocks = [(b_idx, b) for b_idx, b in enumerate(super_blocks) if b["class_id"] == cid]
        for sA, sB in lesson_not_same_session_pairs:
            idxA_list = items_by_class_subject.get((cid, sA), [])
            idxB_list = items_by_class_subject.get((cid, sB), [])

            for d in days:
                for sess_name, sess_periods in [("m", [1, 2, 3, 4, 5]), ("a", [6, 7, 8, 9, 10])]:
                    varsA = [x[(idx, d, p)] for idx in idxA_list for p in sess_periods if (idx, d, p) in x]
                    varsB = [x[(idx, d, p)] for idx in idxB_list for p in sess_periods if (idx, d, p) in x]

                    for b_idx, b in c_blocks:
                        for t in (sess_periods[:-1]):
                            if (b_idx, d, t) in block_x:
                                if b["norm_subject1"] == sA or b["norm_subject2"] == sA:
                                    varsA.append(block_x[(b_idx, d, t)])
                                if b["norm_subject1"] == sB or b["norm_subject2"] == sB:
                                    varsB.append(block_x[(b_idx, d, t)])

                    if not varsA or not varsB:
                        continue

                    has_A = model.NewBoolVar(f"disjoint_A_{cid}_{sA}_{sB}_{d}_{sess_name}")
                    has_B = model.NewBoolVar(f"disjoint_B_{cid}_{sA}_{sB}_{d}_{sess_name}")
                    model.Add(sum(varsA) <= 5 * has_A)
                    model.Add(sum(varsB) <= 5 * has_B)
                    model.Add(has_A + has_B <= 1)

    # 5. RÀNG BUỘC MỀM (SOFT CONSTRAINTS): Số buổi dạy tối đa của GV & Số ngày dạy tối đa
    teacher_session_penalties = []
    teacher_day_penalties = []

    def get_teacher_max_sessions(teacher_obj):
        t_id = str(teacher_obj.get("id", "")).strip()
        t_name = str(teacher_obj.get("name", "")).strip()
        clean_id = t_id.replace("t_", "")
        prefixed_id = f"t_{clean_id}"

        if max_sessions_input and isinstance(max_sessions_input, dict):
            for k in [t_id, clean_id, prefixed_id, t_name]:
                if k in max_sessions_input:
                    val = max_sessions_input[k]
                    if val not in (None, "", "Không giới hạn", "none"):
                        try:
                            v = int(val)
                            if v > 0:
                                return v
                        except (ValueError, TypeError):
                            pass

        if teacher_constraints_input and isinstance(teacher_constraints_input, dict):
            for k in [t_id, clean_id, prefixed_id, t_name]:
                if k in teacher_constraints_input:
                    conf = teacher_constraints_input[k]
                    if isinstance(conf, dict):
                        val = conf.get("maxSessions")
                        if val not in (None, "", "Không giới hạn", "none"):
                            try:
                                v = int(val)
                                if v > 0:
                                    return v
                            except (ValueError, TypeError):
                                pass
        return None

    def get_teacher_max_days(teacher_obj):
        t_id = str(teacher_obj.get("id", "")).strip()
        t_name = str(teacher_obj.get("name", "")).strip()
        clean_id = t_id.replace("t_", "")
        prefixed_id = f"t_{clean_id}"

        if max_days_input and isinstance(max_days_input, dict):
            for k in [t_id, clean_id, prefixed_id, t_name]:
                if k in max_days_input:
                    val = max_days_input[k]
                    if val not in (None, "", "Không giới hạn", "none"):
                        try:
                            v = int(val)
                            if v > 0:
                                return v
                        except (ValueError, TypeError):
                            pass

        if teacher_constraints_input and isinstance(teacher_constraints_input, dict):
            for k in [t_id, clean_id, prefixed_id, t_name]:
                if k in teacher_constraints_input:
                    conf = teacher_constraints_input[k]
                    if isinstance(conf, dict):
                        val = conf.get("maxDays")
                        if val not in (None, "", "Không giới hạn", "none"):
                            try:
                                v = int(val)
                                if v > 0:
                                    return v
                            except (ValueError, TypeError):
                                pass
        return None

    session_defs = [
        ("m", [p for p in periods if p <= 5]),
        ("a", [p for p in periods if p >= 6])
    ]
    valid_sessions = [(sn, sp) for sn, sp in session_defs if len(sp) > 0]

    all_teacher_session_vars = []
    teacher_session_penalties = []
    teacher_day_penalties = []
    excess_sessions_penalties = []

    # Duyệt qua TẤT CẢ giáo viên để tự động gom tiết vào số buổi ít nhất có thể (giảm số lần di chuyển)
    for t in teachers:
        tid = t["id"]
        t_item_indices = [idx for idx, item in enumerate(items) if item["teacher_id"] == tid]
        t1_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id1"] == tid]
        t2_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id2"] == tid]
        has_any_fixed = tid in fixed_teacher_slots

        # Nếu giáo viên không có phân công dạy hay ô khóa nào, bỏ qua để tối ưu hóa bộ nhớ
        if not t_item_indices and not t1_blocks and not t2_blocks and not has_any_fixed:
            continue

        total_p = (
            sum(items[idx]["periods"] for idx in t_item_indices) +
            len(t1_blocks) +
            len(t2_blocks) +
            len(fixed_teacher_slots.get(tid, set()))
        )

        # 1. Xác định số buổi dạy mục tiêu theo định mức tiết (TargetSessions):
        # - TotalPeriods <= 6 tiết: Mục tiêu tối đa 1 - 2 buổi
        # - TotalPeriods <= 12 tiết: Mục tiêu tối đa 2 - 3 buổi
        # - TotalPeriods <= 18 tiết: Mục tiêu tối đa 3 - 4 buổi
        # - TargetSessions = ceil(TotalPeriods / 3.5)
        if total_p <= 0:
            target_sess = 0
        elif total_p <= 6:
            target_sess = min(2, max(1, math.ceil(total_p / 3.5)))
        elif total_p <= 12:
            if total_p <= 10:
                target_sess = min(3, max(2, math.ceil(total_p / 3.5)))
            else:
                target_sess = min(4, max(3, math.ceil(total_p / 3.5)))
        elif total_p <= 18:
            if total_p <= 14:
                target_sess = min(4, max(3, math.ceil(total_p / 3.5)))
            else:
                target_sess = min(5, max(4, math.ceil(total_p / 3.5)))
        else:
            target_sess = max(1, math.ceil(total_p / 3.5))

        max_sess = get_teacher_max_sessions(t)
        max_days = get_teacher_max_days(t)

        teacher_session_vars = []
        teacher_day_vars = []

        for d in days:
            day_session_vars = []
            for s_name, s_periods in valid_sessions:
                slot_vars = []
                for p in s_periods:
                    for idx in t_item_indices:
                        if (idx, d, p) in x:
                            slot_vars.append(x[(idx, d, p)])
                    for b_idx in t1_blocks:
                        if (b_idx, d, p) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p)])
                    for b_idx in t2_blocks:
                        if (b_idx, d, p - 1) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p - 1)])

                has_fixed_in_sess = any((d, p) in fixed_teacher_slots.get(tid, set()) for p in s_periods)

                if has_fixed_in_sess:
                    has_sess_var = model.NewConstant(1)
                    all_teacher_session_vars.append(has_sess_var)
                elif not slot_vars:
                    has_sess_var = model.NewConstant(0)
                else:
                    has_sess_var = model.NewBoolVar(f"has_session_{tid}_{d}_{s_name}")
                    model.AddMaxEquality(has_sess_var, slot_vars)
                    all_teacher_session_vars.append(has_sess_var)

                teacher_session_vars.append(has_sess_var)
                day_session_vars.append(has_sess_var)

            # Ràng buộc ngày dạy (chỉ áp dụng nếu có cấu hình maxDays cụ thể > 0)
            if max_days is not None:
                has_day_var = model.NewBoolVar(f"has_day_{tid}_{d}")
                if not day_session_vars:
                    model.Add(has_day_var == 0)
                else:
                    model.AddMaxEquality(has_day_var, day_session_vars)
                teacher_day_vars.append(has_day_var)

        # RÀNG BUỘC MỀM (SOFT CONSTRAINTS): Phạt dôi dư buổi so với mục tiêu TargetSessions
        if target_sess > 0 and teacher_session_vars:
            excess_target = model.NewIntVar(0, len(teacher_session_vars), f"excess_target_{tid}")
            model.Add(excess_target >= sum(teacher_session_vars) - target_sess)
            excess_sessions_penalties.append(excess_target)

        # RÀNG BUỘC MỀM (SOFT CONSTRAINTS): Phạt điểm nếu vượt số buổi giới hạn riêng do Admin đặt
        if max_sess is not None and teacher_session_vars:
            excess_sess = model.NewIntVar(0, len(teacher_session_vars), f"excess_sess_{tid}")
            model.Add(excess_sess >= sum(teacher_session_vars) - max_sess)
            teacher_session_penalties.append(excess_sess)

        # RÀNG BUỘC MỀM (SOFT CONSTRAINTS): Phạt điểm nếu vượt số ngày giới hạn riêng
        if max_days is not None and teacher_day_vars:
            excess_day = model.NewIntVar(0, len(teacher_day_vars), f"excess_day_{tid}")
            model.Add(excess_day >= sum(teacher_day_vars) - max_days)
            teacher_day_penalties.append(excess_day)

    return teacher_session_penalties, teacher_day_penalties, all_teacher_session_vars, excess_sessions_penalties

def solve():
    try:
        input_data = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse input JSON: {str(e)}"}))
        return

    teachers = input_data.get("teachers", [])
    classes = input_data.get("classes", [])
    assignments = input_data.get("assignments", {})
    subject_requirements = input_data.get("subjectRequirements", [])
    fixed_config = input_data.get("fixedConfig", {
        "chaoCoDay": 2,
        "chaoCoPeriod": 1,
        "sinhHoatDay": 7,
        "sinhHoatPeriod": 5
    })
    locked_slots = input_data.get("lockedSlots", {})
    raw_locked_by_class = locked_slots.get("byClass", {})
    locked_by_teacher = locked_slots.get("byTeacher", {})
    raw_locked_by_grade = locked_slots.get("byGrade", {})
    raw_locked_global = set(locked_slots.get("global", []))
    raw_class_break_exceptions = locked_slots.get("classBreakExceptions", {})

    # MỞ LẠI NGÀY THỨ 2 TRONG TẬP HỢP CÁC NGÀY XẾP LỊCH:
    # Thứ 2 là ngày học bình thường, chỉ khóa duy nhất Tiết 1 Chào cờ nếu có (2_1).
    # Tuyệt đối không để sót bất kỳ khóa nào trên các tiết 2..10 của ngày Thứ 2 đối với học sinh/lớp.
    locked_global = {k for k in raw_locked_global if not (k.startswith("2_") and k != "2_1")}
    locked_by_grade = {
        g: [k for k in slots if not (k.startswith("2_") and k != "2_1")]
        for g, slots in raw_locked_by_grade.items()
    }
    locked_by_class = {
        c: [k for k in slots if not (k.startswith("2_") and k != "2_1")]
        for c, slots in raw_locked_by_class.items()
    }
    class_break_exceptions = {
        c: [k for k in slots if not (k.startswith("2_") and k != "2_1")]
        for c, slots in raw_class_break_exceptions.items()
    }

    custom_fixed_slots_input = input_data.get("customFixedSlots", [])
    teacher_constraints_input = input_data.get("teacherConstraints", {})
    max_sessions_input = input_data.get("maxSessionsPerTeacher", {}) or input_data.get("teacherMaxHalfDays", {})
    max_days_input = input_data.get("maxDaysPerTeacher", {})
    advanced_constraints = input_data.get("advancedConstraints", {})
    
    # Extract advanced constraint values
    teacher_only_one_session = advanced_constraints.get("teacherOnlyOneSession", False)
    teacher_max_consecutive = int(advanced_constraints.get("teacherMaxConsecutive", 3))
    teacher_max_gaps = int(advanced_constraints.get("teacherMaxGaps", 2))
    teacher_min_periods = int(advanced_constraints.get("teacherMinPeriodsPerSession", 1))
    teacher_no_first_period = advanced_constraints.get("teacherNoFirstPeriod", False)
    teacher_meeting_day = int(advanced_constraints.get("teacherMeetingDay", 0))
    teacher_meeting_session = advanced_constraints.get("teacherMeetingSession", "all")
    teacher_meeting_subject = str(advanced_constraints.get("teacherMeetingSubject", "")).strip()
    teacher_meeting_rules = advanced_constraints.get("teacherMeetingRules", [])
    
    lesson_double_no_span_recess = advanced_constraints.get("lessonDoubleNoSpanRecess", True)
    lesson_spacing_days = advanced_constraints.get("lessonSpacingDays", True)
    lesson_ends_only_raw = advanced_constraints.get("lessonEndsOnly", [])
    lesson_starts_only_raw = advanced_constraints.get("lessonStartsOnly", ["Chào cờ"])
    lesson_consecutive_raw = advanced_constraints.get("lessonConsecutiveSubjects", [])
    lesson_same_session_raw = advanced_constraints.get("lessonSameSessionSubjects", [])
    lesson_not_same_session_raw = advanced_constraints.get("lessonNotSameSessionSubjects", [])
    lesson_consecutive_pairs_raw = advanced_constraints.get("lessonConsecutivePairs", [])
    lesson_not_same_session_pairs_raw = advanced_constraints.get("lessonNotSameSessionPairs", [])
    subject_no_room_raw = advanced_constraints.get("subjectNoRoom", ["Thể dục", "GDQPAN"])
    
    subject_max_per_session = int(advanced_constraints.get("subjectMaxPerSession", 4))
    subject_max_periods_per_session = int(advanced_constraints.get("subjectMaxPeriodsPerSession", 2))

    class_grade_dict = {c["id"]: str(c.get("grade", "")) for c in classes}

    lesson_ends_only = set(normalize_subject_name(s) for s in lesson_ends_only_raw)
    lesson_starts_only = set(normalize_subject_name(s) for s in lesson_starts_only_raw)
    subject_no_room = set(normalize_subject_name(s) for s in subject_no_room_raw)

    lesson_consecutive_subs = set(normalize_subject_name(s) for s in lesson_consecutive_raw if str(s).strip())
    lesson_same_session_subs = set(normalize_subject_name(s) for s in lesson_same_session_raw if str(s).strip())
    lesson_not_same_session_subs = set(normalize_subject_name(s) for s in lesson_not_same_session_raw if str(s).strip())

    lesson_consecutive_subs_raw = set(str(s).strip().lower() for s in lesson_consecutive_raw if str(s).strip())
    lesson_same_session_subs_raw = set(str(s).strip().lower() for s in lesson_same_session_raw if str(s).strip())
    lesson_not_same_session_subs_raw = set(str(s).strip().lower() for s in lesson_not_same_session_raw if str(s).strip())

    lesson_consecutive_pairs = []
    for item in lesson_consecutive_pairs_raw:
        if isinstance(item, dict):
            if item.get("enabled", True) is not False:
                s1 = normalize_subject_name(item.get("subject1", ""))
                s2 = normalize_subject_name(item.get("subject2", ""))
                if s1 and s2 and s1 != s2:
                    lesson_consecutive_pairs.append((s1, s2))
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            s1 = normalize_subject_name(item[0])
            s2 = normalize_subject_name(item[1])
            if s1 and s2 and s1 != s2:
                lesson_consecutive_pairs.append((s1, s2))

    lesson_not_same_session_pairs = []
    for item in lesson_not_same_session_pairs_raw:
        if isinstance(item, dict):
            if item.get("enabled", True) is not False:
                s1 = normalize_subject_name(item.get("subject1", ""))
                s2 = normalize_subject_name(item.get("subject2", ""))
                if s1 and s2 and s1 != s2:
                    lesson_not_same_session_pairs.append((s1, s2))
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            s1 = normalize_subject_name(item[0])
            s2 = normalize_subject_name(item[1])
            if s1 and s2 and s1 != s2:
                lesson_not_same_session_pairs.append((s1, s2))

    # Compatibility heuristics for GDPT 2018:
    if "GDĐP" in lesson_consecutive_subs and "GDQPAN" in lesson_consecutive_subs:
        if not any((a == "GDĐP" and b == "GDQPAN") or (a == "GDQPAN" and b == "GDĐP") for a, b in lesson_consecutive_pairs):
            lesson_consecutive_pairs.append(("GDĐP", "GDQPAN"))
    if not lesson_consecutive_pairs:
        lesson_consecutive_pairs.append(("GDĐP", "GDQPAN"))

    if "GDTC" in lesson_not_same_session_subs and "GDQPAN" in lesson_not_same_session_subs:
        if not any((a == "GDTC" and b == "GDQPAN") or (a == "GDQPAN" and b == "GDTC") for a, b in lesson_not_same_session_pairs):
            lesson_not_same_session_pairs.append(("GDTC", "GDQPAN"))
    if "GDTC" in lesson_not_same_session_subs and "GDĐP" in lesson_not_same_session_subs:
        if not any((a == "GDTC" and b == "GDĐP") or (a == "GDĐP" and b == "GDTC") for a, b in lesson_not_same_session_pairs):
            lesson_not_same_session_pairs.append(("GDTC", "GDĐP"))

    if not any((a == "GDTC" and b == "GDQPAN") or (a == "GDQPAN" and b == "GDTC") for a, b in lesson_not_same_session_pairs):
        lesson_not_same_session_pairs.append(("GDTC", "GDQPAN"))
    if not any((a == "GDTC" and b == "GDĐP") or (a == "GDĐP" and b == "GDTC") for a, b in lesson_not_same_session_pairs):
        lesson_not_same_session_pairs.append(("GDTC", "GDĐP"))

    for p1, p2 in list(lesson_consecutive_pairs):
        for sA, sB in list(lesson_not_same_session_pairs):
            other = sB if sA in (p1, p2) else (sA if sB in (p1, p2) else None)
            target = p2 if (p1 in (sA, sB)) else (p1 if (p2 in (sA, sB)) else None)
            if other and target and other != target:
                if not any((a == target and b == other) or (a == other and b == target) for a, b in lesson_not_same_session_pairs):
                    lesson_not_same_session_pairs.append((target, other))

    def is_slot_locked(cid, tid, d, p):
        # THỨ 2 LÀ NGÀY HỌC BÌNH THƯỜNG:
        # Tuyệt đối không khóa ngày Thứ 2 cho các lớp (chỉ khóa Tiết 1 Chào cờ nếu có)
        if d == 2 and p > 1:
            key = f"{d}_{p}"
            # Chỉ kiểm tra nếu chính giáo viên đó có lịch bận cá nhân
            if tid and key in locked_by_teacher.get(tid, []):
                return True
            return False

        key = f"{d}_{p}"

        # Kiểm tra ngoại lệ / ghi đè (classBreakExceptions) của riêng lớp này:
        is_class_exception = False
        c_clean = str(cid).replace("c_", "").lower()
        c_name = str(class_dict.get(cid, "")).lower()
        for e_k, slots in class_break_exceptions.items():
            ek_clean = str(e_k).replace("c_", "").lower()
            if ek_clean == c_clean or (c_name and ek_clean == c_name) or str(e_k) == str(cid):
                if key in slots:
                    is_class_exception = True
                    break

        # 1. Hợp nhất: Tiết nghỉ Toàn trường
        if key in locked_global:
            return True

        # 2. Hợp nhất: Tiết nghỉ theo Khối (chỉ áp dụng nếu KHÔNG bị lớp ghi đè ngoại lệ)
        if not is_class_exception:
            c_grade = class_grade_dict.get(cid, "")
            g_clean = "".join([ch for ch in str(c_grade) if ch.isdigit()])
            for g_k, slots in locked_by_grade.items():
                g_k_clean = "".join([ch for ch in str(g_k) if ch.isdigit()])
                if (g_k_clean and g_k_clean == g_clean) or str(g_k) == str(c_grade) or str(g_k) == f"grade_{c_grade}":
                    if key in slots:
                        return True

        # 3. Hợp nhất: Tiết nghỉ riêng của Lớp (hỗ trợ mọi bí danh: '10A1', 'c_10A1', tên lớp)
        for c_k, slots in locked_by_class.items():
            ck_clean = str(c_k).replace("c_", "").lower()
            if ck_clean == c_clean or (c_name and ck_clean == c_name) or str(c_k) == str(cid):
                if key in slots:
                    return True

        # 4. Tiết bận của Giáo viên
        if tid and key in locked_by_teacher.get(tid, []):
            return True

        return False

    teacher_dict = {t["id"]: t["name"] for t in teachers}
    class_dict = {c["id"]: c["name"] for c in classes}
    homeroom_assignments = assignments.get("homeroomAssignments", {})
    subject_assignments = assignments.get("subjectAssignments", {})

    days = [2, 3, 4, 5, 6, 7]
    session_mode = input_data.get("sessionMode", "single")
    afternoon_count = int(input_data.get("afternoonPeriodsCount", 4))
    class_shifts = input_data.get("classShifts", {})

    # Auto-detect if double session mode (periods 6-9/10) is needed
    has_afternoon_needed = (session_mode == "double")
    if not has_afternoon_needed:
        for cid, shift in class_shifts.items():
            if shift in ("morning_main", "afternoon_main", "afternoon", "both"):
                has_afternoon_needed = True
                break
    if not has_afternoon_needed:
        for req in subject_requirements:
            for s in req.get("subjects", []):
                if s.get("oppPeriods", 0) > 0:
                    has_afternoon_needed = True
                    break
            if has_afternoon_needed:
                break

    if has_afternoon_needed:
        periods = [1, 2, 3, 4, 5] + [6 + i for i in range(min(5, max(1, afternoon_count)))]
    else:
        periods = [1, 2, 3, 4, 5]

    max_class_slots = len(days) * len(periods)

    try:
        from ortools.sat.python import cp_model
    except ImportError:
        print(json.dumps({
            "error": "Google OR-Tools is not installed in the Python environment",
            "fallback": True
        }))
        return

    model = cp_model.CpModel()
    start_time = time.time()

    # Map class requirements
    req_map = {}
    for req in subject_requirements:
        cid = req.get("classId")
        if cid:
            r_dict = {}
            for s in req.get("subjects", []):
                norm_sub_name = normalize_subject_name(s.get("name", ""))
                r_dict[norm_sub_name] = {
                    "total": s.get("periods", 0),
                    "mainPeriods": s.get("mainPeriods", s.get("periods", 0)),
                    "oppPeriods": s.get("oppPeriods", 0),
                    "mainMinPairs": s.get("mainMinPairs", 0),
                    "oppMinPairs": s.get("oppMinPairs", 0)
                }
                r_dict[s.get("name", "")] = r_dict[norm_sub_name]
            req_map[cid] = r_dict

    fixed_lessons = []
    custom_fixed_counts = {}
    fixed_slots_by_class = {}
    fixed_slots_by_teacher = {}

    for cfs in custom_fixed_slots_input:
        cid = cfs.get("classId")
        if not cid:
            continue
        raw_sname = cfs.get("subject", "")
        norm_s = normalize_subject_name(raw_sname)
        tid = cfs.get("teacherId")
        try:
            day = int(cfs.get("day"))
            period = int(cfs.get("period"))
        except (ValueError, TypeError):
            continue

        cname = class_dict.get(cid, "Lớp")

        # Reconcile custom fixed slot with current assignments
        if raw_sname not in ("Chào cờ", "Sinh hoạt lớp", "TNHN2"):
            c_subs = subject_assignments.get(cid, {})
            current_tid = c_subs.get(norm_s) or c_subs.get(raw_sname)
            c_reqs = req_map.get(cid, {})
            req_info = c_reqs.get(norm_s, c_reqs.get(raw_sname, {}))
            total_req = req_info.get("total", 0)
            if total_req <= 0:
                continue
            # Ưu tiên danh mục phân công hiện hành
            if current_tid:
                tid = current_tid
            elif not tid:
                continue
            # Đảm bảo số tiết cố định không vượt quá tổng số tiết khai báo của môn
            if custom_fixed_counts.get((cid, norm_s), 0) >= total_req:
                continue
        else:
            current_htid = (
                homeroom_assignments.get(cid)
                or homeroom_assignments.get(cid.replace("c_", ""))
                or homeroom_assignments.get(cname)
                or next((c.get("homeroomTeacherId") for c in classes if c.get("id") == cid or c.get("name") == cname), "")
                or ""
            )
            if current_htid:
                tid = current_htid

        # Kiểm tra trùng lịch lớp trong fixed slots: 1 lớp chỉ có tối đa 1 tiết/slot
        if (day, period) in fixed_slots_by_class.get(cid, set()):
            continue

        # Kiểm tra trùng lịch giáo viên trong fixed slots: 1 giáo viên không thể cùng lúc dạy 2 lớp
        if tid and (day, period) in fixed_slots_by_teacher.get(tid, set()):
            continue

        tname = teacher_dict.get(tid, "Giáo viên")

        fixed_lessons.append({
            "id": f"fixed_custom_{cid}_{day}_{period}",
            "classId": cid,
            "className": cname,
            "subject": raw_sname,
            "teacherId": tid,
            "teacherName": tname,
            "day": day,
            "period": period,
            "isFixed": True
        })

        if cid not in fixed_slots_by_class:
            fixed_slots_by_class[cid] = set()
        fixed_slots_by_class[cid].add((day, period))

        if tid:
            if tid not in fixed_slots_by_teacher:
                fixed_slots_by_teacher[tid] = set()
            fixed_slots_by_teacher[tid].add((day, period))

        custom_fixed_counts[(cid, norm_s)] = custom_fixed_counts.get((cid, norm_s), 0) + 1



    class_list = [c["id"] for c in classes]

    # Pre-process items and Super-blocks (GDQPAN + GDĐP)
    items = []
    super_blocks = []
    for cid in class_list:
        c_subs = subject_assignments.get(cid, {})
        c_reqs = req_map.get(cid, {})
        seen_norm_subs = set()

        # SUPER-PERIOD: ĐÓNG GÓI GDQPAN VÀ GDĐP THÀNH 1 THỰC THỂ DUY NHẤT (Block_GDQP_GDDP)
        sname_qp = None
        tid_qp = None
        sname_dp = None
        tid_dp = None
        for sname, tid in c_subs.items():
            if not tid:
                continue
            ns = normalize_subject_name(sname)
            if ns == "GDQPAN":
                sname_qp, tid_qp = sname, tid
            elif ns == "GDĐP":
                sname_dp, tid_dp = sname, tid

        if sname_qp and tid_qp and sname_dp and tid_dp:
            qp_fixed = custom_fixed_counts.get((cid, "GDQPAN"), 0)
            dp_fixed = custom_fixed_counts.get((cid, "GDĐP"), 0)
            qp_req = c_reqs.get("GDQPAN", c_reqs.get(sname_qp, {"mainPeriods": 1, "oppPeriods": 0}))
            dp_req = c_reqs.get("GDĐP", c_reqs.get(sname_dp, {"mainPeriods": 1, "oppPeriods": 0}))
            qp_needed = max(0, qp_req.get("mainPeriods", 1) + qp_req.get("oppPeriods", 0) - qp_fixed)
            dp_needed = max(0, dp_req.get("mainPeriods", 1) + dp_req.get("oppPeriods", 0) - dp_fixed)

            if qp_needed == 1 and dp_needed == 1:
                super_blocks.append({
                    "block_id": f"Block_GDQP_GDDP_{cid}",
                    "class_id": cid,
                    "subject1": sname_qp,
                    "norm_subject1": "GDQPAN",
                    "teacher_id1": tid_qp,
                    "subject2": sname_dp,
                    "norm_subject2": "GDĐP",
                    "teacher_id2": tid_dp,
                    "target_session": "opp"
                })
                seen_norm_subs.add("GDQPAN")
                seen_norm_subs.add("GDĐP")

        for sname, tid in c_subs.items():
            if not tid:
                continue
            norm_s = normalize_subject_name(sname)
            if norm_s in seen_norm_subs:
                continue
            seen_norm_subs.add(norm_s)

            req_data = c_reqs.get(norm_s, c_reqs.get(sname))
            if req_data:
                main_periods = req_data["mainPeriods"]
                opp_periods = req_data["oppPeriods"]
                main_min_pairs = req_data.get("mainMinPairs", 0)
                opp_min_pairs = req_data.get("oppMinPairs", 0)
            else:
                main_periods = 2
                opp_periods = 0
                main_min_pairs = 0
                opp_min_pairs = 0

            fixed_count = custom_fixed_counts.get((cid, norm_s), 0)
            main_needed = max(0, main_periods - fixed_count)
            fixed_count = max(0, fixed_count - main_periods)
            opp_needed = max(0, opp_periods - fixed_count)

            if main_needed > 0:
                items.append({
                    "class_id": cid,
                    "subject": sname,
                    "norm_subject": norm_s,
                    "teacher_id": tid,
                    "periods": main_needed,
                    "target_session": "main",
                    "min_pairs": main_min_pairs
                })
            if opp_needed > 0:
                items.append({
                    "class_id": cid,
                    "subject": sname,
                    "norm_subject": norm_s,
                    "teacher_id": tid,
                    "periods": opp_needed,
                    "target_session": "opp",
                    "min_pairs": opp_min_pairs
                })

    # Decision variables
    block_x = {}
    for b_idx, block in enumerate(super_blocks):
        cid = block["class_id"]
        tid1 = block["teacher_id1"]
        tid2 = block["teacher_id2"]

        c_grade = class_grade_dict.get(cid, "")
        default_shift = "afternoon_main" if c_grade == "10" else "morning_main"
        raw_shift = class_shifts.get(cid, default_shift)
        shift = "afternoon_main" if (raw_shift in ["afternoon_main", "afternoon"] or c_grade == "10") else "morning_main"

        if shift == "afternoon_main":
            valid_starts = [1, 2, 3, 4]
        else:
            valid_starts = [6, 7, 8, 9]

        for d in days:
            for t in valid_starts:
                if (d, t) in fixed_slots_by_class.get(cid, set()) or (d, t + 1) in fixed_slots_by_class.get(cid, set()):
                    continue
                if is_slot_locked(cid, tid1, d, t) or is_slot_locked(cid, tid2, d, t + 1):
                    continue
                block_x[(b_idx, d, t)] = model.NewBoolVar(f"block_{b_idx}_{d}_{t}")

    x = {}
    for i_idx, item in enumerate(items):
        cid = item["class_id"]
        tid = item["teacher_id"]
        target_session = item.get("target_session")

        c_grade = class_grade_dict.get(cid, "")
        default_shift = "afternoon_main" if c_grade == "10" else "morning_main"
        raw_shift = class_shifts.get(cid, default_shift)
        shift = "afternoon_main" if (raw_shift in ["afternoon_main", "afternoon"] or c_grade == "10") else "morning_main"

        for d in days:
            for p in periods:
                if (d, p) in fixed_slots_by_class.get(cid, set()):
                    continue
                if is_slot_locked(cid, tid, d, p):
                    continue

                if target_session == "main":
                    main_is_morning = (shift == "morning_main" or shift == "morning")
                    if main_is_morning and p >= 6:
                        continue
                    if not main_is_morning and p <= 5:
                        continue
                elif target_session == "opp":
                    opp_is_afternoon = (shift == "morning_main" or shift == "morning")
                    if opp_is_afternoon and p <= 5:
                        continue
                    if not opp_is_afternoon and p >= 6:
                        continue

                x[(i_idx, d, p)] = model.NewBoolVar(f"x_{i_idx}_{d}_{p}")

    # Teacher meeting rules
    all_tids = set(t["id"] for t in teachers)
    def get_teachers_for_meeting_subject(target_subject):
        if not target_subject or str(target_subject).strip().lower() in ["all", "tất cả", "tất cả các môn", "hội đồng", ""]:
            return set(all_tids)
        target_norm = normalize_subject_name(target_subject).lower()
        target_raw = str(target_subject).strip().lower()
        matched = set()
        for t in teachers:
            t_id = t.get("id")
            spec = str(t.get("specialization", "")).strip().lower()
            spec_norm = normalize_subject_name(spec).lower()
            if spec_norm == target_norm or spec == target_raw or target_norm in spec_norm or target_raw in spec:
                matched.add(t_id)
        for item in items:
            t_id = item.get("teacher_id")
            if not t_id:
                continue
            item_sub = item.get("subject", "")
            item_sub_norm = normalize_subject_name(item_sub).lower()
            item_sub_raw = str(item_sub).strip().lower()
            if item_sub_norm == target_norm or item_sub_raw == target_raw or target_norm in item_sub_norm or target_raw in item_sub_raw:
                matched.add(t_id)
        sub_assigns = assignments.get("subjectAssignments", {})
        for c_id, subs in sub_assigns.items():
            if isinstance(subs, dict):
                for s_name, t_id in subs.items():
                    if t_id:
                        s_norm = normalize_subject_name(s_name).lower()
                        s_raw = str(s_name).strip().lower()
                        if s_norm == target_norm or s_raw == target_raw or target_norm in s_norm or target_raw in s_raw:
                            matched.add(t_id)
        return matched

    active_meeting_rules = []
    if teacher_meeting_day in [2, 3, 4, 5, 6, 7]:
        active_meeting_rules.append({
            "subject": teacher_meeting_subject,
            "day": teacher_meeting_day,
            "session": teacher_meeting_session
        })
    if isinstance(teacher_meeting_rules, list):
        for r in teacher_meeting_rules:
            try:
                r_day = int(r.get("day", 0))
                if r_day in [2, 3, 4, 5, 6, 7]:
                    active_meeting_rules.append({
                        "subject": str(r.get("subject", "")).strip(),
                        "day": r_day,
                        "session": r.get("session", "all")
                    })
            except Exception:
                pass

    teacher_meeting_blocked_slots = set()
    for rule in active_meeting_rules:
        r_day = rule["day"]
        r_session = rule["session"]
        r_subject = rule["subject"]
        affected_teachers = get_teachers_for_meeting_subject(r_subject)
        m_periods = periods if r_session == "all" else ([1, 2, 3, 4, 5] if r_session == "morning" else [6, 7, 8, 9, 10])
        for tid in affected_teachers:
            for p in m_periods:
                teacher_meeting_blocked_slots.add((tid, r_day, p))

    fixed_teacher_slots = {}
    for fl in fixed_lessons:
        tid = fl["teacherId"]
        if tid:
            if tid not in fixed_teacher_slots:
                fixed_teacher_slots[tid] = set()
            fixed_teacher_slots[tid].add((fl["day"], fl["period"]))

    # =========================================================================
    # ÁP DỤNG LẦN LƯỢT ĐẦY ĐỦ 5 MODULE RÀNG BUỘC CỐ ĐỊNH:
    # =========================================================================

    # MODULE 1: BẢO ĐẢM TỔNG SỐ TIẾT (100% TIẾT PHẢI ĐƯỢC XẾP - UNASSIGNED = 0)
    apply_module_1_ensure_total_periods(model, items, super_blocks, x, block_x, days, periods)

    # MODULE 2: PHÂN BỔ BUỔI HỌC (CHÍNH KHÓA & TRÁI BUỔI)
    apply_module_2_session_allocation(model, items, super_blocks, x, block_x, days, periods, class_shifts, class_grade_dict)

    # MODULE 3: TRẦN SƯ PHẠM - GIỚI HẠN TỐI ĐA SỐ TIẾT CỦA 1 MÔN TRONG 1 BUỔI (<= 2 TIẾT)
    apply_module_3_max_periods_per_session(model, items, super_blocks, x, block_x, days, periods, class_list, fixed_lessons)

    # MODULE 4: RÀNG BUỘC TIẾT CẶP (TIẾT ĐÔI & SIÊU KHỐI GDQPAN + GDĐP)
    pair_bonuses, two_period_pair_bonuses, deficit_penalties = apply_module_4_paired_and_super_blocks(
        model, items, super_blocks, x, block_x, days, periods,
        lesson_consecutive_subs, lesson_consecutive_subs_raw,
        lesson_consecutive_pairs, lesson_same_session_subs,
        lesson_same_session_subs_raw, lesson_not_same_session_subs,
        lesson_not_same_session_subs_raw, lesson_double_no_span_recess,
        has_afternoon_needed, class_list
    )

    # MODULE 5: TRÁNH TRÙNG LỊCH TUYỆT ĐỐI, GOM BUỔI MỤC TIÊU & RÀNG BUỘC PHÒNG/KHÓA/HỌP
    teacher_session_penalties, teacher_day_penalties, all_teacher_session_vars, excess_sessions_penalties = apply_module_5_conflict_free_and_special_rules(
        model, items, super_blocks, x, block_x,
        days, periods, class_list, teachers,
        fixed_lessons, fixed_teacher_slots,
        teacher_constraints_input, advanced_constraints,
        active_meeting_rules, lesson_not_same_session_pairs,
        teacher_meeting_blocked_slots,
        max_sessions_input=max_sessions_input,
        max_days_input=max_days_input
    )

    # Objective & Quality optimization
    excess_subject_day_penalties = []
    for i_idx, item in enumerate(items):
        for d in days:
            day_vars = [x[(i_idx, d, p)] for p in periods if (i_idx, d, p) in x]
            if len(day_vars) > 2:
                excess_sub_day = model.NewBoolVar(f"excess_sub_day_{i_idx}_{d}")
                model.Add(sum(day_vars) <= 2 + 3 * excess_sub_day)
                excess_subject_day_penalties.append(excess_sub_day)

    # TRIỆT TIÊU HOÀN TOÀN TIẾT TRỐNG (IDLE SLOTS / GAPS) CẢ BUỔI SÁNG VÀ CHIỀU
    teacher_gap_penalties = []
    morning_periods = [p for p in periods if p <= 5]
    afternoon_periods = [p for p in periods if p >= 6]

    for tid in all_tids:
        t_item_indices = [idx for idx, item in enumerate(items) if item["teacher_id"] == tid]
        t1_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id1"] == tid]
        t2_blocks = [b_idx for b_idx, b in enumerate(super_blocks) if b["teacher_id2"] == tid]
        if not t_item_indices and not t1_blocks and not t2_blocks and tid not in fixed_teacher_slots:
            continue

        for d in days:
            # 1. BUỔI SÁNG: Gaps giữa các tiết buổi sáng (tiết 1..5)
            if morning_periods:
                m_presence = []
                for p in morning_periods:
                    slot_vars = [x[(idx, d, p)] for idx in t_item_indices if (idx, d, p) in x]
                    for b_idx in t1_blocks:
                        if (b_idx, d, p) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p)])
                    for b_idx in t2_blocks:
                        if (b_idx, d, p - 1) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p - 1)])

                    if (d, p) in fixed_teacher_slots.get(tid, set()):
                        m_presence.append(1)
                    elif slot_vars:
                        tp = model.NewBoolVar(f"tp_m_{tid}_{d}_{p}")
                        model.Add(sum(slot_vars) == tp)
                        m_presence.append(tp)
                    else:
                        m_presence.append(0)

                for mid_idx in range(1, len(m_presence) - 1):
                    p_num = morning_periods[mid_idx]
                    before = m_presence[0 : mid_idx]
                    after = m_presence[mid_idx + 1 :]
                    has_before = model.NewBoolVar(f"hb_m_{tid}_{d}_{p_num}")
                    has_after = model.NewBoolVar(f"ha_m_{tid}_{d}_{p_num}")
                    model.AddMaxEquality(has_before, [b if isinstance(b, cp_model.IntVar) else model.NewConstant(b) for b in before])
                    model.AddMaxEquality(has_after, [a if isinstance(a, cp_model.IntVar) else model.NewConstant(a) for a in after])
                    is_gap = model.NewBoolVar(f"gap_m_{tid}_{d}_{p_num}")
                    mid_val = m_presence[mid_idx]
                    mid_var = mid_val if isinstance(mid_val, cp_model.IntVar) else model.NewConstant(mid_val)
                    model.Add(is_gap >= has_before + has_after - mid_var - 1)
                    teacher_gap_penalties.append(is_gap)

            # 2. BUỔI CHIỀU: Gaps giữa các tiết buổi chiều (tiết 6..10)
            if len(afternoon_periods) >= 3:
                a_presence = []
                for p in afternoon_periods:
                    slot_vars = [x[(idx, d, p)] for idx in t_item_indices if (idx, d, p) in x]
                    for b_idx in t1_blocks:
                        if (b_idx, d, p) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p)])
                    for b_idx in t2_blocks:
                        if (b_idx, d, p - 1) in block_x:
                            slot_vars.append(block_x[(b_idx, d, p - 1)])

                    if (d, p) in fixed_teacher_slots.get(tid, set()):
                        a_presence.append(1)
                    elif slot_vars:
                        tp = model.NewBoolVar(f"tp_a_{tid}_{d}_{p}")
                        model.Add(sum(slot_vars) == tp)
                        a_presence.append(tp)
                    else:
                        a_presence.append(0)

                for mid_idx in range(1, len(a_presence) - 1):
                    p_num = afternoon_periods[mid_idx]
                    before = a_presence[0 : mid_idx]
                    after = a_presence[mid_idx + 1 :]
                    has_before = model.NewBoolVar(f"hb_a_{tid}_{d}_{p_num}")
                    has_after = model.NewBoolVar(f"ha_a_{tid}_{d}_{p_num}")
                    model.AddMaxEquality(has_before, [b if isinstance(b, cp_model.IntVar) else model.NewConstant(b) for b in before])
                    model.AddMaxEquality(has_after, [a if isinstance(a, cp_model.IntVar) else model.NewConstant(a) for a in after])
                    is_gap = model.NewBoolVar(f"gap_a_{tid}_{d}_{p_num}")
                    mid_val = a_presence[mid_idx]
                    mid_var = mid_val if isinstance(mid_val, cp_model.IntVar) else model.NewConstant(mid_val)
                    model.Add(is_gap >= has_before + has_after - mid_var - 1)
                    teacher_gap_penalties.append(is_gap)

    objective_terms = []
    # 1. Thưởng tiết cặp thông thường (Toán, Văn...): +50 điểm
    if pair_bonuses:
        objective_terms.extend([pv * 50 for pv in pair_bonuses])
    # 2. Thưởng môn 2 tiết (Địa, CNCN, CNNN, GDĐP) xếp liền 1 buổi để gom ngày nghỉ cho GV: +200 điểm
    if two_period_pair_bonuses:
        objective_terms.extend([pv * 200 for pv in two_period_pair_bonuses])
    # 3. Phạt nặng thiếu tiết cặp bắt buộc (Toán, Văn): -2000 điểm
    if deficit_penalties:
        objective_terms.extend([dv * -2000 for dv in deficit_penalties])
    # 4. Phạt triệt để tiết trống lửng (idle slots) giữa buổi sáng/chiều của giáo viên: -1500 điểm
    if teacher_gap_penalties:
        objective_terms.extend([gv * -1500 for gv in teacher_gap_penalties])
    # 5. Phạt dôi dư số buổi dạy so với mục tiêu TargetSessions (TotalPeriods <= 6: 1-2 buổi, <= 12: 2-3 buổi, <= 18: 3-4 buổi): -1200 điểm
    if excess_sessions_penalties:
        objective_terms.extend([es * -1200 for es in excess_sessions_penalties])
    # 6. Giảm thiểu tổng số buổi dạy thực tế toàn trường: -150 điểm cho mỗi buổi phát sinh
    if all_teacher_session_vars:
        objective_terms.extend([sv * -150 for sv in all_teacher_session_vars])
    # 7. Phạt vượt số buổi theo cấu hình thủ công riêng của Admin: -1200 điểm
    if teacher_session_penalties:
        objective_terms.extend([sp * -1200 for sp in teacher_session_penalties])
    # 8. Phạt vượt số ngày theo cấu hình thủ công riêng của Admin: -800 điểm
    if teacher_day_penalties:
        objective_terms.extend([dp * -800 for dp in teacher_day_penalties])
    # 9. Phạt dồn quá 2 tiết cùng môn không cặp trong ngày: -150 điểm
    if excess_subject_day_penalties:
        objective_terms.extend([ev * -150 for ev in excess_subject_day_penalties])

    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 45.0
    solver.parameters.num_workers = 8
    solver.parameters.linearization_level = 2

    status = solver.Solve(model)
    exec_time_ms = int((time.time() - start_time) * 1000)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        lessons_result = list(fixed_lessons)
        lesson_counter = 1000

        for (i_idx, d, p), var in x.items():
            if solver.Value(var) == 1:
                item = items[i_idx]
                cid = item["class_id"]
                cname = class_dict.get(cid, cid)
                tid = item["teacher_id"]
                tname = teacher_dict.get(tid, tid)
                lesson_counter += 1
                lessons_result.append({
                    "id": f"lesson_{lesson_counter}",
                    "classId": cid,
                    "className": cname,
                    "subject": item["subject"],
                    "teacherId": tid,
                    "teacherName": tname,
                    "day": d,
                    "period": p,
                    "isFixed": False
                })

        for (b_idx, d, t), var in block_x.items():
            if solver.Value(var) == 1:
                block = super_blocks[b_idx]
                cid = block["class_id"]
                cname = class_dict.get(cid, cid)
                lesson_counter += 1
                lessons_result.append({
                    "id": f"lesson_{lesson_counter}",
                    "classId": cid,
                    "className": cname,
                    "subject": block["subject1"],
                    "teacherId": block["teacher_id1"],
                    "teacherName": teacher_dict.get(block["teacher_id1"], block["teacher_id1"]),
                    "day": d,
                    "period": t,
                    "isFixed": False
                })
                lesson_counter += 1
                lessons_result.append({
                    "id": f"lesson_{lesson_counter}",
                    "classId": cid,
                    "className": cname,
                    "subject": block["subject2"],
                    "teacherId": block["teacher_id2"],
                    "teacherName": teacher_dict.get(block["teacher_id2"], block["teacher_id2"]),
                    "day": d,
                    "period": t + 1,
                    "isFixed": False
                })

        print(json.dumps({
            "success": True,
            "status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            "solver": "ortools_cp_sat",
            "executionTimeMs": exec_time_ms,
            "lessons": lessons_result
        }))
    else:
        print(json.dumps({
            "success": False,
            "status": "INFEASIBLE",
            "fallback": False,
            "error": "Không thể tìm thấy lời giải thỏa mãn toàn bộ ràng buộc cứng (số tiết, kẹt lịch giáo viên hoặc trùng lịch)."
        }))

if __name__ == "__main__":
    solve()
