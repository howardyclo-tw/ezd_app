# 課程與上課名單批次匯入規格

> 管理員（admin）從 App 批次新增「課程」與「上課名單」時，建議的匯入方式與 CSV 格式。

---

## UI 放置建議與第一步

### 匯入功能要放哪裡？

**建議：放在 admin 後台，並和「課程管理」綁在一起。**

| 功能 | 建議路徑 | 說明 |
|------|----------|------|
| admin 後台入口 | `/admin` 或 `/admin/courses` | 僅 admin 角色可進入（middleware 或頁面內檢查 role） |
| 課程列表 | `/admin/courses` | 列出所有課程，可篩選狀態 |
| 新增／編輯課程 | `/admin/courses/new`、`/admin/courses/[id]/edit` | 表單一門一門新增或修改 |
| **匯入課程** | 課程列表頁上方或 Tab：「匯入課程」按鈕 → 上傳 CSV | 批次建立／更新課程 |
| 課程詳情＋名單 | `/admin/courses/[id]` | 顯示該課名單，可手動新增學員 |
| **匯入名單** | 課程詳情／名單區塊：「匯入名單」按鈕 → 上傳 CSV | 該課名單批次匯入 |

這樣「單筆新增／編輯」和「批次匯入」都在同一區，管理員不用換地方。

### 需要搭配「用 UI 新增課程」嗎？

**需要。** 建議同時有：

- **表單新增／編輯課程**：補一門課、改時間／名額、改狀態時不用動 CSV。
- **匯入課程 CSV**：期初或大量建課時一次匯入。

流程會是：**先有「課程列表 ＋ 表單新增一門課」**，再加「匯入課程」「匯入名單」。

### 第一步要先做什麼？（建議實作順序）

1. **建立資料表**  
   - `courses`（對齊本文件「課程 CSV」欄位）。  
   - 若有「班長只能點自己的班」：再建 `course_leaders`（course_id, user_id）。

2. **admin 後台＋課程列表**  
   - 路徑如：`/admin/courses`，僅 admin 角色可進。  
   - 呼叫 Supabase 讀取 `courses`，列表顯示（名稱、老師、堂數、名額、狀態等）。

3. **表單新增／編輯一門課**  
   - `/admin/courses/new`：必填欄位與「課程 CSV 欄位」一致（name, type, teacher, sessions_count, capacity, price_member, price_guest, first_session_at 等）。  
   - `/admin/courses/[id]/edit`：同一表單，預填既有資料後更新。

4. **課程詳情＋名單（可簡化先做列表）**  
   - `/admin/courses/[id]`：顯示課程資訊 ＋ 該課上課名單（需有 `course_rosters` 或 `enrollments` 表）。  
   - 名單可先「手動新增學員」（選人或輸入 email），不一定先做匯入。

5. **匯入課程 CSV**  
   - 在課程列表頁加「匯入課程」→ 選檔 → 解析 CSV → 寫入 `courses`，顯示成功／失敗筆數與錯誤行。

6. **匯入名單 CSV**  
   - 在課程詳情／名單區加「匯入名單」→ 選檔 → 以 email 對應使用者 → 寫入該課名單，來源標記為 manual。

**一句話：第一步 = 建表 + admin 後台「課程列表」+「表單新增一門課」，再來才是匯入課程／名單。**

---

## 一、匯入流程建議

### 建議：**分兩步匯入**（先課程、後名單）

1. **Step 1：匯入課程**  
   上傳「課程 CSV」→ 系統建立多筆課程（若同一檔內有重複課程名稱可視為更新或略過，見下方規則）。

2. **Step 2：匯入上課名單**  
   - **方式 A（推薦）**：在「某一門課」的詳情/名單頁點「匯入名單」→ 上傳「名單 CSV」（只含學員欄位），該 CSV 的學員全部加入這門課。  
   - **方式 B**：在 admin 後台「批次匯入名單」→ 上傳「名單 CSV」（含課程識別 + 學員），一檔可對應多門課。

原因：課程與名單是 1 對多，拆開較好驗證、錯誤時也較好排查（例如「課程 3 匯入失敗」「名單第 5 行 email 不存在」）。

---

## 二、課程 CSV 格式

### 檔名建議

`courses_import.csv` 或任意，副檔名 `.csv`，編碼 **UTF-8**（含中文時務必 UTF-8）。

### 欄位定義

| 欄位名稱（第一列） | 必填 | 說明 | 範例 |
|--------------------|------|------|------|
| `name`             | ✅   | 課程名稱 | 週三基礎律動 |
| `type`             | ✅   | 課程類型 | normal / trial / special / style / workshop / rehearsal / performance（或對應中文代碼） |
| `teacher`          | ✅   | 老師姓名 | 王小明 |
| `room`             | 選填 | 教室 | 舞蹈教室A |
| `sessions_count`   | ✅   | 堂數 | 8 |
| `capacity`         | ✅   | 名額上限 | 20 |
| `price_member`     | ✅   | 社員價（整數） | 2400 |
| `price_guest`      | ✅   | 非社員價（整數） | 3000 |
| `wiki_url`         | 選填 | Wiki 連結 | https://wiki.company.com/... |
| `status`           | 選填 | 狀態 | draft / published / closed（預設 draft） |
| `first_session_at` | ✅   | 第一堂上課日期時間（ISO 8601） | 2025-03-05T19:00:00 |
| `session_weekday`  | 選填 | 若每週固定同一天，填星期幾（1–7） | 3（週三） |
| `session_time`     | 選填 | 若每堂同時間，填時間（HH:mm） | 19:00 |

**說明：**

