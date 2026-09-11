// Geometry for two separate, opposing arc ribbons. Eight cubic nodes per contour.
const add = (a, b) => a.map((v, i) => v + b[i]);
const polar = (center, radius, angle) => add(center, [radius * Math.cos(angle), radius * Math.sin(angle)]);
const rad = degrees => degrees * Math.PI / 180;
function arc(center, radius, from, to) {
  const a = rad(from), b = rad(to), handle = 4 / 3 * Math.tan((b - a) / 4) * radius;
  const start = polar(center, radius, a), end = polar(center, radius, b);
  return [start, add(start, [-Math.sin(a) * handle, Math.cos(a) * handle]),
    add(end, [Math.sin(b) * handle, -Math.cos(b) * handle]), end];
}
// Two quarter-circle corners and a straight cap match the pause topology.
function roundedCap(center, halfWidth, cornerRadius, angle, direction) {
  const a = rad(angle), normal = [Math.cos(a), Math.sin(a)];
  const tangent = [-Math.sin(a) * direction, Math.cos(a) * direction];
  const point = (x, y) => add(center, normal.map((v, i) => v * x + tangent[i] * y));
  const k = 0.5522847498;
  const right = halfWidth - cornerRadius, left = -right;
  return [
    [point(halfWidth, 0), point(halfWidth, cornerRadius * k), point(right + cornerRadius * k, cornerRadius), point(right, cornerRadius)],
    [point(right, cornerRadius), point(right, cornerRadius), point(left, cornerRadius), point(left, cornerRadius)],
    [point(left, cornerRadius), point(left - cornerRadius * k, cornerRadius), point(-halfWidth, cornerRadius * k), point(-halfWidth, 0)],
  ];
}
function ribbon(center, radius, halfWidth, start, end, cornerRadius) {
  const direction = Math.sign(end - start);
  const capStart = polar(center, radius, rad(start)), capEnd = polar(center, radius, rad(end));
  const segments = [
    arc(center, radius + halfWidth, start, end),
    ...roundedCap(capEnd, halfWidth, cornerRadius, end, direction),
    arc(center, radius - halfWidth, end, start),
    ...roundedCap(capStart, halfWidth, cornerRadius, start + direction * 180, direction),
  ];
  // vertex, incoming handle, outgoing handle — absolute coordinates.
  return segments.flatMap((segment, i) => [...segment[0], ...segments[(i + 7) % 8][2], ...segment[1]]);
}
function reordered(points, shift) {
  // Reverse winding to match the original pause leg; then choose its first node.
  return Array.from({ length: 8 }, (_, i) => {
    const j = ((shift - i) % 8 + 8) % 8, at = j * 6;
    return [...points.slice(at, at + 2), ...points.slice(at + 4, at + 6), ...points.slice(at + 2, at + 4)];
  }).flat();
}
export function mix(a, b, t) { return a.map((path, i) => path.map((v, j) => v + (b[i][j] - v) * t)); }
export function rotate(paths, center, degrees) {
  const a = rad(degrees), cos = Math.cos(a), sin = Math.sin(a);
  return paths.map(path => path.map((_, i) => {
    const at = i - i % 2, x = path[at] - center[0], y = path[at + 1] - center[1];
    return i % 2 ? center[1] + x * sin + y * cos : center[0] + x * cos - y * sin;
  }));
}
export function loaderGeometry(play, pause) {
  const xs = pause.flatMap(path => Array.from({ length: 8 }, (_, i) => path[i * 6]));
  const ys = pause.flatMap(path => Array.from({ length: 8 }, (_, i) => path[i * 6 + 1]));
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const legXs = Array.from({ length: 8 }, (_, i) => pause[0][i * 6]);
  const legWidth = Math.max(...legXs) - Math.min(...legXs);
  const thickness = legWidth / 2, radius = (Math.max(...ys) - Math.min(...ys)) / 2 - thickness / 2;
  // Match the pause corner-to-width proportion at the spinner's half thickness.
  const uniqueXs = [...new Set(legXs)].sort((a, b) => a - b);
  const cornerRadius = Math.min(thickness / 2, (uniqueXs[1] - uniqueXs[0]) * thickness / legWidth + 1.21875);
  // Two 93.5° arcs (15% shorter); rounded ends leave matching visible gaps above and below.
  const candidates = [ribbon(center, radius, thickness / 2, 133.25, 226.75, cornerRadius), ribbon(center, radius, thickness / 2, 46.75, -46.75, cornerRadius)];
  // Share node correspondence so both halves unfold as mirror images.
  let best = 0, min = Infinity;
  for (let shift = 0; shift < 8; shift++) {
    const score = candidates.reduce((total, candidate, index) => total +
      reordered(candidate, shift).reduce((sum, v, i) => sum + (v - pause[index][i]) ** 2, 0), 0);
    if (score < min) { min = score; best = shift; }
  }
  const shifts = [best, best];
  const spinner = candidates.map((p, i) => reordered(p, shifts[i]));
  return { spinner, center, thickness, legWidth, radius, cornerRadius, shifts };
}
