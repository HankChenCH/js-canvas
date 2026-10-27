import { describe, expect, it } from 'vitest'

import {
    RESOURCE_ERROR_CODES,
    ResourceMaterializeError,
    qrImageSrc,
    type Downloader,
    type FetchLike,
    type ImageRegisteringBackend,
    type QRMaterializer,
    type ResourceResolver,
} from '../../src/index'

describe('资源物化缝契约（工票 09 / 06 号决议，对位 go resolver 包）', () => {
    it('稳定错误 code 集合：对位 go resolver.go 哨兵集合 + 工票定稿的 unsupported_scheme', () => {
        expect([...RESOURCE_ERROR_CODES]).toEqual([
            'resource_download_failed',
            'resource_save_failed',
            'qr_generate_failed',
            'qr_materializer_required',
            'unsupported_scheme',
        ])
    })

    it('ResourceMaterializeError：name + 稳定 code + 「code: 上下文」消息形态', () => {
        const error = new ResourceMaterializeError('resource_download_failed', 'could not get remote file(https://example.com/a.png)')
        expect(error).toBeInstanceOf(Error)
        expect(error.name).toBe('ResourceMaterializeError')
        expect(error.code).toBe('resource_download_failed')
        expect(error.message).toBe('resource_download_failed: could not get remote file(https://example.com/a.png)')
    })

    it('三接口 + 登记缝均为最小结构面：字面量对象即结构契合（无须显式 implements）', () => {
        // 编译期断言即用例本体：最小结构面风格（MeasureTextSource 同款）——
        // 实现方写普通对象/类即满足契约，核心不要求继承树
        const downloader: Downloader = {
            download: (rawUrl) => Promise.resolve(new TextEncoder().encode(`bytes-of-${rawUrl}`)),
        }
        const qr: QRMaterializer = {
            materialize: (text, width) => Promise.resolve(new Uint8Array([text.length, width])),
        }
        const registered: Array<{ key: string; data: Uint8Array }> = []
        const registering: ImageRegisteringBackend = {
            setImage: (key, data) => {
                registered.push({ key, data })
            },
        }
        const resolver: ResourceResolver = {
            resolve: async (canvas, backend) => {
                if (canvas.background?.image) {
                    backend.setImage?.(canvas.background.image, await downloader.download(canvas.background.image))
                }
            },
        }

        expect(typeof downloader.download).toBe('function')
        expect(typeof qr.materialize).toBe('function')
        expect(typeof resolver.resolve).toBe('function')
        expect(registering.setImage).toBeTypeOf('function')
    })

    it('物化缝形态：登记键 = wire src 同键（qr: 前缀键经 qrImageSrc 产出），字节经 setImage 回写', () => {
        // 06 号决议：物化器以 wire src 同键登记，渲染模板照常递原始引用；
        // 键与渲染期 drawImage 收到的 src 引用一致（QR 臂 qrImageSrc / 图片臂远程 URL 原样）
        const registered: Array<{ key: string; data: Uint8Array }> = []
        const backend: ImageRegisteringBackend = {
            setImage: (key, data) => {
                registered.push({ key, data })
            },
        }
        const qrBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        backend.setImage?.(qrImageSrc('https://example.com/join'), qrBytes)
        backend.setImage?.('https://cdn.example.com/photo.png', new Uint8Array([1, 2, 3]))

        expect(registered.map((entry) => entry.key)).toEqual([
            'qr:https://example.com/join',
            'https://cdn.example.com/photo.png',
        ])
        expect(registered[0]?.data).toBe(qrBytes)
    })

    it('FetchLike 为自定义结构面（零 DOM lib）：形态契合的 async 函数即可注入默认下载器', () => {
        // 编译期断言即用例本体：不引 DOM lib 的 fetch/Response 类型，ES2022 lib 的
        // Promise/ArrayBuffer 即够（Node ≥18 全局 fetch 同构）；ok/status 判成败、
        // arrayBuffer 取字节
        const fetchLike: FetchLike = async (url) => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(`body-of-${url}`).buffer,
        })

        expect(typeof fetchLike).toBe('function')
    })
})
