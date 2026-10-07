# 部署驗證清單

部署完成不等於系統正常。請逐項確認：

- [ ] CloudFormation Stack 狀態為完成，且資源包含 S3、Lambda、DynamoDB、HTTP API 與 CloudFront。
- [ ] CloudFront HTTPS 網址可開啟 Dashboard。
- [ ] 上傳或產生正常 Synthetic XLSX 後，S3 Event 觸發 Processor Lambda。
- [ ] 最新工單狀態寫入 WorkOrdersTable。
- [ ] HTTP API 可回傳 Dashboard 所需資料，且不回傳來源檔內部位置。
- [ ] Dashboard 能呈現新工單、完成率、點收結果與資料品質。
- [ ] 送出損壞 XLSX 後，檔案移入 `rejected/`，不建立正常工單。
- [ ] CloudWatch 可查到拒收事件、來源位置、拒收位置與錯誤代碼。
- [ ] 重新送入相同內容的檔案時，不重複建立或重複計算結果。
