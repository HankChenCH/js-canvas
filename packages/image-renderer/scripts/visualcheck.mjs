/**
 * 目验样张脚本（工票 12，对位 go-canvas/image-renderer/cmd/visualcheck）：一条命令
 * 渲染 400×520 综合样张 PNG——像素取样、布局快照之外的人眼验收面（07 号决议）。
 *
 * 九条验收线（元素几何逐项复刻 go 版 main.go buildSample，见 go docs/visual-check.md）：
 *  1. 画布白底（canvas.background，先于图层铺装）→ 全图无透明区域；
 *  2. 蓝色头图 400×90 #2d6cdf + 白字标题 24px 双居中 → priority 叠加次序正确、
 *     中文不缺字不成方块（priority 越大越先渲染 = 越垫底，wire 解码排序）；
 *  3. 中文段落 360 宽 autowrap 14px #f5f7fa padding 10 @(20,110) → 禁则断行
 *     （行首无句号/逗号/顿号）、`hello world` 词边界断行、背景与 padding 可见；
 *  4. 表格三行两列 250 宽 @(20,250) → 表头行底色 #eef3fd、单元格边框 #dddddd、
 *     行高 auto 取最高单元格（12px + padding 6 → 每行 24、表高 72）、嵌套内容
 *     padding 可见；
 *  5. 二维码 90×90 @(280,250) → 扫码可得仓址、按宽正方形铺放；
 *  6. 条带图 360×40 @(20,340) → cover 铺放无拉伸变形（图 = 本程序用本包后端
 *     自生成的 360×40 PNG：#e8f0e8 全幅底 + (10,10)-(130,30) #6dc287 色块）；
 *  7. 页脚 400×30 11px #888888 居中 @(0,370) → 小字号垂直居中；
 *  8. 宽自适应单行 @(20,465)（#fff7e6 底 + 1px #e6a23c 边框 + padding 8）→
 *     盒宽 = 未断行自然宽 + 横向 padding，背景/边框随内容收紧贴合不塌缩；
 *  9. 宽自适应 + autowrap 多行 @(220,465)（#f0f9eb + #67c23a）→ 组合退化为不折行：
 *     显式换行两行、盒宽取最长段。
 *
 * 对 go 版的有意差异（工票 12 报告记档）：
 *  - go 版附加段「V2 模板表」（hydrate(dataset) 行循环）不复刻——node 核心包
 *    v2.1.0 无 hydrate 管线，模板态 TableLayer 渲染面 rows 为空无可目验内容；
 *  - 字体候选不含 .ttc：node 两后端统一 fail-fast 拒收 TTC/OTC 字体集（04/05 号
 *    决议），候选改单体 TTF 优先（go image 侧候选列表不可照抄）；
 *  - 品牌字样/二维码内容改写为 js-canvas（对位 go docs 双端对照纪律：布局级一致、
 *    品牌字样有意改写、像素不求等）。
 *
 * 字体探针纪律（对位 go pickFont）：候选逐个以「存在且可加载」判取，加载探针复用
 * 渲染端同一入口（本包 loadFontFamily——绘制端 drawText 同一装配路径），全缺报错
 * 逐条列落选原因并中止、不产残图（内置默认字体仅 ASCII，缺真实字体中文必成方块，
 * 不静默降级）。JS_CANVAS_VISUAL_FONT 环境变量可覆写候选（对位 go pdf 侧
 * GO_CANVAS_VISUAL_FONT）；CI 冒烟腿（07 号决议「能出产物不抛错」）可设
 * JS_CANVAS_ALLOW_NO_FONT=1，字体全缺时打印 skip 理由后以 0 退出（对位 go
 * main_test.go testFont 的 t.Skip——不产残图）。
 *
 * 用法：node scripts/visualcheck.mjs [输出路径]
 *   缺省输出 <包根>/visualcheck-output/visual-check.png（已 gitignore；
 *   对位 go make visual-check 产物 image-renderer/visual-check.png 同纪律）。
 * 消费面：workspace 已构建 dist（先 pnpm -r build）经 node_modules 依赖解析，
 * 与真实消费方同一条 exports 入口。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeGraph, renderAs } from '@hankchen/canvas'
import { ImageRendererBackend, createDefaultResolver, loadFontFamily } from '@hankchen/canvas-image-renderer'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 字体候选（单体 TTF，CJK 字形优先、ASCII 兜底殿后——go image 候选的 node 收紧版）：
 *  - macOS 自带 Arial Unicode（单体 TTF 含 CJK，本仓两后端唯一开箱即用的 mac 候选）；
 *  - Linux 走 fonts-ipafont-gothic 的 ipag.ttf（apt 包名同款；CI ubuntu 显式安装，
 *    与 go pdf-renderer CI 字体腿同款包、两个发行路径都探）；
 *  - DejaVu/Arial 为 ASCII 兜底殿后（命中则中文成方块——候选顺序保证有 CJK 时
 *    轮不到它们，与 go image 侧候选列表同序精神）。 */
const FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/fonts-ipafont-gothic/ipag.ttf',
    '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
]

/** pickFont 取首个「存在且可加载」候选：探针 = 渲染端同一入口 loadFontFamily
 * （读字节 + TTC fail-fast 拒收 + napi 注册，缺文件/坏字体抛错）。JS_CANVAS_VISUAL_FONT
 * 为绝对覆写（对位 go GO_CANVAS_VISUAL_FONT：覆写失手不回落系统候选，避免静默兜住
 * 配置错误）。全缺时逐条列落选原因；JS_CANVAS_ALLOW_NO_FONT=1（CI 冒烟腿）改抛
 * SkipError——调用方打印 skip 后 0 退出、不产残图 */
function pickFont(candidates) {
    const override = process.env.JS_CANVAS_VISUAL_FONT
    const list = override ? [override] : candidates
    const tried = []
    for (const c of list) {
        try {
            loadFontFamily(c)
            return c
        } catch (error) {
            tried.push(`  - ${c}(${(error).message})`)
        }
    }
    const detail = `未找到可用字体（候选按 CJK 字形优先排序，缺真实字体时中文会渲染为方块）。已依次检查：\n${tried.join('\n')}\n请安装其中一款字体、设 JS_CANVAS_VISUAL_FONT 指向单体 TTF，或按本机字体位置扩充 FONT_CANDIDATES`
    if (process.env.JS_CANVAS_ALLOW_NO_FONT === '1') {
        const skip = new Error(`[skip] 字体腿缺席，样张冒烟跳过（不产残图）。${detail}`)
        skip.isFontSkip = true
        throw skip
    }
    throw new Error(detail)
}

/** 条带图（验收线 6 的图源）：直接用本包后端生成 360×40 PNG——零手拼编码器，
 *  顺带对后端 begin/drawRect/end 最小面做一次实弹。go 版两色常量逐项对齐。 */
function writeStripPng(filePath) {
    const backend = new ImageRendererBackend()
    const noBorder = { top: null, bottom: null, left: null, right: null }
    backend.begin(360, 40)
    backend.drawRect(0, 0, 360, 40, '#e8f0e8', noBorder)
    backend.drawRect(10, 10, 120, 20, '#6dc287', noBorder)
    const png = backend.end()
    if (png === null) throw new Error('条带图生成失败：后端未产出 PNG')
    fs.writeFileSync(filePath, png)
}

// ---- wire 图层构造辅助（wire 形态见核心 decode.ts；显式键与 go With* 逐项对齐） ----

/** 文本层。缺省 priority 4（样张中除头图 10/标题 5 外同层，序由数组序保稳） */
function textLayer({ text, font, fontSize, fontColor, x, y, width, height, autoHeight = false, autoWidth = false, backgroundColor = null, padding = null, border = null, align = null, autowrap = false, angle = 0, priority = 4 }) {
    const shape = { width, height, autoHeight, autoWidth }
    if (backgroundColor !== null) shape.backgroundColor = backgroundColor
    if (padding !== null) shape.padding = { top: padding, right: padding, bottom: padding, left: padding }
    if (border !== null) shape.border = { top: border, bottom: border, left: border, right: border }
    const layer = {
        type: 'TextLayer',
        priority,
        spec: {
            shape,
            fontFamily: { font, fontSize, fontColor, angle, autowrap },
        },
        data: { valueType: 'StaticValue', value: text },
    }
    if (align !== null) layer.spec.align = { horizontal: align[0], vertical: align[1] }
    layer.spec.position = { x, y }
    return layer
}

