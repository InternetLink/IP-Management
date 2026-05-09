# IPAM 修复与补全项目书

## 1. 项目背景

当前项目是一个前后端分离的 IP Address Management 系统，目标是管理 IP 前缀树、IP 池分配、Geofeed 记录、审计日志和基础统计。后端使用 NestJS、Prisma、MySQL，前端使用 Next.js、React、HeroUI / HeroUI Pro。

代码已经从旧的 `IpBlock + Subnet + Allocation` 扁平结构迁移到统一的 `Prefix` 树结构，但 README、部分前端页面和编译产物仍保留旧架构痕迹。现阶段的主要风险不是单点语法错误，而是模型迁移不完整、CIDR/IP 计算边界不足、前后端接口覆盖不一致、缺少自动化验证。

## 2. 项目目标

本次修复目标分为三类：

1. 修复潜在 bug：重点处理 CIDR 校验、前缀重叠判断、拆分限制、IP 池生成、排序、错误处理和前后端接口不一致。
2. 补全产品不足：统一 Prefix 树架构，清理旧页面/旧文档，补齐真实可用的前缀详情、分配管理、Geofeed、设置和帮助内容。
3. 建立验证闭环：增加关键单元测试或服务级测试，确保后续修改不会破坏 IP 计算、树关系和 Geofeed 输出。

## 3. 当前发现的问题

### 3.1 架构与文档不一致

- README 仍描述 `ip-blocks`、`subnets`、`allocations` 独立模块，但当前源码只注册了 `prefixes`、`geofeed`、`audit`、`settings`、`dashboard`。
- `backend/dist` 中残留旧模块编译产物，容易误导维护者。
- 前端仍存在 `/ip-blocks`、`/subnets`、`/allocations` 页面文件，但导航已转向 `/prefixes`，这些页面可能是旧逻辑或 mock fallback。

### 3.2 CIDR 与 IP 计算风险

- `parseCIDR` 对非法 IPv4、非法 prefix length、缺失 `/`、NaN octet 等情况缺少严格校验。
- IPv6 解析只覆盖基础 `::` 展开，不完整支持 IPv4-mapped IPv6、异常 group 数量、非法十六进制字符等场景。
- `countIPs` 对 IPv6 返回 `-1`，但数据库字段含义是 `totalIPs`，这会让统计和利用率逻辑产生语义不清。
- `split` 使用 `1 << diff` 计算拆分数量，JavaScript 位移只适合 32 位整数，较大拆分会溢出或得到错误数量。
- `split` 没有最大生成数量保护，可能一次创建大量子前缀拖垮服务或数据库。
- IPv6 输出没有压缩规范化，可能产生非标准但可解析的地址表示。

### 3.3 Prefix 树与重叠校验不足

- 创建 root prefix 时只检查 `cidr` 唯一，没有检查 root 之间是否重叠。
- 创建子 prefix 时只检查同一 parent 下的 sibling 重叠，未完整校验跨层级冲突。
- 更新 prefix 不允许改 CIDR，这降低风险，但也意味着后续如支持改 CIDR，需要重新设计校验。
- 删除 prefix 使用 cascade，会删除所有 children 和 allocations；前端目前只提示一层风险，缺少数量级提示。

### 3.4 IP 池与 Allocation 风险

- `generateIPs` 对 `/31`、`/32` 仍按传统 network/broadcast 逻辑保留首尾地址，不符合部分现代点对点网络用法。
- 生成 allocation 时逐条 insert，大池会慢；虽然限制最大 /22，但仍可优化为事务或批量创建。
- allocation 列表按字符串排序，IPv4 地址会出现 `10.0.0.100` 排在 `10.0.0.2` 前的问题。
- 更新 allocation 时只更新状态、assignee、purpose、notes，未处理 `expiryDate`。
- `usedIPs` 只统计 `Allocated`，但 Reserved 是否计入使用率需要产品定义。

### 3.5 Geofeed 风险

