import { mountNav, fmtInt } from './common.js';
import { buildMassing } from './massing-core.js';
import { renderThumbnail } from './viewer.js';
import { listMassings, loadMassingText, saveUpload, updateMassingSettings, removeMassing, getCurrentMassingId, setCurrentMassingId, UNITS } from './massings.js';

const $ = id => document.getElementById(id);
let items = [];
let selectedId = getCurrentMassingId();

mountNav($('nav'), 1);
refreshList();

async function refreshList() {
  items = await listMassings();
  if (!items.some(m => m.id === selectedId)) selectedId = items[0]?.id ?? null;
  $('grid').replaceChildren(...items.map(card));
  updateFooter();
}

function card(m) {
  const el = document.createElement('div');
  el.className = 'm-card' + (m.id === selectedId ? ' selected' : '');
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="m-thumb"><span class="m-loading">LOADING…</span></div>
    <div class="m-name"></div>
    <div class="m-stats"></div>
    <div class="m-opts">
      <label>UNITS <select data-k="units">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></label>
      <label>UP <select data-k="up"><option value="y">Y</option><option value="z">Z</option></select></label>
      ${m.source === 'upload' ? '<button class="m-del">REMOVE</button>' : '<span class="m-src">LIBRARY</span>'}
    </div>`;
  el.querySelector('.m-name').textContent = m.name;
  el.querySelectorAll('select').forEach(sel => {
    sel.value = m[sel.dataset.k];
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', async () => {
      await updateMassingSettings(m, { [sel.dataset.k]: sel.value });
      preview(m, el);
    });
  });
  el.querySelector('.m-del')?.addEventListener('click', async e => {
    e.stopPropagation();
    await removeMassing(m);
    refreshList();
  });
  el.addEventListener('click', () => select(m.id));
  el.addEventListener('dblclick', () => go(m.id));
  el.addEventListener('keydown', e => e.key === 'Enter' && go(m.id));
  preview(m, el);
  return el;
}

async function preview(m, el) {
  const thumb = el.querySelector('.m-thumb');
  const stats = el.querySelector('.m-stats');
  try {
    const massing = buildMassing(await loadMassingText(m), m);
    const h = massing.bounds.max.y;
    stats.textContent = `${fmtInt(massing.wallArea)} SF FACADE · ${massing.walls.length} SURFACES · ${fmtInt(h)} FT TALL`;
    const img = new Image();
    img.alt = m.name;
    img.src = renderThumbnail(massing);
    thumb.replaceChildren(img);
  } catch (err) {
    stats.textContent = 'COULD NOT READ OBJ — ' + err.message;
    thumb.replaceChildren();
  }
}

function select(id) {
  selectedId = id;
  document.querySelectorAll('.m-card').forEach((el, i) => el.classList.toggle('selected', items[i].id === id));
  updateFooter();
}

function go(id) {
  setCurrentMassingId(id);
  location.href = 'calculator.html?m=' + encodeURIComponent(id);
}

function updateFooter() {
  const m = items.find(x => x.id === selectedId);
  $('selName').textContent = m ? 'SELECTED: ' + m.name.toUpperCase() : 'NO MASSING SELECTED';
  $('continue').classList.toggle('disabled', !m);
}

$('continue').addEventListener('click', () => selectedId && go(selectedId));

// ---------- Upload ----------

const drop = $('drop');
const input = $('fileInput');
input.addEventListener('change', () => upload(input.files));
['dragenter', 'dragover'].forEach(t =>
  drop.addEventListener(t, e => {
    e.preventDefault();
    drop.classList.add('over');
  })
);
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => {
  e.preventDefault();
  upload(e.dataTransfer.files);
});

async function upload(files) {
  const objs = [...files].filter(f => /\.obj$/i.test(f.name));
  if (!objs.length) return;
  let last;
  for (const f of objs) last = await saveUpload(f);
  selectedId = last.id;
  input.value = '';
  refreshList();
}
