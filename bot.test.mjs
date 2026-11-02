import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticated, welcome, createProcessor, APP_URL, MINI_APP_LINK } from './bot.mjs';
const start = (id=1) => ({update_id:id,message:{chat:{id:123,type:'private'},from:{id:123},text:'/start'}});
test('start returns inline mini app button for the production app', () => {
  const result = welcome(start());
  assert.equal(result.chat_id,123);
  assert.deepEqual(result.reply_markup.inline_keyboard,[[{text:'Открыть приложение',web_app:{url:APP_URL}}]]);
  assert.equal(result.reply_markup.keyboard,undefined);
  assert.match(result.text,/одноразовым кодом/);
  for (const text of ['/start payload','/start@mytrainplan_bot','/start@mytrainplan_bot payload']) {
    const update=start();update.message.text=text;assert.ok(welcome(update));
  }
});
test('does not send messages for unrelated commands, groups or forged identities', () => {
  for (const text of ['/starter','hello','/start@other_bot']) {
    const update=start(); update.message.text=text;assert.equal(welcome(update),null);
  }
  const group=start();group.message.chat.type='group';assert.equal(welcome(group),null);
  const bot=start();bot.message.from.is_bot=true;assert.equal(welcome(bot),null);
  const forged=start();forged.message.from.id=999;assert.equal(welcome(forged),null);
  assert.equal(welcome({}),null);
});
test('webhook requires exact private secret', () => {
  assert.equal(authenticated(undefined,'secret'),false);
  assert.equal(authenticated('secret',''),false);
  assert.equal(authenticated('secretX','secret'),false);
  assert.equal(authenticated('secreX','secret'),false);
  assert.equal(authenticated('secret','secret'),true);
});
test('concurrent retries send only one welcome, subsequent start still responds', async () => {
  let count=0;
  const process=createProcessor(async (method,body) => {assert.equal(method,'sendMessage'); assert.equal(body.chat_id,123);count++;});
  await Promise.all([process(start()),process(start()),process(start())]);
  await process(start()); assert.equal(count,1);
  await process(start(2));assert.equal(count,2);
});
test('failed send is retried instead of consuming the update', async () => {
  let count=0;const process=createProcessor(async () => {if (++count===1) throw new Error('failure');});
  await assert.rejects(process(start()));await process(start());await process(start());assert.equal(count,2);
});

test('only group administrators can publish the pinnable app message', async () => {
  const update=start(10);update.message.chat={id:-100123,type:'supergroup'};update.message.text='/plan@mytrainplan_bot';update.message.message_thread_id=7;
  let sent=[];let role='member';
  const process=createProcessor(async (method,body) => {
    if (method==='getChatMember') return {status:role};
    sent.push(body);return {message_id:99};
  });
  await process(update);assert.equal(sent.length,0);
  role='administrator';await process(update);assert.equal(sent.length,1);
  assert.deepEqual(sent[0].reply_markup.inline_keyboard,[[{text:'Открыть приложение',url:MINI_APP_LINK}]]);
  assert.equal(sent[0].message_thread_id,7);
  await process(update);assert.equal(sent.length,1);
});
