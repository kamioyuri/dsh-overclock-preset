/**
 * 预设定义的结构自检（零依赖，node --test 直接跑）。
 *
 * 目的不是覆盖 dsh 的行为，而是钉死「这份组装能不能被 dsh 的注册表接受」：
 * 注册表只校验行列表的形状，真正的 schema 校验发生在子插件构造时，
 * 一旦出错整个预设会在选择器里显示为 broken。所以这里把「必填配置项」
 * 也在本地检查一遍，避免把错误留到重启之后才发现。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESET } from '../lib/preset.js';

const rows = PRESET.plugins;
const byId = new Map(rows.map((row) => [row.id, row]));

/** 展开所有层级（含 group 的子行）的插件名。 */
function flatten(list, out = []) {
  for (const item of list) {
    out.push(item.name);
    if (item.group === true && Array.isArray(item.config)) flatten(item.config, out);
  }
  return out;
}

const names = flatten(rows);

/** 找出一行（按 id）。 */
function row(id) {
  const found = byId.get(id);
  assert.ok(found, `缺少预设行：${id}`);
  return found;
}

test('预设元数据符合注册表要求', () => {
  // id 会成为会话日志里的标识，注册表按 [a-z0-9][a-z0-9-]* 收
  assert.match(PRESET.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(typeof PRESET.name, 'string');
  assert.ok(PRESET.name.trim().length > 0);
  assert.ok(PRESET.description.trim().length > 0);
  assert.equal(typeof PRESET.order, 'number');
  assert.ok(Array.isArray(PRESET.plugins) && PRESET.plugins.length > 0);
});

test('每一行都是合法的插件行，且 id 唯一', () => {
  const seen = new Set();
  for (const [index, item] of rows.entries()) {
    const label = `row ${index + 1}`;
    assert.equal(typeof item, 'object', `${label} 不是对象`);
    assert.ok(item !== null && !Array.isArray(item), `${label} 不是 map`);
    assert.equal(typeof item.name, 'string', `${label} 缺少 name`);
    assert.ok(item.name.length > 0, `${label} 的 name 为空`);
    assert.equal(typeof item.id, 'string', `${label} 缺少 id`);
    assert.ok(!seen.has(item.id), `id 重复：${item.id}`);
    seen.add(item.id);
    if (item.group === true) {
      assert.ok(Array.isArray(item.config), `${label}（group）的 config 必须是行数组`);
    } else {
      assert.equal(item.config === undefined || typeof item.config === 'object', true);
    }
  }
});

test('必填配置项都在（schema 里 required 的字段）', () => {
  // dsh-persona: prefix required
  assert.ok(row('persona').config.prefix.trim().length > 0);
  // dsh-agent-instructions: maxBytes required
  assert.ok(Number.isInteger(row('agent-instructions').config.maxBytes));
  // dsh-tool-fs-search: sampleOverCapGlobResults required
  assert.equal(typeof row('tool-fs-search').config.sampleOverCapGlobResults, 'boolean');
  // dsh-tool-todo: allowParallelInProgress required
  assert.equal(typeof row('tool-todo').config.allowParallelInProgress, 'boolean');
  // dsh-tool-subagent: provider required（两个实例各自要有 provider + 唯一 toolName）
  const personaGroup = row('planning');
  assert.ok(Array.isArray(personaGroup.config));
  // dsh-plan-mode: section 必须是非空字符串
  const planMode = personaGroup.config.find((item) => item.id === 'plan-mode');
  assert.ok(planMode, '缺少 plan-mode 行');
  assert.ok(planMode.config.section.trim().length > 0);
});

test('persona 只有一处，且覆盖三条超频承诺', () => {
  const personaRows = rows.filter((item) => item.name === '@deepseek-ai/dsh-persona');
  assert.equal(personaRows.length, 1, 'persona 必须恰好一行（多行会互相遮蔽）');
  const text = personaRows[0].config.prefix;
  assert.match(text, /无上限/);
  assert.match(text, /截断|省略/);
  assert.match(text, /多 agent/);
  assert.match(text, /workflow/);
  assert.match(text, /subagent/);
});

test('压缩策略：后移阈值、保留更多原文、且不触发容量断言', () => {
  const compactionGroup = row('compaction');
  const basic = compactionGroup.config.find((item) => item.id === 'compaction-basic');
  const { thresholdRatio, retainRatio, headroomTokens } = basic.config;

  assert.ok(thresholdRatio > 0.8, '阈值应比默认 0.8 更晚触发');
  assert.ok(retainRatio > 0.16, '逐字保留比例应比默认 0.16 更高');
  assert.ok(retainRatio < thresholdRatio, 'retainRatio 必须小于 thresholdRatio');

  // resolveCompactSpec 的断言：W - O - headroom 必须为正。
  // 用本机常见的小上下文窗口做下界检查（49K 上下文 / 2K 输出）。
  const smallWindow = 49152;
  const reservedCompletion = 2048;
  assert.ok(
    smallWindow - reservedCompletion - headroomTokens > 0,
    `headroomTokens=${headroomTokens} 会让 49K 上下文模型没有压力预算`,
  );
  // 同时确认阈值仍落在窗口内
  assert.ok(
    Math.floor(Math.min(smallWindow * thresholdRatio, smallWindow - reservedCompletion - headroomTokens)) > 0,
  );
});

test('工具结果裁剪：头部 + 尾部不超过阈值', () => {
  const pruner = row('compaction').config.find((item) => item.id === 'tool-result-pruner');
  const { thresholdChars, headChars, tailChars } = pruner.config;
  assert.ok(thresholdChars > 8192, '阈值应比默认 8192 更宽松');
  assert.ok(headChars + tailChars <= thresholdChars, '头部 + 尾部 + 标记必须不超过阈值');
});

test('委派面：子代理工具名唯一，深度与结果上限符合超频意图', () => {
  const delegation = row('delegation');
  const subagents = delegation.config.filter((item) => item.name === '@deepseek-ai/dsh-tool-subagent');
  assert.equal(subagents.length, 2, '应有 spawn 与 fork 两个委派工具');
  const toolNames = subagents.map((item) => item.config.toolName);
  assert.equal(new Set(toolNames).size, toolNames.length, 'toolName 必须唯一');
  for (const item of subagents) assert.ok(item.config.provider);

  const spawn = subagents.find((item) => item.config.provider === 'spawn');
  assert.equal(spawn.config.maxDepth, 2, '委派深度应放到 2 层');

  const workflow = delegation.config.find((item) => item.id === 'tool-workflow');
  assert.ok(workflow.config.maxResultChars > 50000, 'workflow 结果上限应高于默认 5 万字符');

  const ralph = delegation.config.find((item) => item.id === 'tool-ralph');
  assert.ok(ralph.config.maxRounds > 64, 'ralph 轮数应高于 standard 的 64');

  const ptc = delegation.config.find((item) => item.id === 'workflow-ptc');
  assert.equal(ptc.config.provider, 'spawn');
});

test('shell 行按平台互斥，且恰好有一个启用', () => {
  const posix = row('tool-shell-posix');
  const win = row('tool-shell-windows');
  const enabled = [posix, win].filter((item) => item.disabled !== true);
  assert.equal(enabled.length, 1, '当前平台应恰好启用一个 shell 工具');
  const expected = process.platform === 'win32' ? win : posix;
  assert.equal(expected.disabled, false);
});

test('组装面向完整编码 Agent：关键工具都在', () => {
  for (const required of [
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-todo',
    '@deepseek-ai/dsh-tool-web',
    '@deepseek-ai/dsh-tool-subagent-control',
    '@deepseek-ai/dsh-workflow-ptc',
    '@deepseek-ai/dsh-tool-ralph',
  ]) {
    assert.ok(names.includes(required), `缺少 ${required}`);
  }
});
