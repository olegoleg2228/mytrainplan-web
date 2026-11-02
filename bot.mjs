import { timingSafeEqual } from 'node:crypto';

export const APP_URL = 'https://mytrainplan.onrender.com/';
export const MINI_APP_LINK = 'https://t.me/mytrainplan_bot?startapp';
export function authenticated(actual, expected) {
  if (typeof actual !== 'string' || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function welcome(update) {
  const m = update?.message;
  if (!Number.isSafeInteger(update?.update_id) || !m || !Number.isSafeInteger(m.chat?.id) ||
      m.from?.is_bot || typeof m.text !== 'string') return null;
  const privateChat = m.chat.type === 'private' && m.chat.id > 0 && m.from?.id === m.chat.id;
  const groupChat = ['group','supergroup'].includes(m.chat.type) && m.chat.id < 0;
  const text = m.text.trim();
  if (privateChat && /^\/start(?:@mytrainplan_bot)?(?:\s.*)?$/i.test(text)) return {
    chat_id: m.chat.id,
    parse_mode:'HTML',
    text: '🏋️ <b>Мой тренировочный план</b>\n\n📅 Открывай свои тренировки\n📝 Записывай результаты\n📈 Следи за прогрессом вместе с тренером\n\n🔑 <b>Первый вход?</b>\nПолучи одноразовый код в браузерной версии: <b>Кабинет → Telegram → Получить код</b>. Введи его в приложении — и твой план всегда под рукой.',
    reply_markup: {inline_keyboard: [[{text:'Открыть приложение',style:'primary',web_app:{url:APP_URL}}]]}
  };
  if (groupChat && /^\/plan(?:@mytrainplan_bot)?$/i.test(text) &&
      (Number.isSafeInteger(m.from?.id) || m.sender_chat?.id === m.chat.id)) return {
    chat_id:m.chat.id,
    ...(Number.isSafeInteger(m.message_thread_id) ? {message_thread_id:m.message_thread_id} : {}),
    parse_mode:'HTML',
    text:'🏋️ <b>Мой тренировочный план</b>\n\n📅 Тренировки · 📝 Результаты · 📈 Прогресс\n\nНажми кнопку ниже, чтобы открыть свой личный кабинет.',
    reply_markup:{inline_keyboard:[[{text:'Открыть приложение',style:'primary',url:MINI_APP_LINK}]]}
  };
  return null;
}

export function createProcessor(callApi) {
  const completed = new Map(), pending = new Map();
  return async function process(update) {
    const message = welcome(update);
    if (!message) return;
    if (update.message.chat.type !== 'private') {
      const m=update.message;
      if (m.sender_chat?.id !== m.chat.id) {
        const member=await callApi('getChatMember',{chat_id:m.chat.id,user_id:m.from.id});
        if (!['creator','administrator'].includes(member?.status)) return;
      }
    }
    const id = update.update_id;
    const now = Date.now();
    for (const [key, at] of completed) if (now - at > 86400000) completed.delete(key);
    if (completed.has(id)) return;
    if (pending.has(id)) return pending.get(id);
    const task = Promise.resolve().then(() => callApi('sendMessage', message)).then(() => {
      completed.set(id, Date.now());
      if (completed.size > 10000) completed.delete(completed.keys().next().value);
    }).finally(() => pending.delete(id));
    pending.set(id, task);
    return task;
  };
}
