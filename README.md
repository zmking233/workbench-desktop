# 工作台

基于开源 DeepSeek Harness npm 包封装的第三方 Windows 桌面发行工程。

## 功能

- 一键启动 DeepSeek Harness Web 工作台
- 独立 Token 用量统计面板（基于 Harness 持久用量投影）
- 私有内置 RTK 0.45.0，优化 AI 执行外部命令时的冗长输出；不修改系统 PATH，遥测强制关闭
- 简体中文分步安装向导，可自选程序安装目录和独立工作目录
- 桌面快捷方式默认勾选、可由用户取消；开始菜单快捷方式正常创建
- API 注册、充值、密钥创建与本机加密保存指引
- Skill 新建、编辑、启停、导入和导出，不预装任何 Skill
- 第三方许可清单与商业发行检查清单

## 本地开发

```powershell
npm install
npm start
```

## 测试与构建

```powershell
npm test
npm run build
```

安装包输出到 `release/Workbench-Setup-1.6.3-x64.exe`。正式生成安装包前，可先运行 `npm run build:dir` 制作免安装目录版进行验收。

## 数据位置

- 工作区：默认位于用户“文档/工作台工作区”，可在界面中切换。
- Skills：工作区下的 `.agents/skills/<name>/SKILL.md`。
- 应用配置、加密密钥、审计日志和 Harness profile：Electron 用户数据目录。
- RTK 本地统计库：Electron 用户数据目录下的 `rtk/history.db`；不保存完整命令输出，不发送 RTK 遥测。
- 卸载默认保留用户数据和工作区，避免误删客户资料。

## 许可与销售

DeepSeek Harness 采用 MIT License；内置 RTK 采用 Apache License 2.0。二者均允许按许可证条件随商业软件再分发和销售，但必须保留相应版权、许可及声明。本桌面壳未对外授予开源许可，发行方可作为自己的商业产品维护。正式销售前请完成 [商业发行检查清单](COMMERCIALIZATION-CHECKLIST.md)，尤其是发行主体、EULA、隐私政策和 Windows 代码签名。

本仓库不包含 DeepSeek API 额度。“工作台”是基于开源 DeepSeek Harness 构建的第三方发行版，并非 DeepSeek 官方产品，也不代表 DeepSeek 官方授权或背书。
