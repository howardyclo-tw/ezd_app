# MTK 執行 Playbook(SDD 工作流操作手冊)

> 給後續任何 Claude 模型(含無 ultracode 的 Opus session)照本執行。品質規則的「為什麼」見 CLAUDE.md;這裡是「怎麼做」的精確模板。
> **使用者常設授權(2026-07,原話意旨)**:MTK 計畫的實作採 Workflow 工具編排 subagent-driven development(實作與審查用 `claude-opus-4-6`),此授權對整個 MTK 計畫持續有效,無需逐次再確認。

## 每個 Task 的標準迴圈

1. **讀計畫與規格**:`docs/superpowers/plans/2026-07-02-mtk-features.md` 該 task 條目 + 它引用的 spec 節(主 spec 或 `2026-07-05-mtk-ux-addendum.md`)。
2. **抓 ground truth**(編排者自己做,不派工):Read/Grep 實際要改的函式行號、現有守衛、fixture 現況,寫進 brief。brief 內的行號一律標「約(approx)」。
3. **派一個 Workflow(兩 phase:Implement → Review)**,模板見下。實作與審查是**不同 agent**,審查 prompt 內嵌實作者報告但明說「驗證、勿信任」。
4. **收結果後編排者輕量確認**:`git log`/`git status` tree 乾淨、`npx tsc --noEmit`、必要時單獨重跑新 spec。**若實作者與審查者的測試數字矛盾 → 編排者親自單獨重跑全套**(見「資源競爭」)。
5. **判定完成的權限在編排者**:審查 APPROVED 仍要對照使用者硬規則(金流/重要功能 100% 覆蓋)。審查者把金流缺口標 MINOR 不算過——派 fix task(先例:5.3-fix 因此抓到 prod bug)。
6. **記 ledger**:`.superpowers/sdd/progress.md` append 一段(格式見下)。
7. **Phase 結尾**:編排者單獨跑全套 gate → 更新 dashboard(進度+矩陣)→ Artifact 重部署(URL 固定)→ 反思(效率×品質,寫回 memory)→ 才進下一 phase。

## Workflow 腳本模板(逐字改內容即可)

```js
export const meta = {
  name: 'mtk-task-X-Y-slug',
  description: 'Task X.Y: <一句話>',
  phases: [
    { title: 'Implement', detail: '<摘要>', model: 'claude-opus-4-6' },
    { title: 'Review', detail: '<摘要>', model: 'claude-opus-4-6' },
  ],
}
const IMPL = [ /* 見「IMPL brief 必備條款」,用陣列 join 避免反引號解析問題 */ ].join('\n')
phase('Implement')
const impl = await agent(IMPL, { label: 'impl:X.Y', phase: 'Implement', model: 'claude-opus-4-6', effort: '<見 effort 表>' })
const REVIEW_SCHEMA = { type:'object', additionalProperties:false,
  required:['verdict','summary','findings','mutation_tested','full_suite_result'],
  properties:{ verdict:{type:'string',enum:['APPROVED','NEEDS_FIXES']}, summary:{type:'string'},
    mutation_tested:{type:'string'}, full_suite_result:{type:'string'},
    findings:{type:'array',items:{type:'object',additionalProperties:false,
      required:['severity','file','issue'],properties:{severity:{type:'string',enum:['IMPORTANT','MINOR']},file:{type:'string'},issue:{type:'string'}}}} } }
phase('Review')
const review = await agent([ /* REVIEW 必備條款 + impl 報告內嵌 */ ].join('\n'),
  { label: 'review:X.Y', phase: 'Review', model: 'claude-opus-4-6', effort: 'high', schema: REVIEW_SCHEMA })
return { impl_report: impl, review }
```

- **模型**:`opts.model: 'claude-opus-4-6'` 是唯一能釘住確切模型的方式(使用者指定)。若派工報 invalid model → 改 `'claude-opus-4-8'` 並回報使用者。
- **effort 表**:`max`=碰錢/並發/RPC/authz 的核心(如原子重報、結算);`high`=一般實作與所有審查;`low/medium`=純機械(型別、文案、種子、docs)。

## 任務分級(編排者在 brief 前先判定)

| 級別 | 判定條件 | 審核方式 | 範例 |
|------|---------|---------|------|
| **金流/守衛** | 碰錢(訂單/扣卡/退款)、authz 守衛、RPC、併發 | 完整 mutation test + 獨占全套 e2e | 5R.1 identity guard, 5R.4 unit validation |
| **混合(server+UI)** | 含 server action 呼叫的 UI 功能 | server 邏輯 mutation test + UI 視覺審查 | 5R.3 rebook UI, 5R.6 restrictions |
| **純 UI** | 不含/不改 server logic,只改渲染/佈局/文案 | 視覺審查(截圖+token 掃描),免 mutation test | 5R.2 window states, 5R.5 personal center, 5R.7 group-by |
| **測試/文件** | 只動 e2e/unit/docs,不改 app source | 編排者自驗,免獨立 reviewer | 5R.8 journey e2e |

