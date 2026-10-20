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
    user_help: '👤 <b>User Commands</b>\n/dailyclaim — Daily reward\n/language — ဘာသာစကားရွေးရန်\n/mybalance — လက်ကျန်ငွေ\n/top10 — ထိပ်ဆုံးကစားသမားများ\n/shop — ဆိုင်\n\nGame commands: .slot, .dice, .shan, .bj, .mine, 2D, Auction, Event',
    owner_help: '🛡 <b>Owner Commands</b>\n/admin — Admin dashboard\n/status — Bot status\n/treasury — Treasury\n/broadcast — Broadcast tools\n/maintenance — Maintenance controls\n\nဤ menu သည် Owner အတွက်သာဖြစ်သည်။',
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
module.exports = { LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, getLanguage, t, languageKeyboard, mainMenuKeyboard, languagePickerText, MESSAGES };
