# 好运弹珠社 · PIGGY PINBALL

根据参考图制作的复古小猪街机弹珠小游戏，使用原生 HTML、CSS 和 Canvas，无需安装依赖。

## 在线游玩

打开 [好运弹珠社](https://hu0225.github.io/Piggy-Pinball/) 即可直接游玩，支持电脑和手机。

## 直接游玩

双击 `好运弹珠社.html`，即可在现代浏览器中离线游玩。所有样式、绘图、音效和物理代码均内嵌在这一个 HTML 文件中。

- 按住空格键、橙色发射按钮或游戏台面蓄力，松开发射。
- 蓄力在弱到强之间往复变化；不同力度会改变弹珠进入钉阵时的轨迹。
- 每局 20 颗弹珠，可连续发射，台面最多同时容纳 10 颗。
- 落槽获得 10 / 20 / 50 / 100 / 200 分，最高分保存在本地浏览器。
- 按 M 或右上角喇叭开关音效；“再来一局”重新开始。
- 手机支持触屏操作；发射按钮固定在屏幕底部，也可以直接按住台面。

## 修改源码

`dist/index.html` 是页面结构，`dist/style.css` 是响应式外观，`dist/app.js` 是绘图和交互，`dist/physics.js` 是独立物理引擎。没有第三方图片、字体、脚本或网络请求。

修改后运行 `node build-single.mjs`，重新生成单文件 HTML。

## 本地预览与验证

在本目录运行 `python -m http.server 4173 --directory dist`，浏览器访问 http://localhost:4173 。

运行 `node test-physics.cjs` 验证 101 档力度、所有奖励槽和 10 球并发。

## GitHub Pages 部署

`.github/workflows/pages.yml` 会在 `main` 分支的游戏文件发生变化时，检查脚本、运行物理测试，并将 `dist/` 发布到 GitHub Pages。也可以在 GitHub 的 Actions 页面手动运行 “Deploy game to GitHub Pages”。

仓库 Settings → Pages 的发布来源使用 **GitHub Actions**。

这是休闲积分游戏，不包含充值、押注或实物兑换。