**合併規則**:相鄰同級 UI 任務若檔案高度重疊(≥60% 共同檔案)→ 合併為一個 task,省去重複 review 開銷。

## IMPL brief 必備條款(逐字放進每份 brief)

1. 環境:repo 路徑、branch dev、base commit、「Do NOT push. No Co-Authored-By lines.」
2. GROUND TRUTH 段:實際行號與現況(編排者查好),要求動工前先 Read 驗證。
3. **ANTI-FALSE-GREEN(不可妥協)**:「對抗測試必須呼叫『真實 server action』(真 UI 或 e2e-test-actions route),斷言 DB 狀態,且『把守衛拿掉時測試必須變紅』;禁止 UI-only 冒充 server 覆蓋;禁止套套邏輯斷言(查兩次沒變更之類);審查者會 mutation-test。」
4. **Fixture 隔離**:「`e2e/global-setup.ts` 是唯一種子來源;新增『全新固定 UUID』的隔離 fixture,禁止改動共用基線值;日期用檔內 Taipei-safe `addDays`。」
5. **時區**:「timestamptz 欄位以瞬間比較(`new Date(col) > new Date()`);只有 date 欄位才用 Taipei 字串;禁止裸 new Date() 比日期字串。」
6. **UX 條款(UI task)**:「僅用既有 shadcn 元件與 tokens;徽章取 `src/lib/constants.ts`;禁止新色票字面值;新頁面必須有目標角色的導覽入口;時窗關閉要渲染友善狀態;文案繁中同現有語氣。」
7. **設計 brief(含 UI 的任務必填)**:見下方「UI 設計約束」專節。
8. **指定驗證範圍(編排者填,實作者不可自選)**:tsc + 改動檔 lint(不得新增違規)+ 指定的 spec 清單。**「禁止自跑全套 e2e(審查者獨占跑,避免資源競爭)」**。dev server:`http://[::1]:3000`,沒起就背景 `pnpm dev`。
9. Commit 訊息指定;結尾要求「結構化報告+完整指令輸出;誠實回報失敗」。
10. **進度更新**:commit 完成後,必須更新 `.superpowers/sdd/progress.md`(append task log entry)。hook 會強制檢查。

## UI 設計約束(含 UI 的 brief 必須內嵌此節,實作者逐條遵守)

> 背景:subagent 不共享視覺記憶;每份 brief 必須自帶設計規範,不可假設 agent 知道 app 的視覺語言。

1. **色彩 tokens**:按鈕用 `bg-primary text-primary-foreground`(禁止 `bg-orange-600` 等 hardcode);狀態色用 `constants.ts` 的 `*_STATUS_COLORS`(禁止 inline `text-yellow-600` 等)。`grep -rn 'bg-[a-z]*-[0-9]00' <你的檔案>` 不得有非 constants.ts 出處的色票。
2. **徽章**:一律 import `ENROLLMENT_STATUS_COLORS/LABELS`、`ORDER_STATUS_COLORS/LABELS` from `src/lib/constants.ts`。新增徽章先加到 constants 再引用。
3. **佈局**:頁面容器用 `container max-w-5xl mx-auto`(禁止 `max-w-lg` 等窄容器);間距用 Tailwind spacing scale(`p-4`/`gap-6` 等,禁止 `p-[13px]` 等任意值)。
4. **元件**:優先用 shadcn `Card`/`Badge`/`Button`/`Dialog`/`Select`/`Tabs`。卡片用 `rounded-xl`(禁止 `rounded-[2.5rem]`);陰影最多 `shadow-md`(禁止 `shadow-2xl`);禁止 `blur-[100px]` 等裝飾性特效。
5. **dark mode**:用 opacity-based pattern(`bg-blue-500/10 text-blue-600`),禁止 explicit `dark:` prefix pattern(`dark:bg-blue-900/30`)。
6. **響應式**:icon container 不得 `hidden sm:flex`(手機也要顯示);表格/長內容用 `overflow-x-auto`。
7. **參考頁面(編排者必填)**:指定 1-2 個現有頁面路徑,實作者必須 Read 該頁面學習其佈局/間距/元件用法,新頁面視覺語言必須與之一致。
8. **字型/文案**:繁中;語氣同現有頁面(簡潔、不用驚嘆號);數字用半形。

## REVIEW prompt 必備條款

