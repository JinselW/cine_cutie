// 单段 ComfyUI 视频生成的时间预算。MiniMax H3 在 DGX Spark 上实测每段 209–607 秒，
// 长尾会超过 10 分钟；服务端与客户端必须共用这一个值，否则两层预算会互相踩
// （曾经客户端按每段 11 分钟等、服务端 10 分钟就放弃，表现成"ComfyUI 还在跑流程却报错"）。
export const COMFY_CLIP_TIMEOUT_MS = 1500000;
