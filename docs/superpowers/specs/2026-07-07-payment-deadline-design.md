# 繳費期限與逾期自動取消 — 設計規格

> 2026-07-07。搭配：主 spec `2026-07-02-mtk-features-design.md`、UX addendum、決策 log #34。
> 用戶確認決策：演唱會門票模型、按檔期設定、lazy check + cron 兩者結合。

## 0. 動機

用戶反映「報名佔位但不繳費」會長期卡住名額，影響其他學員報名。需要一個「演唱會門票」式的機制：報名後佔位，在指定期限內匯款，逾期自動取消並釋放名額。避免「一直佔位」。

## 1. 核心概念

**Concert ticket reservation model:**

```
學員報名 → 佔位 (pending_payment)
    ↓
系統計算截止: enrolled_at + deadline_days
    ↓
┌─ 學員在截止前匯款 → remitted → 正常審核流程
│
└─ 逾期未繳費 → cancelled (reason: 繳費逾期自動取消) → 名額釋放 → waitlist 遞補
```

**關鍵原則：**
- 已匯款 (order.status = 'remitted') 的 enrollment 永不被 deadline 取消（已表達繳費意願）
- NULL deadline = 不設限（向下相容，既有行為不變）
- 只影響 `pending_payment` 狀態的 enrollment

## 2. 資料模型

### 2.1 course_groups 新增欄位

| 欄位 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `payment_deadline_days` | `integer` | `NULL` | 報名後繳費期限（天數），NULL 表示不設期限 |

### 2.2 enrollments 新增欄位

| 欄位 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `payment_deadline_at` | `timestamptz` | `NULL` | 繳費截止時間，報名時計算 |

### 2.3 Migration 016

```sql
-- 016_payment_deadline.sql
ALTER TABLE course_groups ADD COLUMN payment_deadline_days integer;
ALTER TABLE enrollments ADD COLUMN payment_deadline_at timestamptz;
COMMENT ON COLUMN course_groups.payment_deadline_days IS '報名後繳費期限（天數），NULL = 不設期限';
COMMENT ON COLUMN enrollments.payment_deadline_at IS '繳費截止時間，enrolled_at + deadline_days 計算';
```

### 2.4 Type 更新

```typescript
// database.ts
interface CourseGroup {
  // ...existing
  payment_deadline_days: number | null;
}

interface Enrollment {
  // ...existing
  payment_deadline_at: string | null;  // ISO timestamptz
}
```

### 2.5 enroll_atomic RPC 修改

新增可選參數 `p_payment_deadline_at timestamptz DEFAULT NULL`，在 INSERT 時寫入 `enrollments.payment_deadline_at`。

## 3. Deadline 計算

### 3.1 時間規則

- `payment_deadline_at = enrolled_at + (payment_deadline_days × 24h)` interval
- 使用 **timestamptz** instant comparison（`new Date(deadline_at) > new Date()`），不轉時區字串
- 例：`deadline_days = 3`, `enrolled_at = 2026-07-07T10:00+08:00` → `deadline_at = 2026-07-10T10:00+08:00`

### 3.2 計算位置

**所有建立 `pending_payment` enrollment 的入口**都必須計算 deadline：

| 入口 | 情境 | deadline 來源 |
|------|------|------|
| `submitGroupEnrollment` | 整期報名精靈 | 直接從 group 讀取 |
| `resubmitGroupEnrollment` | 修改報名 | 重新計算（新 enrolled_at） |
| `batchEnrollInSessions` | 單堂加報 | 從 course → group_id → group 讀取 |
| `enrollInCourse` (legacy) | e2e-test-actions | 同上 |

```typescript
// 範例：submitGroupEnrollment 中
const deadlineDays = courseGroup.payment_deadline_days;
const deadlineAt = deadlineDays != null
  ? new Date(Date.now() + deadlineDays * 86400_000).toISOString()
  : null;

await adminClient.rpc('enroll_atomic', {
  // ...existing params
  p_payment_deadline_at: deadlineAt,
});
```

**注意：** `enrolled` 狀態（免費課/堂卡足夠即時成立）不需要 deadline。只有 `pending_payment` 的 enrollment 才設定 `payment_deadline_at`。

### 3.3 邊界情況

| 情境 | 行為 |
|------|------|
| `deadline_days = NULL` | 不計算 deadline，enrollment 永不過期 |
| 修改報名 (resubmit) | 新 enrollment 用新 `enrolled_at` 重算 deadline |
| 已匯款 (remitted) | 不受 deadline 影響（order.status = 'remitted' 跳過檢查） |
| 已確認 (enrolled) | 不受 deadline 影響 |
| `deadline_days = 0` | 伺服器端攔截（`updateCourseGroup` / `createCourseGroup` 中驗證 `> 0 OR NULL`） |
| 並發：deadline 到期 + 學員同時匯款 | expireEnrollment 先檢查 order.status；若已 remitted 則不取消 |