- CSV import 使用简单 `split(',')`，不支持 quoted fields、逗号转义和空格复杂情况。
- country code、region、city、postalCode 校验较弱。
- 创建 Geofeed entry 时没有自动关联对应 `Prefix`。
- 导出 CSV 基本符合 RFC 8805 形态，但缺少更严格的字段规范化和稳定测试。

### 3.6 前端体验与接口不足

- 前端页面和 API client 主要面向新 `/prefixes` API，但旧页面仍存在，容易形成死功能。
- 部分跳转使用 `window.location.href`，在 Next.js App Router 中应改为 router navigation。
- 错误处理主要 toast 出 `err.message`，缺少字段级反馈。
- Prefix 创建表单没有在前端提前校验 CIDR、RIR、VLAN、gateway。
- Prefix 详情页需要确认是否完整支持 split、generate IPs、allocation 编辑和树浏览。

### 3.7 工程质量不足

- 后端没有测试脚本和测试依赖。
- 前端有 lint 脚本，但没有端到端或组件级验证。
- README 中暴露了数据库连接信息描述，需要移除敏感信息并改为 `.env` 示例。
- 缺少 `.env.example`、部署说明和迁移说明。

## 4. 实施范围

### 必做范围

1. 统一项目说明：更新 README，补 `.env.example`，清理旧架构描述。
2. 后端 CIDR 工具硬化：严格校验 IPv4 / IPv6、prefix length、CIDR 规范化、重叠/包含逻辑。
3. Prefix API 修复：补 root 重叠校验、拆分数量保护、错误信息、批量创建策略。
4. Allocation 修复：数值排序、expiryDate 更新、使用率规则明确化。
5. Geofeed 修复：CSV parser、字段校验、Prefix 自动关联、导出测试。
6. 前端补齐：确认并修复 Prefix 相关页面，处理旧页面入口，补充关键表单校验。
7. 测试与验证：加入后端关键单元测试，运行 build/lint，必要时启动本地服务做页面验证。

### 暂不纳入范围

- 用户认证、RBAC、多租户。
- 大规模 IPv6 地址逐个分配。
- IPAM 与真实 RIR、BGP、DNS、DHCP 系统集成。
- 复杂拓扑图或网络发现扫描。

## 5. 技术方案

### 5.1 后端

- 提取 `backend/src/lib/cidr.ts`，把 CIDR 解析、规范化、包含、重叠、计数、排序 key 统一放进去。
- 使用 `bigint` 处理 IPv4 / IPv6 范围，避免 32 位位移和 number 精度问题。
- 对 IPv6 总量不再用 `-1` 表示业务值，改为前端展示层处理，后端明确返回 `totalIPs` 或 `totalIPsLabel` 的语义。如果数据库暂不改 schema，则至少封装显示逻辑，避免统计误用。
- `split` 增加最大生成数量配置，默认例如 256 或 1024，并返回明确错误。
- 创建 prefix 时检查同版本所有可能重叠前缀，允许合法父子关系，拒绝非法交叉重叠。
- Allocation 排序使用 IP 转 bigint 后应用内排序，或增加 `ipValue` 字段作为后续优化。
- Geofeed import 使用可靠 CSV 解析库或小型严格 parser，保证 quoted fields 正确。

### 5.2 前端

- 将旧 `ip-blocks`、`subnets`、`allocations` 页面评估为迁移、重定向或删除，避免用户进入旧模型页面。
- Prefix 列表和详情页加入前端 CIDR 格式校验，但以后端校验为准。
- Prefix 详情页补齐 split、generate IPs、allocation 更新、tree children 浏览的状态反馈。
- 使用 Next.js router 替代 `window.location.href`。
- 对危险删除展示 children 和 allocations 数量。

### 5.3 文档

- README 改为当前 Prefix 树架构。
- 新增 `.env.example`，后端至少包含 `DATABASE_URL`，前端包含 `NEXT_PUBLIC_API_URL`。
- 移除 README 中的真实数据库连接字符串。

## 6. 交付计划

### 阶段一：基线修复

目标：让项目说明、接口和现有源码一致。

- 更新 README 和环境变量示例。
- 梳理旧页面，决定保留、迁移或重定向。
- 清理或说明 `dist` 产物，不让它作为源码依据。

