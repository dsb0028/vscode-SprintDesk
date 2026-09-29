// Standalone, dependency-free VSIX ZIP writer. No parent manifests or outputs are modified.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const xml = value => String(value).replace(/[<>&"']/g, c => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
})[c]);
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}"/>
<DisplayName>${xml(pkg.displayName)}</DisplayName><Description xml:space="preserve">${xml(pkg.description)}</Description>
<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>`;
const types = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/>
<Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/>
<Default Extension="txt" ContentType="text/plain"/>
</Types>`;
const entries = [
  ['[Content_Types].xml', Buffer.from(types)],
  ['extension.vsixmanifest', Buffer.from(manifest)],
  ['extension/licenses/SprintDesk.txt', fs.readFileSync(path.join(root, '../LICENSE'))],
  ['extension/licenses/js-yaml.txt', fs.readFileSync(path.join(root, '../node_modules/js-yaml/LICENSE'))],
  ...['package.json', 'README.md', 'dist/extension.js'].map(name =>
    [`extension/${name}`, fs.readFileSync(path.join(root, name))])
];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const locals = [], central = [];
let offset = 0;
for (const [name, bytes] of entries) {
  const filename = Buffer.from(name), compressed = zlib.deflateRawSync(bytes), crc = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  locals.push(local, filename, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(bytes.length, 24);
  entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, filename);
  offset += local.length + filename.length + compressed.length;
}
const end = Buffer.alloc(22), directory = Buffer.concat(central);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const output = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
fs.writeFileSync(output, Buffer.concat([...locals, directory, end]));
console.log(`Packaged ${path.basename(output)} (${entries.length} entries). No installation/publication performed.`);
