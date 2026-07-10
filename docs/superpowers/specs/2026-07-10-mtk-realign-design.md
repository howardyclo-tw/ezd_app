# MTK 需求再對齊 — 設計規格 v2

> 2026-07-10。承接 `2026-07-02-mtk-features-design.md`（原 spec）+ `2026-07-05-mtk-ux-addendum.md`（UX 補充）。
> 客戶於 2026-07-08 提供更新需求；本文件記錄 gap analysis → 對抗式審查 → v2 修訂。
> 審查歷程：3x Opus max（併發/金流/一致性）→ Fable max（安全/複雜度）→ GO conditional。
> 安全先決條件 S0 已完成（migration 016, commit 62abe78）。

## 0. 變更摘要

| # | 機制 | 來源 | 狀態 |
|---|------|------|------|
| 1 | 候補排隊 (waitlist) | 客戶需求反轉 #11 | 新增 |
| 2 | 入社費合併報名 (membership combined) | 客戶需求 | 設計修訂 |
| 3 | 身分分段時窗 (staggered windows) | 客戶需求 | 新增 |
| 4 | 幹部提前報名 (admin early-bird) | 客戶需求 | 新增 |
| 5 | 設定頁分頁重整 (settings tabs) | 客戶需求 | 新增 |
| 6 | 繳費期限 (payment deadline) | 已有獨立 spec | 引用 |
| 7 | Contingency invariant | 對抗式審查修正 | 設計修訂 |
| 8 | RLS 寫入封鎖 | 安全審查 | S0 已完成 |

## 1. 候補排隊引擎（反轉 #11）

### 1.1 動機

原 #11 決議「不做候補遞補鏈」。客戶 2026-07-08 更新：候補需支援整期+單堂，額滿時加入候補，有人取消/被取消時自動遞補。

### 1.2 資料模型

```
courses:
  waitlist_enabled  BOOLEAN NOT NULL DEFAULT false
```

現有 `enrollments.status = 'waitlist'` 和 `waitlist_position` 欄位已存在（Phase 3.4 建立）。

### 1.3 報名端

- `enroll_atomic` RPC 新增 `p_allow_waitlist BOOLEAN DEFAULT false` 參數
- 額滿 + `waitlist_enabled` + `p_allow_waitlist` → status='waitlist', waitlist_position=max+1
- 額滿 + 不允許候補 → 拒絕（現有行為）
- caller（submitGroupEnrollment / batchEnrollInSessions）根據 `courses.waitlist_enabled` 傳入

### 1.4 遞補端

- `promote_from_waitlist(p_course_id, p_session_id)` RPC：
  - SELECT 該課最小 waitlist_position 且 status='waitlist' 的 enrollment FOR UPDATE SKIP LOCKED
  - 若為 card 模式 → 嘗試 FIFO 扣卡；扣卡失敗（餘額不足）→ 該人留在 waitlist 不動，嘗試下一順位
  - 若為 ntd 且 price > 0 → status='pending_payment'（建 course_fee order）
  - 若為 free 或 ntd price=0 → status='enrolled'
  - 清除 waitlist_position
- **觸發點**（seats freed）：cancelEnrollment, cancelOrder（cascade）, rejectOrder（cascade）, expireEnrollment（繳費期限）
- **不觸發**：confirmOrder（不釋位）、MV 開票取消（Phase 6 另設計）

### 1.5 UI

- **學員**：額滿 + waitlist_enabled → 按鈕「加入候補」（非「額滿」）；候補中 → 我的課程顯示「候補中（第 N 順位）」
- **幹部**：名冊 waitlist 區塊顯示順位+人數；課程表單 waitlist_enabled toggle

### 1.6 測試

- H：額滿 → 候補 → 取消佔位者 → 自動遞補至 enrolled
- H：候補 card mode → 扣卡遞補成功
- A：候補 card mode 卡不夠 → 跳過，遞補下一位
- A：waitlist_enabled=false → 額滿拒絕（現有行為不變）

## 2. 入社費合併報名

### 2.1 動機

客戶需求：非社員報名時可同時繳入社費，一次完成繳費審核。

### 2.2 現有基礎

- `orders.include_membership BOOLEAN` 欄位已存在於 live DB（card_purchase 建單時已支援）
- `confirmOrder` card_purchase 分支已有 `grantMembership` 邏輯（grant role + group）

### 2.3 擴展設計

**Single carrier rule**：一次報名送出（submitGroupEnrollment）中，只有一筆 order 攜帶 `include_membership=true` + 入社費金額。

- 送出時 wizard 勾選「同時加入社員」→ 第一筆需建訂單的 enrollment 之 order 加上 `include_membership=true` + 1800
- 該 order 成為 **carrier**：確認此 order 時呼叫統一 `grantMembership()` 啟用社員身分

**Contingency invariant（v2 對抗式審查修正）**：
- 非社員勾選入社 → 所有 enrollment 的 effectiveIsMember=true（享社員價）
- 但這些 enrollment 都是 **non-terminal**（pending_payment），直到 carrier order confirmed 才升為 enrolled
- 若 carrier 被取消/駁回 → 所有關聯 enrollment 連帶取消（已有 cascade 機制）
- 效果：不可能享社員價卻不付入社費

**grantMembership() 統一 helper**：
```typescript
async function grantMembership(userId: string, adminClient: SupabaseClient) {
  // 1. 更新 role → member（如果不是 admin）
  // 2. 分配到最新 member_group（如果尚未有）
  // 3. 設定 member_valid_until = group.valid_until
}
```
- 呼叫點：confirmOrder（任何 order_type 只要 include_membership=true）