验收标准：

- README 能准确说明当前架构和运行方式。
- 新开发者不会再按旧 `ip-blocks/subnets` 架构理解项目。

### 阶段二：后端核心修复

目标：降低 IPAM 核心逻辑出错概率。

- 实现统一 CIDR 工具。
- 修复 create/split/generateIPs/updateAllocation 的边界问题。
- 补 Geofeed import/export 校验。

验收标准：

- 非法 CIDR 被稳定拒绝。
- root/child/sibling 重叠规则清晰且可测试。
- 大规模 split 有上限保护。
- IPv4 allocation 排序正确。

### 阶段三：前端补全

目标：让用户能完整操作 Prefix 树和 IP 池。

- 修复 Prefix 页面操作流。
- 处理旧页面和导航一致性。
- 补危险操作提示和表单校验。

验收标准：

- 用户可以从列表进入详情，拆分 prefix，生成 IP 池，编辑 allocation。
- 旧页面不会误导用户。
- API 错误能在界面上被理解。

### 阶段四：测试与验收

目标：建立最小但有效的回归保障。

- 增加后端 CIDR 工具测试。
- 增加 Prefix service 关键行为测试，至少覆盖创建、重叠、拆分、生成 IP。
- 运行后端 build、前端 lint/build。
- 如环境允许，启动前后端做浏览器 smoke test。

验收标准：

- 自动化检查通过。
- 手动验证核心路径无明显阻塞。

## 7. 风险与应对

- 数据库 schema 变更风险：优先不做破坏性 schema 变更；如需要新增字段，提供迁移说明。
- IPv6 精确计数风险：避免用 JavaScript number 表示超大 IPv6 数量，改为字符串或展示标签。
- 旧页面迁移风险：先确认是否仍被用户使用；如无法确认，优先重定向到新 Prefix 页面而不是直接删除。
- 依赖安装风险：当前环境可能没有完整依赖或网络权限；验证阶段如需安装依赖，将单独请求授权。

## 8. 预期产出

- 更新后的 README 和环境变量示例。
- 修复后的后端 CIDR / Prefix / Allocation / Geofeed 逻辑。
- 一致的前端 Prefix 管理体验。
- 最小测试集和验证记录。
- 简短的变更说明，列出已修复问题、未覆盖范围和后续建议。

## 9. 建议优先级

优先级从高到低：

1. 移除 README 中的敏感数据库连接描述。
2. 修复 CIDR 校验和 split 溢出问题。
3. 修复 prefix 重叠规则。
4. 修复 allocation 排序和更新字段。
5. 统一旧页面与新 Prefix 架构。
6. 补测试和 smoke test。

## 10. 当前代码基线快照

基于当前源码检查，部分后端核心修复已经开始落地，但项目文档、验证体系和前端一致性仍未完成。

### 10.1 已初步落地

- `backend/src/lib/cidr.ts` 已存在统一 CIDR 工具，使用 `bigint` 处理 IPv4 / IPv6 解析、规范化、包含、重叠和排序。
- `backend/src/prefixes/prefixes.service.ts` 已加入 root prefix 重叠校验、sibling 重叠校验、split 数量上限、IPv4 allocation 批量创建和 IP 数值排序。
- `backend/src/prefixes/prefixes.service.ts` 已支持 allocation `expiryDate` 更新，但前端编辑表单暂未暴露该字段。
- `backend/src/geofeed/geofeed.service.ts` 已加入 quoted CSV line parser、country code 规范化、创建和导入时自动关联同 CIDR 的 `Prefix`。
- 前端 Prefix 详情页已支持进入详情、拆分、添加子 prefix、生成 IPv4 IP 池、编辑 allocation 和删除子 prefix。

### 10.2 仍需完成

