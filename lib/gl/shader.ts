export const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * One "uber" shader for every poster. u_mode picks the style family, the five
 * palette stops arrive both as linear sRGB (for additive light) and OkLab (for
 * gradient blending without muddy midtones).
 */
export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 u_res;
/** Poster width / height. Render targets can be anisotropic (e.g. strips), so u_res can't be used. */
uniform float u_aspect;
uniform float u_time;
uniform float u_seed;
uniform int u_mode;
uniform vec3 u_lin[5];
uniform vec3 u_lab[5];
uniform float u_grain;

out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

const mat2 OCTAVE = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p, int octaves) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p = OCTAVE * p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return sum;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  float f = smoothstep(0.0, 1.0, t - float(i));
  return oklabToLinear(mix(u_lab[i], u_lab[i + 1], f));
}

// Slowly drifting colour fields, blended in OkLab.
vec3 meshGradient(vec2 p, float t) {
  vec2 warp = vec2(
    snoise(p * 0.9 + vec2(u_seed, t * 0.05)),
    snoise(p * 0.9 + vec2(t * 0.045, u_seed * 1.3))
  );
  vec2 q = p + warp * 0.24;
  vec3 acc = vec3(0.0);
  float total = 0.0;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    vec2 centre = vec2(
      0.82 * sin(t * (0.11 + 0.023 * fk) + fk * 2.4 + u_seed),
      0.46 * cos(t * (0.09 + 0.019 * fk) + fk * 1.7 + u_seed * 0.37)
    );
    vec2 d = q - centre;
    // Shepard weights keep each colour field distinct instead of averaging to one tone.
    float w = 1.0 / pow(dot(d, d) + 0.015, 1.7);
    acc += w * u_lab[k];
    total += w;
  }
  vec3 lab = acc / max(total, 1e-5);
  lab.x += 0.035 * snoise(q * 1.8 - t * 0.06);
  lab.yz *= 1.1;
  vec3 col = oklabToLinear(lab);
  float sheen = smoothstep(0.2, 1.0, snoise(q * 0.7 + vec2(t * 0.035, -t * 0.03) + 3.0));
  return col * (0.94 + 0.12 * sheen) + sheen * 0.05;
}

// Thin curtains of light with vertical rays over a starry sky.
vec3 aurora(vec2 uv, vec2 p, float t) {
  vec3 col = mix(u_lin[1], u_lin[0], smoothstep(-0.15, 1.0, uv.y));
  // Stars live on a grid of 2-poster-pixel cells, drawn as soft dots so they never alias.
  vec2 starGrid = uv * vec2(u_aspect, 1.0) * 130.0;
  vec2 cell = floor(starGrid);
  float star = step(0.9962, hash12(cell + u_seed * 17.0))
    * smoothstep(0.5, 0.12, length(fract(starGrid) - 0.5));
  col += star * 0.4 * (0.7 + 0.3 * sin(t * 0.9 + hash12(cell) * 40.0));
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float x = p.x;
    float edge = -0.24 + 0.15 * fk
      + 0.11 * sin(x * 1.25 + t * 0.11 + fk * 2.1 + u_seed)
      + 0.045 * sin(x * 3.1 - t * 0.09 + fk * 1.7)
      + 0.035 * snoise(vec2(x * 1.6 + fk * 7.0, t * 0.05 + fk * 3.0));
    float d = p.y - edge;
    float height = 0.17 + 0.07 * fk;
    float curtain = smoothstep(-0.018, 0.012, d) * exp(-max(d, 0.0) / height * 2.2);
    float rays = snoise(vec2(x * 15.0 + fk * 31.0 - t * 0.06, t * 0.18 + fk * 4.0)) * 0.5 + 0.5;
    rays = 0.25 + 0.75 * rays * rays;
    float reach = 0.35 + 0.65 * smoothstep(-0.6, 0.5, snoise(vec2(x * 0.9 - t * 0.04, fk * 9.0 + u_seed)));
    vec3 tint = mix(u_lin[2 + k], u_lin[2 + int(mod(fk + 1.0, 3.0))], smoothstep(0.0, height * 1.4, d));
    col += tint * curtain * rays * reach * (1.35 - 0.22 * fk);
  }
  col += u_lin[2] * 0.06 * exp(-uv.y * 5.0);
  return col;
}

float neonCurve(float x, float t, float k) {
  return 0.23 * sin(x * 1.35 + t * 0.31 + k * 1.9 + u_seed)
    + 0.1 * sin(x * 2.9 - t * 0.24 + k * 3.7)
    + 0.045 * sin(x * 5.3 + t * 0.38 + k * 0.7);
}

