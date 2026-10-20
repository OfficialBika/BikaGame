'use strict';

const LANGUAGES = Object.freeze([
  { code: 'my', label: '🇲🇲 မြန်မာ', native: 'မြန်မာဘာသာ' },
  { code: 'en', label: '🇬🇧 English', native: 'English' },
  { code: 'cn', label: '🇨🇳 中文', native: '中文' },
  { code: 'jp', label: '🇯🇵 日本語', native: '日本語' },
  { code: 'kr', label: '🇰🇷 한국어', native: '한국어' },
  { code: 'fr', label: '🇫🇷 Français', native: 'Français' },
  { code: 'ru', label: '🇷🇺 Русский', native: 'Русский' },
  { code: 'hi', label: '🇮🇳 हिन्दी', native: 'हिन्दी' },
  { code: 'ar', label: '🇸🇦 العربية', native: 'العربية' },
]);
const DEFAULT_LANGUAGE = 'en';
const MESSAGES = {
  my: {
    choose_language: '🌐 <b>ဘာသာစကား ရွေးချယ်ပါ</b>\nသင်ရွေးထားသော ဘာသာစကားကို နောက်တစ်ကြိမ်အတွက်လည်း သိမ်းထားပေးမည်။',
    language_saved: '✅ ဘာသာစကားကို မြန်မာဘာသာအဖြစ် ပြောင်းပြီးပါပြီ။',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nသင့်ရဲ့ game ခရီးစဉ်ကို စတင်လိုက်ပါ။',
    user: '👤 User', owner: '🛡 Owner', game_chat: '🎮 Game Chat', channel: '📢 Channel',
    user_help: '👤 <b>أوامر المستخدم</b>\n/language — تغيير اللغة\n/dailyclaim — المكافأة اليومية\n/mybalance, /bal — عرض الرصيد\n/top10 — قائمة المتصدرين\n/shop — المتجر\n/wallet — المحفظة\n/gift — إهداء الرصيد\n/webapp — تطبيق الألعاب المصغّر\n/dailytournament — البطولة\n\nالألعاب: .slot و.crash و.mines و.bj و.shan و.dice و2D والمزادات والفعاليات',
    owner_help: '🛡 <b>أوامر المالك</b>\n/admin — لوحة الإدارة\n/status, /ping — الحالة وزمن الاستجابة\n/treasury — أدوات الخزينة\n/addbal, /rmbal — تعديل رصيد المستخدم\n/setrtp, /setbjrtp, /setvipwr — إعدادات RTP/VIP\n/promortp — RTP ترويجي\n/broadcast, /broadcastend — التحكم بالبث\n/off, /on — تشغيل/إيقاف الصيانة\n/approve, /reject, /groupstatus — إدارة المجموعات\n\nأوامر الإدارة متاحة للمالك فقط.',
    daily_done: '⏳ ဒီနေ့ Daily reward ကို ရယူပြီးပါပြီ။ မနက်ဖြန် ပြန်လာပါ။',
  },
  en: {
    choose_language: '🌐 <b>Choose your language</b>\nYour choice will be saved for future visits.',
    language_saved: '✅ Language changed to English.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nWelcome! Choose a menu below to continue.',
    user: '👤 User', owner: '🛡 Owner', game_chat: '🎮 Game Chat', channel: '📢 Channel',
    user_help: '👤 <b>User Commands</b>\n/dailyclaim — Daily reward\n/language — Change language\n/mybalance — Check balance\n/top10 — Leaderboard\n/shop — Shop\n\nGame commands: .slot, .dice, .shan, .bj, .mine, 2D, Auction, Event',
    owner_help: '🛡 <b>Owner Commands</b>\n/admin — Admin dashboard\n/status — Bot status\n/treasury — Treasury tools\n/broadcast — Broadcast tools\n/maintenance — Maintenance controls\n\nOwner-only information.',
    daily_done: '⏳ You have already claimed today’s daily reward. Please come back tomorrow.',
  },
  cn: {
    choose_language: '🌐 <b>请选择语言</b>\n您的选择将保存以供下次使用。',
    language_saved: '✅ 语言已切换为中文。',
    start_title: '🎮 <b>BIKA 游戏机器人</b>\n欢迎！请选择下方菜单。',
    user: '👤 用户', owner: '🛡 管理员', game_chat: '🎮 游戏群', channel: '📢 官方频道',
    user_help: '👤 <b>用户命令</b>\n/dailyclaim — 每日奖励\n/language — 更改语言\n/mybalance — 查看余额\n/top10 — 排行榜\n/shop — 商店\n\n游戏：.slot、.dice、.shan、.bj、.mine、2D、拍卖、活动',
    owner_help: '🛡 <b>管理员命令</b>\n/admin — 管理面板\n/status — 机器人状态\n/treasury — 金库\n/broadcast — 群发\n/maintenance — 维护模式\n仅限管理员使用。',
    daily_done: '⏳ 您今天已经领取过每日奖励，请明天再来。',
  },
  jp: {
    choose_language: '🌐 <b>言語を選択してください</b>\n選択した言語は保存されます。',
    language_saved: '✅ 言語を日本語に変更しました。',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nようこそ！メニューを選択してください。',
    user: '👤 ユーザー', owner: '🛡 オーナー', game_chat: '🎮 ゲームチャット', channel: '📢 チャンネル',
    user_help: '👤 <b>ユーザーコマンド</b>\n/dailyclaim — デイリー報酬\n/language — 言語変更\n/mybalance — 残高\n/top10 — ランキング\n/shop — ショップ\n\nゲーム: .slot, .dice, .shan, .bj, .mine, 2D, Auction, Event',
    owner_help: '🛡 <b>オーナーコマンド</b>\n/admin — 管理画面\n/status — ボット状態\n/treasury — 金庫\n/broadcast — 一斉送信\n/maintenance — メンテナンス\nオーナー専用です。',
    daily_done: '⏳ 本日のデイリー報酬は受け取り済みです。明日またお越しください。',
  },
  kr: {
    choose_language: '🌐 <b>언어를 선택하세요</b>\n선택한 언어가 저장됩니다.',
    language_saved: '✅ 언어가 한국어로 변경되었습니다.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\n환영합니다! 아래 메뉴를 선택하세요.',
    user: '👤 사용자', owner: '🛡 운영자', game_chat: '🎮 게임 채팅', channel: '📢 채널',
    user_help: '👤 <b>사용자 명령어</b>\n/dailyclaim — 일일 보상\n/language — 언어 변경\n/mybalance — 잔액\n/top10 — 순위표\n/shop — 상점\n\n게임: .slot, .dice, .shan, .bj, .mine, 2D, Auction, Event',
    owner_help: '🛡 <b>운영자 명령어</b>\n/admin — 관리 패널\n/status — 봇 상태\n/treasury — 금고\n/broadcast — 공지 발송\n/maintenance — 점검 모드\n운영자 전용입니다.',
    daily_done: '⏳ 오늘의 일일 보상은 이미 받았습니다. 내일 다시 방문하세요.',
  },
  fr: {
    choose_language: '🌐 <b>Choisissez votre langue</b>\nVotre choix sera enregistré.',
    language_saved: '✅ La langue est maintenant le français.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nBienvenue ! Choisissez un menu ci-dessous.',
    user: '👤 Utilisateur', owner: '🛡 Propriétaire', game_chat: '🎮 Chat du jeu', channel: '📢 Chaîne',
    user_help: '👤 <b>Commandes utilisateur</b>\n/dailyclaim — Récompense quotidienne\n/language — Changer de langue\n/mybalance — Solde\n/top10 — Classement\n/shop — Boutique\n\nJeux : .slot, .dice, .shan, .bj, .mine, 2D, enchères et événements',
    owner_help: '🛡 <b>Commandes propriétaire</b>\n/admin — Tableau de bord\n/status — État du bot\n/treasury — Trésorerie\n/broadcast — Diffusion\n/maintenance — Maintenance\nRéservé au propriétaire.',
    daily_done: '⏳ Vous avez déjà récupéré la récompense quotidienne. Revenez demain.',
  },
  ru: {
    choose_language: '🌐 <b>Выберите язык</b>\nВыбор будет сохранён.',
    language_saved: '✅ Язык изменён на русский.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nДобро пожаловать! Выберите меню ниже.',
    user: '👤 Пользователь', owner: '🛡 Владелец', game_chat: '🎮 Игровой чат', channel: '📢 Канал',
    user_help: '👤 <b>Команды пользователя</b>\n/dailyclaim — Ежедневная награда\n/language — Сменить язык\n/mybalance — Баланс\n/top10 — Рейтинг\n/shop — Магазин\n\nИгры: .slot, .dice, .shan, .bj, .mine, 2D, аукцион и события',
    owner_help: '🛡 <b>Команды владельца</b>\n/admin — Панель управления\n/status — Статус бота\n/treasury — Казна\n/broadcast — Рассылка\n/maintenance — Обслуживание\nТолько для владельца.',
    daily_done: '⏳ Вы уже получили ежедневную награду. Возвращайтесь завтра.',
  },
  hi: {
    choose_language: '🌐 <b>अपनी भाषा चुनें</b>\nआपकी पसंद सहेजी जाएगी।',
    language_saved: '✅ भाषा हिंदी में बदल दी गई है।',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nस्वागत है! नीचे मेनू चुनें।',
    user: '👤 उपयोगकर्ता', owner: '🛡 मालिक', game_chat: '🎮 गेम चैट', channel: '📢 चैनल',
    user_help: '👤 <b>उपयोगकर्ता कमांड</b>\n/dailyclaim — दैनिक इनाम\n/language — भाषा बदलें\n/mybalance — बैलेंस\n/top10 — लीडरबोर्ड\n/shop — दुकान\n\nगेम: .slot, .dice, .shan, .bj, .mine, 2D, Auction, Event',
    owner_help: '🛡 <b>मालिक कमांड</b>\n/admin — एडमिन पैनल\n/status — बॉट स्थिति\n/treasury — खजाना\n/broadcast — प्रसारण\n/maintenance — रखरखाव\nकेवल मालिक के लिए।',
    daily_done: '⏳ आज का दैनिक इनाम पहले ही लिया जा चुका है। कृपया कल आएँ।',
  },
  ar: {
    choose_language: '🌐 <b>اختر لغتك</b>\nسيتم حفظ اختيارك للزيارات القادمة.',
    language_saved: '✅ تم تغيير اللغة إلى العربية.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nأهلاً بك! اختر قائمة للمتابعة.',
    user: '👤 المستخدم', owner: '🛡 المالك', game_chat: '🎮 دردشة اللعبة', channel: '📢 القناة',
    user_help: '👤 <b>أوامر المستخدم</b>\n/dailyclaim — المكافأة اليومية\n/language — تغيير اللغة\n/mybalance — الرصيد\n/top10 — قائمة المتصدرين\n/shop — المتجر\n\nالألعاب: .slot و.dice و.shan و.bj و.mine و2D والمزادات والفعاليات',
    owner_help: '🛡 <b>أوامر المالك</b>\n/admin — لوحة الإدارة\n/status — حالة البوت\n/treasury — الخزينة\n/broadcast — البث\n/maintenance — الصيانة\nللمالك فقط.',
    daily_done: '⏳ لقد استلمت المكافأة اليومية بالفعل. يرجى العودة غدًا.',
  },
};
function normalizeLanguage(code) {
  const value = String(code || '').trim().toLowerCase();
  return LANGUAGES.some((item) => item.code === value) ? value : null;
}
function getLanguage(user) {
  return normalizeLanguage(user?.language) || DEFAULT_LANGUAGE;
}
function t(languageOrUser, key) {
  const language = typeof languageOrUser === 'string'
    ? (normalizeLanguage(languageOrUser) || DEFAULT_LANGUAGE)
    : getLanguage(languageOrUser);
  return MESSAGES[language]?.[key] || MESSAGES[DEFAULT_LANGUAGE]?.[key] || MESSAGES.en[key] || key;
}
function languageKeyboard() {
  const rows = [];
  for (let i = 0; i < LANGUAGES.length; i += 3) {
    rows.push(LANGUAGES.slice(i, i + 3).map((item) => ({
      text: item.label,
      callback_data: 'LANG:SET:' + item.code,
    })));
  }
  return { inline_keyboard: rows };
}
function mainMenuKeyboard(language) {
  return {
    inline_keyboard: [
      [
        { text: t(language, 'user'), callback_data: 'MAIN:USER' },
        { text: t(language, 'owner'), callback_data: 'MAIN:OWNER' },
      ],
      [
        { text: t(language, 'game_chat'), url: 'https://t.me/BikaGameCommunity' },
        { text: t(language, 'channel'), url: 'https://t.me/WaifuCheatBotChannel' },
      ],
    ],
  };
}
function languagePickerText() {
  return '<b>BIKA GAME BOT</b>\n\n' + MESSAGES.en.choose_language;
}

