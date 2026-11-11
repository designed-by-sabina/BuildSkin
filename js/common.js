export const PAGES = [
  { href: 'index.html', label: 'Cover' },
  { href: 'massing.html', label: 'Massing' },
  { href: 'calculator.html', label: 'Calculator' },
];

// Assignment value for walls marked "existing facade to remain" (not an assembly)
export const EXISTING = '__existing';

// Per-assembly customizations made on the detail page (assembly.html). Display/what-if only.
export const customKey = id => 'buildskin:custom:' + id;

export function mountNav(el, current) {
  PAGES.forEach((p, i) => {
    const a = document.createElement('a');
    a.href = p.href;
    a.textContent = p.label;
    if (i === current) a.classList.add('current');
    el.append(a);
  });
}

export function storageGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable — non-critical */ }
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtInt = n => Math.round(n).toLocaleString('en-US');
