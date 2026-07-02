# MTK App 功能需求 — 系統設計 Spec

- 日期:2026-07-02
- 狀態:待用戶審閱
- 相關文件:`docs/mtk-decision-log.md`(客戶溝通用決策紀錄,25+ 條決策)、`docs/prd.md`(既有產品規則)
- 需求覆蓋:MTK 需求計畫 30 項拆解(堂卡 5、常態 6、專攻 6、風格 9、General 4)

## 1. 背景與目標

客戶(MTK 熱舞社)提出四類課程的系統化需求:常態課程(堂卡制、整期報名、MV 投票、班長意願)、專攻課程(NTD 計價)、風格體驗(社員免費/非社員付費、缺席懲罰)、通用規則(金流審核、身分計價、額滿關閉、先搶先贏)。本次範圍:**全部自助化**,取代現行 SurveyCake 問卷+人工金流的流程。

設計原則(用戶指定):**unified / re-usable,不做 multi-branched fixed paths** —— 計費、報名方式、名額分配都做成課程設定,課種只提供預設值。

## 2. 名詞對應

| 需求文件 | 系統實體 |
|---|---|
| 常態課程 | `courses.type = 'normal'`(含 special) |
| 專攻課程 | `courses.type = 'workshop'` |
| 風格體驗 | `courses.type = 'style'` |
| MV 班 | `normal` 課 + 掛投票題(非獨立課種) |
| 社員/非社員 | `profiles.role`(member/admin vs guest)+ `member_groups.valid_until` 有效性 |
| 財務人員 | `admin`(幹部)角色 |

## 3. 資料模型變更

### 3.1 `orders` 統一訂單表(由 `card_orders` 改造)

- RENAME `card_orders` → `orders`,新增 `order_type TEXT CHECK IN ('card_purchase','course_fee','membership_fee')`,既有列 backfill 為 `card_purchase`(含入社費的既有單維持現狀,membership_fee 用於未來獨立入社單)。
- 狀態機(既有,補全型別):`pending → remitted → confirmed | rejected | cancelled`。修正 `CardOrderStatus` 型別缺 `rejected` 的 drift(`src/types/database.ts:37`)。
- 共用欄位:`amount`、`remittance_bank_code/last5/date/note`、審核人/時間。
- 購卡專屬欄位(`quantity`、`unit_price`、`expires_at`、`used`)保留,`course_fee` 單不使用。
- 向下相容:所有引用 `card_orders` 的程式(actions、card-utils、my-cards UI、審核中心、匯入)改讀 `orders` + `order_type='card_purchase'` 條件。

### 3.2 `enrollments` 擴充

- `status` 新增值:`pending_payment`(佔位待繳)、`pending_vote`(MV 待開票)。既有 `enrolled` 等值不變。
- 新欄位:`order_id UUID NULL REFERENCES orders`(一次報名送出=一筆訂單,涵蓋該次所有報名列)、`wants_leader BOOLEAN DEFAULT false`、`cancel_reason TEXT NULL`(取消原因:未繳費/未投中/超額/幹部取消,供 app 內狀態顯示)。

### 3.3 `courses` 擴充(統一收費與報名方式)

```
pricing_mode TEXT NOT NULL DEFAULT 'card' CHECK IN ('card','ntd','free')
price_member_single INTEGER NULL   -- ntd 模式:社員單堂價(0=該身分免費)
price_guest_single  INTEGER NULL   -- ntd 模式:非社員單堂價
price_member_full   INTEGER NULL   -- ntd 模式:社員整期價
price_guest_full    INTEGER NULL   -- ntd 模式:非社員整期價
enroll_full   BOOLEAN NOT NULL DEFAULT true
enroll_single BOOLEAN NOT NULL DEFAULT true
```

- 課種預設值(建課表單 prefill,幹部可改):
  - normal:`card` + full✓ + single✓(單堂時窗設在開課後)
  - workshop:`ntd` + full✓ + single✓(兩者第一階段同時開放)
  - style:`ntd`(社員價 0)+ full✗ + single✓
- Guard:`pricing_mode='ntd'` 且對應身分/方式價格為 NULL 時,該報名選項不開放(遷移後既有 workshop 課需幹部補價)。
- `cards_per_session` 保留,僅 `card` 模式使用。

### 3.4 MV 投票三表

```
course_polls   (id, course_id FK, title, vote_type CHECK IN ('single','multi'),
                status CHECK IN ('open','published'), published_at, published_by)
poll_options   (id, poll_id FK, label, youtube_url, is_winner BOOLEAN DEFAULT false)
poll_votes     (id, poll_id FK, option_id FK, user_id FK, enrollment_id FK,
                UNIQUE(poll_id, user_id, option_id))
```

