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
    user_help: '👤 <b>User Commands</b>\n/language — ဘာသာစကားပြောင်းရန်\n/daily, /dailyclaim — နေ့စဉ်ဆု\n/mybalance, /bal — လက်ကျန်ငွေစစ်ရန်\n/top10 — အဆင့်စာရင်း\n/shop — ဆိုင်\n/wallet — Wallet\n/gift — ငွေလက်ဆောင်ပို့ရန်\n/webapp — Game Mini App\n/dailytournament — နေ့စဉ်ပြိုင်ပွဲ\n\nGames: .slot, .crash, .mines, .bj, .shan, .dice, 2D, Auction, Event',
    owner_help: '🛡 <b>Owner Commands</b>\n/admin — Admin dashboard\n/status, /ping — Bot status and latency\n/treasury — Treasury tools\n/addbal, /rmbal — Adjust user balance\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP settings\n/promortp — Promo RTP\n/broadcast, /broadcastend — Broadcast controls\n/off, /on — Maintenance ON/OFF\n/approve, /reject, /groupstatus — Group controls\n\nဤ commands များကို Owner သာ သုံးနိုင်သည်။',
    daily_done: '⏳ ဒီနေ့ Daily reward ကို ရယူပြီးပါပြီ။ မနက်ဖြန် ပြန်လာပါ။',
  },
  en: {
    choose_language: '🌐 <b>Choose your language</b>\nYour choice will be saved for future visits.',
    language_saved: '✅ Language changed to English.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nWelcome! Choose a menu below to continue.',
    user: '👤 User', owner: '🛡 Owner', game_chat: '🎮 Game Chat', channel: '📢 Channel',
    user_help: '👤 <b>User Commands</b>\n/language — Change language\n/daily, /dailyclaim — Daily reward\n/mybalance, /bal — Check balance\n/top10 — Leaderboard\n/shop — Shop\n/wallet — Wallet\n/gift — Send a balance gift\n/webapp — Open Game Mini App\n/dailytournament — Daily tournament\n\nGames: .slot, .crash, .mines, .bj, .shan, .dice, 2D, Auction, Event',
    owner_help: '🛡 <b>Owner Commands</b>\n/admin — Admin dashboard\n/status, /ping — Bot status and latency\n/treasury — Treasury tools\n/addbal, /rmbal — Adjust user balance\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP settings\n/promortp — Promo RTP\n/broadcast, /broadcastend — Broadcast controls\n/off, /on — Maintenance ON/OFF\n/approve, /reject, /groupstatus — Group controls\n\nThese commands are Owner-only.',
    daily_done: '⏳ You have already claimed today’s daily reward. Please come back tomorrow.',
  },
  cn: {
    choose_language: '🌐 <b>请选择语言</b>\n您的选择将保存以供下次使用。',
    language_saved: '✅ 语言已切换为中文。',
    start_title: '🎮 <b>BIKA 游戏机器人</b>\n欢迎！请选择下方菜单。',
    user: '👤 用户', owner: '🛡 管理员', game_chat: '🎮 游戏群', channel: '📢 官方频道',
    user_help: '👤 <b>用户命令</b>\n/language — 更改语言\n/daily, /dailyclaim — 每日奖励\n/mybalance, /bal — 查看余额\n/top10 — 排行榜\n/shop — 商店\n/wallet — 钱包\n/gift — 赠送余额\n/webapp — 打开游戏 Mini App\n/dailytournament — 每日锦标赛\n\n游戏：.slot、.crash、.mines、.bj、.shan、.dice、2D、拍卖、活动',
    owner_help: '🛡 <b>所有者命令</b>\n/admin — 管理面板\n/status, /ping — 机器人状态与延迟\n/treasury — 金库工具\n/addbal, /rmbal — 调整用户余额\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP 设置\n/promortp — 促销 RTP\n/broadcast, /broadcastend — 群发控制\n/off, /on — 维护模式开关\n/approve, /reject, /groupstatus — 群组管理\n\n这些命令仅限所有者使用。',
    daily_done: '⏳ 您今天已经领取过每日奖励，请明天再来。',
  },
  jp: {
    choose_language: '🌐 <b>言語を選択してください</b>\n選択した言語は保存されます。',
    language_saved: '✅ 言語を日本語に変更しました。',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nようこそ！メニューを選択してください。',
    user: '👤 ユーザー', owner: '🛡 オーナー', game_chat: '🎮 ゲームチャット', channel: '📢 チャンネル',
    user_help: '👤 <b>ユーザーコマンド</b>\n/language — 言語変更\n/daily, /dailyclaim — デイリー報酬\n/mybalance, /bal — 残高確認\n/top10 — ランキング\n/shop — ショップ\n/wallet — ウォレット\n/gift — 残高を贈る\n/webapp — ゲーム Mini App\n/dailytournament — デイリートーナメント\n\nゲーム: .slot, .crash, .mines, .bj, .shan, .dice, 2D, オークション, イベント',
    owner_help: '🛡 <b>オーナーコマンド</b>\n/admin — 管理画面\n/status, /ping — 状態と応答速度\n/treasury — 金庫ツール\n/addbal, /rmbal — 残高調整\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP 設定\n/promortp — プロモ RTP\n/broadcast, /broadcastend — 一斉送信\n/off, /on — メンテナンス切替\n/approve, /reject, /groupstatus — グループ管理\n\n管理コマンドはオーナー専用です。',
    daily_done: '⏳ 本日のデイリー報酬は受け取り済みです。明日またお越しください。',
  },
  kr: {
    choose_language: '🌐 <b>언어를 선택하세요</b>\n선택한 언어가 저장됩니다.',
    language_saved: '✅ 언어가 한국어로 변경되었습니다.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\n환영합니다! 아래 메뉴를 선택하세요.',
    user: '👤 사용자', owner: '🛡 운영자', game_chat: '🎮 게임 채팅', channel: '📢 채널',
    user_help: '👤 <b>사용자 명령어</b>\n/language — 언어 변경\n/daily, /dailyclaim — 일일 보상\n/mybalance, /bal — 잔액 확인\n/top10 — 순위표\n/shop — 상점\n/wallet — 지갑\n/gift — 잔액 선물\n/webapp — 게임 Mini App\n/dailytournament — 일일 토너먼트\n\n게임: .slot, .crash, .mines, .bj, .shan, .dice, 2D, 경매, 이벤트',
    owner_help: '🛡 <b>운영자 명령어</b>\n/admin — 관리 패널\n/status, /ping — 상태 및 지연 시간\n/treasury — 금고 도구\n/addbal, /rmbal — 잔액 조정\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP 설정\n/promortp — 프로모 RTP\n/broadcast, /broadcastend — 공지 발송 제어\n/off, /on — 점검 모드 전환\n/approve, /reject, /groupstatus — 그룹 관리\n\n관리자 명령어는 운영자 전용입니다.',
    daily_done: '⏳ 오늘의 일일 보상은 이미 받았습니다. 내일 다시 방문하세요.',
  },
  fr: {
    choose_language: '🌐 <b>Choisissez votre langue</b>\nVotre choix sera enregistré.',
    language_saved: '✅ La langue est maintenant le français.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nBienvenue ! Choisissez un menu ci-dessous.',
    user: '👤 Utilisateur', owner: '🛡 Propriétaire', game_chat: '🎮 Chat du jeu', channel: '📢 Chaîne',
    user_help: '👤 <b>Commandes utilisateur</b>\n/language — Changer de langue\n/daily, /dailyclaim — Récompense quotidienne\n/mybalance, /bal — Consulter le solde\n/top10 — Classement\n/shop — Boutique\n/wallet — Portefeuille\n/gift — Envoyer un cadeau de solde\n/webapp — Mini App de jeu\n/dailytournament — Tournoi quotidien\n\nJeux : .slot, .crash, .mines, .bj, .shan, .dice, 2D, enchères, événements',
    owner_help: '🛡 <b>Commandes propriétaire</b>\n/admin — Tableau de bord\n/status, /ping — État et latence\n/treasury — Outils de trésorerie\n/addbal, /rmbal — Ajuster les soldes\n/setrtp, /setbjrtp, /setvipwr — Paramètres RTP/VIP\n/promortp — RTP promotionnel\n/broadcast, /broadcastend — Gestion des diffusions\n/off, /on — Activer/désactiver la maintenance\n/approve, /reject, /groupstatus — Gestion des groupes\n\nCommandes réservées au propriétaire.',
    daily_done: '⏳ Vous avez déjà récupéré la récompense quotidienne. Revenez demain.',
  },
  ru: {
    choose_language: '🌐 <b>Выберите язык</b>\nВыбор будет сохранён.',
    language_saved: '✅ Язык изменён на русский.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nДобро пожаловать! Выберите меню ниже.',
    user: '👤 Пользователь', owner: '🛡 Владелец', game_chat: '🎮 Игровой чат', channel: '📢 Канал',
    user_help: '👤 <b>Команды пользователя</b>\n/language — Сменить язык\n/daily, /dailyclaim — Ежедневная награда\n/mybalance, /bal — Проверить баланс\n/top10 — Рейтинг\n/shop — Магазин\n/wallet — Кошелёк\n/gift — Подарить баланс\n/webapp — Игровое Mini App\n/dailytournament — Ежедневный турнир\n\nИгры: .slot, .crash, .mines, .bj, .shan, .dice, 2D, аукцион, события',
    owner_help: '🛡 <b>Команды владельца</b>\n/admin — Панель управления\n/status, /ping — Статус и задержка\n/treasury — Инструменты казны\n/addbal, /rmbal — Изменение баланса\n/setrtp, /setbjrtp, /setvipwr — Настройки RTP/VIP\n/promortp — Промо RTP\n/broadcast, /broadcastend — Управление рассылкой\n/off, /on — Режим обслуживания\n/approve, /reject, /groupstatus — Управление группами\n\nКоманды только для владельца.',
    daily_done: '⏳ Вы уже получили ежедневную награду. Возвращайтесь завтра.',
  },
  hi: {
    choose_language: '🌐 <b>अपनी भाषा चुनें</b>\nआपकी पसंद सहेजी जाएगी।',
    language_saved: '✅ भाषा हिंदी में बदल दी गई है।',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nस्वागत है! नीचे मेनू चुनें।',
    user: '👤 उपयोगकर्ता', owner: '🛡 मालिक', game_chat: '🎮 गेम चैट', channel: '📢 चैनल',
    user_help: '👤 <b>उपयोगकर्ता कमांड</b>\n/language — भाषा बदलें\n/daily, /dailyclaim — दैनिक इनाम\n/mybalance, /bal — बैलेंस देखें\n/top10 — लीडरबोर्ड\n/shop — दुकान\n/wallet — वॉलेट\n/gift — बैलेंस उपहार\n/webapp — गेम Mini App\n/dailytournament — दैनिक टूर्नामेंट\n\nगेम: .slot, .crash, .mines, .bj, .shan, .dice, 2D, Auction, Event',
    owner_help: '🛡 <b>मालिक कमांड</b>\n/admin — एडमिन पैनल\n/status, /ping — स्थिति और लेटेंसी\n/treasury — खजाना टूल\n/addbal, /rmbal — बैलेंस समायोजित करें\n/setrtp, /setbjrtp, /setvipwr — RTP/VIP सेटिंग\n/promortp — प्रोमो RTP\n/broadcast, /broadcastend — प्रसारण नियंत्रण\n/off, /on — मेंटेनेंस चालू/बंद\n/approve, /reject, /groupstatus — समूह नियंत्रण\n\nये कमांड केवल मालिक के लिए हैं।',
    daily_done: '⏳ आज का दैनिक इनाम पहले ही लिया जा चुका है। कृपया कल आएँ।',
  },
  ar: {
    choose_language: '🌐 <b>اختر لغتك</b>\nسيتم حفظ اختيارك للزيارات القادمة.',
    language_saved: '✅ تم تغيير اللغة إلى العربية.',
    start_title: '🎮 <b>BIKA GAME BOT</b>\nأهلاً بك! اختر قائمة للمتابعة.',
    user: '👤 المستخدم', owner: '🛡 المالك', game_chat: '🎮 دردشة اللعبة', channel: '📢 القناة',
    user_help: '👤 <b>أوامر المستخدم</b>\n/language — تغيير اللغة\n/daily, /dailyclaim — المكافأة اليومية\n/mybalance, /bal — عرض الرصيد\n/top10 — قائمة المتصدرين\n/shop — المتجر\n/wallet — المحفظة\n/gift — إهداء الرصيد\n/webapp — تطبيق الألعاب المصغّر\n/dailytournament — البطولة اليومية\n\nالألعاب: .slot و.crash و.mines و.bj و.shan و.dice و2D والمزادات والفعاليات',
    owner_help: '🛡 <b>أوامر المالك</b>\n/admin — لوحة الإدارة\n/status, /ping — الحالة وزمن الاستجابة\n/treasury — أدوات الخزينة\n/addbal, /rmbal — تعديل الرصيد\n/setrtp, /setbjrtp, /setvipwr — إعدادات RTP/VIP\n/promortp — RTP ترويجي\n/broadcast, /broadcastend — التحكم بالبث\n/off, /on — تشغيل/إيقاف الصيانة\n/approve, /reject, /groupstatus — إدارة المجموعات\n\nأوامر الإدارة متاحة للمالك فقط.',
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
  '⛔ Owner only.': { my:'⛔ Owner သာ အသုံးပြုနိုင်ပါတယ်။', en:'⛔ Owner only.', cn:'⛔ 仅限所有者使用。', jp:'⛔ オーナー専用です。', kr:'⛔ 운영자 전용입니다.', fr:'⛔ Réservé au propriétaire.', ru:'⛔ Только для владельца.', hi:'⛔ केवल मालिक के लिए।', ar:'⛔ للمالك فقط.' },
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
  'BIKA Mines': { my:'BIKA မိုင်းဂိမ်း', en:'BIKA Mines', cn:'BIKA 扫雷', jp:'BIKA マインズ', kr:'BIKA 지뢰찾기', fr:'BIKA Mines', ru:'BIKA Сапёр', hi:'BIKA माइन्स', ar:'BIKA الألغام' },
  'Mines:': { my:'မိုင်းအရေအတွက်:', en:'Mines:', cn:'地雷数：', jp:'地雷：', kr:'지뢰:', fr:'Mines :', ru:'Мины:', hi:'माइन्स:', ar:'الألغام:' },
  'Safe Opened:': { my:'ဖွင့်ထားသော Safe:', en:'Safe Opened:', cn:'已打开安全格：', jp:'開いた安全マス：', kr:'열린 안전 타일:', fr:'Cases sûres ouvertes :', ru:'Открытые безопасные ячейки:', hi:'खुली सुरक्षित टाइलें:', ar:'الخانات الآمنة المفتوحة:' },
  'Risk Safe Count:': { my:'အန္တရာယ်တွက် Safe အရေအတွက်:', en:'Risk Safe Count:', cn:'计风险的安全格数：', jp:'リスク計算対象の安全マス：', kr:'위험 계산 안전 타일 수:', fr:'Cases sûres à risque :', ru:'Безопасные ячейки с риском:', hi:'जोखिम वाली सुरक्षित टाइलें:', ar:'عدد الخانات الآمنة المحتسبة للمخاطر:' },
  'Locked': { my:'ပိတ်ထားသည်', en:'Locked', cn:'未解锁', jp:'ロック中', kr:'잠김', fr:'Verrouillé', ru:'Заблокировано', hi:'लॉक है', ar:'مغلق' },
  'safe required': { my:'Safe အကွက်လိုအပ်သည်', en:'safe required', cn:'个安全格', jp:'個の安全マスが必要', kr:'안전 타일 필요', fr:'cases sûres requises', ru:'безопасных ячеек нужно', hi:'सुरक्षित टाइलें आवश्यक', ar:'خانات آمنة مطلوبة' },
  'Board revealed.': { my:'ဘုတ်တစ်ခုလုံး ဖော်ပြပြီးပါပြီ။', en:'Board revealed.', cn:'棋盘已揭示。', jp:'ボードを公開しました。', kr:'보드가 공개되었습니다.', fr:'Plateau révélé.', ru:'Поле раскрыто.', hi:'बोर्ड दिखा दिया गया।', ar:'تم كشف اللوحة.' },
  'Lost:': { my:'ဆုံးရှုံးမှု:', en:'Lost:', cn:'损失：', jp:'損失：', kr:'손실:', fr:'Perdu :', ru:'Потеря:', hi:'हानि:', ar:'الخسارة:' },
  'Mine ထိသွားပါပြီ။': { my:'မိုင်းထိသွားပါပြီ။', en:'You hit a mine.', cn:'踩到地雷了。', jp:'地雷に当たりました。', kr:'지뢰를 밟았습니다.', fr:'Vous avez touché une mine.', ru:'Вы попали на мину.', hi:'माइन लग गई।', ar:'لقد اصطدمت بلغم.' },
  'Safe tile opened.': { my:'Safe အကွက် ဖွင့်ပြီးပါပြီ။', en:'Safe tile opened.', cn:'安全格已打开。', jp:'安全マスを開きました。', kr:'안전 타일이 열렸습니다.', fr:'Case sûre ouverte.', ru:'Безопасная ячейка открыта.', hi:'सुरक्षित टाइल खुल गई।', ar:'تم فتح خانة آمنة.' },
  'Choose whether to continue or Cash Out.': { my:'ဆက်ကစားမလား၊ Cash Out လုပ်မလား ရွေးပါ။', en:'Choose whether to continue or Cash Out.', cn:'请选择继续游戏或兑现。', jp:'続けるか換金するか選んでください。', kr:'계속하거나 캐시아웃을 선택하세요.', fr:'Choisissez de continuer ou d’encaisser.', ru:'Выберите: продолжить или забрать выигрыш.', hi:'आगे खेलें या कैश आउट चुनें।', ar:'اختر المتابعة أو السحب.' },
  'The first safe tile is free and does not increase the multiplier.': { my:'ပထမ Safe အကွက်သည် အခမဲ့ဖြစ်ပြီး multiplier ကို မတိုးစေပါ။', en:'The first safe tile is free and does not increase the multiplier.', cn:'第一个安全格免费，不会增加倍数。', jp:'最初の安全マスは無料で、倍率は上がりません。', kr:'첫 안전 타일은 무료이며 배수를 올리지 않습니다.', fr:'La première case sûre est gratuite et n’augmente pas le multiplicateur.', ru:'Первая безопасная ячейка бесплатна и не увеличивает множитель.', hi:'पहली सुरक्षित टाइल मुफ्त है और गुणक नहीं बढ़ाती।', ar:'الخانة الآمنة الأولى مجانية ولا تزيد المضاعف.' },
  'Open at least ': { my:'အနည်းဆုံး ', en:'Open at least ', cn:'至少打开 ', jp:'最低 ', kr:'최소 ', fr:'Ouvrez au moins ', ru:'Откройте не менее ', hi:'कम से कम ', ar:'افتح على الأقل ' },
  ' safe tiles to unlock Cash Out.': { my:' ခု ဖွင့်ပြီး Cash Out ကိုဖွင့်ပါ။', en:' safe tiles to unlock Cash Out.', cn:' 个安全格以解锁兑现。', jp:'個の安全マスを開くと換金できます。', kr:'개의 안전 타일을 열면 캐시아웃이 해제됩니다.', fr:' cases sûres pour débloquer le retrait.', ru:' безопасных ячеек, чтобы разблокировать вывод.', hi:' सुरक्षित टाइलें खोलें ताकि कैश आउट अनलॉक हो।', ar:' خانات آمنة لفتح السحب.' },
  'At least ': { my:'အနည်းဆုံး ', en:'At least ', cn:'至少打开 ', jp:'最低 ', kr:'최소 ', fr:'Au moins ', ru:'Необходимо открыть не менее ', hi:'कम से कम ', ar:'افتح على الأقل ' },
  ' safe tiles must be opened before Cash Out.': { my:' Safe အကွက်ကို ဖွင့်ပြီးမှ Cash Out လုပ်နိုင်ပါတယ်။', en:' safe tiles must be opened before Cash Out.', cn:' 个安全格后才能兑现。', jp:'個の安全マスを開くと換金できます。', kr:'개의 안전 타일을 열어야 캐시아웃할 수 있습니다.', fr:' cases sûres doivent être ouvertes avant le retrait.', ru:' безопасных ячеек до разблокировки вывода.', hi:' सुरक्षित टाइलें खोलने के बाद ही कैश आउट कर सकते हैं।', ar:' خانات آمنة لفتح السحب.' },
  'Dice Duel Challenge': { my:'Dice ယှဉ်ပြိုင်စိန်ခေါ်မှု', en:'Dice Duel Challenge', cn:'骰子对决挑战', jp:'ダイス対決チャレンジ', kr:'주사위 대결 도전', fr:'Défi de duel de dés', ru:'Вызов на дуэль в кости', hi:'डाइस द्वंद्व चुनौती', ar:'تحدي مبارزة النرد' },
  'Dice Result': { my:'Dice ရလဒ်', en:'Dice Result', cn:'骰子结果', jp:'ダイス結果', kr:'주사위 결과', fr:'Résultat des dés', ru:'Результат броска костей', hi:'डाइस परिणाम', ar:'نتيجة النرد' },
  'Shan Koe Mee Challenge': { my:'ရှမ်းကိုးမီး စိန်ခေါ်မှု', en:'Shan Koe Mee Challenge', cn:'掸牌对决挑战', jp:'シャンコーミー対決', kr:'샨 코 미 대결', fr:'Défi Shan Koe Mee', ru:'Вызов Shan Koe Mee', hi:'शान को मी चुनौती', ar:'تحدي شان كو مي' },
  'Shan Challenge Time Expired': { my:'ရှမ်းစိန်ခေါ်မှု အချိန်ကုန်သွားပါပြီ', en:'Shan Challenge Time Expired', cn:'掸牌挑战已超时', jp:'シャンチャレンジの時間切れ', kr:'샨 도전 시간 초과', fr:'Délai du défi Shan expiré', ru:'Время вызова Shan истекло', hi:'शान चुनौती का समय समाप्त', ar:'انتهى وقت تحدي شان' },
  'Shan Result': { my:'ရှမ်းရလဒ်', en:'Shan Result', cn:'掸牌结果', jp:'シャンの結果', kr:'샨 결과', fr:'Résultat Shan', ru:'Результат Shan', hi:'शान परिणाम', ar:'نتيجة شان' },
  'Blackjack Expired': { my:'Blackjack အချိန်ကုန်သွားပါပြီ', en:'Blackjack Expired', cn:'Blackjack 已超时', jp:'ブラックジャックの時間切れ', kr:'블랙잭 시간 초과', fr:'Blackjack expiré', ru:'Время Blackjack истекло', hi:'ब्लैकजैक का समय समाप्त', ar:'انتهى وقت البلاك جاك' },
  'Blackjack': { my:'Blackjack', en:'Blackjack', cn:'二十一点', jp:'ブラックジャック', kr:'블랙잭', fr:'Blackjack', ru:'Блэкджек', hi:'ब्लैकजैक', ar:'بلاك جاك' },
  'Challenger:': { my:'စိန်ခေါ်သူ:', en:'Challenger:', cn:'挑战者：', jp:'挑戦者：', kr:'도전자:', fr:'Défiant :', ru:'Участник:', hi:'चुनौती देने वाला:', ar:'المتحدي:' },
  'Target:': { my:'ပစ်မှတ်:', en:'Target:', cn:'对手：', jp:'対戦相手：', kr:'상대:', fr:'Adversaire :', ru:'Соперник:', hi:'प्रतिद्वंद्वी:', ar:'الخصم:' },
  'Result:': { my:'ရလဒ်:', en:'Result:', cn:'结果：', jp:'結果：', kr:'결과:', fr:'Résultat :', ru:'Результат:', hi:'परिणाम:', ar:'النتيجة:' },
  'Winner:': { my:'အနိုင်ရသူ:', en:'Winner:', cn:'获胜者：', jp:'勝者：', kr:'승자:', fr:'Gagnant :', ru:'Победитель:', hi:'विजेता:', ar:'الفائز:' },
  'Winner gets:': { my:'အနိုင်ရသူ ရရှိမည့်ငွေ:', en:'Winner gets:', cn:'获胜者获得：', jp:'勝者の獲得額：', kr:'승자 지급액:', fr:'Gain du gagnant :', ru:'Выигрыш победителя:', hi:'विजेता को मिलेगा:', ar:'يحصل الفائز على:' },
  'User:': { my:'ကစားသူ:', en:'User:', cn:'用户：', jp:'ユーザー：', kr:'사용자:', fr:'Utilisateur :', ru:'Игрок:', hi:'उपयोगकर्ता:', ar:'المستخدم:' },
  'Dealer:': { my:'ဒိုင်:', en:'Dealer:', cn:'庄家：', jp:'ディーラー：', kr:'딜러:', fr:'Croupier :', ru:'Дилер:', hi:'डीलर:', ar:'الموزع:' },
  'Dice Duel Cancelled': { my:'Dice စိန်ခေါ်မှု ပယ်ဖျက်ပြီးပါပြီ', en:'Dice Duel Cancelled', cn:'骰子对决已取消', jp:'ダイス対決をキャンセルしました', kr:'주사위 대결 취소됨', fr:'Duel de dés annulé', ru:'Дуэль на кубиках отменена', hi:'डाइस द्वंद्व रद्द किया गया', ar:'تم إلغاء مبارزة النرد' },
  'Shan Duel Cancelled': { my:'ရှမ်းစိန်ခေါ်မှု ပယ်ဖျက်ပြီးပါပြီ', en:'Shan Duel Cancelled', cn:'掸牌对决已取消', jp:'シャン対決をキャンセルしました', kr:'샨 대결 취소됨', fr:'Duel Shan annulé', ru:'Дуэль Shan отменена', hi:'शान द्वंद्व रद्द किया गया', ar:'تم إلغاء تحدي شان' },
  'Challenge expired': { my:'စိန်ခေါ်မှု အချိန်ကုန်သွားပါပြီ', en:'Challenge expired', cn:'挑战已过期', jp:'チャレンジの期限切れ', kr:'도전 시간이 만료되었습니다', fr:'Défi expiré', ru:'Время вызова истекло', hi:'चुनौती समाप्त हो गई', ar:'انتهت صلاحية التحدي' },
  'Only challenger can cancel': { my:'စိန်ခေါ်သူသာ ပယ်ဖျက်နိုင်ပါတယ်။', en:'Only challenger can cancel', cn:'只有挑战者可以取消', jp:'挑戦者のみキャンセルできます', kr:'도전자만 취소할 수 있습니다', fr:'Seul le challenger peut annuler', ru:'Отменить может только инициатор', hi:'केवल चुनौती देने वाला रद्द कर सकता है', ar:'يمكن للمتحدي فقط الإلغاء' },
  'Cancelled': { my:'ပယ်ဖျက်ပြီးပါပြီ', en:'Cancelled', cn:'已取消', jp:'キャンセルしました', kr:'취소됨', fr:'Annulé', ru:'Отменено', hi:'रद्द किया गया', ar:'تم الإلغاء' },
  'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်': { my:'ဒီစိန်ခေါ်မှုကို သတ်မှတ်ထားသော ပြိုင်ဘက်သာ လက်ခံနိုင်ပါတယ်။', en:'Only the challenged player can accept this duel.', cn:'只有被挑战的玩家可以接受此对决。', jp:'この対決は挑戦されたプレイヤーのみ受け付けられます。', kr:'도전을 받은 플레이어만 수락할 수 있습니다.', fr:'Seul le joueur défié peut accepter ce duel.', ru:'Принять дуэль может только вызванный игрок.', hi:'केवल चुनौती प्राप्त खिलाड़ी इसे स्वीकार कर सकता है।', ar:'يمكن للاعب الذي وُجّه إليه التحدي فقط قبوله.' },
  'Rolling dice...': { my:'Dice လှိမ့်နေပါတယ်...', en:'Rolling dice...', cn:'正在掷骰子...', jp:'サイコロを振っています...', kr:'주사위를 굴리는 중...', fr:'Lancement des dés...', ru:'Бросаем кости...', hi:'डाइस फेंके जा रहे हैं...', ar:'جارٍ رمي النرد...' },
  'Dealing cards...': { my:'ကတ်ဝေနေပါတယ်...', en:'Dealing cards...', cn:'正在发牌...', jp:'カードを配っています...', kr:'카드를 나누는 중...', fr:'Distribution des cartes...', ru:'Раздаём карты...', hi:'कार्ड बाँटे जा रहे हैं...', ar:'جارٍ توزيع البطاقات...' },
  'Balance မလုံလောက်လို့ challenge failed.': { my:'လက်ကျန်ငွေ မလုံလောက်လို့ စိန်ခေါ်မှု မအောင်မြင်ပါ။', en:'Challenge failed because a player has insufficient balance.', cn:'由于玩家余额不足，挑战失败。', jp:'プレイヤーの残高不足によりチャレンジに失敗しました。', kr:'플레이어 잔액 부족으로 도전이 실패했습니다.', fr:'Défi échoué : solde insuffisant.', ru:'Вызов не удался: недостаточно средств.', hi:'बैलेंस कम होने के कारण चुनौती विफल हुई।', ar:'فشل التحدي بسبب عدم كفاية الرصيد.' },
  'First card dealt...': { my:'ပထမကတ် ဝေပြီးပါပြီ...', en:'First card dealt...', cn:'已发第一张牌...', jp:'1枚目のカードを配りました...', kr:'첫 번째 카드를 나눴습니다...', fr:'Première carte distribuée...', ru:'Первая карта роздана...', hi:'पहला कार्ड बाँटा गया...', ar:'تم توزيع البطاقة الأولى...' },
  'Second card dealt...': { my:'ဒုတိယကတ် ဝေပြီးပါပြီ...', en:'Second card dealt...', cn:'已发第二张牌...', jp:'2枚目のカードを配りました...', kr:'두 번째 카드를 나눴습니다...', fr:'Deuxième carte distribuée...', ru:'Вторая карта роздана...', hi:'दूसरा कार्ड बाँटा गया...', ar:'تم توزيع البطاقة الثانية...' },
  'All cards revealed...': { my:'ကတ်အားလုံး ဖော်ပြပြီးပါပြီ...', en:'All cards revealed...', cn:'所有牌已揭示...', jp:'すべてのカードを公開しました...', kr:'모든 카드를 공개했습니다...', fr:'Toutes les cartes sont révélées...', ru:'Все карты открыты...', hi:'सभी कार्ड दिखा दिए गए...', ar:'تم كشف جميع البطاقات...' },
  'Card drawn.': { my:'ကတ်တစ်ကတ် ဆွဲပြီးပါပြီ။', en:'Card drawn.', cn:'已抽一张牌。', jp:'カードを引きました。', kr:'카드를 뽑았습니다.', fr:'Carte tirée.', ru:'Карта взята.', hi:'कार्ड निकाला गया।', ar:'تم سحب بطاقة.' },
  'Stand.': { my:'ဒီမှာ ရပ်ပါမယ်။', en:'Stand.', cn:'停牌。', jp:'スタンド。', kr:'스탠드.', fr:'Rester.', ru:'Остановиться.', hi:'रुकें।', ar:'توقف.' },
  'Blackjack round expired.': { my:'Blackjack ပွဲ အချိန်ကုန်သွားပါပြီ။', en:'Blackjack round expired.', cn:'二十一点回合已超时。', jp:'ブラックジャックのラウンドが時間切れです。', kr:'블랙잭 라운드 시간이 초과되었습니다.', fr:'Le tour de Blackjack a expiré.', ru:'Раунд блэкджека завершён по времени.', hi:'ब्लैकजैक राउंड का समय समाप्त हुआ।', ar:'انتهى وقت جولة البلاك جاك.' },
  'Mines round expired.': { my:'Mines ပွဲ အချိန်ကုန်သွားပါပြီ။', en:'Mines round expired.', cn:'扫雷回合已超时。', jp:'マインズのラウンドが時間切れです。', kr:'마인즈 라운드 시간이 초과되었습니다.', fr:'Le tour de Mines a expiré.', ru:'Раунд «Сапёр» завершён по времени.', hi:'माइन्स राउंड का समय समाप्त हुआ।', ar:'انتهى وقت جولة الألغام.' },
  'Already revealed.': { my:'ဖော်ပြပြီးသား ဖြစ်ပါတယ်။', en:'Already revealed.', cn:'已经揭示。', jp:'すでに公開されています。', kr:'이미 공개되었습니다.', fr:'Déjà révélé.', ru:'Уже открыто.', hi:'पहले ही दिखाया जा चुका है।', ar:'تم الكشف بالفعل.' },
  'Opening tile...': { my:'အကွက် ဖွင့်နေပါတယ်...', en:'Opening tile...', cn:'正在打开格子...', jp:'マスを開いています...', kr:'타일을 여는 중...', fr:'Ouverture de la case...', ru:'Открываем ячейку...', hi:'टाइल खोली जा रही है...', ar:'جارٍ فتح الخانة...' },
  'Cash out...': { my:'ငွေထုတ်နေပါတယ်...', en:'Cash out...', cn:'正在兑现...', jp:'現金化中...', kr:'캐시아웃 중...', fr:'Encaissement...', ru:'Забираем выигрыш...', hi:'कैश आउट हो रहा है...', ar:'جارٍ السحب...' },
  'Cancelling...': { my:'ပယ်ဖျက်နေပါတယ်...', en:'Cancelling...', cn:'正在取消...', jp:'キャンセル中...', kr:'취소 중...', fr:'Annulation...', ru:'Отмена...', hi:'रद्द किया जा रहा है...', ar:'جارٍ الإلغاء...' },
  'Already opened.': { my:'ဖွင့်ပြီးသား အကွက်ပါ။', en:'Already opened.', cn:'该格已打开。', jp:'すでに開いています。', kr:'이미 열린 칸입니다.', fr:'Déjà ouverte.', ru:'Уже открыто.', hi:'यह टाइल पहले ही खुल चुकी है।', ar:'تم فتح الخانة بالفعل.' },
  'BOOM! Mine hit.': { my:'BOOM! မိုင်းထိသွားပါပြီ။', en:'BOOM! Mine hit.', cn:'轰！踩到地雷。', jp:'爆発！地雷に当たりました。', kr:'쾅! 지뢰를 밟았습니다.', fr:'BOUM ! Mine touchée.', ru:'Бум! Попали на мину.', hi:'धमाका! माइन लग गई।', ar:'انفجار! اصطدمت بلغم.' },
  'Perfect clear!': { my:'အပြည့်အဝ အောင်မြင်ပါပြီ!', en:'Perfect clear!', cn:'完美通关！', jp:'パーフェクトクリア！', kr:'완벽한 클리어!', fr:'Victoire parfaite !', ru:'Идеальное прохождение!', hi:'परफेक्ट क्लियर!', ar:'إنهاء مثالي!' },
  'Safe!': { my:'လုံခြုံပါတယ်!', en:'Safe!', cn:'安全！', jp:'セーフ！', kr:'안전!', fr:'Sans danger !', ru:'Безопасно!', hi:'सुरक्षित!', ar:'آمن!' },
  'ဒီ Mines button ကို သက်ဆိုင်တဲ့ user ပဲနှိပ်နိုင်ပါတယ်။': { my:'ဒီ Mines button ကို သက်ဆိုင်ရာ ကစားသူသာ နှိပ်နိုင်ပါတယ်။', en:'Only the player who owns this Mines game can use these buttons.', cn:'只有此扫雷游戏的玩家可以使用这些按钮。', jp:'このマインズゲームの本人のみボタンを操作できます。', kr:'해당 마인즈 게임의 플레이어만 버튼을 사용할 수 있습니다.', fr:'Seul le joueur de cette partie de Mines peut utiliser ces boutons.', ru:'Только игрок этой игры «Сапёр» может использовать кнопки.', hi:'केवल इस माइन्स गेम का खिलाड़ी बटन इस्तेमाल कर सकता है।', ar:'يمكن للاعب صاحب لعبة الألغام فقط استخدام هذه الأزرار.' },
  'Safe tile အနည်းဆုံး': { my:'Safe အကွက် အနည်းဆုံး', en:'At least', cn:'至少', jp:'最低', kr:'최소', fr:'Au moins', ru:'Не менее', hi:'कम से कम', ar:'على الأقل' },
  'Cash Out unlock ဖြစ်ပြီးသားဆို Cash Out ပဲလုပ်လို့ရပါတယ်။': { my:'Cash Out ဖွင့်ပြီးသားဖြစ်လို့ Cash Out ကိုသာ လုပ်နိုင်ပါတယ်။', en:'Cash Out is already unlocked; you can only cash out now.', cn:'提现已解锁；现在只能兑现。', jp:'キャッシュアウトが解除済みです。今はキャッシュアウトのみ可能です。', kr:'캐시아웃이 이미 해제되어 지금은 캐시아웃만 가능합니다.', fr:'Le retrait est débloqué ; vous ne pouvez que retirer maintenant.', ru:'Вывод уже доступен; теперь можно только забрать выигрыш.', hi:'कैश आउट अनलॉक है; अब केवल कैश आउट कर सकते हैं।', ar:'تم فتح السحب؛ يمكنك السحب فقط الآن.' },
  'Cancelled & refunded.': { my:'ပယ်ဖျက်ပြီး ငွေပြန်အမ်းပြီးပါပြီ။', en:'Cancelled & refunded.', cn:'已取消并退款。', jp:'キャンセルして返金しました。', kr:'취소 및 환불되었습니다.', fr:'Annulé et remboursé.', ru:'Отменено, средства возвращены.', hi:'रद्द किया गया और रिफंड हो गया।', ar:'تم الإلغاء والاسترداد.' },
  'Cash Out unlock မဖြစ်သေးခင် အချိန်ကုန်သွားလို့ bet refund ပြန်ပေးထားပါတယ်။': { my:'Cash Out မဖွင့်မီ အချိန်ကုန်သွားလို့ လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'The round timed out before Cash Out unlocked; your bet has been refunded.', cn:'提现解锁前回合超时，已退还下注金额。', jp:'キャッシュアウト解除前に時間切れとなったため、賭け金を返金しました。', kr:'캐시아웃 해제 전에 시간이 초과되어 베팅 금액을 환불했습니다.', fr:'Le tour a expiré avant le déblocage du retrait ; la mise a été remboursée.', ru:'Раунд завершился до разблокировки вывода; ставка возвращена.', hi:'कैश आउट अनलॉक होने से पहले समय समाप्त हुआ; बेट वापस कर दी गई।', ar:'انتهى الوقت قبل فتح السحب؛ تمت إعادة مبلغ الرهان.' },
  'Mines round cancelled. Bet refund ပြန်ပေးထားပါတယ်။': { my:'Mines ပွဲကို ပယ်ဖျက်ပြီး လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'Mines round cancelled. Bet refunded.', cn:'扫雷回合已取消，下注已退款。', jp:'マインズのラウンドをキャンセルし、賭け金を返金しました。', kr:'마인즈 라운드가 취소되어 베팅 금액이 환불되었습니다.', fr:'Tour Mines annulé. Mise remboursée.', ru:'Раунд «Сапёр» отменён. Ставка возвращена.', hi:'माइन्स राउंड रद्द हुआ। बेट वापस कर दी गई।', ar:'تم إلغاء جولة الألغام وإعادة الرهان.' },
  'Safe tile ဖွင့်ပြီးပါပြီ။ ဆက်ရွေးမလား Cash Out လုပ်မလား ရွေးပါ။': { my:'လုံခြုံတဲ့အကွက် ဖွင့်ပြီးပါပြီ။ ဆက်ရွေးရန် သို့မဟုတ် Cash Out ကိုရွေးပါ။', en:'Safe tile opened. Choose to continue or cash out.', cn:'安全格已打开。选择继续或兑现。', jp:'安全マスを開きました。続けるか換金するか選択してください。', kr:'안전 타일이 열렸습니다. 계속하거나 캐시아웃을 선택하세요.', fr:'Case sûre ouverte. Continuez ou encaissez.', ru:'Безопасная ячейка открыта. Продолжите или заберите выигрыш.', hi:'सुरक्षित टाइल खुल गई। आगे बढ़ें या कैश आउट चुनें।', ar:'تم فتح خانة آمنة. اختر المتابعة أو السحب.' },
  'First safe ဖွင့်ပြီးပါပြီ။ ဒီ free safe ကို multiplier ထဲမတွက်ပါ။ Cash Out ပေါ်ဖို့ safe': { my:'ပထမ safe ကို ဖွင့်ပြီးပါပြီ။ အခမဲ့ safe ကို multiplier ထဲမတွက်ပါ။ Cash Out ပေါ်ရန် safe', en:'First safe opened. This free safe does not count toward the multiplier. Safe tiles required to unlock Cash Out:', cn:'已打开第一个安全格。此免费格不计入倍数。解锁兑现所需的安全格：', jp:'最初の安全マスを開きました。この無料マスは倍率に含まれません。換金解除に必要な安全マス：', kr:'첫 안전 타일을 열었습니다. 무료 타일은 배수에 포함되지 않습니다. 캐시아웃에 필요한 안전 타일:', fr:'Première case sûre ouverte. Cette case gratuite ne compte pas dans le multiplicateur. Cases sûres requises pour le retrait :', ru:'Первая безопасная ячейка открыта. Бесплатная ячейка не учитывается в множителе. Для вывода нужны безопасные ячейки:', hi:'पहली सुरक्षित टाइल खुल गई। यह मुफ्त टाइल गुणक में नहीं गिनी जाती। कैश आउट के लिए सुरक्षित टाइलें चाहिए:', ar:'تم فتح أول خانة آمنة. لا تُحتسب هذه الخانة المجانية في المضاعف. الخانات الآمنة المطلوبة للسحب:' },
  'Safe tile ဖွင့်ပြီးပါပြီ။ Cash Out ပေါ်ဖို့ safe': { my:'Safe tile ဖွင့်ပြီးပါပြီ။ Cash Out ပေါ်ရန် safe', en:'Safe tile opened. Safe tiles required to unlock Cash Out:', cn:'安全格已打开。解锁兑现所需的安全格：', jp:'安全マスを開きました。換金解除に必要な安全マス：', kr:'안전 타일을 열었습니다. 캐시아웃에 필요한 안전 타일:', fr:'Case sûre ouverte. Cases sûres requises pour le retrait :', ru:'Безопасная ячейка открыта. Для вывода нужны безопасные ячейки:', hi:'सुरक्षित टाइल खुल गई। कैश आउट के लिए सुरक्षित टाइलें चाहिए:', ar:'تم فتح خانة آمنة. الخانات الآمنة المطلوبة للسحب:' },
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
  'WIN': { my:'အနိုင်', en:'WIN', cn:'获胜', jp:'勝利', kr:'승리', fr:'GAGNÉ', ru:'ПОБЕДА', hi:'जीत', ar:'فوز' },
  'LOSE': { my:'အရှုံး', en:'LOSE', cn:'失败', jp:'敗北', kr:'패배', fr:'PERDU', ru:'ПОРАЖЕНИЕ', hi:'हार', ar:'خسارة' },
  'PUSH': { my:'သရေ', en:'PUSH', cn:'平局', jp:'引き分け', kr:'무승부', fr:'ÉGALITÉ', ru:'НИЧЬЯ', hi:'बराबरी', ar:'تعادل' },
  'BUST': { my:'ကျော်လွန်', en:'BUST', cn:'爆牌', jp:'バースト', kr:'버스트', fr:'DÉPASSÉ', ru:'ПЕРЕБОР', hi:'बस्ट', ar:'تجاوز' },
  'TIE': { my:'သရေ', en:'TIE', cn:'平局', jp:'引き分け', kr:'무승부', fr:'ÉGALITÉ', ru:'НИЧЬЯ', hi:'बराबरी', ar:'تعادل' },
  'BLACKJACK': { my:'Blackjack', en:'BLACKJACK', cn:'二十一点', jp:'ブラックジャック', kr:'블랙잭', fr:'BLACKJACK', ru:'БЛЭКДЖЕК', hi:'ब्लैकजैक', ar:'بلاك جاك' },
  'BIKA Pro Slot': { my:'BIKA Pro Slot', en:'BIKA Pro Slot', cn:'BIKA 专业老虎机', jp:'BIKA プロスロット', kr:'BIKA 프로 슬롯', fr:'BIKA Pro Slot', ru:'BIKA Pro Slot', hi:'BIKA प्रो स्लॉट', ar:'BIKA برو سلوت' },
  'User data မတွေ့ပါ။ Bot ကို': { my:'အသုံးပြုသူဒေတာ မတွေ့ပါ။ Bot ကို', en:'User data not found. Please', cn:'未找到用户数据。请先', jp:'ユーザーデータが見つかりません。まず', kr:'사용자 데이터를 찾을 수 없습니다. 먼저', fr:'Données utilisateur introuvables. Veuillez', ru:'Данные пользователя не найдены. Сначала', hi:'उपयोगकर्ता डेटा नहीं मिला। पहले', ar:'لم يتم العثور على بيانات المستخدم. يرجى' },
  'Settlement မအောင်မြင်လို့ ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။': { my:'Settlement မအောင်မြင်သဖြင့် ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။', en:'Settlement failed; the ledger was atomically rolled back.', cn:'结算失败；账目已原子回滚。', jp:'決済に失敗したため、台帳は原子的にロールバックされました。', kr:'정산 실패로 원장이 원자적으로 롤백되었습니다.', fr:'Le règlement a échoué ; le registre a été annulé atomiquement.', ru:'Расчёт не выполнен; записи баланса атомарно отменены.', hi:'सेटलमेंट विफल रहा; लेज़र को परमाणु रूप से रोलबैक किया गया।', ar:'فشلت التسوية؛ وتم التراجع عن سجل الحساب ذريًا.' },
  'Settlement မအောင်မြင်ပါ။ ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။': { my:'Settlement မအောင်မြင်ပါ။ ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။', en:'Settlement failed. The ledger was atomically rolled back.', cn:'结算失败。账目已原子回滚。', jp:'決済に失敗しました。台帳は原子的にロールバックされました。', kr:'정산에 실패했습니다. 원장이 원자적으로 롤백되었습니다.', fr:'Échec du règlement. Le registre a été annulé atomiquement.', ru:'Расчёт не выполнен. Записи баланса атомарно отменены.', hi:'सेटलमेंट विफल रहा। लेज़र को परमाणु रूप से रोलबैक किया गया।', ar:'فشلت التسوية. وتم التراجع عن سجل الحساب ذريًا.' },
  'User ကဒ် ၂ ကဒ်ဝေပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ဒီမှာတင်ရပ်မလား ရွေးပါ။': { my:'ကစားသူကို ကတ် ၂ ကတ်ဝေပေးပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ရပ်မလား ရွေးပါ။', en:'The player has been dealt two cards. Choose Hit or Stand.', cn:'玩家已获得两张牌。请选择要牌或停牌。', jp:'プレイヤーに2枚配りました。ヒットかスタンドを選んでください。', kr:'플레이어에게 카드 2장이 배분되었습니다. 히트 또는 스탠드를 선택하세요.', fr:'Deux cartes ont été distribuées. Choisissez Tirer ou Rester.', ru:'Игрок получил две карты. Выберите взять карту или остановиться.', hi:'खिलाड़ी को दो कार्ड मिले हैं। कार्ड लें या रुकें चुनें।', ar:'تم توزيع ورقتين على اللاعب. اختر سحب بطاقة أو التوقف.' },
  'ကဒ်တစ်ကဒ်ထပ်ဆွဲပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ရပ်မလား ရွေးပါ။': { my:'ကတ်တစ်ကတ် ထပ်ဆွဲပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ရပ်မလား ရွေးပါ။', en:'You drew another card. Choose Hit or Stand.', cn:'您又抽了一张牌。请选择要牌或停牌。', jp:'カードをもう1枚引きました。ヒットかスタンドを選んでください。', kr:'카드를 한 장 더 뽑았습니다. 히트 또는 스탠드를 선택하세요.', fr:'Vous avez tiré une autre carte. Choisissez Tirer ou Rester.', ru:'Вы взяли ещё одну карту. Выберите действие.', hi:'आपने एक और कार्ड लिया। कार्ड लें या रुकें चुनें।', ar:'سحبت بطاقة أخرى. اختر السحب أو التوقف.' },
  'User bust!': { my:'ကစားသူ bust ဖြစ်သွားပါပြီ!', en:'Player bust!', cn:'玩家爆牌！', jp:'プレイヤーがバーストしました！', kr:'플레이어 버스트!', fr:'Le joueur a dépassé 21 !', ru:'У игрока перебор!', hi:'खिलाड़ी बस्ट हो गया!', ar:'تجاوز اللاعب 21!' },
  'Dealer cards revealed...': { my:'ဒိုင်ကတ်များ ဖော်ပြပြီးပါပြီ...', en:'Dealer cards revealed...', cn:'庄家牌已揭示...', jp:'ディーラーのカードを公開しました...', kr:'딜러 카드 공개...', fr:'Cartes du croupier révélées...', ru:'Карты дилера открыты...', hi:'डीलर के कार्ड दिखाए गए...', ar:'تم كشف بطاقات الموزع...' },
  'Dealer draws a card...': { my:'ဒိုင်ကတ်တစ်ကတ် ဆွဲနေပါတယ်...', en:'Dealer draws a card...', cn:'庄家抽一张牌...', jp:'ディーラーがカードを引きます...', kr:'딜러가 카드를 뽑습니다...', fr:'Le croupier tire une carte...', ru:'Дилер берёт карту...', hi:'डीलर एक कार्ड खींचता है...', ar:'يسحب الموزع بطاقة...' },
  'အချိန်ကုန်သွားလို့ bet refund ပြန်ပေးထားပါတယ်။': { my:'အချိန်ကုန်သွားလို့ လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'Time expired; your bet has been refunded.', cn:'时间已到，下注金额已退还。', jp:'時間切れのため、賭け金を返金しました。', kr:'시간이 초과되어 베팅 금액을 환불했습니다.', fr:'Délai écoulé ; mise remboursée.', ru:'Время истекло; ставка возвращена.', hi:'समय समाप्त हुआ; बेट वापस कर दी गई।', ar:'انتهى الوقت؛ تمت إعادة الرهان.' },
  'Safe tile ကိုရွေးပါ။': { my:'Safe အကွက်ကို ရွေးပါ။', en:'Choose a safe tile.', cn:'选择一个安全格。', jp:'安全なマスを選んでください。', kr:'안전 타일을 선택하세요.', fr:'Choisissez une case sûre.', ru:'Выберите безопасную ячейку.', hi:'सुरक्षित टाइल चुनें।', ar:'اختر خانة آمنة.' },
  'Payout error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။': { my:'Payout error ဖြစ်လို့ လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'Payout failed; the bet has been refunded.', cn:'派彩失败，下注已退款。', jp:'払い戻しエラーのため、賭け金を返金しました。', kr:'지급 오류로 베팅 금액을 환불했습니다.', fr:'Échec du paiement ; la mise a été remboursée.', ru:'Ошибка выплаты; ставка возвращена.', hi:'भुगतान विफल हुआ; बेट वापस कर दी गई।', ar:'فشل الدفع؛ تمت إعادة الرهان.' },
  'Payout/refund မပြီးသေးပါ။ ထပ်ကြိုးစားနိုင်ပါတယ်။': { my:'Payout/refund မပြီးသေးပါ။ ထပ်ကြိုးစားနိုင်ပါတယ်။', en:'Payout/refund is still pending. You can retry.', cn:'派彩/退款仍在处理中，可以重试。', jp:'支払い/返金は保留中です。再試行できます。', kr:'지급/환불이 아직 대기 중입니다. 다시 시도할 수 있습니다.', fr:'Paiement/remboursement en attente. Réessayez.', ru:'Выплата/возврат ещё не завершены. Можно повторить.', hi:'भुगतान/रिफंड लंबित है। आप फिर कोशिश कर सकते हैं।', ar:'الدفع/الاسترداد قيد الانتظار. يمكنك المحاولة مجددًا.' },
  'Mines Payout Error': { my:'Mines Payout အမှား', en:'Mines Payout Error', cn:'扫雷派彩错误', jp:'マインズの払い戻しエラー', kr:'마인즈 지급 오류', fr:'Erreur de paiement Mines', ru:'Ошибка выплаты в «Сапёре»', hi:'माइन्स भुगतान त्रुटि', ar:'خطأ دفع الألغام' },
  'Slot Error': { my:'Slot အမှား', en:'Slot Error', cn:'老虎机错误', jp:'スロットエラー', kr:'슬롯 오류', fr:'Erreur de slot', ru:'Ошибка слота', hi:'स्लॉट त्रुटि', ar:'خطأ السلوت' },
  'Please wait, your slot spin is in progress.': { my:'ခဏစောင့်ပါ။ Slot လှည့်နေဆဲပါ။', en:'Please wait, your slot spin is in progress.', cn:'请稍候，老虎机正在旋转。', jp:'スロットが進行中です。お待ちください。', kr:'슬롯이 진행 중입니다. 잠시 기다려 주세요.', fr:'Veuillez patienter, le tour de slot est en cours.', ru:'Подождите, вращение слота ещё идёт.', hi:'कृपया प्रतीक्षा करें, स्लॉट चल रहा है।', ar:'يرجى الانتظار، لعبة السلوت قيد التشغيل.' },
  '⚠️ Telegram rate limit ဖြစ်နိုင်ပါတယ်။ ခဏစောင့်ပြီး ထပ်နှိပ်ပါ။': { my:'⚠️ Telegram ကန့်သတ်ချက် ဖြစ်နိုင်ပါတယ်။ ခဏစောင့်ပြီး ပြန်နှိပ်ပါ။', en:'⚠️ Telegram may be rate limiting. Wait briefly and try again.', cn:'⚠️ Telegram 可能触发频率限制，请稍候重试。', jp:'⚠️ Telegram のレート制限の可能性があります。少し待って再試行してください。', kr:'⚠️ Telegram 요청 제한일 수 있습니다. 잠시 후 다시 시도하세요.', fr:'⚠️ Limite de débit Telegram possible. Attendez puis réessayez.', ru:'⚠️ Возможно, действует ограничение Telegram. Подождите и повторите.', hi:'⚠️ Telegram की दर सीमा हो सकती है। थोड़ा रुककर पुनः प्रयास करें।', ar:'⚠️ قد يكون هناك حد للطلبات من Telegram. انتظر قليلًا ثم أعد المحاولة.' },
  'safe tiles required': { my:'Safe အကွက် လိုအပ်သည်', en:'safe tiles required', cn:'个安全格', jp:'安全マス必要', kr:'안전 타일 필요', fr:'cases sûres requises', ru:'безопасных ячеек нужно', hi:'सुरक्षित टाइलें आवश्यक', ar:'خانات آمنة مطلوبة' },
  'You hit a mine.': { my:'မိုင်းထိသွားပါပြီ။', en:'You hit a mine.', cn:'踩到地雷了。', jp:'地雷に当たりました。', kr:'지뢰를 밟았습니다.', fr:'Vous avez touché une mine.', ru:'Вы попали на мину.', hi:'माइन लग गई।', ar:'لقد اصطدمت بلغم.' },
  'Choose a safe tile.': { my:'Safe အကွက်တစ်ခုကို ရွေးပါ။', en:'Choose a safe tile.', cn:'选择一个安全格。', jp:'安全なマスを選んでください。', kr:'안전 타일을 선택하세요.', fr:'Choisissez une case sûre.', ru:'Выберите безопасную ячейку.', hi:'सुरक्षित टाइल चुनें।', ar:'اختر خانة آمنة.' },
  'Continue, or choose Cancel / Refund.': { my:'ဆက်ကစားပါ၊ သို့မဟုတ် Cancel / Refund ကိုရွေးပါ။', en:'Continue, or choose Cancel / Refund.', cn:'继续游戏，或选择取消/退款。', jp:'続けるか、キャンセル/返金を選択してください。', kr:'계속하거나 취소/환불을 선택하세요.', fr:'Continuez ou choisissez Annuler / Rembourser.', ru:'Продолжайте или выберите отмену/возврат.', hi:'जारी रखें या रद्द / रिफंड चुनें।', ar:'تابع اللعب أو اختر الإلغاء / الاسترداد.' },
  '❌ Mines round cancelled. Bet refunded.': { my:'❌ Mines ပွဲပယ်ဖျက်ပြီး လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'❌ Mines round cancelled. Bet refunded.', cn:'❌ 扫雷回合已取消，下注已退款。', jp:'❌ マインズのラウンドをキャンセルし、賭け金を返金しました。', kr:'❌ 마인즈 라운드가 취소되어 베팅 금액이 환불되었습니다.', fr:'❌ Tour Mines annulé. Mise remboursée.', ru:'❌ Раунд «Сапёр» отменён. Ставка возвращена.', hi:'❌ माइन्स राउंड रद्द हुआ। बेट वापस कर दी गई।', ar:'❌ تم إلغاء جولة الألغام وإعادة الرهان.' },
  '⌛ Mines round expired; your bet has been refunded.': { my:'⌛ Mines ပွဲအချိန်ကုန်သွားလို့ လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'⌛ Mines round expired; your bet has been refunded.', cn:'⌛ 扫雷回合已超时，下注已退款。', jp:'⌛ マインズのラウンドが時間切れとなり、賭け金を返金しました。', kr:'⌛ 마인즈 라운드 시간이 초과되어 베팅 금액을 환불했습니다.', fr:'⌛ Tour Mines expiré ; mise remboursée.', ru:'⌛ Раунд «Сапёр» завершён по времени; ставка возвращена.', hi:'⌛ माइन्स राउंड समाप्त हुआ; बेट वापस कर दी गई।', ar:'⌛ انتهى وقت جولة الألغام؛ تمت إعادة الرهان.' },
  'Cash Out is already unlocked; you can only cash out now.': { my:'Cash Out ဖွင့်ပြီးသားဖြစ်လို့ ယခု ငွေထုတ်ခြင်းသာ လုပ်နိုင်ပါတယ်။', en:'Cash Out is already unlocked; you can only cash out now.', cn:'兑现已解锁；现在只能兑现。', jp:'換金が解除済みなので、今は換金のみ可能です。', kr:'캐시아웃이 이미 해제되어 지금은 캐시아웃만 가능합니다.', fr:'Le retrait est déjà débloqué ; vous ne pouvez qu’encaisser.', ru:'Вывод уже разблокирован; теперь можно только забрать выигрыш.', hi:'कैश आउट पहले से अनलॉक है; अब केवल कैश आउट कर सकते हैं।', ar:'تم فتح السحب بالفعل؛ يمكنك السحب فقط الآن.' },
  '⚠️ Telegram rate limit ဖြစ်နေပါတယ်။ ခဏစောင့်ပြီး ထပ်နှိပ်ပါ။': { my:'⚠️ Telegram ကန့်သတ်ချက် ဖြစ်နေပါတယ်။ ခဏစောင့်ပြီး ပြန်နှိပ်ပါ။', en:'⚠️ Telegram rate limit is active. Wait briefly and try again.', cn:'⚠️ Telegram 频率限制已触发，请稍候重试。', jp:'⚠️ Telegram のレート制限中です。少し待って再試行してください。', kr:'⚠️ Telegram 요청 제한이 적용 중입니다. 잠시 후 다시 시도하세요.', fr:'⚠️ Limite de débit Telegram active. Attendez puis réessayez.', ru:'⚠️ Действует ограничение Telegram. Подождите и повторите.', hi:'⚠️ Telegram दर सीमा लागू है। थोड़ा रुककर पुनः प्रयास करें।', ar:'⚠️ تم تفعيل حد الطلبات من Telegram. انتظر ثم أعد المحاولة.' },

  'Dice Duel Error': { my:'Dice Duel အမှား', en:'Dice Duel Error', cn:'骰子对决错误', jp:'ダイス対決エラー', kr:'주사위 대결 오류', fr:'Erreur de duel de dés', ru:'Ошибка дуэли на костях', hi:'डाइस द्वंद्व त्रुटि', ar:'خطأ مبارزة النرد' },
  'Shan Duel Error': { my:'Shan Duel အမှား', en:'Shan Duel Error', cn:'掸牌对决错误', jp:'シャン対決エラー', kr:'샨 대결 오류', fr:'Erreur de duel Shan', ru:'Ошибка дуэли Shan', hi:'शान द्वंद्व त्रुटि', ar:'خطأ تحدي شان' },
  'Settlement failed': { my:'Settlement မအောင်မြင်ပါ', en:'Settlement failed', cn:'结算失败', jp:'決済に失敗しました', kr:'정산 실패', fr:'Règlement échoué', ru:'Расчёт не выполнен', hi:'सेटलमेंट विफल', ar:'فشلت التسوية' },
  '🤝 TIE': { my:'🤝 သရေ', en:'🤝 TIE', cn:'🤝 平局', jp:'🤝 引き分け', kr:'🤝 무승부', fr:'🤝 ÉGALITÉ', ru:'🤝 НИЧЬЯ', hi:'🤝 बराबरी', ar:'🤝 تعادل' },
  'refund ပြန်ပေးပြီးပါပြီ။': { my:'ငွေပြန်အမ်းပြီးပါပြီ။', en:'refund has been processed.', cn:'已退款。', jp:'返金しました。', kr:'환불되었습니다.', fr:'remboursement effectué.', ru:'возврат выполнен.', hi:'रिफंड कर दिया गया है।', ar:'تمت إعادة المبلغ.' },
  'OK': { my:'အိုကေ', en:'OK', cn:'好的', jp:'OK', kr:'확인', fr:'OK', ru:'ОК', hi:'ठीक है', ar:'حسنًا' },
  'Player bust!': { my:'ကစားသူ bust ဖြစ်သွားပါပြီ!', en:'Player bust!', cn:'玩家爆牌！', jp:'プレイヤーがバーストしました！', kr:'플레이어 버스트!', fr:'Le joueur a dépassé 21 !', ru:'У игрока перебор!', hi:'खिलाड़ी बस्ट हो गया!', ar:'تجاوز اللاعب 21!' },
  '✨ Dealer cards revealed...': { my:'✨ ဒိုင်ကတ်များ ဖော်ပြပြီးပါပြီ...', en:'✨ Dealer cards revealed...', cn:'✨ 庄家牌已揭示...', jp:'✨ ディーラーのカードを公開しました...', kr:'✨ 딜러 카드 공개...', fr:'✨ Cartes du croupier révélées...', ru:'✨ Карты дилера открыты...', hi:'✨ डीलर के कार्ड दिखाए गए...', ar:'✨ تم كشف بطاقات الموزع...' },
  '🃏 Dealer draws a card...': { my:'🃏 ဒိုင်ကတ်တစ်ကတ် ဆွဲနေပါတယ်...', en:'🃏 Dealer draws a card...', cn:'🃏 庄家抽一张牌...', jp:'🃏 ディーラーがカードを引きます...', kr:'🃏 딜러가 카드를 뽑습니다...', fr:'🃏 Le croupier tire une carte...', ru:'🃏 Дилер берёт карту...', hi:'🃏 डीलर एक कार्ड खींचता है...', ar:'🃏 يسحب الموزع بطاقة...' },
  '❔ Choose a safe tile.': { my:'❔ Safe အကွက်တစ်ခုကို ရွေးပါ။', en:'❔ Choose a safe tile.', cn:'❔ 选择一个安全格。', jp:'❔ 安全なマスを選んでください。', kr:'❔ 안전 타일을 선택하세요.', fr:'❔ Choisissez une case sûre.', ru:'❔ Выберите безопасную ячейку.', hi:'❔ सुरक्षित टाइल चुनें।', ar:'❔ اختر خانة آمنة.' },
  '❌ Mines round cancelled. Bet refund ပြန်ပေးထားပါတယ်။': { my:'❌ Mines ပွဲပယ်ဖျက်ပြီး လောင်းကြေးပြန်အမ်းထားပါတယ်။', en:'❌ Mines round cancelled. Bet refunded.', cn:'❌ 扫雷回合已取消，下注已退款。', jp:'❌ マインズのラウンドをキャンセルし、賭け金を返金しました。', kr:'❌ 마인즈 라운드가 취소되어 베팅 금액이 환불되었습니다.', fr:'❌ Tour Mines annulé. Mise remboursée.', ru:'❌ Раунд «Сапёр» отменён. Ставка возвращена.', hi:'❌ माइन्स राउंड रद्द हुआ। बेट वापस कर दी गई।', ar:'❌ تم إلغاء جولة الألغام وإعادة الرهان.' },

  'group ထဲမှာပဲ သုံးနိုင်ပါတယ်။': { my:'Group ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', en:'This command is only available in groups.', cn:'此命令仅可在群组中使用。', jp:'このコマンドはグループでのみ使用できます。', kr:'이 명령어는 그룹에서만 사용할 수 있습니다.', fr:'Cette commande est disponible uniquement dans les groupes.', ru:'Эта команда доступна только в группах.', hi:'यह कमांड केवल समूहों में उपलब्ध है।', ar:'هذا الأمر متاح في المجموعات فقط.' },
  'Reply ထောက်ထားတဲ့ user ကိုသာ challenge လုပ်ပါ။': { my:'Reply ထောက်ထားသော user ကိုသာ စိန်ခေါ်နိုင်ပါတယ်။', en:'Reply to a user to challenge them.', cn:'回复某位用户即可向其发起挑战。', jp:'ユーザーに返信して挑戦してください。', kr:'사용자 메시지에 답장하여 도전하세요.', fr:'Répondez au message d’un utilisateur pour le défier.', ru:'Ответьте на сообщение пользователя, чтобы бросить вызов.', hi:'चुनौती देने के लिए किसी उपयोगकर्ता के संदेश का जवाब दें।', ar:'ردّ على رسالة المستخدم لتحديه.' },
  'Dice challenge များနေပါတယ်။': { my:'Dice စိန်ခေါ်မှုများနေပါတယ်။ ခဏစောင့်ပါ။', en:'Too many Dice challenges are active. Please wait.', cn:'骰子挑战过多，请稍候。', jp:'ダイスチャレンジが混み合っています。少しお待ちください。', kr:'주사위 대결이 많습니다. 잠시 기다려 주세요.', fr:'Trop de défis de dés en cours. Veuillez patienter.', ru:'Слишком много дуэлей на костях. Подождите.', hi:'बहुत अधिक डाइस चुनौतियाँ सक्रिय हैं। प्रतीक्षा करें।', ar:'هناك الكثير من تحديات النرد النشطة. يرجى الانتظار.' },
  'Shan challenge များနေပါတယ်။': { my:'Shan စိန်ခေါ်မှုများနေပါတယ်။ ခဏစောင့်ပါ။', en:'Too many Shan challenges are active. Please wait.', cn:'掸牌挑战过多，请稍候。', jp:'シャンチャレンジが混み合っています。少しお待ちください。', kr:'샨 대결이 많습니다. 잠시 기다려 주세요.', fr:'Trop de défis Shan en cours. Veuillez patienter.', ru:'Слишком много дуэлей Shan. Подождите.', hi:'बहुत अधिक शान चुनौतियाँ सक्रिय हैं। प्रतीक्षा करें।', ar:'هناك الكثير من تحديات شان النشطة. يرجى الانتظار.' },
  'Target must accept within 60 seconds.': { my:'ပြိုင်ဘက်က စက္ကန့် ၆၀ အတွင်း လက်ခံရပါမယ်။', en:'Target must accept within 60 seconds.', cn:'对手必须在 60 秒内接受。', jp:'相手は60秒以内に承諾する必要があります。', kr:'상대는 60초 안에 수락해야 합니다.', fr:'L’adversaire doit accepter dans les 60 secondes.', ru:'Соперник должен принять вызов в течение 60 секунд.', hi:'प्रतिद्वंद्वी को 60 सेकंड के भीतर स्वीकार करना होगा।', ar:'يجب على الخصم قبول التحدي خلال 60 ثانية.' },
  'No accept within 60 seconds.': { my:'စက္ကန့် ၆၀ အတွင်း လက်မခံခဲ့ပါ။', en:'Not accepted within 60 seconds.', cn:'60 秒内未接受。', jp:'60秒以内に承諾されませんでした。', kr:'60초 안에 수락하지 않았습니다.', fr:'Aucune acceptation dans les 60 secondes.', ru:'Вызов не принят за 60 секунд.', hi:'60 सेकंड के भीतर स्वीकार नहीं किया गया।', ar:'لم يتم قبول التحدي خلال 60 ثانية.' },
  '⛔ Owner only command ပါ။': { my:'⛔ Owner သာ အသုံးပြုနိုင်တဲ့ command ဖြစ်ပါတယ်။', en:'⛔ This command is Owner-only.', cn:'⛔ 此命令仅限所有者使用。', jp:'⛔ このコマンドはオーナー専用です。', kr:'⛔ 이 명령어는 운영자 전용입니다.', fr:'⛔ Cette commande est réservée au propriétaire.', ru:'⛔ Эта команда доступна только владельцу.', hi:'⛔ यह कमांड केवल मालिक के लिए है।', ar:'⛔ هذا الأمر متاح للمالك فقط.' },
  'Mines count ကို': { my:'Mines အရေအတွက်ကို', en:'Mines count must be one of', cn:'地雷数量必须是以下之一', jp:'地雷数は次のいずれかにしてください', kr:'지뢰 수는 다음 중 하나여야 합니다', fr:'Le nombre de mines doit être parmi', ru:'Количество мин должно быть одним из', hi:'माइन्स की संख्या इनमें से एक होनी चाहिए', ar:'يجب أن يكون عدد الألغام أحد الخيارات' },
  'Please select a valid number of mines:': { my:'မှန်ကန်သော Mines အရေအတွက်ကို ရွေးပါ:', en:'Please select a valid number of mines:', cn:'请选择有效的地雷数量：', jp:'有効な地雷数を選択してください：', kr:'유효한 지뢰 수를 선택하세요:', fr:'Veuillez choisir un nombre de mines valide :', ru:'Выберите допустимое количество мин:', hi:'कृपया माइन्स की वैध संख्या चुनें:', ar:'يرجى اختيار عدد صالح من الألغام:' },
  'Your Mines round is already running. Cash Out or Cancel before starting another.': { my:'Mines ပွဲတစ်ခု လုပ်နေဆဲပါ။ နောက်တစ်ပွဲမစမီ Cash Out သို့မဟုတ် Cancel လုပ်ပါ။', en:'Your Mines round is already running. Cash Out or Cancel before starting another.', cn:'您已有一局扫雷正在进行。开始新一局前请兑现或取消。', jp:'マインズのラウンドが進行中です。次を始める前に換金またはキャンセルしてください。', kr:'마인즈 라운드가 진행 중입니다. 새 게임을 시작하기 전에 캐시아웃하거나 취소하세요.', fr:'Votre tour de Mines est en cours. Encaissez ou annulez avant d’en commencer un autre.', ru:'Раунд «Сапёр» уже идёт. Заберите выигрыш или отмените его перед новой игрой.', hi:'आपका माइन्स राउंड पहले से चल रहा है। नया शुरू करने से पहले कैश आउट या रद्द करें।', ar:'جولة الألغام قيد التشغيل بالفعل. اسحب أو ألغِ قبل بدء جولة أخرى.' },
  'Mines game များနေပါတယ်။ ခဏစောင့်ပြီး ထပ်စမ်းပါ။': { my:'Mines ကစားသူများနေပါတယ်။ ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ။', en:'Mines is busy. Please wait and try again.', cn:'扫雷游戏繁忙，请稍候重试。', jp:'マインズが混み合っています。少し待って再試行してください。', kr:'마인즈가 혼잡합니다. 잠시 후 다시 시도하세요.', fr:'Mines est occupé. Veuillez patienter et réessayer.', ru:'Слишком много игр «Сапёр». Подождите и повторите.', hi:'माइन्स व्यस्त है। प्रतीक्षा करके पुनः प्रयास करें।', ar:'لعبة الألغام مشغولة. انتظر ثم حاول مجددًا.' },
  'Your Blackjack round is already running.': { my:'Blackjack ပွဲတစ်ခု လုပ်နေဆဲပါ။', en:'Your Blackjack round is already running.', cn:'您的二十一点回合正在进行。', jp:'ブラックジャックのラウンドが進行中です。', kr:'블랙잭 라운드가 이미 진행 중입니다.', fr:'Votre tour de Blackjack est déjà en cours.', ru:'Раунд блэкджека уже идёт.', hi:'आपका ब्लैकजैक राउंड पहले से चल रहा है।', ar:'جولة البلاك جاك قيد التشغيل بالفعل.' },
  'Please wait…': { my:'ခဏစောင့်ပါ…', en:'Please wait…', cn:'请稍候…', jp:'お待ちください…', kr:'잠시 기다려 주세요…', fr:'Veuillez patienter…', ru:'Подождите…', hi:'कृपया प्रतीक्षा करें…', ar:'يرجى الانتظار…' },
  'Cooldown:': { my:'နောက်တစ်ကြိမ် သုံးနိုင်ရန်:', en:'Cooldown:', cn:'冷却时间：', jp:'クールダウン：', kr:'재사용 대기시간:', fr:'Temps de recharge :', ru:'Перезарядка:', hi:'कूलडाउन:', ar:'وقت الانتظار:' },
  'Owner only.': { my:'Owner သာ အသုံးပြုနိုင်သည်။', en:'Owner only.', cn:'仅限所有者使用。', jp:'オーナー専用です。', kr:'운영자 전용입니다.', fr:'Réservé au propriétaire.', ru:'Только для владельца.', hi:'केवल मालिक के लिए।', ar:'للمالك فقط.' },

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
