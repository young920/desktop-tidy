# 文件管家（Windows）

当前版本：v0.14.0。支持桌面整理、全电脑文件检索（增量更新、独立文件夹结果）、双栏文件管理，以及本机文件转换（PDF/图片、Word/ODF/Office 格式与 PDF 合并）。

「文件检索」支持全电脑固定磁盘 / 自选文件夹递归索引，按主题、关键词、创建或修改时间、文件格式组合筛选，并打开或定位结果。选中的文件可移入 Windows 回收站，必要时可从回收站恢复。操作指南见 [产品使用手册](docs/产品使用手册.md)。

「文件转换」在用户选择的文件夹中浏览和预览文件，转换结果保存在原文件夹，不覆盖原件。图片/PDF 转换、PDF 合并和多图转 PDF 可离线完成；Word/ODF/Office 与 PDF 互转需要本机安装 LibreOffice。PDF 转 Word 属于尽力转换，扫描件不含 OCR。

双击 `启动文件管家.bat` 即可启动开发版；首次会自动安装依赖。正式可分发包请运行 `npm run dist`，生成的安装包和便携 `.exe` 位于 `dist/`。

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
npm run test:e2e:manager
npm run test:e2e:conversion
npm start
npm run dist
```

所有规则和操作日志保存在 Windows 应用数据目录，不会写入待整理文件中。
