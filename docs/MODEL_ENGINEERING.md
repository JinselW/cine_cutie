# 模型工程与真实 GPU Benchmark

## 证据边界

四套 H3 workflow 的文件名提供模型工程静态证据：视频主干为 INT8 ConvRot，文本编码器为 NVFP4 AWQ，视频 VAE 为 FP16，音频 VAE 为 FP32；启用快速路径时使用 BF16 Lightning 8-step LoRA。它们不是远端机器已加载模型的独立证明，正式提交还应保存 ComfyUI 日志、`/object_info` 或目标机模型清单。

`compiler.*` 只表示本地 workflow 加载、修改与序列化耗时，绝不代表 GPU 推理速度。只有 `gpuRuntime.measured=true` 且 attempt 含真实 `promptId` 时，才表示确实向 ComfyUI 提交过任务。

## 本地确定性运行

```bash
npm run benchmark
```

该命令固定 seed（默认 42），覆盖四种模式的 workflow 编译并写入 `reports/benchmark.json`。未显式开启真实运行时会正常退出，写入 `gpuRuntime.measured=false` 及原因。

## DGX / ComfyUI 环境要求

- SSH 可访问目标 DGX，ComfyUI 已启动且 API 端口可通过 SSH 隧道访问。
- 四套 workflow 所需 H3 checkpoint、编码器、VAE、自定义节点及 Lightning LoRA 已安装。
- `nvidia-smi`、`free`、`df` 在 SSH 用户环境可用。
- 图像模式使用有权用于 benchmark 的本地 PNG/JPEG/WebP；缺少输入的模式会明确记为 `skipped`。
- 输出默认保存到 `reports/benchmark-outputs/`，不要提交视频或密钥。

PowerShell 单档安全运行：

```powershell
$env:COMFY_SSH_HOST='dgx-host'
$env:COMFY_SSH_PORT='6078'
$env:COMFY_SSH_USER='Developer'
$env:COMFY_SSH_PASSWORD='<secret>'
$env:COMFY_SSH_COMFY_PORT='8188'
$env:CINE_BENCH_REAL='1'
$env:CINE_BENCH_PROFILES='balanced'
$env:CINE_BENCH_FIRST_IMAGE='C:\bench\first.png'
$env:CINE_BENCH_LAST_IMAGE='C:\bench\last.png'
$env:CINE_BENCH_REFERENCE_IMAGES=('C:\bench\ref-a.png','C:\bench\ref-b.png' -join [IO.Path]::PathSeparator)
npm run benchmark
```

三档对比将 `CINE_BENCH_PROFILES` 设为 `fast,balanced,quality`。默认并发为 1；可用 `CINE_BENCH_CONCURRENCY` 请求队列并发测试，但实际值始终受 profile 的 `maxConcurrentGpuJobs` 上限约束。可配置 `CINE_BENCH_TIMEOUT_MS`、`CINE_BENCH_POLL_MS`、`CINE_BENCH_SEED`、`CINE_BENCH_DURATION`、`CINE_BENCH_PROMPT` 和 `CINE_BENCH_OUTPUT_DIR`。

## 报告字段

每个 `gpuRuntime.attempts[]` 记录 mode/profile、`promptId`、workflow ID/SHA-256、固定 seed、推理参数、模型/精度/量化声明、状态、失败/取消原因和 `fallbackReason`（benchmark 不自动降级模式，通常为 `null`）。`timestamps` 包含提交/开始/结束时间；`timingMs` 拆分排队、推理和总耗时。开始时间由首次在 `/queue` 的 running 状态观测得到，因此精度受采样间隔限制；若无法观测则保持 `null`，不会猜测。

`resources` 汇总采样次数、峰值 GPU 利用率、峰值 VRAM、峰值统一/系统内存和最小磁盘可用空间；`samples` 保留逐次原始采样。DGX Spark 的系统内存同时承担统一内存，因此两字段来自同一 `free` 采样并明确保留。成功输出包含本地路径、字节数和 SHA-256。失败、取消、超时、缺输入与未连接都会保留原因；指标采样失败不会伪造为零。

运行后应人工确认每个成功 attempt 都有 `promptId`、输出哈希和合理采样，并将 JSON 与目标机环境证据一并归档。大型生成视频应留在本地或外部制品库。
