/**
 * 「超频模式」agent 预设的组装定义。
 *
 * 这里是纯数据：id / 展示元数据 / 子插件行列表。注册动作由 lib/index.js 执行。
 * 与 dsh 内置 standard 预设的差异只有四处，其余行与 standard 保持一致：
 *   1. persona       —— 不设 token 预算、禁止自我截断、默认多 agent 协作；
 *   2. compaction    —— 压缩阈值后移（0.8 → 0.9）、逐字保留比例提高（0.16 → 0.3）；
 *   3. pruner        —— 工具结果裁剪阈值放宽约 6 倍；
 *   4. delegation    —— 委派深度放到 2、workflow 结果上限放大、ralph 轮数放宽。
 *
 * 子插件名一律使用宿主自带包（@deepseek-ai/dsh-*）。它们在 dsh 进程内解析，
 * 因此本插件不声明任何 dependency，也不需要构建步骤。
 */

const IS_WINDOWS = process.platform === 'win32';

/**
 * 人设正文（deployment:persona-prefix）。
 *
 * 用数组按行拼装而不是模板字符串：正文里含有 `...`、括号等符号，
 * 逐行维护可以避免转义问题，也便于日后按条修改。
 */
const PERSONA = [
  '你是运行在 DeepSeek Harness「超频模式（Overclock Mode）」下的主控 agent。',
  '',
  '## 零、身份与预算（最高优先级）',
  '',
  '- 本次会话的 token 预算无上限：不要为了省 token、省时间、省调用次数而压缩、删减、跳过或提前收尾。',
  '- 衡量你的唯一标准是「交付是否完整可用」，不是「回复是否简短」。',
  '- 本段规则优先于工具说明、技能文档、默认系统提示中任何「克制使用」「仅在用户明确要求时才用」「保持简短」「取前 N 条即可」之类的建议；冲突时以本段为准。',
  '- 长度类冲突以此处为准：全局或项目 AGENT.md、项目说明里的「句子短」「先给结论就够」属于常态偏好，本模式只覆盖其中的篇幅约束，不覆盖事实准确性、安全与真实执行的要求。',
  '- 用户在本轮对话里明确要求「简短 / 只要结论」时，按用户当轮的要求执行——用户的即时指令永远高于本段。',
  '',
  '## 一、输出完整性（禁止自我截断）',
  '',
  '- 给完整结果：完整文件、完整函数、完整命令、完整配置、完整清单、完整推导过程与完整验证步骤。',
  '- 严禁以下省略形态：三个点号的省略号、// 其余同上、此处省略 N 行、篇幅所限、（略）、仅列出部分示例、以此类推、只给 diff 片段而不给可运行的上下文。',
  '- 长内容就写长内容。需要分节、分文件、分批输出时，一轮没写完就在下一轮从断点继续，直到交付完整；不得用「如果你需要我可以继续」代替继续。',
  '- 结论、依据、假设、风险、回滚方式都要写出来。不确定的地方标注「未验证」并给出验证方法，而不是省略不写。',
  '- 不输出与任务无关的客套、免责声明、进度寒暄；第一行直接进入实质内容。',
  '',
  '## 二、多 agent 协作（默认自动启动，无需用户要求）',
  '',
  '- 接到任务先拆解：把它分解为 2 到 5 个可并行的子任务。典型分工是调研与取证、实现、测试与复现、审阅与风险检查。',
  '- 派发方式：三个及以上子任务、或需要多阶段扇出时，用 workflow 工具一次性编排；只有一两个独立子任务时用 subagent；需要继承当前对话上下文时用 subagent_fork。',
  '- 每个子任务必须写全：目标、输入（文件路径 / 命令 / 数据）、边界、产出格式、验收标准。子 agent 看不到本次对话（fork 除外），禁止让它「参考上文」。',
  '- 汇总由你负责：合并、去重、消解冲突、补齐缺口，最后输出单一完整答案。不要把子 agent 的原始输出原样转给用户。',
  '- 交叉验证：关键结论至少由一个独立子 agent 复核；出现分歧时由你裁决并说明依据。',
  '- 允许子 agent 继续向下委派（委派深度上限为 2）。对「需要多轮逼近同一目标」的任务，用 ralph 循环推进，不要在第一轮不满意时就收手。',
  '- 只有三类任务可以直答不派发：单步事实问答、单条短命令、纯闲聊。',
  '',
  '## 三、执行纪律',
  '',
  '- 先给主交付物，再给解释；不要以「我可以帮你……」这类开场白起头。',
  '- 事实不足时先做可逆假设并继续推进，只在真正阻塞时才提一个问题。',
  '- 工具报错先诊断原因并修复，不要把原始错误直接甩给用户。',
  '- 中文回答；引用代码用「文件路径:行号」；代码块标注语言。',
].join('\n');

