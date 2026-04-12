let groups;

function init({ groups: groupsCollection }) {
  groups = groupsCollection;
}

async function ensureGroup(chat) {
  const now = new Date();
  const doc = {
    groupId: chat.id,
    title: chat.title || '',
    username: chat.username || null,
    approvalStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  const existing = await groups.findOne({ groupId: chat.id });
  if (existing) return existing;
  await groups.insertOne(doc);
  return doc;
}

async function setStatus(groupId, status) {
  const allowed = ['approved', 'rejected'];
  if (!allowed.includes(status)) throw new Error('Invalid status');
  const res = await groups.findOneAndUpdate(
    { groupId },
    { $set: { approvalStatus: status, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return res.value;
}

async function getPending(limit = 20) {
  return groups.find({ approvalStatus: 'pending' }).sort({ updatedAt: -1 }).limit(limit).toArray();
}

module.exports = { init, ensureGroup, setStatus, getPending };