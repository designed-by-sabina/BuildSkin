// Step 03: number of floors and floor-to-floor heights for the selected massing.
// Saved per massing (see floors-data.js). Heights are never changed: the top floor of each
// stack takes whatever height is left. Optionally each volume of the massing gets its own floors.
import { mountNav, storageSet } from './common.js';
import { buildMassing } from './massing-core.js';
import { ElevationRenderer } from './viewer.js';
import { getMassing, getCurrentMassingId, setCurrentMassingId, listMassings, loadMassingText } from './massings.js';
import { floorsKey, loadFloorSet, floorStacks, floorLineGroups, maxCount, floorHeights, MAX_FLOORS } from './floors-data.js';

const $ = id => document.getElementById(id);
mountNav($('nav'), 2);

let info = null;
let massing = null;
let elev = null; // ElevationRenderer
let set = null; // { perVolume, all, volumes }
let stacks = []; // from floorStacks()
let active = 0; // index into stacks
let notice = ''; // one-off message under the count

const cur = () => stacks[active];
const cfg = () => cur().cfg;

const fmt = v => (Math.round(v * 100) / 100).toLocaleString('en-US');
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w === w.toUpperCase() ? 'S' : 's'}`;

init();

async function init() {
  const param = new URLSearchParams(location.search).get('m');
  info = (await getMassing(param ?? getCurrentMassingId())) ?? (await listMassings())[0] ?? null;
  if (!info) {
    $('crumbName').textContent = 'No massing selected';
    $('elevations').innerHTML = '<p class="f-note warn">No massing selected — pick one on the Massing page.</p>';
    return;
  }
  setCurrentMassingId(info.id);
  $('crumbName').textContent = info.name;
  $('continue').href = 'calculator.html?m=' + encodeURIComponent(info.id);
  try {
    massing = buildMassing(await loadMassingText(info), info);
    elev = new ElevationRenderer(massing);
  } catch (err) {
    $('elevations').innerHTML = `<p class="f-note warn">Could not read ${info.name}: ${err.message}</p>`;
    return;
  }
  set = loadFloorSet(info.id);
  const nv = massing.volumes.length;
  $('volBox').hidden = nv < 2;
  $('volCount').textContent = `· ${nv} volumes in this massing`;
  $('perVol').checked = set.perVolume;
  restack();
}

function restack() {
  stacks = floorStacks(set, massing);
  active = Math.min(active, stacks.length - 1);
  fillInputs();
  render();
}

function fillInputs() {
  const c = cfg();
  $('count').value = c.count;
  $('typical').value = c.typical;
  $('first').value = c.first;
  $('second').value = c.second;
}

const num = (el, min = 0.1) => {
  const v = parseFloat(el.value);
  return Number.isFinite(v) && v >= min ? v : null;
};

// Keep the floor count within what fits under the stack's height
function setCount(v) {
  const max = maxCount(cfg(), cur().height);
  cfg().count = Math.max(1, Math.min(v, max, MAX_FLOORS));
  if (v > max) notice = `Only ${max} floors fit in ${fmt(cur().height)} FT at these heights.`;
  $('count').value = cfg().count;
}

function save() {
  setCount(cfg().count); // heights may have changed what fits
  for (const k of Object.keys(cfg().custom)) if (+k >= cfg().count) delete cfg().custom[k];
  storageSet(floorsKey(info.id), set);
  render();
}

// ---------- Inputs ----------

$('perVol').addEventListener('change', () => {
  set.perVolume = $('perVol').checked;
  active = 0;
  storageSet(floorsKey(info.id), set);
  restack();
});

for (const id of ['typical', 'first', 'second']) {
  $(id).addEventListener('input', () => {
    const v = num($(id));
    if (v == null) return;
    cfg()[id] = v;
    save();
  });
}
$('count').addEventListener('change', () => {
  const v = Math.round(num($('count'), 1) ?? 0);
  if (v >= 1) setCount(v);
  save();
});
document.querySelectorAll('[data-step]').forEach(b =>
  b.addEventListener('click', () => {
    setCount(cfg().count + +b.dataset.step);
    save();
  })
);
$('fitBtn').addEventListener('click', () => {
  setCount(MAX_FLOORS);
  notice = '';
  save();
});

// ---------- Custom floors: one row per customized floor, plus an empty row for the next ----------

function renderCustomRows(focusNew = false) {
  const c = cfg();
  const entries = Object.entries(c.custom).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
  const used = new Set(entries.map(e => e[0]));
  let next = Math.max(3, ...entries.map(e => e[0] + 1));
  while (used.has(next)) next++;
  const rows = entries.map(([n, h]) => customRow(n, h));
  if (next < c.count) rows.push(customRow(null, null, next));
  else if (!entries.length) rows.push(Object.assign(document.createElement('p'), { className: 'f-note', textContent: 'Add more floors to customize one — the top floor always takes the leftover height.' }));
  $('customRows').replaceChildren(...rows);
  if (focusNew) $('customRows').querySelector('.f-crow.new input[data-k="h"]')?.focus();
}

function customRow(n, h, suggest) {
  const row = document.createElement('div');
  row.className = 'f-crow' + (n == null ? ' new' : '');
  row.innerHTML = `
    <label class="f-field">FLOOR NO. <input type="number" data-k="n" min="1" step="1"></label>
    <label class="f-field">HEIGHT <span class="f-unit"><input type="number" data-k="h" min="1" step="0.5"> FT</span></label>
    ${n == null ? '<span class="f-hint">Type a height to customize this floor</span>' : '<button type="button" class="link">Remove</button>'}`;
  const [fi, hi] = row.querySelectorAll('input');
  fi.value = n ?? suggest;
  if (h != null) hi.value = h;
  row.querySelector('button')?.addEventListener('click', () => {
    delete cfg().custom[n];
    save();
  });
  const commit = () => {
    const nn = Math.round(num(fi, 1) ?? 0);
    const hh = num(hi);
    if (nn < 1 || hh == null) return;
    const c = cfg();
    if (nn >= c.count) {
      notice = nn === c.count
        ? `The ${ordinal(nn)} floor is the top floor — it always takes the leftover height.`
        : `There are only ${c.count} floors.`;
      return render();
    }
    if (n != null && n !== nn) delete c.custom[n];
    if (nn === 1) { c.first = hh; $('first').value = hh; }
    else if (nn === 2) { c.second = hh; $('second').value = hh; }
    else c.custom[nn] = hh;
    save();
    if (n == null) renderCustomRows(true);
  };
  fi.addEventListener('change', commit);
  hi.addEventListener('change', commit);
  return row;
}

// ---------- Output ----------

function render() {
  const st = cur();
  const c = cfg();
  const hs = floorHeights(c, st.height);

  // Volume tabs
  $('volTabs').hidden = stacks.length < 2;
  $('volTabs').replaceChildren(...(stacks.length < 2 ? [] : stacks.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === active ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === active);
    b.textContent = `VOLUME ${i + 1} · ${fmt(s.height)}′ · ${plural(s.cfg.count, 'FLOOR')}`;
    b.addEventListener('click', () => {
      active = i;
      fillInputs();
      render();
    });
    return b;
  })));
  $('volName').textContent = st.volume == null ? '' : `· Volume ${st.volume + 1}`;

  renderCustomRows();

  // Top floor absorbs the difference to the height
  const where = st.volume == null ? 'Massing' : `Volume ${st.volume + 1}`;
  const msg = c.count === 1
    ? `One floor fills the whole ${fmt(st.height)} FT.`
    : `${where} is ${fmt(st.height)} FT tall · the top floor (${ordinal(c.count)}) is ${fmt(hs[hs.length - 1])} FT to make up the difference.`;
  $('fitNote').textContent = notice || msg;
  $('fitNote').classList.toggle('warn', !!notice);
  notice = '';

  const desc = stacks.map((s, i) => (stacks.length > 1 ? `V${i + 1} ` : '') + plural(s.cfg.count, 'FLOOR')).join(' · ');
  $('total').textContent = `${desc} · ${fmt(massing.bounds.max.y)} FT`;
  $('summary').textContent = `${info.name.toUpperCase()} · ${desc}`;
  drawElevations();
}

function drawElevations() {
  // One common scale: the largest dimension fills a grid column
  const colPx = Math.max(160, Math.floor(($('elevations').clientWidth - 24) / 2));
  const views = elev.render(floorLineGroups(set, massing), stacks.length > 1 ? cur().volume : null, Math.min(colPx, 420));
  $('elevations').replaceChildren(...views.map(v => {
    const fig = document.createElement('figure');
    fig.className = 'f-elev';
    const img = new Image(v.width, v.height);
    img.src = v.url;
    img.alt = `${v.label} elevation`;
    const cap = document.createElement('figcaption');
    cap.textContent = `${v.label} elevation`;
    fig.append(img, cap);
    return fig;
  }));
}