const LANGUAGE_CACHE_TTL_MS = 300000;
const languageCache = new Map();
const PHRASES = {
  'Bet amount မမှန်ပါ။': { my:'လောင်းကြေးပမာဏ မမှန်ပါ။', en:'Invalid bet amount.', cn:'下注金额无效。', jp:'ベット額が無効です。', kr:'베팅 금액이 올바르지 않습니다.', fr:'Montant de mise invalide.', ru:'Неверная сумма ставки.', hi:'बेट राशि अमान्य है।', ar:'مبلغ الرهان غير صالح.' },
  'Balance မလုံလောက်ပါ။': { my:'လက်ကျန်ငွေ မလုံလောက်ပါ။', en:'Insufficient balance.', cn:'余额不足。', jp:'残高が不足しています。', kr:'잔액이 부족합니다.', fr:'Solde insuffisant.', ru:'Недостаточно средств.', hi:'बैलेंस अपर्याप्त है।', ar:'الرصيد غير كافٍ.' },
  'Please wait, your slot spin is currently running.': { my:'ခဏစောင့်ပါ။ Slot လှည့်နေဆဲပါ။', en:'Please wait, your slot spin is in progress.', cn:'请稍候，老虎机正在旋转。', jp:'スロットが進行中です。お待ちください。', kr:'슬롯이 진행 중입니다. 잠시 기다려 주세요.', fr:'Veuillez patienter, le tour de slot est en cours.', ru:'Подождите, вращение слота ещё идёт.', hi:'कृपया प्रतीक्षा करें, स्लॉट चल रहा है।', ar:'يرجى الانتظار، لعبة السلوت قيد التشغيل.' },
  '⛔ Slot Busy Now! Please wait & try again.': { my:'⛔ Slot ကစားသူများနေပါတယ်။ ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ။', en:'⛔ Slots are busy. Please try again shortly.', cn:'⛔ 当前老虎机繁忙，请稍后重试。', jp:'⛔ スロットが混雑しています。後でもう一度お試しください。', kr:'⛔ 슬롯이 혼잡합니다. 잠시 후 다시 시도하세요.', fr:'⛔ Les slots sont occupés. Réessayez bientôt.', ru:'⛔ Слоты заняты. Попробуйте позже.', hi:'⛔ स्लॉट व्यस्त हैं। थोड़ी देर बाद प्रयास करें।', ar:'⛔ السلوت مشغولة. حاول مجددًا بعد قليل.' },
  'Start Rolling...': { my:'လှည့်နေပါပြီ...', en:'Spinning...', cn:'正在旋转...', jp:'回転中...', kr:'회전 중...', fr:'Rotation en cours...', ru:'Вращение...', hi:'घुमाया जा रहा है...', ar:'جارٍ الدوران...' },
  'Bet:': { my:'လောင်းကြေး:', en:'Bet:', cn:'下注：', jp:'ベット：', kr:'베팅:', fr:'Mise :', ru:'Ставка:', hi:'बेट:', ar:'الرهان:' },
  'Payout:': { my:'ပြန်ရငွေ:', en:'Payout:', cn:'派彩：', jp:'払戻：', kr:'지급액:', fr:'Gain :', ru:'Выплата:', hi:'भुगतान:', ar:'العائد:' },
  'Net:': { my:'အမြတ်/အရှုံး:', en:'Net:', cn:'净额：', jp:'差引：', kr:'순손익:', fr:'Net :', ru:'Итог:', hi:'शुद्ध:', ar:'الصافي:' },
  'Usage:': { my:'အသုံးပြုပုံ:', en:'Usage:', cn:'用法：', jp:'使い方：', kr:'사용법:', fr:'Utilisation :', ru:'Использование:', hi:'उपयोग:', ar:'طريقة الاستخدام:' },
  'Min:': { my:'အနည်းဆုံး:', en:'Min:', cn:'最低：', jp:'最小：', kr:'최소:', fr:'Min. :', ru:'Мин.:', hi:'न्यूनतम:', ar:'الحد الأدنى:' },
  'Max:': { my:'အများဆုံး:', en:'Max:', cn:'最高：', jp:'最大：', kr:'최대:', fr:'Max. :', ru:'Макс.:', hi:'अधिकतम:', ar:'الحد الأقصى:' },
  'Invalid language': { my:'ဘာသာစကား မမှန်ပါ။', en:'Invalid language.', cn:'语言无效。', jp:'言語が無効です。', kr:'잘못된 언어입니다.', fr:'Langue invalide.', ru:'Неверный язык.', hi:'अमान्य भाषा।', ar:'اللغة غير صالحة.' },
  '🎁 <b>Daily Claim Success</b>': { my:'🎁 <b>နေ့စဉ်ဆု ရယူအောင်မြင်ပါပြီ</b>', en:'🎁 <b>Daily Claim Success</b>', cn:'🎁 <b>每日奖励领取成功</b>', jp:'🎁 <b>デイリー報酬を受け取りました</b>', kr:'🎁 <b>일일 보상 수령 완료</b>', fr:'🎁 <b>Récompense quotidienne reçue</b>', ru:'🎁 <b>Ежедневная награда получена</b>', hi:'🎁 <b>दैनिक इनाम प्राप्त हुआ</b>', ar:'🎁 <b>تم استلام المكافأة اليومية</b>' },
  'Reward:': { my:'ဆု:', en:'Reward:', cn:'奖励：', jp:'報酬：', kr:'보상:', fr:'Récompense :', ru:'Награда:', hi:'इनाम:', ar:'المكافأة:' },
  'Balance:': { my:'လက်ကျန်ငွေ:', en:'Balance:', cn:'余额：', jp:'残高：', kr:'잔액:', fr:'Solde :', ru:'Баланс:', hi:'बैलेंस:', ar:'الرصيد:' },
  '✅ WIN': { my:'✅ အနိုင်ရ', en:'✅ WIN', cn:'✅ 获胜', jp:'✅ 勝利', kr:'✅ 승리', fr:'✅ GAGNÉ', ru:'✅ ПОБЕДА', hi:'✅ जीत', ar:'✅ فوز' },
  '❌ LOSE': { my:'❌ ရှုံး', en:'❌ LOSE', cn:'❌ 失败', jp:'❌ 敗北', kr:'❌ 패배', fr:'❌ PERDU', ru:'❌ ПОРАЖЕНИЕ', hi:'❌ हार', ar:'❌ خسارة' },
  '🏆 JACKPOT 777!': { my:'🏆 JACKPOT 777!', en:'🏆 JACKPOT 777!', cn:'🏆 777大奖！', jp:'🏆 777ジャックポット！', kr:'🏆 777 잭팟!', fr:'🏆 JACKPOT 777 !', ru:'🏆 ДЖЕКПОТ 777!', hi:'🏆 जैकपॉट 777!', ar:'🏆 جائزة كبرى 777!' },
  '✅ TWO MATCH WIN': { my:'✅ နှစ်ခုတူ အနိုင်ရ', en:'✅ TWO MATCH WIN', cn:'✅ 两个相同，获胜', jp:'✅ 2つ一致で勝利', kr:'✅ 두 개 일치 승리', fr:'✅ GAGNÉ — DEUX IDENTIQUES', ru:'✅ ДВА СОВПАДЕНИЯ — ПОБЕДА', hi:'✅ दो मिलान — जीत', ar:'✅ تطابقان — فوز' },
  'Cash Out Success!': { my:'ငွေထုတ်ယူမှု အောင်မြင်ပါပြီ!', en:'Cash Out Success!', cn:'提现成功！', jp:'キャッシュアウト成功！', kr:'캐시아웃 성공!', fr:'Retrait réussi !', ru:'Вывод выполнен!', hi:'कैश आउट सफल!', ar:'تم السحب بنجاح!' },
  '⏳ Please wait': { my:'⏳ ခဏစောင့်ပါ', en:'⏳ Please wait', cn:'⏳ 请稍候', jp:'⏳ お待ちください', kr:'⏳ 잠시 기다려 주세요', fr:'⏳ Veuillez patienter', ru:'⏳ Подождите', hi:'⏳ कृपया प्रतीक्षा करें', ar:'⏳ يرجى الانتظار' },
  'Processing...': { my:'လုပ်ဆောင်နေပါတယ်...', en:'Processing...', cn:'处理中...', jp:'処理中...', kr:'처리 중...', fr:'Traitement...', ru:'Обработка...', hi:'प्रोसेस हो रहा है...', ar:'جارٍ المعالجة...' },
  'Game Over': { my:'ဂိမ်းပြီးဆုံးပါပြီ', en:'Game Over', cn:'游戏结束', jp:'ゲーム終了', kr:'게임 종료', fr:'Fin de partie', ru:'Игра окончена', hi:'खेल समाप्त', ar:'انتهت اللعبة' },
  'Waiting for players': { my:'ကစားသမားများကို စောင့်နေပါတယ်', en:'Waiting for players', cn:'等待玩家加入', jp:'プレイヤーを待っています', kr:'플레이어 대기 중', fr:'En attente des joueurs', ru:'Ожидание игроков', hi:'खिलाड़ियों की प्रतीक्षा', ar:'بانتظار اللاعبين' },
  'Multiplier:': { my:'မြှောက်ကိန်း:', en:'Multiplier:', cn:'倍数：', jp:'倍率：', kr:'배수:', fr:'Multiplicateur :', ru:'Множитель:', hi:'गुणक:', ar:'المضاعف:' },
  'Status:': { my:'အခြေအနေ:', en:'Status:', cn:'状态：', jp:'状態：', kr:'상태:', fr:'Statut :', ru:'Статус:', hi:'स्थिति:', ar:'الحالة:' },
  'Time Limit:': { my:'အချိန်ကန့်သတ်ချက်:', en:'Time Limit:', cn:'时间限制：', jp:'制限時間：', kr:'시간 제한:', fr:'Limite de temps :', ru:'Лимит времени:', hi:'समय सीमा:', ar:'الحد الزمني:' },
  '✅ Accept Dice Duel': { my:'✅ Dice စိန်ခေါ်မှု လက်ခံမယ်', en:'✅ Accept Dice Duel', cn:'✅ 接受骰子对决', jp:'✅ ダイス対決を受ける', kr:'✅ 주사위 대결 수락', fr:'✅ Accepter le duel de dés', ru:'✅ Принять дуэль на кубиках', hi:'✅ डाइस द्वंद्व स्वीकारें', ar:'✅ قبول تحدي النرد' },
  '✅ Accept Shan Duel': { my:'✅ ရှမ်းကိုးမီး စိန်ခေါ်မှု လက်ခံမယ်', en:'✅ Accept Shan Duel', cn:'✅ 接受掸牌对决', jp:'✅ シャン対決を受ける', kr:'✅ 샨 대결 수락', fr:'✅ Accepter le duel Shan', ru:'✅ Принять дуэль Shan', hi:'✅ शान द्वंद्व स्वीकारें', ar:'✅ قبول تحدي شان' },
  '❌ Cancel': { my:'❌ ပယ်ဖျက်မယ်', en:'❌ Cancel', cn:'❌ 取消', jp:'❌ キャンセル', kr:'❌ 취소', fr:'❌ Annuler', ru:'❌ Отмена', hi:'❌ रद्द करें', ar:'❌ إلغاء' },
  '🃏 Hit / ထပ်ဆွဲမယ်': { my:'🃏 ကဒ်ထပ်ဆွဲမယ်', en:'🃏 Hit', cn:'🃏 要牌', jp:'🃏 ヒット', kr:'🃏 히트', fr:'🃏 Tirer', ru:'🃏 Взять карту', hi:'🃏 कार्ड लें', ar:'🃏 اسحب بطاقة' },
  '✋ Stand / ရပ်မယ်': { my:'✋ ရပ်မယ်', en:'✋ Stand', cn:'✋ 停牌', jp:'✋ スタンド', kr:'✋ 스탠드', fr:'✋ Rester', ru:'✋ Остановиться', hi:'✋ रुकें', ar:'✋ توقف' },
  '💰 Cash Out •': { my:'💰 ငွေထုတ် •', en:'💰 Cash Out •', cn:'💰 兑现 •', jp:'💰 キャッシュアウト •', kr:'💰 캐시아웃 •', fr:'💰 Encaisser •', ru:'💰 Забрать •', hi:'💰 कैश आउट •', ar:'💰 سحب •' },
  '❌ Cancel / Refund': { my:'❌ ပယ်ဖျက် / ငွေပြန်ယူ', en:'❌ Cancel / Refund', cn:'❌ 取消 / 退款', jp:'❌ キャンセル / 返金', kr:'❌ 취소 / 환불', fr:'❌ Annuler / Rembourser', ru:'❌ Отмена / Возврат', hi:'❌ रद्द / रिफंड', ar:'❌ إلغاء / استرداد' },
  'Cash Out:': { my:'ငွေထုတ်ယူရန်:', en:'Cash Out:', cn:'兑现：', jp:'キャッシュアウト：', kr:'캐시아웃:', fr:'Encaisser :', ru:'Забрать:', hi:'कैश आउट:', ar:'السحب:' },
  'Player:': { my:'ကစားသူ:', en:'Player:', cn:'玩家：', jp:'プレイヤー：', kr:'플레이어:', fr:'Joueur :', ru:'Игрок:', hi:'खिलाड़ी:', ar:'اللاعب:' },
  'Dealer:': { my:'ဒိုင်:', en:'Dealer:', cn:'庄家：', jp:'ディーラー：', kr:'딜러:', fr:'Croupier :', ru:'Дилер:', hi:'डीलर:', ar:'الموزع:' },
  '✅ Safe tile': { my:'✅ လုံခြုံသောအကွက်', en:'✅ Safe tile', cn:'✅ 安全格', jp:'✅ セーフマス', kr:'✅ 안전 타일', fr:'✅ Case sûre', ru:'✅ Безопасная ячейка', hi:'✅ सुरक्षित टाइल', ar:'✅ خانة آمنة' },
};
function translateText(language, text) {
  const lang = normalizeLanguage(language) || DEFAULT_LANGUAGE;
  let result = String(text ?? '');
  for (const phrase of Object.keys(PHRASES).sort((a, b) => b.length - a.length)) {
    const translated = PHRASES[phrase][lang] || PHRASES[phrase].en;
    if (translated && translated !== phrase) result = result.split(phrase).join(translated);
  }
  return result;
}
function translateCachedText(userId, text) {
  const entry = userId == null ? null : languageCache.get(String(userId));
  const language = entry && entry.expiresAt > Date.now() ? entry.language : DEFAULT_LANGUAGE;
  return translateText(language, text);
}
function rememberLanguage(userId, language) {
  const code = normalizeLanguage(language);
  if (code && userId != null) languageCache.set(String(userId), { language: code, expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS });
}
async function getPreferredLanguage(userId) {
  if (userId == null) return DEFAULT_LANGUAGE;
  const key = String(userId), now = Date.now(), cached = languageCache.get(String(userId));
  if (cached && cached.expiresAt > now) return cached.language;
  try {
    const { col } = require('../config/database');
    const ids = [key];
    if (/^\\d+$/.test(key) && Number.isSafeInteger(Number(key))) ids.push(Number(key));
    const user = await col('users').findOne({ userId: { $in: ids } }, { projection: { language: 1 } });
    const language = getLanguage(user);
    rememberLanguage(key, language);
    return language;
  } catch (_) { return DEFAULT_LANGUAGE; }
}
async function localizeForUser(userId, text) {
  return translateText(await getPreferredLanguage(userId), text);
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, getLanguage, t, languageKeyboard, mainMenuKeyboard, languagePickerText, MESSAGES, translateText, translateCachedText, rememberLanguage, getPreferredLanguage, localizeForUser };