- 一門課可掛多個 poll(拍攝歌曲=single、副歌=multi)。
- `poll_votes.enrollment_id` 綁報名列,報名作廢時投票隨之作廢(CASCADE)。

### 3.5 黑名單 override

```
penalty_overrides (id, user_id FK, period_end DATE,  -- 對應的社員年度界線
                   reason TEXT, created_by FK, created_at)
```

停權狀態**不落地**:報名 guard 與黑名單頁即時計算(見 §9)。

### 3.6 `system_config` 鍵值異動

- 新增:`card_purchase_unit`(n 值,預設 5)、`card_purchase_mode`(`manual` | `monthly_first_week`,預設 manual,上線後切 monthly)。
- 移除:閒置鍵 `card_expire_month`(無程式讀取,設定頁移除避免誤導)。
- 保留:`card_purchase_open/start/end`(manual 模式與手動覆寫用)、`card_price_member/non_member`、`bank_info`。

### 3.7 `course_groups` / 分配策略

- 啟用既有休眠欄位 `registration_phase1_start/end` 作為**第一階段(整期)報名時窗**的伺服器端閘門(目前是死碼,僅可設定不生效)。
- `course_groups.allocation_policy TEXT NOT NULL DEFAULT 'fcfs'`:名額分配策略。本期僅實作 `fcfs`;欄位+模組介面先立,未來加「社員優先」等策略時只新增結算實作(見 §5.4)。

## 4. 統一計價引擎(pricing resolver)

單一函式,所有報名路徑共用:

```
resolvePrice(course, user, mode: 'full'|'single') →
  { kind: 'card', cards: n }            // pricing_mode=card
  { kind: 'ntd', amount: m }            // ntd 且該身分價格 > 0
  { kind: 'free' }                      // free 模式,或 ntd 且該身分價格 = 0
```

- `isMember(user)` 收斂為單一 helper:`role !== 'guest'` 且本人 `member_groups.valid_until >= 台北今日`。取代現有三處不一致實作(`createCardOrder`、`getCardPriceForUser`、`import-actions`)。
- 身分計價以**下單當下**為準,之後入社不追溯改價。
- 黑名單「免費課」定義 = `resolvePrice(...).kind === 'free'`(與 §9 guard 一致)。

## 5. 報名引擎與狀態機

### 5.1 時間軸

```
報名開始(phase1_start)→ 報名截止(phase1_end,佔位固定)
→ 財務批次審核(截止後~開課前)→ 開課 → 加報階段(隨到隨審)
```

- 整期報名時窗 = 檔期 `registration_phase1_start/end`;單堂時窗 = 各課既有 `enrollment_start_at/end_at`(補上 `batchEnrollInSessions` 缺的伺服器端檢查)。
- 所有時間判斷 Asia/Taipei(專案既有 `Intl.DateTimeFormat('sv-SE')` 慣例)。

### 5.2 狀態機

```
MV 班:    報名 → pending_vote ─投中→ (卡夠)enrolled | (卡不足)pending_payment
                              ─未投中/超額→ cancelled(記 cancel_reason)
需付款:   報名 → pending_payment(佔位)─訂單confirmed→ enrolled
                                      ─幹部取消→ cancelled(釋放名額)
即時:     報名 → enrolled(card 模式卡夠直接扣;free 模式)
```

- **容量計算:`pending_*` + `enrolled` 都佔名額**,沿用既有逐堂占用公式(full+single+makeup+transferIn−leave−transferOut),抽成共用函式,補進所有報名路徑(含 `batchEnrollInCourses` 現在完全沒檢查的洞)。
- pending 狀態限制:不可請假、不可轉讓、不可當補課來源、不計入出席;點名單顯示但標「待繳費/待開票」徽章。

### 5.3 原子性(RPC)

報名寫入改為 Postgres function(Supabase RPC)`enroll_atomic`:同一交易內「逐堂容量檢查(SELECT ... FOR UPDATE 鎖課程列)→ insert enrollments → 扣卡(card 模式)→ 建訂單(ntd 模式)」。任一步失敗全部 rollback。修掉現有超賣風險(docs/system-overview.md 已列已知風險)。

### 5.4 分配策略模組

```
allocate(candidates[], capacity, policy) → { granted[], denied[] }
```