- `README.md` 仍描述旧的 `ip-blocks / subnets / allocations` 后端模块，并包含敏感连接信息和安装 token 示例。
- 项目缺少 `.env.example`，新环境无法按安全方式配置 `DATABASE_URL` 和 `NEXT_PUBLIC_API_URL`。
- 后端 `package.json` 没有测试脚本和测试依赖，CIDR、Prefix、Geofeed 的关键行为没有自动化回归保障。
- 前端仍保留 `/ip-blocks`、`/subnets`、`/allocations` 页面和对应 view，用户可直接访问旧模型页面。
- 前端多处使用 `window.location.href`，需要迁移到 Next.js App Router 的 `useRouter()`。
- 前端 `frontend/src/lib/cidr.ts` 仍使用部分 32 位 bitwise 计算和简化 IPv6 逻辑，应避免与后端 CIDR 语义分叉。
- `backend/dist` 和 `node_modules` 存在于工作目录，若被纳入交付或版本管理会造成维护噪音。

## 11. 关键产品与技术决策

### 11.1 Prefix 模型

- 以 `Prefix` 作为唯一网络资源模型，废弃旧的 `IpBlock + Subnet + Allocation` 业务入口。
- `parentId = null` 表示 root prefix，通常对应 RIR 或组织级地址段。
- 子 prefix 必须完全包含于 parent prefix 内，且同一 parent 下的 children 不能相互重叠。
- root prefix 之间不能重叠；跨 root 的重叠一律视为数据错误。
- 暂不支持更新 CIDR；如未来支持，需要重新校验 parent、children、allocations、geofeed 和审计关系。

### 11.2 IP 计算

- IPv4 / IPv6 范围计算统一使用 `bigint`，禁止使用 JavaScript 32 位位移表达核心范围逻辑。
- IPv4 可生成单 IP allocation；IPv6 暂不生成逐 IP allocation，只展示 prefix 级信息。
- `/31` 和 `/32` 按现代点对点/单主机语义处理，不强制保留 network/broadcast。
- split 和 generate IP 必须有服务端上限，默认上限保持小规模可控，避免数据库被一次请求拖垮。

### 11.3 使用率口径

- 默认 `usedIPs` 只统计 `Allocated`，`Reserved` 不计入实际使用率。
- UI 可单独展示 `Reserved` 数量，避免把保留地址和真实分配地址混在一个指标里。
- Dashboard 需要明确展示“IPv4 root 总量使用率”和“IP pool allocation 状态统计”两个不同维度。

### 11.4 Geofeed

- Geofeed entry 的 `prefix` 使用规范化 CIDR。
- 导入 CSV 采用 best-effort 策略时，必须返回成功数和失败明细；不能静默丢弃错误行。
- country code 先按 ISO 3166-1 alpha-2 格式校验；完整国家代码清单校验可作为后续增强。
- `prefixId` 可自动关联同 CIDR 的 `Prefix`；暂不做“子 prefix 自动匹配最小包含 parent”的隐式关联。

## 12. 工作拆解

### P0：文档与安全基线

| 任务 | 文件 | 验收标准 |
|---|---|---|
| 更新 README 架构说明 | `README.md` | 只描述 `prefixes / geofeed / audit / settings / dashboard` 当前模块 |
| 移除敏感信息 | `README.md` | 不出现真实数据库 URL、token、账号密码 |
| 增加环境变量示例 | `backend/.env.example`、`frontend/.env.example` | 能按示例启动本地服务，不包含真实密钥 |
| 补充忽略规则 | `.gitignore`、`backend/.gitignore`、`frontend/.gitignore` | `node_modules`、`dist`、`.env`、`.next` 不进入交付产物 |
| 标注旧产物处理方式 | `README.md` 或交付说明 | 明确 `backend/dist` 不是源码依据，可清理或重新 build |

### P1：后端正确性

| 任务 | 文件 | 验收标准 |
|---|---|---|
| 补 CIDR 单元测试 | `backend/src/lib/cidr.spec.ts` | 覆盖合法/非法 IPv4、IPv6、规范化、包含、重叠、排序 |
| 补 Prefix service 测试 | `backend/src/prefixes/prefixes.service.spec.ts` | 覆盖创建、root 重叠、parent containment、sibling overlap、split 上限 |
| 补 Geofeed 测试 | `backend/src/geofeed/geofeed.service.spec.ts` | 覆盖 quoted CSV、非法行、country code、导出转义 |
| 增强 DTO 校验 | `backend/src/prefixes/prefixes.dto.ts`、`backend/src/geofeed/geofeed.dto.ts` | status、RIR、VLAN、prefix length、空字符串有明确错误 |
| 明确 import 错误返回 | `backend/src/geofeed/geofeed.service.ts` | 返回 `imported`、`failed`、`errors[]`，不再静默吞错 |
| 校正 Dashboard 统计语义 | `backend/src/dashboard/dashboard.service.ts` | 指标名称与计算口径一致，IPv6 不进入 IPv4 总量 |

