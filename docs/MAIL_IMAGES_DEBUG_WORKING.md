# 邮件图片超时与正文调试（2026-10-13）

## 目标与边界

- 图片加载中的占位条需要超时收起；正文区域右键提供浏览器调试，查看Console与资源错误。
- main / 887e297 / 0.1.13，保留前阶段未提交修改。通知点击用户已确认直达正文。当前本地包已安装；本轮先本地重建，用户确认前不推送或远程发布。

## 设计与代码

- mail-images.ts 为每张图片设15秒期限，布局变化不延长等待；超时收起动画并使用shadcn Alert/Button提供重试，失败单独提示。只重试未成功的图片，保留净化后src/srcset，成功图片和MIME原件不变。
- 浏览器继续处理已发出的图片请求，迟到成功移除提示；WebKit sandbox事件受限时通过仅在有未完成图片期间的1秒检查更新状态。切换正文/卸载释放计时器、监听与过期回调。
- MailContent只读阅读处显式inspectable；正文iframe恢复系统原生右键（Inspect Element），正文容器/纯文本通过data-mail-debug-region豁免默认菜单屏蔽。写信/签名预览继续原屏蔽规则，业务自定义菜单继续shadcn。
- Tauri devtools Cargo feature及main窗口devtools配置使本地Release包也可检查；不新增IPC权限，不放宽邮件净化、CSP或scripts-disabled iframe sandbox。

## 首轮自动检查记录（历史）

- 图片期限4项、默认菜单边界2项、布局4项、安全HTML11项，共21项已通过。
- 尚需组件超时/重试显示回归，UI/生产/预览/格式检查，ego-browser虚构图状态与原生右键开发者工具验收。
- 尚未重建或安装本轮桌面包；接续从上述验证开始。真实邮件不修改原件，不因测试清空真实草稿或批量改标记。

## 浏览器与原生首轮结果

- ego-browser空间27复用应用React运行时挂载虚构MailContent，两张data图片中仅一张用DOM状态模拟持续等待；实际15秒后占位条消失、aria-busy=false、提示/重试可见。重试恢复占位条，迟到成功清除提示，成功图片src未变、正文保留。临时DOM/root/状态已清理，没有修改业务源码注入或真实邮件。
- 首轮本地desktop:build成功，27.96MiB；备份上一包至`/Users/zhangxiaojun/.config/yanxin-release/local-backups/20261013-185636/雁信-before-image-debug.bundle`并安装。codesign深度严格校验通过、DR内容与通知包一致。
- 真实HTML阅读区域原生右键出现Inspect Element，实际打开WebKit检查器，Console与Network可用。用户也提供了控制台截图。随后发现64次scripts-disabled跨帧事件警告，首轮包仍存在此警告，不标作已修复。

## 用户补充：电子工程周报缺图及控制台警告（2026-10-13）

- 用户指出《电子工程周报》2026年第35期所有远端图片未显示；同服务商第27期在本机也复现，图片都来自`www.eechina.com/edm/image.php`。首张公共图接口`id=eNews`可独立核对，无账号/正文查询参数。
- WebView Network实际GET为HTTP200、HTML、约16.45KB，naturalWidth=0；同URL主页面Image对照也失败。HEAD仅返回image/gif不能证明实际GET是图片，后续命令行GET同样返回200/text/html约16124字节，内容为阿里云WAF浏览器/验证码验证页。没有执行该验证页脚本、解验证码或绕过限制。
- 用户已确认在其他地方查看这封邮件也不能加载图片，缺图按服务端限制记录；不改原件或图片地址，不为了第三方验证开启allow-scripts。
- 重复控制台警告另由WebKit的scripts-disabled帧事件限制处理：原生阅读不绑定子文档load/error/click/auxclick监听；状态使用父页面1秒检查/布局观察，外链继续既有原生导航路由。浏览器端仍保留事件拦截；native组件与tracker专项验证不绑定子文档回调且保留sandbox。
- 更新后的图片/菜单/布局/安全HTML/原生回调边界共25项通过、格式检查通过；该轮包已构建安装，后续控制台结果见下方记录。

