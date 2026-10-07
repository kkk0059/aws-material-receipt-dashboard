# 設定說明

## 必要工具

- Node.js 22 或以上
- pnpm
- AWS CLI（已登入目標 AWS 帳號）
- AWS SAM CLI

## SAM 參數

`infrastructure/aws/template.yaml` 使用下列參數：

| 參數 | 用途 | 範例 |
|---|---|---|
| `ProjectName` | 資源命名前綴 | `material-dashboard-demo` |
| `StageName` | HTTP API Stage | `demo` |
| `AllowedOrigin` | API 允許的前端來源 | 初期可使用 `*`；正式版需限制網址 |
| `LogRetentionDays` | Log 保留天數 | `14` |

可將 `infrastructure/aws/samconfig.example.toml` 複製成未追蹤的本機設定檔，再依目標帳號與區域調整。不要在設定檔填入 Access Key、Secret Key 或實際帳號識別碼。

## 前端 API 設定

前端只讀取 `NEXT_PUBLIC_MATERIAL_API_BASE_URL`。部署後，將 CloudFormation Output 的 `DashboardApiUrl` 設為此值後再建置靜態檔案。

PowerShell 範例：

```powershell
$env:NEXT_PUBLIC_MATERIAL_API_BASE_URL = '<DashboardApiUrl>'
pnpm run build:static
Remove-Item Env:NEXT_PUBLIC_MATERIAL_API_BASE_URL
```