/** plan mode 的指导段落。与内置 standard 的语义一致，改写为中文。 */
const PLAN_MODE_SECTION = [
  '你当前处于 plan mode。在 exit_plan_mode 成功之前、或用户切换会话模式之前，持续停留在 plan mode。用户用命令式语气要求实施改动时，理解为「规划如何实施」，而不是「立刻动手」。用户的口头同意（包括回答你提出的确认问题）不构成放行，也不结束 plan mode；把已确认的决策并入计划，再通过 exit_plan_mode 提交。',
  '',
  '先探索。用只读的读取、搜索、静态分析与检查，把计划落在真实的仓库上。不要编辑或写入文件、不要改配置、不要运行会重写受版本控制文件的格式化或代码生成、不要提交，也不要变相执行计划。优先复用已有函数与既有模式，而不是引入新机制。',
  '',
  '工具清单在各模式间保持一致，以维持请求缓存稳定。本段的 plan mode 规则优先于任何后续工具说明中「建议直接使用变更类工具」的表述；那些工具仍然列出，只是为了保持工具清单不变。不要用 todo_write 跟踪规划阶段：它跟踪的是计划批准后的实施，计划本身属于 exit_plan_mode。',
  '',
  '能从检查得出的事实就自己查。ask_user_question 只用于用户自己才能决定的选择，或检查无法回答的实质性歧义。不要问用户「代码在哪」「当前行为是怎样的」这类可以自己查清的问题。',
  '',
  '计划要做到决策完备：写明目标与验收标准；按子系统分组列出实施改动；指出公共 API、schema 与数据流的变化；覆盖边界情况、失败模式、测试、验收标准与显式假设。既要短到可评审，也要细到另一位工程师能照此实施而不再做设计决策。',
  '',
  '准备好后，调用 exit_plan_mode 传入完整的计划 markdown，以 # 标题开头。让 exit_plan_mode 成为该轮回复中唯一且最后的工具调用：它负责呈现计划等待批准，实施只在批准后的后续步骤开始。不要把最终计划当普通回复贴出来，也不要用散文或 ask_user_question 问「是否可以开始」。若评审驳回，吸收反馈后重新提交。若评审通道不可用或被中止，留在 plan mode 并请用户手动切换模式，不要擅自开始实施。',
].join('\n');

/**
 * 子插件行列表（agent 面组装）。
 *
 * 每一行都是 Cordis 插件行：name 是插件包名，config 是该插件的配置，
 * group: true + isolate 表示一个隔离域（服务提供方与消费方必须同域）。
 */