## 4. 到期執行機制

### 4.1 Lazy Check（頁面載入觸發）

**觸發頁面（server component data loading）：**
- `dashboard/my_cards/page.tsx`（我的購買）
- `dashboard/page.tsx`（個人中心）

**實作：**

```typescript
// In page.tsx data loading, after fetching user profile
const now = new Date();
const { data: expiredEnrollments } = await adminClient
  .from('enrollments')
  .select('id')
  .eq('user_id', user.id)
  .eq('status', 'pending_payment')
  .not('payment_deadline_at', 'is', null)
  .lt('payment_deadline_at', now.toISOString());

if (expiredEnrollments && expiredEnrollments.length > 0) {
  for (const e of expiredEnrollments) {
    await expireEnrollment(e.id);
  }
}
```

**特性：**
- 只處理當前用戶的 enrollments
- 在 page data loading 的**最前面**執行（其他 query 之前），確保後續渲染的資料已是最新狀態
- Await（不是 fire-and-forget），因為需要確保後續 order/enrollment query 反映已取消的狀態

### 4.2 Cron（Supabase Edge Function）

**Function: `expire-unpaid-enrollments`**

```typescript
// supabase/functions/expire-unpaid-enrollments/index.ts
// Schedule: every hour (0 * * * *)

Deno.serve(async (req) => {
  // 1. Query all expired pending_payment enrollments
  //    WHERE status = 'pending_payment'
  //      AND payment_deadline_at IS NOT NULL
  //      AND payment_deadline_at < NOW()
  //      AND linked order is NOT remitted
  
  // 2. For each: cancel enrollment + cancel order + release capacity + waitlist promote
  
  // 3. Return count
});
```

**排程：** 每小時執行一次（`0 * * * *`）

**注意：**
- Cron 做全域掃描（不限單一用戶）
- 必須檢查關聯 order 的狀態：`remitted` 的不取消
- 批次處理但每筆 enrollment 獨立 transaction（一筆失敗不影響其他）

### 4.3 Server Action: expireEnrollment

```typescript
// In actions.ts
export async function expireEnrollment(enrollmentId: string): Promise<void> {
  const adminClient = createAdminClient();
  
  // 1. Fetch enrollment + linked order
  const { data: enrollment } = await adminClient
    .from('enrollments')
    .select('id, status, order_id, course_id, user_id, payment_deadline_at')
    .eq('id', enrollmentId)
    .single();
  
  if (!enrollment || enrollment.status !== 'pending_payment') return; // idempotent
  if (!enrollment.payment_deadline_at) return;
  if (new Date(enrollment.payment_deadline_at) > new Date()) return; // not yet expired
  
  // 2. Check linked order — remitted = don't expire
  if (enrollment.order_id) {
    const { data: order } = await adminClient
      .from('orders')
      .select('status')
      .eq('id', enrollment.order_id)
      .single();
    if (order?.status === 'remitted') return; // student already paid, await admin review
  }
  
  // 3. Cancel enrollment
  await adminClient.from('enrollments').update({
    status: 'cancelled',
    cancel_reason: '繳費逾期自動取消',
    cancelled_at: new Date().toISOString(),
  }).eq('id', enrollmentId);
  
  // 4. Cancel linked order (if all siblings cancelled)
  if (enrollment.order_id) {
    const { data: siblings } = await adminClient
      .from('enrollments')
      .select('id, status')
      .eq('order_id', enrollment.order_id)
      .neq('status', 'cancelled');
    
    if (!siblings || siblings.length === 0) {
      await adminClient.from('orders').update({
        status: 'cancelled',
      }).eq('id', enrollment.order_id)
        .eq('status', 'pending'); // only cancel pending orders
    }
  }
  
  // 5. Waitlist promotion (reuse existing promoteSeatFromWaitlist if available)
  // ...existing waitlist logic
  
  // 6. revalidatePath
}
```

## 5. UI 變更

### 5.1 學員端

**我的購買 — 繳費紀錄 tab（my-cards-client.tsx）：**
- `pending` 訂單卡片新增繳費期限顯示：
  - 正常：`繳費期限：YYYY/MM/DD HH:mm`（灰色文字）
  - 即將到期（< 24h）：`⚠ 即將到期 — 剩 Xh Xm`（紅色文字 + animate-pulse）
  - 已逾期（理論上不會出現在 pending，因為 lazy check 已取消）

