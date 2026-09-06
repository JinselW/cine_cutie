import { state } from './state.js';
import { $, $$ } from './utils.js';

const en = {
  'ui.subtitle': 'Your AI Movie Creation Agent',
  'ui.sectionTitle': '🎬 Tell me your story idea',
  'ui.placeholder': 'One sentence, a paragraph, or a wild idea — anything that sparks your imagination...\n\ne.g. "A shy librarian discovers she can enter books and meet their characters"',
  'ui.fileUpload': '📎 Drop files here or click to upload (images, audio, video, text)',
  'ui.modeAutoLabel': '🚀 Auto Pilot',
  'ui.modeAutoDesc': 'Sit back and watch the magic unfold',
  'ui.modeCoLabel': '🤝 Co-Create',
  'ui.modeCoDesc': 'Collaborate step by step, your vision matters',
  'ui.startBtn': '✨ Lights, Camera, Action!',
  'ui.starting': '🎬 Starting production...',
  'ui.approve': 'Approve & Continue',
  'ui.revise': '🔄 Revise This Step',
  'ui.feedbackPlaceholder': 'Share your thoughts about this step...',
  'ui.feedbackHint': '💡 Be specific about what you\'d like changed.',
  'ui.editDirectly': '✏️ Edit Directly',
  'ui.saveEdits': '💾 Save Edits',
  'ui.nextStep': 'Next Step →',
  'ui.alertFeedback': 'Please share what you\'d like to change!',
  'ui.selected': 'SELECTED',
  'ui.totalRuntime': 'Total Runtime',
  'ui.pacing': 'Pacing',
  'ui.clickPlay': 'Click play to preview your film',
  'ui.scenes': 'scenes',
  'ui.theEnd': '🎬 The End',
  'ui.filmComplete': 'Your film is complete!',
  'ui.createAnother': '🎬 Create Another Film',
  'ui.exportProject': '📥 Export Project',
  'ui.finalize': '🎉 Finalize Film',
  'ui.receivedFeedback': 'Received your feedback! Revising {step} based on: "<em>{feedback}</em>"',
  'ui.revisionComplete': 'Revision complete! Take a look and let me know if this is closer to your vision.',
  'ui.genreHint': ' — I\'m sensing a <em>{genre}</em> vibe!',
  'ui.modeAutoHint': 'Sit back and relax — I\'ll handle everything from script to screen.',
  'ui.modeCoHint': 'We\'ll create this together! I\'ll check in with you at each step.',
  'ui.welcome': '<strong>Cine-Cutie here!</strong> I love your idea{genreHint} {modeHint} Let\'s get started! ✨',
  'ui.agentWorking': '{agent} is working...',
  'ui.scene': 'Scene',
  'ui.take': 'Take',
  'ui.theme': 'Theme',
  'ui.instruments': 'Instruments',
  'ui.mood': 'Mood',
  'ui.musicDirection': '🎵 Music Direction',
  'ui.sceneAudio': '🔊 Scene-by-Scene Audio',
  'ui.mixNotes': '🎚️ Mix Notes',
  'ui.visualEffects': '✨ Visual Effects',
  'ui.finalMix': '🔊 Final Mix & Output',
  'ui.lighting': '💡 Lighting',
  'ui.cameraStyle': '📷 Camera Style',
  'ui.editTimeline': '✂️ Edit Timeline',
  'ui.approveCharacters': 'Approve Characters',
  'ui.approveDesign': 'Approve Design',
  'ui.approveStoryboard': 'Approve Storyboard',
  'ui.approveShots': 'Approve Shots',
  'ui.approveSelections': 'Approve Selections',
  'ui.approveEdit': 'Approve Edit',
  'ui.approveAudio': 'Approve Audio',
  'ui.approvePost': 'Approve Post',
  'ui.dialogue': 'Dialogue',
  'ui.music': 'Music',
  'ui.sfx': 'SFX',
  'ui.mix': 'Mix',
  'ui.output': 'Output',
  'ui.duration': 'Duration',
  'ui.aspectRatio': 'Aspect Ratio',
  'ui.resolution': 'Resolution',
  'ui.pause': 'Pause',
  'ui.resume': 'Resume',
  'ui.stop': 'Stop',
  'ui.stepPaused': 'Paused',

  'ui.planningTitle': 'Creative Direction',
  'ui.planningTheme': 'Theme',
  'ui.planningTone': 'Tone',
  'ui.planningDirection': 'Creative Direction',
  'ui.planningKeyElements': 'Key Elements',
  'ui.planningReferences': 'Visual References',
  'ui.approvePlan': 'Approve Plan',

  'steps.script.label': 'Script',
  'steps.script.agent': 'Scriptwriter',
  'steps.script.gen.0': 'Analyzing your idea...',
  'steps.script.gen.1': 'Developing characters...',
  'steps.script.gen.2': 'Structuring scenes...',
  'steps.script.gen.3': 'Polishing the script...',
  'steps.characterDesign.label': 'Character & Scene Design',
  'steps.characterDesign.agent': 'Character Designer',
  'steps.characterDesign.gen.0': 'Designing characters...',
  'steps.characterDesign.gen.1': 'Creating scene concepts...',
  'steps.characterDesign.gen.2': 'Adding visual details...',
  'steps.characterDesign.gen.3': 'Finalizing designs...',
  'steps.storyboard.label': 'Storyboard',
  'steps.storyboard.agent': 'Storyboard Artist',
  'steps.storyboard.gen.0': 'Breaking down scenes...',
  'steps.storyboard.gen.1': 'Planning shot sequences...',
  'steps.storyboard.gen.2': 'Defining camera angles...',
  'steps.storyboard.gen.3': 'Building the storyboard...',
  'steps.referenceImages.label': 'Reference Images',
  'steps.referenceImages.agent': 'Image Director',
  'steps.referenceImages.gen.0': 'Preparing image prompts...',
  'steps.referenceImages.gen.1': 'Generating reference frames...',
  'steps.referenceImages.gen.2': 'Evaluating compositions...',
  'steps.referenceImages.gen.3': 'Finalizing references...',
  'steps.videoGeneration.label': 'Video Generation',
  'steps.videoGeneration.agent': 'Video Director',
  'steps.videoGeneration.gen.0': 'Setting up shots...',
  'steps.videoGeneration.gen.1': 'Generating video clips...',
  'steps.videoGeneration.gen.2': 'Reviewing motion quality...',
  'steps.videoGeneration.gen.3': 'Finalizing clips...',
  'steps.postProduction.label': 'Post-Production',
  'steps.postProduction.agent': 'Post-Production Artist',
  'steps.postProduction.gen.0': 'Assembling clips...',
  'steps.postProduction.gen.1': 'Adding transitions...',
  'steps.postProduction.gen.2': 'Color grading...',
  'steps.postProduction.gen.3': 'Rendering final video...',

  'quality.needs-work': 'Needs Work',
  'quality.good': 'Good',
  'quality.great': 'Great',
  'quality.perfect': 'Perfect',

  'ui.screenplayHeader': '📝 Screenplay — {title}',
  'ui.visualStyleHeader': '🎨 Visual Style — {style}',
  'ui.colorGradingHeader': '🎬 Color Grading — {name}',
  'ui.scenePrefix': 'Scene {num}',
  'ui.takePrefix': 'Take {num}',
  'ui.takeSelected': 'Take {num} — SELECTED',
  'ui.durationLabel': 'Duration',
  'ui.durationInputLabel': 'Total Duration (seconds)',
  'ui.durationInputHint': 'Each clip is ~5s, will generate {count} shots',
  'ui.na': 'N/A',

  'settings.title': 'AI Model Settings',
  'settings.endpoint': 'API Endpoint',
  'settings.apiKey': 'API Key',
  'settings.model': 'Model',
  'settings.jsonMode': 'JSON Mode',
  'settings.proxy': 'Use Proxy Server',
  'settings.test': 'Test Connection',
  'settings.testing': 'Testing...',
  'settings.testOk': 'Connection successful!',
  'settings.save': 'Save',
  'settings.saved': 'Settings saved!',
  'settings.llmOn': 'LLM configured',
  'settings.llmOff': 'LLM not configured',
  'settings.dashscopeTitle': 'DashScope Settings',
  'settings.dashscopeKey': 'DashScope API Key',
  'settings.dashscopeImageModel': 'Image Model',
  'settings.dashscopeVideoModel': 'Video Model',
  'settings.dashscopeOn': 'DashScope configured',
  'settings.dashscopeOff': 'DashScope not configured',

  'settings.apiSettings': 'API Settings',
  'settings.modelSelection': 'Model Selection',
  'settings.textModel': 'Text & Evaluation Model',
  'settings.textModelHint': '(for script, storyboard & media scoring — vision model recommended for images/video)',
  'settings.imageModelLabel': 'Text-to-Image Model',
  'settings.videoModelLabel': 'Image-to-Video Model',
  'settings.refVideoModelLabel': 'Reference-to-Video Model',
  'settings.customModel': 'Custom...',
  'settings.customModelPlaceholder': 'Model name...',

  'ui.approveScript': 'Approve Script',
  'ui.approveCharacterDesign': 'Approve Design',
  'ui.approveStoryboard': 'Approve Storyboard',
  'ui.approveReferenceImages': 'Approve References',
  'ui.approveVideoGeneration': 'Approve Videos',
  'ui.approvePostProduction': 'Approve Final',

  'ui.scriptTitle': 'Script — {title}',
  'ui.scriptLogline': 'Logline',
  'ui.scriptCharacters': 'Characters',
  'ui.scriptSettings': 'Settings',
  'ui.scriptEpisodes': 'Episodes',

  'ui.charDesignTitle': 'Character & Scene Design',
  'ui.charDesignCharacters': 'Characters',
  'ui.charDesignSettings': 'Scenes',
  'ui.charDesignNoImage': 'No image generated',
  'ui.charDesignConfigNeeded': 'Configure DashScope API Key to generate images',

  'ui.storyboardTitle': 'Storyboard',
  'ui.storyboardEpisode': 'Episode {num}',
  'ui.storyboardShot': 'Shot {num}',
  'ui.storyboardDuration': '{seconds}s',

  'ui.refImagesTitle': 'Reference Images',
  'ui.refImagesConfigNeeded': 'Configure DashScope API Key to generate reference images',
  'ui.refImagesGenerating': 'Generating image {current}/{total}...',
  'ui.refImagesPending': 'Pending',
  'ui.refImagesComplete': 'Complete',

  'ui.videoGenTitle': 'Video Generation',
  'ui.videoGenConfigNeeded': 'Configure DashScope API Key to generate videos',
  'ui.videoGenGenerating': 'Generating clip {current}/{total}...',
  'ui.videoGenPending': 'Pending',
  'ui.videoGenComplete': 'Complete',

  'ui.postProdTitle': 'Final Video',
  'ui.postProdConfigNeeded': 'Configure DashScope API Key to render final video',
  'ui.postProdRendering': 'Rendering final video...',
  'ui.postProdDownload': 'Download Video',
  'ui.postProdNoClips': 'No video clips available',
  'ui.postProdComplete': 'Final video rendered!',
  'ui.charDesignGenerating': 'Generating {total} character/scene images...',

  'llm.notConfiguredFallback': 'LLM not configured, using templates...',
  'llm.fellBack': 'LLM error, fell back to templates: {reason}',
  'llm.errAuth': 'Authentication failed',
  'llm.errRateLimit': 'Rate limit exceeded',
  'llm.errNetwork': 'Network error (check CORS/endpoint)',
  'llm.errTimeout': 'Request timed out',
  'llm.errParse': 'Failed to parse JSON response',
  'llm.errHttp': 'HTTP error',
  'llm.errSchema': 'Response did not match expected schema',

  'critique.scoreDisplay': 'Quality score: {score}/10',
  'critique.retrying': 'Score {score}/10 below threshold — retrying ({retry}/{max})...',

  'log.title': 'Execution Log',
  'log.viewLog': 'Execution Log',
  'log.stepsCompleted': 'Steps',
  'log.totalTokens': 'Total Tokens',
  'log.avgQuality': 'Avg Quality',
  'log.totalDuration': 'Total Time',
  'log.step': 'Step',
  'log.agent': 'Agent',
  'log.duration': 'Duration',
  'log.tokens': 'Tokens',
  'log.quality': 'Quality',
  'log.retries': 'Retries',
  'log.fallback': 'Fallback',
  'log.back': '← Back',

  'style.cinematic': 'Cinematic',
  'style.fantasy': 'Fantasy',
  'style.scifi': 'Sci-Fi',
  'style.anime': 'Anime',
  'style.noir': 'Noir',
  'style.horror': 'Horror',
  'style.romance': 'Romance',
  'style.comedy': 'Comedy',
  'style.adventure': 'Adventure',
  'style.documentary': 'Documentary',
  'style.custom': 'Custom',
  'ui.lblVisualStyle': 'Visual Style',
  'ui.customStylePlaceholder': 'Describe your style...',
  'ui.slotFirstFrame': 'First Frame',
  'ui.slotLastFrame': 'Last Frame',
  'ui.slotRefImages': 'Reference Images',
  'ui.slotDropHint': 'Drop or click to upload',
  'ui.slotNeedFirstForLast': 'Please set first frame before setting last frame',
  'ui.uploadModeI2v': 'Image-to-Video mode (wan2.7-i2v)',
  'ui.uploadModeR2v': 'Reference-to-Video mode (wan2.7-r2v)',
  'ui.uploading': 'Uploading files...',
  'ui.uploadErrorSize': 'File too large (max 10MB)',
  'ui.uploadErrorMaxRef': 'Maximum 5 reference images'
};

