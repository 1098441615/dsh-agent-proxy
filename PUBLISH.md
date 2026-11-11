# 发布与上架步骤

插件现在已经是可发布的 npm 包（`dsh-agent-proxy@0.1.0`，MIT，`dsh.bundle` + `dsh.client` 均已声明）。
下面三步按顺序做：删仓库 → 建仓库并推送 → 发 npm → 提目录 PR。

---

## 1. 删除三个仓库（GitHub 网页）

> 删除仓库不可恢复，删之前确认里面没有还想保留的代码。

对每一个仓库重复：

1. 打开 `https://github.com/1098441615/<仓库名>/settings`
   - https://github.com/1098441615/AlasXC/settings
   - https://github.com/1098441615/AzurLaneAutoScriptXC/settings
   - https://github.com/1098441615/10984416151/settings
2. 拉到页面最底部 **Danger Zone**
3. 点 **Delete this repository**
4. 弹窗里输入完整仓库名（如 `1098441615/AlasXC`）确认
5. 需要二次验证时按 GitHub 提示完成

---

## 2. 建仓库并推送插件

1. 打开 https://github.com/new
2. **Repository name** 填 `dsh-agent-proxy`
3. 选 **Public**，**不要**勾选 README / .gitignore / license（本地已经有了）
4. 点 **Create repository**

然后在 `D:\CS\plugins\dsh-agent-proxy` 里执行（Git Bash）：

```bash
git init
git add .
git commit -m "feat: dsh-agent-proxy 0.1.0"
git branch -M main
git remote add origin https://github.com/1098441615/dsh-agent-proxy.git
git push -u origin main
```

首次 push 会弹出浏览器登录 GitHub，按提示授权即可。

---

## 3. 发布到 npm

```bash
cd /d/CS/plugins/dsh-agent-proxy
npm login          # 浏览器登录，包名 dsh-agent-proxy 目前未被占用
npm publish        # publishConfig.access = public，无需加 --access
```

发布后用 `npm view dsh-agent-proxy` 确认能看到 `0.1.0`。

---

## 4. 提交到插件市场目录（awesome-dsh-plugin）

市场（dshmarket）的列表来自精选目录仓库，收录方式是给
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提一个 PR，
**只加一个文件**。

1. Fork 该仓库（网页右上角 Fork）
2. 在你的 fork 里打开 `data/plugins/`，点 **Add file → Create new file**
3. 文件名：`1098441615__dsh-agent-proxy.yml`
4. 内容：

```yaml
url: https://github.com/1098441615/dsh-agent-proxy
name: 1098441615/dsh-agent-proxy
category: git
description:
  en: 'One switch that routes the git, npm and pip commands DSH runs through a local HTTP proxy, restoring every previous setting when turned off.'
  zh: '一个开关，让 DSH 运行的 git、npm、pip 命令走本机代理，关闭时逐项还原原有设置。'
icon: https://raw.githubusercontent.com/1098441615/dsh-agent-proxy/main/assets/icon-180.png
```

5. Commit → **Compare & pull request**，标题写
   `Add 1098441615/dsh-agent-proxy`，正文说明：设置页开关、写入并还原 git/npm/pip 代理配置、无第三方依赖。
6. 提交 PR，等待维护者审核（通常一天内合并生效）

> 注意：`icon` 必须是 GitHub 托管的**位图**（PNG/JPG），所以用的是仓库里的 `assets/icon-180.png`；
> 不要填 SVG。

---

## 5. 验证上架

- 目录站：https://awesome-dsh-plugin.com 搜 `dsh-agent-proxy`
- DSH 插件市场：**插件 → 插件市场**搜 `proxy` 或 `代理`
- 或 **插件 → 发现 → 索引源** 添加
  `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`

别人安装命令：

```bash
dsh plugin --profile desktop add dsh-agent-proxy
```

---

## 附：以后发新版本

```bash
# 改 package.json 的 version，例如 0.1.1
git add package.json && git commit -m "chore: 0.1.1" && git tag v0.1.1
git push && git push --tags
npm publish
```

目录里的版本由 npm 自动刷新，条目不用改。