- `fcfs`(本期唯一實作):依報名送出時間排序取前 N。
- 呼叫點:(a) FCFS 即時路徑 = RPC 內的容量檢查(退化為 insert-time 判斷);(b) MV 開票結算(截止後批次配位)。兩處共用排序/判定邏輯,未來新 policy 只加結算實作,報名流程與 UI 不動。

### 5.5 報名修改 =「作廢重報」

第一階段截止前,用戶可修改該檔期的報名內容(選課/MV 投票/班長意願)。語意為單一原子交易(RPC)內:

1. 釋放舊佔位(全部該次 submission 的 enrollment 列 → cancelled)
2. 退還已扣堂卡(即時成立的部分)
3. 作廢未確認訂單(pending/remitted → cancelled;**已 confirmed 的訂單不可自改,需找幹部**)
4. 以**新時間戳**重新寫入(丟早鳥順位)

UI 送出前強制提示:「修改將作廢原報名並重新排隊,已滿的課程可能無法再選」。

### 5.6 取消後名額

審核取消釋放的名額**留給加報階段先搶先贏**,不做候補遞補鏈。既有 waitlist 機制不擴用(其取消按鈕接線 bug 一併修掉,見 §12)。

## 6. 統一訂單與審核中心

### 6.1 訂單生命週期

- 報名送出(ntd 或同步購卡)→ 建 `orders` 一筆(pending),金額 = resolvePrice 加總(+入社費若勾選)。
- 匯款資訊可當場填(→ remitted)或稍後補(「我的課程/訂單」入口);報名截止仍未填 = 未繳費,進取消名單。
- 財務**隨時**可確認已到帳的單(confirmed);「取消未繳費」是截止後的一次性人工動作。加報階段的訂單隨到隨審。
- confirm 副作用:`course_fee` → 關聯 enrollments 轉 enrolled;`card_purchase`(同步購卡)→ 發卡 → 為關聯 enrollments 扣卡 → enrolled(若卡池在確認前被挪用不足:訂單維持 remitted、確認動作回報明確錯誤訊息,由幹部聯繫學員處理,不自動取消)。
- 取消副作用:enrollments → cancelled(記原因)+ 名額釋放;已扣卡的退還正確張數(修掉 `reviewSingleEnrollment` 寫死 1 張的 bug)。
- 退費一律場外人工,系統只記錄狀態。

### 6.2 審核中心新分頁(UI 風格與既有分頁一致)

- **「報名繳費」**:按檔期/課程分組列出 `course_fee` 與同步購卡單,顯示報名人/課程/金額/匯款資訊/狀態;操作:確認、取消(=幹部取消報名工具,兼一般取消用途)。截止後的檔期標示「待審」。
- **「黑名單」**:見 §9。

## 7. 整期報名精靈(新頁面)

`/courses/groups/[groupId]/register`,入口時窗由 `registration_phase1_start/end` 控制:

1. **選課**:該檔期開放整期的課程(`enroll_full=true`),即時餘額、額滿鎖定;各課顯示計價(堂卡 n 卡/NTD 金額/免費)
2. **MV 選歌**(勾選的課有 open poll 才出現):每個 poll 一題,single=單選、multi=複選,附 YouTube 預覽;投票即報名該班
3. **班長意願**:從已勾課程中複選「想當班長」
4. **費用結算**:堂卡課顯示扣卡試算;卡不足 → 內嵌購卡(倍數驗證+非社員帶入社加購 $1800)+ 匯款表單(可稍後補);ntd 課顯示金額合計
5. **完成**:逐課顯示結果狀態(已成立/待繳費/待開票)

已送出者再進入此頁 → 顯示現有報名內容 + 「修改報名」(走 §5.5)。

## 8. 單堂加報流程

沿用既有 `SessionEnrollmentDialog` + `batchEnrollInSessions`(改走 RPC):

- 開放條件:`enroll_single=true` 且在該課 `enrollment_start_at/end_at` 時窗內(normal 課預設設在開課後;workshop 第一階段即開;style 隨時窗)。
- 計價依 `resolvePrice(course, user, 'single')`:card → 現行扣卡流程;ntd>0 → 佔位+訂單+匯款表單(重用購卡兩步驟 UI);free → 即時成立(過黑名單 guard)。
- 「報名後不可取消」落為伺服器端規則:`cancelEnrollment` 只允許取消 `waitlisted`/pending 未繳費單,`enrolled` 一律走幹部工具。

## 9. 缺席懲罰黑名單