/** 表格单元格：内容层（宽经解码同步为格宽，对位 AddContentLayer 副作用） */
function tableCell({ text, font, width, background, paddingSize = 6 }) {
    return {
        type: 'TableCellLayer',
        spec: {
            shape: {
                width,
                height: 0,
                autoHeight: true,
                backgroundColor: background,
                border: { top: { width: 1, color: '#dddddd' }, bottom: { width: 1, color: '#dddddd' }, left: { width: 1, color: '#dddddd' }, right: { width: 1, color: '#dddddd' } },
            },
        },
        content: textLayer({ text, font, fontSize: 12, fontColor: '#222222', x: 0, y: 0, width, height: 0, autoHeight: true, padding: paddingSize }),
    }
}

/** 九条验收线的综合样张 wire（几何逐项对位 go buildSample；品牌字样改写 js-canvas） */
function buildSampleWire(font, stripPath) {
    const header = {
        type: 'ImageLayer',
        priority: 10,
        spec: { shape: { width: 400, height: 90, backgroundColor: '#2d6cdf' }, position: { x: 0, y: 0 } },
    }

    const title = textLayer({
        text: 'js-canvas 目验样图',
        font,
        fontSize: 24,
        fontColor: '#ffffff',
        x: 0, y: 0, width: 400, height: 90,
        align: ['center', 'center'],
        priority: 5,
    })

    // 长中文段落：autowrap + 禁则效果（。不能出现在行首）+ hello world 词边界断行
    const paragraph = textLayer({
        text: '图层树与渲染器分离之后，同一份结构树可以交给不同后端渲染；中文断行内置禁则处理，行首不会出现句号、逗号等收尾标点。英文单词 hello world 优先在词边界断行。',
        font,
        fontSize: 14,
        fontColor: '#333333',
        x: 20, y: 110, width: 360, height: 0,
        autoHeight: true,
        backgroundColor: '#f5f7fa',
        padding: 10,
        autowrap: true,
    })

    // 表格三行两列（宽 250，右侧留给二维码）；表高 72 = 3 行 × 24（12px + padding 6×2），
    // 与 go buildTable 的行高累计同式
    const specs = [
        { field: '字段', desc: '说明' },
        { field: 'Canvas', desc: '纯结构容器' },
        { field: 'Renderer', desc: '可插拔渲染后端' },
    ]
    const rows = specs.map((spec, i) => ({
        type: 'TableRowLayer',
        spec: { shape: { width: 250, height: 0, autoHeight: true } },
        cells: [
            tableCell({ text: spec.field, font, width: 80, background: i === 0 ? '#eef3fd' : '#ffffff' }),
            tableCell({ text: spec.desc, font, width: 170, background: i === 0 ? '#eef3fd' : '#ffffff' }),
        ],
    }))
    const table = {
        type: 'TableLayer',
        priority: 4,
        spec: {
            shape: { width: 250, height: 72, backgroundColor: '#ffffff', border: { top: { width: 1, color: '#dddddd' }, bottom: { width: 1, color: '#dddddd' }, left: { width: 1, color: '#dddddd' }, right: { width: 1, color: '#dddddd' } } },
            position: { x: 20, y: 250 },
        },
        rows,
    }

    const qrCode = {
        type: 'QrCodeLayer',
        priority: 4,
        spec: { shape: { width: 90, height: 90 }, position: { x: 280, y: 250 } },
        data: { valueType: 'StaticValue', value: 'https://github.com/HankChenCH/js-canvas' },
    }

    // 条带图 360×40：cover 缺省铺放（等比铺满裁切），目验不拉伸变形
    const strip = {
        type: 'ImageLayer',
        priority: 4,
        spec: { shape: { width: 360, height: 40, backgroundColor: '#ffffff' }, position: { x: 20, y: 340 } },
        data: { valueType: 'StaticValue', value: stripPath },
    }

    const footer = textLayer({
        text: 'HankChen/js-canvas',
        font,
        fontSize: 11,
        fontColor: '#888888',
        x: 0, y: 370, width: 400, height: 30,
        align: ['center', 'center'],
    })

    // 宽自适应单行（盒宽 = 自然宽 + padding 8；1px 边框随盒收紧）
    const autoWidthSingle = textLayer({
        text: '自动宽度贴合内容',
        font,
        fontSize: 16,
        fontColor: '#333333',
        x: 20, y: 465, width: 0, height: 0,
        autoWidth: true,
        autoHeight: true,
        backgroundColor: '#fff7e6',
        padding: 8,
        border: { width: 1, color: '#e6a23c' },
    })

    // autoWidth + autowrap 组合退化为不折行：显式换行拆段取最长段宽
    const autoWidthMultiline = textLayer({
        text: '第一段\n显式换行后的更长一段',
        font,
        fontSize: 14,
        fontColor: '#333333',
        x: 220, y: 465, width: 0, height: 0,
        autoWidth: true,
        autoHeight: true,
        backgroundColor: '#f0f9eb',
        padding: 8,
        border: { width: 1, color: '#67c23a' },
        autowrap: true,
    })

    return {
        canvas: { width: 400, height: 520, background: { color: '#ffffff' } },
        layers: [header, title, paragraph, table, qrCode, strip, footer, autoWidthSingle, autoWidthMultiline],
    }
}

