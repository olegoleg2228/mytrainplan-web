import http from 'node:http';
import { APP_URL, authenticated, createProcessor } from './bot.mjs';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const origin = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_ORIGIN || '';
if (!/^\d{6,14}:[A-Za-z0-9_-]{30,80}$/.test(token) ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(secret) || !/^https:\/\/[a-z0-9.-]+$/.test(origin)) {
  throw new Error('Configure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and public HTTPS origin.');
}
async function api(method, body) {
  // Never log the URL, request body, Telegram IDs or upstream error text.
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('Telegram API request failed.');
  return result.result;
}
const processUpdate = createProcessor(api);
const server = http.createServer(async (req, res) => {
  const respond = (status, text) => { res.writeHead(status, {'content-type':'text/plain; charset=utf-8'}); res.end(text); };
  if (req.method === 'GET' && req.url === '/health') return respond(200, 'ok');
  if (req.method !== 'POST' || req.url !== '/webhook') return respond(404, 'Not found');
  if (!authenticated(req.headers['x-telegram-bot-api-secret-token'], secret)) return respond(403, 'Forbidden');
  const chunks = []; let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { respond(413, 'Too large'); req.destroy(); return; }
      chunks.push(chunk);
    }
    let update;
    try { update = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return respond(400, 'Invalid JSON'); }
    await processUpdate(update);
    respond(200, 'ok');
  } catch { console.error('Update processing failed.'); if (!res.headersSent) respond(503, 'Retry later'); }
});
server.requestTimeout = 20000;
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', async () => {
  console.log('My training plan bot listening.');
  try {
    const bot = await api('getMe', {});
    if (bot.username?.toLowerCase() !== 'mytrainplan_bot') throw new Error('Wrong bot.');
    await api('setWebhook', {url: `${origin}/webhook`, secret_token:secret, allowed_updates:['message'], max_connections:1, drop_pending_updates:false});
    await api('setMyCommands', {commands:[{command:'start',description:'Открыть тренировочный план'},{command:'plan',description:'Сообщение с приложением для закрепления (администратор)'}]});
    await api('setChatMenuButton', {menu_button:{type:'web_app',text:'Открыть приложение',web_app:{url:APP_URL}}});
    console.log('Bot webhook and menu configured.');
  } catch { console.error('Bot setup failed; check private environment settings.'); server.close(() => process.exit(1)); }
});
