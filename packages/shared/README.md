# @patent/shared：跨包共享工具

依赖无关的小工具集，供 web / bridge / 管线包复用：

- `Result<T, E>`：显式错误结果类型（不依赖异常控制流）；
- `newId(prefix)`：短随机 id（非加密用途，用于本地实体 id）；
- `sha256Hex`：内容哈希（环境提供 crypto 时可用；用于源片段指纹与去重）；
- `versioning`：promptVersion / rulePackVersion 常量锚点；
- `neverReachable` 与断言工具。

注意：所有跨包导入通过 tsconfig `paths` 解析（离线 typecheck），正式构建时改为 workspace 依赖。
