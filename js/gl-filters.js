// gl-filters.js — hardware-accelerated tonal pipeline (Layer 1 / Base Canvas)
// Renders the reference image through a single fragment shader that handles
// grayscale, brightness/contrast, posterization, threshold silhouette,
// inversion, an approximate "squint" blur, and a Sobel-based pen-art mode.

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_texel;

uniform bool  u_grayscale;
uniform int   u_posterizeLevels;
uniform float u_threshold;   // 0.0 disabled, else 0..1
uniform bool  u_invert;
uniform float u_brightness;  // -1..1
uniform float u_contrast;    // -1..1
uniform float u_blur;        // texel radius, 0 = off
uniform bool  u_penArt;
uniform float u_penStrength;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 sampleBlurred(vec2 uv, float radius) {
  if (radius <= 0.0001) return texture2D(u_image, uv).rgb;
  vec3 sum = texture2D(u_image, uv).rgb;
  float total = 1.0;
  const int TAPS = 12;
  for (int i = 0; i < TAPS; i++) {
    float ang = (float(i) / float(TAPS)) * 6.28318530718;
    for (int ring = 1; ring <= 3; ring++) {
      float dist = radius * (float(ring) / 3.0);
      vec2 off = vec2(cos(ang), sin(ang)) * u_texel * dist;
      float w = 1.0 / float(ring);
      sum += texture2D(u_image, uv + off).rgb * w;
      total += w;
    }
  }
  return sum / total;
}

void main() {
  vec3 rgb = sampleBlurred(v_uv, u_blur);

  if (u_penArt) {
    // Sobel edge detection on luminance for a sketchy ink-line study
    float tl = luma(texture2D(u_image, v_uv + u_texel * vec2(-1.0,-1.0)).rgb);
    float t  = luma(texture2D(u_image, v_uv + u_texel * vec2( 0.0,-1.0)).rgb);
    float tr = luma(texture2D(u_image, v_uv + u_texel * vec2( 1.0,-1.0)).rgb);
    float l  = luma(texture2D(u_image, v_uv + u_texel * vec2(-1.0, 0.0)).rgb);
    float r  = luma(texture2D(u_image, v_uv + u_texel * vec2( 1.0, 0.0)).rgb);
    float bl = luma(texture2D(u_image, v_uv + u_texel * vec2(-1.0, 1.0)).rgb);
    float b  = luma(texture2D(u_image, v_uv + u_texel * vec2( 0.0, 1.0)).rgb);
    float br = luma(texture2D(u_image, v_uv + u_texel * vec2( 1.0, 1.0)).rgb);
    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
    float edge = clamp(sqrt(gx*gx + gy*gy) * u_penStrength, 0.0, 1.0);
    float ink = 1.0 - edge;
    gl_FragColor = vec4(vec3(ink), 1.0);
    return;
  }

  rgb += u_brightness;
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;

  float l = luma(rgb);
  if (u_grayscale) rgb = vec3(l);

  if (u_threshold > 0.0) {
    float bin = step(u_threshold, l);
    rgb = vec3(bin);
  } else if (u_posterizeLevels > 1) {
    float steps = float(u_posterizeLevels);
    rgb = floor(rgb * steps + 0.5) / steps;
  }

  if (u_invert) rgb = vec3(1.0) - rgb;

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shader compile error: " + log);
  }
  return sh;
}

export class GLFilterPipeline {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false }) ||
               canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL is not available in this browser");
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.uniforms = {};
    ["u_image","u_texel","u_grayscale","u_posterizeLevels","u_threshold","u_invert",
     "u_brightness","u_contrast","u_blur","u_penArt","u_penStrength"].forEach(name => {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    });

    this.imgW = 0; this.imgH = 0;
  }

  setImageSource(source, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.imgW = w; this.imgH = h;
  }

  render(size, filters) {
    const gl = this.gl;
    const { width, height } = size;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.u_image, 0);
    gl.uniform2f(this.uniforms.u_texel, this.imgW ? 1 / this.imgW : 0, this.imgH ? 1 / this.imgH : 0);

    gl.uniform1i(this.uniforms.u_grayscale, filters.grayscale ? 1 : 0);
    gl.uniform1i(this.uniforms.u_posterizeLevels, filters.posterizeLevels | 0);
    gl.uniform1f(this.uniforms.u_threshold, filters.thresholdValue > 0 ? filters.thresholdValue / 255 : 0);
    gl.uniform1i(this.uniforms.u_invert, filters.invert ? 1 : 0);
    gl.uniform1f(this.uniforms.u_brightness, (filters.brightness || 0) / 100);
    gl.uniform1f(this.uniforms.u_contrast, (filters.contrast || 0) / 100);
    gl.uniform1f(this.uniforms.u_blur, filters.blurRadius || 0);
    gl.uniform1i(this.uniforms.u_penArt, filters.penArt ? 1 : 0);
    gl.uniform1f(this.uniforms.u_penStrength, 6.0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
