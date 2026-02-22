-- Migration 009: Refine System Config
-- Unified Chinese descriptions and date format enforcement

-- 1. Update descriptions for better clarity and consistency
UPDATE public.system_config SET description = '控制學生是否可以於個人中心申請購買堂卡' WHERE key = 'card_purchase_open';
UPDATE public.system_config SET description = '開放申請購卡的起始日期 (YYYY-MM-DD)' WHERE key = 'card_purchase_start';
UPDATE public.system_config SET description = '申請購卡的最後截止日期 (YYYY-MM-DD)' WHERE key = 'card_purchase_end';
UPDATE public.system_config SET description = '具備有效社員身份者，購買堂卡的每張單價 (NT$)' WHERE key = 'card_price_member';
UPDATE public.system_config SET description = '一般學員或會籍過期者，購買堂卡的每張單價 (NT$)' WHERE key = 'card_price_non_member';
UPDATE public.system_config SET description = '單筆購卡申請的最少張數限制' WHERE key = 'card_min_purchase';
UPDATE public.system_config SET description = '堂卡固定於每年年底何時失效 (1-12 月)' WHERE key = 'card_expire_month';
UPDATE public.system_config SET description = '購卡頁面顯示的銀行名稱、分行、代碼與帳號' WHERE key = 'bank_info';

-- 2. Ensure date keys exist
INSERT INTO public.system_config (key, value, description)
VALUES 
  ('card_purchase_start', '', '開放申請購卡的起始日期 (YYYY-MM-DD)'),
  ('card_purchase_end', '', '申請購卡的最後截止日期 (YYYY-MM-DD)')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- 3. Add CHECK constraint to enforce date format for start/end keys
-- This ensures that these "text" fields in the DB must behave like dates
ALTER TABLE public.system_config DROP CONSTRAINT IF EXISTS check_config_date_format;
ALTER TABLE public.system_config ADD CONSTRAINT check_config_date_format 
  CHECK (
    (key NOT IN ('card_purchase_start', 'card_purchase_end')) OR 
    (value = '') OR 
    (value ~ '^\d{4}-\d{2}-\d{2}$')
  );
