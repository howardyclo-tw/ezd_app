# EZD App — System Reference

> AI 及開發者快速掌握系統狀態用。業務規則詳見 `prd.md`。

---

## 架構概覽

| 層級 | 技術 |
|------|------|
| 前端 | Next.js 16 (App Router), React, Tailwind, Shadcn UI |
| 後端 | Supabase (PostgreSQL + Auth + RLS), Next.js Server Actions |
| 部署 | Vercel (hnd1, Tokyo), Supabase (ap-northeast-1) |
| 驗證 | Supabase Auth (admin API, 不走 email 驗證), 僅 @mediatek.com |

---

## 功能狀態總覽

### ✅ 已完成

| 功能 | 關鍵檔案 | 備註 |
|------|---------|------|
| 使用者註冊/登入 | `register-form.tsx`, `actions.ts` | Admin API 建帳, 預設密碼 mediatek |
| 年度群組 (社員效期) | `member_groups` 表, `members-client.tsx` | 取代 member_valid_until |
| 成員管理 | `admin/members/page.tsx`, `members-client.tsx` | 角色/群組/堂卡/補課額度/課程列表/重置密碼 |
| 資料匯入工具 | `import-client.tsx`, `import-actions.ts` | 成員/堂卡/課程資訊/學員名單, RFC 4180 CSV |
| 課程檔期管理 | `course-form.tsx`, `actions.ts` | 建立/編輯/刪除檔期, 課程 CRUD |
| 堂卡系統 | `card-utils.ts`, `my-cards-client.tsx` | FIFO 扣卡, 有效期限, 卡池追蹤 |
| 整期報名 | `group-enrollment-dialog.tsx` | 批次報名多門課, 堂卡扣除 |
| 單堂報名 | `session-enrollment-dialog.tsx` | 逐堂 FIFO 扣卡 |
| 點名系統 | `course-detail-client.tsx` | 聚焦模式, 未來堂次警告 |
| 請假 | `actions.ts` submitLeaveRequest | 自動核准, 補課/轉入學員可請假 |
| 轉讓 | `actions.ts` submitTransferRequest | 候選人排除邏輯, 社員限制 |
| 補課 | `actions.ts` internalSubmitMakeupRequest | 1/4 cap + 幹部贈予額度 |
| 堂卡購買 | `my-cards-client.tsx`, `actions.ts` | 匯款資訊, 幹部核准/駁回 |
| 我的課程 | `my-courses-client.tsx` | 即將到來/可用補課/歷史紀錄 |
| 審核中心 | `approvals-tabs-client.tsx` | 堂卡/請假/補課/轉讓審核 |
| 開發者工具 | `dev-role-toggle.tsx`, `header.tsx` | 僅限特定 email, server-side 驗證 |

### 🔲 未實作 / 待優化

| 功能 | 說明 |
|------|------|
| 候補名單遞補 | 請假/取消後自動通知候補者 |
| 推播通知 | 請假/轉讓/補課核准通知 |
| QR Code 點名 | 班長掃碼點名 |
| 堂卡原子操作 | 扣卡用 DB RPC 防止 race condition |
| 取消報名退卡 | cancelEnrollment 目前不退堂卡 |
| card_balance >= 0 約束 | DB CHECK constraint |
| 課程意向調查 | SurveyCake 替代 |
| 年度行事曆 | 課務規劃工具 |

---

## 關鍵業務邏輯

### 堂卡扣除

```
原則：堂卡必須在上課當天仍然有效
- 單堂報名：逐堂用該堂日期檢查, FIFO 先扣最快到期
- 整期報名：用最後一堂日期檢查, 一次性扣除
- 過期判斷：card_orders.expires_at >= 上課日期
- 追蹤方式：card_orders.used 欄位
```

### 補課額度

```
可用補課 = min(未使用缺席數, ceil(堂數/4) - 已用) + 幹部贈予額度
- 1/4 規則是 CAP，不是點數（需要實際缺席才能用）
- 幹部贈予 (profiles.makeup_quota) 不需缺席，直接可用
- 請假/轉讓不歸還已核准的補課額度
- 不能對過去堂次申請補課或請假
```

### 社員效期

```
- member_groups 表管理年度群組 (如 "2026", valid_until=2026-12-31)
- profiles.member_group_id FK → 成員歸屬群組
- 幹部改群組到期日 → 自動影響所有成員
- 匯入/購卡含社員費 → 自動加入最新群組
```

### 角色與權限

```
roles: admin (幹部), member (社員), guest (非社員)
- 不存在 leader role，班長由 course_leaders 表管理
- 幹部可做所有管理操作
- 班長可點名自己負責的課程
- 社員可報名/請假/轉讓/補課
- 非社員可報名（堂卡價格較高），不可接收常態課轉讓
```

---

## 關鍵技術決策

| 決策 | 原因 |
|------|------|
| Server Action + safe() wrapper | 生產環境隱藏錯誤細節, 開發環境顯示完整 |
| error.tsx boundary | 頁面載入失敗顯示友善提示 |
| card_orders.used 追蹤 | 比從 transactions 反算更直接, FIFO 排序依據 |
| 日期字串比較 (Asia/Taipei) | 避免 Date 物件 UTC 時區偏移 |
| attendance + makeup_requests/transfer_requests 雙來源 | attendance status 會被點名覆寫, requests 表是身份的 authoritative source |
| Supabase Admin Client (service role) | 繞過 RLS 做 auth user 管理, 堂卡扣除等 |

---

## DB 表結構速查

| 表 | 用途 | 關鍵欄位 |
|----|------|---------|
| profiles | 使用者 | role, member_group_id, card_balance, makeup_quota |
| member_groups | 年度群組 | name, valid_until |
| courses | 課程 | type, teacher, cards_per_session, capacity |
| course_groups | 課程檔期 | title, period_start/end |
| course_sessions | 堂次 | course_id, session_date |
| course_leaders | 班長 | course_id, user_id |
| enrollments | 報名 | type(full/single), status, session_id |
| card_orders | 堂卡池 | quantity, used, expires_at, status |
| card_transactions | 堂卡異動紀錄 | type, amount, balance_after |
| attendance_records | 出席 | status(present/absent/leave/makeup/transfer_in/transfer_out) |
| makeup_requests | 補課申請 | original/target session, quota_used, status |
| transfer_requests | 轉讓申請 | from/to user, session_id, status |
| leave_requests | 請假 | session_id, status |
| system_config | 系統設定 | key-value (定價/購買時段等) |