### P2：前端一致性

| 任务 | 文件 | 验收标准 |
|---|---|---|
| 旧页面重定向 | `frontend/src/app/(app)/ip-blocks/page.tsx`、`frontend/src/app/(app)/subnets/page.tsx`、`frontend/src/app/(app)/allocations/page.tsx` | 直接访问旧 URL 会跳到 `/prefixes` 或显示迁移提示 |
| 路由迁移 | `frontend/src/views/prefix-tree-page.tsx`、`frontend/src/views/prefix-detail-page.tsx` | 不再用 `window.location.href` 做内部跳转 |
| 表单预校验 | `frontend/src/views/prefix-tree-page.tsx`、`frontend/src/views/prefix-detail-page.tsx` | CIDR、VLAN、gateway、split length 在提交前给出可理解提示 |
| allocation expiry 编辑 | `frontend/src/views/prefix-detail-page.tsx` | UI 可查看和更新 `expiryDate` |
| 危险删除提示增强 | `frontend/src/views/prefix-tree-page.tsx`、`frontend/src/views/prefix-detail-page.tsx` | 删除前展示 children 和 allocations 数量 |
| 前后端 CIDR 语义对齐 | `frontend/src/lib/cidr.ts` | 前端只做轻量预校验，最终以服务端错误为准，避免复杂逻辑分叉 |

### P3：验证、发布与收尾

| 任务 | 文件或命令 | 验收标准 |
|---|---|---|
| 后端构建 | `cd backend && npm run build` | TypeScript 编译通过 |
| 后端测试 | `cd backend && npm test` | CIDR、Prefix、Geofeed 测试通过 |
| 前端 lint | `cd frontend && npm run lint` | 无新增 lint error |
| 前端构建 | `cd frontend && npm run build` | Next.js build 通过 |
| Smoke test | 本地浏览器 | Dashboard、Prefix 列表、详情、Geofeed、Settings 可打开 |
| 验证记录 | `PROJECT_PROPOSAL.md` 或独立交付说明 | 记录执行命令、结果、未验证原因 |

## 13. 里程碑计划

### M1：安全文档基线

目标：让项目可以被新维护者安全接手。

- 更新 README 和环境变量示例。
- 清理旧架构描述和敏感信息。
- 明确当前端口、启动命令、API endpoint 和数据模型。

完成标准：

- 文档不再出现真实凭据。
- README 与 `backend/src/app.module.ts` 注册模块一致。
- 本地启动步骤只依赖 `.env.example` 指引。

### M2：核心逻辑回归保障

目标：把已经修复的 CIDR / Prefix / Geofeed 行为固定成测试。

- 增加 Jest 或 Nest 标准测试配置。
- 为 `backend/src/lib/cidr.ts` 建立纯函数测试。
- 为 Prefix 和 Geofeed 建立服务级测试，数据库依赖使用 mock 或测试数据库二选一。

完成标准：

- 后端新增 `npm test`。
- 核心 IP 计算、重叠规则和 CSV 行为可自动验证。
- 后续修改这些逻辑时能快速发现回归。

### M3：前端旧模型收敛

目标：用户不会再通过旧页面误操作旧模型。

- 将旧页面改为重定向或清晰迁移提示。
- Prefix 页面内部跳转改用 router。
- 增加表单校验和危险删除提示。

完成标准：

- 导航和可直达 URL 均指向 Prefix 树模型。
- 旧页面不会展示 mock 或旧业务对象。
- Prefix 详情操作流无明显阻塞。

### M4：验收与交付

目标：形成可交付、可复现的项目状态。