function main() {
    const font = pickFont(FONT_CANDIDATES)

    const output = process.argv[2] ?? path.join(PACKAGE_ROOT, 'visualcheck-output', 'visual-check.png')
    fs.mkdirSync(path.dirname(output), { recursive: true })

    // 条带图落系统临时目录（对位 go os.TempDir()；文件名固定，重跑覆写）
    const stripPath = path.join(os.tmpdir(), 'js-canvas-visual-strip.png')
    writeStripPng(stripPath)

    const canvas = decodeGraph(buildSampleWire(font, stripPath))

    // 标准管线：渲染前物化（QR 生成 + 本地图预热）→ 核心编排 renderAs
    const backend = new ImageRendererBackend()
    createDefaultResolver().resolve(canvas, backend).then(() => {
        const png = renderAs(canvas, backend)
        assertPng(png, 400, 520)
        fs.writeFileSync(output, png)
        console.log(`字体候选命中: ${font}`)
        console.log(`已输出: ${output} (400x520)`)
    }).catch((error) => {
        console.error('visual-check:', error.message)
        process.exit(1)
    })
}

/** 产物守门（对位 go TestRenderSampleSmoke 的 PNG 魔数 + 尺寸断言）：产出必为
 *  400×520 合法 PNG——冒烟腿「能出产物不抛错」的脚本侧最小断言 */
function assertPng(bytes, width, height) {
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < magic.length; i += 1) {
        if (bytes[i] !== magic[i]) throw new Error('产物非 PNG（魔数不符）')
    }
    // IHDR：宽高为 PNG 流内首块数据，大端 4 字节（魔数 8 + 长度 4 + "IHDR" 4 起）
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const w = view.getUint32(16)
    const h = view.getUint32(20)
    if (w !== width || h !== height) {
        throw new Error(`产物尺寸 ${w}x${h} ≠ 期望 ${width}x${height}`)
    }
}

try {
    main()
} catch (error) {
    if (error.isFontSkip) {
        // CI 冒烟腿的字体 skip 语义（对位 go t.Skip）：可见、0 退出、不产残图
        console.warn(`::warning::image visualcheck 字体腿 skip：${error.message}`)
        process.exit(0)
    }
    console.error('visual-check:', error.message)
    process.exit(1)
}
