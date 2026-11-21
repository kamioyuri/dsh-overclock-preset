# dsh-overclock-preset ｜ 超频模式

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）加一个 agent 预设：**不为了省 token 而压缩、省略或截断输出**，并**默认自动启动多 agent 并行分工与汇总**。

[English](README.md) ｜ [简体中文](README.zh-CN.md)

开启插件后，预设选择器里多出「超频模式 / Overclock Mode」；关掉插件它就消失，现有预设与部署默认值都不受影响。

零依赖、无构建步骤、不注册任何工具：它只通过宿主注册表声明一个预设。

---

## 它解决什么

默认的 agent 有两种「省」的倾向，长任务因此常常交回半成品：

1. **回答写短**：清单被裁剪、文档写到一半、用「其余同理」收尾。
2. **不开多 agent**：除非用户明确要求，否则很少把工作扇出给子 agent。

这个预设把两件事反过来：

| 问题 | 预设的做法 |
| --- | --- |
| 回答写得短、动辄「以下省略」 | persona 声明 token 预算无上限，并列出禁止的省略形态 |
| 长任务半途收尾 | 长内容从断点续写到交付完整；`ralph` 轮数从 64 提到 96 |
| 不主动开多 agent | 拆成 2–5 个并行子任务，主控负责合并、去重与交叉验证 |
| 工具说明写着「克制使用」 | persona 显式声明优先级高于工具级的「仅在用户要求时使用」 |
| 压缩提前触发、工具输出被裁剪 | 压缩阈值后移（0.8 → 0.9）、逐字保留提高（0.16 → 0.3）、裁剪阈值放宽 6 倍 |

## 相对内置 `standard` 预设的差异

其余部分与 standard 完全一致（27 行：24 个插件行 + 3 个隔离域）。

| 维度 | standard | 超频模式 |
| --- | --- | --- |
| 人设 | 部署默认人设 | 预算无上限、禁止自我截断、默认多 agent |
| 压缩阈值 | `thresholdRatio 0.8` / `retainRatio 0.16` | `0.9` / `0.3` |
| 压缩余量 | `headroomTokens 65536` | `8192`（见下） |
| 工具结果裁剪 | 8,192 字符（头 4,096 / 尾 1,024） | 49,152 字符（头 36,864 / 尾 8,192） |
| 委派深度 | 1 | 2 |
| `workflow` 结果上限 | 50,000 字符 | 200,000 字符 |
| `ralph` 轮数 | 64 | 96 |

**为什么把 `headroomTokens` 调小**——它不是「省 token」的开关，而是避免压缩策略直接失效。阈值是 `floor(min(W × ratio, W − O − headroom))`，默认 65,536 会让小上下文模型（32K / 49K）算出**负的压力预算**，插件抛 `TargetPressureConfigError`、压缩完全不可用。调到 8,192 之后小模型能用，而大模型的阈值反而比默认更晚（131K 窗口：standard 57,344 触发，超频模式 114,688 才触发）。

## 安装

```bash
git clone https://github.com/kamioyuri/dsh-overclock-preset.git

# 装进你实际使用的 profile（desktop / web / 自建）
dsh plugin --profile desktop add file:<仓库的绝对路径>
```

装完**重启 dsh**——宿主只在启动阶段读取 bundle 与预设声明。之后新建会话，打开预设选择器，选「超频模式 / Overclock Mode」。

> `file:` 依赖是**复制**进 profile 的。改了源码要重新 `add`，或直接把 `lib/` 覆盖到 `~/.dsh/profiles/<profile>/node_modules/dsh-overclock-preset/`。

## 验证

```powershell
# 1) bundle 列表里出现包名
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern overclock

# 2) 组合树里出现插件行
#    （desktop profile 被桌面端独占，CLI 只能对其它 profile 做这一步）
dsh --profile <profile> --dump-config | Select-String overclock
```

界面侧唯一需要看的判据：**选择器里出现该预设，且没有标注加载失败**。dsh 会把加载失败的预设连同原因一起列出而不是隐藏——所以「看不见」= 没装上，「看见了但报错」= 组装里有行没能激活。

## 卸载 / 临时关闭

```powershell
# 临时关闭：在 ~/.dsh/profiles/<profile>/cordis.patch.yml 里给这一行加 disabled: true
- id: overclock-preset
  disabled: true

# 彻底卸载
dsh plugin --profile desktop remove dsh-overclock-preset
```

## 三个必须知道的限制

1. **成本**。这个预设按设计会多花 token（并行 agent + 更长输出）。它是「我要一次做完整」时手动切过去的模式，不适合当日常默认。
2. **单轮输出上限不在这里**。`maxTokens` 属于 model route（`models[].maxTokens`）。预设可以拒绝压缩，但改不了适配器的物理上限。本地小模型想放开单轮长度，得去改那里。
3. **预设只能在空白会话上切换**。这是 dsh 的规则（中途换工具集会作废已记录的工具调用），不是插件的限制。

## 设计说明：为什么在代码里注册，而不是在 YAML 里声明

dsh 0.2.x 支持在 `cordis.patch.yml` 里插一行 `@deepseek-ai/dsh-agent-preset` 来声明预设。对**第三方插件包**，这条路径有个陷阱：

- 声明行的子行用 Loader 的 `import.meta.resolve` 解析，锚点是**声明文件所在包的根**。
- 插件被装进 `profiles/<profile>/node_modules` 后，从那里解析不到宿主自带的 `@deepseek-ai/dsh-*`，整个预设会变成 broken。

`ctx.agentPresets.register()` 的解析锚点则是**注册表服务自己的装载位置**（dsh 宿主包目录），所以无论装到哪个 profile 都能解析。

代价是插件必须在宿主进程里跑一段 `apply()`；好处是**零 import、零依赖、没有会漂移的构建产物**。`register()` 返回的 disposer 交给 `ctx.effect`，禁用插件时预设自动注销。

## 目录结构

```
.
├── lib/
│   ├── preset.js          # 预设本体：id / 展示元数据 / 27 行组装 / persona 正文
│   └── index.js           # 插件入口：ctx.agentPresets.register(PRESET)
├── cordis.patch.yml       # bundle 补丁层：把插件挂进 profile
├── tests/preset.test.mjs  # 9 项结构自检（零依赖，node --test）
├── .github/workflows/     # CI：跑自检
└── package.json
```

## 自定义

改 `lib/preset.js`，然后同步进 profile：

- **更狠**：`tool-ralph.maxRounds` → 200，`tool-workflow.maxResultChars` → 500000。
- **更省**：`maxDepth` 改回 1；或放宽 persona 里「只有三类可以直答」的门槛。
- **换人设**：重写 `PERSONA` 数组。它是 `deployment:persona-prefix`，每一轮请求都带着，别写太长（当前约 1.3k 字符）。

改完跑一遍自检：

```bash
node --test tests/preset.test.mjs
```

## 兼容性

- 需要 dsh 0.2.x（声明式预设注册表 `agentPresets`）。0.1.x 的 `.agent-presets/<id>/` 目录格式已被上游废弃，本插件不写那个目录。
- 只依赖宿主自带包，没有第三方依赖。
- 目前只在 Windows 上实机验证过；shell 行按 `process.platform` 自动在 `tool-bash` / `tool-pwsh` 之间二选一。

## License

[MIT](LICENSE)
