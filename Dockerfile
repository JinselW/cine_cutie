# 前端构建：只需要 vite，不需要服务端依赖
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts 跳过 ffmpeg-static 的 install.js，避免从 GitHub Releases 拉二进制（国内构建网络常失败）。
# esbuild 的平台二进制来自 optionalDependencies，运行时由 require.resolve 直接定位，postinstall 仅做版本校验，
# 因此 --ignore-scripts 不影响 vite 构建。
RUN npm ci --ignore-scripts --registry=https://registry.npmmirror.com
COPY . .
RUN npm run build

# 运行时
FROM node:20-bookworm
WORKDIR /app

# 魔搭创空间要求服务监听 0.0.0.0:7860，端口暂不支持修改；容器内 8080 已被平台进程占用，勿改。
ENV HOST=0.0.0.0 \
    PORT=7860 \
    NODE_ENV=production \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    MEDIA_DIR=/mnt/workspace/media \
    MEMORY_DIR=/mnt/workspace/data/memory

# 用发行版 ffmpeg 替代 ffmpeg-static 的二进制下载；FFMPEG_BIN 让 ffmpeg-static 直接返回该路径。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY config ./config

EXPOSE 7860
CMD ["node", "server/index.js"]
