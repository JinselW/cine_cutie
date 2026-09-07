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
  'monitor.connected': 'Connected',
  'monitor.gpu': 'GPU utilization',
  'monitor.vram': 'GPU memory',
  'monitor.memory': 'System memory',
  'monitor.disk': 'Disk',
  'monitor.queue': 'Queue',
  'monitor.runningPending': 'running / pending',
  'monitor.gpuLoad': 'GPU load',
  'monitor.vramLoad': 'VRAM load',
  'monitor.memoryLoad': 'Memory usage',
  'monitor.diskLoad': 'Disk usage',
  'monitor.overall': 'Overall video progress',
  'monitor.waiting': 'Waiting for video task',
  'monitor.preparing': 'Preparing workflow and media',
  'monitor.phase.waiting': 'Waiting',
  'monitor.phase.connecting': 'Connecting to DGX Spark',
  'monitor.phase.uploading': 'Uploading input images',
  'monitor.phase.generating': 'Generating current clip',
  'monitor.phase.downloading': 'Downloading generated video',
  'monitor.phase.clip-complete': 'Clip completed',
  'monitor.phase.completed': 'Generation completed',
  'monitor.phase.cancelled': 'Generation cancelled',
  'monitor.phase.failed': 'Generation failed',
  'ui.resume': 'Resume',
  'ui.stop': 'Stop',
  'ui.stepPaused': 'Paused',
  'ui.stageBlocked': 'This step failed validation. The pipeline has stopped.',
  'ui.stageOutputFailed': 'Generation or quality validation failed.',
  'ui.backToInput': 'Back to input',
  'ui.sessionRestored': 'Restored your previous unfinished session — review it or start a new one',
  'ui.continueMaking': 'Continue Making',
  'ui.startOver': 'Start Over',

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
  'steps.characterDesign.gen.0': 'Writing design specs...',
  'steps.characterDesign.gen.1': 'Creating three-view model sheets...',
  'steps.characterDesign.gen.2': 'Generating scene images...',
  'steps.characterDesign.gen.3': 'Checking visual consistency...',
  'steps.storyboard.label': 'Storyboard',
  'steps.storyboard.agent': 'Storyboard Artist',
  'steps.storyboard.gen.0': 'Breaking down scenes...',
  'steps.storyboard.gen.1': 'Planning shot sequences...',
  'steps.storyboard.gen.2': 'Defining camera angles...',
  'steps.storyboard.gen.3': 'Building the storyboard...',
  'steps.referenceImages.label': 'Image Generation',
  'steps.referenceImages.agent': 'Image Director',
  'steps.referenceImages.gen.0': 'Combining script, designs and storyboard...',
  'steps.referenceImages.gen.1': 'Generating frames for the video mode...',
  'steps.referenceImages.gen.2': 'Evaluating compositions...',
  'steps.referenceImages.gen.3': 'Finalizing frames...',
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
  'settings.comfySshHost': 'SSH Host',
  'settings.comfySshPort': 'SSH Port',
  'settings.comfySshUser': 'Username',
  'settings.comfyPort': 'ComfyUI Port',
  'settings.comfyLightning': 'Enable Lightning LoRA (faster, fewer steps)',
  'settings.required': '{field} is required',
  'settings.comfyHostRequired': 'ComfyUI: Host is required',
  'settings.comfyConnected': 'ComfyUI: Connected (GPU {gpu})',
  'settings.comfyOffline': 'ComfyUI: Offline ({reason})',
  'settings.comfyError': 'ComfyUI: {reason}',
  'settings.llmTestPrefix': 'LLM: {result}',
  'ui.toggleTheme': 'Toggle theme',
  'ui.switchLanguage': 'Switch language',
  'ui.mascotHint': 'Click me!',
  'ui.defaultFilmTitle': 'Your Film',
  'ui.untitled': 'Untitled',
  'ui.unknown': 'Unknown',

  'settings.apiSettings': 'API Settings',
  'settings.modelSelection': 'Model Selection',
  'settings.textModel': 'Text & Evaluation Model',
  'settings.textModelHint': '(for script, storyboard & media scoring — vision model recommended for images/video)',
  'settings.imageModelLabel': 'Text-to-Image Model',
  'settings.img2imgModelLabel': 'Image-to-Image Model',
  'settings.videoModeLabel': 'Video Generation Mode',
  'settings.videoMode.firstFrame': 'First Frame → Video',
  'settings.videoMode.firstLastFrame': 'First & Last Frames → Video',
  'settings.videoMode.referenceImage': 'Reference Image → Video',
  'settings.videoModeModel.firstFrame': 'First-Frame Video Model',
  'settings.videoModeModel.firstLastFrame': 'First & Last Frames Video Model',
  'settings.videoModeModel.referenceImage': 'Reference-Image Video Model',
  'settings.customModel': 'Custom...',
  'settings.customModelPlaceholder': 'Model name...',

  'ui.approveScript': 'Approve Script',
  'ui.approveCharacterDesign': 'Approve Design',
  'ui.approveStoryboard': 'Approve Storyboard',
  'ui.approveReferenceImages': 'Approve Images',
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
  'ui.charDesignWriting': 'Writing character & scene design specs...',
  'ui.charDesignSheet': 'Three-view model sheet (front / back / side)',
  'ui.charDesignFront': 'Front portrait (used as the video first frame)',

  'ui.storyboardTitle': 'Storyboard',
  'ui.storyboardEpisode': 'Episode {num}',
  'ui.storyboardShot': 'Shot {num}',
  'ui.storyboardDuration': '{seconds}s',

  'ui.refImagesTitle': 'Image Generation',
  'ui.refImagesConfigNeeded': 'Configure DashScope API Key to generate images',
  'ui.refImagesGenerating': 'Generating image {current}/{total}...',
  'ui.refImagesPending': 'Pending',
  'ui.refImagesComplete': 'Complete',
  'ui.refImagesModeLabel': 'Video mode:',
  'ui.refImagesLastFrameFrom': 'Last frame:',
  'ui.refImagesLastFrameReuse': 'reuses {shot} first frame',
  'ui.refImagesLastFrameGenerated': 'generated separately',
  'ui.refImagesExtraFrames': 'Extra closing frames',
  'ui.frameFirst': 'First frame',
  'ui.frameLast': 'Last frame',
  'ui.frameReference': 'Reference image',

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
  'ui.postProdFailed': 'Render failed',
  'ui.charDesignGenerating': 'Generating {total} character/scene images...',

  'pipeline.postGateStructural': 'Post-gate: {stepId} output failed structural validation',
  'pipeline.structuralFailed': 'Structural validation failed',
  'pipeline.noDataProduced': 'No data produced',
  'pipeline.consistencyFailed': 'Post-gate: {stepId} consistency check failed — {issues}',
  'pipeline.consistencyWarnings': 'Post-gate: {stepId} consistency warnings — {issues}',
  'pipeline.ipCompliance': 'IP Compliance: {issues}',
  'pipeline.missingUpstream': 'Cannot run {stepId}: no accepted upstream output for {dataKeys}',
  'pipeline.downstreamInvalidated': 'New version accepted. These steps consumed the previous version and must be regenerated: {steps}',

  'history.title': 'Creation History',
  'history.close': 'Close',
  'history.note': 'Automatically saves creation inputs, revision feedback, workflow results, and generated media references. Records are stored on the local server and shared by all users accessing this service.',
  'history.search': 'Search titles, stories, or workflow content',
  'history.refresh': 'Refresh',
  'history.selectRecord': 'Select a record to view.',
  'history.noRecords': 'No records yet. Starting a creation will automatically save.',
  'history.reading': 'Reading...',
  'history.recordsCount': '{count} records',
  'history.stepsWithResults': '{steps}/6 steps with results',
  'history.rename': 'Rename',
  'history.export': 'Export JSON',
  'history.delete': 'Delete Record',
  'history.userInput': 'Creation Input',
  'history.fromPrompt': 'Created from prompt file',
  'history.paramsAndPrompt': 'Creation Parameters & Prompt File',
  'history.sessionMessages': 'Session & Agent Messages ({count})',
  'history.fullSnapshot': 'Full Workflow Snapshot, Versions & Attempts',
  'history.newName': 'New record name',
  'history.stopFirst': 'Please stop the current creation before deleting this record.',
  'history.confirmDelete': 'Delete "{title}"? The session and workflow records will be permanently deleted, but media files on disk will be kept.',
  'history.deleted': 'Record deleted, media files retained.',
  'history.openMedia': 'Open media',
  'history.generatedMedia': 'Historically generated media',
  'history.statusRunning': 'Running / Last execution not finished',
  'history.statusCompleted': 'Process ended',
  'history.statusStopped': 'Stopped',
  'history.statusPaused': 'Paused',
  'history.statusFailed': 'Failed',
  'history.statusSaved': 'Saved',
  'history.retrySave': '{error}. Click to retry save',

  'settings.comfyUIOption': 'ComfyUI (DGX Spark / H3)',

  'llm.notConfiguredFallback': 'LLM not configured, using templates...',
  'llm.fellBack': 'LLM unavailable ({reason}), using templates instead — process continues normally',
  'llm.errAuth': 'Authentication failed',
  'llm.errRateLimit': 'Rate limit exceeded',
  'llm.errNetwork': 'Network error (check CORS/endpoint)',
  'llm.errCors': 'CORS error — enable "Use Proxy Server" in Settings',
  'llm.errTimeout': 'Request timed out',
  'llm.errParse': 'Failed to parse JSON response',
  'llm.errHttp': 'HTTP error',
  'llm.errSchema': 'Response did not match expected schema',

  'critique.scoreDisplay': 'Quality score: {score}/10',
  'critique.retrying': 'Score {score}/10 below threshold — retrying ({retry}/{max})...',
  'critique.retryBelowThreshold': 'The previous output scored below quality threshold.',
  'critique.retryIssuesFound': 'Issues found:',
  'critique.retrySuggestions': 'Suggestions for improvement:',
  'critique.retryRegenerate': 'Please regenerate the output addressing all issues.',

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
  'ui.slotPromptFile': 'Prompt Document',
  'ui.slotPromptFileHint': 'Click or drop .docx / .txt / .md (max 1 file)',
  'ui.promptFileParsing': 'Reading file...',
  'ui.promptFileMeta': '{count} chars',
  'ui.promptFileTruncated': ' (truncated to 20000 chars)'
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
  'monitor.connected': '已连接',
  'monitor.gpu': 'GPU 利用率',
  'monitor.vram': '显存',
  'monitor.memory': '系统内存',
  'monitor.disk': '磁盘',
  'monitor.queue': '任务队列',
  'monitor.runningPending': '运行中 / 等待中',
  'monitor.gpuLoad': 'GPU 负载',
  'monitor.vramLoad': '显存占用',
  'monitor.memoryLoad': '内存占用',
  'monitor.diskLoad': '磁盘占用',
  'monitor.overall': '视频整体进度',
  'monitor.waiting': '等待视频生成任务',
  'monitor.preparing': '正在准备工作流与素材',
  'monitor.phase.waiting': '等待任务',
  'monitor.phase.connecting': '正在连接 DGX Spark',
  'monitor.phase.uploading': '正在上传输入图片',
  'monitor.phase.generating': '正在生成当前片段',
  'monitor.phase.downloading': '正在下载视频产物',
  'monitor.phase.clip-complete': '当前片段已完成',
  'monitor.phase.completed': '视频生成完成',
  'monitor.phase.cancelled': '视频生成已取消',
  'monitor.phase.failed': '视频生成失败',
  'ui.resume': '继续',
  'ui.stop': '停止',
  'ui.stepPaused': '已暂停',
  'ui.stageBlocked': '当前步骤未通过检查，流程已停止。',
  'ui.stageOutputFailed': '生成结果或质量检查失败。',
  'ui.backToInput': '返回创作输入',
  'ui.sessionRestored': '已恢复上次未完成的会话，可查看进度或重新开拍',
  'ui.continueMaking': '继续制作',
  'ui.startOver': '重新开拍',

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
  'steps.characterDesign.gen.0': '撰写角色与场景设计稿...',
  'steps.characterDesign.gen.1': '生成三视图定妆图...',
  'steps.characterDesign.gen.2': '生成场景图...',
  'steps.characterDesign.gen.3': '校验视觉一致性...',
  'steps.storyboard.label': '分镜规划',
  'steps.storyboard.agent': '分镜师',
  'steps.storyboard.gen.0': '拆解场景...',
  'steps.storyboard.gen.1': '规划镜头序列...',
  'steps.storyboard.gen.2': '定义机位角度...',
  'steps.storyboard.gen.3': '构建分镜...',
  'steps.referenceImages.label': '图片生成',
  'steps.referenceImages.agent': '图像导演',
  'steps.referenceImages.gen.0': '融合剧本、设定图与分镜...',
  'steps.referenceImages.gen.1': '按视频生成方式产出帧图...',
  'steps.referenceImages.gen.2': '评估构图...',
  'steps.referenceImages.gen.3': '完成帧图...',
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
  'settings.comfySshHost': 'SSH 主机',
  'settings.comfySshPort': 'SSH 端口',
  'settings.comfySshUser': '用户名',
  'settings.comfyPort': 'ComfyUI 端口',
  'settings.comfyLightning': '启用 Lightning LoRA（速度更快、步数更少）',
  'settings.required': '请填写{field}',
  'settings.comfyHostRequired': 'ComfyUI：请填写主机地址',
  'settings.comfyConnected': 'ComfyUI：连接成功（GPU {gpu}）',
  'settings.comfyOffline': 'ComfyUI：离线（{reason}）',
  'settings.comfyError': 'ComfyUI：{reason}',
  'settings.llmTestPrefix': 'LLM：{result}',
  'ui.toggleTheme': '切换主题',
  'ui.switchLanguage': '切换语言',
  'ui.mascotHint': '点我试试！',
  'ui.defaultFilmTitle': '你的影片',
  'ui.untitled': '未命名',
  'ui.unknown': '未知',

  'settings.apiSettings': 'API 设置',
  'settings.modelSelection': '模型选择',
  'settings.textModel': '文本及评估模型',
  'settings.textModelHint': '（用于剧本、分镜与图片/视频评分；图片/视频建议选视觉模型，如 qwen-vl-max / gpt-4o）',
  'settings.imageModelLabel': '文生图模型',
  'settings.img2imgModelLabel': '图生图模型',
  'settings.videoModeLabel': '视频生成方式',
  'settings.videoMode.firstFrame': '首帧生视频',
  'settings.videoMode.firstLastFrame': '首尾帧生视频',
  'settings.videoMode.referenceImage': '参考图生视频',
  'settings.videoModeModel.firstFrame': '首帧生视频模型',
  'settings.videoModeModel.firstLastFrame': '首尾帧生视频模型',
  'settings.videoModeModel.referenceImage': '参考图生视频模型',
  'settings.customModel': '自定义…',
  'settings.customModelPlaceholder': '输入模型名…',

  'ui.approveScript': '确认剧本',
  'ui.approveCharacterDesign': '确认设计',
  'ui.approveStoryboard': '确认分镜',
  'ui.approveReferenceImages': '确认图片',
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
  'ui.charDesignWriting': '正在撰写角色与场景设计稿...',
  'ui.charDesignSheet': '三视图定妆图（正面 / 背面 / 侧面）',
  'ui.charDesignFront': '正面定妆图（用作视频首帧）',

  'ui.storyboardTitle': '分镜规划',
  'ui.storyboardEpisode': '第 {num} 集',
  'ui.storyboardShot': '镜头 {num}',
  'ui.storyboardDuration': '{seconds}秒',

  'ui.refImagesTitle': '图片生成',
  'ui.refImagesConfigNeeded': '请配置 DashScope API Key 以生成图片',
  'ui.refImagesGenerating': '正在生成图片 {current}/{total}...',
  'ui.refImagesPending': '等待中',
  'ui.refImagesComplete': '已完成',
  'ui.refImagesModeLabel': '视频生成方式：',
  'ui.refImagesLastFrameFrom': '尾帧：',
  'ui.refImagesLastFrameReuse': '复用 {shot} 的首帧',
  'ui.refImagesLastFrameGenerated': '独立生成',
  'ui.refImagesExtraFrames': '额外收尾帧',
  'ui.frameFirst': '首帧',
  'ui.frameLast': '尾帧',
  'ui.frameReference': '参考图',

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
  'ui.postProdFailed': '渲染失败',
  'ui.charDesignGenerating': '正在生成 {total} 张角色/场景图片...',

  'pipeline.postGateStructural': '后置检查：{stepId} 输出未通过结构验证',
  'pipeline.structuralFailed': '结构验证失败',
  'pipeline.noDataProduced': '未生成任何数据',
  'pipeline.consistencyFailed': '后置检查：{stepId} 一致性检查失败 — {issues}',
  'pipeline.consistencyWarnings': '后置检查：{stepId} 一致性警告 — {issues}',
  'pipeline.ipCompliance': 'IP 合规性：{issues}',
  'pipeline.missingUpstream': '无法执行 {stepId}：缺少已采用的上游产物 {dataKeys}',
  'pipeline.downstreamInvalidated': '已采用新版本。以下步骤使用了旧版本，需要重新生成：{steps}',

  'history.title': '创作历史',
  'history.close': '关闭',
  'history.note': '自动保存创作输入、修订反馈、工作流结果和生成素材引用。记录存于本机服务，所有访问此服务的用户共享。',
  'history.search': '搜索标题、故事或工作流内容',
  'history.refresh': '刷新',
  'history.selectRecord': '选择一条记录查看。',
  'history.noRecords': '暂无记录。开始一次创作后会自动保存。',
  'history.reading': '读取中…',
  'history.recordsCount': '{count} 条记录',
  'history.stepsWithResults': '{steps}/6 步有结果',
  'history.rename': '重命名',
  'history.export': '导出 JSON',
  'history.delete': '删除记录',
  'history.userInput': '创作输入',
  'history.fromPrompt': '通过提示词文件创作',
  'history.paramsAndPrompt': '创作参数与提示词文件',
  'history.sessionMessages': '会话与 Agent 消息 ({count})',
  'history.fullSnapshot': '完整工作流快照、版本与尝试记录',
  'history.newName': '新的记录名称',
  'history.stopFirst': '请先停止当前创作，再删除这条记录。',
  'history.confirmDelete': '删除"{title}"？会话和工作流记录将永久删除，磁盘上的媒体文件会保留。',
  'history.deleted': '记录已删除，媒体文件已保留。',
  'history.openMedia': '打开素材',
  'history.generatedMedia': '历史生成素材',
  'history.statusRunning': '运行中 / 上次执行未结束',
  'history.statusCompleted': '流程已结束',
  'history.statusStopped': '已停止',
  'history.statusPaused': '已暂停',
  'history.statusFailed': '失败',
  'history.statusSaved': '已保存',
  'history.retrySave': '{error}。点击重试保存',

  'settings.comfyUIOption': 'ComfyUI (DGX Spark / H3)',

  'llm.notConfiguredFallback': 'LLM 未配置，使用模板...',
  'llm.fellBack': 'LLM 不可用（{reason}），改用模板继续生成',
  'llm.errAuth': '认证失败',
  'llm.errRateLimit': '请求频率超限',
  'llm.errNetwork': '网络错误（检查 CORS/端点）',
  'llm.errCors': 'CORS 跨域错误 — 请在设置中启用"使用代理服务器"',
  'llm.errTimeout': '请求超时',
  'llm.errParse': 'JSON 解析失败',
  'llm.errHttp': 'HTTP 错误',
  'llm.errSchema': '响应不符合预期格式',

  'critique.scoreDisplay': '质量评分：{score}/10',
  'critique.retrying': '评分 {score}/10 低于阈值——正在重试（{retry}/{max}）...',
  'critique.retryBelowThreshold': '上一次输出的质量评分低于阈值。',
  'critique.retryIssuesFound': '发现的问题：',
  'critique.retrySuggestions': '改进建议：',
  'critique.retryRegenerate': '请针对所有问题重新生成输出。',

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
  'ui.slotPromptFile': '提示词文件',
  'ui.slotPromptFileHint': '点击或拖拽上传 .docx / .txt / .md（最多 1 个）',
  'ui.promptFileParsing': '正在读取文件...',
  'ui.promptFileMeta': '{count} 字',
  'ui.promptFileTruncated': '（已截断至 20000 字）'
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
  if (langBtn) {
    langBtn.textContent = state.lang === 'zh' ? 'EN' : '中';
    langBtn.title = t('ui.switchLanguage');
  }
  const settingsBtn = $('#settingsBtn');
  if (settingsBtn) settingsBtn.title = t('settings.title');
  const themeBtn = $('#themeToggle');
  if (themeBtn) themeBtn.title = t('ui.toggleTheme');
  const mascot = $('#mascot');
  if (mascot) mascot.title = t('ui.mascotHint');

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
  const lblImg2ImgModel = $('#lblImg2ImgModel');
  if (lblImg2ImgModel) lblImg2ImgModel.textContent = t('settings.img2imgModelLabel');

  const lblVideoMode = $('#lblVideoMode');
  if (lblVideoMode) lblVideoMode.textContent = t('settings.videoModeLabel');
  const videoModeSelect = $('#cfgVideoMode');
  if (videoModeSelect) {
    for (const opt of videoModeSelect.options) {
      opt.textContent = t('settings.videoMode.' + opt.value);
    }
  }
  const lblVideoModeModel = $('#lblVideoModeModel');
  if (lblVideoModeModel && videoModeSelect?.value) {
    lblVideoModeModel.textContent = t('settings.videoModeModel.' + videoModeSelect.value);
  }

  const customPlaceholder = t('settings.customModelPlaceholder');
  ['#cfgTextModelCustom', '#cfgImageModelCustom', '#cfgImg2ImgModelCustom', '#cfgVideoModeModelCustom'].forEach(sel => {
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
