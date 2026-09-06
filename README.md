# 周看板 · Weeklyboard

一个直接在浏览器里使用的周时间管理工具。安排计划、记录实际完成情况，并在同一张周看板里对比。无需注册，无后端数据库。

本项目严格以 `weeklyboard-main.zip` 为基础。`index.html`、`app.js` 和 `styles.css` 与压缩包中的原文件完全一致，没有合入本地周看板的任何排版或功能改动。仅补充项目说明、检查脚本和 GitHub Pages 部署配置。

源码保留原版默认姓名和示例文本，首次使用可在看板内修改姓名。项目不包含浏览器里的个人周计划、导出备份或电脑上的其他文档。

## 已包含

- 按周创建、复制、删除看板，自定义姓名和日期。
- 拖拽安排时间、冲突并排显示、右下角拖动复制日程。
- 预计与实际图层、完成记录、番茄钟统计；1 个番茄钟为 30 分钟。
- 每日睡眠和必要事项设置，周中与周末可分别安排。
- 实时保存、每 30 秒自动保存、撤回、JSON 导入与导出。
- A4 PDF 导出，以及课表 CSV、日历 ICS 导入与导出。
- 原版看板缩放和模块显示控制。

## 上传到 GitHub

1. 在 GitHub 创建仓库，例如 `weeklyboard`。免费账户使用 GitHub Pages 时可选择公开仓库；公开前检查文件中没有个人信息。
2. 将**本文件夹里的内容**上传到仓库根目录。打开仓库时应直接看到 `index.html`、`app.js`、`styles.css` 和 `README.md`，不要再套一层 `weeklyboard-github` 文件夹，也不要只上传 ZIP。
3. 自动部署需要一并上传 `.github/workflows/pages.yml`。在 Mac 的文件选择器或 Finder 中按 `Command + Shift + .` 可显示隐藏文件。也可以使用 Git 将整个项目推送到 `main` 分支。
4. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
5. 打开 **Actions → Deploy weeklyboard to Pages → Run workflow**，选择 `main` 后运行。之后每次更新 `main` 都会重新检查并部署。
6. 部署成功后，在 **Settings → Pages** 或部署结果里打开实际生成的网址。仓库名为 `weeklyboard` 时，地址通常形如 `https://你的用户名.github.io/weeklyboard/`；这只是格式示例，不是已经创建的网址。

如果第一次上传后 Actions 在开启 Pages 前失败，完成第 4 步后重新运行工作流即可。若仓库的默认分支不是 `main`，请同步修改工作流的分支筛选和部署条件。

**不使用 Actions 的简单方式：** 上传三个应用文件和 `.nojekyll`，在 Pages 中选择 **Deploy from a branch → main → / (root)**。这两种发布方式选一种即可。自动检查和仅发布应用文件的保护由 Actions 方式提供。

配置依据：[GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[自定义部署工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 数据与迁移

- 任务保存在当前浏览器的 `localStorage` 中，不会自动上传到 GitHub。访问同一个网址的人使用同一套程序，但不会看到彼此的任务。
- **没有账号同步或多人共同编辑功能。** 不同设备、浏览器、网址来源的数据并不共用；同一浏览器配置内共用这份存储的人可以看到其中的任务。
- 从原来的本地文件迁移到线上：先在原页面导出需要保留的各周 JSON，再在新网址导入。上传源代码不会搬运浏览器里的记录，也不会修改原页面的数据。
- 当前 JSON 导出针对当前周，不是所有周的整库备份。重要内容请逐周导出并妥善保管，勿提交到公开仓库。
- 清除网站数据、使用无痕模式或更换浏览器都可能导致记录不可用。自动保存不等于云端备份，也不能保证浏览器数据永不丢失。
- 同一个 GitHub Pages 域名下的其他项目可能共享浏览器存储来源。当前版本保留旧的存储键以兼容已有记录；需要相互隔离的两套看板应使用不同域名或浏览器配置。

## 本地使用与开发

直接打开 `index.html` 即可使用，不要求安装 Node.js。建议正式使用时固定在一个网址，避免不同来源之间的存储混淆。

开发检查使用 Node.js 22 或更新版本。项目没有 npm 依赖，无需运行 `npm install`：

```sh
npm run check
npm test
npm run build
```

构建仅把公开应用文件复制到 `dist/`，不会打包测试、文档或备份。`dist/` 是生成目录，不要在里面存放个人文件；再次构建会清理其内容。

```text
index.html                   页面入口
app.js                       任务、存储和时间记录逻辑
styles.css                   基础样式及打印 / PDF 样式
.github/workflows/pages.yml   检查与 GitHub Pages 部署
scripts/build.mjs            生成静态发布目录
tests/project.test.mjs        项目与核心逻辑检查
SOURCE.md                    压缩包来源与原文件校验值
```

## PDF 与外部资源

普通看板不需要在线接口。点击导出 PDF 时会通过 jsDelivr 加载 `html2canvas@1.4.1` 和 `jspdf@2.5.1`，因此 PDF 导出需要能访问该 CDN。生成过程在浏览器中进行；应用代码没有将任务数据发送给服务端的请求。JSON 导出不依赖这些库。

## 验证范围

自动检查覆盖入口资源、5 分钟时间单位、30 分钟番茄钟、基础数据规范化、睡眠设置编辑事件，以及发布文件白名单。另有来源校验记录，用于确认最初交付的三个应用文件与 ZIP 一致。它们不是浏览器端视觉测试。正式分享前，建议在部署网址验证：创建任务、拖拽复制、实际记录、返回首页后重开、刷新、JSON 迁移和 PDF 导出。