// Glowing tubes of light drifting through a dark haze.
vec3 liquidNeon(vec2 p, float t) {
  float haze = fbm(p * 1.4 + vec2(t * 0.035, u_seed), 3);
  vec3 col = mix(u_lin[0], u_lin[1], smoothstep(-0.7, 0.9, p.y + 0.35 * haze));
  col *= 0.8 + 0.4 * haze;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float y0 = (fk - 1.5) * 0.16 + neonCurve(p.x, t, fk);
    float slope = (neonCurve(p.x + 0.01, t, fk) - neonCurve(p.x - 0.01, t, fk)) / 0.02;
    float d = abs(p.y - y0) / sqrt(1.0 + slope * slope);
    vec3 c = u_lin[2 + int(mod(fk, 3.0))];
    // At least ~1.3 render pixels wide, so the bright core doesn't crawl as it drifts.
    float coreWidth = max(0.0055, 1.3 / u_res.y);
    float core = exp(-pow(d / coreWidth, 2.0));
    float halo = exp(-d / 0.05);
    float bloom = 1.0 / (1.0 + pow(d / 0.016, 2.0));
    col += c * (0.34 * halo + 0.55 * bloom) + mix(c, vec3(1.0), 0.65) * core * 1.4;
  }
  return col;
}

// Soft, slightly posterised sky bands and a low sun.
vec3 sunsetBands(vec2 uv, vec2 p, float t) {
  float wave = 0.018 * sin(p.x * 3.4 + t * 0.3 + u_seed) + 0.012 * snoise(vec2(p.x * 2.0, t * 0.07));
  float y = clamp(1.0 - uv.y + wave * (0.3 + uv.y), 0.0, 1.0);
  float n = 7.0;
  float b = y * n;
  float stepped = (floor(b) + smoothstep(0.3, 0.7, fract(b))) / n;
  vec3 col = ramp(mix(y, stepped, 0.5));
  vec2 sun = vec2(0.22 * sin(t * 0.04 + u_seed), -0.15 + 0.02 * sin(t * 0.1));
  float sd = length((p - sun) * vec2(1.0, 1.04));
  float edge = max(0.004, 1.2 / u_res.y);
  float disc = smoothstep(0.184 + edge, 0.184 - edge, sd);
  col = mix(col, u_lin[4] * 1.1 + 0.04, disc);
  col += u_lin[4] * exp(-sd * 3.4) * 0.4 + u_lin[3] * exp(-sd * 1.5) * 0.16;
  return col;
}

float chromeHeight(vec2 p, float t) {
  return fbm(p * 0.55 + vec2(t * 0.03, -t * 0.024) + u_seed, 3)
    + 0.3 * sin(p.x * 1.4 + p.y * 0.8 + t * 0.15);
}

