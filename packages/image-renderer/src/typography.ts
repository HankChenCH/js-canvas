/**
 * 字体装配与真实度量（对位 go-canvas/image-renderer/typography 包——本包唯一
 * 字体加载入口，绘制端 text.ts 与度量端共用同一装配配置，保证度量与绘制口径
 * 同源）。
 *
 * TTC fail-fast（04/05 号决议）：go image 侧对 TTC 取首个 face（静默），node
 * 两后端统一拒收——魔数嗅探 `ttcf` 即抛，响亮报错优于 napi「能吃但静默取默认
 * 面」的多面 CJK 集合风险；对 go 是有意收紧，不是镜像。
 *
 * napi 装配机制：GlobalFonts 仅提供 registerFromPath（1.0.13 无 buffer 注册口），
 * 下载字节须落盘后按路径注册；family 别名用字节内容派生（sha256 前缀），同字节
 * 重注册幂等、同路径重注册不再冲突。解析结果（ref → 别名）进程内缓存——字体
 * 文件视为进程生命周期内不可变（对位 go parsedFonts sync.Map）。
 *
 * 度量器（08 号决议 v1 单组件，对位 go OpenTypeMeasurerFactory）：离屏
 * measuring canvas + ctx.measureText 返真实宽度；加载失败（缺文件/解析失败/
 * 远程字体尚未物化）降级核心启发式度量，布局不中断；经核心
 * TextLayoutPolicies.measurerFactory 显式注入，缺省不注入（启发式对齐版，
 * 开箱行级与 PHP/Go 一致）。
 */
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createHeuristicMeasurer, type TextMeasurer, type TextMeasurerFactory } from '@hankchen/canvas'

import { isNumeric } from './url'

/** 内置默认字体判定：空串/纯数字字体 id（对位 go typography.IsBuiltinFont）。
 * 空串与纯数字同归默认字面——判定与 resolver 跳过字体物化共用 isNumeric 同一口径
 * （src/url.ts，防漂移）。度量与绘制共用本判定（对位 go measurer.go docblock） */
export function isBuiltinFont(font: string): boolean {
    return font === '' || isNumeric(font)
}

/** TTC/OTC 集合魔数（fail-fast 拒收面；go image 取首 face 的有意收紧见文件头） */
function assertNotTtc(data: Uint8Array, ref: string): void {
    if (data.length >= 4 && data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66) {
        throw new Error(`字体 ${ref} 为 TTC/OTC 集合: 本渲染端 fail-fast 拒收（魔数 ttcf；多面 CJK 集合静默取默认面是最危险的静默错误）`)
    }
}

/** 字节内容派生稳定别名（同字节同别名：重注册幂等、napi 侧不冲突） */
function fontAlias(data: Uint8Array): string {
    return `ncv-${createHash('sha256').update(data).digest('hex').slice(0, 24)}`
}

/** ref → napi family 别名（进程内缓存；字体文件视为不可变） */
const registeredFonts = new Map<string, string>()

/** 下载字体字节的落盘目录（napi 仅提供 registerFromPath，字节面须先成文件） */
function fontCacheDir(): string {
    const dir = join(tmpdir(), 'js-canvas-image-renderer-fonts')
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
    return dir
}

/**
 * 按路径装配字体：读字节 → TTC 嗅探拒收 → 内容派生别名 → registerFromPath。
 * 失败即抛（绘制端：中止渲染，对位 go sessionFace 失败通道；度量端捕获后降级
 * 启发式）。返回 CSS family 简写用的别名
 */
function loadFontFamilyByPath(path: string, ref: string): string {
    const cached = registeredFonts.get(ref)
    if (cached !== undefined) {
        return cached
    }
    let data: Uint8Array
    try {
        data = new Uint8Array(readFileSync(path))
    } catch (error) {
        throw new Error(`读取字体 ${ref}: ${(error as Error).message}`)
    }
    return registerFontBytes(data, ref)
}

