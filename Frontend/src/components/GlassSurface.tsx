import { useEffect, useRef } from 'react'
import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three'

const fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform vec2 uPointer;
uniform vec2 uSize;
uniform float uTime;
uniform float uDark;
uniform float uCircular;
void main() {
  vec2 p = (vUv - .5) * uSize;
  float distance;
  if (uCircular > .5) {
    distance = length(p) - (min(uSize.x, uSize.y) * .5 - 2.);
  } else {
    vec2 q = abs(p) - (uSize * .5 - vec2(24.));
    distance = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - 24.;
  }
  float edge = 1. - smoothstep(-1.5, .5, distance);
  float bevel = exp(-abs(distance + 3.) * .13);
  vec2 light = vec2(.22, .86) + uPointer * .15;
  float glow = exp(-length(vUv - light) * 3.8);
  float reflection = pow(max(0., 1. - abs(vUv.x * .65 + vUv.y - .78 + sin(uTime * .3) * .025)), 24.);
  float bottom = exp(-length(vUv - vec2(.95, .12)) * 5.);
  vec3 base = mix(vec3(.71, .73, .76), vec3(.04, .05, .07), uDark);
  vec3 highlight = mix(vec3(.97, .98, 1.), vec3(.62, .65, .72), uDark);
  vec3 glass = mix(base, highlight, glow);
  glass += bevel * mix(.13, .11, uDark) + reflection * mix(.12, .18, uDark) + bottom * mix(.08, .05, uDark);
  gl_FragColor = vec4(glass, edge * mix(.8, .9, uDark));
}`

export function GlassSurface({ variant = 'light', shape = 'card' }: { variant?: 'light' | 'dark'; shape?: 'card' | 'circle' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dark = variant === 'dark' ? 1 : 0
  const circular = shape === 'circle' ? 1 : 0
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    const material = new ShaderMaterial({
      transparent: true,
      uniforms: {
        uPointer: { value: new Vector2() },
        uSize: { value: new Vector2(200, 300) },
        uTime: { value: 0 },
        uDark: { value: dark },
        uCircular: { value: circular },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }',
      fragmentShader,
    })
    const geometry = new PlaneGeometry(2, 2)
    const scene = new Scene()
    scene.add(new Mesh(geometry, material))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, last = 0, visible = true, lost = false
    const draw = (time = 0) => {
      frame = 0
      if (!visible || document.hidden || lost) return
      if (time - last > 33 || motion.matches) { material.uniforms.uTime.value = time / 1000; renderer.render(scene, camera); last = time }
      if (!motion.matches) frame = requestAnimationFrame(draw)
    }
    const resume = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
    const resize = new ResizeObserver(([entry]) => { const { width, height } = entry.contentRect; renderer.setSize(width, height, false); material.uniforms.uSize.value.set(width, height); resume() })
    resize.observe(canvas)
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume() })
    observer.observe(canvas)
    const parent = canvas.parentElement!
    const move = (event: PointerEvent) => { const box = parent.getBoundingClientRect(); material.uniforms.uPointer.value.set((event.clientX - box.left) / box.width - .5, .5 - (event.clientY - box.top) / box.height); if (motion.matches) resume() }
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); canvas.style.opacity = '0' }
    const contextRestored = () => { lost = false; canvas.style.opacity = '1'; resume() }
    parent.addEventListener('pointermove', move)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', contextRestored)
    document.addEventListener('visibilitychange', resume)
    motion.addEventListener('change', resume)
    resume()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); parent.removeEventListener('pointermove', move); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored); document.removeEventListener('visibilitychange', resume); motion.removeEventListener('change', resume); geometry.dispose(); material.dispose(); renderer.dispose() }
  }, [dark, circular])
  return <canvas ref={ref} className="glass-surface" aria-hidden="true" />
}
