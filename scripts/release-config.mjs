export function releaseVersion(manifest, packages, tag = '') {
  const version = manifest.version;
  if (manifest.manifest_version !== 3 || !/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('扩展必须使用有效的 MV3 / 1.x.y 版本号。');
  }
  if (packages.some(pkg => pkg.version !== version)) throw new Error('manifest 与 package.json 的版本号不一致。');
  if (tag && tag !== `v${version}`) throw new Error(`发布标签必须为 v${version}，当前为 ${tag}。`);
  return version;
}

export function packageEntry(path) {
  if (['', 'lib', 'icons', 'vendor', 'vendor/marked.js', 'vendor/marked.LICENSE.md'].includes(path)) return true;
  return /^(?:[a-z][\w-]*\.(?:js|css|html)|manifest\.json|README\.md|lib\/[\w-]+\.js|icons\/(?:16|32|48|128)\.png)$/.test(path);
}
