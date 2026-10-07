# Synthetic Data

此目錄只允許 100% 合成資料。不得複製公司工單、料號、人員、數量、路徑或原始 Excel 內容。

`demo-incoming/` 與 `apps/dashboard/public/demo-files/` 提供可直接用於測試與展示的合成 XLSX 範例。欄位與情境定義請見 [`../docs/architecture/architecture/Synthetic_Demo_File_Spec_V1.md`](../docs/architecture/architecture/Synthetic_Demo_File_Spec_V1.md)。

## 本機展示自動化

看板右上角的「Demo 自動化」只在本機開發模式顯示。可選擇新版／舊版與異常情境，產生 `WO-DEMO-*` 合成 XLSX 至 `synthetic-data/demo-incoming/`；本機展示服務監控該資料夾，偵測到新增檔案後自動匯入看板並保留可開啟的來源檔。

這是 AWS 專題的事件驅動展示機制，不是公司正式功能。正式／公司模式不得啟用此按鈕或本機展示服務。

部署到 AWS 時，僅可上傳本目錄已提供或依規格自行建立的合成檔；不得混入公司參考檔或實際營運資料。
