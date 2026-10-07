# Canonical Data Model V1

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| work_order | string | 是 | 工單識別；Demo 使用 `WO-DEMO-*` |
| file_version | enum | 是 | `legacy` / `current` |
| source_file | string | 是 | 不可洩漏公司路徑 |
| source_object_key | string / null | 否 | AWS Adapter 保存受控 S3 Object Key；前端不可直接使用此欄位拼接 URL |
| source_state | enum | 是 | `in_progress` / `archived` |
| operator / confirmation_time | string、datetime / null | 否 | 缺值不直接改變 Receipt Status |
| required_pn / received_pn | integer | 是 | 非負整數 |
| pn_difference | integer | 是 | 保留來源數值 |
| receipt_qty / issue_qty / qty_difference | number | 是 | 差異保留正負號 |
| shortage_count / extra_pn_count | integer | 是 | 非負整數 |
| actual_receipt_qty_diff_count | integer / null | 否 | 舊版為 null |
| completion_rate | integer | 是 | `min(100, round(received / required × 100))`；required=0 時為 0 |
| receipt_status | enum | 是 | 點收結果，與進度分開 |
| data_quality_status | enum | 是 | `complete` / `missing_metadata` / `legacy_incomplete` |
| action_required | boolean | 是 | Receipt 異常或非豁免資料缺失 |
| last_updated | datetime | 是 | 系統處理時間 |

## 第一版唯一鍵建議

Prototype 使用 `work_order` 作為目前狀態主鍵並採 Upsert。另外預留 `ingestion_id` 與歷史事件表，避免未來只能看到最後狀態。
