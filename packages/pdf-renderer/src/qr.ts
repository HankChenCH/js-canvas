/**
 * 二维码物化的默认实现（ADR-0002 缝的接线端）：`qrcode` npm 包适配，固定选项
 * 纠错 H、边距 0、正方形 PNG 输出。缓存不在本层——命中跳过/幂等由 resolver
 * 统一负责，这里只做「内容+宽度 → PNG 字节」。
 *
 * 与 go-canvas pdf-renderer/qr.go（及其同源的 image-renderer/qr.go）同一公式的小件
 * 复制：QRMaterializer 是后端包的接线知识（ADR-0002），两后端各自持有同一默认实现，
 * 物化选项逐项同源（纠错 High、margin 0、纯黑前景/纯白背景、PNG 编码）。**库底座
 * 分歧记录在案**：go pin yeqown/go-qrcode v2（整数块宽量化），node 侧 `qrcode` 包
 * width 语义为输出像素宽（内部取整）——两 node 渲染包（image/pdf）同库同参数，
 * 码面字节一致按构造成立；与 go/PHP 产物只锚定选项级对齐 + 渲染消费端 cover 铺放
 * （AGENTS.md 包依赖红线第四款：共享小件同式复制并注明出处，两包互不 import）。
 */
import QRCode from 'qrcode'

import type { QRMaterializer } from '@hankchen/canvas'

/** QRMaterializer 二维码物化默认实现，固定选项逐项对齐 go/PHP 用法：
 * 纠错 = QR 'H' 30%（endroid ErrorCorrectionLevel::High）；margin = 0（库默认静区
 * 显式归零）；size = max(图层宽,1)；产物恒正方形 PNG。渲染原语以内切正方形 cover
 * 铺放（ADR 0015），块宽量化差异在渲染面不可见，只影响缓存 PNG 的绝对尺寸 */
export class QrCodeMaterializer implements QRMaterializer {
    async materialize(text: string, width: number): Promise<Uint8Array> {
        const size = Math.max(width, 1) // 对齐 endroid size=max(图层宽,1)
        try {
            const buffer = await QRCode.toBuffer(text, {
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

