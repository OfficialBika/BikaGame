const userModel = require('../models/userModel');
async function getTopUsers(limit=10){ return userModel.collection().find({}).sort({balance:-1}).limit(limit).toArray(); }
module.exports = { getTopUsers };
