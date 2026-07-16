const supabase = require('./supabaseClient');

// ---------- Admins ----------

async function isAdmin(telegramId) {
  const { data, error } = await supabase
    .from('admins')
    .select('telegram_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) {
    console.error('[db] isAdmin error:', error.message);
    return false;
  }
  return !!data;
}

async function addAdmin(telegramId, addedBy) {
  const { error } = await supabase
    .from('admins')
    .upsert({ telegram_id: telegramId, added_by: addedBy }, { onConflict: 'telegram_id' });
  if (error) throw error;
}

async function removeAdmin(telegramId) {
  const { error } = await supabase.from('admins').delete().eq('telegram_id', telegramId);
  if (error) throw error;
}

async function listAdmins() {
  const { data, error } = await supabase.from('admins').select('*').order('added_at');
  if (error) throw error;
  return data;
}

// ---------- Users ----------

async function getOrCreateUser(telegramId) {
  let { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const { data: created, error: insertErr } = await supabase
      .from('users')
      .insert({ telegram_id: telegramId })
      .select()
      .single();
    if (insertErr) throw insertErr;
    data = created;
  }
  return data;
}

async function updateUser(telegramId, fields) {
  const { error } = await supabase.from('users').update(fields).eq('telegram_id', telegramId);
  if (error) throw error;
}

async function setPremium(telegramId, premium) {
  await getOrCreateUser(telegramId); // ensure row exists
  const { error } = await supabase
    .from('users')
    .update({ premium })
    .eq('telegram_id', telegramId);
  if (error) throw error;
}

// ---------- Batches ----------

async function batchIdExists(batchId) {
  const { data, error } = await supabase
    .from('batches')
    .select('batch_id')
    .eq('batch_id', batchId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function createBatch(batchId, createdBy) {
  const { error } = await supabase.from('batches').insert({
    batch_id: batchId,
    total_files: 0,
    created_by: createdBy,
  });
  if (error) throw error;
}

async function addBatchMessage(batchId, messageId, fileOrder) {
  const { error } = await supabase.from('batch_messages').insert({
    batch_id: batchId,
    message_id: messageId,
    file_order: fileOrder,
  });
  if (error) throw error;
}

async function finalizeBatch(batchId, totalFiles) {
  const { error } = await supabase
    .from('batches')
    .update({ total_files: totalFiles })
    .eq('batch_id', batchId);
  if (error) throw error;
}

async function deleteBatch(batchId) {
  // batch_messages cascade-deletes via FK
  const { error, count } = await supabase
    .from('batches')
    .delete({ count: 'exact' })
    .eq('batch_id', batchId);
  if (error) throw error;
  return count > 0;
}

async function getBatch(batchId) {
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .eq('batch_id', batchId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getBatchMessages(batchId) {
  const { data, error } = await supabase
    .from('batch_messages')
    .select('message_id, file_order')
    .eq('batch_id', batchId)
    .order('file_order', { ascending: true });
  if (error) throw error;
  return data;
}

async function listBatches(limit = 20) {
  const { data, error } = await supabase
    .from('batches')
    .select('batch_id, total_files, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ---------- Settings ----------

async function getSetting(key) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// ---------- Stats ----------

async function getStats() {
  const [{ count: totalUsers }, { count: premiumUsers }, { count: totalBatches }, { count: totalFiles }] =
    await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('premium', true),
      supabase.from('batches').select('*', { count: 'exact', head: true }),
      supabase.from('batch_messages').select('*', { count: 'exact', head: true }),
    ]);

  return { totalUsers, premiumUsers, totalBatches, totalFiles };
}

module.exports = {
  isAdmin,
  addAdmin,
  removeAdmin,
  listAdmins,
  getOrCreateUser,
  updateUser,
  setPremium,
  batchIdExists,
  createBatch,
  addBatchMessage,
  finalizeBatch,
  deleteBatch,
  getBatch,
  getBatchMessages,
  listBatches,
  getSetting,
  setSetting,
  getStats,
};