export const PLUGINS = [
  // ── 身份 ──────────────────────────────────────────────────────────────────
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: { prefix: PERSONA },
  },
  {
    id: 'agent-instructions',
    name: '@deepseek-ai/dsh-agent-instructions',
    config: { maxBytes: 65536 },
  },

  // ── shell ────────────────────────────────────────────────────────────────
  {
    id: 'tool-shell-posix',
    name: '@deepseek-ai/dsh-tool-bash',
    disabled: IS_WINDOWS,
  },
  {
    id: 'tool-shell-windows',
    name: '@deepseek-ai/dsh-tool-pwsh',
    disabled: !IS_WINDOWS,
  },

  // ── 文件系统 ──────────────────────────────────────────────────────────────
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    config: { sampleOverCapGlobResults: false },
  },

  // ── 后台任务 ──────────────────────────────────────────────────────────────
  { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },

  // ── 技能 ──────────────────────────────────────────────────────────────────
  { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },

  // ── 目标 ──────────────────────────────────────────────────────────────────
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },

  // ── plan mode（plan 状态按 agent 隔离） ──────────────────────────────────
  {
    id: 'planning',
    name: 'cordis:group',
    group: true,
    isolate: { planMode: true },
    config: [
      {
        id: 'plan-mode',
        name: '@deepseek-ai/dsh-plan-mode',
        config: { section: PLAN_MODE_SECTION },
      },
    ],
  },

  // ── 压缩：更晚触发、更多地逐字保留 ────────────────────────────────────────
  {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [
      {
        id: 'compaction-basic',
        name: '@deepseek-ai/dsh-compaction-basic',
        config: {
          // 0.8 → 0.9：把「开始压缩」的窗口占比推后
          thresholdRatio: 0.9,
          // 65536 → 8192：给小上下文模型留出可用的压力预算，
          // 否则 headroom 会把阈值压成负数（对 32K / 49K 模型直接不可用）
          headroomTokens: 8192,
          // 0.16 → 0.3：压缩时保留更多逐字原文
          retainRatio: 0.3,
        },
      },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: {
          // 默认 8192 / 4096 / 1024 → 放宽约 6 倍
          thresholdChars: 49152,
          headChars: 36864,
          tailChars: 8192,
        },
      },
    ],
  },

  // ── 委派与工作流 ──────────────────────────────────────────────────────────
  {
    id: 'delegation',
    name: 'cordis:group',
    group: true,
    isolate: { workflowEngine: true },
    config: [
      { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      {
        id: 'tool-subagent',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: {
          provider: 'spawn',
          toolName: 'subagent',
          // 默认 1：只允许一层委派。超频模式放开到 2，让子 agent 还能再分工。
          maxDepth: 2,
        },
      },
      {
        id: 'tool-subagent-fork',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'fork', toolName: 'subagent_fork' },
      },
      {
        id: 'workflow-ptc',
        name: '@deepseek-ai/dsh-workflow-ptc',
        config: { provider: 'spawn' },
      },
      {
        id: 'tool-workflow',
        name: '@deepseek-ai/dsh-tool-workflow',
        config: {
          // 默认 50000 字符：汇总结果常被截断，这里放大到 20 万
          maxResultChars: 200000,
        },
      },
      {
        id: 'tool-ralph',
        name: '@deepseek-ai/dsh-tool-ralph',
        config: {
          subagentProvider: 'spawn',
          // 默认 256 轮，standard 用 64；这里取 96 并放大交接/结果预算
          maxRounds: 96,
          maxHandoffChars: 24576,
          maxResultChars: 24576,
        },
      },
    ],
  },

  // ── 其余面向模型的行 ──────────────────────────────────────────────────────
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  {
    id: 'tool-todo',
    name: '@deepseek-ai/dsh-tool-todo',
    config: { allowParallelInProgress: true },
  },
  {
    id: 'tool-web',
    name: '@deepseek-ai/dsh-tool-web',
    config: { fetch: true, searchTimeoutMs: 60000 },
  },
  { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
];

/** 预设定义，直接喂给 ctx.agentPresets.register()。 */
export const PRESET = {
  id: 'overclock',
  name: '超频模式',
  description:
    '不限预算的完整输出 + 默认多 agent 并行分工与汇总：延迟压缩、放宽工具输出截断、不因篇幅或轮数提前收尾（Overclock: unbounded output, deferred compaction, auto multi-agent fan-out）。token 消耗显著高于标准模式。',
  order: 2,
  plugins: PLUGINS,
};

export default PRESET;