- 运行后端 build/test。
- 运行前端 lint/build。
- 如数据库和环境变量可用，完成浏览器 smoke test。
- 记录已完成范围、未完成范围和后续建议。

完成标准：

- 自动化检查结果可复现。
- 失败项有明确原因，不混入无关修复。
- 交付说明足以让下一位维护者继续工作。

## 14. 测试策略

### 14.1 后端单元测试

优先覆盖纯函数和业务边界，不先追求大而全。

- `parseCIDR`：拒绝缺少 `/`、多余 `/`、非法 prefix length、非法 octet、非法 IPv6 group。
- IPv4 规范化：`192.168.1.10/24` 应规范化为 `192.168.1.0/24`。
- IPv6 规范化：`2001:db8::1/64` 应落到对应 `/64` network。
- `cidrContains`：parent 必须更短，且完全包含 child。
- `cidrOverlaps`：同版本检测重叠，IPv4/IPv6 混合不重叠。
- `ipSortValue`：`10.0.0.2` 必须排在 `10.0.0.100` 前。

### 14.2 后端服务测试

服务级测试只覆盖业务规则，不依赖 UI。

- 创建 root：重复 CIDR 拒绝，root 重叠拒绝。
- 创建 child：不在 parent 内拒绝，与 sibling 重叠拒绝。
- split：new prefix length 无效拒绝，超过上限拒绝，已存在子网不重复创建。
- generate IP：IPv6 拒绝，大 IPv4 prefix 拒绝，`/31` 和 `/32` 不错误保留首尾。
- update allocation：状态、assignee、purpose、notes、expiryDate 均能更新，并触发 used count 重算。
- Geofeed import：quoted comma 正确解析，非法 country code 返回失败明细。

### 14.3 前端验证

前端优先做 lint/build 和 smoke test，暂不引入大型 e2e 框架。

- Prefix 列表：加载 root prefixes，搜索、创建、编辑、删除弹窗可用。
- Prefix 详情：children 可进入，split/add child/generate IP 可触发 API。
- Allocation：筛选、排序、编辑字段可用。
- Geofeed：列表、创建、导入、导出链接可用。
- Settings：读取和保存配置可用。

## 15. 发布与回滚方案

### 15.1 发布前检查

- 确认生产 `.env` 与 `.env.example` 字段一致。
- 确认 Prisma schema 无破坏性变更；如需要变更，先导出备份。
- 确认 README 不包含真实凭据。
- 确认 `dist` 由当前源码重新构建，旧 dist 不参与判断。

### 15.2 发布步骤

1. 后端安装依赖并执行 `npm run db:generate`。
2. 如 schema 未变更，直接 `npm run build`。
3. 如 schema 变更，先在测试库执行 `npm run db:migrate` 或 `npm run db:push`，再评估生产执行方式。
4. 前端配置 `NEXT_PUBLIC_API_URL`，执行 `npm run build`。
5. 启动服务后访问 Dashboard、Prefix、Geofeed 做 smoke test。

### 15.3 回滚策略

- 文档和前端变更可直接回滚到上一版本。
- 后端无 schema 变更时，可回滚代码并重启。
- 后端有 schema 变更时，必须保留迁移记录和数据库备份；不要依赖手工猜测回滚。

## 16. 验收清单

### 文档

- [ ] README 只描述当前 Prefix 树架构。
- [ ] README 不包含真实数据库 URL、token 或密码。
- [ ] `.env.example` 覆盖后端和前端必需变量。
- [ ] 旧模块和旧页面的处理方式被明确记录。

### 后端

- [ ] CIDR 解析、规范化、包含、重叠、排序测试通过。
- [ ] Prefix root/child/sibling 重叠规则测试通过。
- [ ] split 和 generate IP 上限测试通过。
- [ ] allocation `expiryDate` 更新路径测试通过。
- [ ] Geofeed quoted CSV 和失败明细测试通过。
- [ ] `npm run build` 通过。

### 前端

