# AWS Prototype 服務選型 V1

**更新日期：2026-08-26**
**適用範圍：100% 合成資料的 AWS Prototype**

## 結論

第一版採用以下 Serverless 架構：

```text
Synthetic .xlsx
  -> S3 incoming/
  -> Lambda File Processor
  -> 共用 Parser + Material Rule Engine
  -> DynamoDB
  -> API Gateway HTTP API + Lambda API
  -> Web Dashboard
```

| 責任 | AWS 服務 | 選擇理由 |
|---|---|---|
| 合成 Excel 與來源文件 | Amazon S3 | 物件儲存、事件觸發、可用短效 Pre-signed URL 開啟文件 |
| 自動解析與狀態判定 | AWS Lambda | 檔案上傳時才執行，不需維護長時間運行的主機 |
| 工單目前狀態 | Amazon DynamoDB On-demand | Prototype 流量小且不固定，依請求計費，不需預先配置資料庫主機 |
| 匯入紀錄與防重複 | DynamoDB Ingestion Table | 以 SHA-256 建立冪等標記，另保存成功、重複及失敗事件 |
| Dashboard API | API Gateway HTTP API + Lambda | 第一版不需要 API Key、WAF、快取等 REST API 進階功能，HTTP API 功能較精簡、價格較低 |
| Web Dashboard | 私有 S3 + CloudFront OAC | 看板已可輸出靜態 SPA，不需 SSR Compute；CloudFront 提供 HTTPS，S3 Bucket 不公開 |
| 執行紀錄 | CloudWatch Logs | 保存 Lambda 錯誤與處理摘要，設定有限保留天數 |
| 成本提醒 | AWS Budgets | 部署前先建立月預算與實際／預測成本通知 |

## 為什麼不選 EC2 或 RDS

- EC2：即使沒有使用者，主機仍持續運行與計費，且需要作業系統維護，不適合小型事件驅動 Demo。
- RDS：本案第一版主要是依工單鍵值讀寫目前狀態，沒有 JOIN、複雜交易或報表 SQL 的必要；為了 Prototype 開啟關聯式資料庫會增加固定成本與管理工作。
- 若未來公司正式版需要複雜報表、跨資料表查詢、交易一致性或既有 SQL 整合，再重新評估 PostgreSQL／SQL Server，不把 AWS Prototype 的 DynamoDB 決策硬套到公司版。

## 資料表責任

### WorkOrdersTable

- Partition Key：`work_order`
- 保存每張工單最新 Canonical Record。
- 同工單新版本採 Upsert；看板只讀這張表即可取得目前狀態。
- Prototype 資料量小，可先使用 Scan 列出全部工單；若未來資料量上升，需依實際查詢模式增加 GSI 或改用分頁索引，不可長期依賴全表 Scan。

### IngestionRecordsTable

- Partition Key：`record_id`
- `HASH#{sha256}`：防止同一內容重複處理的冪等標記。
- `EVENT#{uuid}`：保存 created、updated、duplicate、failed 事件。
- `expires_at`：可選 TTL，讓 Prototype 的詳細匯入歷史定期清理。
- 失敗檔不可寫入 WorkOrdersTable，但必須保留錯誤代碼、來源 Key、時間與可追查訊息。

## 必須保留的防呆

1. S3 Event Notification 是 at-least-once，且事件不保證順序；同一物件事件可能重複，因此 Lambda 必須以內容 SHA-256 冪等處理。
2. Bucket、Lambda 必須在同一 Region。
3. 僅監聽 `incoming/` 且副檔名為 `.xlsx`，避免 Lambda 將自己搬到 `archived/` 的檔案再次觸發。
4. AWS Prototype Parser 啟用 `syntheticOnly`，工單不是 `WO-DEMO-*` 時直接拒絕。
5. S3 Bucket 全面封鎖公開存取；來源文件由後端產生短效 Pre-signed URL，預設 5 分鐘。
6. 前端不得取得 AWS Access Key，也不得自行拼接 S3 URL。
7. Lambda 套件應鎖定並封裝實際使用的相依版本；不要依賴 Runtime 內 AWS SDK 的浮動次版本。

## Runtime 與部署方式

- Lambda Runtime：`nodejs24.x`。
- 架構：`arm64`，降低 Prototype 執行成本；若套件出現原生模組相容問題再改 `x86_64`。
- Infrastructure as Code：AWS SAM template。
- Lambda 依賴使用 esbuild 打包；ExcelJS 與 AWS SDK v3 套件一併封裝。
- 不在本機程式碼、ZIP、Git 或前端環境變數保存長期 AWS Access Key。
- Amplify Hosting SSR 不採用：AWS 官方目前列出的 Next.js SSR 支援上限為 Next.js 15，本專案為 Next.js 16／Vinext；為避免相容性風險，AWS 版輸出獨立靜態 SPA。

## 成本控制規則

- 部署前先建 AWS Budget，至少設定實際成本 50%、80%、100% 與預測超標通知。
- DynamoDB 使用 `PAY_PER_REQUEST`；不建立 Global Table、DAX、備援 Region。
- CloudWatch Logs 設定保留天數，不永久保存 Demo log。
- S3 使用 Lifecycle 清理 `incoming/`、`rejected/` 與過期 Demo 檔。
- API 與 Lambda 不配置 Provisioned Concurrency。
- Demo 結束依清理清單刪除 SAM Stack，並檢查 S3 物件、Log Group 與 Budget。

## 官方依據

- [DynamoDB On-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [API Gateway HTTP API 與 REST API 比較](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [S3 Event Notification 類型、重複與順序](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- [Lambda Node.js 支援 Runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
- [Lambda Node.js 部署套件與相依管理](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
- [S3 Pre-signed URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [建立 AWS Budget](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html)
- [Amplify Hosting 的 Next.js 支援範圍](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)
- [CloudFront + 私有 S3 OAC 靜態網站](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/getting-started-secure-static-website-cloudformation-template.html)
- [AWS Region 清單（台北為 ap-east-2，需先啟用）](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
