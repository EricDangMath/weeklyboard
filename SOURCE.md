# 来源与整合范围

来源文件：`weeklyboard-main.zip`

压缩包中的项目目录：`weeklyboard-main/`

交付规则：三个应用文件保持原样，不合入本地周看板的改动，不添加 `layout.css`。仅新增仓库说明、GitHub 配置、构建和测试文件。原本的本地周看板与用户浏览器数据不作修改。

## 原文件 SHA-256

```text
de5a14564c8e25ab7362216ef6f2b0ab285339b6b50eb639d7313cbe00975079  app.js
2459891fdc35f0dcccb943d002436c68a498c38333ecaef6d1ba7dd081cb7eaa  index.html
5f009b58aa1137a2ceee35364786d2cefca55d54a5604209ab8db52f48a2fdf1  styles.css
```

这些校验值记录初次整理时的来源，并非要求后续开发永远保持不变。后续可直接修改项目源码；修改后对应校验值自然会变化。

## 新增文件

- `README.md`：使用、上传、发布和数据迁移说明。
- `.github/workflows/pages.yml`：自动检查和 GitHub Pages 部署。
- `.gitignore`、`.gitattributes`、`.nojekyll`：仓库及静态发布配置。
- `package.json`、`scripts/build.mjs`、`tests/project.test.mjs`：无需第三方依赖的开发检查和发布脚本。
- `SOURCE.md`：本来源记录。