## 用户补充：对话规则与Qoder误加载提示（2026-10-13）

- 已核对前后端conversation实现：同账号Message-ID/serverMessageId/In-Reply-To/References形成引用连通关系，标题及Re前缀不参与；不同账号分开，缺少引用头可能无法合并。同标题隔离/缺失祖先/分支/服务端ID回归4项通过。
- 原生Qoder图片清单共5张：四张可见图片naturalWidth>0，Logo143×40、社交图标24×24；另一张统计请求display:none/width:1px/height:1px，naturalWidth=0且TLS错误。正文图片本身已加载，旧状态统计把隐藏img也算入，解释截图的多余占位/超时。诊断仅记录尺寸/状态及去查询参数的资源路径，不把跟踪参数加入文档。
- watchMailImages根据自身/祖先display:none、opacity:0、content-visibility:hidden及自身visibility隐藏状态排除隐藏图片；有确定渲染/CSS/HTML尺寸且两边不超过1px的小像素也不参与。零布局框但没有确定尺寸的真实未完成图片继续等待，避免隐藏真实缺图。重试前重新检查可见性；不改HTML图片地址/MIME或执行邮件脚本。
- 当前新增隐藏统计/祖先隐藏/重新显示及native组件回归；图片、组件、安全HTML、菜单、布局、对话共32项通过。浏览器及桌面安装结果见下方。
- 前一sandbox监听修复包已构建安装，备份于20261013-191511/雁信-before-sandbox-listener-fix.bundle；本轮原生检查器未见Blocked script execution，已有资源TLS及ResizeObserver日志，不能记作控制台全无错误。

## 隐藏图片修复自动检查与浏览器结果

- `npm test -- src/components/mail-content-loading.test.tsx src/lib/mail-images.test.ts src/lib/context-menu.test.ts src/components/mail-content.test.tsx src/lib/mail-html.test.ts src/lib/conversations.test.ts`：32项通过。
- `npm run build`（含check:ui）、`npm run build:preview`及原生桥隔离检查、`npm run format:check`、Rust fmt和`git diff --check`通过；生产构建保留已有大chunk/混合import提示。
- ego-browser空间27挂载虚构MailContent：一张成功内容图、两张明确隐藏/1×1像素，DOM模拟像素持续pending；真实等待16秒后aria-busy=false，无占位/超时/失败提示，原图片DOM仍存在。临时root/DOM全部清理，该浏览器检查空间已关闭。较早单独两轮间因页面刷新丢失临时fixture，未作为超时验收；最终同一轮完整验证通过。
- `npm run desktop:build`完成，App27.96MiB、更新归档11.29MiB，使用既有稳定Apple Development签名；未公证/未获得Developer ID，此为本地验证包。没有触发远程流水线或发布。

## 本地桌面最终验证与接续入口

- 已备份上一安装至`/Users/zhangxiaojun/.config/yanxin-release/local-backups/20261013-192718/anser-before-hidden-image-fix.bundle`，可逆覆盖`/Applications/雁信.app`。codesign深度严格校验通过，签名DR与上一包一致；安装二进制与构建包SHA-256均为`e12303f169cc9131994ce66c754d027ce86df55eca8e1e55f26fe111752d767e`。账号/存储标识及原件未改。
- 新安装包实际打开原Qoder邮件，Logo/正文/表格正常，超过等待期限后无占位/超时/失败提示。原生检查器读取：四张可见图片complete=true、naturalWidth>0，隐藏统计图片complete=false/naturalWidth=0/display:none；正文aria-busy=false，bar=false，notice=false。已关闭检查器并保留原邮件阅读页供用户查看。
- 新包正文原生右键Inspect Element实际可用，控制台本轮未见Blocked script execution，iframe仍为allow-same-origin且不允许邮件脚本；不能据此承诺所有资源或其他控制台警告都消失。
- 本轮目标修复/相关自动检查/浏览器及这封真实邮件本地验证完成；等待用户确认显示效果后再进入提交和正式发布全量门槛。公开版本仍0.1.13，未推送/打标签/远程发布。其他历史未完验收与Developer ID事项保持各自工作点，不由本轮替代。