- **違規事實**:`attendance_records.status='absent'`(無故缺席,請假=leave 不算)× 該課 `resolvePrice(user)='free'` × 當前社員年度。
- **年度定義**:取 `member_groups` 中 `valid_until` 最晚者,區間 =(valid_until − 1 年, valid_until];無群組 fallback 台北曆年。
- **停權判定(即時計算)**:違規次數 ≥ 2 且無該年度的 `penalty_overrides` → 禁止報名任何 free 報名(guard 在 RPC 內);報名 UI 顯示被擋原因與違規明細。
- **黑名單分頁**(審核中心):列出有違規者:姓名/次數/每次違規的課程與日期/是否停權/「解鎖」按鈕(寫 override,記原因與操作者)。點名紀錄事後修改(補請假)→ 黑名單自動同步,無雙帳問題。

## 10. MV 投票與開票

- **建課**:課程表單可掛投票題(新增/編輯 poll + options + YouTube 連結)。有 open poll 的課,整期報名即投票(§7 步驟 2),報名列狀態 `pending_vote`,**不扣卡、不建訂單**。
- **計票**:幹部端課程頁新區塊即時顯示各選項票數。
- **公布結果**(報名截止後,幹部操作):系統預設勾選 top-1(single)/ top-2(multi),**平票時幹部手動改選** → 確認後系統原子結算:
  1. 標記 `is_winner`,poll → published
  2. 投中任一當選歌者 → 依 `allocate(candidates, capacity, 'fcfs')` 取前 N(超額者 cancelled,原因「超額」)
  3. 取中者進計價流程:卡夠 → 扣卡 enrolled;卡不足 → pending_payment + 同步購卡單(繳費期限=開課前,幹部審核時把關)
  4. 未投中者 → cancelled(原因「未投中」)
- 開課後 MV 課單堂加報照 normal 課規則(歌已定,不涉投票)。

## 11. 堂卡購買規則

- **時段**:純函式 `getCardPurchaseWindow(taipeiDate)` 計算「該月第一個週一~週五」;`card_purchase_mode='monthly_first_week'` 時生效,`manual` 模式沿用現行手動開關。伺服端(`createCardOrder`)與 UI(my_cards)共用同一函式。
- **n 倍數**:伺服端加 `quantity % card_purchase_unit === 0` 驗證;UI 步進/上限改讀設定值(修掉硬編碼 5/20 與未使用的 `minPurchase` prop)。
- **效期(定案:年度同步)**:沿用「預設=社員年度到期日」,修兩點:(a) 取**購買者本人所屬群組**的 valid_until(現為全系統最新群組);(b) `updateMemberGroup` 展延到期日時,級聯更新該群組成員名下效期=舊值的 confirmed 卡池並逐人 `syncCardBalance`。購卡對話框寫死的效期文案同步更新。
- **入社加購**:維持購卡流程;整期報名的「同步購卡」步驟自動帶入(非社員可勾,+$1800,confirmed 後入最新群組——沿用既有邏輯)。

## 12. 既有 bug 修復(本次觸及範圍內順帶修)

| Bug | 位置 | 修法 |
|---|---|---|
| 候補「取消」按鈕綁錯 handler(按了沒作用) | course-detail-client.tsx:646 | 綁回 `handleCancelEnrollment` |
| 退卡/重扣寫死 1 張 | actions.ts reviewSingleEnrollment | 依課程 `cards_per_session` 計算 |
| `CardOrderStatus` 缺 `rejected` | types/database.ts:37 | 補型別(隨 §3.1 一起) |
| `batchEnrollInSessions` 無報名時窗檢查 | actions.ts:300-443 | 隨 §8 加時窗 guard |
| `batchEnrollInCourses` 無容量檢查 | actions.ts:244-295 | 隨 §5.3 改走 RPC |
| 三處 isMember 不一致 | actions/queries/import-actions | 收斂單一 helper(§4) |
| 死碼 `enrollment-button.tsx`、`getCardPriceForUser` | — | 刪除或改造併入新流程 |

## 13. 通知(本期範圍)

僅 **app 內狀態顯示**:「我的課程」逐列顯示狀態徽章(待開票/待繳費/已成立/已取消+`cancel_reason`);「我的訂單」(整合進 my_cards 或 my_courses)顯示待補匯款入口;dashboard 加待辦提示(有待繳費訂單/開票結果)。email 推播留待下期。

## 14. 資料遷移計畫

