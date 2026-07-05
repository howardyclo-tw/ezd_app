# MTK UX 補充規格(Phase 5R + 後續各階段雙角色 UX)

> 2026-07-05 使用者驗收 Phase 5 後定案。本文件是 **Phase 5R** 的規格真相來源,並預寫 P6–P8 的雙角色 UX 要求。
> 搭配:主 spec `2026-07-02-mtk-features-design.md`(引擎/資料模型)、決策 log #32(身份開放)、計畫 `2026-07-02-mtk-features.md` Phase 5R 任務。

## 0. 全域 UX 準則(自本文件起為每階段 gate 條件)

1. **入口準則**:新頁面/新功能必須有目標角色看得到的導覽入口,「沒有入口=未完成」。禁止只能靠直接網址到達的功能。
2. **雙角色條款**:每個含 UI 的 phase,spec 必須含「學員視角」與「幹部視角」兩節(入口、狀態可見性、空/關閉狀態、錯誤文案),實作前就位;phase gate 必含雙角色走查 e2e(§H)。
3. **狀態可見性準則**:任何非同步狀態(待繳費/待開票/已取消+原因/待審)必須讓「擁有者」與「幹部」各有一處可見。學員端=個人中心/我的課程;幹部端=繳費對帳/名冊。
4. **關閉狀態準則**:時窗未開/已截止不得只回 server 錯誤,UI 要呈現友善的關閉狀態(灰按鈕+時間說明)。
5. **樣式一致性**:只用專案既有 shadcn 元件與 tokens;徽章顏色/文案一律取自 `src/lib/constants.ts`(本階段新增 `ENROLLMENT_STATUS_*`、`ORDER_STATUS_*`);繁中文案語氣同現有頁面;**禁止新增色票字面值**。審查者必查此項。
6. **金額真相**:UI 顯示的金額只做參考,一律 server `resolvePrice` 重算(既有規則,重申)。

## A. 身份開放設定(決策 #32;5R.1)

**動機**:決策 #5 開放非社員整期,但要更 general——幹部建/編課時可設定「開放對象」。

