# 雁信项目规则

## UI 铁律（用户明确要求）

**所有界面组件统一使用 shadcn/ui，禁止自行实现一套 UI 组件或混入其他组件体系。**

- 新增组件先检查 `src/components/ui/`；缺少时从 shadcn 官方 registry 引入，与现有 `new-york` 样式及 Radix 体系保持一致。
- 业务组件通过组合 shadcn 组件完成。允许业务数据、布局、尺寸及主题适配；禁止重写按钮、输入框、选择器、菜单、弹层、复选框、分栏、加载占位等基础交互组件。
- 日期选择用 `Calendar` + `Popover`；时间选择用 shadcn `Select`。禁止在业务界面使用原生 `date` / `time` / `datetime-local` 选择器。
- 自动补全用 `Command` + `Popover`，禁止原生 `datalist` 或自行绘制建议菜单。
- `src/components/ui/` 中官方组件内部的原生元素属于正常实现；业务代码中的 HTML 语义结构、邮件正文 iframe、富文本编辑内容不属于另造 UI 组件。
- 修改 UI 后运行 `npm run check:ui`、相关交互测试及 `npm run build`，在开发预览中检查效果。

## 开发预览

使用 `npm run desktop` 直接运行 Tauri 开发应用。优先复用正在运行的开发预览，无需用户反复安装应用包。

应用存储与钥匙串标识 `dev.maildesk.desktop` 必须保持不变，避免丢失已有账号及本地存档。