1. 「你沒寫這段程式;以實際 diff 與『親自跑測試』驗證,勿信任實作者報告」+ 內嵌實作報告。
2. 逐項核對 brief 的功能點與守衛(列出來)。
3. **MUTATION TEST(金流/守衛/混合級別才做)**:挑 1–2 個核心守衛/邏輯,暫時註解→重跑對應測試→必須變紅→`git checkout --` 還原。仍綠=假綠燈=NEEDS_FIXES。**純 UI 級別免做 mutation test**。
4. **獨占跑全套**:`pnpm exec playwright test e2e/regression e2e/features e2e/journeys`;疑似 timeout flake 單獨重跑該 spec 一次並註明。回報實際數字。
5. tsc + unit + 改動檔 lint;稽核測試範圍是否足夠(「哪個該跑而沒跑的 spec?」)。
6. **UI 視覺審查(含 UI 的任務必做,替代純 UI 的 mutation test)**:
   a. `grep -rn 'bg-[a-z]*-[0-9]00\|shadow-2xl\|blur-\|rounded-\[' <changed tsx files>` — 列出所有 hardcoded 色票/裝飾值,對照「UI 設計約束」判定違規。
   b. 確認所有 badge/status 色彩 import 自 `constants.ts`(not inline)。
   c. 確認容器寬度與參考頁面一致。
   d. 結論:STYLE_CLEAN / STYLE_ISSUES(列出)。
7. 「還原工作樹、不建 commit」;結構化輸出(schema)。

## 影響對照表(編排者指定範圍用)

- 純 lib(pricing/allocation/capacity/date/card-window)→ `pnpm test` + tsc,**不跑 e2e**。
- actions.ts 報名/訂單/卡 → enroll-gating + register-wizard + single-add-enroll + 相關 regression。
- 請假/補課/轉讓/候補 → 對應 regression spec。
- 審核中心/個人中心 UI → review-center-coursefee + card-purchase + my-payments。
- course-form → course-form-pricing。
- 遷移(additive)→ tsc + 一條相關 flow spec。
- 任何變更 → tsc + 改動檔 lint,一律。

## 已知坑(踩過的)

- **資源競爭**:兩個 Playwright 同打一台 dev server → 假 timeout 紅燈+3–6 倍慢。實作者/審查者/編排者永遠只有一方在跑 e2e。
- **waitlist-cancel.spec** `getByText('E2E Single Course')` strict-mode 2-match 偶發 → 遇到先單獨重跑;5R 任一 task 順手改精確 locator。
- **遷移編號**:`supabase/migrations/` 連號(下一個=015);先 MCP `apply_migration` 到 dev(project `mvxdxldwznbqycfgwqmc`),同 SQL 存 repo。prod(`zhaloqbeguzsknodrxsm`)只在 Phase 8 cutover 動。
- **spend limit**:subagent 死於 org monthly spend limit(agents_done:0)→ 丟棄未驗證半成品、repo 停在最後 gate-verified commit、等額度;**不可**改成自己實作(違反 no-self-review)。
- dev server 用 `http://[::1]:3000`(IPv4 3000 被占)。瀏覽器 console 的 darkreader hydration warning 是使用者瀏覽器擴充造成,非 app bug,忽略。
- `pnpm exec playwright test` 全套約 5–7 分鐘;globalSetup 會自動重種 dev DB(勿手動亂種)。

## 進度同步規則(強制)

> PreToolUse hook `check-progress-sync.py` 在每次 `git commit` 時檢查:若 commit 包含 `src/` 或 `e2e/` 檔案,progress.md 必須也在 staging area。違反時警告(非阻斷)。

1. **每個 task commit 後**:立即 append task log entry 到 `.superpowers/sdd/progress.md`(格式見下)。
2. **每個 phase 結尾**:更新 `docs/mtk-progress-dashboard.html` → 重新部署 Artifact(固定 URL)。
3. **dashboard 與 ledger 不同步 = phase gate FAIL**:gate 時比對 dashboard 任務列表 vs ledger 已完成任務,不一致不得通過。

## Ledger 格式(`.superpowers/sdd/progress.md`,每 task append)

`Task X.Y (<名>): COMPLETE (<sha>, review APPROVED/…+mutation-tested). <一段:做了什麼/守衛/測試/數字/minors>. NEXT: <下一步>`
Phase 結尾另起一行 `*** PHASE N COMPLETE (...) gate <數字> ***`。

## Phase gate 檢查單

1. 編排者單獨全套綠(貼數字)2. dashboard 進度+矩陣更新 → Artifact 重部署(固定 URL,favicon 📊 不換)3. decision log 若有新決策補列 4. ledger phase 行 5. 反思寫 memory(效率×品質各至少一條)6. 向使用者回報+提供 localhost 驗收步驟。

## Prod cutover 檢查單(Phase 8 執行,持續累積)

- 移除/封閉 `src/app/api/e2e-test-actions/route.ts`(現靠 NODE_ENV 擋,不應隨 prod 出貨)
- 放寬 orders quantity CHECK 對非 card_purchase 型別(course_fee 現以 quantity=1 繞過)
- approvals 頁 cardOrderQuery 改 adminDb(與 courseFeeOrderQuery 一致,舊 RLS 不一致)
- 遷移 010–015+ 依序上 prod;live workshop/style 課補設 NTD 價格
- main 分支不變量:header「EZDANCE」白底、整期報名入口隱藏(上線決策前)
- refund-count.spec.ts:11 過期註解(card_balance=10)等 cosmetic 清單見 ledger
