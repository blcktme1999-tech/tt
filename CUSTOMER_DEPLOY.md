# 客戶使用部署說明

## 建議部署方式

目前正式建議使用 Vercel + Supabase：Vercel 提供網站與 `/api` serverless，Supabase 保存案件、訊息、帳號與影片，Agora token 也由 Vercel API 產生。

Render 版本仍保留在 `server.js`，可作為長駐 Node 後端備用。

## Vercel 快速部署

1. 將 GitHub repo 匯入 Vercel。
2. 設定 Environment Variables：
   - `SESSION_SECRET`：輸入一組長隨機字串。
   - `ADMIN_PASSWORD`：設定管理員 `admin` 的初始密碼。
   - `SUPABASE_URL`：Supabase Project URL。
   - `SUPABASE_SERVICE_ROLE_KEY`：Supabase secret/service role key。這是機密，不要寫進 GitHub。
   - `SUPABASE_VIDEO_BUCKET`：預設 `report-videos`。
   - `AGORA_APP_ID`：Agora 專案 App ID。
   - `AGORA_APP_CERTIFICATE`：Agora 專案 App Certificate。這是機密，不要寫進 GitHub。
   - `AGORA_TOKEN_TTL_SECONDS`：視訊 token 有效秒數，預設可用 `3600`。
3. 到 Supabase 的 SQL Editor 執行 `SUPABASE_SCHEMA.sql`，建立 `service_users`、`service_cases`、`service_messages`、`service_files` 與 `report-videos` bucket。
4. 部署後使用 Vercel 網址，例如：

```text
https://tt-theta-eight.vercel.app
```

## Render 備用部署

## Render 快速部署

1. 將 GitHub repo 匯入 Render。
2. 選擇 Blueprint 或 Web Service。
3. 使用本 repo 的 `render.yaml`。
4. 設定環境變數：
   - `SESSION_SECRET`：輸入一組長隨機字串。
   - `ADMIN_PASSWORD`：設定管理員 `admin` 的初始密碼。
   - `AGORA_APP_ID`：Agora 專案 App ID。
   - `AGORA_APP_CERTIFICATE`：Agora 專案 App Certificate。這是機密，不要寫進 GitHub。
   - `AGORA_TOKEN_TTL_SECONDS`：視訊 token 有效秒數，預設可用 `3600`。
5. 部署完成後會取得公開網址，例如：

```text
https://cib-online-report-service.onrender.com
```

## 客戶網址

主網站：

```text
https://你的後端網址/
```

線上報案客服：

```text
https://你的後端網址/service/
```

對應檔案：

```text
public/service.html
```

管理端：

```text
https://你的後端網址/admin
```

客服端：

```text
https://你的後端網址/service/#staff
```

## 預設帳號

管理員帳號固定為：

```text
admin
```

密碼由 `ADMIN_PASSWORD` 環境變數決定；沒有設定時預設為 `admin`。正式給客戶使用時請改成較安全的密碼。

## 注意事項

- Render 免費方案可能會休眠，第一次開啟會比較慢。
- 影片檔與 SQLite 資料建議存在 Render Disk。若沒有設定 Disk，系統會自動改用 `/tmp/cib-online-report-service` 讓服務先啟動，但資料可能在重新部署或休眠後消失。
- 如果部署出現 `EACCES: permission denied, mkdir '/var/data/data'`，代表 Web Service 沒有掛載 Render Disk；可新增 Disk，或先移除 `STORAGE_DIR=/var/data` 使用暫存模式。
- Agora 正式視訊由 Render 後端產生 token；民眾輸入的身分證/居留證號會作為 Agora 頻道名稱，管理員審核開通後才能加入視訊筆錄。
- 正式營運建議改 PostgreSQL 與 S3/R2 物件儲存。