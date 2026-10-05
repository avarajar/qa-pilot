import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describeDiff, markChange, zoneName } from './visual.js'

// imagen gris como las de diff de Playwright, con rectángulos pintados de un color
function png(w: number, h: number, paint: Array<{ x: number; y: number; w: number; h: number; rgb: [number, number, number] }> = []): Buffer {
  const img = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) img.data.set([230, 230, 230, 255], i * 4)
  for (const p of paint) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) img.data.set([...p.rgb, 255], (y * w + x) * 4)
  }
  return PNG.sync.write(img)
}

describe('describeDiff', () => {
  it('cuenta los píxeles rojos y encuentra la zona; ignora el amarillo del suavizado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-vis-'))
    const file = join(dir, 'diff.png')
    writeFileSync(file, png(100, 50, [
      { x: 80, y: 5, w: 10, h: 4, rgb: [255, 0, 0] },
      { x: 2, y: 40, w: 5, h: 5, rgb: [255, 255, 0] },
    ]))
    expect(describeDiff(file)).toEqual({ pixels: 40, percent: 0.8, box: { x: 80, y: 5, w: 10, h: 4 }, zone: 'arriba a la derecha' })
  })

  it('sin píxeles rojos o con un archivo ilegible → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-vis-'))
    writeFileSync(join(dir, 'gris.png'), png(10, 10))
    writeFileSync(join(dir, 'roto.png'), 'no es png')
    expect(describeDiff(join(dir, 'gris.png'))).toBeNull()
    expect(describeDiff(join(dir, 'roto.png'))).toBeNull()
  })
})

describe('zoneName', () => {
  it('nombra la zona por su centro, o toda la pantalla si casi la cubre', () => {
    expect(zoneName({ x: 0, y: 0, w: 10, h: 10 }, 100, 100)).toBe('arriba a la izquierda')
    expect(zoneName({ x: 45, y: 45, w: 10, h: 10 }, 100, 100)).toBe('en el centro')
    expect(zoneName({ x: 40, y: 90, w: 20, h: 10 }, 100, 100)).toBe('abajo al centro')
    expect(zoneName({ x: 0, y: 40, w: 10, h: 10 }, 100, 100)).toBe('a la izquierda, a media altura')
    expect(zoneName({ x: 5, y: 5, w: 90, h: 90 }, 100, 100)).toBe('en casi toda la pantalla')
  })
})

describe('markChange', () => {
  it('dibuja un recuadro rojo alrededor de la zona, con margen, sin salirse de la imagen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-vis-'))
    const src = join(dir, 'actual.png')
    const out = join(dir, 'marked.png')
    writeFileSync(src, png(100, 50))
    expect(markChange(src, { x: 80, y: 5, w: 10, h: 4 }, out)).toBe(true)
    const img = PNG.sync.read(readFileSync(out))
    const at = (x: number, y: number) => [...img.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)]
    expect(at(72, 20)).toEqual([230, 230, 230]) // fuera del recuadro
    expect(at(74, 0)).toEqual([220, 38, 38]) // borde superior, recortado al tope de la imagen
    expect(at(85, 7)).toEqual([230, 230, 230]) // adentro queda igual
  })
})
