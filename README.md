# dsh-overclock-preset ｜ 超频模式

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）加一个 agent 预设：**不为了省 token 而压缩、省略或截断输出**，并**默认自动启动多 agent 并行分工与汇总**。

一个 dsh 插件。开启后预设选择器里多出「超频模式」，关掉插件它就消失，现有预设与部署默认值都不受影响。

> **English**: An agent-preset plugin for DeepSeek Harness (`dsh`) that stops the model from trimming output for token economy and orchestrates multiple sub-agents by default. Zero dependencies, no build step, no tools registered — it only declares one preset through the host registry.

---

## 它解决什么

默认的 agent 有两种「省」的倾向：一是为了省 token 把回答写短、把长清单截断、用「其余略」收尾；二是很少主动开多 agent，除非用户明确要求。这两种倾向在长任务上都会让交付物变成半成品。

「超频模式」用一份预设把这两件事反过来：

| 问题 | 这个预设的做法 |
| --- | --- |
| 回答写得短、动辄「以下省略」 | persona 明确「token 预算无上限」，禁止自我截断，列出禁止的省略形态 |
| 长任务半途收尾 | 长内容分段续写到交付完整；多轮逼近用 `ralph`，轮数上限从 64 提到 96 |
| 不主动开多 agent | 默认按 2–5 个子任务并行派发，主控负责合并去重与交叉验证 |
| 工具说明里写着「克制使用」 | persona 显式声明优先级高于工具说明的「仅在用户明确要求时使用」 |
| 压缩提前触发、工具输出被裁剪 | 压缩阈值后移（0.8 → 0.9）、逐字保留提高（0.16 → 0.3）、裁剪阈值放宽 6 倍 |

## 相对内置「标准模式」的差异

组装的其余部分与 standard 保持一致（27 行：24 个插件行 + 3 个隔离域）。

| 维度 | 标准模式 | 超频模式 |
| --- | --- | --- |
| 人设 | 默认部署人设 | 预算无上限、禁止自我截断、默认多 agent |
| 压缩阈值 | `thresholdRatio 0.8` / `retainRatio 0.16` | `0.9` / `0.3` |
| 压缩余量 | `headroomTokens 65536` | `8192`（见下方说明） |
| 工具结果裁剪 | 8192 字符（头 4096 / 尾 1024） | 49152 字符（头 36864 / 尾 8192） |
| 委派深度 | 1 | 2 |
| `workflow` 结果上限 | 50,000 字符 | 200,000 字符 |
| `ralph` 轮数 | 64 | 96 |

**为什么把 `headroomTokens` 调小**：它不是「省 token」的开关，而是避免压缩策略直接失效。阈值是 `floor(min(W × ratio, W − O − headroom))`，默认 65536 会让 32K / 49K 这类小上下文模型算出**负的压力预算**，插件直接抛 `TargetPressureConfigError`、压缩完全不可用。调到 8192 之后，小模型能用，大模型的阈值反而整体后移（131K 窗口：标准模式 57,344 触发，超频模式 114,688 才触发）。

## 安装

```powershell
# 先把仓库克隆到本地任意目录
git clone https://github.com/kamioyuri/dsh-overclock-preset.git

# 装进你正在用的 profile（desktop / web / 自建 profile 都行）
dsh plugin --profile desktop add file:<仓库的绝对路径>
```

装完**重启 dsh**：宿主只在启动阶段读取 bundle 与预设声明。之后新建会话 → 打开预设选择器 → 选「超频模式」。

> `file:` 依赖是**复制**到 profile 的，改了源码要重新 `add`，或直接把 `lib/` 覆盖到 `~/.dsh/profiles/<profile>/node_modules/dsh-overclock-preset/`。

## 验证

```powershell
# 1) bundle 列表里出现包名
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern overclock

# 2) 组合树里出现插件行（desktop profile 被桌面端独占，CLI 只能对其它 profile 做这一步）
dsh --profile <profile> --dump-config | Select-String overclock
```

界面侧判据只有一条：**选择器里出现「超频模式」，且没有标注加载失败**。dsh 的预设列表会把加载失败的预设连同原因一起列出来，而不是隐藏，所以「看不见」= 没装上，「看见了但报错」= 组装里有行不能激活。

## 卸载 / 临时关闭

```powershell
# 临时关闭：在 ~/.dsh/profiles/<profile>/cordis.patch.yml 里给这一行加 disabled: true
- id: overclock-preset
  disabled: true

# 彻底卸载
dsh plugin --profile desktop remove dsh-overclock-preset
```

## 三个必须知道的限制

1. **成本**。这个预设按设计会明显多耗 token（多 agent 并行 + 更长输出）。它是「我要一次做完整」时手动切过去的模式，不适合当默认值。
2. **单轮输出上限不在预设里**。`maxTokens` 由 model route 决定（`models[].maxTokens`），预设只能做到「不主动压缩」，改不了适配器的物理上限。本地小模型想真正放开单轮长度，得去改模型配置。
3. **预设只能在会话空白时切换**。这是 dsh 的规则（中途换工具集会让已记录的工具调用失效），不是本插件的限制。

## 设计说明：为什么在代码里注册，而不是在 YAML 里声明

dsh 0.2.x 支持在 `cordis.patch.yml` 里插一行 `@deepseek-ai/dsh-agent-preset` 来声明预设，但这条路径对**第三方插件包**有个陷阱：

- 声明行的子插件用 Loader 的 `import.meta.resolve` 解析，锚点是**声明文件所在包的根**。
- 插件被装进 `profiles/<profile>/node_modules` 之后，从那里解析不到宿主自带的 `@deepseek-ai/dsh-*`，整个预设会变成 broken。

而 `ctx.agentPresets.register()` 的解析锚点是**注册表服务自己**的装载位置（即 dsh 宿主包目录），所以无论插件装在哪个 profile 都能解析到宿主包。

代价是本插件必须在宿主进程里跑一段 `apply`；好处是它**零 import、零依赖、不需要构建**，因此也没有供应链面和构建产物漂移的风险。附带效果：注册返回的 disposer 交给 `ctx.effect`，禁用插件时预设自动下线。

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

改 `lib/preset.js`，然后同步到 profile：

- **更狠**：`tool-ralph.maxRounds` → 200，`tool-workflow.maxResultChars` → 500000。
- **更省**：`maxDepth` 改回 1；或放宽 persona 里「只有三类可以直答」的门槛。
- **换人设**：直接改 `PERSONA` 数组。它是 `deployment:persona-prefix`，每一轮都在上下文里，别写太长（当前约 1.3k 字符）。

改完跑一遍自检：

```bash
node --test tests/preset.test.mjs
```

## 兼容性

- 需要 dsh 0.2.x（声明式预设注册表 `agentPresets`）。0.1.x 的 `.agent-presets/<id>/` 目录格式已被上游废弃，本插件不写那个目录。
- 只依赖宿主自带包，不引入任何第三方依赖。
- 未在 macOS / Linux 上实机验证；shell 行按 `process.platform` 自动在 `tool-bash` / `tool-pwsh` 之间二选一。

## License

[MIT](LICENSE)
