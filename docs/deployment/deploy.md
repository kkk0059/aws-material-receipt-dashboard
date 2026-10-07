# 部署流程

> 僅可部署 Synthetic Demo Data。部署前請先建立 AWS Budget 與通知，並確認目標帳號與區域正確。

## 1. 本機驗證

```powershell
cd apps/dashboard
pnpm install --frozen-lockfile
pnpm test
cd ../..
.\scripts\Build-AwsPrototype.ps1
```

## 2. 部署基礎設施

```powershell
cd infrastructure/aws
sam validate --lint --template-file template.yaml
sam build --template-file template.yaml
sam deploy --guided --template-file template.yaml
```

部署時記錄 CloudFormation Outputs 中的 API、前端 Bucket、CloudFront Distribution 與 Dashboard URL。這些是每個環境不同的值，不可回寫到原始碼。

## 3. 發布前端

由專案根目錄執行：

```powershell
.\scripts\Publish-AwsFrontend.ps1 -StackName '<stack-name>' -Region '<region>'
```

此腳本會讀取 Stack Outputs、以對應 API URL 建置靜態網站、同步到前端 Bucket，並提出 CloudFront Invalidation。

## 4. 後續驗證

依 [驗證清單](verification.md) 完成正常與損壞 XLSX 的端到端驗證，再決定是否保留或清除資源。
