/**
 * 资源物化缝契约（工票 09 / 06 号决议；对位 go resolver/resolver.go + downloader.go +
 * qrmaterializer.go）：核心只钉接口与稳定错误 code，默认实现（HTTP 下载、QR 生成、
 * 缓存落盘）归渲染后端包自持——QR 编码器是 npm 依赖，零运行时依赖红线直接禁止进核心
 * （对位 go 两后端 qr.go 同式复制先例；ADR-0002 核心 define-only 的 TS 同构）。
 *
 * 形态为最小结构面（text.ts MeasureTextSource 同款）：接口只列必要成员，宿主/后端
 * 传真实对象即结构契合，无须显式 implements；网络面以自定义 fetch 结构面声明，
 * 不引 DOM lib 类型（tsconfig 无 DOM lib 红线）。字节通道统一 Promise（对位 Node
 * 网络现实——fetch 无同步形态；渲染本身保持同步管线，物化属渲染前的异步准备阶段）。
 *
 * 物化缝形态（06 号决议）：readonly 领域树零拷贝，物化结果不进 wire（decode-encode
 * 往返恒等不触碰）——物化器渲染前解析资源，以 wire src 同键（`qr:` 前缀键见
 * qrImageSrc、远程 URL 原样）经后端 setImage 登记字节，渲染模板照常递原始引用，
 * 后端遇已登记键取登记字节、未命中按普通 src 走。对位 go「resolver 回写图层
 * SetResolvedSrc」在 TS readonly 结构约束下的等价语义。
 *
 * 渲染期取消（go ctx 检查点 + render_deadline_exceeded / render_cancelled 两渲染
 * code）v1 不做（06 号决议 E1 记雾区），本契约暂无信号参数。
 */
import type { Canvas } from './types'

/**
 * 物化期稳定错误 code（对位 go resolver.go 稳定 code 集合：消息可本地化、code 稳定、
 * 跨端日志互查；PHP 侧对位 MaterializeException.getErrorCode）。语义：
 * - resource_download_failed：远程资源下载失败/空响应（对位 go ErrResourceDownloadFailed）
 * - resource_save_failed：物化产物落盘失败/缓存目录不可写（对位 go ErrResourceSaveFailed）
 * - qr_generate_failed：二维码生成/落盘失败（对位 go ErrQRGenerateFailed）
 * - qr_materializer_required：二维码物化缝未接线（对位 go ErrQRMaterializerRequired，
 *   ADR-0002——遇二维码图层而未接线时报错而非静默跳过，静默会产出缺二维码的错误渲染）
 * - unsupported_scheme：资源引用协议不受支持（go 侧协议面由注入的 Downloader 决定、
 *   无独立 code；工票 09 定稿将其列为稳定 code 供后端包统一归类）
 */
export const RESOURCE_ERROR_CODES = [
    'resource_download_failed',
    'resource_save_failed',
    'qr_generate_failed',
    'qr_materializer_required',
    'unsupported_scheme',
] as const

export type ResourceErrorCode = (typeof RESOURCE_ERROR_CODES)[number]

/**
 * 物化失败错误（形态对齐核心包既有错误类：name + 稳定 code + 中文消息）。消息以
 * code 为前缀（「code + 上下文」形态与 go fmt.Errorf("%w: ...") / PHP 同构，双端
 * 日志可互查）；判定经 code 字段（error.code === 'xxx'），不靠消息解析
 */
export class ResourceMaterializeError extends Error {
    readonly code: ResourceErrorCode

    constructor(code: ResourceErrorCode, message: string) {
        super(`${code}: ${message}`)
        this.name = 'ResourceMaterializeError'
        this.code = code
    }
}

/**
 * HTTP 响应最小结构面（零 DOM：不引 DOM lib 的 Response 类型；ES2022 lib 的
 * Promise/ArrayBuffer 即够）。只列默认下载器实际消费的成员——ok/status 判成败、
 * arrayBuffer 取字节
 */
export interface FetchResponseLike {
    readonly ok: boolean
    readonly status: number
    arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * fetch 最小结构面：后端包默认 HTTP 下载器（对位 go HTTPDownloader 用 net/http，
 * js 侧用 fetch）的注入缝。Node ≥18 全局 fetch / undici 即结构契合，无须任何类型
 * 依赖。取消信号（AbortSignal 形态）v1 不做——渲染期取消整体记雾区（06 号决议 E1）
 */
export interface FetchLike {
    (url: string): Promise<FetchResponseLike>
}

/**
 * 远程资源下载器契约（对位 go resolver/downloader.go Downloader）：注入自定义实现
 * （代理、鉴权、限流等场景）。失败即抛 ResourceMaterializeError（code =
 * resource_download_failed，消息含 URL 上下文）；空响应视作失败（对位 go
 * HTTPDownloader 的非 2xx/空体失败面）
 */
export interface Downloader {
    /** 拉取远程资源字节 */
    download(rawUrl: string): Promise<Uint8Array>
}

/**
 * 二维码物化缝（对位 go resolver/qrmaterializer.go QRMaterializer，ADR-0002）：核心
 * 只定义接口，固定选项实现——UTF-8、纠错 High、margin=0、纯黑前景/纯白背景、PNG 输出
 * ——归渲染后端 module（QR 编码器是 npm 依赖，核心零依赖红线禁止）。使用方组装时
 * 接线进自己的 ResourceResolver 实现；未接线遇二维码图层报 qr_materializer_required
 * 而非静默缺码
 */
export interface QRMaterializer {
    /** 按固定选项生成二维码 PNG 字节；width 为铺放宽度（正方形）；失败即抛
     * qr_generate_failed */
    materialize(text: string, width: number): Promise<Uint8Array>
}

/**
 * 图像登记缝最小结构面：物化结果按键登记的目标面，与 RenderBackend.setImage?
 * （render.ts）同构——物化器只需此一成员，不依赖绘制原语（对位 go resolver 只回写
 * 图层、不依赖 Backend 的分工）。结构化匹配：RenderBackend 后端即本面（setImage
 * 可选，物化器对缺席处置归实现方）
 */
export interface ImageRegisteringBackend {
    setImage?(key: string, data: Uint8Array): void
}

/**
 * 资源物化器契约（对位 go resolver.ResourceResolver 的可消费契约面——缓存目录/
 * 缓存键等实现细节不进契约）：渲染前的统一准备阶段。把画布里的远程引用（背景图/
 * 图层 src 的 URL、二维码内容）解析为渲染可用形态，首个错误即中止——失败即抛
 * ResourceMaterializeError、渲染不启动（无半物化渲染面）。字体 URL 的下载字节交
 * 渲染端注册（不经 setImage——字体非图像），注册缝归后端包契约
 */
export interface ResourceResolver {
    /** 渲染前物化整棵画布：背景图、各图层图片 src、二维码内容（qrImageSrc 同键经
     * setImage 登记）、字体 URL */
    resolve(canvas: Canvas, backend: ImageRegisteringBackend): Promise<void>
}
