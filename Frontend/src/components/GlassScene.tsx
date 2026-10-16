import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Vector2, WebGLRenderer,
} from 'three'
import { fragmentShader, vertexShader } from '../graphics/glassShader'

interface GlassSceneProps {
  stageRef: RefObject<HTMLElement | null>
}

export function GlassScene({ stageRef }: GlassSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    } catch {
      // The CSS glass remains selectable when WebGL is unavailable.
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0xffffff, 0)
    const scene = new Scene()
    const camera = new OrthographicCamera(0, 1, 1, 0, -1, 1)
    const geometry = new PlaneGeometry(1, 1)
    function createOrb(button: HTMLButtonElement) {
      const material = new ShaderMaterial({
        vertexShader, fragmentShader, transparent: true, depthWrite: false,
        uniforms: {
          uPointer: { value: new Vector2() }, uTime: { value: 0 },
          uOpacity: { value: 0 }, uSelected: { value: 0 },
        },
      })
      const mesh = new Mesh(geometry, material)
      scene.add(mesh)
      return { button, surface: button.querySelector<HTMLElement>('.orb-surface')!, material, mesh }
    }
    let orbs: ReturnType<typeof createOrb>[] = []

    function syncOrbs() {
      if (!stage) return
      const buttons = Array.from(stage.querySelectorAll<HTMLButtonElement>('.orb-choice'))
      const retained = new Map(orbs.map((orb) => [orb.button, orb]))
      for (const orb of orbs) {
        if (!buttons.includes(orb.button)) {
          scene.remove(orb.mesh)
          orb.material.dispose()
        }
      }
      orbs = buttons.map((button) => retained.get(button) ?? createOrb(button))
      if (!orbs.length) stage.classList.remove('webgl-ready')
    }

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let disposed = false
    let contextLost = false
    let lastTime = 0
    const started = performance.now()

    function resize() {
      if (!stage) return
      const { width, height } = stage.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.right = width
      camera.top = height
      camera.updateProjectionMatrix()
    }

    function render(now: number) {
      if (disposed || contextLost || document.hidden || !stage) return
      // Cap continuous rendering at 30fps; CSS handles the smooth interaction.
      if (now - lastTime >= 1000 / 30 || motion.matches) {
        lastTime = now
        const stageRect = stage.getBoundingClientRect()
        for (const { button, surface, material, mesh } of orbs) {
          const rect = surface.getBoundingClientRect()
          mesh.position.set(rect.left - stageRect.left + rect.width / 2, stageRect.height - (rect.top - stageRect.top + rect.height / 2), 0)
          mesh.scale.set(rect.width, rect.height, 1)
          material.uniforms.uOpacity.value = Number(getComputedStyle(button).opacity)
          material.uniforms.uTime.value = motion.matches ? 0 : (now - started) / 1000
          const target = new Vector2(Number(button.dataset.pointerX ?? 0), Number(button.dataset.pointerY ?? 0))
          material.uniforms.uPointer.value.lerp(target, motion.matches ? 1 : 0.12)
          material.uniforms.uSelected.value = button.getAttribute('aria-checked') === 'true' ? 1 : 0
        }
        renderer.render(scene, camera)
        stage.classList.toggle('webgl-ready', orbs.length > 0)
      }
      // Reduced-motion users get event-driven redraws with no idle GPU loop.
      if (!motion.matches && orbs.length) frame = requestAnimationFrame(render)
    }

    function redraw() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(render)
    }

    function visibilityChanged() {
      cancelAnimationFrame(frame)
      if (!document.hidden) redraw()
    }

    function lost(event: Event) {
      event.preventDefault()
      contextLost = true
      cancelAnimationFrame(frame)
      stage?.classList.remove('webgl-ready')
    }

    function restored() {
      contextLost = false
      redraw()
    }

    const resizeObserver = new ResizeObserver(() => { resize(); redraw() })
    const stateObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) {
        syncOrbs()
        redraw()
      } else if (motion.matches) redraw()
    })
    resizeObserver.observe(stage)
    stateObserver.observe(stage, { childList: true, attributes: true, subtree: true, attributeFilter: ['aria-checked', 'data-pointer-x', 'data-pointer-y'] })
    document.addEventListener('visibilitychange', visibilityChanged)
    stage.addEventListener('focusin', redraw)
    stage.addEventListener('focusout', redraw)
    motion.addEventListener('change', redraw)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    syncOrbs()
    resize()
    redraw()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      stateObserver.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      stage.removeEventListener('focusin', redraw)
      stage.removeEventListener('focusout', redraw)
      motion.removeEventListener('change', redraw)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      stage.classList.remove('webgl-ready')
      orbs.forEach(({ material }) => material.dispose())
      geometry.dispose()
      renderer.dispose()
    }
  }, [stageRef])

  return <canvas className="glass-canvas" ref={canvasRef} aria-hidden="true" />
}
