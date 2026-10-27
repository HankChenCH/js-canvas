/**
 * 二维码物化的默认实现（ADR-0002 缝的接线端）：`qrcode` npm 包适配，固定选项
 * 纠错 H、边距 0、正方形 PNG 输出。缓存不在本层——命中跳过/幂等由 resolver
 * 统一负责，这里只做「内容+宽度 → PNG 字节」。
 *
 * 与 go-canvas pdf-renderer/qr.go（及其同源的 image-renderer/qr.go）同一公式的小件
 * 复制：QRMaterializer 是后端包的接线知识（ADR-0002），两后端各自持有同一默认实现，
 * 物化选项逐项同源（纠错 High、margin 0、纯黑前景/纯白背景、PNG 编码）。**库底座
 * 分歧记录在案**：go pin yeqown/go-qrcode v2（整数块宽量化），node 侧 `qrcode` 包
 * width 语义为输出像素宽（内部取整）——与 image 包产物只锚定选项级对齐 + 渲染消费
 * 端 cover 铺放（AGENTS.md 包依赖红线第四款：共享小件同式复制并注明出处，两包互不
 * import）。**编码模式口径与 image 包同式**（评审 P0-2）：显式 segment 三分
 * （pickEncMode 同式复制自 image 包 src/qr.ts ← go qr.go pickEncMode ← bacon
 * chooseMode），压制 `qrcode` auto 模式的矩阵分歧——auto 会把混合内容拆成多 segment
 * （数字段走 Numeric）且宿主启用 toSJIS 后纯 CJK 升级 Kanji，与 go/endroid 的
 * 「整串单模式」不同物，位面实测数百 bit 差异；显式单 segment 后两 node 包矩阵
 * 一致按构造成立（PNG 字节面两包尺寸参数不同：本包 width=输出宽 vs image 包
 * scale=块宽，一致性锚定在矩阵级）
 */
import QRCode, { type QRCodeSegment } from 'qrcode'
import { Buffer } from 'node:buffer'

import type { QRMaterializer } from '@hankchen/canvas'

/** QRMaterializer 二维码物化默认实现，固定选项逐项对齐 go/PHP 用法：
 * 纠错 = QR 'H' 30%（endroid ErrorCorrectionLevel::High）；margin = 0（库默认静区
 * 显式归零）；size = max(图层宽,1)；产物恒正方形 PNG。渲染原语以内切正方形 cover
 * 铺放（ADR 0015），块宽量化差异在渲染面不可见，只影响缓存 PNG 的绝对尺寸 */
export class QrCodeMaterializer implements QRMaterializer {
    async materialize(text: string, width: number): Promise<Uint8Array> {
        const size = Math.max(width, 1) // 对齐 endroid size=max(图层宽,1)
        if (text === '') {
            // 空内容防线：显式 byte segment 下库对空串会静默出一张空码（auto 模式
            // 才报 No input text），resolver 契约已拦空内容，此处为直接调用防线
            throw new Error(`生成二维码矩阵(${text}): 空内容不可编码为二维码`)
        }
        const segment = segmentFor(text, pickEncMode(text))

        try {
            // 显式 segment 单段编码（压制 auto 多段拆分/Kanji 升级，见文件头）
            const buffer = await QRCode.toBuffer([segment], {
                errorCorrectionLevel: 'H',
                margin: 0,
                width: size,
                color: { dark: '#000000ff', light: '#ffffffff' }, // 纯黑前景/纯白背景（不透明）
                type: 'png',
            })
            return new Uint8Array(buffer)
        } catch (err) {
            throw new Error(`生成二维码矩阵(${text}): ${(err as Error).message}`)
        }
    }
}

/** 编码模式判定结果（node-qrcode segment 模式名；无 Kanji 分支） */
type QrSegmentMode = 'numeric' | 'alphanumeric' | 'byte'

/**
 * 复刻 bacon Encoder::chooseMode 在 UTF-8 提示下的模式选择（同式复制自 image 包
 * src/qr.ts pickEncMode ← go qr.go pickEncMode）：纯数字→Numeric、QR 字母数字集→
 * Alphanumeric、其余→Byte，无 Kanji 分支。与 node-qrcode auto 模式的差别：auto 按
 * 正则把混合内容拆成多段且 toSJIS 在场时升级 Kanji，两端矩阵不一致
 */
function pickEncMode(text: string): QrSegmentMode {
    if (text === '') {
        return 'byte' // bacon chooseMode 空串守卫，忠实复刻（实际到不了：resolver 已拦空内容）
    }
    if (isAllDigits(text)) {
        return 'numeric'
    }
    if (isAllAlphaNum(text)) {
        return 'alphanumeric'
    }
    return 'byte'
}

/** segment 构造（判别联合按分支收窄，显式模式压制库的多段拆分/Kanji 升级）。
 * byte 分支传 UTF-8 字节面（@types 的 ByteSegment 只收字节序列；运行时对
 * string 与 UTF-8 Buffer 同码） */
function segmentFor(text: string, mode: QrSegmentMode): QRCodeSegment {
    switch (mode) {
        case 'numeric':
            return { data: text, mode: 'numeric' }
        case 'alphanumeric':
            return { data: text, mode: 'alphanumeric' }
        default:
            return { data: Buffer.from(text, 'utf8'), mode: 'byte' }
    }
}

/** 纯 ASCII 数字（PHP ctype_digit 语义，空串由调用方先行分流） */
function isAllDigits(text: string): boolean {
    for (const ch of text) {
        if (ch < '0' || ch > '9') {
            return false
        }
    }
    return true
}

/** QR 字母数字集（PHP/bacon 与 node-qrcode 的字符表一致：0-9 A-Z 空格 $ % * + - . / :） */
function isAllAlphaNum(text: string): boolean {
    for (const ch of text) {
        if ((ch < '0' || ch > '9') && (ch < 'A' || ch > 'Z')) {
            switch (ch) {
                case ' ':
                case '$':
                case '%':
                case '*':
                case '+':
                case '-':
                case '.':
                case '/':
                case ':':
                    break
                default:
                    return false
            }
        }
    }
    return true
}