- 若「每週同一天、同一時間」：可只填 `first_session_at` + `sessions_count` + `session_weekday` + `session_time`，系統自動推算每堂日期。
- 若每堂日期不規則：可改為多欄 `session_1_at`, `session_2_at`, ... 或另提供「課程堂次日期」匯入（進階）。

### 課程 CSV 範例

```csv
name,type,teacher,room,sessions_count,capacity,price_member,price_guest,wiki_url,status,first_session_at,session_weekday,session_time
週三基礎律動,normal,王小明,舞蹈教室A,8,20,2400,3000,https://wiki.company.com/xxx,draft,2025-03-05T19:00:00,3,19:00
週五MV班,mv,李小華,舞蹈教室B,8,15,2400,3000,,draft,2025-03-07T20:00:00,5,20:00
```

### 匯入邏輯建議

- **同一檔案內**：以 `name`（或 name+first_session_at）辨識是否為同一門課；重複則「更新」或「略過並報錯」，由產品決定。
- **與資料庫既有課程**：若名稱+第一堂日期相同視為同一門課則更新，否則新增。
- 必填欄位缺漏：該行略過，並在結果頁列出錯誤行號與原因。

---

## 三、上課名單 CSV 格式

### 情境 A：在「單一課程」頁匯入該課名單

**檔名**：任意，例如 `roster_週三基礎律動.csv`  
**編碼**：UTF-8  

| 欄位名稱（第一列） | 必填 | 說明 | 範例 |
|--------------------|------|------|------|
| `email`            | ✅   | 學員 Email（與 Auth/Profile 對應） | user@company.com |
| `name`             | 選填 | 顯示名稱（若系統無此人會用於建立或顯示） | 王小明 |
| `employee_id`      | 選填 | 工號 | E12345 |

**範例：**

```csv
email,name,employee_id
user1@company.com,王小明,E001
user2@company.com,李小華,E002
```

**邏輯建議：**

- 以 `email` 對應 `auth.users` / `profiles`。若存在則直接加入名單；若不存在可選：**(1) 略過並列出**、**(2) 自動建立邀請/待註冊**（依產品決定）。
- 名單來源標記為 `manual`。

---

### 情境 B：一份 CSV 匯入「多門課」的名單

**檔名**：例如 `rosters_batch.csv`  
**編碼**：UTF-8  

| 欄位名稱（第一列） | 必填 | 說明 | 範例 |
|--------------------|------|------|------|
| `course_name`      | ✅   | 課程名稱（與已建立的課程完全一致） | 週三基礎律動 |
| `course_date`      | 選填 | 若同名稱多期，用第一堂日期區分（YYYY-MM-DD） | 2025-03-05 |
| `email`            | ✅   | 學員 Email | user@company.com |
| `name`             | 選填 | 顯示名稱 | 王小明 |
| `employee_id`      | 選填 | 工號 | E001 |

**範例：**

```csv
course_name,course_date,email,name,employee_id
週三基礎律動,2025-03-05,user1@company.com,王小明,E001
週三基礎律動,2025-03-05,user2@company.com,李小華,E002
週五MV班,2025-03-07,user1@company.com,王小明,E001
```

**邏輯建議：**

- 先以 `course_name`（+ `course_date`）解析出對應的 course_id，再逐行寫入名單；找不到課程的行略過並回報。
- 同一課程、同一 email 重複出現：視為同一筆（去重）或報錯，建議**去重**。

---

## 四、錯誤處理與回饋

建議匯入後一律顯示「匯入結果」：

- 成功：幾筆課程／幾筆名單成功。
- 失敗：列出行號、欄位、原因（例如：必填欄位空白、email 不存在、課程名稱找不到）。
- 可選：提供「錯誤行」下載 CSV，方便修正後再傳。

---

## 五、範本下載（建議實作）

在 App 提供：

- **課程匯入範本**：僅第一列欄位名稱 + 一列範例，其餘空白，讓管理員填寫後上傳。
- **名單匯入範本（單課）**：`email,name,employee_id` + 一列範例。
- **名單匯入範本（多課）**：`course_name,course_date,email,name,employee_id` + 一列範例。

可放在「admin 後台 → 課程管理 / 名單管理」的「匯入」按鈕旁，例如「下載範本.csv」。

---

## 六、與現有流程的銜接

- **SurveyCake / Excel 匯出**：若目前名單來自 SurveyCake，匯出時保留「email」或「姓名+email」欄，對應到上述名單 CSV 欄位即可；必要時在 Excel 另存成 CSV（UTF-8）。
- **課程**：若目前課程在 Wiki/Excel，可先整理成上述課程 CSV 一檔，第一次上線前整批匯入，之後單筆新增或再匯入皆可。

---

## 七、摘要

| 項目       | 建議 |
|------------|------|
| 匯入順序   | 先匯入課程，再匯入名單。 |
| 課程格式   | 一檔 CSV，一列一門課；必填 name, type, teacher, sessions_count, capacity, price_member, price_guest, first_session_at。 |
| 名單格式   | 單課：在該課頁匯入，CSV 含 email（必填）, name, employee_id。多課：CSV 含 course_name, course_date, email, name, employee_id。 |
| 編碼       | 一律 UTF-8。 |
| 錯誤處理   | 顯示成功/失敗筆數，失敗列出行號與原因，可選下載錯誤行。 |
| 範本       | 提供課程與名單的 CSV 範本下載。 |

若你之後有實際的 `courses` / `course_rosters` 表結構，可以把欄位名與此規格對齊（例如 DB 用 snake_case），匯入時直接對欄位寫入即可。