// Liquid metal reflecting a soft studio, with thin-film colour where it turns away.
vec3 liquidChrome(vec2 p, float t) {
  float e = 0.004;
  float h = chromeHeight(p, t);
  vec2 grad = vec2(chromeHeight(p + vec2(e, 0.0), t) - h, chromeHeight(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-grad * 0.24, 1.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  vec3 env = mix(mix(u_lin[1], u_lin[0], 0.35), u_lin[0], smoothstep(-0.45, 0.45, r.y));
  env = mix(u_lin[1], env, smoothstep(-0.62, -0.28, r.y));
  // The horizon reflection narrows on steep slopes; keep it wider than a pixel there.
  float horizon = max(0.05, fwidth(r.y) * 1.5);
  env += vec3(0.9) * smoothstep(horizon, 0.0, abs(r.y - 0.16));
  env += vec3(1.1) * pow(max(dot(r, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 14.0);
  float grazing = clamp(1.0 - n.z, 0.0, 1.0);
  vec3 film = 0.5 + 0.5 * cos(6.28318 * (grazing * 2.6 + h * 0.5 + vec3(0.0, 0.33, 0.67)));
  vec3 tint = mix(mix(u_lin[2], u_lin[3], 0.5 + 0.5 * sin(h * 2.6 + t * 0.12)), u_lin[4], 0.5 + 0.5 * p.y);
  vec3 col = env * mix(vec3(1.0), film * tint * 1.5, smoothstep(0.01, 0.16, grazing) * 0.8);
  return max(col, 0.0);
}

// Ribbed holographic foil: wavy bands whose colour shifts like thin film.
vec3 holoWaves(vec2 p, float t) {
  float w = p.y
    + 0.11 * sin(p.x * 2.2 + t * 0.22 + u_seed)
    + 0.05 * sin(p.x * 4.3 - t * 0.17)
    + 0.07 * snoise(p * 0.75 + vec2(t * 0.035, u_seed));
  float bands = w * 6.5;
  float ridge = sin(fract(bands) * 3.14159);
  // Colour follows the continuous band phase, so band edges never step or crawl.
  vec3 film = 0.5 + 0.5 * cos(6.28318 * (bands * 0.11 + w * 0.9 + p.x * 0.25 + t * 0.03 + vec3(0.0, 0.33, 0.67)));
  vec3 base = ramp(0.25 + 0.6 * (0.5 + 0.5 * sin(bands * 1.7 + u_seed)));
  vec3 col = mix(base, base * film * 1.7, 0.45) * (0.62 + 0.5 * ridge);
  col += u_lin[3] * pow(ridge, 6.0) * 0.3;
  return col;
}

float silkHeight(vec2 p, float t) {
  vec2 q = p + 0.22 * vec2(snoise(p * 0.65 + vec2(t * 0.03, u_seed)), snoise(p * 0.65 + vec2(u_seed, -t * 0.025)));
  return 0.62 * sin(q.x * 2.1 + q.y * 3.3 + t * 0.14) + 0.38 * sin(q.x * -1.4 + q.y * 2.2 - t * 0.1 + 1.3);
}

// Folded satin lit from the top left.
vec3 silk(vec2 p, float t) {
  float e = 0.004;
  float h = silkHeight(p, t);
  vec2 grad = vec2(silkHeight(p + vec2(e, 0.0), t) - h, silkHeight(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-grad * 0.42, 1.0));
  vec3 light = normalize(vec3(-0.5, 0.65, 0.58));
  float diffuse = clamp(dot(n, light), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);
  vec3 col = ramp(0.03 + 0.8 * smoothstep(0.15, 0.98, diffuse));
  col += u_lin[3] * spec * 0.55 + u_lin[4] * pow(spec, 3.0) * 0.55;
  return col;
}

// Slow domain-warped flow with glowing veins (molten metal, ink, bloom). Time never
// enters the warp chain (each stage multiplies any change ~10x, which made it churn);
// the warped structure only drifts rigidly and the top layer flows through it.
vec3 flowField(vec2 p, float t) {
  vec2 q = p * 0.72 + u_seed + vec2(t * 0.003, -t * 0.002);
  vec2 a = vec2(fbm(q, 3), fbm(q + vec2(5.2, 1.3), 3));
  vec2 b = vec2(
    fbm(q + 1.5 * a + vec2(1.7, 9.2), 3),
    fbm(q + 1.5 * a + vec2(8.3, 2.8), 3)
  );
  float f = fbm(q + 1.4 * b + vec2(t * 0.008, -t * 0.006), 3);
  vec3 col = ramp(smoothstep(-0.6, 0.62, f + 0.3 * a.x) * 0.82);
  // Veins widen where they'd fall under ~3 render pixels, so they glide instead of crawling.
  float veinWidth = max(0.625, fwidth(b.y) * 3.0);
  float vein = pow(clamp(1.0 - abs(b.y) / veinWidth, 0.0, 1.0), 9.0);
  col += u_lin[3] * vein * 0.35 + u_lin[4] * pow(vein, 3.0) * 0.6;
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
  // Reflections and thin bright lines read as fast motion; they run slower so every
  // poster drifts at a similar, calm pace.
  float t = u_time * (u_mode == 4 || u_mode == 2 ? 0.35 : 1.0);

  vec3 col;
  bool emissive = false;
  if (u_mode == 0) {
    col = meshGradient(p, t);
  } else if (u_mode == 1) {
    col = aurora(uv, p, t);
    emissive = true;
  } else if (u_mode == 2) {
    col = liquidNeon(p, t);
    emissive = true;
  } else if (u_mode == 3) {
    col = sunsetBands(uv, p, t);
  } else if (u_mode == 4) {
    col = liquidChrome(p, t);
  } else if (u_mode == 5) {
    col = silk(p, t);
  } else if (u_mode == 6) {
    col = flowField(p, t);
  } else {
    col = holoWaves(p, t);
  }

  if (emissive) {
    col = filmic(col * 1.05);
  }

  vec2 v = uv - 0.5;
  col *= 1.0 - 0.32 * dot(v, v);

  vec3 srgb = linearToSrgb(col);
  // Static print grain, one value per render pixel: it reads as paper texture and
  // dithers dark gradients without flickering (no time input, no cell quantisation).
  float grain = hash12(gl_FragCoord.xy + u_seed * 37.0)
    + hash12(gl_FragCoord.xy * 1.37 + u_seed * 11.0) - 1.0;
  srgb += grain * u_grain;

  fragColor = vec4(srgb, 1.0);
}`;
