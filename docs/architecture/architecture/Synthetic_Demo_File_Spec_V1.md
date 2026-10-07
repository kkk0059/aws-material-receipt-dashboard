# Synthetic Demo File Specification V1

更新日期：2026-08-25

## 1. 決策

AWS Prototype 第一版使用 `.xlsx` 作為 Synthetic Demo File。每個檔案代表一張工單，只模擬 Parser 與 Rule Engine 必要的 `Dashboard` Data Contract，不複製公司原始 VBA、巨集、其他工作表或真實數值。

選擇 `.xlsx` 而不是 JSON 的理由：

- 保留與現場 Excel 資料出口相近的結構，可驗證 Parser。
- 不需要 VBA 巨集，AWS Lambda 只需讀取工作簿值。
- 檔案小、容易展示，也能由 Demo Generator 自動產生。

## 2. 工作表結構、隱藏狀態與版本辨識

### Current／新版

- 可見工作表：`修改歷程`、`StationRaw`、`ScanRaw`、`點料版`、`PN比對`、`Dashboard`。
- 隱藏工作表：`StationCache`（Very Hidden）、`List`（Hidden）、`StationAssign`（Very Hidden）。
- 必須有 `Dashboard`。
- 必須有 `StationAssign`（即使為 Very Hidden），供 Parser 判斷為 `current`。
- `Dashboard!B10` 提供 `actual_receipt_qty_diff_count`。

### Legacy／舊版

- 工作表：`ScanRaw`、`點料版`、`PN比對`、`Dashboard`。
- 必須有 `Dashboard`。
- 不得有 `StationAssign`。
- `Dashboard!B10` 不存在；Canonical Model 轉換後為 `null`。

Parser 不得依賴檔名判斷版本。

## 3. Dashboard Data Contract

| 位置 | 中文／英文標籤 | Canonical 欄位 | 型別 |
|---|---|---|---|
| B1 | 工單 / Work Order | work_order | string |
| D2 | 作業人員 / Operator | operator | string / null |
| D3 | 確認時間 / Confirmation Time | confirmation_time | datetime / null |
| B2 | 需求 PN / Required PN | required_pn | integer |
| B3 | 已點收 PN / Received PN | received_pn | integer |
| B4 | 差異 PN / PN Difference | pn_difference | integer |
| B5 | 點收 QTY / Receipt Qty | receipt_qty | number |
| B6 | 出庫 QTY / Issue Qty | issue_qty | number |
| B7 | 差異 QTY / Qty Difference | qty_difference | formula: B5-B6 |
| B8 | 缺料數 / Shortage | shortage_count | integer |
| B9 | 多給 PN / Extra PN | extra_pn_count | integer |
| B10 | 實際點收數量差異筆數 / Actual Receipt Qty Difference | actual_receipt_qty_diff_count | integer；僅新版 |

## 4. Source State

`source_state` 不由工作簿儲存。AWS Prototype 依 S3 Object Key 判斷：

``` text
incoming/  → in_progress
archived/  → archived
```

本地測試時由檔名中的 `IN_PROGRESS`／`ARCHIVED` 測試標記或測試參數提供。

## 5. 合成資料規則

- Demo 需保留新版／舊版的工作表架構、主要欄位名稱與 Dashboard 儲存格位置，讓開啟來源文件時可呈現接近實際作業檔的結構。
- `ScanRaw`、`點料版`、`PN比對`、`StationRaw` 僅保留少量合成列作展示；不得複製原始檔的大量真實明細或 VBA 巨集。
- 工單：`WO-DEMO-001` 起。
- 作業人員：`OP-DEMO-01` 起。
- 不使用真實 PN、RID、人名、工號、數量或路徑。
- 儲存格 D1 必須顯示 `YES`，表示為 Synthetic Data。
- 產生器輸出前需檢查所有 Work Order 都以 `WO-DEMO-` 開頭。

## 6. 必備情境

1. Current Completed
2. Current Pending
3. Current Shortage
4. Current Quantity Difference
5. Current Actual Receipt Qty Difference
6. Legacy Extra PN → Review Required
7. Archived Legacy Missing Metadata → Legacy Data Incomplete、Action Required = No

## 7. AWS 上傳原則

Demo 時一次上傳一份 `.xlsx`，讓 S3 Object Created 事件觸發 Parser 與 Rule Engine。不得把預期狀態寫入 Data Contract 後讓系統直接讀答案；Receipt Status 必須由 Rule Engine 自行判定。
