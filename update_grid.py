import sys

with open("src/components/TimetableTab.tsx", "r", encoding="utf-8") as f:
    text = f.read()

# 1. CLASS TABLE
start_class_marker = "{/* Timetable Grid for Class */}"
end_class_marker = "{/* VIEW 2: BY TEACHER TIMETABLE */}"

start_class_idx = text.find(start_class_marker)
end_class_idx = text.find(end_class_marker)

if start_class_idx == -1 or end_class_idx == -1:
    print("Could not find class markers!", start_class_idx, end_class_idx)
    sys.exit(1)

print("Found class grid from", start_class_idx, "to", end_class_idx)

# 2. TEACHER TABLE
start_teacher_marker = "{/* Timetable Grid for Teacher */}"
end_teacher_marker = "{/* VIEW 3: MATRIX OVERVIEW BY CLASS */}"

start_teacher_idx = text.find(start_teacher_marker)
end_teacher_idx = text.find(end_teacher_marker)

if start_teacher_idx == -1 or end_teacher_idx == -1:
    print("Could not find teacher markers!", start_teacher_idx, end_teacher_idx)
    sys.exit(1)

print("Found teacher grid from", start_teacher_idx, "to", end_teacher_idx)
