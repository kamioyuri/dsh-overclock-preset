给 DeepSeek Harness（dsh）加一个 agent 预设：**不为了省 token 而压缩、省略或截断输出**，并**默认自动启动多 agent 并行分工与汇总**。

An agent preset for dsh that stops the model from trimming output for token economy and orchestrates multiple sub-agents by default.

## 安装 / Install

1. 下载本页下方的 `dsh-overclock-preset-1.0.0.zip` 并解压
2. 装进你实际使用的 profile：

```bash
dsh plugin --profile desktop add file:<解压出的 dsh-overclock-preset 目录>
```

3. 重启 dsh，新建会话 → 预设选择器 → 选「超频模式」

也可以直接 clone 仓库安装，效果相同：`git clone https://github.com/kamioyuri/dsh-overclock-preset.git`

## 这个版本包含什么 / What's inside

| 维度 | standard | 超频模式 |
| --- | --- | --- |
| 人设 | 部署默认 | 预算无上限、禁止自我截断、默认多 agent |
| 压缩阈值 | `thresholdRatio 0.8` / `retainRatio 0.16` | `0.9` / `0.3` |
| 压缩余量 | `headroomTokens 65536` | `8192` |
| 工具结果裁剪 | 8,192 字符 | 49,152 字符 |
| 委派深度 | 1 | 2 |
| `workflow` 结果上限 | 50,000 字符 | 200,000 字符 |
| `ralph` 轮数 | 64 | 96 |

- 27 行组装：24 个插件行 + 3 个隔离域，其余与 standard 一致
- 零依赖、无构建步骤、不注册任何工具
- 9 项结构自检（零依赖，`node --test`）

## 需要注意 / Notes

- **成本**：按设计会多花 token，适合「一次做完整」时手动切换，不建议设为默认。
- **单轮输出上限不在这里**：`maxTokens` 属于 model route，预设只拒绝压缩，改不了适配器上限。
- **只能在空白会话切换预设**：dsh 的规则，中途换工具集会作废已记录的工具调用。

完整说明见 [README.md](https://github.com/kamioyuri/dsh-overclock-preset/blob/main/README.md) ｜ [README.en.md](https://github.com/kamioyuri/dsh-overclock-preset/blob/main/README.en.md)
