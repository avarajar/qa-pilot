import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

export type Box = { x: number; y: number; w: number; h: number }
export type DiffSummary = { pixels: number; percent: number; box: Box; zone: string }

// en el diff de Playwright lo rojo es lo que cambió y lo amarillo, suavizado de bordes que no cuenta
const isChanged = (r: number, g: number, b: number) => r > 200 && g < 80 && b < 80

function read(file: string): PNG | null {
  try {
    return PNG.sync.read(readFileSync(file))
  } catch {
    return null
  }
}

export function describeDiff(diffFile: string): DiffSummary | null {
  const img = read(diffFile)
  if (!img) return null
  const { width: w, height: h, data } = img
  let pixels = 0
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (!isChanged(data[i]!, data[i + 1]!, data[i + 2]!)) continue
      pixels++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (!pixels) return null
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  return { pixels, percent: Math.round((pixels / (w * h)) * 1000) / 10, box, zone: zoneName(box, w, h) }
}

const ZONES: Record<string, string> = {
  'arriba,izquierda': 'arriba a la izquierda', 'arriba,centro': 'arriba al centro', 'arriba,derecha': 'arriba a la derecha',
  'media,izquierda': 'a la izquierda, a media altura', 'media,centro': 'en el centro', 'media,derecha': 'a la derecha, a media altura',
  'abajo,izquierda': 'abajo a la izquierda', 'abajo,centro': 'abajo al centro', 'abajo,derecha': 'abajo a la derecha',
}

// dónde está la zona, en palabras, por la posición de su centro en tercios de la imagen
export function zoneName(box: Box, width: number, height: number): string {
  if (box.w / width > 0.8 && box.h / height > 0.8) return 'en casi toda la pantalla'
  const third = (c: number, size: number, names: [string, string, string]) => names[c < size / 3 ? 0 : c > (size * 2) / 3 ? 2 : 1]
  const v = third(box.y + box.h / 2, height, ['arriba', 'media', 'abajo'])
  const hz = third(box.x + box.w / 2, width, ['izquierda', 'centro', 'derecha'])
  return ZONES[`${v},${hz}`]!
}

const MARK = [220, 38, 38] as const

// copia de la captura nueva con un recuadro rojo alrededor de lo que cambió
export function markChange(actualFile: string, box: Box, outFile: string): boolean {
  const img = read(actualFile)
  if (!img) return false
  const { width: w, height: h, data } = img
  // el comentario muestra las capturas a ~220 px de ancho: el trazo crece con la imagen para que se siga viendo
  const stroke = Math.max(3, Math.round(w / 160))
  const margin = Math.max(6, Math.round(w / 100))
  const left = Math.max(0, box.x - margin), top = Math.max(0, box.y - margin)
  const right = Math.min(w - 1, box.x + box.w - 1 + margin), bottom = Math.min(h - 1, box.y + box.h - 1 + margin)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const edge = x < left + stroke || x > right - stroke || y < top + stroke || y > bottom - stroke
      if (edge) data.set(MARK, (y * w + x) * 4)
    }
  }
  writeFileSync(outFile, PNG.sync.write(img))
  return true
}

// lo que se ve en la página, con su posición en la captura de página completa
export type PageElement = { kind: string; label: string; box: Box }

const KINDS: Record<string, string> = {
  button: 'botón', a: 'enlace', input: 'campo', select: 'lista', textarea: 'campo de texto', img: 'imagen', svg: 'ícono',
  h1: 'título', h2: 'título', h3: 'título', h4: 'título', h5: 'título', h6: 'título',
  p: 'texto', span: 'texto', label: 'texto', li: 'fila', td: 'celda', th: 'celda', nav: 'menú', header: 'encabezado', footer: 'pie',
}
const MAX_LABEL = 40
const MAX_ELEMENTS = 5

const area = (b: Box) => b.w * b.h
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
const contains = (outer: Box, inner: Box) =>
  outer !== inner && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

// qué elementos caen en la zona que cambió: los que quedan adentro al menos a medias, sin sus contenedores
export function elementsInZone(elements: PageElement[], zone: Box): string[] {
  const hit = elements.filter(e => area(e.box) > 0 && overlap(e.box, zone) / area(e.box) >= 0.5)
  const leaves = hit.filter(e => !hit.some(o => contains(e.box, o.box)))
  const groups = new Map<string, number>()
  for (const e of leaves) {
    const text = e.label.replace(/\s+/g, ' ').trim()
    const label = text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text
    const key = `${KINDS[e.kind] ?? 'elemento'}${label ? ` «${label}»` : ''}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const names = [...groups].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
  return names.length > MAX_ELEMENTS ? [...names.slice(0, MAX_ELEMENTS), `y ${names.length - MAX_ELEMENTS} más`] : names
}

// corre en el navegador: elementos visibles con texto o rol, en coordenadas de la página completa
export function collectElements(): PageElement[] {
  const out: PageElement[] = []
  const selector = 'button,a,input,select,textarea,img,svg,h1,h2,h3,h4,h5,h6,p,span,label,li,td,th,nav,header,footer'
  for (const node of Array.from(document.querySelectorAll(selector))) {
    const r = node.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const style = getComputedStyle(node)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
    const h = node as HTMLElement
    const label = (h.innerText || h.getAttribute('aria-label') || h.getAttribute('alt') || h.getAttribute('placeholder') || (h as HTMLInputElement).value || '').trim()
    out.push({ kind: node.tagName.toLowerCase(), label, box: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } })
  }
  return out
}