const zh = {
  'ui.subtitle': '你的AI电影创作助手',
  'ui.sectionTitle': '🎬 告诉我你的故事灵感',
  'ui.placeholder': '一句话、一段话、或者一个疯狂的想法——任何能激发你想象力的东西...\n\n比如："一个害羞的图书管理员发现自己可以进入书中，与角色互动"',
  'ui.fileUpload': '📎 拖拽文件到此处或点击上传（图片、音频、视频、文本）',
  'ui.modeAutoLabel': '🚀 自动模式',
  'ui.modeAutoDesc': '坐好，看魔法展开',
  'ui.modeCoLabel': '🤝 协作模式',
  'ui.modeCoDesc': '一步步协作，你的想法很重要',
  'ui.startBtn': '✨ 开拍！',
  'ui.starting': '🎬 正在启动制作...',
  'ui.approve': '确认并继续',
  'ui.revise': '🔄 修改这一步',
  'ui.feedbackPlaceholder': '说说你对这一步的想法...',
  'ui.feedbackHint': '💡 请具体描述你希望修改的内容。',
  'ui.editDirectly': '✏️ 直接编辑',
  'ui.saveEdits': '💾 保存修改',
  'ui.nextStep': '下一步 →',
  'ui.alertFeedback': '请描述你希望修改的内容！',
  'ui.selected': '已选中',
  'ui.totalRuntime': '总时长',
  'ui.pacing': '节奏',
  'ui.clickPlay': '点击播放预览你的影片',
  'ui.scenes': '个场景',
  'ui.theEnd': '🎬 剧终',
  'ui.filmComplete': '你的影片完成了！',
  'ui.createAnother': '🎬 创作新影片',
  'ui.exportProject': '📥 导出项目',
  'ui.finalize': '🎉 完成影片',
  'ui.receivedFeedback': '收到你的反馈！正在根据以下内容修改{step}："<em>{feedback}</em>"',
  'ui.revisionComplete': '修改完成！看看是否更接近你的想法。',
  'ui.genreHint': '——我感受到了<em>{genre}</em>的氛围！',
  'ui.modeAutoHint': '放松坐好——从剧本到成片我来搞定。',
  'ui.modeCoHint': '我们一起创作！每一步都会和你确认。',
  'ui.welcome': '<strong>Cine-Cutie 来了！</strong>我喜欢你的想法{genreHint} {modeHint}让我们开始吧！✨',
  'ui.agentWorking': '{agent}正在工作...',
  'ui.scene': '场景',
  'ui.take': '镜头',
  'ui.theme': '主题',
  'ui.instruments': '乐器',
  'ui.mood': '情绪',
  'ui.musicDirection': '🎵 音乐方向',
  'ui.sceneAudio': '🔊 逐场景音频',
  'ui.mixNotes': '🎚️ 混音笔记',
  'ui.visualEffects': '✨ 视觉特效',
  'ui.finalMix': '🔊 最终混音与输出',
  'ui.lighting': '💡 灯光',
  'ui.cameraStyle': '📷 摄影风格',
  'ui.editTimeline': '✂️ 剪辑时间线',
  'ui.approveCharacters': '确认角色',
  'ui.approveDesign': '确认设计',
  'ui.approveStoryboard': '确认分镜',
  'ui.approveShots': '确认镜头',
  'ui.approveSelections': '确认选择',
  'ui.approveEdit': '确认剪辑',
  'ui.approveAudio': '确认音频',
  'ui.approvePost': '确认后期',
  'ui.dialogue': '对白',
  'ui.music': '音乐',
  'ui.sfx': '音效',
  'ui.mix': '混音',
  'ui.output': '输出',
  'ui.duration': '时长',
  'ui.aspectRatio': '画面比例',
  'ui.resolution': '分辨率',
  'ui.pause': '暂停',
  'ui.resume': '继续',
  'ui.stop': '停止',
  'ui.stepPaused': '已暂停',

  'ui.planningTitle': '创意方向',
  'ui.planningTheme': '主题',
  'ui.planningTone': '基调',
  'ui.planningDirection': '创意方向',
  'ui.planningKeyElements': '关键要素',
  'ui.planningReferences': '视觉参考',
  'ui.approvePlan': '确认规划',

  'steps.script.label': '剧本策划',
  'steps.script.agent': '编剧',
  'steps.script.gen.0': '分析你的想法...',
  'steps.script.gen.1': '塑造角色...',
  'steps.script.gen.2': '构建场景...',
  'steps.script.gen.3': '打磨剧本...',
  'steps.characterDesign.label': '角色/场景设计',
  'steps.characterDesign.agent': '角色设计师',
  'steps.characterDesign.gen.0': '设计角色形象...',
  'steps.characterDesign.gen.1': '创建场景概念...',
  'steps.characterDesign.gen.2': '添加视觉细节...',
  'steps.characterDesign.gen.3': '完成设计...',
  'steps.storyboard.label': '分镜规划',
  'steps.storyboard.agent': '分镜师',
  'steps.storyboard.gen.0': '拆解场景...',
  'steps.storyboard.gen.1': '规划镜头序列...',
  'steps.storyboard.gen.2': '定义机位角度...',
  'steps.storyboard.gen.3': '构建分镜...',
  'steps.referenceImages.label': '参考图生成',
  'steps.referenceImages.agent': '图像导演',
  'steps.referenceImages.gen.0': '准备图像提示词...',
  'steps.referenceImages.gen.1': '生成参考帧...',
  'steps.referenceImages.gen.2': '评估构图...',
  'steps.referenceImages.gen.3': '完成参考图...',
  'steps.videoGeneration.label': '视频生成',
  'steps.videoGeneration.agent': '视频导演',
  'steps.videoGeneration.gen.0': '设置镜头...',
  'steps.videoGeneration.gen.1': '生成视频片段...',
  'steps.videoGeneration.gen.2': '检查动态质量...',
  'steps.videoGeneration.gen.3': '完成片段...',
  'steps.postProduction.label': '后期制作',
  'steps.postProduction.agent': '后期制作师',
  'steps.postProduction.gen.0': '组装片段...',
  'steps.postProduction.gen.1': '添加转场...',
  'steps.postProduction.gen.2': '调色中...',
  'steps.postProduction.gen.3': '渲染最终视频...',

  'quality.needs-work': '需改进',
  'quality.good': '良好',
  'quality.great': '优秀',
  'quality.perfect': '完美',

  'ui.screenplayHeader': '📝 剧本 — {title}',
  'ui.visualStyleHeader': '🎨 视觉风格 — {style}',
  'ui.colorGradingHeader': '🎬 调色 — {name}',
  'ui.scenePrefix': '场景 {num}',
  'ui.takePrefix': '镜头 {num}',
  'ui.takeSelected': '镜头 {num} — 已选中',
  'ui.durationLabel': '时长',
  'ui.durationInputLabel': '视频总时长（秒）',
  'ui.durationInputHint': '每个片段约 5 秒，将生成 {count} 个镜头',
  'ui.na': '无',

  'settings.title': 'AI 模型设置',
  'settings.endpoint': 'API 端点',
  'settings.apiKey': 'API 密钥',
  'settings.model': '模型',
  'settings.jsonMode': 'JSON 模式',
  'settings.proxy': '使用代理服务器',
  'settings.test': '测试连接',
  'settings.testing': '测试中...',
  'settings.testOk': '连接成功！',
  'settings.save': '保存',
  'settings.saved': '设置已保存！',
  'settings.llmOn': 'LLM 已配置',
  'settings.llmOff': 'LLM 未配置',
  'settings.dashscopeTitle': 'DashScope 设置',
  'settings.dashscopeKey': 'DashScope API 密钥',
  'settings.dashscopeImageModel': '图片模型',
  'settings.dashscopeVideoModel': '视频模型',
  'settings.dashscopeOn': 'DashScope 已配置',
  'settings.dashscopeOff': 'DashScope 未配置',

  'settings.apiSettings': 'API 设置',
  'settings.modelSelection': '模型选择',
  'settings.textModel': '文本及评估模型',
  'settings.textModelHint': '（用于剧本、分镜与图片/视频评分；图片/视频建议选视觉模型，如 qwen-vl-max / gpt-4o）',
  'settings.imageModelLabel': '文生图模型',
  'settings.videoModelLabel': '图生视频模型',
  'settings.refVideoModelLabel': '参考生视频模型',
  'settings.customModel': '自定义…',
  'settings.customModelPlaceholder': '输入模型名…',

  'ui.approveScript': '确认剧本',
  'ui.approveCharacterDesign': '确认设计',
  'ui.approveStoryboard': '确认分镜',
  'ui.approveReferenceImages': '确认参考图',
  'ui.approveVideoGeneration': '确认视频',
  'ui.approvePostProduction': '确认成片',

  'ui.scriptTitle': '剧本 — {title}',
  'ui.scriptLogline': '梗概',
  'ui.scriptCharacters': '角色',
  'ui.scriptSettings': '场景',
  'ui.scriptEpisodes': '分集',

  'ui.charDesignTitle': '角色/场景设计',
  'ui.charDesignCharacters': '角色',
  'ui.charDesignSettings': '场景',
  'ui.charDesignNoImage': '未生成图片',
  'ui.charDesignConfigNeeded': '请配置 DashScope API Key 以生成图片',

  'ui.storyboardTitle': '分镜规划',
  'ui.storyboardEpisode': '第 {num} 集',
  'ui.storyboardShot': '镜头 {num}',
  'ui.storyboardDuration': '{seconds}秒',

  'ui.refImagesTitle': '参考图生成',
  'ui.refImagesConfigNeeded': '请配置 DashScope API Key 以生成参考图',
  'ui.refImagesGenerating': '正在生成图片 {current}/{total}...',
  'ui.refImagesPending': '等待中',
  'ui.refImagesComplete': '已完成',

  'ui.videoGenTitle': '视频生成',
  'ui.videoGenConfigNeeded': '请配置 DashScope API Key 以生成视频',
  'ui.videoGenGenerating': '正在生成视频片段 {current}/{total}...',
  'ui.videoGenPending': '等待中',
  'ui.videoGenComplete': '已完成',

  'ui.postProdTitle': '最终视频',
  'ui.postProdConfigNeeded': '请配置 DashScope API Key 以渲染最终视频',
  'ui.postProdRendering': '正在渲染最终视频...',
  'ui.postProdDownload': '下载视频',
  'ui.postProdNoClips': '没有可用的视频片段',
  'ui.postProdComplete': '最终视频渲染完成！',
  'ui.charDesignGenerating': '正在生成 {total} 张角色/场景图片...',

  'llm.notConfiguredFallback': 'LLM 未配置，使用模板...',
  'llm.fellBack': 'LLM 错误，回退到模板：{reason}',
  'llm.errAuth': '认证失败',
  'llm.errRateLimit': '请求频率超限',
  'llm.errNetwork': '网络错误（检查 CORS/端点）',
  'llm.errTimeout': '请求超时',
  'llm.errParse': 'JSON 解析失败',
  'llm.errHttp': 'HTTP 错误',
  'llm.errSchema': '响应不符合预期格式',

  'critique.scoreDisplay': '质量评分：{score}/10',
  'critique.retrying': '评分 {score}/10 低于阈值——正在重试（{retry}/{max}）...',

  'log.title': '执行日志',
  'log.viewLog': '执行日志',
  'log.stepsCompleted': '完成步骤',
  'log.totalTokens': '总 Token',
  'log.avgQuality': '平均质量',
  'log.totalDuration': '总耗时',
  'log.step': '步骤',
  'log.agent': 'Agent',
  'log.duration': '耗时',
  'log.tokens': 'Token',
  'log.quality': '质量',
  'log.retries': '重试',
  'log.fallback': '回退',
  'log.back': '← 返回',

  'style.cinematic': '电影感',
  'style.fantasy': '奇幻',
  'style.scifi': '科幻',
  'style.anime': '动漫',
  'style.noir': '黑色电影',
  'style.horror': '恐怖',
  'style.romance': '浪漫',
  'style.comedy': '喜剧',
  'style.adventure': '冒险',
  'style.documentary': '纪录片',
  'style.custom': '自定义',
  'ui.lblVisualStyle': '视觉风格',
  'ui.customStylePlaceholder': '描述你想要的风格...',
  'ui.slotFirstFrame': '首帧图片',
  'ui.slotLastFrame': '尾帧图片',
  'ui.slotRefImages': '参考图',
  'ui.slotDropHint': '拖拽或点击上传',
  'ui.slotNeedFirstForLast': '请先设置首帧图片，再设置尾帧',
  'ui.uploadModeI2v': '图生视频模式 (wan2.7-i2v)',
  'ui.uploadModeR2v': '参考图生视频模式 (wan2.7-r2v)',
  'ui.uploading': '正在上传文件...',
  'ui.uploadErrorSize': '文件太大（最大 10MB）',
  'ui.uploadErrorMaxRef': '最多 5 张参考图'
};

