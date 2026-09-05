-- Jawwid Chat -- seeded config defaults.
--
-- EVERY value here is an initial hypothesis (brief SS12). None of them is a
-- product commitment. They are seeded so the engines have something to read on
-- day one and so the manager settings UI has a complete key list to render.
--
-- Values taken directly from the brief are marked [brief]. Values the brief
-- names but does not fix are marked [hypothesis] and MUST be reviewed with
-- operations before launch.

insert into chat.config (key, value, scope, description) values

-- Scheduling ---------------------------------------------------------------
-- [hypothesis] The brief gives shift wall-clock times but never states the
-- timezone. Every shift/coverage/absence comparison resolves against this key.
-- Confirm with operations before launch; changing it re-times every shift.
('schedule.timezone', '"Africa/Cairo"', 'schedule',
 'IANA timezone all shift and coverage wall-clock times resolve against. INITIAL HYPOTHESIS - confirm with operations.'),

-- Attention model (brief SS6) -----------------------------------------------
('attention.points.unanswered_base', '30', 'attention',
 '[brief] Customer message unanswered.'),
('attention.points.unanswered_per_minute', '1', 'attention',
 '[brief] Added per minute of waiting.'),
('attention.points.unanswered_wait_cap', '40', 'attention',
 '[brief] Cap on the per-minute waiting component.'),
('attention.points.class_soon', '40', 'attention',
 '[brief] Class in progress or within the class window AND a message exists.'),
('attention.points.blocking', '35', 'attention',
 '[brief] Blocking issue.'),
('attention.points.payment_failed', '20', 'attention',
 '[brief] Payment failed inside the payment window.'),
('attention.points.renewal_window', '10', 'attention',
 '[brief] Renewal due within the renewal window.'),
('attention.points.renewal_urgent', '25', 'attention',
 '[brief] Renewal due within the urgent renewal window (owner only).'),
('attention.points.complaint_open', '25', 'attention',
 '[brief] Complaint case open.'),
('attention.points.complaint_high_extra', '15', 'attention',
 '[brief] Additional points when complaint severity is high.'),
('attention.points.family_at_risk', '15', 'attention',
 '[brief] Family state is at_risk.'),
('attention.points.repeat_case', '15', 'attention',
 '[brief] Same case type within the repeat window.'),
('attention.points.sla_70pct', '20', 'attention',
 '[brief] Response target 70% elapsed.'),
('attention.points.sla_breached', '40', 'attention',
 '[brief] Response target breached.'),
('attention.points.follow_up_due', '10', 'attention',
 '[brief] Follow-up due now.'),
('attention.points.manual_urgent', '50', 'attention',
 '[brief] Manual urgent flag or escalated.'),
('attention.tier_multiplier.priority', '1.2', 'attention',
 '[brief] Multiplier (not an addition) for tier=priority families.'),
('attention.tier_multiplier.standard', '1.0', 'attention',
 '[brief] Implied by SS6: standard families are unmultiplied.'),
('attention.bucket.now', '60', 'attention',
 '[brief] Score at or above which a family is in the NOW bucket.'),
('attention.bucket.today', '25', 'attention',
 '[brief] Score at or above which a family is in the TODAY bucket.'),
('attention.class_window_minutes', '30', 'attention',
 '[brief] "within 30 min" of a class.'),
('attention.payment_failed_window_hours', '48', 'attention',
 '[brief] "payment failed within 48h".'),
('attention.renewal_window_days', '14', 'attention',
 '[brief] Renewal window opens this many days before renewal.'),
('attention.renewal_urgent_days', '3', 'attention',
 '[brief] Renewal escalates to the urgent points at this many days out.'),
('attention.repeat_case_window_days', '30', 'attention',
 '[brief] "same case type within 30 days".'),

-- Response targets, in minutes (brief SS6) ----------------------------------
('response_target.now_blocking.day', '10', 'sla', '[brief] NOW-blocking, day shift.'),
('response_target.now_blocking.night', '15', 'sla', '[brief] NOW-blocking, night shift.'),
('response_target.now_blocking.friday', '20', 'sla', '[brief] NOW-blocking, Friday.'),
('response_target.now_other.day', '30', 'sla', '[brief] NOW-other, day shift.'),
('response_target.now_other.night', '45', 'sla', '[brief] NOW-other, night shift.'),
('response_target.now_other.friday', '60', 'sla', '[brief] NOW-other, Friday.'),
('response_target.sla_risk_pct', '0.7', 'sla',
 '[brief] Fraction of the target at which a case counts as at risk.'),

-- Workload engine (brief SS7) ----------------------------------------------
('workload.weights.needs_reply', '1.0', 'workload', '[brief]'),
('workload.weights.active_case', '1.0', 'workload', '[brief]'),
('workload.weights.follow_up_due_today', '0.7', 'workload', '[brief]'),
('workload.weights.sla_risk', '1.5', 'workload', '[brief]'),
('workload.weights.waiting_internal', '0.3', 'workload', '[brief]'),
('workload.weights.renewal_in_window', '0.5', 'workload', '[brief]'),
('workload.weights.complaint_open', '1.5', 'workload', '[brief]'),
('workload.weights.technical_open', '1.2', 'workload', '[brief]'),
('workload.weights.at_risk_family', '0.8', 'workload', '[brief]'),
('workload.level.medium', '8', 'workload',
 '[brief] Score below this is LOW.'),
('workload.level.high', '15', 'workload',
 '[brief] Score at or above this is HIGH.'),
('workload.reply_burst', '6', 'workload',
 '[hypothesis] needs_reply count that forces HIGH regardless of score. The brief names config.reply_burst but does not fix a number.'),

-- Coverage and handoff (brief SS4) -----------------------------------------
('handoff.grace_minutes', '15', 'coverage',
 '[hypothesis] Stickiness window after a staff reply. The brief names config.handoff.grace_minutes but does not fix a number.'),
('absence.auto_detect_minutes', '45', 'coverage',
 '[hypothesis] In-shift inactivity with families waiting that warns the manager. Suggestion only - never auto-activates a backup (brief SS4).'),
('shift.end_banner_minutes', '30', 'coverage',
 '[hypothesis] How long before shift end the owner sees the wrap-up banner. The brief says "N minutes".'),
('assist.min_wait_fraction', '0.5', 'coverage',
 '[brief] "waited > 50% of response target" before reply-as-assist is allowed.'),

-- Case lifecycle and automation (brief SS9) --------------------------------
('cases.owner_locked_types', '["renewal","cancellation","onboarding","at_risk"]', 'cases',
 '[brief] Relationship case types that are automatically owner-locked. Complaints are owner-locked only at severity=high, which is handled separately.'),
('cases.owner_locked_complaint_severity', '"high"', 'cases',
 '[brief] complaint[severity=high] is owner-locked.'),
('lifecycle.renewal_due_days_before', '14', 'lifecycle',
 '[brief] renewal_due_days_before.'),
('lifecycle.inactivity_days', '14', 'lifecycle',
 '[brief] Days without attendance before a family becomes at_risk.'),
('timers.no_reply_reminder_hours', '[24, 72]', 'lifecycle',
 '[brief] No-reply reminder schedule.'),
('timers.auto_resolve_hours', '168', 'lifecycle',
 '[brief] Operational auto-resolve. Never applies to owner-locked types.'),
('reopen.window_hours', '72', 'lifecycle',
 '[brief] resolved -> closed after this window; a customer message inside it reopens the case.'),
('automation.batch_ack_seconds', '60', 'lifecycle',
 '[brief] Batch wait before acknowledging multiple rapid messages.');
