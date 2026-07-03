-- 010_generalize_orders.sql
-- Generalize card_orders -> orders to support card_purchase, course_fee, membership_fee

-- 1. Rename table (preserves all policies, indexes, FKs, triggers)
ALTER TABLE card_orders RENAME TO orders;

-- 2. Add order_type discriminator
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'card_purchase';
ALTER TABLE orders ADD CONSTRAINT orders_type_chk
  CHECK (order_type IN ('card_purchase', 'course_fee', 'membership_fee'));

-- 3. Add generalized amount column (for course_fee / membership_fee totals)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount integer;

-- 4. Add course_group_id FK (for course_fee orders)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS course_group_id uuid REFERENCES course_groups(id);

-- 5. Backfill amount from total_amount for existing card_purchase rows
UPDATE orders SET amount = total_amount WHERE amount IS NULL;

-- 6. Backfill order_type explicitly (DEFAULT covers it, but be safe)
UPDATE orders SET order_type = 'card_purchase' WHERE order_type = 'card_purchase';

-- 7. Add status CHECK that includes 'rejected' (no prior status CHECK existed)
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('pending', 'remitted', 'confirmed', 'rejected', 'cancelled'));

-- NOTE: RLS policies, card_transactions_order_id_fkey, and indexes
-- auto-follow the RENAME and do NOT need to be recreated.
