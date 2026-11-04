// Procedural line-drawing patterns. One 256px tile = one facade module (pattern.w × pattern.h ft).
// Tiles are drawn light-on-dark, then inverted to dark lines on white to match the page.
const S = 256;
const cache = new Map();

export function patternCanvas(type) {
  if (!cache.has(type)) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    drawPattern(ctx, type);
    invert(ctx);
    cache.set(type, c);
  }
  return cache.get(type);
}

function invert(ctx) {
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
}

function drawPattern(ctx, type) {
  const poly = (fill, ...p) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
    ctx.fill();
  };
  const line = (w, ...p) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  };
  // Strokes on tile edges are half-clipped; the neighbouring tile draws the other half
  const frame = w => {
    ctx.lineWidth = w;
    ctx.strokeRect(0, 0, S, S);
  };
  const glint = () => {
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    line(2, 40, 220, 120, 140);
    line(2, 70, 230, 150, 150);
    ctx.strokeStyle = '#fff';
  };

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#fff';

  switch (type) {
    case 'faceted': {
      const a = 72, b = 184;
      poly('#3a3a3a', 0, 0, S, 0, b, a, a, a);
      poly('#1a1a1a', S, 0, S, S, b, b, b, a);
      poly('#0b0b0b', 0, S, S, S, b, b, a, b);
      poly('#272727', 0, 0, a, a, a, b, 0, S);
      line(3, 0, 0, a, a);
      line(3, S, 0, b, a);
      line(3, S, S, b, b);
      line(3, 0, S, a, b);
      ctx.lineWidth = 3;
      ctx.strokeRect(a, a, b - a, b - a);
      frame(8);
      break;
    }
    case 'grid':
      glint();
      frame(10);
      break;
    case 'spandrel':
      poly('#1e1e1e', 0, 176, S, 176, S, S, 0, S);
      glint();
      line(3, 0, 176, S, 176);
      frame(10);
      break;
    case 'punched':
      poly('#181818', 0, 0, S, 0, S, S, 0, S);
      poly('#000', 48, 56, 208, 56, 208, 184, 48, 184);
      ctx.lineWidth = 3;
      ctx.strokeRect(48, 56, 160, 128);
      line(2, 128, 56, 128, 184);
      frame(6);
      break;
    case 'panel':
      // running bond: joint at x=0 on the top course, x=128 on the bottom course
      line(6, 0, 0, S, 0);
      line(6, 0, S, S, S);
      line(4, 0, 128, S, 128);
      line(6, 0, 0, 0, 128);
      line(6, S, 0, S, 128);
      line(4, 128, 128, 128, S);
      break;
    case 'brick':
      // running bond, one brick long × two courses: head joint at x=0 on the top course, x=128 below.
      // Joints ~3/8" wide (18px of a 2 2/3" course) so the wall still reads as a brick tone when zoomed out.
      line(18, 0, 0, S, 0);
      line(18, 0, S, S, S);
      line(18, 0, 128, S, 128);
      line(18, 0, 0, 0, 128);
      line(18, S, 0, S, 128);
      line(18, 128, 128, 128, S);
      break;
    case 'ribbed':
      for (let x = 0; x < S; x += 32) poly('#262626', x, 0, x + 14, 0, x + 14, S, x, S);
      for (let x = 0; x <= S; x += 32) line(2, x, 0, x, S);
      break;
    case 'perforated':
      ctx.fillStyle = '#bdbdbd';
      for (let y = 16; y < S; y += 32)
        for (let x = 16; x < S; x += 32) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      frame(6);
      break;
    case 'fins':
      glint();
      poly('#2a2a2a', 0, 0, 30, 0, 30, S, 0, S);
      line(3, 30, 0, 30, S);
      line(8, 0, 0, 0, S);
      line(8, S, 0, S, S);
      line(4, 0, 0, S, 0);
      line(4, 0, S, S, S);
      break;
    case 'boards':
      for (let x = 0; x < S; x += 64) poly('#161616', x, 0, x + 32, 0, x + 32, S, x, S);
      for (let x = 0; x <= S; x += 32) line(2, x, 0, x, S);
      break;
    case 'render': {
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      poly('#121212', 0, 0, S, 0, S, S, 0, S);
      ctx.fillStyle = '#444';
      for (let i = 0; i < 500; i++) ctx.fillRect(rand() * S, rand() * S, 2, 2);
      frame(4);
      break;
    }
    default:
      frame(8);
  }
}

// Small preview tile for the library grid, drawn at real module proportions
export function drawSwatch(canvas, pattern) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  // feet shown across the swatch: ~12 ft for panel-sized modules, ~8 modules for small ones like brick
  const span = Math.max(Math.min(12, pattern.w * 8), pattern.w * 1.5, pattern.h * 1.5);
  const tw = (pattern.w / span) * W;
  const th = (pattern.h / span) * H;
  const tile = patternCanvas(pattern.type);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  for (let y = H; y > -th; y -= th) for (let x = 0; x < W; x += tw) ctx.drawImage(tile, x, y - th, tw, th);
}
