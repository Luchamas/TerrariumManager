// Reads the cell values of an .xlsx file, with no extra libraries. An .xlsx is a zip of XML
// files: the zip is read with Node's zlib, and the XML (always machine-written and simple)
// with regular expressions. Only values are read; formulas give their last computed result.

const fs = require('node:fs');
const zlib = require('node:zlib');

// Returns { 'Sheet name': { A1: value, B2: value, ... } }. Numbers come back as numbers
// (dates too: see excelDate), everything else as text.
function readXlsx(file) {
  const zip = unzip(fs.readFileSync(file));
  const text = (name) => {
    const bytes = zip.get(name);
    if (!bytes) throw new Error(`O arquivo não parece ser uma planilha do Excel (falta ${name}).`);
    return bytes.toString('utf8');
  };

  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const targets = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]),
  );

  const sheets = {};
  for (const [, attrs] of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const target = targets.get(attr(attrs, 'r:id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    sheets[decode(attr(attrs, 'name'))] = readSheet(text(path), strings);
  }
  return sheets;
}

function readSheet(xml, strings) {
  const cells = {};
  for (const [, attrs, body] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (!body) continue;
    const ref = attr(attrs, 'r');
    const type = attr(attrs, 't');
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value;
    if (type === 's') value = raw == null ? null : strings[Number(raw)];
    else if (type === 'inlineStr') value = textRuns(body);
    else if (type === 'str' || type === 'e') value = raw == null ? null : decode(raw);
    else if (type === 'b') value = raw === '1';
    else value = raw == null ? null : Number(raw);
    if (value != null && value !== '') cells[ref] = value;
  }
  return cells;
}

// Excel stores dates as days since 30 Dec 1899. Returns YYYY-MM-DD, or null if it isn't one.
function excelDate(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 1) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---- zip ---------------------------------------------------------------------------

// Every file in the zip, by name. Reads the central directory at the end of the file,
// which lists each file's size and where it starts.
function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('O arquivo não parece ser uma planilha do Excel.');

  const files = new Map();
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('A planilha está corrompida.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // The file's own header repeats the name and may have a different extra field.
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, zlib.inflateRawSync(data));
  }
  return files;
}

// ---- xml ---------------------------------------------------------------------------

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

// The text of a shared or inline string: all its <t> runs joined.
const textRuns = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

const decode = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex, dec, named) => {
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  if (dec) return String.fromCodePoint(Number(dec));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named] ?? whole;
});

module.exports = { readXlsx, excelDate };
