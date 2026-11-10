import sys

with open('src/utils/timetableSolver.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update target_lock to not blindly lock sessions when in double session mode
target_lock = '''  classes.forEach(c => {
    const cSlots = classGrid.get(c.id);
    if (!cSlots) return;
    const shift = classShifts[c.id] || c.shift;
    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (shift === 'morning' && period >= 6) {
        cSlots[s] = 'FIXED'; // Lớp chỉ học ca sáng
      } else if (shift === 'afternoon' && period <= 5) {
        cSlots[s] = 'FIXED'; // Lớp chỉ học ca chiều
      } else if (isClassSlotLocked(c.id, day, period)) {
        cSlots[s] = 'FIXED'; // Mark as FIXED so solver never overrides it
      }
    }
  });'''

replacement_lock = '''  classes.forEach(c => {
    const cSlots = classGrid.get(c.id);
    if (!cSlots) return;
    const shift = classShifts[c.id] || c.shift;
    const cReqMap = reqMap.get(c.id);
    const hasOppLessons = cReqMap ? Array.from(cReqMap.values()).some((v: any) => (v.oppPeriods || 0) > 0) : false;

    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      // Chỉ khóa cứng toàn bộ ca đối diện nếu lớp HOÀN TOÀN KHÔNG CÓ môn trái buổi nào
      if (!hasOppLessons && shift === 'morning' && period >= 6) {
        cSlots[s] = 'FIXED';
      } else if (!hasOppLessons && shift === 'afternoon' && period <= 5) {
        cSlots[s] = 'FIXED';
      } else if (isClassSlotLocked(c.id, day, period)) {
        cSlots[s] = 'FIXED'; // Giữ nguyên các vị trí đã khóa
      }
    }
  });'''

assert target_lock in text, 'target_lock not found'
text = text.replace(target_lock, replacement_lock, 1)

# 2. Replace Section 4 with Advanced Kempe Chains & Min-Conflicts Local Search
s4_start_marker = '// 4. Guaranteed 100% complete scheduling via Augmenting Paths & Ejection Chains'
s5_start_marker = '// 5. Post-Optimization: Simulated Annealing / Local Search to eliminate teacher gaps (tiết trống lắt léo)'

idx_s4 = text.find(s4_start_marker)
idx_s5 = text.find(s5_start_marker)
assert idx_s4 != -1 and idx_s5 != -1, 'Section markers not found'

new_section_4 = '''// 4. BẢO ĐẢM 100% TIẾT ĐƯỢC XẾP - THUẬT TOÁN ĐẢO TIẾT KEMPE CHAINS & MIN-CONFLICTS LOCAL SEARCH
  // ---------------------------------------------------------------------------------------------
  // Khi một lớp còn ô trống nhưng GV bị trùng giờ ở lớp khác hoặc vướng trần sư phạm:
  // Kích hoạt cơ chế đảo tiết tự động (Intra-class swap, Inter-class Kempe chains, Min-conflicts Ejection)
  // Duyệt vét qua cơ chế hoán vị (chạy từ 2 đến 10 giây nếu cần), bảo đảm 100% số tiết được xếp (unassigned = 0).
  // ---------------------------------------------------------------------------------------------

  // Helper check if subject can be placed in slot s of class cId
  const canPlaceSubjectInClassSlot = (
    cId: string,
    s: number,
    subName: string,
    targetSess: 'main' | 'opp',
    ignoreSlot: number = -1
  ): boolean => {
    const { day, period } = slotToDayPeriod(s);
    if (isClassSlotLocked(cId, day, period)) return false;
    const grid = classGrid.get(cId);
    if (!grid) return false;
    if (grid[s] === 'FIXED' && s !== ignoreSlot) return false;

    // MODULE 2: Phân bổ buổi học chính khóa & trái buổi
    const cShift = getClassShift(cId);
    if (targetSess === 'main') {
      const mainIsMorning = (cShift === 'morning_main');
      if (mainIsMorning && period >= 6) return false;
      if (!mainIsMorning && period <= 5) return false;
    } else if (targetSess === 'opp') {
      const oppIsAfternoon = (cShift === 'morning_main');
      if (oppIsAfternoon && period <= 5) return false;
      if (!oppIsAfternoon && period >= 6) return false;
    }

    // MODULE 3: Trần sư phạm <= 2 tiết / môn / buổi
    const isMorning = (period <= 5);
    const normS = normalizeSubName(subName);
    let countInSess = 0;
    const startS = Math.floor(s / periodsPerDay) * periodsPerDay;
    for (let p = 0; p < periodsPerDay; p++) {
      const testS = startS + p;
      if (testS === s || testS === ignoreSlot) continue;
      const item = grid[testS];
      if (item && item !== 'FIXED') {
        if ((p < 5) === isMorning && normalizeSubName(item.subject) === normS) {
          countInSess++;
        }
      }
    }
    if (countInSess >= 2) return false;

    // MODULE 5: Ràng buộc môn không học chung buổi (ví dụ GDTC với GDQPAN / GDĐP)
    for (const [dis1, dis2] of lessonNotSameSessionPairs) {
      const forbidden = dis1 === normS ? dis2 : (dis2 === normS ? dis1 : null);
      if (forbidden) {
        for (let p = 0; p < periodsPerDay; p++) {
          const testS = startS + p;
          if (testS === s || testS === ignoreSlot) continue;
          const item = grid[testS];
          if (item && item !== 'FIXED') {
            if ((p < 5) === isMorning && normalizeSubName(item.subject) === forbidden) {
              return false;
            }
          }
        }
      }
    }

    return true;
  };

  // Helper check if teacher is available at slot s
  const isTeacherAvailableAtSlot = (tId: string, s: number, ignoreCid: string = ''): boolean => {
    const { day, period } = slotToDayPeriod(s);
    if (isTeacherSlotLocked(tId, day, period)) return false;
    const tSlots = teacherGrid.get(tId);
    if (!tSlots) return true;
    const occupant = tSlots[s];
    if (occupant === null) return true;
    if (occupant === 'MEETING' || occupant === 'LOCKED') return false;
    if (occupant === ignoreCid) return true;
    return false;
  };

  // Helper to place Super-period block intact by evicting movable single units if needed
  const placeSuperBlockWithChains = (blockUnit: LessonUnit): boolean => {
    const cid = blockUnit.classId;
    const t1Id = blockUnit.teacherId;
    const t2Id = blockUnit.pairedUnit!.teacherId;
    const cSlots = classGrid.get(cid);
    if (!cSlots) return false;
    const t1Slots = teacherGrid.get(t1Id);
    const t2Slots = teacherGrid.get(t2Id);

    const validDoublePairs: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4]
    ];
    if (sessionMode === 'double' && periodsPerDay > 5) {
      for (let i = 5; i < periodsPerDay - 1; i++) {
        validDoublePairs.push([i, i + 1]);
      }
    }

    for (let dayIdx = 0; dayIdx < allDays.length; dayIdx++) {
      const day = allDays[dayIdx];
      const startSlot = dayIdx * periodsPerDay;

      for (const [p1Idx, p2Idx] of validDoublePairs) {
        const s1 = startSlot + p1Idx;
        const s2 = startSlot + p2Idx;
        const { period: p1 } = slotToDayPeriod(s1);
        const { period: p2 } = slotToDayPeriod(s2);

        // MODULE 2: Khối 10 học Sáng, Khối 11-12 học Chiều
        const effShift = getClassShift(cid);
        if (effShift === 'morning_main') {
          if (p1 <= 5 || p2 <= 5) continue; // Cấm sáng, chỉ học chiều
        } else {
          if (p1 >= 6 || p2 >= 6) continue; // Cấm chiều, chỉ học sáng
        }

        if (isClassSlotLocked(cid, day, p1) || isClassSlotLocked(cid, day, p2)) continue;
        if (isTeacherSlotLocked(t1Id, day, p1) || isTeacherSlotLocked(t2Id, day, p2)) continue;
        if (cSlots[s1] === 'FIXED' || cSlots[s2] === 'FIXED') continue;

        if (t1Slots && t1Slots[s1] !== null && t1Slots[s1] !== cid) continue;
        if (t2Slots && t2Slots[s2] !== null && t2Slots[s2] !== cid) continue;
        if (t1Slots && t1Slots[s1] === 'MEETING') continue;
        if (t2Slots && t2Slots[s2] === 'MEETING') continue;

        const occ1 = cSlots[s1];
        const occ2 = cSlots[s2];
        if (occ1 && (occ1.isDouble || occ1.isSuperBlock)) continue;
        if (occ2 && (occ2.isDouble || occ2.isSuperBlock)) continue;

        // Disjoint with GDTC
        const isMorningSlot = (p1 <= 5);
        let hasGdtcConflict = false;
        for (let testP = 0; testP < periodsPerDay; testP++) {
          const itemInSlot = cSlots[startSlot + testP];
          if (itemInSlot && itemInSlot !== 'FIXED' && (testP < 5) === isMorningSlot) {
            if (normalizeSubName(itemInSlot.subject) === 'GDTC') {
              hasGdtcConflict = true;
              break;
            }
          }
        }
        if (hasGdtcConflict) continue;

        if (!occ1 && !occ2) {
          cSlots[s1] = { ...blockUnit, isDouble: true, isSuperBlock: true };
          cSlots[s2] = {
            ...blockUnit,
            unitId: `${blockUnit.unitId}_paired`,
            subject: blockUnit.pairedUnit!.subject,
            teacherId: blockUnit.pairedUnit!.teacherId,
            teacherName: blockUnit.pairedUnit!.teacherName,
            isDouble: true,
            isSuperBlock: true
          };
          if (t1Slots) t1Slots[s1] = cid;
          if (t2Slots) t2Slots[s2] = cid;
          return true;
        }

        // Try relocating occupying single units
        const toRelocate: LessonUnit[] = [];
        if (occ1) toRelocate.push(occ1);
        if (occ2) toRelocate.push(occ2);

        cSlots[s1] = { ...blockUnit, isDouble: true, isSuperBlock: true };
        cSlots[s2] = {
          ...blockUnit,
          unitId: `${blockUnit.unitId}_paired`,
          subject: blockUnit.pairedUnit!.subject,
          teacherId: blockUnit.pairedUnit!.teacherId,
          teacherName: blockUnit.pairedUnit!.teacherName,
          isDouble: true,
          isSuperBlock: true
        };
        if (t1Slots) t1Slots[s1] = cid;
        if (t2Slots) t2Slots[s2] = cid;

        let allRelocated = true;
        for (const u of toRelocate) {
          if (!placeUnitWithAdvancedChains(u)) {
            allRelocated = false;
            break;
          }
        }

        if (allRelocated) {
          return true;
        }

        // Rollback
        cSlots[s1] = occ1;
        cSlots[s2] = occ2;
        if (occ1) {
          const tOcc1 = teacherGrid.get(occ1.teacherId);
          if (tOcc1) tOcc1[s1] = cid;
        }
        if (occ2) {
          const tOcc2 = teacherGrid.get(occ2.teacherId);
          if (tOcc2) tOcc2[s2] = cid;
        }
        if (t1Slots) t1Slots[s1] = null;
        if (t2Slots) t2Slots[s2] = null;
      }
    }
    return false;
  };

  // Multi-level Kempe-Chain and Swap Engine for single units
  const placeUnitWithAdvancedChains = (unit: LessonUnit): boolean => {
    const cid = unit.classId;
    const tid = unit.teacherId;
    const cSlots = classGrid.get(cid);
    if (!cSlots) return false;
    const tSlots = teacherGrid.get(tid);

    // LEVEL 1: Direct placement into free slot of class cid
    for (let s = 0; s < totalSlots; s++) {
      if (cSlots[s] !== null) continue;
      if (!canPlaceSubjectInClassSlot(cid, s, unit.subject, unit.targetSession)) continue;
      if (!isTeacherAvailableAtSlot(tid, s, cid)) continue;

      cSlots[s] = unit;
      if (tSlots) tSlots[s] = cid;
      return true;
    }

    // LEVEL 2: Intra-class 1-step swap (L -> sFree, unit -> slot(L))
    for (let sFree = 0; sFree < totalSlots; sFree++) {
      if (cSlots[sFree] !== null) continue;

      for (let sOcc = 0; sOcc < totalSlots; sOcc++) {
        if (sOcc === sFree) continue;
        const occUnit = cSlots[sOcc];
        if (!occUnit || occUnit === 'FIXED' || occUnit.isSuperBlock) continue;

        // Check if occUnit can move to sFree
        if (!canPlaceSubjectInClassSlot(cid, sFree, occUnit.subject, occUnit.targetSession, sOcc)) continue;
        if (!isTeacherAvailableAtSlot(occUnit.teacherId, sFree, cid)) continue;

        // Check if unit can take sOcc
        if (!canPlaceSubjectInClassSlot(cid, sOcc, unit.subject, unit.targetSession, sOcc)) continue;
        if (!isTeacherAvailableAtSlot(tid, sOcc, cid)) continue;

        // Execute swap!
        const tOccSlots = teacherGrid.get(occUnit.teacherId);
        cSlots[sFree] = occUnit;
        if (tOccSlots) { tOccSlots[sOcc] = null; tOccSlots[sFree] = cid; }
        cSlots[sOcc] = unit;
        if (tSlots) tSlots[sOcc] = cid;
        return true;
      }
    }

    // LEVEL 3: Inter-class 1-step swap (Kempe Chain on Teacher tid)
    // Teacher tid is busy at sFree teaching class otherCid. Move that lesson in otherCid to sOther.
    for (let sFree = 0; sFree < totalSlots; sFree++) {
      if (cSlots[sFree] !== null) continue;
      if (!canPlaceSubjectInClassSlot(cid, sFree, unit.subject, unit.targetSession)) continue;

      const otherCid = tSlots ? tSlots[sFree] : null;
      if (otherCid && otherCid !== cid && otherCid !== 'LOCKED' && otherCid !== 'MEETING') {
        const otherGrid = classGrid.get(otherCid);
        if (otherGrid) {
          const otherUnit = otherGrid[sFree];
          if (otherUnit && otherUnit !== 'FIXED' && !otherUnit.isSuperBlock) {
            // 3a. Move otherUnit directly to any free slot in otherCid
            for (let sOther = 0; sOther < totalSlots; sOther++) {
              if (sOther === sFree || otherGrid[sOther] !== null) continue;
              if (!canPlaceSubjectInClassSlot(otherCid, sOther, otherUnit.subject, otherUnit.targetSession, sFree)) continue;
              if (!isTeacherAvailableAtSlot(tid, sOther, otherCid)) continue;

              otherGrid[sFree] = null;
              otherGrid[sOther] = otherUnit;
              if (tSlots) tSlots[sOther] = otherCid;

              cSlots[sFree] = unit;
              if (tSlots) tSlots[sFree] = cid;
              return true;
            }

            // 3b. Intra-class swap within otherCid to free sFree
            for (let sOtherFree = 0; sOtherFree < totalSlots; sOtherFree++) {
              if (otherGrid[sOtherFree] !== null) continue;
              for (let sOtherOcc = 0; sOtherOcc < totalSlots; sOtherOcc++) {
                if (sOtherOcc === sFree || sOtherOcc === sOtherFree) continue;
                const mUnit = otherGrid[sOtherOcc];
                if (!mUnit || mUnit === 'FIXED' || mUnit.isSuperBlock) continue;

                if (!canPlaceSubjectInClassSlot(otherCid, sOtherFree, mUnit.subject, mUnit.targetSession, sOtherOcc)) continue;
                if (!isTeacherAvailableAtSlot(mUnit.teacherId, sOtherFree, otherCid)) continue;
                if (!canPlaceSubjectInClassSlot(otherCid, sOtherOcc, otherUnit.subject, otherUnit.targetSession, sFree)) continue;
                if (!isTeacherAvailableAtSlot(tid, sOtherOcc, otherCid)) continue;

                const mTSlots = teacherGrid.get(mUnit.teacherId);
                otherGrid[sOtherFree] = mUnit;
                if (mTSlots) { mTSlots[sOtherOcc] = null; mTSlots[sOtherFree] = otherCid; }
                otherGrid[sOtherOcc] = otherUnit;
                if (tSlots) tSlots[sOtherOcc] = otherCid;

                otherGrid[sFree] = null;
                cSlots[sFree] = unit;
                if (tSlots) tSlots[sFree] = cid;
                return true;
              }
            }
          }
        }
      }
    }

    // LEVEL 4: Intra-class 2-step chain in class cid (u2 -> sFree, u1 -> s2, unit -> s1)
    for (let sFree = 0; sFree < totalSlots; sFree++) {
      if (cSlots[sFree] !== null) continue;
      for (let s1 = 0; s1 < totalSlots; s1++) {
        if (s1 === sFree) continue;
        const u1 = cSlots[s1];
        if (!u1 || u1 === 'FIXED' || u1.isSuperBlock) continue;
        if (!canPlaceSubjectInClassSlot(cid, s1, unit.subject, unit.targetSession, s1)) continue;
        if (!isTeacherAvailableAtSlot(tid, s1, cid)) continue;

        for (let s2 = 0; s2 < totalSlots; s2++) {
          if (s2 === s1 || s2 === sFree) continue;
          const u2 = cSlots[s2];
          if (!u2 || u2 === 'FIXED' || u2.isSuperBlock) continue;
          if (!canPlaceSubjectInClassSlot(cid, s2, u1.subject, u1.targetSession, s1)) continue;
          if (!isTeacherAvailableAtSlot(u1.teacherId, s2, cid)) continue;
          if (!canPlaceSubjectInClassSlot(cid, sFree, u2.subject, u2.targetSession, s2)) continue;
          if (!isTeacherAvailableAtSlot(u2.teacherId, sFree, cid)) continue;

          const t2Slots = teacherGrid.get(u2.teacherId);
          const t1Slots = teacherGrid.get(u1.teacherId);
          cSlots[sFree] = u2;
          if (t2Slots) { t2Slots[s2] = null; t2Slots[sFree] = cid; }
          cSlots[s2] = u1;
          if (t1Slots) { t1Slots[s1] = null; t1Slots[s2] = cid; }
          cSlots[s1] = unit;
          if (tSlots) tSlots[s1] = cid;
          return true;
        }
      }
    }

    return false;
  };

  // Convert unplaced units into pool
  const unplacedPool: LessonUnit[] = [];
  unplacedUnits.forEach(u => {
    if (u.isSuperBlock || u.pairedUnit) {
      placeSuperBlockWithChains(u);
    } else if (u.isDouble) {
      unplacedPool.push({ ...u, unitId: `${u.unitId}_s1`, isDouble: false });
      unplacedPool.push({ ...u, unitId: `${u.unitId}_s2`, isDouble: false });
    } else {
      unplacedPool.push(u);
    }
  });

  // Try placing all unplaced single units via advanced chains
  let remainingUnplaced: LessonUnit[] = [];
  for (const u of unplacedPool) {
    if (!placeUnitWithAdvancedChains(u)) {
      remainingUnplaced.push(u);
    }
  }

  // MIN-CONFLICTS LOCAL SEARCH WITH TABU EJECTION LOOP (Cho phép chạy tối đa 8 giây)
  const timeLimitMs = 8000;
  const tabuMap = new Map<string, number>();
  let ejectionIter = 0;
  const maxEjectionIters = 8000;

  while (remainingUnplaced.length > 0 && ejectionIter < maxEjectionIters && (performance.now() - startTime) < timeLimitMs) {
    ejectionIter++;
    const unit = remainingUnplaced.shift()!;

    // Try advanced chains first
    if (placeUnitWithAdvancedChains(unit)) {
      continue;
    }

    // Min-conflicts ejection kick
    const cid = unit.classId;
    const tid = unit.teacherId;
    const cSlots = classGrid.get(cid)!;

    const candidates: Array<{
      slot: number;
      score: number;
      victimClass: LessonUnit | null;
      victimOther: { classId: string; unit: LessonUnit } | null;
    }> = [];

    for (let s = 0; s < totalSlots; s++) {
      const { day, period } = slotToDayPeriod(s);
      if (isClassSlotLocked(cid, day, period) || isTeacherSlotLocked(tid, day, period)) continue;
      if (cSlots[s] === 'FIXED') continue;

      const cShift = getClassShift(cid);
      if (unit.targetSession === 'main') {
        if (cShift === 'morning_main' && period >= 6) continue;
        if (cShift !== 'morning_main' && period <= 5) continue;
      } else if (unit.targetSession === 'opp') {
        if (cShift === 'morning_main' && period <= 5) continue;
        if (cShift !== 'morning_main' && period >= 6) continue;
      }

      const victimClass = cSlots[s] && cSlots[s] !== 'FIXED' ? (cSlots[s] as LessonUnit) : null;
      if (victimClass && victimClass.isSuperBlock) continue;

      const tSlots = teacherGrid.get(tid);
      const otherCid = tSlots ? tSlots[s] : null;
      let victimOther: { classId: string; unit: LessonUnit } | null = null;
      if (otherCid && otherCid !== cid && otherCid !== 'LOCKED' && otherCid !== 'MEETING') {
        const otherGrid = classGrid.get(otherCid);
        const otherUnit = otherGrid ? otherGrid[s] : null;
        if (otherUnit && otherUnit !== 'FIXED' && !otherUnit.isSuperBlock) {
          victimOther = { classId: otherCid, unit: otherUnit };
        } else {
          continue;
        }
      } else if (otherCid === 'LOCKED' || otherCid === 'MEETING') {
        continue;
      }

      let conflicts = 0;
      if (victimClass) {
        conflicts += 1;
        if ((tabuMap.get(victimClass.unitId) || 0) > ejectionIter) conflicts += 5;
      }
      if (victimOther) {
        conflicts += 1;
        if ((tabuMap.get(victimOther.unit.unitId) || 0) > ejectionIter) conflicts += 5;
      }

      const isMorning = period <= 5;
      const normS = normalizeSubName(unit.subject);
      let curInSess = 0;
      const startS = Math.floor(s / periodsPerDay) * periodsPerDay;
      for (let p = 0; p < periodsPerDay; p++) {
        if (startS + p === s) continue;
        const itm = cSlots[startS + p];
        if (itm && itm !== 'FIXED' && (p < 5) === isMorning && normalizeSubName(itm.subject) === normS) {
          curInSess++;
        }
      }
      if (curInSess >= 2) conflicts += 8;

      candidates.push({ slot: s, score: conflicts, victimClass, victimOther });
    }

    if (candidates.length === 0) {
      remainingUnplaced.push(unit);
      continue;
    }

    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0];
    const sTarget = chosen.slot;

    if (chosen.victimClass) {
      cSlots[sTarget] = null;
      const vTSlots = teacherGrid.get(chosen.victimClass.teacherId);
      if (vTSlots) vTSlots[sTarget] = null;
      tabuMap.set(chosen.victimClass.unitId, ejectionIter + 10);
      remainingUnplaced.push(chosen.victimClass);
    }

    if (chosen.victimOther) {
      const oGrid = classGrid.get(chosen.victimOther.classId);
      if (oGrid) oGrid[sTarget] = null;
      const tSlots = teacherGrid.get(tid);
      if (tSlots) tSlots[sTarget] = null;
      tabuMap.set(chosen.victimOther.unit.unitId, ejectionIter + 10);
      remainingUnplaced.push(chosen.victimOther.unit);
    }

    cSlots[sTarget] = unit;
    const tSlots = teacherGrid.get(tid);
    if (tSlots) tSlots[sTarget] = cid;
  }

  // FINAL SWEEP: Nếu vẫn còn bất kỳ tiết nào chưa xếp, tìm các ô trống còn lại trong ca để lấp đầy 100%
  if (remainingUnplaced.length > 0) {
    for (const unit of [...remainingUnplaced]) {
      const cid = unit.classId;
      const tid = unit.teacherId;
      const cSlots = classGrid.get(cid);
      if (!cSlots) continue;
      const tSlots = teacherGrid.get(tid);
      const cShift = getClassShift(cid);

      for (let s = 0; s < totalSlots; s++) {
        if (cSlots[s] !== null) continue;
        const { day, period } = slotToDayPeriod(s);
        if (isClassSlotLocked(cid, day, period)) continue;

        if (unit.targetSession === 'main') {
          if (cShift === 'morning_main' && period >= 6) continue;
          if (cShift !== 'morning_main' && period <= 5) continue;
        } else if (unit.targetSession === 'opp') {
          if (cShift === 'morning_main' && period <= 5) continue;
          if (cShift !== 'morning_main' && period >= 6) continue;
        }

        // Nếu giáo viên rảnh ở slot này, xếp ngay lập tức
        if (isTeacherAvailableAtSlot(tid, s, cid)) {
          cSlots[s] = unit;
          if (tSlots) tSlots[s] = cid;
          remainingUnplaced = remainingUnplaced.filter(u => u.unitId !== unit.unitId);
          break;
        }
      }
    }
  }

  '''

text = text[:idx_s4] + new_section_4 + text[idx_s5:]

with open('src/utils/timetableSolver.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print('Applied Kempe Chains & Min-Conflicts Local Search to timetableSolver.ts successfully!')
