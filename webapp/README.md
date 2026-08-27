# MirrorPin webapp（纯前端本地版）

基于 UI/UX 设计稿（`pages/*.html`，原始设计在 `C:\Users\25230\Documents\6a903fc1493b39ac3ad12b8d\mirrorpin-design`）适配算法库的单页流程：

```
上传图片 → 选板规/色卡/复杂度/抠白底 →（高级设置折叠可选）→ 生成图纸 → 预览 + 材料清单 → 下载 PNG/CSV
```

## 运行

```bash
# 1. 构建浏览器算法包（esbuild 打包 src + fft.js → webapp/app/algo.mjs）
npm run build:webapp

# 2. 本地静态服务（零依赖，默认 5173）
npm run serve:webapp
# 或一条命令：npm run webapp
```

打开 http://localhost:5173/ 。

## 架构

- `pages/*.html`：设计稿四页（index/generating/result/error），仅注入 `<script type="module" src="../app/main.mjs">`，未改设计稿结构与样式。
- `app/main.mjs`：页面逻辑 —— 参数收集（板规/色卡/复杂度→minBeads/抠白底/高级折叠）、IndexedDB 中转（图片、参数、Grid、meta），生成在 generating 页执行后跳 result。
- `app/algo.mjs`：浏览器算法包（构建产物，不入库）—— `generateForBoard`（`E:\M_Workbench\MirrorPin\src\board.ts`，fixed 板规铺满 + L0 + DPID）+ `renderPatternImage` + `countGridMaterials`。
- 隐私：全程浏览器本地计算，IndexedDB 中转，无任何网络请求出站。

## 说明

- 真实上传需在浏览器里选择本地文件（IAB 自动化不支持 file chooser，验证用 `pages/_qa.html` 临时页执行完整链路后已删除）。
- 生成在主线程同步执行，78×78 板规 1024² 图约 9 秒；取消按钮回 index（结果丢弃）。
