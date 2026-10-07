# AWS 資源盤點與重建對照

本文件描述可由 `infrastructure/aws/template.yaml` 建立的 AWS Prototype。所有名稱均以範本參數或 CloudFormation Output 取得；不記錄任何既有帳號、端點、Bucket 名稱或 Distribution ID。

| 資源 | 用途 | 範本定義 | 重建方式 |
|---|---|---|---|
| Source S3 Bucket | 合成 XLSX 入口與處理後檔案保存 | 私有、加密、版本控制、`incoming/` 觸發、`rejected/` 生命週期 | SAM deploy |
| Processor Lambda | Excel 解析、規則判定、拒收與資料寫入 | Node.js 24、arm64、1,024 MB、60 秒 | SAM deploy |
| WorkOrdersTable | 每張工單最新狀態 | On-demand、`work_order` 主鍵 | SAM deploy |
| IngestionRecordsTable | 每次匯入紀錄與內容雜湊 | On-demand、工作單與時間 GSI、TTL | SAM deploy |
| HTTP API + API Lambda | 看板查詢、Demo 產檔、短效開檔連結 | GET / POST 路由與 Lambda 權限 | SAM deploy |
| Frontend S3 + CloudFront | 私有靜態網站與 HTTPS 看板 | OAC、HTTPS redirect、SPA error mapping | SAM deploy + 前端發布 |
| CloudWatch Log Groups | Processor 與 API 日誌 | 預設保留 14 天 | SAM deploy |

## 環境變動值

下列值不得寫死在原始碼或文件中：AWS Account ID、實際 Bucket 名稱、API URL、CloudFront URL、Distribution ID、AWS Credential。

部署後請從 CloudFormation Outputs 取得 `DashboardApiUrl`、`FrontendBucketName`、`FrontendDistributionId` 與 `DashboardUrl`。

## AWS 清除 Gate

在以下項目全部驗證前，不應刪除既有 AWS 部署：

- [ ] 原始碼、合成資料、SAM 範本與操作文件已進 GitHub。
- [ ] 從乾淨環境完成 `sam build` 與部署。
- [ ] 正常檔可自動匯入，並在 API 與看板顯示。
- [ ] 損壞檔可被拒收並在 CloudWatch 找到紀錄。
- [ ] 前端可由 CloudFront HTTPS 網址開啟。
- [ ] 已依 [清理流程](deployment/teardown.md) 完成費用與保留資料評估。
