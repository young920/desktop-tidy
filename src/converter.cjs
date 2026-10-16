const path = require('node:path');
const fs = require('node:fs/promises');
const { PDFDocument } = require('pdf-lib');

const officeFormats = {
  doc: { family: 'text', counterpart: 'odt' }, docx: { family: 'text', counterpart: 'odt' }, odt: { family: 'text', counterpart: 'docx' },
  xls: { family: 'sheet', counterpart: 'ods' }, xlsx: { family: 'sheet', counterpart: 'ods' }, ods: { family: 'sheet', counterpart: 'xlsx' },
  ppt: { family: 'slides', counterpart: 'odp' }, pptx: { family: 'slides', counterpart: 'odp' }, odp: { family: 'slides', counterpart: 'pptx' }
};
const imageFormats = new Set(['png', 'jpg', 'jpeg']);
const normalized = value => String(value || '').replace(/^\./, '').toLowerCase();

function extensionOf(file) { return normalized(path.extname(file.name || file.path || '')); }
function option(format, label, operation, quality) { return { format, label, operation, ...(quality ? { quality } : {}) }; }

function targetsForExtension(extension) {
  const ext = normalized(extension);
  if (ext === 'pdf') return [option('png', 'PDF 转 PNG 图片', 'pdf-to-images'), option('jpg', 'PDF 转 JPG 图片', 'pdf-to-images'), option('docx', 'PDF 转 Word（尽力转换）', 'office', 'best-effort'), option('odt', 'PDF 转 ODT（尽力转换）', 'office', 'best-effort')];
  if (imageFormats.has(ext)) return [option('pdf', '图片转 PDF', 'images-to-pdf')];
  const office = officeFormats[ext];
  if (office) return [option('pdf', '转为 PDF', 'office'), option(office.counterpart, `转为 .${office.counterpart.toUpperCase()}`, 'office')];
  return [];
}

function conversionTargets(items) {
  if (!Array.isArray(items) || !items.length || items.some(item => item?.type !== 'file')) return [];
  const extensions = items.map(extensionOf);
  if (extensions.some(ext => !ext || !targetsForExtension(ext).length)) return [];
  const families = extensions.map(ext => ext === 'pdf' ? 'pdf' : imageFormats.has(ext) ? 'image' : officeFormats[ext].family);
  if (families.some(family => family !== families[0])) return [];
  if (families[0] === 'pdf' && items.length > 1) return [option('pdf', '合并为一个 PDF', 'merge-pdf')];
  if (families[0] === 'image' && items.length > 1) return [option('pdf', '合并图片为一个 PDF', 'images-to-pdf')];
  const available = targetsForExtension(extensions[0]);
  if (items.length === 1) return available;
  return available.filter(candidate => extensions.every(ext => targetsForExtension(ext).some(other => other.format === candidate.format)));
}

function planConversion(items, targetFormat) {
  const targets = conversionTargets(items);
  const format = normalized(targetFormat);
  const selected = targets.find(candidate => candidate.format === format);
  if (!selected) throw new Error('不支持所选文件与目标格式的转换。');
  const folders = new Set(items.map(item => path.resolve(path.dirname(item.path)).toLowerCase()));
  if (folders.size !== 1) throw new Error('请选择同一文件夹中的文件进行转换。');
  return { ...selected, files: items.map(item => ({ path: item.path, name: item.name, extension: extensionOf(item) })), sourceFolder: path.dirname(items[0].path) };
}

function nextAvailablePath(directory, sourceName, targetExtension, exists = require('node:fs').existsSync) {
  const base = path.basename(sourceName, path.extname(sourceName));
  const ext = `.${normalized(targetExtension)}`;
  let candidate = path.join(directory, `${base}${ext}`), suffix = 2;
  while (exists(candidate)) candidate = path.join(directory, `${base} (${suffix++})${ext}`);
  return candidate;
}

async function mergePdfFiles(files, outputPath) {
  if (!files.length || files.length > 50) throw new Error('请选择 1–50 个 PDF 文件。');
  const result = await PDFDocument.create();
  let totalBytes = 0;
  for (const file of files) {
    const bytes = await fs.readFile(file.path); totalBytes += bytes.length;
    if (totalBytes > 300 * 1024 * 1024) throw new Error('所选 PDF 总大小超过 300 MB。');
    const input = await PDFDocument.load(bytes);
    const pages = await result.copyPages(input, input.getPageIndices());
    pages.forEach(page => result.addPage(page));
  }
  await fs.writeFile(outputPath, await result.save(), { flag: 'wx' });
  return outputPath;
}

async function imagesToPdf(files, outputPath) {
  if (!files.length || files.length > 50) throw new Error('请选择 1–50 张 PNG/JPG 图片。');
  const document = await PDFDocument.create();
  let totalBytes = 0;
  for (const file of files) {
    const bytes = await fs.readFile(file.path); totalBytes += bytes.length;
    if (totalBytes > 300 * 1024 * 1024) throw new Error('所选图片总大小超过 300 MB。');
    const image = file.extension === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    const [pageWidth, pageHeight] = [595.28, 841.89], margin = 28;
    const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
    const width = image.width * scale, height = image.height * scale;
    const page = document.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  }
  await fs.writeFile(outputPath, await document.save(), { flag: 'wx' });
  return outputPath;
}

module.exports = { conversionTargets, planConversion, nextAvailablePath, mergePdfFiles, imagesToPdf, officeFormats, imageFormats };
