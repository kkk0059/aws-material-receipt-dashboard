# Source Document Access Design V1

更新日期：2026-08-25

## 使用者需求

使用者在 Dashboard 點選工單後，可從工單詳情直接開啟對應的來源文件。介面固定使用：

**開啟來源文件 / Open Source File**

## 第一版 Demo

- 工單詳情顯示開啟文件按鈕。
- 每張 `WO-DEMO-*` 工單連到對應的合成 `.xlsx`。
- 瀏覽器若不能直接預覽 Excel，會下載檔案，再由使用者使用 Excel 開啟。

## AWS Prototype

``` text
Dashboard
→ GET /work-orders/{workOrder}/source-document
→ Backend 驗證工單
→ 產生短時間有效的 S3 Pre-signed URL
→ Browser 開啟／下載 Synthetic Demo File
```

- 前端不得保存 S3 Bucket 權限或 AWS Credential。
- Pre-signed URL 必須短時間有效。
- Backend 只允許查詢已存在於資料庫的 Demo 工單。

## 公司內網版

``` text
Dashboard
→ Internal API 接收 Work Order
→ Database 查詢 Source File ID
→ File Service 驗證允許的 Shared Folder Root
→ 串流文件或提供內網下載
```

- 前端不得直接接收任意檔案路徑。
- 不可把使用者輸入直接組成 `\\server\share\...`，避免存取非預期檔案。
- Database 應保存受控的 `source_file_id` 或相對路徑；File Service 再解析為實際位置。
- 若公司電腦與瀏覽器允許 Office Protocol，可在後續評估直接交給 Excel 開啟；第一版先採可靠的下載／開啟方式。

## 找不到文件時

顯示雙語錯誤：

``` text
找不到來源文件，請確認工單資料或重新整理。
Source file not found. Check the work order data or refresh the page.
```

錯誤必須留下 Work Order、查詢時間與錯誤類型，但不得在前端顯示完整伺服器路徑。
