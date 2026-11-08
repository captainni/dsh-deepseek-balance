# dsh-deepseek-balance

在 DeepSeek Harness（DSH）Web 的输入框下方状态行显示 **DeepSeek API 余额**、**今日消费估算** 和 **峰谷时段倒计时**。

```text
1轮 15步 · 198 tok/s    426K tok · 缓存命中 96%    余额 ¥84.05 | 今日 ¥0.52 | 谷 40h33m    4%
```

> 上面是位置示意，数字来自你自己的账号。

## 功能

- **余额**：官方 `GET /user/balance` 的 `total_balance`；hover 显示充值 / 赠送拆分；低于 ¥5 变黄、低于 ¥1 变红。
- **今日消费**：本地余额差额估算（本地零点前最后一次读数 − 当前余额），充值入账会重置基线并在 tooltip 标注；首日从首次读取起算。
- **谷 / 峰**：按官方价目时段计算，并显示距下次切换的倒计时（`40h33m`、`1h30m`、`59m30s`）。
- **刷新**：页面加载时、每轮对话结束后自动刷新；未就绪或失败时每 30 秒重试；跨过本地零点自动开始新一天的「今日」。
- **点击**：整格是链接，打开 DeepSeek 平台用量页。
- **中英文**：文案跟随 DSH 的 locale，插件在 Plugin Manager 里显示自己的标题、描述和图标。

## 数据来源与隐私

| 项 | 做法 |
| --- | --- |
| API Key | Host 侧从 DSH 凭据服务读取 `DEEPSEEK_API_KEY`（设置 → 模型 里配置的官方 Key），也兼容进程环境变量 |
| 上游请求 | `GET https://api.deepseek.com/user/balance`，8 秒超时，15 秒缓存 |
| 浏览器拿到什么 | 只有 `{ currency, total, granted, toppedUp }` 四个字段，**API Key 不会进入页面** |
| 本地接口 | `GET /dsh-balance/summary`，只接受 127.0.0.1 的回环请求，`no-store`，方法只允许 GET/HEAD |
| 遥测 | 无 |

### 为什么不用平台账号钱包

DSH 的 `remote.account` 钱包接口只在用**平台账号登录**（模型路由 `deepseek-account`）时可用。如果模型路由是 API Key（`deepseek-official`），钱包查询会返回空，插件只能静默。这个插件直接走 API Key 的官方余额接口，只要有 Key 就能显示。

## 安装

前置条件：

- DSH 0.2.x，Web profile；
- 已在 **设置 → 模型** 配置官方 DeepSeek API Key（provider `deepseek-official`）。

步骤：

1. 克隆仓库：

   ```bash
   git clone https://github.com/captainni/dsh-deepseek-balance.git
   ```

2. 在 DSH 会话里让 agent 把这个目录装成当前 profile 的 bundle，例如：

   > 把 `/绝对路径/dsh-deepseek-balance` 安装为 web profile 的 bundle。

   agent 会用 `plugin_manager install_bundle` 完成「安装依赖 + 选中 bundle」两步，并把结果回给你。

3. **刷新页面**。客户端模块只在页面加载时导入；已经开着的页面不会自动换代码。

4. 状态行出现 `余额 ¥… | 今日 ¥… | 谷/峰 …`。如果你的账号是 API Key 之外的其他路由，余额仍以该 Key 的账户为准。

> 如果插件行显示 `duplicate exact route` 之类的旧版本残留，重启一次 `dsh web` 即可清掉。

## 行为口径

**余额**  
主数字是 `total_balance`（充值 + 赠送）。`granted_balance` 和 `topped_up_balance` 在 hover 里拆分显示；多币种时主数字优先 CNY，其他币种只在 tooltip 里列出。

**今日消费（估算）**  
以「本地零点前最后一次观测到的余额」为基线，用「基线 − 当前余额」得到今日花费：

- 余额上升视为充值/赠送入账，基线重置为当前值并标注「今日含充值，估算已重置」；
- 首日安装时基线是首次读数，所以当天会少算，tooltip 标注「自首次读取起算」；
- 隔了多天才打开页面时，基线取上次观测值，属于已知近似。

这不是官方账单，只是一个不打扰人的本地估算。

**峰谷时段**  
按官方价目：峰时为 **UTC 周一至周五 01:00–04:00 与 06:00–10:00**（北京时间 09:00–12:00、14:00–18:00），其余时间、周末为谷时。倒计时显示距下一次价目切换的时间。

**阈值**  
余额 `< ¥5` 显示警告色，`< ¥1` 显示错误色。

## 已知限制

- 「今日」是余额差额估算，不是平台账单；
- 峰谷判断**没有内置中国法定节假日**，工作日遇到节假日会误判为峰时；
- 只支持 DSH Web（不覆盖 Desktop / 终端）；
- 单账号：同时只显示一个 API Key 对应的余额；
- 余额接口读不到时显示 `余额 —`，缺 Key 时显示 `余额 未配置`，不会静默消失。

## 开发与测试

纯前端逻辑与 Host 路由都按 TDD 写：`test/` 里 76 条用例覆盖金额、今日估算、峰谷、控制器竞态/超时、视图模型、包结构、Host 路由。

```bash
node --test          # 76 个用例
node --check client.js
node --check index.js
```

`client.js` 是单文件浏览器模块，不能跨文件 `import`，所以纯函数和状态控制器通过 `__internals` 暴露给测试；`test/harness.mjs` 用 `node:vm` 加载模块并注入 React 桩，无需额外依赖。

另有一个只读自检 provider `deepseek-balance-debug`（Cordis inspect，方法 `state`），用于读取渲染状态、路由和错误，排障时很有用，不影响 UI。

目录：

```text
client.js            # 单文件客户端：纯函数 + 控制器 + React 格子 + 自检 provider
index.js             # Host：读凭据、调 /user/balance、注册 /dsh-balance/summary
cordis.patch.yml     # 插入 deepseek-balance 行
locale/{zh,en}.json  # Plugin Manager 用的标题/描述
icon.svg             # 插件图标
test/                # node:test 用例与 vm 测试夹具
```

## License

MIT
