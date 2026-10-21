/// PD-17: a child's Student Profile, as their own teacher reads it from
/// `GET /learners/:id/profile`.
///
/// Deliberately the teacher's half and nothing more. The administration gets more
/// from the same endpoint (the child's date of birth, the family), and this type has
/// no field to hold any of it: a teacher must never see a parent's profile or anything
/// about money, and a client that never models those facts cannot render or cache them.
class StudentProfile {
  const StudentProfile({
    required this.id,
    required this.name,
    this.avatarUrl,
    this.age,
    this.courseName,
    this.teacherName,
    this.schedule = const [],
  });

  final String id;
  final String name;
  final String? avatarUrl;

  /// Whole years, worked out by the server; null when it holds no date of birth.
  final int? age;
  final String? courseName;

  /// The teacher the child is assigned to -- the viewer themselves, today.
  final String? teacherName;
  final List<StudentProfileSlot> schedule;
}

/// One regular weekly lesson: ISO [weekday] 1 (Monday)..7, [start] 'HH:MM' in [timezone].
class StudentProfileSlot {
  const StudentProfileSlot({
    required this.weekday,
    required this.start,
    required this.durationMinutes,
    this.timezone,
  });

  final int weekday;
  final String start;
  final int durationMinutes;
  final String? timezone;
}
