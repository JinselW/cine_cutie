# 视觉合规检查

视觉合规层覆盖角色/场景设计图、镜头参考图、生成视频片段和最终成片。后端只接受 `MEDIA_DIR` 内由 `/api/media/...` 标识的文件，防止任意文件读取。

## 实际执行的检查

- OCR：使用本地 Tesseract CLI，默认加载英文与简体中文语言包。返回文字、置信度、边界框、媒体来源、帧号和时间点。
- 视频采样：使用 FFmpeg 定时抽帧，默认每 5 秒一帧、最多 24 帧。抽帧位于系统临时目录；正常、失败和取消路径都会清理。
- OCR 结果会进入已有 IP 数据库。明确的受保护名称、品牌词以及常见 stock/watermark 标记形成阻断证据；低置信度文字进入人工复核。

OCR 只能发现可见文字，不能凭自身证明版权、商标、肖像权或作品整体相似性。

## 可选检查器

`VISUAL_SIMILARITY_ENDPOINT` 和 `PUBLIC_FIGURE_ENDPOINT` 可接入视觉相似度或公众人物识别服务。服务收到 JSON：

```json
{"imageBase64":"...","mimeType":"image/jpeg","metadata":{"source":"/api/media/example.mp4","frame":2,"timestampSeconds":5}}
```

响应格式：

```json
{"modelVersion":"model-revision","findings":[{"label":"candidate","confidence":0.92,"action":"BLOCK","evidence":{}}]}
```

未配置、超时或服务失败会记为 `UNAVAILABLE` 和 `REVIEW_REQUIRED`，绝不会记为 `PASS`。

## 门禁

- `FAIL/BLOCKED`：明确水印、已知高风险 IP/品牌文字，或可选模型返回 `BLOCK`。阶段 Artifact 不会被接受，用户可以修改提示词或素材后重试。
- `CONDITIONAL_PASS/REVIEW_REQUIRED`：OCR 低置信度、检测器不可用、视觉模型低风险命中或上传素材权利信息不完整。
- `PASS`：实际配置的所有检查器均完成且没有发现风险。由于自动检查的固有限制，报告仍不构成法律意见。

## 环境变量

```dotenv
OCR_BIN=tesseract
OCR_LANG=eng+chi_sim
VISUAL_SIMILARITY_ENDPOINT=
PUBLIC_FIGURE_ENDPOINT=
VISUAL_COMPLIANCE_API_KEY=
```

Docker 镜像已安装 Tesseract 及中英文语言包。Windows 本地运行需要自行安装 Tesseract，并让 `OCR_BIN` 指向可执行文件。

上传素材可携带 `source`、`license`、`authorized` 和 `authorizationEvidence`。字段缺失时报告保持 `UNKNOWN` 并要求人工确认，不会自动视为已授权。