const dicts = { en, zh };

export function t(key, params) {
  const dict = dicts[state.lang] || dicts.en;
  let str = dict[key] || dicts.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

export function getLang() {
  return state.lang;
}

export function applyLang() {
  const langBtn = $('#langToggle');
  if (langBtn) langBtn.textContent = state.lang === 'zh' ? 'EN' : '中';

  const subtitle = document.querySelector('.subtitle');
  if (subtitle) subtitle.textContent = t('ui.subtitle');

  const sectionTitle = document.querySelector('#inputSection .section-title');
  if (sectionTitle) sectionTitle.innerHTML = `<span class="icon">🎬</span> ${t('ui.sectionTitle').replace('🎬 ', '')}`;

  const textarea = $('#userInput');
  if (textarea) textarea.placeholder = t('ui.placeholder');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) el.textContent = val;
  });

  const modeAuto = $('#modeAuto');
  if (modeAuto) {
    modeAuto.querySelector('.mode-label').textContent = t('ui.modeAutoLabel');
    modeAuto.querySelector('.mode-desc').textContent = t('ui.modeAutoDesc');
  }
  const modeCo = $('#modeInteractive');
  if (modeCo) {
    modeCo.querySelector('.mode-label').textContent = t('ui.modeCoLabel');
    modeCo.querySelector('.mode-desc').textContent = t('ui.modeCoDesc');
  }

  const startBtn = $('#startBtn');
  if (startBtn && !startBtn.disabled) startBtn.textContent = t('ui.startBtn');

  const lblDuration = $('#lblDuration');
  if (lblDuration) lblDuration.textContent = t('ui.durationInputLabel');
  const durationHint = $('#durationHint');
  if (durationHint) {
    const val = Math.max(5, parseInt($('#totalDuration')?.value) || 30);
    const clips = Math.ceil(val / 5);
    durationHint.textContent = t('ui.durationInputHint', { count: clips });
  }

  const lblAspectRatio = $('#lblAspectRatio');
  if (lblAspectRatio) lblAspectRatio.textContent = t('ui.aspectRatio');

  const lblResolution = $('#lblResolution');
  if (lblResolution) lblResolution.textContent = t('ui.resolution');

  const lblVisualStyle = $('#lblVisualStyle');
  if (lblVisualStyle) lblVisualStyle.textContent = t('ui.lblVisualStyle');
  document.querySelectorAll('#styleOptions .style-btn').forEach(btn => {
    const span = btn.querySelector('span');
    const key = 'style.' + btn.dataset.style;
    if (span && span.textContent) span.textContent = t(key);
  });
  const customStyleInput = $('#customStyleInput');
  if (customStyleInput) customStyleInput.placeholder = t('ui.customStylePlaceholder');

  const settingsTitle = $('#settingsTitle');
  if (settingsTitle) settingsTitle.textContent = t('settings.title');
  const apiSettingsTitle = $('#apiSettingsTitle');
  if (apiSettingsTitle) apiSettingsTitle.textContent = t('settings.apiSettings');
  const modelSelectionTitle = $('#modelSelectionTitle');
  if (modelSelectionTitle) modelSelectionTitle.textContent = t('settings.modelSelection');

  const lblTextModel = $('#lblTextModel');
  if (lblTextModel && lblTextModel.firstChild) {
    lblTextModel.firstChild.nodeValue = `${t('settings.textModel')} `;
  }
  const textModelHint = $('#textModelHint');
  if (textModelHint) textModelHint.textContent = t('settings.textModelHint');
  const lblImageModelNew = $('#lblImageModel');
  if (lblImageModelNew) lblImageModelNew.textContent = t('settings.imageModelLabel');
  const lblVideoModelNew = $('#lblVideoModel');
  if (lblVideoModelNew) lblVideoModelNew.textContent = t('settings.videoModelLabel');
  const lblRefVideoModel = $('#lblRefVideoModel');
  if (lblRefVideoModel) lblRefVideoModel.textContent = t('settings.refVideoModelLabel');

  const customPlaceholder = t('settings.customModelPlaceholder');
  ['#cfgTextModelCustom', '#cfgImageModelCustom', '#cfgVideoModelCustom', '#cfgRefVideoModelCustom'].forEach(sel => {
    const el = $(sel);
    if (el) el.placeholder = customPlaceholder;
  });

  const lblJsonMode = $('#lblJsonMode');
  if (lblJsonMode) lblJsonMode.textContent = t('settings.jsonMode');
  const lblProxy = $('#lblProxy');
  if (lblProxy) lblProxy.textContent = t('settings.proxy');
  const testConnText = $('#testConnText');
  if (testConnText) testConnText.textContent = t('settings.test');
  const saveSettingsText = $('#saveSettingsText');
  if (saveSettingsText) saveSettingsText.textContent = t('settings.save');
}
