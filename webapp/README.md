# MirrorPin Webapp 0.3.0

这是自包含、纯前端的拼豆图纸生成器：

```text
上传 → 参数 → Web Worker 生成 → diagnostics → PNG/CSV
```

## 运行

在仓库根目录运行：

```bash
npm run build:webapp
npm run serve:webapp
```

打开 [http://localhost:5173/](http://localhost:5173/)。根级路由 `/generating`、`/result`、`/error` 也可直接访问，并分别跳转到对应的物理 HTML 页面。

## 架构

- `webapp/pages/*.html`：上传、生成中、结果、错误四个物理页面。
- `webapp/generating/index.html`、`webapp/result/index.html`、`webapp/error/index.html`：根级无扩展名路由别名，不依赖服务器 rewrite。
- `webapp/app/main.mjs`：页面控制、IndexedDB 恢复、下载与 requestId/stale-result 防护。
- `webapp/app/params.mjs`：可测试的参数解析、旧记录迁移与完整表单恢复；当前参数 schema 保留用户明确改动。
- `webapp/entry.worker.ts`：Worker 源码，调用共享 `runWorkerGeneration()`。
- `webapp/app/algo.worker.mjs`：构建生成的 Worker bundle。
- `webapp/app/algo.mjs`：主线程只保留板规、profile、渲染与材料统计。
- `webapp/app/styles.css`：本地 Tailwind 构建产物，无 CDN。
- `webapp/app/icons.mjs`：本地图标，无外部脚本。

Worker 进度阶段：`prepare / resample / candidates / optimize / cleanup / done`。完成消息包含 `requestId`、`diagnostics`、耗时和 `algorithmVersion`。

## 数据处理

图片处理和图纸生成均在浏览器本地完成，图片和生成结果保留在当前设备。当前会话数据保存在浏览器 IndexedDB，页面不依赖远程 API、CDN 或第三方字体。

## 部署包

```bash
npm run build:webapp-deploy
```

产物：`output/mirrorpin-webapp-deploy.zip`

ZIP 根目录含 `index.html`、`DEPLOYMENT.md`、`deployment.json` 和 `generating/`、`result/`、`error/` 路由目录。静态服务器只需：

1. 保持 ZIP 内目录结构；
2. 将 `.mjs` 返回为 `text/javascript` 或 `application/javascript`；
3. 不需要 SPA rewrite；
4. 可直接访问 `/`、`/generating`、`/result`、`/error`。
