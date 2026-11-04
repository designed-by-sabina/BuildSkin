export const PAGES = [
  { href: 'index.html', label: '01 COVER' },
  { href: 'massing.html', label: '02 MASSING' },
  { href: 'calculator.html', label: '03 CALCULATOR' },
];

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