- [ ] 旧页面不会展示旧模型操作。
- [ ] Prefix 内部跳转使用 router。
- [ ] Prefix 创建、添加 child、split 有提交前校验。
- [ ] 删除 prefix 前展示级联影响。
- [ ] allocation 可编辑 `expiryDate`。
- [ ] `npm run lint` 和 `npm run build` 通过。

### 运行验证

- [ ] Dashboard 可加载统计。
- [ ] Prefix 列表可加载、创建 root、进入详情。
- [ ] Prefix 详情可 split、添加 child、生成 IPv4 IP 池。
- [ ] Allocation 可筛选、排序、编辑。
- [ ] Geofeed 可创建、导入、导出 CSV。
- [ ] Settings 可读取和保存。

## 17. 待确认事项

这些问题不阻塞 P0/P1，但会影响产品口径和后续 schema 设计。

1. `Reserved` 是否应计入“利用率”，还是只作为单独容量占用指标展示。
2. IPv6 `totalIPs` 是否需要从 `Float` 改为字符串字段或展示层标签。
3. `GeofeedEntry.prefix` 当前是唯一值，是否允许同一 prefix 存在多条不同地理记录。
4. 删除 prefix 是否允许 cascade，还是需要增加软删除或二次确认输入 CIDR。
5. 旧 `/ip-blocks`、`/subnets`、`/allocations` 页面是直接删除、重定向，还是保留迁移说明页。
6. 后端测试应使用 mock Prisma、SQLite 替代库，还是专门 MySQL 测试库。

## 18. 下一步执行清单

推荐按以下顺序继续实施，避免先做 UI 细节而缺少安全和测试基线。

1. 更新 `README.md`，删除敏感信息，改成当前 Prefix 架构。
2. 新增 `backend/.env.example`、`frontend/.env.example` 和忽略规则。
3. 为后端加入测试框架与 `npm test`。
4. 先写 `backend/src/lib/cidr.ts` 的测试，固定 CIDR 行为。
5. 再写 Prefix service 和 Geofeed service 的关键测试。
6. 处理旧前端页面，统一到 `/prefixes`。
7. 替换内部 `window.location.href`，补表单校验和删除提示。
8. 跑后端 build/test、前端 lint/build，记录验证结果。

## 19. 执行记录

本轮已按规划完成 P0 到 P3 的主要修复与自动化验证。

### 19.1 已完成修复

- README 已更新为当前 Prefix 树架构，移除旧 `ip-blocks / subnets / allocations` API 描述和敏感连接信息。
- 已新增 `.gitignore`、`backend/.gitignore`、`backend/.env.example`、`frontend/.env.example`。
- 后端 CIDR 工具已强化 prefix length、IPv4 leading zero、IPv6 输出压缩等校验与规范化。
- Prefix split 已拒绝与既有 child prefix 发生非精确重叠的拆分结果。
- Prefix allocation 更新已校验并支持 `expiryDate`。
- Geofeed 创建和更新会校验显式 `prefixId`，CSV import 返回 `imported / failed / errors[]`。
- 后端新增轻量测试脚本 `npm test`，覆盖 CIDR、Prefix service、Geofeed service 核心行为。
- `/ip-blocks`、`/subnets`、`/allocations` 已重定向到 `/prefixes`，旧 view 已替换为迁移提示。
- Prefix 页面内部跳转已改用 Next.js router。
- Prefix 创建、添加 child、split 已加入前端提交前校验。
- Prefix 删除提示已展示 children 和 allocations 数量。
- Allocation 表格和编辑弹窗已支持 `expiryDate`。
- 前端 ESLint 配置已迁移到 Next 16 flat config，修复生产 build 类型问题。

### 19.2 验证结果

| 命令 | 结果 |
|---|---|
| `cd backend && npm test` | 通过 |
| `cd backend && npm run build` | 通过 |
| `cd frontend && npx tsc --noEmit` | 通过 |
| `cd frontend && npm run lint` | 通过 |
| `cd frontend && npm run build` | 通过 |

### 19.3 未执行项

- 未启动真实 MySQL、NestJS API 和 Next.js dev server 做浏览器 smoke test。
- 未执行数据库迁移或种子数据导入，避免在未确认目标数据库的情况下改动数据。
