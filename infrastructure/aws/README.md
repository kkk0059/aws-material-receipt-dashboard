# AWS SAM Infrastructure

此目錄定義可重建的 AWS Prototype 架構。每次部署都會在目標 AWS 帳號與 Region 建立一組新的 Demo 資源；實際帳號、端點與資源識別碼不得寫入 Repository。

## 目前資源

- 私有 S3 Bucket：`incoming/in-progress/`、`incoming/archived/` 為合成檔入口，處理後移至 `processed/` 或 `rejected/`。
- Processor Lambda：解析合成 Excel、套用共用規則、冪等寫入。
- WorkOrders DynamoDB：看板最新狀態。
- IngestionRecords DynamoDB：內容 Hash 與匯入事件。
- HTTP API + API Lambda：工單查詢與來源文件短效 URL。
- 私有 Frontend S3 Bucket + CloudFront OAC：提供靜態 SPA 與 HTTPS，Bucket 不公開。
- CloudWatch Log Groups：預設保留 14 天。

## 部署原則

- 使用 `sam build` 與 `sam deploy` 建立 Bucket、Lambda、DynamoDB、HTTP API 與 CloudFront。
- 只上傳 `WO-DEMO-*` 合成資料；不使用公司來源檔、真實工單或個人資料。
- 每個環境的 Bucket、API URL、CloudFront URL 與 Distribution ID 均由 CloudFormation Outputs 取得，不可提交到 Git。
- 部署與驗證流程見 [`../../docs/deployment/deploy.md`](../../docs/deployment/deploy.md)。

## 部署前必要條件

1. 使用者確認 AWS 帳號與 Region。
2. 先建立 AWS Budget 與 Email 通知。
3. `sam validate`、單元測試與 `sam build` 全部通過。
4. 確認上傳檔案全部為 `WO-DEMO-*` 合成資料。
5. 將 `samconfig.example.toml` 複製為本機設定；不要把帳號資訊或秘密提交進專案。
6. 部署命令必須由使用者明確授權後才能執行。

## 注意

`DeletionPolicy: Delete` 適用於可重建的 Demo 資源。正式系統不應直接沿用；正式版必須重新決定資料保留、備份與刪除保護。

Demo HTTP API 只提供合成資料且沒有登入，CORS 可使用 `*`。公司版或加入登入後不可沿用萬用 Origin，必須限制為核准的內網前端網址。
