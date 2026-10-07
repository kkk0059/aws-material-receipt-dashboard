# 清理流程

此流程會刪除雲端資源，僅能在已確認 GitHub 可重建、且不需保留目前 Demo 證據時執行。

## 清理前

- 確認 [AWS 清除 Gate](../aws-resource-inventory.md#aws-清除-gate) 已全部完成。
- 確認 S3、DynamoDB 與 CloudWatch 中沒有需要保留的資料。
- 保存必要的 Synthetic Demo 截圖；不要保留公司資料。

## 建議方式

由 CloudFormation 刪除 Stack，讓由範本管理的 Lambda、API、DynamoDB、S3、CloudFront 與 Log Group 一起清理。

若 Stack 刪除被 S3 非空物件阻擋，先確認 Bucket 僅有合成資料，再清空該 Bucket 後重試。刪除完成後，於 AWS Console 確認沒有遺留 CloudFront Distribution、S3 Bucket、DynamoDB Table 或 Log Group。

## 清理後

- 確認 AWS Budget 與 Billing 頁面沒有不預期的持續用量。
- 保留 GitHub commit SHA 與重建文件。
- 日後重新啟用時，依 [部署流程](deploy.md) 在新環境建立資源，不沿用過期的端點或 Bucket 名稱。