**報名精靈完成步驟（register-wizard-client.tsx）：**
- 若有 `pending_payment` 結果且 `payment_deadline_at` 不為 null：
  - 在 amber warning block 中追加：「請於 `MM/DD HH:mm` 前完成匯款，逾期將自動取消報名。」

**Dashboard（dashboard/page.tsx）：**
- 待辦提示中：若有即將到期的 enrollment，顯示「⚠ 最近到期：MM/DD」

**取消原因顯示（已有機制）：**
- `my_courses` 中已有 `cancel_reason` 顯示，「繳費逾期自動取消」會自動出現

### 5.2 幹部端

**群組設定（course-form / group-edit）：**
- 新增「繳費期限（天）」數字輸入欄位
- 說明：「學員報名後須在此天數內完成繳費，否則系統自動取消。留空=不設限。」
- 驗證：正整數或空，不允許 0

**繳費對帳（approvals/page.tsx）：**
- 訂單列表增加「繳費期限」欄位
- 即將到期：amber 背景
- 已逾期（理論上不出現，cron 已清理）

### 5.3 狀態顯示矩陣

| enrollment.status | order.status | deadline 狀態 | 學員看到 | 幹部看到 |
|---|---|---|---|---|
| pending_payment | pending | 未到期 | 待繳費（MM/DD 到期） | 待繳費（MM/DD 到期） |
| pending_payment | pending | 24h 內 | ⚠ 待繳費（即將到期！） | ⚠ 即將逾期 |
| pending_payment | remitted | 任何 | 已匯款待審核 | 待審核 |
| cancelled | cancelled | 已到期 | 已取消：繳費逾期 | 自動取消 |
| pending_payment | pending | 無 deadline | 待繳費 | 待繳費 |

## 6. 守衛與約束

1. **已匯款不取消**：`order.status = 'remitted'` → 跳過 deadline 檢查
2. **只對 pending_payment**：其他 enrollment 狀態不受影響
3. **冪等性**：重複呼叫 `expireEnrollment` 對已取消的 enrollment 無作用
4. **Order 連動**：只有當 order 的所有 enrollments 都已取消時才取消 order
5. **Waitlist promotion**：取消釋位後自動遞補 waitlist 第一位
6. **deadline_days = 0 禁止**：伺服器端驗證，幹部不可設為 0
7. **修改報名重算**：`resubmitGroupEnrollment` 的新 enrollment 用新時間重算 deadline

## 7. 測試計畫

### Happy Path

| ID | 測試 | 預期 |
|---|---|---|
| H1 | 幹部設定 `deadline_days = 3` → 學員報名 | enrollment 有 `payment_deadline_at` = enrolled_at + 3 days |
| H2 | 學員在 deadline 前匯款 | 正常審核流程，order → remitted → confirmed |
| H3 | 逾期 enrollment → page load 觸發 lazy check | enrollment → cancelled (reason: 繳費逾期自動取消)，名額釋放 |
| H4 | 幹部不設 deadline (NULL) | enrollment 無 deadline_at，永不過期 |

### Adversarial

| ID | 測試 | 預期 |
|---|---|---|
| A1 | 已匯款 (remitted) 的 enrollment 逾期 | 不被取消（order.status=remitted 保護） |
| A2 | 修改報名 (resubmit) 後 | 新 enrollment 有新 deadline（不沿用舊的） |
| A3 | 逾期取消後 waitlist 學員 | 正確遞補（capacity 重算、status → enrolled/pending_payment） |
| A4 | 並發：deadline 到期 + 學員同時匯款 | 若 order 已 remitted，不取消 |
| A5 | `deadline_days = 0` 設定 | 伺服器端拒絕（不允許 0） |

### Mutation Testing

| Guard | 移除效果 | 應 RED |
|---|---|---|
| `order.status === 'remitted' → return` | 已匯款也被取消 | A1 |
| `deadline_at > now → return` | 未到期也被取消 | H2 存活 |

## 8. 實作順序（建議）

1. Migration 016 + types 更新
2. `enroll_atomic` RPC 修改（新增 `p_payment_deadline_at`）
3. `submitGroupEnrollment` / `resubmitGroupEnrollment` 計算 + 傳入 deadline
4. `expireEnrollment` server action
5. Lazy check 加入頁面（my_cards, dashboard）
6. 學員 UI：繳費紀錄 deadline 顯示 + wizard done 提示
7. 幹部 UI：group 設定 deadline 欄位 + 對帳 deadline 顯示
8. Edge Function cron
9. E2E 測試（H1-H4, A1-A5, mutation）
