# dsh-agent-proxy

给 DSH 的设置页加一个「代理」开关：打开后，DSH 替你运行的 `git clone`、`npm install`、`pip install` 等命令走本机代理，不再因为连不上 GitHub / npm 而超时。

## 它做什么

打开开关时，插件从两个层面让命令走代理：

**1. 工具配置文件**（对已经在运行的 shell 也生效）

| 工具 | 写入 |
| --- | --- |
| git | `~/.gitconfig` 的 `[http] proxy`、`[https] proxy` |
| npm | `~/.npmrc` 的 `proxy`、`https-proxy` |
| pip | `pip.ini` / `pip.conf` 的 `[global] proxy` |

打开前会记录每一项的原值；关闭时逐项还原（原本没有的键会被删掉，空下来的段/文件也会清理）。你原有的 `[user]`、`registry=`、`timeout=` 等其他配置不受影响。

**2. 子进程环境变量**（对之后新起的命令生效）

DSH 每次派生命令都会重建子进程环境，并重新套用它**启动时**解析出的代理策略，所以 `http_proxy` / `https_proxy` / `all_proxy` 这几个名字会在运行时被清掉。插件改用各工具自己的环境通道：

```
GIT_CONFIG_PARAMETERS        http.proxy / https.proxy（等于 git -c，不写文件）
npm_config_proxy             npm_config_https_proxy
PIP_PROXY                    PIP_HTTPS_PROXY
http_proxy https_proxy all_proxy（及大写形式）、NODE_USE_ENV_PROXY=1
```

## 代理地址从哪来

按优先级：

1. 插件配置里的 `proxyUrl`；
2. Windows 系统代理（HKCU Internet Settings，即 Clash / V2Ray 打开的「系统代理」）；
3. DSH 启动时已导出的 `HTTPS_PROXY` / `HTTP_PROXY`。

设置页开关下方会显示当前生效的地址与来源。

## 安装

从 npm 安装（发布后）：

```bash
dsh plugin --profile desktop add dsh-agent-proxy
```

也可以直接从本目录安装（本地开发）：

```powershell
dsh plugin --profile desktop add <本包目录>
```

安装后完全退出并重开 DSH，打开 **设置 → 代理**。

## 配置

开关状态保存在 `$DSH_HOME/agent-proxy.json`，重启后保留。需要固定地址时：

```yaml
- insert:
    - id: agent-proxy
      name: 'dsh-agent-proxy'
      config:
        enabled: true
        proxyUrl: 'http://127.0.0.1:7890'
```

`proxyUrl` 留空即自动检测系统代理；`enabled` 只是状态文件尚不存在时的初始默认值。

## 验证

开启后让 DSH 执行：

```bash
git config --global --get http.proxy    # 应输出代理地址
git ls-remote https://github.com/FNOSP/fnos-dsh HEAD
```

`git` 的详细输出里出现 `Trying 127.0.0.1:789x` 与 `CONNECT tunnel established` 即表示走了代理。

## 已知边界

- 只影响 DSH 派生的命令与 git/npm/pip 的全局代理配置；关闭后原值还原。
- 代理地址只支持 HTTP(S) 代理（`http://host:port`），不支持 SOCKS5 / PAC。
- 只认 `http_proxy` 且不读任何配置文件的命令（如某些 `curl` 调用）不一定被覆盖。
