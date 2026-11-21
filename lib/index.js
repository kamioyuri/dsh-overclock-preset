/**
 * dsh-overclock-preset —— 给 dsh 增加一个名为「超频模式」的 agent 预设。
 *
 * 机制：本插件在 apply 阶段调用宿主注册表服务 ctx.agentPresets.register()，
 * 把 lib/preset.js 里的组装定义注册成第 N 个可选预设。注册成功后：
 *   · 新会话的预设选择器里多出一项「超频模式」；
 *   · 部署默认值（agent-preset-registry 的 default / selectedDefault）不变，
 *     现有预设的行为不受影响。
 *
 * 为什么用运行时注册而不是在 cordis.patch.yml 里插一行 @deepseek-ai/dsh-agent-preset：
 * 声明行里的子插件名要用 Loader 的模块解析，锚点是被声明文件所在的包；
 * 而 runtime register 的解析锚点是注册表服务自身的装载位置（即 dsh 宿主包目录），
 * 所以预设里的 @deepseek-ai/dsh-* 行无论本插件被装到哪个 profile 都能解析。
 */

import { PRESET } from './preset.js';

/** 插件名（Loader 行 id 之外的自述名）。 */
export const name = 'dsh-overclock-preset';

/** 依赖的宿主服务：预设注册表。 */
export const inject = ['agentPresets'];

/** 把任意抛出物渲染成一行可读文本。 */
function describe(error) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return '[unrenderable thrown value]';
  }
}

/**
 * 注册「超频模式」预设。
 *
 * 返回的清理函数交给 ctx.effect：插件被禁用或卸载时预设自动下线，
 * 已启动的会话按注册表自己的代际规则继续运行到结束。
 *
 * @param ctx - Cordis 上下文（已注入 agentPresets）。
 */
export function apply(ctx) {
  ctx.effect(() => {
    const pending = ctx.agentPresets.register(PRESET);
    return Promise.resolve(pending).then(
      (unregister) => {
        ctx.logger?.info?.(`[dsh-overclock-preset] 已注册预设「${PRESET.name}」（id: ${PRESET.id}）`);
        return typeof unregister === 'function' ? unregister : () => {};
      },
      (error) => {
        // 注册失败不应该拖垮整棵插件树：记一条警告，插件保持加载（可在日志里排查）。
        ctx.logger?.warn?.(`[dsh-overclock-preset] 注册预设「${PRESET.name}」失败：${describe(error)}`);
        return () => {};
      },
    );
  }, 'dsh-overclock-preset:register');
}

export default { name, inject, apply };
