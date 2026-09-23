# 桌面清洁助手（Windows MVP）

双击 `启动桌面清洁助手.bat` 即可启动开发版；首次会自动安装依赖。正式可分发包请运行 `npm run dist`，生成的安装包和便携 `.exe` 位于 `dist/`。

## 已实现

- 使用 Windows 桌面系统路径扫描桌面第一层文件
- 本机关键词项目／固定事务规则，未命中或冲突项进入 `待确认/YYYY-MM`
- 预览画布：取消单项、拖拽变更去向、新建目标、确认后执行
- 不覆盖同名文件，执行前再次验证文件大小与修改时间
- 本地 JSON 操作日志、历史与整批撤销
- 跳过归档根目录、文件夹、快捷方式和符号链接；不读取正文、不删除文件

## 开发与验证

```powershell
npm install
npm test
npm run test:coverage
npm start
npm run dist
```

所有规则和操作日志保存在 Windows 应用数据目录，不会写入待整理文件中。
