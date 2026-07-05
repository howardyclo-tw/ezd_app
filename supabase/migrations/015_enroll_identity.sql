ALTER TABLE courses ADD COLUMN enroll_full_identity TEXT NOT NULL DEFAULT 'all' CHECK (enroll_full_identity IN ('all','member'));
ALTER TABLE courses ADD COLUMN enroll_single_identity TEXT NOT NULL DEFAULT 'all' CHECK (enroll_single_identity IN ('all','member'));
