/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { OMIKUJI } from './definition.ts';

export default OMIKUJI;
export { OMIKUJI };
export type { OmikujiConfigSection } from './config.ts';
