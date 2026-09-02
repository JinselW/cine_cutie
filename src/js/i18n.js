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

  'ui.planningTitle': 'Creative Direction',
  'ui.planningTheme': 'Theme',
  'ui.planningTone': 'Tone',
  'ui.planningDirection': 'Creative Direction',
  'ui.planningKeyElements': 'Key Elements',
  'ui.planningReferences': 'Visual References',
  'ui.approvePlan': 'Approve Plan',

  'steps.planning.label': 'Creative Planning',
  'steps.planning.agent': 'Creative Planner',
  'steps.planning.gen.0': 'Analyzing your idea...',
  'steps.planning.gen.1': 'Identifying themes...',
  'steps.planning.gen.2': 'Setting creative direction...',
  'steps.planning.gen.3': 'Building the plan...',
  'steps.screenplay.label': 'Screenplay',
  'steps.screenplay.agent': 'Scriptwriter',
  'steps.screenplay.gen.0': 'Crafting your story...',
  'steps.screenplay.gen.1': 'Developing plot twists...',
  'steps.screenplay.gen.2': 'Polishing dialogue...',
  'steps.screenplay.gen.3': 'Structuring scenes...',
  'steps.characters.label': 'Character Design',
  'steps.characters.agent': 'Character Designer',
  'steps.characters.gen.0': 'Designing unique characters...',
  'steps.characters.gen.1': 'Giving them souls...',
  'steps.characters.gen.2': 'Adding depth...',
  'steps.characters.gen.3': 'Perfecting details...',
  'steps.visualDesign.label': 'Visual Design',
  'steps.visualDesign.agent': 'Art Director',
  'steps.visualDesign.gen.0': 'Choosing color palette...',
  'steps.visualDesign.gen.1': 'Setting visual tone...',
  'steps.visualDesign.gen.2': 'Designing atmosphere...',
  'steps.visualDesign.gen.3': 'Building mood boards...',
  'steps.storyboard.label': 'Storyboard',
  'steps.storyboard.agent': 'Storyboard Artist',
  'steps.storyboard.gen.0': 'Composing visual frames...',
  'steps.storyboard.gen.1': 'Setting the mood...',
  'steps.storyboard.gen.2': 'Arranging shots...',
  'steps.storyboard.gen.3': 'Building atmosphere...',
  'steps.shotGen.label': 'Shot Generation',
  'steps.shotGen.agent': 'Shot Director',
  'steps.shotGen.gen.0': 'Setting up camera angles...',
  'steps.shotGen.gen.1': 'Rolling Take 1...',
  'steps.shotGen.gen.2': 'Adjusting lighting...',
  'steps.shotGen.gen.3': 'Capturing Take 3...',
  'steps.shotCuration.label': 'Shot Curation',
  'steps.shotCuration.agent': 'Shot Curator',
  'steps.shotCuration.gen.0': 'Reviewing compositions...',
  'steps.shotCuration.gen.1': 'Evaluating emotional impact...',
  'steps.shotCuration.gen.2': 'Selecting best takes...',
  'steps.shotCuration.gen.3': 'Finalizing selections...',
  'steps.editing.label': 'Editing',
  'steps.editing.agent': 'Film Editor',
  'steps.editing.gen.0': 'Assembling selected shots...',
  'steps.editing.gen.1': 'Adding transitions...',
  'steps.editing.gen.2': 'Adjusting pacing...',
  'steps.editing.gen.3': 'Fine-tuning cuts...',
  'steps.audio.label': 'Audio Design',
  'steps.audio.agent': 'Composer',
  'steps.audio.gen.0': 'Composing main theme...',
  'steps.audio.gen.1': 'Adding sound effects...',
  'steps.audio.gen.2': 'Mixing dialogue...',
  'steps.audio.gen.3': 'Balancing audio levels...',
  'steps.postProduction.label': 'Post-Production',
  'steps.postProduction.agent': 'Post-Production Artist',
  'steps.postProduction.gen.0': 'Color grading...',
  'steps.postProduction.gen.1': 'Adding visual effects...',
  'steps.postProduction.gen.2': 'Final audio mix...',
  'steps.postProduction.gen.3': 'Rendering final cut...',
  'steps.final.label': 'Final Film',
  'steps.final.agent': 'Director',
  'steps.final.gen.0': 'Final touches...',
  'steps.final.gen.1': 'Encoding video...',
  'steps.final.gen.2': 'Adding soundtrack...',
  'steps.final.gen.3': 'Almost there...',

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
  'log.back': '← Back'
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

  'ui.planningTitle': '创意方向',
  'ui.planningTheme': '主题',
  'ui.planningTone': '基调',
  'ui.planningDirection': '创意方向',
  'ui.planningKeyElements': '关键要素',
  'ui.planningReferences': '视觉参考',
  'ui.approvePlan': '确认规划',

  'steps.planning.label': '创意规划',
  'steps.planning.agent': '创意策划师',
  'steps.planning.gen.0': '分析你的想法...',
  'steps.planning.gen.1': '识别主题...',
  'steps.planning.gen.2': '设定创意方向...',
  'steps.planning.gen.3': '构建计划...',
  'steps.screenplay.label': '剧本',
  'steps.screenplay.agent': '编剧',
  'steps.screenplay.gen.0': '正在构思故事...',
  'steps.screenplay.gen.1': '设计剧情反转...',
  'steps.screenplay.gen.2': '打磨对白...',
  'steps.screenplay.gen.3': '构建场景结构...',
  'steps.characters.label': '角色设计',
  'steps.characters.agent': '角色设计师',
  'steps.characters.gen.0': '设计独特角色...',
  'steps.characters.gen.1': '赋予灵魂...',
  'steps.characters.gen.2': '增加深度...',
  'steps.characters.gen.3': '完善细节...',
  'steps.visualDesign.label': '视觉设计',
  'steps.visualDesign.agent': '美术总监',
  'steps.visualDesign.gen.0': '选择色彩方案...',
  'steps.visualDesign.gen.1': '设定视觉基调...',
  'steps.visualDesign.gen.2': '设计氛围...',
  'steps.visualDesign.gen.3': '构建情绪板...',
  'steps.storyboard.label': '分镜',
  'steps.storyboard.agent': '分镜师',
  'steps.storyboard.gen.0': '构图画面帧...',
  'steps.storyboard.gen.1': '营造氛围...',
  'steps.storyboard.gen.2': '排列镜头...',
  'steps.storyboard.gen.3': '构建整体节奏...',
  'steps.shotGen.label': '镜头生成',
  'steps.shotGen.agent': '镜头导演',
  'steps.shotGen.gen.0': '设置机位角度...',
  'steps.shotGen.gen.1': '拍摄第一条...',
  'steps.shotGen.gen.2': '调整灯光...',
  'steps.shotGen.gen.3': '捕捉第三条...',
  'steps.shotCuration.label': '镜头甄选',
  'steps.shotCuration.agent': '镜头策展人',
  'steps.shotCuration.gen.0': '审查构图...',
  'steps.shotCuration.gen.1': '评估情感表达...',
  'steps.shotCuration.gen.2': '挑选最佳镜头...',
  'steps.shotCuration.gen.3': '最终确认...',
  'steps.editing.label': '剪辑',
  'steps.editing.agent': '剪辑师',
  'steps.editing.gen.0': '组装选定镜头...',
  'steps.editing.gen.1': '添加转场效果...',
  'steps.editing.gen.2': '调整节奏...',
  'steps.editing.gen.3': '精修剪辑...',
  'steps.audio.label': '音频设计',
  'steps.audio.agent': '作曲家',
  'steps.audio.gen.0': '创作主题旋律...',
  'steps.audio.gen.1': '添加音效...',
  'steps.audio.gen.2': '混音对白...',
  'steps.audio.gen.3': '平衡音频层次...',
  'steps.postProduction.label': '后期制作',
  'steps.postProduction.agent': '后期制作师',
  'steps.postProduction.gen.0': '调色中...',
  'steps.postProduction.gen.1': '添加视觉特效...',
  'steps.postProduction.gen.2': '最终混音...',
  'steps.postProduction.gen.3': '渲染最终成片...',
  'steps.final.label': '最终影片',
  'steps.final.agent': '导演',
  'steps.final.gen.0': '最后润色...',
  'steps.final.gen.1': '编码视频中...',
  'steps.final.gen.2': '添加配乐...',
  'steps.final.gen.3': '马上完成...',

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
  'log.back': '← 返回'
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

  const fileUploadSpan = document.querySelector('.file-upload > span');
  if (fileUploadSpan) fileUploadSpan.textContent = t('ui.fileUpload');

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

  const settingsTitle = $('#settingsTitle');
  if (settingsTitle) settingsTitle.textContent = t('settings.title');
  const lblEndpoint = $('#lblEndpoint');
  if (lblEndpoint) lblEndpoint.textContent = t('settings.endpoint');
  const lblApiKey = $('#lblApiKey');
  if (lblApiKey) lblApiKey.textContent = t('settings.apiKey');
  const lblModel = $('#lblModel');
  if (lblModel) lblModel.textContent = t('settings.model');
  const lblJsonMode = $('#lblJsonMode');
  if (lblJsonMode) lblJsonMode.textContent = t('settings.jsonMode');
  const lblProxy = $('#lblProxy');
  if (lblProxy) lblProxy.textContent = t('settings.proxy');
  const testConnText = $('#testConnText');
  if (testConnText) testConnText.textContent = t('settings.test');
  const saveSettingsText = $('#saveSettingsText');
  if (saveSettingsText) saveSettingsText.textContent = t('settings.save');
}
