# Contributing

## 开发环境

```bash
npm install
npm run build        # tsup（库 ESM+CJS+类型）+ esbuild（CLI dist/cli.js，含 shebang，sharp external）
npm test             # vitest run（13 套件 68 用例）
npx tsc --noEmit     # 类型检查（覆盖 src + cli + tests + scripts）
```

## CLI 验证

```bash
node E:\M_Workbench\MirrorPin\dist\cli.js --help
node E:\M_Workbench\MirrorPin\dist\cli.js --version
node E:\M_Workbench\MirrorPin\dist\cli.js "E:\Downloads\Q13_peek_探头.png" -o "E:\M_Workbench\MirrorPin\output\Q13_pattern.png" --materials "E:\M_Workbench\MirrorPin\output\Q13_materials.csv" --palette mard221 --min-beads 5
```

非法参数（如 `--max-side abc`、`--palette WRONG`）应报可读错误而非静默 NaN。

## 浏览器前端

`web/` 为独立 Vite 项目（非 npm workspaces），通过 `@lib -> ../src` 别名复用算法库：

```bash
cd E:\M_Workbench\MirrorPin\web
npm install
npm run dev
npm run build
```

## 目录与构建

- `src/index.ts` 为公共出口；另有 `src/render/node.ts`（sharp 渲染）在 `package.json:exports["./render-node"]` 可达
- `tsup.config.ts` 产出 `dist/index.*` 与 `dist/render-node.*`；`scripts/build-cli.mjs` 单独产出 `dist/cli.js`
- `dist/`、`output/` 已在 `.gitignore` 中忽略；`output/` 中示例图不入库

## 提交

- 提交前 `npm run build && npm test && npx tsc --noEmit` 均绿
- 涉及色卡/管线/渲染的改动需同步 `README.md` 选项表与 `docs/API.md`