/** 按字节装配字体（远程字体物化缝）：TTC 嗅探 → 落盘 → registerFromPath */
function registerFontBytes(data: Uint8Array, ref: string): string {
    assertNotTtc(data, ref)
    const alias = fontAlias(data)
    if (GlobalFonts.has(alias)) {
        registeredFonts.set(ref, alias)
        return alias
    }
    const file = join(fontCacheDir(), `${alias}.font`)
    if (!existsSync(file)) {
        writeFileSync(file, data)
    }
    try {
        GlobalFonts.registerFromPath(file, alias)
    } catch (error) {
        throw new Error(`解析字体 ${ref}: ${(error as Error).message}`)
    }
    if (!GlobalFonts.has(alias)) {
        throw new Error(`解析字体 ${ref}: 注册后未命中别名（非 sfnt 字体文件?）`)
    }
    registeredFonts.set(ref, alias)
    return alias
}

/**
 * 远程字体物化缝：resolver 把下载字节按键（URL 原文）登记，drawText 以 wire
 * font 引用直取。字节面在此处完成 TTC 拒收与注册（物化阶段 fail-fast，渲染
 * 不带病启动）；幂等（同字节同别名）
 */
export function registerFontData(ref: string, data: Uint8Array): void {
    registerFontBytes(data, ref)
}

/**
 * 字体引用 → CSS family 别名（内置默认 → 'sans-serif'，即渲染端默认字体族；
 * 对位 go BuiltinFace 的「内置语义」位）。装配失败即抛——绘制端原样上抛中止，
 * 度量端经 createNapiMeasurerFactory 捕获降级
 */
export function loadFontFamily(font: string): string {
    if (isBuiltinFont(font)) {
        return 'sans-serif'
    }
    return loadFontFamilyByPath(font, font)
}

/** 离屏 measuring canvas（懒建；进程级共享，度量端单线程串行使用） */
let measuringCtx: SKRSContext2D | null = null

function ensureMeasuringCtx(): SKRSContext2D {
    if (measuringCtx === null) {
        measuringCtx = createCanvas(16, 16).getContext('2d')
    }
    return measuringCtx
}

/**
 * napi 真实字体度量器工厂（08 号决议 v1 单组件；对位 go OpenTypeMeasurerFactory）：
 * 每次工厂调用新建独立度量器（go 三组件「工厂每次新建」先例），度量前按图层
 * 字体与字号重设 ctx.font（同「用前设置」纪律）。
 *
 * 基线换算实测钉死（1.0.13）：TextMetrics.fontBoundingBoxAscent/Descent 为
 * 「基线距字盒顶/底」正值口径，与 go x/image Metrics 的 Ascent / Descent（正值
 * 约定）同号同义——绘制端基线差消化用这对字段（见 text.ts）；而
 * alphabeticBaseline/ideographicBaseline 实测是「相对基线自身」的偏移量
 * （alphabetic 恒 0、ideographic 为 CJK 基线相对 alphabetic 的偏移），不是
 * 「距盒顶」口径，不作基线锚点用。宽度即 metrics.width 像素浮点（与落笔同一
 * 度量路径，对位 go MeasureString 与 DrawString 同路径）。
 *
 * 加载失败（缺文件/解析失败/远程字体尚未物化）与非正字号降级核心启发式度量，
 * 布局不中断（对位 go 工厂降级臂）；TTC 视为加载失败同降级（拒收只在绘制端
 * fail-fast——度量中断会破坏整个布局，两侧差异是刻意的）
 */
export const createNapiMeasurerFactory: TextMeasurerFactory = (font, fontSize) => {
    let family: string
    try {
        if (!Number.isFinite(fontSize) || fontSize <= 0) {
            return createHeuristicMeasurer(fontSize)
        }
        family = loadFontFamily(font)
    } catch {
        return createHeuristicMeasurer(fontSize)
    }
    const ctx = ensureMeasuringCtx()
    // 别名（ncv-hex）与 sans-serif 均为 CSS 安全裸字面，不加引号——带引号的
    // "sans-serif" 会按字面族名解析、回退到不可控的默认字体（实测 1.0.13）
    const shorthand = `${fontSize}px ${family}`
    return {
        measure(text: string): number {
            ctx.font = shorthand
            return ctx.measureText(text).width
        },
    } satisfies TextMeasurer
}