### 2.4 Schema 變更

`include_membership` 欄位已存在但不在 repo migration 中（drift S-9）。Migration 017 補正式定義。

### 2.5 測試

- H：非社員報名 + 入社 → pending_payment + order(include_membership, 含 1800) → confirm → enrolled + member
- A：carrier 取消 → 所有 enrollment 取消 + 不授予社員
- A：已是社員勾選入社 → 不重複收費（include_membership=false）

## 3. 身分分段時窗

### 3.1 動機

客戶需求：報名窗口先開放社員，非社員延後 N 天。

### 3.2 資料模型

```
courses:
  nonmember_delay_days  INTEGER NULL  -- NULL = 不延後（所有人同時開放）
```

### 3.3 守衛邏輯

修改 `guardGroupPhase1Window` 和 `guardCourseWindow`：
- `effective_start = window_start + (isMember ? 0 : nonmember_delay_days ?? 0)`
- 只影響「尚未開始」檢查，不影響「已截止」（截止時間對所有人相同）
- admin 不受此延後影響（見 §4）

### 3.4 UI

- 學員（非社員）：按鈕文案「社員優先報名中，MM/DD 開放」
- 幹部：課程表單新增「非社員延後天數」欄位

### 3.5 測試

- H：非社員在延後期間內被擋 → 延後到期後可報
- A：社員在原始開始時間即可報（不受 delay 影響）
- A：admin 不受 delay 影響

## 4. 幹部提前報名（Admin Early-Bird）

### 4.1 動機

客戶需求：幹部可在報名時段開始前就報名（先行作業），但其他守衛（容量/價格/身分限制）仍然套用。

### 4.2 實作

修改所有時窗守衛（guardGroupPhase1Window, guardCourseWindow）：
```typescript
// admin 跳過「尚未開始」，但不跳過「已截止」和其他守衛
if (isAdmin && guardType === 'not_started') continue;
```

### 4.3 scope

- **跳過**：window "not yet started" check ONLY
- **不跳過**：capacity, pricing, eligibility, closed window, all other guards
- admin 判定 = `profile.role === 'admin'`

### 4.4 測試

- H：admin 在報名開始前可報名
- A：admin 額滿仍被擋
- A：admin 報名截止後仍被擋

## 5. 設定頁分頁重整

### 5.1 動機

客戶需求：設定頁目前是平面網格（9 個 key），隨著功能增加需要分類。

### 5.2 設計

三個 Tab：

| Tab | Keys |
|-----|------|
| 購卡設定 | card_purchase_mode, card_purchase_open, card_purchase_start, card_purchase_end, card_price_member, card_price_non_member, card_min_purchase, card_purchase_unit |
| 繳費設定 | bank_info |
| 系統設定 | （未來新增 key 的預留區） |

- 沿用現有 `system_config` 表 + `KNOWN_KEYS` registry
- Tab 組件用 shadcn Tabs（已有使用慣例）
- URL 不帶 tab state（設定頁非常短，不需 deep-link）

### 5.3 測試

純 UI 重排，無邏輯變更。視覺審查 + smoke test。

## 6. 繳費期限

引用已有獨立規格：`docs/superpowers/specs/2026-07-07-payment-deadline-design.md`。

**修正事項**：
- Migration 編號 016 → **018**（016=RLS hardening 已佔，017=include_membership+waitlist+staggered）
- S-5 expire race 不另處理：lazy check + cron 足夠，不需要 advisory lock

## 7. Security（S0 已完成）

Migration 016 `rls_hardening.sql`（commit 62abe78）：
- DROP 所有 client write policies on profiles/enrollments/orders
- REVOKE EXECUTE on enroll_atomic / void_group_submission from anon+authenticated
- 4 write paths migrated to adminClient
- Dead code deleted（updateUserRole + DevRoleToggle）

## 8. Migration 規劃

| # | 名稱 | 內容 |
|---|------|------|
| 016 | rls_hardening | ✅ 已完成（S0） |
| 017 | realign_schema | include_membership 正式定義（backfill existing）、courses.waitlist_enabled、courses.nonmember_delay_days、promote_from_waitlist RPC、enroll_atomic v2（p_allow_waitlist） |
| 018 | payment_deadline | course_groups.payment_deadline_days、enrollments.payment_deadline_at（已有 spec） |
| 019 | settings_seed | system_config seed missing keys + card_purchase_unit default=3（客戶確認） |

## 9. 實作順序

1. **引擎先**：017 migration + waitlist + staggered + admin early-bird + membership combined → server actions + RPC
2. **繳費期限**：018 migration + lazy check + cron
3. **MV 投票後**：Phase 6（依賴引擎完成）
4. **UI 最後**：settings tabs + 候補 UI + staggered UI

## 10. 對既有 spec 的影響

| 原 spec 段落 | 變更 |
|-------------|------|
| §6 報名引擎 | 加入 waitlist 路徑 + staggered window + admin bypass |
| §7 精靈 | include_membership 勾選 UI + carrier order 邏輯 |
| §8 MV 開票 | 開票取消不觸發 waitlist 遞補（另行設計） |
| §11 審核中心 | confirmOrder grantMembership 統一 |
| 繳費期限 spec | migration 編號修正 016→018 |
| UX addendum | 候補狀態可見性（學員+幹部） |