1. `card_orders` → `orders`(RENAME + 新欄位 + backfill `order_type`),同 migration 更新 RLS policy 名稱與引用。
2. `courses` 新欄位 backfill:全部 `pricing_mode='card'`、`enroll_full/single` 依課種預設;既有 style 課由幹部逐課改 ntd+價格(不自動猜)。
3. `enrollments` 新欄位皆 nullable/default,無需 backfill。
4. 新表(polls×3、penalty_overrides)+ RPC functions。
5. 先上 dev(`mvxdxldwznbqycfgwqmc`)驗證,prod(`zhaloqbeguzsknodrxsm`)於功能驗收後套用。

## 15. E2E 測試與進度追蹤

- `e2e/` 目錄建 `@playwright/test` 專案:對 local dev server(`http://[::1]:3000`)+ dev Supabase;種子腳本建測試帳號(admin/member/guest)與測試檔期/課程(含 MV poll、ntd 課、free 課)。
- Spec 分組:購卡規則(時段/倍數/效期)、常態整期精靈(含卡不足同步購卡)、報名修改(作廢重報)、MV(投票→開票→結算三態)、專攻 NTD(單堂/整期/不可取消)、風格(社員免費/非社員繳費/僅單堂)、黑名單(2 次停權/解鎖)、審核中心(確認/取消/名額釋放)、時區邊界(台北 00:00 vs UTC)。
- **Adversarial 測試套件(必要,與 happy-path 同等優先)**:驗證惡意/越權行為被正確阻擋,每項都要有對應 spec:
  - **繞過 UI 直呼 server action**:所有報名/取消/訂單 action 在 UI 隱藏之外必須有伺服器端守衛(本次盤點已證實現況多處只擋 UI 不擋 action)
  - **白嫖免費課**:非社員繞過 ntd 計價取得 free 報名、黑名單者換路徑報名(單堂 dialog/直呼 action/補課路徑)、繳費前取消再重報洗佔位
  - **投票操縱**:未報名投票、重複投票、截止後投票/改票、偽造 enrollment_id 綁票
  - **容量與併發**:並發報名衝破容量(RPC 原子性壓力測試)、「作廢重報」高頻 churn 干擾他人佔位
  - **金流欺詐**:client 端竄改價格/數量(價格必須 server 端 resolve)、時窗外直呼購卡、非倍數/負數數量、自行確認自己的訂單(角色越權)
  - **侵犯他人權益**:IDOR(操作他人 enrollment/order id)、替他人請假/取消、轉讓給非社員/轉讓 pending 報名、非指派班長點名他課
  - **時區邊界**:UTC vs 台北日期差造成的時窗/效期繞過
- **回歸保護(CI/CD 精神,必要)**:本次大幅改動共用基礎(`card_orders`→`orders`、報名寫入改 RPC、計價收斂),既有 prod 功能絕不可壞。
  - **既有流程回歸 spec**:現行購卡兩步驟、堂卡 FIFO 扣卡與餘額、點名/請假/補課/轉讓、成員管理、匯入工具、既有審核中心分頁,每條都要有 e2e 覆蓋,重構前先跑通(建立 baseline)、重構後必須維持綠燈。
  - **重構等價性**:`card_orders`→`orders` 遷移後,所有原本讀寫 card_orders 的路徑行為不變(以既有購卡 e2e 為驗證)。
  - **CI gate**:每個 feature 分支合併前必跑 `npx tsc --noEmit`、`pnpm lint`、`pnpm build`、完整 e2e(happy + adversarial + regression)全綠才可標完成;三個 gate 命令列入每個 phase 的收尾步驟。
- `docs/mtk-feature-tracker.md`:30 項需求 × 狀態(設計/實作/E2E:happy/adversarial/regression),每完成一項更新。
- 開發全程 **dev branch**;每個 feature 先 Playwright MCP 互動驗證,再補 e2e spec(happy-path + adversarial + regression),通過才標完成。

## 16. 邊界情況與預設決策(已按合理預設寫入,審閱時可推翻)

1. 副歌複選投票**無上限**(可全選)。
2. 班長意願僅在整期報名精靈收集;單堂加報不問。
3. MV 投中+卡不足者的繳費期限=開課前(幹部審核時把關,系統不自動取消)。
4. 已 confirmed 的訂單不可自助「作廢重報」,需幹部處理。
5. `free` 報名(即時成立)不受「報名後不可取消」限制?**否**——同樣不可自取消(防佔位刷位),幹部可取消。
6. 轉讓規則不變(對象限社員、開課前);ntd 課轉讓差價仍場外人工(`extra_cards_required` 機制不擴)。
7. 加報階段不設「加報專屬容量」,就是剩餘名額先到先得。

## 17. 未定案(不擋開發)

- n 值(購買單位)具體數字 → `card_purchase_unit` 設定值,幹部可調,預設 5。
