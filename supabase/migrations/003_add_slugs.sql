-- ============================================================
-- Migration 003: Auto-generated Short Slugs
-- ============================================================

-- 1. Create a function to generate a random 8-character string
CREATE OR REPLACE FUNCTION public.generate_short_id()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 2. Add slug column to course_groups with auto-generation
ALTER TABLE public.course_groups ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE DEFAULT public.generate_short_id();
CREATE INDEX IF NOT EXISTS idx_course_groups_slug ON public.course_groups(slug);

-- 3. Add slug column to courses with auto-generation
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE DEFAULT public.generate_short_id();
CREATE INDEX IF NOT EXISTS idx_courses_slug ON public.courses(slug);

-- 4. Set slugs for existing records (Optional, based on names)
UPDATE public.course_groups SET slug = '2026-h1' WHERE id = 'a0000001-0000-0000-0000-000000000002';
-- If you have other generic records, they will keep their auto-generated defaults.
