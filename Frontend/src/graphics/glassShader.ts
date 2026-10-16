export const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Analytic sphere: Fresnel reflection, refracted studio light and Beer–Lambert
// absorption create smoked glass without external textures or model downloads.
export const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uPointer;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSelected;

  float softbox(vec2 p, vec2 center, vec2 size, float softness) {
    vec2 distance = abs(p - center) - size;
    return 1.0 - smoothstep(-softness, softness, max(distance.x, distance.y));
  }

  vec3 studio(vec3 ray) {
    vec3 light = vec3(0.004);
    vec2 projected = ray.xy / max(ray.z, 0.18);
    float front = smoothstep(0.0, 0.2, ray.z);
    float upper = softbox(projected, vec2(-0.65, 0.95), vec2(0.5, 0.3), 0.055) * front;
    float strip = softbox(projected, vec2(1.4, 0.18), vec2(0.045, 0.85), 0.025) * front;
    float ceiling = smoothstep(0.5, 0.95, ray.y) * 0.055;
    light += vec3(1.0, 1.015, 1.035) * upper * 2.3;
    light += vec3(0.92, 0.96, 1.0) * strip * 1.5;
    light += ceiling;
    return light;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float radius = 0.94;
    float r2 = dot(p, p) / (radius * radius);
    float edge = fwidth(r2) * 1.2;
    float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, r2);
    if (alpha < 0.001) discard;

    vec3 normal = normalize(vec3(p / radius, sqrt(max(0.0, 1.0 - r2))));
    vec3 view = normalize(vec3(uPointer * 0.12, 3.8));
    vec3 reflected = reflect(-view, normal);
    reflected.xy += uPointer * 0.07;
    reflected.y += sin(uTime * 0.23) * 0.015;

    float facing = max(dot(normal, view), 0.0);
    float fresnel = 0.055 + 0.945 * pow(1.0 - facing, 5.0);
    vec3 refraction = refract(-view, normal, 1.0 / 1.48);
    float thickness = 2.0 * normal.z;
    vec3 absorption = exp(-vec3(3.7, 3.65, 3.55) * thickness);
    vec3 transmitted = studio(refraction) * absorption * 0.28;
    vec3 reflection = studio(reflected) * (0.33 + fresnel * 0.67);

    // An inner crescent makes the thickness of the glass visible at its edge.
    float rim = pow(1.0 - normal.z, 3.0);
    float rimLight = max(dot(normal, normalize(vec3(-0.7, 0.9, 0.3))), 0.0);
    vec3 color = vec3(0.0015, 0.0017, 0.002) + transmitted + reflection;
    color += vec3(0.13, 0.145, 0.17) * rim * rimLight;
    color += uSelected * vec3(0.008);
    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));
    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`
