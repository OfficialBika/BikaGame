const { MongoClient } = require('mongodb');

/**
 * Establish a MongoDB connection and return the collections used by the bot.
 * The first call will create a single client instance that is reused on
 * subsequent calls. This module exports a `connect` function that resolves
 * to an object containing the Mongo client and collection handles.
 */
let client;

async function connect({ uri, dbName }) {
  if (client && client.isConnected && client.isConnected()) {
    const db = client.db(dbName);
    return {
      client,
      db,
      users: db.collection('users'),
      transactions: db.collection('transactions'),
      groups: db.collection('groups'),
      config: db.collection('config'),
      orders: db.collection('orders'),
    };
  }
  client = new MongoClient(uri, {});
  await client.connect();
  const db = client.db(dbName);
  // Ensure indexes for expected queries.
  await Promise.all([
    db.collection('users').createIndex({ userId: 1 }, { unique: true }),
    db.collection('users').createIndex({ username: 1 }, { sparse: true }),
    db.collection('transactions').createIndex({ createdAt: -1 }),
    db.collection('groups').createIndex({ groupId: 1 }, { unique: true }),
  ]);
  return {
    client,
    db,
    users: db.collection('users'),
    transactions: db.collection('transactions'),
    groups: db.collection('groups'),
    config: db.collection('config'),
    orders: db.collection('orders'),
  };
}

module.exports = { connect };