- **Schema(migration 015)**:`courses.enroll_full_identity`、`courses.enroll_single_identity`,`text NOT NULL DEFAULT 'all' CHECK (IN ('all','member'))`。
- **判定**:`'member'` 時要求 `isMemberActive(...)===true`(過期社員=非社員;admin 視同社員)。與計價同一個身分函式,不得另寫判斷。
- **Server 守衛**(單一真相,三入口共用):模式關 → `未開放整期/單堂報名`;模式開但身分不符 → `此課程整期僅開放社員` / `此課程單堂僅開放社員`(訊息可測)。
- **移除**兩處全面 guest 擋整期:`batchEnrollInCourses`(~300)、`submitGroupEnrollment`(~3375)。
- **表單 UI(course-form)**:每個報名開關旁加「開放對象」Select(全部/僅社員),開關 off 時停用;`ntd` 模式下 guest 價欄位改為「該模式開 AND 對象=全部」才必填。課種預設一律 `'all'`。
- **列表顯示**:精靈/課程頁對不符身分者**顯示但鎖定**並標原因(透明,不隱藏)。
- **測試**:H=非社員整期報 card 課成功(#5)、NTD 課用 guest_full 價;A=member-only 課 guest 直呼 server 被擋(整期+單堂各一,mutation-test 此守衛)、guest 價未設之 NTD 課擋報。

## B. 精靈入口與時窗狀態機(5R.2)

**學員(群組頁)**:按鈕生命週期(依 `registration_phase1_start/end`,Asia/Taipei):
- 未設定時窗 → 學員不顯示按鈕;幹部顯示「尚未設定報名時段」chip(點擊=§B 幹部快速編輯)。
- 未開始 → 灰按鈕「整期報名 MM/DD HH:mm 開放」。
- 進行中 → 主色 CTA「整期報名」→ `/register`;**已有本檔期有效報名者**按鈕改「查看/修改報名」。
- 已截止 → 灰按鈕「整期報名已截止」;若檔期內有課 `enroll_single` 開放,附「單堂加報請至各課程頁」提示。
- `/register` 頁本身也要渲染對應關閉狀態(非裸錯誤)。
- **移除** `GroupEnrollmentDialog`(舊卡制即時扣流程整個退場,連同 import)。
- **main 分支不變量**:整期報名入口在 main 隱藏(沿用現行分支差異作法),merge 時檢查。

**幹部(群組頁 header)**:顯示「報名時段:MM/DD HH:mm ~ MM/DD HH:mm」+ ✏️ 快速編輯(彈窗,重用 `updateCourseGroup`)。解決現況「設定埋在建課表單→檔期下拉→鉛筆」的可發現性問題(該處保留)。

## C. 修改報名 UI(作廢重報;5R.3)

`/register` 偵測本人於該檔期的有效整期報名(enrolled/pending_payment/pending_vote):
- 頂部「目前報名」摘要卡:逐課狀態 chip(用 constants 徽章)。
- 「修改報名」按鈕 → **強警示對話框**(spec §5.5 文案:作廢原報名重新排隊、丟早鳥順位、額滿可能選不回;含已確認繳費單則整筆擋)→ 確認後進精靈 → 送出走 `resubmitGroupEnrollment`。
- 被「已確認訂單」擋下時:顯示原因+「請洽幹部」;原報名原封不動。
- 測試:H=UI 完整修改一次(舊取消/退卡/新時間戳);A=有 confirmed 訂單時 UI 全程走完顯示被擋、DB 不變。

## D. 內嵌購卡倍數與預填(5R.4;spec §7 落地)

- 預填數量 = `ceil(短缺 / 購買單位) × 購買單位`;stepper step=單位、min=預填值。
- Server:`submitGroupEnrollment` 對 `buyCards.quantity` 做倍數+正數驗證(重用 `validatePurchaseQuantity` 的純函式,**不含**購卡時窗檢查);不足最小值/非倍數 → 該提交整筆 fail-fast(訊息可測)。
- 測試:A=直呼非倍數數量被擋、訂單/報名皆未建。

## E. 個人中心「我的堂卡・繳費」(5R.5;#31/§6.1 前移,Phase 8.1 相應縮減)

- `my_cards` 頁改雙分頁:**堂卡**(現有卡池/購卡內容)|**繳費紀錄**(所有 `orders`:類型徽章 堂卡/課程費、內容摘要(卡×n / 課名列表)、金額、狀態徽章、匯款資訊)。
- 繳費紀錄列操作:`pending/remitted` 未確認 → 內嵌「補匯款」表單(`submitRemittanceInfo`)與「取消」(owner 走 `cancelOrder`,連動取消報名+釋位——即「未繳費前自助取消報名」的唯一路徑);`confirmed/rejected/cancelled` 唯讀。
- `my_courses`:每筆報名顯示狀態徽章(已成立/待繳費/待開票/已取消+`cancel_reason`)。
- Dashboard:待辦 chip「n 筆待繳費 / m 門待開票」→ 連到對應分頁;`my_cards` 入口卡文案同步改「我的堂卡・繳費」。
- `constants.ts` 新增 `ENROLLMENT_STATUS_COLORS/LABELS`、`ORDER_STATUS_COLORS/LABELS`,所有頁面共用。
- 測試:H=有 pending 訂單者看到待繳費+補匯款成功轉 remitted;owner 取消 pending 訂單→報名取消+釋位;A=非 owner 直呼取消他人訂單被擋(既有守衛回歸)。

## F. pending 狀態限制與名冊徽章(5R.6;spec §5.2 落地)

- 驗證並強制:`pending_payment/pending_vote` 的報名**不可**請假、不可轉讓、不可作為補課來源(server 守衛;若既有程式已僅限 `enrolled`,補上對抗測試證明)。
- 點名單/名冊:pending 者顯示「待繳費/待開票」徽章(不可點名);整期報名勾「想當班長」者顯示志願者徽章(#17 的名冊面落地)。
- 補測 spec §6.1 邊界:同步購卡單 confirm 時卡池已被挪用不足 → 訂單維持 `remitted`、回明確錯誤、不自動取消(現行為未知,先測後修)。

## G. 繳費對帳分組與常態單堂預設(5R.7)

- 繳費對帳 tab 改「按檔期分組」;檔期 phase1 已截止且組內尚有 pending/remitted → 組標題掛「待審」chip(spec §6.2)。(「截止後一鍵取消未繳費」批次工具維持 Phase 8。)
- course-form:課種=normal 時,單堂時窗 `enrollment_start_at` 預填=第一堂課日(可改),欄位說明「常態課單堂預設開課後加報」(#27)。

## H. 雙角色走查 e2e(5R.8;phase gate 新成分)

- `e2e/journeys/student-journey.spec.ts`:社員登入 → 群組頁看到報名中 CTA → 精靈混合購物車(卡足夠課+卡不足課+MV 課+NTD 課)→ 費用結算補購+填匯款 → 完成頁狀態 → 個人中心看到待繳費/待開票 → 修改報名一次 → 狀態一致。全程 UI 驅動+DB 斷言。
- `e2e/journeys/admin-journey.spec.ts`:幹部登入 → 群組頁設定報名時段 → 繳費對帳看到分組訂單 → 確認一筆(報名轉成立)→ 名冊看到成立+pending 徽章 → 展延群組效期(卡池級聯,既有)。
- 樣式一致性:審查者以 §0.5 檢核(元件/tokens/constants/文案),列入審查結論必填欄位。

## I. P6–P8 雙角色 UX 要求(預寫,屆時可再細化)

**P6 MV 投票**:學員=精靈選歌步驟真投票(單選 radio/複選 checkbox+YouTube 內嵌;完成頁與我的課程顯示「待開票」與所投選項);開票後中選者依計價流轉、未中者顯示取消原因。幹部=課程頁「投票」區(即時計票條、每選項票數/投票人)、「公布結果」對話框(預設 top-k 勾選、平票時幹部改勾,送出前顯示將成立/取消人數預覽)、公布後鎖定顯示結果。
**P7 黑名單**:學員=報免費課被擋時顯示原因+違規明細(哪堂課哪天);個人頁 ≥1 次違規即顯示警示橫幅(預防性)。幹部=審核中心「黑名單」tab(姓名/次數/明細/狀態/解鎖按鈕,解鎖需填原因)。
**P8 通知/收尾**:dashboard 待辦聚合(5R.5 已建基礎);繳費對帳「截止後批次取消未繳費」(每組一鍵,確認框列將取消名單);prod 遷移 checklist(見 playbook)。

## J. 邊界清單(5R 測試必含)

1. 非社員整期 card 課成功後,卡不足補購單價必須是 370(身分計價)。
2. `enroll_full_identity='member'` 的課,過期社員(role=member 但群組過期)被擋。
3. 修改報名時新選單含 member-only 課而使用者不符 → 該課 rejected、其他課照常。
4. 內嵌購卡數量預填後使用者手動改小於短缺 → 前端擋+後端擋雙層。
5. owner 取消「已確認」訂單 → 被擋(僅幹部可)。
6. pending_vote 者嘗試請假/轉讓 → 被擋且訊息明確。
